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
# ─────────────────── chat (help-chat with dashboard context) ───────────────────
class ChatBody(BaseModel):
    message: str
    session_id: Optional[str] = None


@api.post("/chat")
async def chat(body: ChatBody, user_id: str = Depends(get_current_user_id)):
    h = await _require_household(user_id)
    user = await _get_user(user_id)
    classification = h["classification"]
    q_start, q_end, q_label = budget_lib.get_quarter_window()
    docs = await db.statements.find({"household_id": h["id"]}, {"_id": 0}).to_list(200)
    items: List[dict] = []
    for s in docs:
        items.extend(s.get("line_items", []))
    burn = budget_lib.compute_burn(items, q_start, q_end)
    contributions = budget_lib.compute_contributions(items)
    cap_amount = budget_lib.lifetime_cap(h.get("is_grandfathered", False))
    latest_summary = (
        sorted(docs, key=lambda d: d.get("uploaded_at", ""), reverse=True)[0].get("summary")
        if docs else "No statements uploaded yet."
    )
    burn_str = ", ".join(f"{k}: ${v:,.2f}" for k, v in burn.items())
    context = (
        f"You are Kindred — Wayly's calm aged-care helper for caregivers in Australia. "
        f"User is {user['name']} caring for {h['participant_name']} on {budget_lib.CLASSIFICATIONS[classification]['label']}. "
        f"Provider: {h['provider_name']}. Quarter: {q_label}. Quarterly budget ${budget_lib.quarterly_budget(classification):,.2f}. "
        f"Burn so far: {burn_str or 'no spend yet'}. Lifetime contributions ${contributions:,.2f} of ${cap_amount:,.2f}. "
        f"Latest statement summary: {latest_summary}. "
        "Tone: warm, plain English, never alarmist. Two-three sentences max unless asked for detail."
    )
    session_id = body.session_id or f"chat-{h['id']}"
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        api_key = os.environ.get("EMERGENT_LLM_KEY")
        if not api_key:
            raise RuntimeError("EMERGENT_LLM_KEY not set")
        chat_inst = LlmChat(
            api_key=api_key, session_id=session_id, system_message=context
        ).with_model("anthropic", "claude-sonnet-4-5-20250929").with_params(max_tokens=600)
        reply = await chat_inst.send_message(UserMessage(text=body.message))
        reply_text = str(reply or "")
    except Exception as e:
        logger.exception("chat failed")
        reply_text = "I'm having trouble reaching my brain at the moment — try again in a minute."

    await db.chat_turns.insert_many([
        {"id": new_id(), "household_id": h["id"], "role": "user", "content": body.message, "created_at": now_iso()},
        {"id": new_id(), "household_id": h["id"], "role": "assistant", "content": reply_text, "created_at": now_iso()},
    ])
    return {"reply": reply_text, "session_id": session_id}


@api.get("/chat/history")
async def chat_history(user_id: str = Depends(get_current_user_id)):
    h = await _require_household(user_id)
    return await db.chat_turns.find({"household_id": h["id"]}, {"_id": 0}).sort("created_at", 1).to_list(500)


# ─────────────────── family thread ───────────────────
class FamilyMessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=2000)
    related_statement_id: Optional[str] = None


@api.post("/family-thread")
async def post_family_message(payload: FamilyMessageCreate, user_id: str = Depends(get_current_user_id)):
    h = await _require_household(user_id)
    user = await _get_user(user_id)
    msg = {
        "id": new_id(),
        "household_id": h["id"],
        "author_id": user_id,
        "author_name": user["name"],
        "body": payload.body,
        "related_statement_id": payload.related_statement_id,
        "created_at": now_iso(),
    }
    response = dict(msg)  # snapshot before Mongo mutates with _id
    await db.family_messages.insert_one(msg)
    return response


@api.get("/family-thread")
async def list_family_messages(user_id: str = Depends(get_current_user_id)):
    h = await _require_household(user_id)
    docs = await db.family_messages.find({"household_id": h["id"]}, {"_id": 0}).sort("created_at", 1).to_list(500)
    return docs


# ─────────────────── participant view ───────────────────
@api.get("/participant/today")
async def participant_today(user_id: str = Depends(get_current_user_id)):
    h = await _require_household(user_id)
    classification = h["classification"]
    q_start, q_end, q_label = budget_lib.get_quarter_window()
    quarterly_total = budget_lib.quarterly_budget(classification)
    docs = await db.statements.find({"household_id": h["id"]}, {"_id": 0}).to_list(200)
    items: List[dict] = []
    for s in docs:
        items.extend(s.get("line_items", []))
    burn = budget_lib.compute_burn(items, q_start, q_end)
    spent = sum(burn.values())
    remaining = max(0.0, quarterly_total - spent)
    today = datetime.now(timezone.utc).date()
    days_left = (q_end - today).days + 1
    appt = {"time": "10:00 AM", "name": "Sarah", "service": "Personal care", "duration": "1 hour"}
    return {
        "participant_name": h["participant_name"],
        "today_label": today.strftime("%A %d %B"),
        "appointment": appt,
        "quarter_remaining": round(remaining, 2),
        "quarter_remaining_sentence": (
            f"That's plenty for the {days_left} days left in this quarter."
            if remaining > spent * 0.2 or days_left < 30
            else f"Just keep an eye on it — {days_left} days to go."
        ),
        "caregiver_name": (await _get_user(h.get("owner_id", user_id)))["name"],
    }


class WellbeingBody(BaseModel):
    mood: str = Field(pattern="^(good|okay|not_great)$")
    notify_caregiver: bool = False


@api.post("/participant/wellbeing")
async def log_wellbeing(body: WellbeingBody, user_id: str = Depends(get_current_user_id)):
    h = await _get_household(user_id)
    user = await _get_user(user_id)
    doc = {
        "id": new_id(),
        "user_id": user_id,
        "household_id": h["id"] if h else None,
        "mood": body.mood,
        "notify_caregiver": body.notify_caregiver,
        "created_at": now_iso(),
    }
    await db.wellbeing.insert_one(doc)
    if h and body.mood == "not_great" and body.notify_caregiver and h.get("owner_id") and h["owner_id"] != user_id:
        note = NotificationItem(
            user_id=h["owner_id"],
            title=f"{user['name']} flagged a hard day",
            body="They marked today as 'not great'. Worth checking in.",
            category="wellbeing",
            severity="warning",
        )
        await db.notifications.insert_one(note.model_dump())
        await _push_to_user(h["owner_id"], note.title, note.body, {"category": "wellbeing"})
    doc.pop("_id", None)
    return doc


@api.get("/participant/wellbeing")
async def recent_wellbeing(user_id: str = Depends(get_current_user_id)):
    h = await _get_household(user_id)
    if not h:
        return []
    return await db.wellbeing.find({"household_id": h["id"]}, {"_id": 0}).sort("created_at", -1).limit(14).to_list(14)


# ─────────────────── share dashboard (mock) ───────────────────
class ShareBody(BaseModel):
    extra_emails: List[str] = Field(default_factory=list, max_length=10)
    note: Optional[str] = ""


@api.post("/dashboard/share")
async def share_dashboard(body: ShareBody, user_id: str = Depends(get_current_user_id)):
    # Local fallback — real production uses Resend pipeline. Here we just ack.
    if not body.extra_emails:
        raise HTTPException(status_code=400, detail="Add at least one email address.")
    return {"sent_to": body.extra_emails, "failures": []}


# ─────────────────── public AI tools ───────────────────
class PublicBudgetBody(BaseModel):
    classification: int = Field(ge=1, le=8)
    is_grandfathered: bool = False
    current_lifetime_balance: float = 0.0
    expected_annual_burn: Optional[float] = None


@api.post("/public/budget-calc")
async def public_budget_calc(body: PublicBudgetBody):
    classification = body.classification
    annual = budget_lib.CLASSIFICATIONS[classification]["annual"]
    quarterly = budget_lib.quarterly_budget(classification)
    allocations = budget_lib.stream_allocations(classification)
    rollover = budget_lib.rollover_cap(classification)
    cap_amount = budget_lib.lifetime_cap(body.is_grandfathered)
    contributions = max(0.0, body.current_lifetime_balance)
    pct = (contributions / cap_amount * 100) if cap_amount else 0.0
    years_to_cap = None
    if body.expected_annual_burn and body.expected_annual_burn > 0:
        remaining = max(0.0, cap_amount - contributions)
        years_to_cap = round(remaining / body.expected_annual_burn, 2)
    return {
        "classification": classification,
        "classification_label": budget_lib.CLASSIFICATIONS[classification]["label"],
        "annual_total": annual,
        "quarterly_total": quarterly,
        "rollover_cap": rollover,
        "streams": [{"stream": s, "allocated": allocations[s]} for s in budget_lib.STREAMS],
        "lifetime_cap": cap_amount,
        "lifetime_contributions": contributions,
        "lifetime_pct": round(pct, 2),
        "years_to_cap": years_to_cap,
        "is_grandfathered": body.is_grandfathered,
    }


PRICE_BENCHMARKS = {
    "Personal care": {"median": 65.0, "cap": 90.00},
    "Domestic assistance": {"median": 58.0, "cap": 79.00},
    "Nursing": {"median": 145.0, "cap": 178.00},
    "Physiotherapy": {"median": 125.0, "cap": 156.00},
    "Cleaning": {"median": 55.0, "cap": 75.00},
    "Transport": {"median": 32.0, "cap": 48.00},
}


class PublicPriceBody(BaseModel):
    service: str
    rate: float


@api.post("/public/price-check")
async def public_price_check(body: PublicPriceBody):
    bench = PRICE_BENCHMARKS.get(body.service, {"median": body.rate, "cap": body.rate})
    median = bench["median"]
    cap = bench["cap"]
    delta_pct = ((body.rate - median) / median * 100) if median else 0.0
    if body.rate > cap:
        verdict, label = "high", "Above the 1 July 2026 cap"
        assessment = (
            f"At ${body.rate:.2f}/unit, this is above the published cap of ${cap:.2f}. "
            "From that date, providers cannot exceed the cap."
        )
        suggested = "Ask the provider for a corrected rate, or raise it with the Aged Care Quality and Safety Commission."
    elif body.rate > median * 1.10:
        verdict, label = "high", "Higher than the typical rate"
        assessment = f"At ${body.rate:.2f}/unit, that's about {delta_pct:.0f}% above the network median of ${median:.2f}."
        suggested = "Email the provider asking for a written explanation of the rate."
    elif body.rate < median * 0.85:
        verdict, label = "low", "Below the typical rate"
        assessment = f"At ${body.rate:.2f}/unit, this is below the network median of ${median:.2f}."
        suggested = None
    else:
        verdict, label = "fair", "About what you'd expect"
        assessment = f"At ${body.rate:.2f}/unit, you're within typical range (network median ${median:.2f})."
        suggested = None
    return {
        "service": body.service, "charged": body.rate, "median": median, "cap": cap,
        "delta_pct": round(delta_pct, 2), "verdict": verdict, "verdict_label": label,
        "assessment": assessment, "suggested_action": suggested,
    }


@api.get("/public/price-check/services")
async def public_price_services():
    return [{"name": k, "median": v["median"], "cap": v["cap"]} for k, v in PRICE_BENCHMARKS.items()]


class PublicClassificationBody(BaseModel):
    answers: List[int] = Field(min_length=12, max_length=12)
    current_classification: Optional[int] = None


@api.post("/public/classification-check")
async def public_classification_check(body: PublicClassificationBody):
    if not all(0 <= a <= 4 for a in body.answers):
        raise HTTPException(status_code=400, detail="Each answer must be 0–4")
    score = sum(body.answers)
    if score <= 6:
        low, high = 1, 2
    elif score <= 12:
        low, high = 2, 3
    elif score <= 18:
        low, high = 3, 4
    elif score <= 24:
        low, high = 4, 5
    elif score <= 30:
        low, high = 5, 6
    elif score <= 36:
        low, high = 6, 7
    else:
        low, high = 7, 8
    annual_low = budget_lib.CLASSIFICATIONS[low]["annual"]
    annual_high = budget_lib.CLASSIFICATIONS[high]["annual"]
    suggest = body.current_classification is not None and (
        body.current_classification < low or body.current_classification > high + 1
    )
    return {
        "score": score, "score_max": 48,
        "likely_low": low, "likely_high": high,
        "likely_label": f"Classification {low}" if low == high else f"Classification {low}–{high}",
        "annual_range": [annual_low, annual_high],
        "current_classification": body.current_classification,
        "suggest_reassessment": suggest,
        "caveat": "This is informational only. Only the My Aged Care Independent Assessment Tool determines the actual classification.",
    }


class PublicReassessmentBody(BaseModel):
    participant_name: str
    current_classification: int = Field(ge=1, le=8)
    changes_summary: str = Field(min_length=10, max_length=4000)
    recent_events: Optional[str] = None
    sender_name: str
    relationship: Optional[str] = "family caregiver"


@api.post("/public/reassessment-letter")
async def public_reassessment_letter(body: PublicReassessmentBody):
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="LLM unavailable")
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    system = (
        "You are a paperwork drafter for Australian Support at Home. Draft a polite, factual "
        "reassessment request letter to My Aged Care. Australian English. 250–400 words. "
        "Plain professional tone. Use the participant's name and the sender's name. Use "
        "gender-neutral language. Reference Aged Care Act 2024 framework where relevant. "
        "End with a specific request and a 14-day response timeframe. Output ONLY the letter "
        "body — no preamble, no markdown. NEVER claim a specific reassessment outcome — "
        "you ASK for reassessment, you don't predict its result."
    )
    user_msg = (
        f"Participant: {body.participant_name}\n"
        f"Current classification: Level {body.current_classification}\n"
        f"Sender: {body.sender_name} ({body.relationship or 'family caregiver'})\n\n"
        f"Changes since assessment:\n{body.changes_summary}\n\n"
        f"Recent events: {body.recent_events or '(none)'}"
    )
    chat_inst = LlmChat(
        api_key=api_key, session_id=f"reassess-{new_id()[:8]}", system_message=system
    ).with_model("anthropic", "claude-sonnet-4-5-20250929").with_params(max_tokens=1200)
    out = await chat_inst.send_message(UserMessage(text=user_msg))
    return {"letter": str(out or "")}


# ─────────────────── auth: emergent google session exchange ───────────────────
class GoogleSessionBody(BaseModel):
    session_id: str


@api.post("/auth/google-session", response_model=TokenResponse)
async def google_session(body: GoogleSessionBody):
    """Exchange Emergent OAuth session_id for a Wayly JWT."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=15) as client_http:
            r = await client_http.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": body.session_id},
            )
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        logger.warning("Emergent session exchange failed: %s", e)
        raise HTTPException(status_code=400, detail="Could not verify Google session — please try again.")

    email = (data.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Google did not return an email — please try again.")

    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user:
        new_user = {
            "id": new_id(),
            "email": email,
            "password_hash": "",  # google-only — no password login allowed
            "name": data.get("name") or email.split("@")[0],
            "role": "caregiver",
            "plan": "free",
            "household_id": None,
            "picture": data.get("picture"),
            "created_at": now_iso(),
            "auth_provider": "google",
        }
        await db.users.insert_one(new_user)
        user = new_user

    token = create_token(user["id"])
    return TokenResponse(token=token, user=_user_public(user))


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
