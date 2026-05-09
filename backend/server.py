"""Wayly mobile API — FastAPI backend powering the Expo mobile app.

Implements the contract surface required for Phase 1 of the mobile client:
  - JWT auth (signup / login / me)
  - Household onboarding
  - Statement upload (camera/gallery/PDF) → Claude vision OCR → structured parse
  - Statement list/detail
  - Today/budget summary
  - Notifications (in-app + Expo push)
"""
from __future__ import annotations

import asyncio
import base64
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, File, HTTPException, UploadFile
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from starlette.middleware.cors import CORSMiddleware

from auth import (
    create_token,
    get_current_user_id,
    hash_password,
    verify_password,
)
from models import (
    Anomaly,
    Household,
    HouseholdCreate,
    LoginRequest,
    NotificationItem,
    PushTokenRegister,
    SignupRequest,
    Statement,
    StatementLineItem,
    TokenResponse,
    UserPublic,
    new_id,
    now_iso,
)
import budget as budget_lib

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("wayly")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

app = FastAPI(title="Wayly Mobile API")
api = APIRouter(prefix="/api")


# ─────────────────── helpers ───────────────────
async def _get_user(user_id: str) -> dict:
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


async def _get_household(user_id: str) -> Optional[dict]:
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user or not user.get("household_id"):
        return None
    return await db.households.find_one({"id": user["household_id"]}, {"_id": 0})


async def _require_household(user_id: str) -> dict:
    h = await _get_household(user_id)
    if not h:
        raise HTTPException(status_code=400, detail="No household yet — create one first.")
    return h


def _user_public(u: dict) -> UserPublic:
    return UserPublic(
        id=u["id"],
        email=u["email"],
        name=u["name"],
        role=u["role"],
        plan=u.get("plan", "free"),
        household_id=u.get("household_id"),
        created_at=u["created_at"],
    )


async def _push_to_user(user_id: str, title: str, body: str, data: Optional[dict] = None) -> None:
    """Fire an Expo push notification to all of a user's registered devices."""
    devices = await db.push_tokens.find({"user_id": user_id}, {"_id": 0}).to_list(20)
    if not devices:
        return
    try:
        from exponent_server_sdk import PushClient, PushMessage
        client = PushClient()
        for d in devices:
            try:
                client.publish(
                    PushMessage(
                        to=d["expo_push_token"],
                        title=title,
                        body=body,
                        data=data or {},
                        sound="default",
                        priority="high",
                    )
                )
            except Exception as e:
                logger.warning("Expo push failed for token %s: %s", d.get("expo_push_token", "")[:20], e)
    except Exception as e:
        logger.warning("exponent_server_sdk not available: %s", e)


# ─────────────────── auth ───────────────────
@api.post("/auth/signup", response_model=TokenResponse)
async def signup(payload: SignupRequest):
    existing = await db.users.find_one({"email": payload.email.lower()})
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")
    user_doc = {
        "id": new_id(),
        "email": payload.email.lower(),
        "password_hash": hash_password(payload.password),
        "name": payload.name,
        "role": payload.role,
        "plan": "free",
        "household_id": None,
        "created_at": now_iso(),
    }
    await db.users.insert_one(user_doc)
    token = create_token(user_doc["id"])
    return TokenResponse(token=token, user=_user_public(user_doc))


@api.post("/auth/login", response_model=TokenResponse)
async def login(payload: LoginRequest):
    user = await db.users.find_one({"email": payload.email.lower()}, {"_id": 0})
    if not user or not verify_password(payload.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_token(user["id"])
    return TokenResponse(token=token, user=_user_public(user))


@api.get("/auth/me", response_model=UserPublic)
async def me(user_id: str = Depends(get_current_user_id)):
    u = await _get_user(user_id)
    return _user_public(u)


# ─────────────────── household ───────────────────
@api.post("/household", response_model=Household)
async def create_household(payload: HouseholdCreate, user_id: str = Depends(get_current_user_id)):
    h = Household(
        owner_id=user_id,
        participant_name=payload.participant_name,
        classification=payload.classification,
        provider_name=payload.provider_name,
        is_grandfathered=payload.is_grandfathered,
    )
    await db.households.insert_one(h.model_dump())
    await db.users.update_one({"id": user_id}, {"$set": {"household_id": h.id}})
    return h


@api.get("/household", response_model=Optional[Household])
async def get_household(user_id: str = Depends(get_current_user_id)):
    h = await _get_household(user_id)
    if not h:
        return None
    return Household(**h)


# ─────────────────── statements ───────────────────
UPLOAD_JOBS: Dict[str, dict] = {}


def _submit_upload_job(text: str, filename: str, household_id: str, user_id: str, user_name: str, file_size: int) -> str:
    job_id = new_id()
    UPLOAD_JOBS[job_id] = {
        "user_id": user_id,
        "household_id": household_id,
        "status": "pending",
        "phase": "parsing",
    }

    async def _run():
        try:
            from agents import parse_statement
            UPLOAD_JOBS[job_id]["phase"] = "parsing"
            data = await parse_statement(text)
            line_items = []
            for li in data.get("line_items", []) or []:
                try:
                    line_items.append(StatementLineItem(**li).model_dump())
                except Exception as e:
                    logger.warning("Skipped invalid line item: %s", e)
            anomalies = []
            for an in data.get("anomalies", []) or []:
                try:
                    anomalies.append(Anomaly(**an).model_dump())
                except Exception as e:
                    logger.warning("Skipped invalid anomaly: %s", e)
            stmt = Statement(
                household_id=household_id,
                filename=filename,
                period_label=data.get("period_label"),
                line_items=[StatementLineItem(**li) for li in line_items],
                summary=data.get("summary"),
                anomalies=[Anomaly(**a) for a in anomalies],
                raw_text_preview=(text or "")[:500],
            )
            doc = stmt.model_dump()
            doc["file_size_bytes"] = file_size
            await db.statements.insert_one(doc)

            # Notify on HIGH/MEDIUM (alert/warning) anomalies
            for an in anomalies:
                if an.get("severity") in ("alert", "warning"):
                    note = NotificationItem(
                        user_id=user_id,
                        title=an.get("title", "New alert on your statement"),
                        body=an.get("detail", ""),
                        category="anomaly",
                        severity=an.get("severity", "info"),
                        related_statement_id=stmt.id,
                    )
                    await db.notifications.insert_one(note.model_dump())
                    await _push_to_user(
                        user_id,
                        title=an.get("title", "New alert"),
                        body=an.get("detail", "") or "",
                        data={"statement_id": stmt.id, "anomaly_id": an.get("id")},
                    )

            UPLOAD_JOBS[job_id]["status"] = "done"
            UPLOAD_JOBS[job_id]["statement_id"] = stmt.id
            UPLOAD_JOBS[job_id]["phase"] = "done"
        except Exception as e:
            logger.exception("Upload job failed")
            UPLOAD_JOBS[job_id]["status"] = "error"
            UPLOAD_JOBS[job_id]["error"] = str(e)

    asyncio.create_task(_run())
    return job_id


@api.post("/statements/upload")
async def upload_statement(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
):
    """Async upload — kicks off OCR + parse, returns {job_id} immediately."""
    h = await _require_household(user_id)
    user = await _get_user(user_id)
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file")
    from document_extract import (
        CorruptFileError,
        FileTooLargeError,
        PasswordProtectedError,
        UnsupportedFormatError,
        extract_document,
    )
    try:
        text, input_method, page_count, parse_warnings = await extract_document(file.filename or "", raw)
    except UnsupportedFormatError as e:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {e}")
    except FileTooLargeError as e:
        raise HTTPException(status_code=413, detail=f"File too large: {e}")
    except PasswordProtectedError:
        raise HTTPException(status_code=400, detail="This PDF is password-protected.")
    except CorruptFileError as e:
        raise HTTPException(status_code=400, detail=f"Could not read file: {e}")
    if not (text or "").strip():
        raise HTTPException(status_code=400, detail="Could not extract text. Try a clearer photo.")
    job_id = _submit_upload_job(text, file.filename or "statement", h["id"], user_id, user["name"], len(raw))
    return {"job_id": job_id, "status": "pending"}


@api.get("/statements/upload-job/{job_id}")
async def get_upload_job(job_id: str, user_id: str = Depends(get_current_user_id)):
    job = UPLOAD_JOBS.get(job_id)
    if not job or job.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Job not found or expired")
    out = {"status": job["status"], "phase": job.get("phase", job["status"])}
    if job["status"] == "done":
        out["statement_id"] = job.get("statement_id")
    elif job["status"] == "error":
        out["error"] = job.get("error", "decode failed")
    return out


@api.get("/statements", response_model=List[Statement])
async def list_statements(user_id: str = Depends(get_current_user_id)):
    h = await _require_household(user_id)
    docs = (
        await db.statements.find({"household_id": h["id"]}, {"_id": 0})
        .sort("uploaded_at", -1)
        .to_list(100)
    )
    return [Statement(**d) for d in docs]


@api.get("/statements/{statement_id}", response_model=Statement)
async def get_statement(statement_id: str, user_id: str = Depends(get_current_user_id)):
    h = await _require_household(user_id)
    doc = await db.statements.find_one({"id": statement_id, "household_id": h["id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Statement not found")
    return Statement(**doc)


# ─────────────────── budget / today ───────────────────
@api.get("/budget/current")
async def current_budget(user_id: str = Depends(get_current_user_id)):
    h = await _require_household(user_id)
    classification = h["classification"]
    q_start, q_end, q_label = budget_lib.get_quarter_window()
    allocations = budget_lib.stream_allocations(classification)
    quarterly_total = budget_lib.quarterly_budget(classification)

    docs = await db.statements.find({"household_id": h["id"]}, {"_id": 0}).to_list(200)
    items: List[dict] = []
    for s in docs:
        items.extend(s.get("line_items", []))
    burn = budget_lib.compute_burn(items, q_start, q_end)
    contributions_total = budget_lib.compute_contributions(items)

    streams = [
        {
            "stream": s,
            "allocated": allocations[s],
            "spent": round(burn.get(s, 0.0), 2),
            "remaining": round(allocations[s] - burn.get(s, 0.0), 2),
            "pct": round((burn.get(s, 0.0) / allocations[s] * 100) if allocations[s] else 0, 1),
        }
        for s in budget_lib.STREAMS
    ]
    cap_amount = budget_lib.lifetime_cap(h.get("is_grandfathered", False))
    spent = sum(s["spent"] for s in streams)
    remaining = max(0.0, quarterly_total - spent)

    # Count alerts across all statements
    alert_count = 0
    for s in docs:
        for an in s.get("anomalies", []) or []:
            if an.get("severity") in ("alert", "warning"):
                alert_count += 1

    latest = sorted(docs, key=lambda d: d.get("uploaded_at", ""), reverse=True)
    latest_card = None
    if latest:
        ls = latest[0]
        latest_card = {
            "id": ls.get("id"),
            "period_label": ls.get("period_label") or ls.get("filename"),
            "summary": ls.get("summary"),
            "uploaded_at": ls.get("uploaded_at"),
            "anomaly_count": len(ls.get("anomalies", []) or []),
            "line_item_count": len(ls.get("line_items", []) or []),
        }

    return {
        "participant_name": h["participant_name"],
        "classification": classification,
        "classification_label": budget_lib.CLASSIFICATIONS[classification]["label"],
        "quarter_label": q_label,
        "quarterly_total": quarterly_total,
        "spent_this_quarter": round(spent, 2),
        "remaining_this_quarter": round(remaining, 2),
        "burn_pct": round((spent / quarterly_total * 100) if quarterly_total else 0, 1),
        "streams": streams,
        "lifetime_cap": cap_amount,
        "lifetime_contributions": contributions_total,
        "lifetime_pct": round((contributions_total / cap_amount * 100) if cap_amount else 0, 2),
        "alert_count": alert_count,
        "statement_count": len(docs),
        "latest_statement": latest_card,
    }


# ─────────────────── notifications ───────────────────
@api.get("/notifications")
async def list_notifications(user_id: str = Depends(get_current_user_id)):
    docs = (
        await db.notifications.find({"user_id": user_id}, {"_id": 0})
        .sort("created_at", -1)
        .limit(50)
        .to_list(50)
    )
    unread = await db.notifications.count_documents({"user_id": user_id, "read": False})
    return {"items": docs, "unread": unread}


class NotificationReadBody(BaseModel):
    ids: List[str] = Field(default_factory=list)


@api.post("/notifications/read")
async def mark_read(body: NotificationReadBody, user_id: str = Depends(get_current_user_id)):
    q: dict = {"user_id": user_id}
    if body.ids:
        q["id"] = {"$in": body.ids}
    res = await db.notifications.update_many(q, {"$set": {"read": True, "read_at": now_iso()}})
    return {"ok": True, "modified": res.modified_count}


@api.post("/notifications/register-push")
async def register_push(body: PushTokenRegister, user_id: str = Depends(get_current_user_id)):
    await db.push_tokens.update_one(
        {"user_id": user_id, "expo_push_token": body.expo_push_token},
        {
            "$set": {
                "user_id": user_id,
                "expo_push_token": body.expo_push_token,
                "platform": body.platform,
                "updated_at": now_iso(),
            }
        },
        upsert=True,
    )
    return {"ok": True}


# ─────────────────── seed demo data on startup ───────────────────
@app.on_event("startup")
async def seed_demo():
    try:
        # Ensure indexes
        await db.users.create_index("email", unique=True)
        await db.statements.create_index([("household_id", 1), ("uploaded_at", -1)])
        await db.notifications.create_index([("user_id", 1), ("created_at", -1)])
        await db.push_tokens.create_index([("user_id", 1), ("expo_push_token", 1)], unique=True)

        # Demo seed if not present
        existing = await db.users.find_one({"email": "demo@wayly.com.au"})
        if existing:
            return
        demo_user = {
            "id": new_id(),
            "email": "demo@wayly.com.au",
            "password_hash": hash_password("Wayly123!"),
            "name": "Cathy Williams",
            "role": "caregiver",
            "plan": "family",
            "household_id": None,
            "created_at": now_iso(),
        }
        await db.users.insert_one(demo_user)

        h = Household(
            owner_id=demo_user["id"],
            participant_name="Margaret",
            classification=4,
            provider_name="HomeCare Plus",
            is_grandfathered=False,
        )
        await db.households.insert_one(h.model_dump())
        await db.users.update_one({"id": demo_user["id"]}, {"$set": {"household_id": h.id}})

        # Sample statement with realistic line items
        from datetime import date
        today = date.today()
        sample_items = [
            StatementLineItem(date=f"{today.year}-{today.month:02d}-03", service_name="Personal care", stream="Independence", units=2.0, unit_price=62.50, total=125.00, contribution_paid=12.50, government_paid=112.50),
            StatementLineItem(date=f"{today.year}-{today.month:02d}-05", service_name="Domestic assistance", stream="Everyday Living", units=3.0, unit_price=58.00, total=174.00, contribution_paid=17.40, government_paid=156.60),
            StatementLineItem(date=f"{today.year}-{today.month:02d}-09", service_name="Nursing visit", stream="Clinical", units=1.0, unit_price=145.00, total=145.00, contribution_paid=0.00, government_paid=145.00),
            StatementLineItem(date=f"{today.year}-{today.month:02d}-12", service_name="Physiotherapy", stream="Clinical", units=1.0, unit_price=125.00, total=125.00, contribution_paid=0.00, government_paid=125.00),
            StatementLineItem(date=f"{today.year}-{today.month:02d}-16", service_name="Personal care", stream="Independence", units=2.0, unit_price=62.50, total=125.00, contribution_paid=12.50, government_paid=112.50),
            StatementLineItem(date=f"{today.year}-{today.month:02d}-19", service_name="Cleaning", stream="Everyday Living", units=2.0, unit_price=55.00, total=110.00, contribution_paid=11.00, government_paid=99.00),
            StatementLineItem(date=f"{today.year}-{today.month:02d}-22", service_name="Personal care (weekend rate)", stream="Independence", units=2.0, unit_price=89.00, total=178.00, contribution_paid=17.80, government_paid=160.20),
        ]
        sample_anomalies = [
            Anomaly(severity="warning", title="Weekend rate not flagged", detail="A personal-care visit on Saturday 22nd was billed at $89/hr — that's the weekend rate. Worth checking it was scheduled deliberately.", suggested_action="Ask your provider whether the weekend visit was the only option.").model_dump(),
            Anomaly(severity="info", title="First nursing visit this quarter", detail="Margaret's first clinical nursing visit appears this month at $145.", suggested_action=None).model_dump(),
        ]
        stmt = Statement(
            household_id=h.id,
            filename="sample-statement.pdf",
            period_label=f"{today.strftime('%B %Y')}",
            line_items=sample_items,
            summary=f"Margaret used about ${sum(li.total for li in sample_items):.2f} of services this month — mostly personal care and domestic help, with two clinical visits. You contributed ${sum(li.contribution_paid for li in sample_items):.2f}.",
            anomalies=[Anomaly(**a) for a in sample_anomalies],
            raw_text_preview="Sample seeded statement — log in as demo@wayly.com.au / Wayly123!",
        )
        await db.statements.insert_one(stmt.model_dump())

        # Seed one notification
        note = NotificationItem(
            user_id=demo_user["id"],
            title="Weekend rate not flagged",
            body="A personal-care visit on Saturday was billed at the weekend rate. Worth a quick check.",
            category="anomaly",
            severity="warning",
            related_statement_id=stmt.id,
        )
        await db.notifications.insert_one(note.model_dump())

        logger.info("Seeded demo user demo@wayly.com.au / Wayly123!")
    except Exception as e:
        logger.warning("Seed failed (non-fatal): %s", e)


@app.on_event("shutdown")
async def _shutdown():
    client.close()


# ─────────────────── health ───────────────────
@api.get("/")
async def root():
    return {"app": "Wayly Mobile API", "status": "ok"}


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
