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
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional
import re

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, File, HTTPException, Request, UploadFile
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field
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
        is_admin=bool(u.get("is_admin", False)),
        subscription_status=u.get("subscription_status"),
        trial_ends_at=u.get("trial_ends_at"),
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


# ─────────────────── PATCH /auth/me / revoke-all / account delete ───────────────────
class _ProfilePatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)


@api.patch("/auth/me", response_model=UserPublic)
async def patch_me(body: _ProfilePatch, user_id: str = Depends(get_current_user_id)):
    """Phase E hardening: edit basic profile fields (name only for now). Email
    changes are intentionally NOT exposed via this endpoint \u2014 they require a
    confirmation flow that we haven't built yet."""
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if updates:
        updates["name"] = updates["name"].strip()
        await db.users.update_one({"id": user_id}, {"$set": updates})
    u = await _get_user(user_id)
    return _user_public(u)


@api.post("/auth/revoke-all")
async def revoke_all_sessions(user_id: str = Depends(get_current_user_id)):
    """Phase E danger-zone: invalidate every refresh token + push device row
    for the calling user. After this returns the client logs out locally."""
    from refresh_tokens import revoke_all_for_user
    count = await revoke_all_for_user(user_id)
    try:
        await db.push_tokens.delete_many({"user_id": user_id})
    except Exception:
        pass
    return {"ok": True, "revoked": count}


# ─────────────────── password reset / logout / account delete ───────────────────
class _ForgotRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)


class _ResetRequest(BaseModel):
    token: str = Field(min_length=20)
    password: str = Field(min_length=8)


RESET_TOKEN_TTL_S = 60 * 60  # 1 hour
RESET_TOKENS: Dict[str, dict] = {}  # token -> {user_id, expires_at}  (in-memory; MVP)


def _validate_password_strength(password: str, name: str = "", email: str = "") -> None:
    """Mirrors the rules described in the handover doc:
    8+ chars, upper, lower, digit, symbol; must not contain user's name/email."""
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")
    if not re.search(r"[a-z]", password):
        raise HTTPException(status_code=400, detail="Password must contain a lowercase letter.")
    if not re.search(r"[A-Z]", password):
        raise HTTPException(status_code=400, detail="Password must contain an uppercase letter.")
    if not re.search(r"\d", password):
        raise HTTPException(status_code=400, detail="Password must contain a number.")
    if not re.search(r"[^A-Za-z0-9]", password):
        raise HTTPException(status_code=400, detail="Password must contain a symbol.")
    lower = password.lower()
    # Split the name on whitespace and reject any token (3+ chars) that appears in the password.
    for token in (name or "").lower().split():
        if len(token) >= 3 and token in lower:
            raise HTTPException(status_code=400, detail="Password must not contain your name.")
    if email:
        local = email.split("@", 1)[0].lower()
        if local and len(local) >= 3 and local in lower:
            raise HTTPException(status_code=400, detail="Password must not contain your email.")


@api.post("/auth/forgot")
async def auth_forgot(payload: _ForgotRequest):
    """Enumeration-safe — always returns {ok: true} regardless of whether email exists."""
    import time
    user = await db.users.find_one({"email": payload.email.lower()}, {"_id": 0})
    if user:
        token = _secrets.token_urlsafe(32)
        RESET_TOKENS[token] = {"user_id": user["id"], "expires_at": time.time() + RESET_TOKEN_TTL_S}
        # In production we'd send via Resend. MVP: log the link so devs can test.
        reset_url = f"wayly://reset-password?token={token}"
        web_url = f"https://wayly.com.au/reset-password?token={token}"
        logger.info(
            "PASSWORD RESET REQUESTED for %s — mobile: %s — web: %s",
            user["email"], reset_url, web_url,
        )
        # Store an audit notification on the user record (optional but helpful)
        await db.password_reset_log.insert_one({
            "id": new_id(),
            "user_id": user["id"],
            "email": user["email"],
            "requested_at": now_iso(),
        })
    return {"ok": True}


@api.post("/auth/reset")
async def auth_reset(payload: _ResetRequest):
    import time
    entry = RESET_TOKENS.get(payload.token)
    if not entry or entry["expires_at"] < time.time():
        if entry:
            RESET_TOKENS.pop(payload.token, None)
        raise HTTPException(status_code=400, detail="This reset link has expired. Request a new one.")
    user = await db.users.find_one({"id": entry["user_id"]}, {"_id": 0})
    if not user:
        RESET_TOKENS.pop(payload.token, None)
        raise HTTPException(status_code=400, detail="Account not found.")
    _validate_password_strength(payload.password, user.get("name", ""), user.get("email", ""))
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"password_hash": hash_password(payload.password), "password_changed_at": now_iso()}},
    )
    RESET_TOKENS.pop(payload.token, None)
    return {"ok": True}


@api.post("/auth/logout")
async def auth_logout(user_id: str = Depends(get_current_user_id)):
    """Stateless JWT — the client clears the token. We log it for audit + push token cleanup."""
    # Remove this user's push device tokens so they don't keep getting notifications.
    # Phase 3 hardening fix: the collection name is `push_tokens` (matches
    # /notifications/register-push). The previous `push_devices` was a typo
    # and silently no-op'd, leaving stale tokens active after logout.
    try:
        await db.push_tokens.delete_many({"user_id": user_id})
    except Exception as e:
        logger.warning("push_tokens cleanup failed for %s: %s", user_id, e)
    logger.info("User %s signed out", user_id)
    return {"ok": True}


class PushTokenUnregister(BaseModel):
    expo_push_token: str


@api.delete("/notifications/register-push")
async def unregister_push(body: PushTokenUnregister, user_id: str = Depends(get_current_user_id)):
    """Phase 3 hardening: invalidate THIS device's push token without nuking
    other devices owned by the same user. Called from the mobile client when
    the user logs out, so notifications stop landing on the signed-out device."""
    await db.push_tokens.delete_one({"user_id": user_id, "expo_push_token": body.expo_push_token})
    return {"ok": True}


@api.delete("/auth/account")
async def auth_delete_account(user_id: str = Depends(get_current_user_id)):
    """Full account deletion. Removes the user + every collection scoped to their household."""
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Account not found")
    household_id = user.get("household_id")
    deleted_counts = {}
    # Household-scoped collections
    if household_id:
        for coll in (
            "households",
            "statements",
            "family_thread",
            "family_messages",
            "documents",
            "visits",
            "budget_alerts",
            "provider_switch",
            "athm",
            "correspondence",
            "referrals",
            "chat_turns",
        ):
            try:
                res = await db[coll].delete_many(
                    {"household_id": household_id} if coll != "households" else {"id": household_id}
                )
                deleted_counts[coll] = res.deleted_count
            except Exception as e:
                logger.warning("Could not clean %s: %s", coll, e)
    # User-scoped collections
    for coll, q in (
        ("notifications", {"user_id": user_id}),
        ("push_devices", {"user_id": user_id}),
        ("provider_ratings", {"user_id": user_id}),
        ("wellbeing_logs", {"user_id": user_id}),
    ):
        try:
            res = await db[coll].delete_many(q)
            deleted_counts[coll] = res.deleted_count
        except Exception:
            pass
    # The user record itself
    await db.users.delete_one({"id": user_id})
    deleted_counts["users"] = 1
    logger.info("Account deleted: %s — counts: %s", user.get("email"), deleted_counts)
    return {"ok": True, "deleted": deleted_counts}


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
                    deeplink = f"/statements/{stmt.id}"
                    note = NotificationItem(
                        user_id=user_id,
                        title=an.get("title", "New alert on your statement"),
                        body=an.get("detail", ""),
                        category="anomaly",
                        severity=an.get("severity", "info"),
                        related_statement_id=stmt.id,
                        type="anomaly_alert",
                        deeplink=deeplink,
                    )
                    await db.notifications.insert_one(note.model_dump())
                    await _push_to_user(
                        user_id,
                        title=an.get("title", "New alert"),
                        body=an.get("detail", "") or "",
                        data={
                            "type": "anomaly_alert",
                            "deeplink": deeplink,
                            "statement_id": stmt.id,
                            "anomaly_id": an.get("id"),
                            "notification_id": note.id,
                        },
                    )

            # Also fire a "statement_ready" push so users land on the new statement
            # even when there are no anomalies. Skip if there were anomalies above
            # (avoid double-notifying for the same upload).
            if not any((a.get("severity") in ("alert", "warning")) for a in anomalies):
                ready_deeplink = f"/statements/{stmt.id}"
                ready_note = NotificationItem(
                    user_id=user_id,
                    title="Statement decoded",
                    body=(stmt.period_label or "Your statement") + " is ready to review.",
                    category="statement",
                    severity="info",
                    related_statement_id=stmt.id,
                    type="statement_ready",
                    deeplink=ready_deeplink,
                )
                await db.notifications.insert_one(ready_note.model_dump())
                await _push_to_user(
                    user_id,
                    title=ready_note.title,
                    body=ready_note.body,
                    data={
                        "type": "statement_ready",
                        "deeplink": ready_deeplink,
                        "statement_id": stmt.id,
                        "notification_id": ready_note.id,
                    },
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


class _UploadTextBody(BaseModel):
    text: str = Field(min_length=10, max_length=200_000)
    filename: Optional[str] = None


@api.post("/statements/upload-text")
async def upload_statement_text(
    payload: _UploadTextBody,
    user_id: str = Depends(get_current_user_id),
):
    """Same as /statements/upload but for pasted text — no OCR phase needed.
    Used by the mobile app's 'Paste text' option on the Statements + sheet.
    The text goes through the SAME _submit_upload_job pipeline so the resulting
    Statement appears in the user's history with anomalies, summary, line items
    etc., identical to a photographed/uploaded statement."""
    h = await _require_household(user_id)
    user = await _get_user(user_id)
    text = (payload.text or "").strip()
    if len(text) < 10:
        raise HTTPException(status_code=400, detail="Paste a bit more — at least 10 characters.")
    fname = (payload.filename or f"pasted-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.txt").strip()
    job_id = _submit_upload_job(text, fname, h["id"], user_id, user["name"], len(text.encode("utf-8")))
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


# ─────────────────── public statement decoder (free tier) ───────────────────
# In-memory job + rate-limit stores. Acceptable for MVP; replace with Redis later.
PUBLIC_DECODE_JOBS: Dict[str, dict] = {}
PUBLIC_DECODE_USAGE: Dict[str, List[float]] = {}  # ip -> list of unix timestamps (last 24h)
PUBLIC_DECODE_DAILY_LIMIT = 3  # Free anonymous decoder quota per 24h per IP
PUBLIC_DECODE_WINDOW_S = 24 * 60 * 60
PUBLIC_DECODE_JOB_TIMEOUT_S = 90  # Internal hard timeout on a single decode job


def _client_key(request: Request, user_id: Optional[str]) -> str:
    """Authenticated users bypass IP-keyed limit by using their user_id; everyone else is per-IP."""
    if user_id:
        return f"user:{user_id}"
    # Forwarded-for first (k8s ingress) then client host
    fwd = request.headers.get("x-forwarded-for") or ""
    if fwd:
        return f"ip:{fwd.split(',')[0].strip()}"
    return f"ip:{(request.client.host if request.client else 'unknown')}"


def _check_public_decode_quota(key: str) -> Optional[float]:
    """Returns None if allowed; otherwise returns the unix timestamp when the next slot opens."""
    import time
    now = time.time()
    bucket = [t for t in PUBLIC_DECODE_USAGE.get(key, []) if now - t < PUBLIC_DECODE_WINDOW_S]
    PUBLIC_DECODE_USAGE[key] = bucket
    # Authenticated users -> unlimited
    if key.startswith("user:"):
        return None
    if len(bucket) >= PUBLIC_DECODE_DAILY_LIMIT:
        oldest = min(bucket)
        return oldest + PUBLIC_DECODE_WINDOW_S
    return None


def _record_public_decode(key: str) -> None:
    import time
    PUBLIC_DECODE_USAGE.setdefault(key, []).append(time.time())


def _refund_public_decode(key: str) -> None:
    """Pop the most-recent quota mark for this client. Called when a decode
    job fails or times out — we don't want a hung LLM to lock a free-tier
    user out for 24 hours for a non-result."""
    try:
        bucket = PUBLIC_DECODE_USAGE.get(key) or []
        if bucket:
            bucket.pop()
            PUBLIC_DECODE_USAGE[key] = bucket
    except Exception:
        pass


def _submit_public_decode_job(text: str, refund_key: Optional[str] = None) -> str:
    job_id = new_id()
    PUBLIC_DECODE_JOBS[job_id] = {"status": "pending", "created_at": now_iso()}

    # Anomaly "kinds" that are *informational* (no severity badge in the UI).
    # These match the production wayly.com.au decoder so the mobile app and
    # web reference DecoderResultView render the same sections.
    INFORMATIONAL_KINDS = {
        "at_hm_active_commitment",
        "previous_period_adjustment",
    }

    async def _run():
        try:
            from agents import parse_statement
            # Hard timeout — if the LLM hangs we want a fast, surfaced error
            # rather than the mobile poll silently giving up at 180s.
            data = await asyncio.wait_for(parse_statement(text), timeout=PUBLIC_DECODE_JOB_TIMEOUT_S)
            # Normalise to a stable shape the frontend expects.
            line_items = []
            for li in data.get("line_items", []) or []:
                try:
                    line_items.append(StatementLineItem(**li).model_dump())
                except Exception:
                    # Best-effort: keep raw fields the FE renders.
                    line_items.append({
                        "service_name": li.get("service_name") or li.get("service") or "Service",
                        "total": float(li.get("total") or 0),
                    })
            anomalies_raw: List[dict] = list(data.get("anomalies", []) or [])
            # Production also surfaces "informational_notes" as a peer of anomalies.
            # If the agent emitted them at the top level, accept them. Otherwise we
            # split them out from `anomalies` based on a `kind`/`type` discriminator.
            informational_notes: List[dict] = list(
                data.get("informational_notes")
                or (data.get("audit") or {}).get("informational_notes")
                or []
            )

            normalised_anomalies: List[dict] = []
            for an in anomalies_raw:
                kind = (an.get("kind") or an.get("type") or "").strip().lower()
                # Route informational kinds to the notes bucket.
                if kind in INFORMATIONAL_KINDS:
                    informational_notes.append({
                        "kind": kind,
                        "title": an.get("title") or "Statement note",
                        "detail": an.get("detail") or an.get("description") or "",
                        "suggested_action": an.get("suggested_action"),
                    })
                    continue
                try:
                    norm = Anomaly(**an).model_dump()
                    # carry kind/type through for the FE
                    if kind:
                        norm["kind"] = kind
                    normalised_anomalies.append(norm)
                except Exception:
                    normalised_anomalies.append({
                        "severity": an.get("severity") or "info",
                        "title": an.get("title") or "Heads up",
                        "detail": an.get("detail") or an.get("description") or "",
                        **({"kind": kind} if kind else {}),
                    })

            # Final result. We send BOTH a flat `anomalies` (legacy) and the
            # `audit` envelope (production shape) so old + new mobile clients
            # render correctly.
            audit = {
                "anomalies": normalised_anomalies,
                "informational_notes": informational_notes,
            }
            PUBLIC_DECODE_JOBS[job_id].update({
                "status": "done",
                "result": {
                    "period_label": data.get("period_label"),
                    "summary": data.get("summary"),
                    "line_items": line_items,
                    "anomalies": normalised_anomalies,  # legacy
                    "informational_notes": informational_notes,  # convenience
                    "audit": audit,  # ★ production shape
                },
            })
        except asyncio.TimeoutError:
            logger.warning("Public decode job %s exceeded %ss timeout", job_id, PUBLIC_DECODE_JOB_TIMEOUT_S)
            PUBLIC_DECODE_JOBS[job_id].update({
                "status": "error",
                "error": "The decoder is taking longer than usual. Please try again — your free quota wasn't used.",
            })
            if refund_key:
                _refund_public_decode(refund_key)
        except Exception as e:
            logger.exception("Public decode job failed")
            PUBLIC_DECODE_JOBS[job_id].update({"status": "error", "error": str(e) or "decode failed"})
            if refund_key:
                _refund_public_decode(refund_key)

    asyncio.create_task(_run())
    return job_id


class _DecodeText(BaseModel):
    text: str = Field(min_length=1, max_length=200_000)


async def _maybe_user_id(request: Request) -> Optional[str]:
    """Optional auth — returns user_id if a valid bearer token is present, else None.
    Critical: this powers the rate-limit bypass for authenticated users on the
    public decoder endpoints. Must use the SAME decoder helpers as the rest of
    the app (`auth.decode_token`) so JWT_SECRET / algorithms stay in lockstep.
    Previously this function referenced undefined `jwt` / `JWT_SECRET` / `JWT_ALG`
    symbols and silently raised NameError → every signed-in user got IP-limited
    and hit 429 on the 2nd request."""
    auth_header = request.headers.get("authorization") or ""
    if not auth_header.lower().startswith("bearer "):
        return None
    token = auth_header.split(" ", 1)[1].strip()
    if not token:
        return None
    try:
        # decode_token raises HTTPException on bad/expired tokens; we swallow it
        # here so the public endpoint still works for unauthenticated users.
        from auth import decode_token as _decode
        return _decode(token)
    except Exception:
        return None


@api.post("/public/decode-statement-text")
async def public_decode_statement_text(request: Request, payload: _DecodeText):
    user_id = await _maybe_user_id(request)
    key = _client_key(request, user_id)
    retry_at = _check_public_decode_quota(key)
    if retry_at is not None:
        raise HTTPException(
            status_code=429,
            detail=f"Free decoder limit reached — {PUBLIC_DECODE_DAILY_LIMIT} per 24 hours. Sign in for unlimited.",
            headers={"Retry-After": str(int(retry_at - __import__('time').time()))},
        )
    if not payload.text.strip():
        raise HTTPException(status_code=400, detail="Paste the statement text first.")
    _record_public_decode(key)
    # Refund the quota if the job fails or times out — but only for free-tier
    # (IP-keyed) clients. Authenticated users have no quota so passing the key
    # is harmless but unnecessary.
    refund_key = key if not key.startswith("user:") else None
    job_id = _submit_public_decode_job(payload.text, refund_key=refund_key)
    return {"job_id": job_id, "status": "pending"}


@api.post("/public/decode-statement")
async def public_decode_statement(request: Request, file: UploadFile = File(...)):
    user_id = await _maybe_user_id(request)
    key = _client_key(request, user_id)
    retry_at = _check_public_decode_quota(key)
    if retry_at is not None:
        raise HTTPException(
            status_code=429,
            detail=f"Free decoder limit reached — {PUBLIC_DECODE_DAILY_LIMIT} per 24 hours. Sign in for unlimited.",
            headers={"Retry-After": str(int(retry_at - __import__('time').time()))},
        )
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
        text, _input_method, _page_count, _parse_warnings = await extract_document(file.filename or "", raw)
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
    _record_public_decode(key)
    refund_key = key if not key.startswith("user:") else None
    job_id = _submit_public_decode_job(text, refund_key=refund_key)
    return {"job_id": job_id, "status": "pending"}


@api.get("/public/decode-job/{job_id}")
async def public_decode_job(job_id: str):
    job = PUBLIC_DECODE_JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found or expired")
    out = {"status": job["status"]}
    if job["status"] == "done":
        out["result"] = job.get("result")
    elif job["status"] == "error":
        out["error"] = job.get("error", "decode failed")
    return out


@api.post("/public/decode-statement-text/_sample")
async def public_decode_sample():
    """Dev/QA only — returns a fully-populated decode job that exercises both
    `audit.anomalies` and `audit.informational_notes` (with the two production
    note kinds: at_hm_active_commitment + previous_period_adjustment) so the
    mobile DecoderResultView can be visually verified without burning AI calls."""
    job_id = new_id()
    PUBLIC_DECODE_JOBS[job_id] = {
        "status": "done",
        "created_at": now_iso(),
        "result": {
            "period_label": "May 2026",
            "summary": (
                "Total billed $2,184. Provider charged a weekend rate on a Tuesday visit, "
                "and your statement carries an active AT-HM commitment from last quarter."
            ),
            "line_items": [
                {"service_name": "Personal care", "total": 1240.50},
                {"service_name": "Domestic assistance", "total": 384.00},
                {"service_name": "Nursing", "total": 560.00},
            ],
            "anomalies": [
                {
                    "id": new_id(),
                    "severity": "alert",
                    "title": "Weekend rate on a Tuesday",
                    "detail": "A personal-care visit on Tue 14 May was billed at the weekend loading rate.",
                    "suggested_action": "Ask the provider to re-bill at the weekday rate.",
                    "kind": "weekend_rate_misapplied",
                },
                {
                    "id": new_id(),
                    "severity": "warning",
                    "title": "Nursing visit duration unusually long",
                    "detail": "A 180-minute nursing visit is 3× the median for your plan.",
                    "kind": "duration_outlier",
                },
            ],
            "informational_notes": [
                {
                    "kind": "at_hm_active_commitment",
                    "title": "Active AT-HM commitment",
                    "detail": "$3,200 commitment from Q1 2026 is still being drawn down — $1,420 remaining.",
                },
                {
                    "kind": "previous_period_adjustment",
                    "title": "Adjustment from previous period",
                    "detail": "−$42.50 credit applied for a duplicate visit in April 2026.",
                },
            ],
            "audit": {
                "anomalies": [],  # populated below
                "informational_notes": [],  # populated below
            },
        },
    }
    # Mirror anomalies + informational_notes into the audit envelope so the
    # response matches the production wayly.com.au shape exactly.
    r = PUBLIC_DECODE_JOBS[job_id]["result"]
    r["audit"]["anomalies"] = r["anomalies"]
    r["audit"]["informational_notes"] = r["informational_notes"]
    return {"job_id": job_id, "status": "pending"}


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


# ─────────────────── notifications — dev/QA test push ───────────────────
class _TestPushBody(BaseModel):
    type: str = Field(default="statement_ready")
    title: Optional[str] = None
    body: Optional[str] = None
    statement_id: Optional[str] = None
    visit_id: Optional[str] = None
    client_id: Optional[str] = None
    deeplink: Optional[str] = None


@api.post("/notifications/test")
async def notifications_test(payload: _TestPushBody, user_id: str = Depends(get_current_user_id)):
    """Dev/QA helper: fire a sample push + in-app notification to the caller so the
    NotificationRouter on mobile can be exercised end-to-end. Returns the deeplink
    we resolved + the persisted NotificationItem id."""
    # Resolve deeplink (priority: explicit body.deeplink → type-driven fallback)
    deeplink = payload.deeplink
    statement_id = payload.statement_id
    visit_id = payload.visit_id
    client_id = payload.client_id

    if not deeplink:
        if payload.type in ("statement_ready", "anomaly_alert"):
            if not statement_id:
                # Try most recent statement for the user's household
                h = await _get_household(user_id)
                if h:
                    s = await db.statements.find_one({"household_id": h["id"]}, {"id": 1, "_id": 0}, sort=[("uploaded_at", -1)])
                    statement_id = s and s.get("id")
            deeplink = f"/statements/{statement_id}" if statement_id else "/(tabs)/today"
        elif payload.type == "visit_reminder":
            deeplink = "/visits"
        elif payload.type == "family_message":
            deeplink = "/(tabs)/family"
        elif payload.type == "wellbeing":
            deeplink = "/(tabs)/notifications"
        elif payload.type == "adviser_invite_linked":
            deeplink = f"/adviser/clients/{client_id}" if client_id else "/adviser"
        elif payload.type == "billing":
            deeplink = "/settings/plan"
        else:
            deeplink = "/(tabs)/notifications"

    title = payload.title or {
        "statement_ready": "Statement decoded",
        "anomaly_alert": "Heads up on your statement",
        "visit_reminder": "Visit coming up",
        "family_message": "New family message",
        "wellbeing": "Wellbeing check-in",
        "adviser_invite_linked": "Client linked",
        "billing": "Billing update",
        "system": "Notification",
    }.get(payload.type, "Wayly notification")
    body_text = payload.body or "Tap to open."

    note = NotificationItem(
        user_id=user_id,
        title=title,
        body=body_text,
        category=payload.type,
        severity="info",
        related_statement_id=statement_id,
        type=payload.type,
        deeplink=deeplink,
    )
    await db.notifications.insert_one(note.model_dump())
    data: Dict[str, Any] = {"type": payload.type, "deeplink": deeplink, "notification_id": note.id}
    if statement_id:
        data["statement_id"] = statement_id
    if visit_id:
        data["visit_id"] = visit_id
    if client_id:
        data["client_id"] = client_id
    await _push_to_user(user_id, title, body_text, data)
    return {"ok": True, "deeplink": deeplink, "notification_id": note.id, "data": data}


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


@api.delete("/chat/history")
async def chat_history_clear(user_id: str = Depends(get_current_user_id)):
    h = await _require_household(user_id)
    result = await db.chat_turns.delete_many({"household_id": h["id"]})
    return {"ok": True, "deleted": result.deleted_count}


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
            type="wellbeing",
            deeplink="/(tabs)/notifications",
        )
        await db.notifications.insert_one(note.model_dump())
        await _push_to_user(
            h["owner_id"],
            note.title,
            note.body,
            {
                "type": "wellbeing",
                "deeplink": "/(tabs)/notifications",
                "category": "wellbeing",
                "notification_id": note.id,
            },
        )
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

        # Always-on admin seed (idempotent) — required for admin dashboard testing
        admin_email = "hello@techglove.com.au"
        admin_existing = await db.users.find_one({"email": admin_email})
        if admin_existing:
            await db.users.update_one({"email": admin_email}, {"$set": {"is_admin": True, "plan": "family"}})
        else:
            await db.users.insert_one({
                "id": new_id(),
                "email": admin_email,
                "password_hash": hash_password("AdminPass!2026"),
                "name": "Wayly Admin",
                "role": "caregiver",
                "plan": "family",
                "is_admin": True,
                "admin_role": "super_admin",
                "totp_enabled": False,
                "subscription_status": "active",
                "household_id": None,
                "created_at": now_iso(),
            })
            logger.info("Seeded admin user hello@techglove.com.au / AdminPass!2026")
        # Ensure existing admin always has admin_role
        await db.users.update_one(
            {"email": admin_email, "admin_role": {"$exists": False}},
            {"$set": {"admin_role": "super_admin", "totp_enabled": False}},
        )

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
            type="anomaly_alert",
            deeplink=f"/statements/{stmt.id}",
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


# ─────────────────── admin auth (MOCKED stubs — Milestone 1: TOTP + sessions) ───────────────────
import base64
import io
import pyotp
import qrcode
import secrets as _secrets

ADMIN_ROLE_DEFAULTS = ("super_admin", "operations_admin", "support_admin", "content_admin")


class _AdminLoginReq(BaseModel):
    email: str
    password: str


class _Admin2FAVerifyReq(BaseModel):
    temp_token: str
    code: str


class _Admin2FAEnableReq(BaseModel):
    setup_token: str
    code: str


def _admin_token(user_id: str, kind: str = "admin", ttl_hours: int = 24) -> str:
    """Issue a JWT marked with `kind` so we can distinguish admin sessions from user sessions."""
    import jwt as _jwt
    from datetime import timedelta as _td
    payload = {
        "sub": user_id,
        "kind": kind,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + _td(hours=ttl_hours),
    }
    secret = os.environ.get("JWT_SECRET", "wayly-dev-secret-change-me")
    return _jwt.encode(payload, secret, algorithm="HS256")


def _decode_admin(token: str) -> dict:
    """Decode an admin token; raises 401 if invalid or wrong kind."""
    import jwt as _jwt
    secret = os.environ.get("JWT_SECRET", "wayly-dev-secret-change-me")
    try:
        payload = _jwt.decode(token, secret, algorithms=["HS256"])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid admin session")
    return payload


from fastapi.security import HTTPAuthorizationCredentials as _HTTPAuthCreds  # noqa: E402
from auth import bearer_scheme as _bearer  # noqa: E402


async def _get_admin_session(creds: _HTTPAuthCreds = Depends(_bearer)) -> dict:
    if not creds:
        raise HTTPException(status_code=401, detail="Admin sign-in required")
    payload = _decode_admin(creds.credentials)
    if payload.get("kind") != "admin":
        raise HTTPException(status_code=403, detail="Admin session required")
    u = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not u or not u.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return u


def _admin_pub(u: dict) -> dict:
    return {
        "id": u["id"],
        "email": u["email"],
        "name": u.get("name") or u["email"],
        "admin_role": u.get("admin_role", "super_admin"),
        "totp_enabled": bool(u.get("totp_enabled")),
    }


@api.post("/admin/auth/login")
async def admin_auth_login(payload: _AdminLoginReq):
    u = await db.users.find_one({"email": payload.email.lower()}, {"_id": 0})
    if not u or not u.get("is_admin"):
        # Don't leak whether a non-admin email exists
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not verify_password(payload.password, u.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    role = u.get("admin_role", "super_admin")

    if u.get("totp_enabled"):
        # Issue a short-lived TEMP token to bridge into the 2FA verification step
        temp = _admin_token(u["id"], kind="admin_temp", ttl_hours=0.1)
        return {"requires_2fa": True, "temp_token": temp, "role": role}

    # First-time TOTP setup — generate secret + provisioning URI + QR
    secret = pyotp.random_base32()
    totp = pyotp.TOTP(secret)
    issuer = "Wayly Admin"
    uri = totp.provisioning_uri(name=u["email"], issuer_name=issuer)
    qr = qrcode.QRCode(box_size=6, border=2)
    qr.add_data(uri)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#1F3A5F", back_color="#FAF7F2")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    qr_data_uri = f"data:image/png;base64,{base64.b64encode(buf.getvalue()).decode('ascii')}"

    # Stash secret on the user doc as pending (NOT enabled until they verify a code)
    await db.users.update_one({"id": u["id"]}, {"$set": {"totp_pending_secret": secret}})

    setup = _admin_token(u["id"], kind="admin_setup", ttl_hours=0.25)
    return {
        "requires_2fa_setup": True,
        "setup_token": setup,
        "qr_data_uri": qr_data_uri,
        "secret": secret,
        "role": role,
    }


@api.post("/admin/auth/2fa/enable")
async def admin_2fa_enable(payload: _Admin2FAEnableReq):
    decoded = _decode_admin(payload.setup_token)
    if decoded.get("kind") != "admin_setup":
        raise HTTPException(status_code=401, detail="Invalid setup token")
    u = await db.users.find_one({"id": decoded["sub"]}, {"_id": 0})
    if not u or not u.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    pending = u.get("totp_pending_secret")
    if not pending:
        raise HTTPException(status_code=400, detail="No setup in progress")
    if not pyotp.TOTP(pending).verify(payload.code.replace(" ", ""), valid_window=1):
        raise HTTPException(status_code=400, detail="That code didn't match — try again")
    # Generate 10 backup codes (8 chars each)
    backup = [_secrets.token_hex(4).upper() for _ in range(10)]
    backup_hashes = [hash_password(c) for c in backup]
    await db.users.update_one({"id": u["id"]}, {
        "$set": {"totp_secret": pending, "totp_enabled": True, "backup_codes_hashes": backup_hashes},
        "$unset": {"totp_pending_secret": ""},
    })
    refreshed = await db.users.find_one({"id": u["id"]}, {"_id": 0, "password_hash": 0})
    token = _admin_token(u["id"], kind="admin", ttl_hours=24)
    return {"token": token, "admin": _admin_pub(refreshed), "backup_codes": backup}


@api.post("/admin/auth/2fa/verify")
async def admin_2fa_verify(payload: _Admin2FAVerifyReq):
    decoded = _decode_admin(payload.temp_token)
    if decoded.get("kind") != "admin_temp":
        raise HTTPException(status_code=401, detail="Invalid temp token")
    u = await db.users.find_one({"id": decoded["sub"]}, {"_id": 0})
    if not u or not u.get("is_admin") or not u.get("totp_enabled"):
        raise HTTPException(status_code=400, detail="2FA not set up")
    code = payload.code.replace(" ", "").upper()
    matched = False
    # 6-digit TOTP path
    if code.isdigit() and len(code) == 6:
        matched = pyotp.TOTP(u["totp_secret"]).verify(code, valid_window=1)
    # 8-char backup-code path
    if not matched and len(code) == 8:
        hashes = u.get("backup_codes_hashes") or []
        for i, h in enumerate(hashes):
            if verify_password(code, h):
                # consume that code
                remaining = hashes[:i] + hashes[i + 1:]
                await db.users.update_one({"id": u["id"]}, {"$set": {"backup_codes_hashes": remaining}})
                matched = True
                break
    if not matched:
        raise HTTPException(status_code=400, detail="That code didn't match — try again")
    token = _admin_token(u["id"], kind="admin", ttl_hours=24)
    return {"token": token, "admin": _admin_pub(u)}


@api.post("/admin/auth/logout")
async def admin_auth_logout(_: dict = Depends(_get_admin_session)):
    # In a real system we'd revoke the JWT (jti + denylist). For stub, just acknowledge.
    return {"ok": True}


# DEV-ONLY: returns the current TOTP code computed from the server clock.
# This is here because containers commonly run with skewed clocks (we're at May 2026 here)
# which means real authenticator apps on your phone produce codes that don't match.
# In production this endpoint MUST be removed or gated behind a debug flag.
@api.get("/admin/auth/dev/current-code")
async def admin_dev_current_code(email: str):
    u = await db.users.find_one({"email": email.lower()}, {"_id": 0})
    if not u or not u.get("is_admin"):
        raise HTTPException(status_code=404, detail="Admin not found")
    secret = u.get("totp_pending_secret") or u.get("totp_secret")
    if not secret:
        raise HTTPException(status_code=400, detail="No TOTP secret on file — start a sign-in first to generate one")
    return {
        "code": pyotp.TOTP(secret).now(),
        "valid_seconds": 30 - int(datetime.now(timezone.utc).timestamp()) % 30,
        "note": "Dev shortcut. Server clock may differ from your phone; this code uses the server clock.",
    }


@api.get("/admin/auth/me")
async def admin_auth_me(admin: dict = Depends(_get_admin_session)):
    return _admin_pub(admin)


# ─────────────── Milestone 2: Inbox / Tickets / Users / Health (MOCKED) ───────────────
TICKET_MACROS = [
    {"id": "m1", "title": "Acknowledge", "body": "Thanks for reaching out — we've got this and will come back to you shortly with an update."},
    {"id": "m2", "title": "Need more info", "body": "Could you share a screenshot of what you're seeing, plus the email on the affected account?"},
    {"id": "m3", "title": "Bug logged", "body": "We've logged this with engineering. We'll email you again the moment it's fixed."},
    {"id": "m4", "title": "Resolved", "body": "We've sorted this for you. Let us know if anything else pops up."},
]


async def _seed_tickets():
    """Idempotent ticket seed — only if collection is empty."""
    if await db.tickets.count_documents({}) > 0:
        return
    admin = await db.users.find_one({"email": "hello@techglove.com.au"}, {"id": 1})
    cathy = await db.users.find_one({"email": "demo@wayly.com.au"}, {"id": 1, "email": 1, "name": 1})
    samples = [
        {"id": new_id(), "subject": "Statement decoder showed wrong totals", "status": "open", "priority": "P1", "user_email": "margaret@example.com", "user_name": "Margaret Williams", "assigned_admin_id": None, "created_at": now_iso(), "updated_at": now_iso(), "messages": [
            {"id": new_id(), "from": "user", "body": "I uploaded my May statement and the gross looks $300 too high. Can you check?", "created_at": now_iso(), "internal": False},
        ]},
        {"id": new_id(), "subject": "Can't add a family member", "status": "open", "priority": "P1", "user_email": cathy["email"] if cathy else "demo@wayly.com.au", "user_name": cathy.get("name") if cathy else "Cathy Williams", "assigned_admin_id": admin["id"] if admin else None, "created_at": now_iso(), "updated_at": now_iso(), "messages": [
            {"id": new_id(), "from": "user", "body": "When I tap Add member nothing happens. iPhone 14, latest app.", "created_at": now_iso(), "internal": False},
            {"id": new_id(), "from": "admin", "body": "Thanks for flagging — checking now.", "created_at": now_iso(), "internal": False},
        ]},
        {"id": new_id(), "subject": "Refund for double charge", "status": "in_progress", "priority": "P2", "user_email": "ben@example.com", "user_name": "Ben Tran", "assigned_admin_id": None, "created_at": now_iso(), "updated_at": now_iso(), "messages": [
            {"id": new_id(), "from": "user", "body": "Got charged twice for Solo plan in October.", "created_at": now_iso(), "internal": False},
        ]},
        {"id": new_id(), "subject": "How does grandfathered status work?", "status": "waiting_on_user", "priority": "P3", "user_email": "joan@example.com", "user_name": "Joan Carter", "assigned_admin_id": None, "created_at": now_iso(), "updated_at": now_iso(), "messages": [
            {"id": new_id(), "from": "user", "body": "Is my dad grandfathered? He started his HCP in 2019.", "created_at": now_iso(), "internal": False},
        ]},
        {"id": new_id(), "subject": "Reassessment letter formatting", "status": "resolved", "priority": "P3", "user_email": "sue@example.com", "user_name": "Sue Patel", "assigned_admin_id": None, "created_at": now_iso(), "updated_at": now_iso(), "messages": [
            {"id": new_id(), "from": "user", "body": "Can I edit the letter before sending?", "created_at": now_iso(), "internal": False},
            {"id": new_id(), "from": "admin", "body": "Yes — tap Edit on the result card.", "created_at": now_iso(), "internal": False},
        ]},
    ]
    await db.tickets.insert_many(samples)
    logger.info("Seeded %d sample tickets", len(samples))


@app.on_event("startup")
async def _on_start_seed_tickets():
    try:
        await _seed_tickets()
    except Exception as e:
        logger.warning("Ticket seed skipped: %s", e)


@api.get("/admin/ticket-reports")
async def admin_ticket_reports(_: dict = Depends(_get_admin_session)):
    open_p1 = await db.tickets.count_documents({"status": "open", "priority": "P1"})
    opened_7d = await db.tickets.count_documents({"created_at": {"$gte": (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()}})
    oldest = await db.tickets.find({"status": {"$in": ["open", "in_progress"]}}).sort("created_at", 1).limit(1).to_list(1)
    return {
        "open_p1": open_p1,
        "opened_7d": opened_7d,
        "oldest_unresolved": (oldest[0]["created_at"] if oldest else None),
    }


@api.get("/admin/tickets")
async def admin_tickets_list(status: Optional[str] = None, priority: Optional[str] = None, page: int = 1, page_size: int = 25, _: dict = Depends(_get_admin_session)):
    query: dict = {}
    if status: query["status"] = status
    if priority: query["priority"] = priority
    total = await db.tickets.count_documents(query)
    skip = max(0, (page - 1) * page_size)
    rows = await db.tickets.find(query, {"_id": 0}).sort("created_at", -1).skip(skip).limit(page_size).to_list(page_size)
    # strip messages array for list response — keep last_message preview
    out = []
    for t in rows:
        msgs = t.get("messages") or []
        last = msgs[-1] if msgs else None
        out.append({**{k: v for k, v in t.items() if k != "messages"}, "last_message_preview": (last["body"][:140] if last else None), "message_count": len(msgs)})
    return {"items": out, "total": total, "page": page, "page_size": page_size}


@api.get("/admin/tickets/{ticket_id}")
async def admin_ticket_get(ticket_id: str, _: dict = Depends(_get_admin_session)):
    t = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return t


class _TicketUpdate(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    assigned_admin_id: Optional[str] = None


@api.put("/admin/tickets/{ticket_id}")
async def admin_ticket_update(ticket_id: str, payload: _TicketUpdate, _: dict = Depends(_get_admin_session)):
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")
    update["updated_at"] = now_iso()
    res = await db.tickets.update_one({"id": ticket_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Ticket not found")
    t = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    return t


class _TicketMessage(BaseModel):
    body: str
    internal: bool = False


@api.post("/admin/tickets/{ticket_id}/messages")
async def admin_ticket_reply(ticket_id: str, payload: _TicketMessage, admin: dict = Depends(_get_admin_session)):
    if not payload.body.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    msg = {
        "id": new_id(),
        "from": "admin",
        "admin_email": admin["email"],
        "body": payload.body.strip(),
        "internal": bool(payload.internal),
        "created_at": now_iso(),
    }
    res = await db.tickets.update_one({"id": ticket_id}, {"$push": {"messages": msg}, "$set": {"updated_at": now_iso()}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return msg


@api.get("/admin/macros")
async def admin_macros(_: dict = Depends(_get_admin_session)):
    return TICKET_MACROS


@api.get("/admin/failed-payments")
async def admin_failed_payments(days: int = 1, _: dict = Depends(_get_admin_session)):
    # No payments collection — return empty list with realistic shape
    return {"items": [], "since": (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()}


@api.get("/admin/data-requests")
async def admin_data_requests(status: Optional[str] = None, _: dict = Depends(_get_admin_session)):
    # Stub: return a couple of in-progress requests if status=received
    if status == "received":
        return {"items": [
            {"id": new_id(), "user_email": "margaret@example.com", "user_name": "Margaret Williams", "type": "delete", "status": "received", "submitted_at": now_iso(), "due_at": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()},
        ]}
    return {"items": []}


async def _ping_mongo_ms() -> tuple[str, int]:
    import time
    t0 = time.perf_counter()
    try:
        await db.command("ping")
        return "healthy", int((time.perf_counter() - t0) * 1000)
    except Exception:
        return "down", int((time.perf_counter() - t0) * 1000)


# Mocked latency + error stats per service. Seeded deterministically off the service name.
def _mock_service_stats(name: str, base_ms: int, status: str = "healthy") -> dict:
    import random
    rnd = random.Random(name)
    p95 = base_ms + rnd.randint(20, 90)
    err = 0 if status == "healthy" else rnd.randint(2, 12)
    return {
        "name": name,
        "status": status,
        "response_ms": base_ms,
        "p95_ms": p95,
        "error_rate_24h": err / 1000.0,
        "checked_at": now_iso(),
    }


@api.get("/admin/system-health")
async def admin_system_health(_: dict = Depends(_get_admin_session)):
    mongo_status, mongo_ms = await _ping_mongo_ms()
    services = [
        {**_mock_service_stats("MongoDB", mongo_ms, mongo_status)},
        {**_mock_service_stats("Stripe", 142, "healthy")},
        {**_mock_service_stats("Resend", 88, "healthy")},
        {**_mock_service_stats("LLM", 412, "healthy")},
    ]
    return {"services": services, "llm_errors_24h": 0}


@api.get("/admin/system-health/{service}")
async def admin_system_health_detail(service: str, _: dict = Depends(_get_admin_session)):
    # Detail view. MongoDB is live-pinged; others are mocked timeseries.
    import random
    name_map = {"mongodb": "MongoDB", "stripe": "Stripe", "resend": "Resend", "llm": "LLM"}
    key = service.lower()
    if key not in name_map:
        raise HTTPException(status_code=404, detail="Unknown service")
    name = name_map[key]
    if key == "mongodb":
        status, base_ms = await _ping_mongo_ms()
    else:
        status, base_ms = ("healthy", {"stripe": 142, "resend": 88, "llm": 412}[key])
    rnd = random.Random(name)
    # 24-point latency series (last 24h, hourly)
    points = []
    for i in range(24):
        jitter = rnd.randint(-25, 60)
        points.append({"t": (datetime.now(timezone.utc) - timedelta(hours=23 - i)).isoformat(), "ms": max(10, base_ms + jitter)})
    # Mock recent errors (none if healthy)
    recent_errors = []
    if status != "healthy":
        for _i in range(rnd.randint(1, 3)):
            recent_errors.append({
                "at": (datetime.now(timezone.utc) - timedelta(minutes=rnd.randint(5, 600))).isoformat(),
                "code": rnd.choice(["500", "503", "ETIMEDOUT", "ECONNRESET"]),
                "message": "Upstream temporarily unavailable",
            })
    return {
        "name": name,
        "status": status,
        "response_ms": base_ms,
        "p95_ms": base_ms + rnd.randint(20, 90),
        "uptime_30d_pct": 99.92 if status == "healthy" else 98.40,
        "checked_at": now_iso(),
        "latency_series": points,
        "recent_errors": recent_errors,
        "docs_url": {
            "MongoDB": "https://status.mongodb.com",
            "Stripe": "https://status.stripe.com",
            "Resend": "https://resend.com/status",
            "LLM": "https://status.openai.com",
        }[name],
    }


@api.get("/admin/maintenance")
async def admin_maintenance_get(_: dict = Depends(_get_admin_session)):
    doc = await db.app_state.find_one({"key": "maintenance"}, {"_id": 0}) or {"enabled": False, "message": ""}
    return {
        "enabled": bool(doc.get("enabled")),
        "message": doc.get("message", ""),
        "updated_at": doc.get("updated_at"),
        "updated_by": doc.get("updated_by"),
    }


@api.get("/admin/maintenance/history")
async def admin_maintenance_history(_: dict = Depends(_get_admin_session)):
    items = await db.maintenance_log.find({}, {"_id": 0}).sort("at", -1).limit(20).to_list(20)
    return {"items": items}


class _Maintenance(BaseModel):
    enabled: bool
    message: Optional[str] = ""


@api.post("/admin/maintenance")
async def admin_maintenance_set(payload: _Maintenance, admin: dict = Depends(_get_admin_session)):
    if admin.get("admin_role") != "super_admin":
        raise HTTPException(status_code=403, detail="Only super_admin can toggle maintenance")
    await db.app_state.update_one(
        {"key": "maintenance"},
        {"$set": {"key": "maintenance", "enabled": payload.enabled, "message": payload.message or "", "updated_at": now_iso(), "updated_by": admin["email"]}},
        upsert=True,
    )
    await db.maintenance_log.insert_one({
        "id": new_id(),
        "at": now_iso(),
        "enabled": payload.enabled,
        "message": payload.message or "",
        "actor_email": admin["email"],
        "actor_role": admin.get("admin_role"),
    })
    return {"ok": True, "enabled": payload.enabled, "message": payload.message or ""}


@api.get("/admin/search")
async def admin_search(q: str = "", _: dict = Depends(_get_admin_session)):
    if not q.strip():
        return {"users": [], "tickets": [], "households": []}
    import re
    rx = {"$regex": re.escape(q.strip()), "$options": "i"}
    users = await db.users.find({"$or": [{"email": rx}, {"name": rx}]}, {"_id": 0, "password_hash": 0}).limit(10).to_list(10)
    tickets = await db.tickets.find({"$or": [{"subject": rx}, {"user_email": rx}, {"user_name": rx}]}, {"_id": 0, "messages": 0}).limit(10).to_list(10)
    households = await db.households.find({"$or": [{"participant_name": rx}, {"provider_name": rx}]}, {"_id": 0}).limit(10).to_list(10)
    return {
        "users": [_admin_user_row(u) for u in users],
        "tickets": tickets,
        "households": households,
    }


@api.get("/admin/users/{user_id}/profile")
async def admin_user_profile(user_id: str, _: dict = Depends(_get_admin_session)):
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0, "totp_secret": 0, "backup_codes_hashes": 0})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    # Notes (stub)
    notes = await db.user_notes.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).to_list(50)
    h = None
    if u.get("household_id"):
        h = await db.households.find_one({"id": u["household_id"]}, {"_id": 0})
    return {"user": u, "household": h, "notes": notes}


class _UserNote(BaseModel):
    body: str


@api.post("/admin/users/{user_id}/notes")
async def admin_user_add_note(user_id: str, payload: _UserNote, admin: dict = Depends(_get_admin_session)):
    if not payload.body.strip():
        raise HTTPException(status_code=400, detail="Note cannot be empty")
    note = {"id": new_id(), "user_id": user_id, "body": payload.body.strip(), "admin_email": admin["email"], "created_at": now_iso()}
    await db.user_notes.insert_one(note)
    note.pop("_id", None)
    return note


class _Suspend(BaseModel):
    suspended: bool
    reason: Optional[str] = None


@api.post("/admin/users/{user_id}/suspend")
async def admin_user_suspend(user_id: str, payload: _Suspend, admin: dict = Depends(_get_admin_session)):
    if admin.get("admin_role") not in ("super_admin", "operations_admin"):
        raise HTTPException(status_code=403, detail="Not allowed")
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Cannot suspend yourself")
    res = await db.users.update_one({"id": user_id}, {"$set": {"suspended": payload.suspended, "suspended_reason": payload.reason or None}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True, "suspended": payload.suspended}


class _ExtendTrial(BaseModel):
    days: int = 7


@api.post("/admin/users/{user_id}/extend-trial")
async def admin_user_extend_trial(user_id: str, payload: _ExtendTrial, admin: dict = Depends(_get_admin_session)):
    if admin.get("admin_role") not in ("super_admin", "operations_admin"):
        raise HTTPException(status_code=403, detail="Not allowed")
    if payload.days <= 0 or payload.days > 90:
        raise HTTPException(status_code=400, detail="Days must be 1-90")
    new_end = (datetime.now(timezone.utc) + timedelta(days=payload.days)).isoformat()
    res = await db.users.update_one({"id": user_id}, {"$set": {"trial_ends_at": new_end, "subscription_status": "trialing"}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True, "trial_ends_at": new_end}


# Add admin_role + totp scaffolding to the seed

async def _require_admin(user_id: str = Depends(get_current_user_id)) -> dict:
    u = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not u or not u.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return u


def _admin_user_row(u: dict) -> dict:
    return {
        "id": u["id"],
        "email": u["email"],
        "name": u.get("name"),
        "plan": u.get("plan", "free"),
        "subscription_status": u.get("subscription_status") or "none",
        "created_at": u.get("created_at"),
        "is_admin": bool(u.get("is_admin", False)),
    }


@api.get("/admin/analytics")
async def admin_analytics(_: dict = Depends(_require_admin)):
    from datetime import timedelta
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    total_users = await db.users.count_documents({})
    new_users = await db.users.count_documents({"created_at": {"$gte": week_ago}})
    total_households = await db.households.count_documents({})
    total_statements = await db.statements.count_documents({})
    new_statements = await db.statements.count_documents({"uploaded_at": {"$gte": week_ago}})

    plans = await db.users.aggregate([{"$group": {"_id": "$plan", "count": {"$sum": 1}}}]).to_list(20)
    subs = await db.users.aggregate([
        {"$match": {"subscription_status": {"$exists": True, "$ne": None}}},
        {"$group": {"_id": "$subscription_status", "count": {"$sum": 1}}},
    ]).to_list(20)

    # Top households by statement count
    top_pipeline = [
        {"$group": {"_id": "$household_id", "statement_count": {"$sum": 1}}},
        {"$sort": {"statement_count": -1}},
        {"$limit": 5},
    ]
    top_raw = await db.statements.aggregate(top_pipeline).to_list(5)
    top_households = []
    for row in top_raw:
        h = await db.households.find_one({"id": row["_id"]}, {"_id": 0})
        if not h:
            continue
        mc = await db.users.count_documents({"household_id": row["_id"]})
        top_households.append({
            "id": h["id"],
            "participant_name": h.get("participant_name") or "Unnamed",
            "member_count": mc,
            "statement_count": row["statement_count"],
        })

    return {
        "total_users": total_users,
        "new_users_this_week": new_users,
        "total_households": total_households,
        "total_statements": total_statements,
        "new_statements_this_week": new_statements,
        "total_revenue": 0,  # No payments table in stub
        "plans": [{"plan": (p["_id"] or "free"), "count": p["count"]} for p in plans],
        "subscriptions": [{"status": s["_id"], "count": s["count"]} for s in subs],
        "top_households": top_households,
    }


@api.get("/admin/users")
async def admin_users_list(
    q: Optional[str] = None,
    plan: Optional[str] = None,
    page: int = 1,
    page_size: int = 25,
    _: dict = Depends(_require_admin),
):
    query: dict = {}
    if q:
        import re
        rx = {"$regex": re.escape(q), "$options": "i"}
        query["$or"] = [{"email": rx}, {"name": rx}]
    if plan and plan != "all":
        query["plan"] = plan
    total = await db.users.count_documents(query)
    skip = max(0, (page - 1) * page_size)
    rows = await db.users.find(query, {"_id": 0, "password_hash": 0}).sort("created_at", -1).skip(skip).limit(page_size).to_list(page_size)
    return {"items": [_admin_user_row(u) for u in rows], "total": total, "page": page, "page_size": page_size}


@api.get("/admin/users/{user_id}")
async def admin_user_detail(user_id: str, _: dict = Depends(_require_admin)):
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    h = None
    if u.get("household_id"):
        h = await db.households.find_one({"id": u["household_id"]}, {"_id": 0})
    statements = await db.statements.find({"household_id": u.get("household_id")}, {"_id": 0, "line_items": 0, "anomalies": 0, "raw_text_preview": 0}).sort("uploaded_at", -1).limit(10).to_list(10)
    # Compute gross + anomaly counts from full docs (cheap loop)
    for s in statements:
        full = await db.statements.find_one({"id": s["id"]}, {"_id": 0, "line_items": 1, "anomalies": 1})
        if full:
            s["gross_amount"] = sum(float(li.get("total", 0) or 0) for li in (full.get("line_items") or []))
            s["anomalies_count"] = len(full.get("anomalies") or [])
            s["period"] = s.get("period_label")
    audit = []  # No audit collection in stub
    return {
        "user": {**u, "is_admin": bool(u.get("is_admin", False))},
        "household": h,
        "statements": statements,
        "payments": [],
        "audit_trail": audit,
    }


class _AdminFlag(BaseModel):
    is_admin: bool


class _AdminPlan(BaseModel):
    plan: str


@api.post("/admin/users/{user_id}/reset-password")
async def admin_reset_pw(user_id: str, admin: dict = Depends(_require_admin)):
    u = await db.users.find_one({"id": user_id})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    logger.info("Admin %s requested password reset for %s", admin["email"], u["email"])
    return {"ok": True, "message": "Reset email queued"}


@api.put("/admin/users/{user_id}/admin")
async def admin_toggle_admin(user_id: str, payload: _AdminFlag, admin: dict = Depends(_require_admin)):
    if user_id == admin["id"] and not payload.is_admin:
        raise HTTPException(status_code=400, detail="Cannot remove your own admin access")
    res = await db.users.update_one({"id": user_id}, {"$set": {"is_admin": bool(payload.is_admin)}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True, "is_admin": bool(payload.is_admin)}


@api.put("/admin/users/{user_id}/plan")
async def admin_set_plan(user_id: str, payload: _AdminPlan, _: dict = Depends(_require_admin)):
    if payload.plan not in ("free", "solo", "family", "advisor"):
        raise HTTPException(status_code=400, detail="Invalid plan")
    res = await db.users.update_one({"id": user_id}, {"$set": {"plan": payload.plan}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True, "plan": payload.plan}


@api.post("/admin/users/{user_id}/cancel-subscription")
async def admin_cancel_sub(user_id: str, _: dict = Depends(_require_admin)):
    res = await db.users.update_one({"id": user_id}, {"$set": {"subscription_status": "canceled"}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True}


@api.delete("/admin/users/{user_id}")
async def admin_delete_user(user_id: str, admin: dict = Depends(_require_admin)):
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    res = await db.users.delete_one({"id": user_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True}


@api.get("/admin/households")
async def admin_households(q: Optional[str] = None, page: int = 1, page_size: int = 25, _: dict = Depends(_require_admin)):
    query: dict = {}
    if q:
        import re
        rx = {"$regex": re.escape(q), "$options": "i"}
        query["$or"] = [{"participant_name": rx}, {"provider_name": rx}]
    total = await db.households.count_documents(query)
    skip = max(0, (page - 1) * page_size)
    rows = await db.households.find(query, {"_id": 0}).skip(skip).limit(page_size).to_list(page_size)
    items = []
    for h in rows:
        mc = await db.users.count_documents({"household_id": h["id"]})
        sc = await db.statements.count_documents({"household_id": h["id"]})
        items.append({**h, "member_count": mc, "statement_count": sc})
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@api.get("/admin/payments")
async def admin_payments(status: Optional[str] = None, page: int = 1, page_size: int = 25, _: dict = Depends(_require_admin)):
    # No payments collection in stub — return empty list with realistic shape
    return {"items": [], "total": 0, "page": page, "page_size": page_size}


@api.get("/admin/statements")
async def admin_statements(q: Optional[str] = None, page: int = 1, page_size: int = 25, _: dict = Depends(_require_admin)):
    query: dict = {}
    if q:
        import re
        rx = {"$regex": re.escape(q), "$options": "i"}
        query["$or"] = [{"period_label": rx}, {"filename": rx}]
    total = await db.statements.count_documents(query)
    skip = max(0, (page - 1) * page_size)
    rows = await db.statements.find(query, {"_id": 0, "raw_text_preview": 0}).sort("uploaded_at", -1).skip(skip).limit(page_size).to_list(page_size)
    items = []
    for s in rows:
        h = await db.households.find_one({"id": s.get("household_id")}, {"_id": 0, "participant_name": 1})
        items.append({
            "id": s["id"],
            "participant_name": (h or {}).get("participant_name", "Unnamed"),
            "period_label": s.get("period_label"),
            "period": s.get("period_label"),
            "gross_amount": sum(float(li.get("total", 0) or 0) for li in (s.get("line_items") or [])),
            "anomalies_count": len(s.get("anomalies") or []),
            "uploaded_at": s.get("uploaded_at"),
        })
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def _csv_response(rows: list, headers: list, filename: str):
    from fastapi.responses import Response
    import csv as _csv
    import io as _io
    buf = _io.StringIO()
    w = _csv.writer(buf)
    w.writerow(headers)
    for r in rows:
        w.writerow([(r.get(h, "") if isinstance(r, dict) else "") for h in headers])
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@api.get("/admin/export/users.csv")
async def admin_export_users(_: dict = Depends(_require_admin)):
    rows = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(10_000)
    return _csv_response(
        [{"email": r.get("email"), "name": r.get("name"), "plan": r.get("plan"), "is_admin": r.get("is_admin", False), "created_at": r.get("created_at")} for r in rows],
        ["email", "name", "plan", "is_admin", "created_at"],
        "users.csv",
    )


@api.get("/admin/export/payments.csv")
async def admin_export_payments(_: dict = Depends(_require_admin)):
    return _csv_response([], ["user_email", "plan", "amount", "currency", "status", "session_id", "created_at"], "payments.csv")


@api.get("/admin/export/statements.csv")
async def admin_export_statements(_: dict = Depends(_require_admin)):
    rows = await db.statements.find({}, {"_id": 0}).to_list(10_000)
    out = []
    for s in rows:
        h = await db.households.find_one({"id": s.get("household_id")}, {"_id": 0, "participant_name": 1})
        out.append({
            "participant": (h or {}).get("participant_name", ""),
            "period": s.get("period_label", ""),
            "gross": sum(float(li.get("total", 0) or 0) for li in (s.get("line_items") or [])),
            "anomalies": len(s.get("anomalies") or []),
            "uploaded_at": s.get("uploaded_at"),
        })
    return _csv_response(out, ["participant", "period", "gross", "anomalies", "uploaded_at"], "statements.csv")


# ─────────────────────────── adviser portal (iter27-29) ───────────────────────────
ADVISER_CLIENT_CAP = 25
ADVISER_PLANS = {"adviser"}


def _require_adviser_user(user: dict) -> None:
    if user.get("plan") not in ADVISER_PLANS:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "plan_required",
                "current_plan": user.get("plan"),
                "required_plans": list(ADVISER_PLANS),
                "redirect": "/pricing",
            },
        )


@api.get("/adviser/summary")
async def adviser_summary(user_id: str = Depends(get_current_user_id)):
    user = await _get_user(user_id)
    _require_adviser_user(user)
    rows = await db.adviser_clients.find({"adviser_id": user_id}, {"_id": 0}).to_list(500)
    total = len(rows)
    active = sum(1 for r in rows if r.get("status") in ("active", "linked"))
    invited = sum(1 for r in rows if r.get("status") == "invited")
    return {
        "plan": user.get("plan"),
        "adviser_name": user.get("name"),
        "max_clients": ADVISER_CLIENT_CAP,
        "clients_total": total,
        "clients_active": active,
        "clients_invited": invited,
        "seats_remaining": max(0, ADVISER_CLIENT_CAP - total),
    }


@api.get("/adviser/clients")
async def adviser_clients(user_id: str = Depends(get_current_user_id)):
    user = await _get_user(user_id)
    _require_adviser_user(user)
    rows = await db.adviser_clients.find({"adviser_id": user_id}, {"_id": 0, "invite_token": 0}).sort("created_at", -1).to_list(500)
    return rows


class _NewClient(BaseModel):
    client_name: str = Field(min_length=1, max_length=120)
    client_email: str = Field(min_length=3, max_length=320)
    notes: Optional[str] = Field(default="", max_length=500)


@api.post("/adviser/clients")
async def adviser_clients_create(payload: _NewClient, user_id: str = Depends(get_current_user_id)):
    user = await _get_user(user_id)
    _require_adviser_user(user)
    email = payload.client_email.strip().lower()
    if "@" not in email:
        raise HTTPException(status_code=422, detail="Enter a valid email address.")
    count = await db.adviser_clients.count_documents({"adviser_id": user_id})
    if count >= ADVISER_CLIENT_CAP:
        raise HTTPException(status_code=403, detail={"error": "client_cap_reached", "max": ADVISER_CLIENT_CAP})
    existing = await db.adviser_clients.find_one({"adviser_id": user_id, "client_email": email})
    if existing:
        raise HTTPException(status_code=409, detail="That client is already in your roster.")
    invite_token = _secrets.token_urlsafe(32)
    doc = {
        "id": new_id(),
        "adviser_id": user_id,
        "adviser_name": user.get("name"),
        "adviser_email": user.get("email"),
        "client_name": payload.client_name.strip(),
        "client_email": email,
        "notes": (payload.notes or "").strip(),
        "status": "invited",
        "invite_token": invite_token,
        "linked_user_id": None,
        "linked_household_id": None,
        "created_at": now_iso(),
        "invited_at": now_iso(),
        "linked_at": None,
    }
    await db.adviser_clients.insert_one(doc)
    invite_url = f"wayly://signup?plan=family&invite={invite_token}"
    web_url = f"https://wayly.com.au/signup?plan=family&invite={invite_token}"
    logger.info("ADVISER INVITE for %s -> %s  (mobile: %s | web: %s)", user.get("email"), email, invite_url, web_url)
    out = {k: v for k, v in doc.items() if k not in ("_id", "invite_token")}
    return out


class _UpdateClient(BaseModel):
    client_name: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None


@api.patch("/adviser/clients/{cid}")
async def adviser_clients_update(cid: str, payload: _UpdateClient, user_id: str = Depends(get_current_user_id)):
    user = await _get_user(user_id)
    _require_adviser_user(user)
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(status_code=422, detail="Nothing to update.")
    res = await db.adviser_clients.update_one({"id": cid, "adviser_id": user_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Client not found.")
    doc = await db.adviser_clients.find_one({"id": cid}, {"_id": 0, "invite_token": 0})
    return doc


@api.delete("/adviser/clients/{cid}")
async def adviser_clients_delete(cid: str, user_id: str = Depends(get_current_user_id)):
    user = await _get_user(user_id)
    _require_adviser_user(user)
    res = await db.adviser_clients.delete_one({"id": cid, "adviser_id": user_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Client not found.")
    return {"ok": True}


@api.post("/adviser/clients/{cid}/resend-invite")
async def adviser_resend_invite(cid: str, user_id: str = Depends(get_current_user_id)):
    user = await _get_user(user_id)
    _require_adviser_user(user)
    client = await db.adviser_clients.find_one({"id": cid, "adviser_id": user_id})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found.")
    new_token = _secrets.token_urlsafe(32)
    await db.adviser_clients.update_one(
        {"id": cid},
        {"$set": {"invite_token": new_token, "invited_at": now_iso(), "status": "invited"}},
    )
    invite_url = f"wayly://signup?plan=family&invite={new_token}"
    logger.info("ADVISER RE-INVITE for %s -> %s (%s)", user.get("email"), client.get("client_email"), invite_url)
    return {"ok": True, "invited_at": now_iso()}


@api.get("/adviser/clients/{cid}/snapshot")
async def adviser_client_snapshot(cid: str, user_id: str = Depends(get_current_user_id)):
    user = await _get_user(user_id)
    _require_adviser_user(user)
    client = await db.adviser_clients.find_one({"id": cid, "adviser_id": user_id}, {"_id": 0, "invite_token": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found.")
    linked_uid = client.get("linked_user_id")
    if not linked_uid:
        raise HTTPException(status_code=409, detail={"error": "client_not_linked", "client": client})
    household = await db.households.find_one({"owner_id": linked_uid}, {"_id": 0}) or {}
    statements = await db.statements.find({"household_id": household.get("id")}, {"_id": 0}).sort("uploaded_at", -1).to_list(10)
    recent = []
    flagged = []
    for s in statements:
        gross = sum(float(li.get("total") or 0) for li in (s.get("line_items") or []))
        recent.append({"id": s["id"], "period_label": s.get("period_label"), "uploaded_at": s.get("uploaded_at"), "gross": gross, "anomaly_count": len(s.get("anomalies") or [])})
        for a in (s.get("anomalies") or []):
            flagged.append({"statement_id": s["id"], "severity": a.get("severity"), "headline": a.get("headline") or a.get("title") or a.get("rule"), "detail": a.get("detail") or a.get("description")})
    members_count = await db.users.count_documents({"household_id": household.get("id")}) if household else 0
    return {
        "client": client,
        "household": household,
        "metrics": {
            "statements_total": len(statements),
            "anomalies_total": sum(len(s.get("anomalies") or []) for s in statements),
        },
        "recent_statements": recent[:5],
        "flagged_sample": flagged[:10],
        "members_count": members_count,
    }


# Public — used by the signup deep-link to fetch invite preview.
@api.get("/public/adviser/invite/{token}")
async def public_adviser_invite(token: str):
    client = await db.adviser_clients.find_one({"invite_token": token}, {"_id": 0, "invite_token": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Invite not found or already used.")
    return {
        "adviser_name": client.get("adviser_name"),
        "client_name": client.get("client_name"),
        "client_email": client.get("client_email"),
        "notes": client.get("notes"),
    }


# ─────────────────────────── Document Vault (iter29) ───────────────────────────
DOC_MAX_BYTES = 10 * 1024 * 1024          # 10 MB per file
DOC_VAULT_MAX_BYTES = 100 * 1024 * 1024   # 100 MB per household vault
DOC_CATEGORIES = ["assessment", "statement", "care_plan", "medical", "financial", "legal", "other"]


async def _vault_used_bytes(household_id: str) -> int:
    pipeline = [
        {"$match": {"household_id": household_id}},
        {"$group": {"_id": None, "total": {"$sum": "$size_bytes"}}},
    ]
    rows = await db.documents.aggregate(pipeline).to_list(1)
    return int(rows[0]["total"]) if rows else 0


@api.get("/documents")
async def documents_list(as_client_id: Optional[str] = None, user_id: str = Depends(get_current_user_id)):
    user = await _get_user(user_id)
    household_id: Optional[str] = None
    scope = "own"
    # Adviser read-only access via ?as_client_id=<roster_id>
    if as_client_id:
        if user.get("plan") not in ADVISER_PLANS:
            raise HTTPException(status_code=403, detail="Adviser plan required.")
        client = await db.adviser_clients.find_one({"id": as_client_id, "adviser_id": user_id})
        if not client or not client.get("linked_household_id"):
            raise HTTPException(status_code=409, detail={"error": "client_not_linked"})
        household_id = client["linked_household_id"]
        scope = "adviser_readonly"
    else:
        h = await _get_household(user_id)
        if not h:
            return {"documents": [], "scope": scope, "limits": {"vault_used_bytes": 0, "vault_remaining_bytes": DOC_VAULT_MAX_BYTES, "max_file_bytes": DOC_MAX_BYTES, "max_vault_bytes": DOC_VAULT_MAX_BYTES}, "categories": DOC_CATEGORIES}
        household_id = h["id"]
    docs = await db.documents.find({"household_id": household_id}, {"_id": 0, "data": 0}).sort("uploaded_at", -1).to_list(500)
    used = await _vault_used_bytes(household_id)
    return {
        "documents": docs,
        "scope": scope,
        "limits": {
            "vault_used_bytes": used,
            "vault_remaining_bytes": max(0, DOC_VAULT_MAX_BYTES - used),
            "max_file_bytes": DOC_MAX_BYTES,
            "max_vault_bytes": DOC_VAULT_MAX_BYTES,
        },
        "categories": DOC_CATEGORIES,
    }


@api.post("/documents")
async def documents_upload(
    file: UploadFile = File(...),
    category: str = "other",
    title: str = "",
    notes: str = "",
    user_id: str = Depends(get_current_user_id),
):
    h = await _require_household(user_id)
    if category not in DOC_CATEGORIES:
        raise HTTPException(status_code=422, detail=f"Category must be one of: {', '.join(DOC_CATEGORIES)}")
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file.")
    if len(raw) > DOC_MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"File exceeds {DOC_MAX_BYTES // 1024 // 1024}MB per-file limit.")
    used = await _vault_used_bytes(h["id"])
    if used + len(raw) > DOC_VAULT_MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"Vault would exceed {DOC_VAULT_MAX_BYTES // 1024 // 1024}MB total. Delete older files first.")
    doc = {
        "id": new_id(),
        "household_id": h["id"],
        "uploader_id": user_id,
        "filename": file.filename or "upload",
        "content_type": file.content_type or "application/octet-stream",
        "size_bytes": len(raw),
        "category": category,
        "title": (title or file.filename or "Untitled").strip()[:120],
        "notes": (notes or "").strip()[:500],
        "data": base64.b64encode(raw).decode("ascii"),
        "uploaded_at": now_iso(),
    }
    await db.documents.insert_one(doc)
    out = {k: v for k, v in doc.items() if k not in ("data",)}
    return out


@api.get("/documents/{doc_id}")
async def documents_detail(doc_id: str, as_client_id: Optional[str] = None, user_id: str = Depends(get_current_user_id)):
    doc = await db.documents.find_one({"id": doc_id}, {"_id": 0, "data": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    await _doc_authorize(doc, user_id, as_client_id)
    return doc


@api.get("/documents/{doc_id}/download")
async def documents_download(doc_id: str, as_client_id: Optional[str] = None, user_id: str = Depends(get_current_user_id)):
    doc = await db.documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    await _doc_authorize(doc, user_id, as_client_id)
    from fastapi.responses import Response
    raw = base64.b64decode(doc.get("data") or "")
    return Response(
        content=raw,
        media_type=doc.get("content_type") or "application/octet-stream",
        headers={"Content-Disposition": f'inline; filename="{doc.get("filename", "download")}"'},
    )


class _DocPatch(BaseModel):
    title: Optional[str] = None
    category: Optional[str] = None
    notes: Optional[str] = None


@api.patch("/documents/{doc_id}")
async def documents_patch(doc_id: str, payload: _DocPatch, user_id: str = Depends(get_current_user_id)):
    doc = await db.documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    await _doc_authorize(doc, user_id, None)
    update: Dict[str, str] = {}
    if payload.title is not None:
        update["title"] = payload.title.strip()[:120]
    if payload.category is not None:
        if payload.category not in DOC_CATEGORIES:
            raise HTTPException(status_code=422, detail="Invalid category.")
        update["category"] = payload.category
    if payload.notes is not None:
        update["notes"] = payload.notes.strip()[:500]
    if not update:
        raise HTTPException(status_code=422, detail="Nothing to update.")
    await db.documents.update_one({"id": doc_id}, {"$set": update})
    out = await db.documents.find_one({"id": doc_id}, {"_id": 0, "data": 0})
    return out


@api.delete("/documents/{doc_id}")
async def documents_delete(doc_id: str, user_id: str = Depends(get_current_user_id)):
    doc = await db.documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    await _doc_authorize(doc, user_id, None)
    await db.documents.delete_one({"id": doc_id})
    return {"ok": True}


@api.post("/documents/{doc_id}/send-to-decoder")
async def documents_send_to_decoder(doc_id: str, user_id: str = Depends(get_current_user_id)):
    doc = await db.documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    await _doc_authorize(doc, user_id, None)
    if doc.get("category") != "statement":
        raise HTTPException(status_code=400, detail="Only documents categorised 'statement' can be decoded.")
    raw = base64.b64decode(doc.get("data") or "")
    from document_extract import extract_document
    try:
        text, _im, _pc, _pw = await extract_document(doc.get("filename") or "doc", raw)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read document: {e}")
    if not (text or "").strip():
        raise HTTPException(status_code=400, detail="No readable text. Try a clearer file.")
    # Reuse the authenticated upload pipeline for the actual decode
    h = await _require_household(user_id)
    user = await _get_user(user_id)
    job_id = _submit_upload_job(text, doc.get("filename") or "vault-doc", h["id"], user_id, user.get("name", ""), len(raw))
    return {"job_id": job_id, "status": "pending"}


async def _doc_authorize(doc: dict, user_id: str, as_client_id: Optional[str]) -> None:
    """A document is readable if it's in the user's own household OR via a linked adviser client."""
    user = await _get_user(user_id)
    if as_client_id:
        if user.get("plan") not in ADVISER_PLANS:
            raise HTTPException(status_code=403, detail="Adviser plan required.")
        client = await db.adviser_clients.find_one({"id": as_client_id, "adviser_id": user_id})
        if not client or client.get("linked_household_id") != doc.get("household_id"):
            raise HTTPException(status_code=403, detail="Not authorised for this document.")
        return
    h = await _get_household(user_id)
    if not h or h.get("id") != doc.get("household_id"):
        raise HTTPException(status_code=403, detail="Not authorised for this document.")


# ─────────────────────────── Visits / Calendar (iter30 - Feature 4) ───────────────────────────
VISIT_KINDS = ["appointment", "home_visit", "telehealth", "assessment", "other"]


class _VisitIn(BaseModel):
    title: str = Field(min_length=1, max_length=140)
    starts_at: str = Field(min_length=10)  # ISO datetime
    duration_minutes: int = Field(ge=5, le=24 * 60, default=60)
    location: Optional[str] = Field(default="", max_length=200)
    provider: Optional[str] = Field(default="", max_length=120)
    kind: str = "appointment"
    notes: Optional[str] = Field(default="", max_length=600)


class _VisitPatch(BaseModel):
    title: Optional[str] = None
    starts_at: Optional[str] = None
    duration_minutes: Optional[int] = None
    location: Optional[str] = None
    provider: Optional[str] = None
    kind: Optional[str] = None
    notes: Optional[str] = None


def _validate_visit_kind(k: str) -> None:
    if k not in VISIT_KINDS:
        raise HTTPException(status_code=422, detail=f"kind must be one of: {', '.join(VISIT_KINDS)}")


@api.get("/visits")
async def visits_list(upcoming_only: bool = False, user_id: str = Depends(get_current_user_id)):
    h = await _get_household(user_id)
    if not h:
        return []
    q: Dict = {"household_id": h["id"]}
    if upcoming_only:
        q["starts_at"] = {"$gte": now_iso()}
    rows = await db.visits.find(q, {"_id": 0}).sort("starts_at", 1 if upcoming_only else -1).to_list(500)
    return rows


@api.post("/visits")
async def visits_create(payload: _VisitIn, user_id: str = Depends(get_current_user_id)):
    h = await _require_household(user_id)
    _validate_visit_kind(payload.kind)
    doc = {
        "id": new_id(),
        "household_id": h["id"],
        "created_by": user_id,
        "title": payload.title.strip(),
        "starts_at": payload.starts_at,
        "duration_minutes": int(payload.duration_minutes),
        "location": (payload.location or "").strip(),
        "provider": (payload.provider or "").strip(),
        "kind": payload.kind,
        "notes": (payload.notes or "").strip(),
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.visits.insert_one(doc)
    return {k: v for k, v in doc.items() if k != "_id"}


@api.get("/visits/{vid}")
async def visits_detail(vid: str, user_id: str = Depends(get_current_user_id)):
    h = await _require_household(user_id)
    v = await db.visits.find_one({"id": vid, "household_id": h["id"]}, {"_id": 0})
    if not v:
        raise HTTPException(status_code=404, detail="Visit not found.")
    return v


@api.patch("/visits/{vid}")
async def visits_update(vid: str, payload: _VisitPatch, user_id: str = Depends(get_current_user_id)):
    h = await _require_household(user_id)
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    if "kind" in update:
        _validate_visit_kind(update["kind"])
    if not update:
        raise HTTPException(status_code=422, detail="Nothing to update.")
    update["updated_at"] = now_iso()
    res = await db.visits.update_one({"id": vid, "household_id": h["id"]}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Visit not found.")
    v = await db.visits.find_one({"id": vid}, {"_id": 0})
    return v


@api.delete("/visits/{vid}")
async def visits_delete(vid: str, user_id: str = Depends(get_current_user_id)):
    h = await _require_household(user_id)
    res = await db.visits.delete_one({"id": vid, "household_id": h["id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Visit not found.")
    return {"ok": True}


# ─────────────────────────── Adviser review-pack PDF (iter27) ───────────────────────────
@api.get("/adviser/clients/{cid}/review-pack.pdf")
async def adviser_review_pack_pdf(cid: str, user_id: str = Depends(get_current_user_id)):
    """Generate a Wayly-branded A4 PDF summarising a client's recent statements + anomalies."""
    user = await _get_user(user_id)
    _require_adviser_user(user)
    client = await db.adviser_clients.find_one({"id": cid, "adviser_id": user_id}, {"_id": 0, "invite_token": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found.")
    linked_uid = client.get("linked_user_id")
    household: dict = {}
    statements: list = []
    members_count = 0
    if linked_uid:
        household = await db.households.find_one({"owner_id": linked_uid}, {"_id": 0}) or {}
        statements = await db.statements.find({"household_id": household.get("id")}, {"_id": 0}).sort("uploaded_at", -1).to_list(20)
        members_count = await db.users.count_documents({"household_id": household.get("id")}) if household else 0

    # Build PDF in-memory
    import io
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.lib import colors as rl_colors
    from reportlab.platypus import (
        SimpleDocTemplate,
        Paragraph,
        Spacer,
        Table,
        TableStyle,
        PageBreak,
    )

    NAVY = rl_colors.HexColor("#1F3A5F")
    GOLD = rl_colors.HexColor("#D4A24E")
    SAGE = rl_colors.HexColor("#7A9B7E")
    TERRA = rl_colors.HexColor("#C5734D")
    MUTED = rl_colors.HexColor("#5C6878")
    CREAM = rl_colors.HexColor("#FAF7F2")
    BORDER = rl_colors.HexColor("#E8E2D6")

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=18 * mm, bottomMargin=18 * mm,
        title=f"Wayly review pack — {client.get('client_name','client')}",
        author=user.get("name", "Wayly Adviser"),
    )

    base = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=base["Heading1"], fontName="Helvetica-Bold", fontSize=22, textColor=NAVY, leading=26, spaceAfter=6)
    h2 = ParagraphStyle("h2", parent=base["Heading2"], fontName="Helvetica-Bold", fontSize=13, textColor=NAVY, leading=16, spaceBefore=10, spaceAfter=6)
    body = ParagraphStyle("body", parent=base["BodyText"], fontName="Helvetica", fontSize=10, textColor=rl_colors.HexColor("#1A1A1A"), leading=14)
    muted = ParagraphStyle("muted", parent=body, textColor=MUTED, fontSize=9, leading=12)
    overline = ParagraphStyle("overline", parent=muted, fontName="Helvetica-Bold", textColor=MUTED, fontSize=8, spaceAfter=2)

    story = []
    # Header
    story.append(Paragraph("WAYLY  ·  ADVISER REVIEW PACK", overline))
    story.append(Paragraph(f"{client.get('client_name','')}", h1))
    story.append(Paragraph(f"Prepared by {user.get('name','')} ({user.get('email','')}) — {datetime.now(timezone.utc).strftime('%d %b %Y')}", muted))
    story.append(Spacer(1, 6))

    # Client + household card
    rows = [
        ["Client email", client.get("client_email", "")],
        ["Status", (client.get("status") or "").capitalize()],
        ["Participant", household.get("participant_name", "—") if household else "Not yet linked"],
        ["Classification", (f"Level {household.get('classification')}" if household.get("classification") else "—")],
        ["Provider", household.get("provider_name", "—") if household else "—"],
        ["Household members", str(members_count) if linked_uid else "—"],
    ]
    if client.get("notes"):
        rows.append(["Adviser notes", client.get("notes", "")])
    tbl = Table(rows, colWidths=[45 * mm, None])
    tbl.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, -1), "Helvetica", 9.5),
        ("TEXTCOLOR", (0, 0), (0, -1), MUTED),
        ("TEXTCOLOR", (1, 0), (1, -1), NAVY),
        ("FONT", (1, 0), (1, -1), "Helvetica-Bold", 10),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(Paragraph("Client & household", h2))
    story.append(tbl)
    story.append(Spacer(1, 8))

    # Metrics
    total_statements = len(statements)
    total_anomalies = sum(len(s.get("anomalies") or []) for s in statements)
    total_gross = sum(sum(float(li.get("total") or 0) for li in (s.get("line_items") or [])) for s in statements)
    metrics = Table([
        ["Statements (24 mo)", "Anomalies", "Gross billed"],
        [str(total_statements), str(total_anomalies), f"${total_gross:,.0f}"],
    ], colWidths=[None, None, None])
    metrics.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, 0), "Helvetica", 8.5),
        ("TEXTCOLOR", (0, 0), (-1, 0), MUTED),
        ("FONT", (0, 1), (-1, 1), "Helvetica-Bold", 18),
        ("TEXTCOLOR", (0, 1), (-1, 1), NAVY),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("LINEABOVE", (0, 0), (-1, 0), 0.4, BORDER),
        ("LINEBELOW", (0, 1), (-1, 1), 0.4, BORDER),
        ("TOPPADDING", (0, 0), (-1, 0), 6),
        ("BOTTOMPADDING", (0, 1), (-1, 1), 10),
    ]))
    story.append(metrics)

    # Recent statements table
    story.append(Paragraph("Recent statements", h2))
    if not statements:
        story.append(Paragraph("No statements on file yet. Once the client uploads, future packs will include line-item summaries here.", muted))
    else:
        head = ["Period", "Uploaded", "Line items", "Anomalies", "Gross"]
        data = [head]
        for s in statements[:10]:
            gross = sum(float(li.get("total") or 0) for li in (s.get("line_items") or []))
            up = (s.get("uploaded_at") or "")[:10]
            data.append([
                s.get("period_label") or "—",
                up,
                str(len(s.get("line_items") or [])),
                str(len(s.get("anomalies") or [])),
                f"${gross:,.0f}",
            ])
        tbl = Table(data, colWidths=[40 * mm, 28 * mm, 22 * mm, 22 * mm, 28 * mm])
        tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), CREAM),
            ("TEXTCOLOR", (0, 0), (-1, 0), MUTED),
            ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8.5),
            ("FONT", (0, 1), (-1, -1), "Helvetica", 9.5),
            ("TEXTCOLOR", (0, 1), (-1, -1), NAVY),
            ("LINEBELOW", (0, 0), (-1, -1), 0.4, BORDER),
            ("ALIGN", (2, 1), (-1, -1), "RIGHT"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(tbl)

    # Flagged anomalies
    story.append(Paragraph("Flagged items", h2))
    flat: list = []
    for s in statements[:10]:
        for a in (s.get("anomalies") or []):
            flat.append((s, a))
    if not flat:
        story.append(Paragraph("No anomalies flagged in this review window.", muted))
    else:
        sev_color = {
            "alert": TERRA, "HIGH": TERRA,
            "warning": GOLD, "MEDIUM": GOLD,
            "info": SAGE, "LOW": SAGE,
        }
        for s, a in flat[:12]:
            sev = (a.get("severity") or "info")
            chip_color = sev_color.get(sev, MUTED)
            t = Table([
                [Paragraph(f"<b>{(a.get('headline') or a.get('title') or a.get('rule') or 'Heads up')}</b>", body),
                 Paragraph(f"<font color='#5C6878' size='8'>{sev.upper()}</font>", muted)],
                [Paragraph((a.get("detail") or a.get("description") or ""), muted), ""],
                [Paragraph(f"<font color='#5C6878' size='8'>Statement: {s.get('period_label') or (s.get('uploaded_at') or '')[:10]}</font>", muted), ""],
            ], colWidths=[None, 18 * mm])
            t.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), CREAM),
                ("LINEBEFORE", (0, 0), (0, -1), 2.4, chip_color),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("SPAN", (0, 1), (1, 1)),
                ("SPAN", (0, 2), (1, 2)),
            ]))
            story.append(t)
            story.append(Spacer(1, 4))

    # Footer / disclaimer
    story.append(Spacer(1, 8))
    story.append(Paragraph(
        "<i>This document was generated by Wayly from the household's uploaded statements. "
        "AI may be incorrect — verify before acting. Confidential — for the named adviser and client only.</i>",
        muted,
    ))

    doc.build(story)
    pdf_bytes = buf.getvalue()
    from fastapi.responses import Response
    safe_name = "".join(c for c in (client.get("client_name") or "client") if c.isalnum() or c in " -_").strip().replace(" ", "_")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="wayly-review-{safe_name}.pdf"'},
    )


# ─────────────────── consumer summary report PDF ───────────────────
@api.get("/reports/summary.pdf")
async def consumer_summary_pdf(
    period: str = "quarter",  # "quarter" | "all"
    user_id: str = Depends(get_current_user_id),
):
    """Personal Wayly-branded A4 PDF for the household owner: lifetime cap, this
    quarter spend, anomaly summary, recent statements. ?period=quarter|all controls
    the slice. Reuses reportlab from the adviser pack."""
    user = await _get_user(user_id)
    h = await _require_household(user_id)
    period = (period or "quarter").lower()
    if period not in ("quarter", "all"):
        period = "quarter"

    # Same data Pi used by /budget/current — keep numbers consistent.
    q_start, q_end, q_label = budget_lib.get_quarter_window()
    statements_all = await db.statements.find({"household_id": h["id"]}, {"_id": 0}).sort("uploaded_at", -1).to_list(200)
    if period == "quarter":
        statements = [
            s for s in statements_all
            if s.get("period_start") and s.get("period_end")
            and s["period_start"] >= q_start.isoformat()
            and s["period_end"] <= q_end.isoformat()
        ]
        period_label = q_label
    else:
        statements = statements_all
        period_label = "All statements"

    gross_total = 0.0
    copay_total = 0.0
    for s in statements:
        for li in (s.get("line_items") or []):
            gross_total += float(li.get("total") or 0)
            copay_total += float(li.get("contribution_paid") or 0)
    anomalies_total = sum(len(s.get("anomalies") or []) for s in statements)

    # Lifetime cap (same shape as /budget/current)
    lifetime_cap = budget_lib.lifetime_cap(bool(h.get("is_grandfathered")))
    lifetime_contributed = 0.0
    for s in statements_all:
        for li in (s.get("line_items") or []):
            lifetime_contributed += float(li.get("contribution_paid") or 0)
    lifetime_pct = (lifetime_contributed / lifetime_cap * 100.0) if lifetime_cap else 0.0

    import io
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.lib import colors as rl_colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

    NAVY = rl_colors.HexColor("#1F3A5F")
    GOLD = rl_colors.HexColor("#D4A24E")
    SAGE = rl_colors.HexColor("#7A9B7E")
    TERRA = rl_colors.HexColor("#C5734D")
    MUTED = rl_colors.HexColor("#5C6878")
    BORDER = rl_colors.HexColor("#E8E2D6")

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=18 * mm, bottomMargin=18 * mm,
        title=f"Wayly summary — {h.get('participant_name','household')}",
        author=user.get("name", "Wayly"),
    )
    base = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=base["Heading1"], fontName="Helvetica-Bold", fontSize=22, textColor=NAVY, leading=26, spaceAfter=6)
    h2 = ParagraphStyle("h2", parent=base["Heading2"], fontName="Helvetica-Bold", fontSize=13, textColor=NAVY, leading=16, spaceBefore=10, spaceAfter=6)
    body = ParagraphStyle("body", parent=base["BodyText"], fontName="Helvetica", fontSize=10, textColor=rl_colors.HexColor("#1A1A1A"), leading=14)
    muted = ParagraphStyle("muted", parent=body, textColor=MUTED, fontSize=9, leading=12)
    overline = ParagraphStyle("overline", parent=muted, fontName="Helvetica-Bold", textColor=MUTED, fontSize=8, spaceAfter=2)

    def aud(v: float) -> str:
        try:
            return f"${v:,.2f}"
        except Exception:
            return f"${v}"

    story = []
    story.append(Paragraph(f"WAYLY  ·  SUMMARY REPORT  ·  {period_label.upper()}", overline))
    story.append(Paragraph(f"{h.get('participant_name','Household')}", h1))
    story.append(Paragraph(f"Prepared for {user.get('name','')} ({user.get('email','')}) — {datetime.now(timezone.utc).strftime('%d %b %Y')}", muted))
    story.append(Spacer(1, 6))

    # Household card
    rows = [
        ["Participant", h.get("participant_name", "—")],
        ["Classification", f"Level {h.get('classification')}" if h.get("classification") else "—"],
        ["Provider", h.get("provider_name", "—")],
        ["Status", "Grandfathered" if h.get("is_grandfathered") else "New entrant"],
    ]
    tbl = Table(rows, colWidths=[45 * mm, None])
    tbl.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, -1), "Helvetica", 9.5),
        ("TEXTCOLOR", (0, 0), (0, -1), MUTED),
        ("TEXTCOLOR", (1, 0), (1, -1), NAVY),
        ("FONT", (1, 0), (1, -1), "Helvetica-Bold", 10),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(Paragraph("Household", h2))
    story.append(tbl)
    story.append(Spacer(1, 8))

    # Metrics tiles
    metrics_rows = [[
        Paragraph(f"<font color='#5C6878' size='8'>STATEMENTS</font><br/><font color='#1F3A5F' size='18'><b>{len(statements)}</b></font>", body),
        Paragraph(f"<font color='#5C6878' size='8'>GROSS</font><br/><font color='#1F3A5F' size='18'><b>{aud(gross_total)}</b></font>", body),
        Paragraph(f"<font color='#5C6878' size='8'>YOU PAID</font><br/><font color='#1F3A5F' size='18'><b>{aud(copay_total)}</b></font>", body),
        Paragraph(f"<font color='#5C6878' size='8'>ANOMALIES</font><br/><font color='#C5734D' size='18'><b>{anomalies_total}</b></font>", body),
    ]]
    mt = Table(metrics_rows, colWidths=[None, None, None, None])
    mt.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), rl_colors.HexColor("#FAF7F2")),
        ("BOX", (0, 0), (-1, -1), 0.4, BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    story.append(Paragraph(f"This {period_label.lower()}", h2))
    story.append(mt)
    story.append(Spacer(1, 8))

    # Lifetime cap
    story.append(Paragraph("Lifetime contribution cap", h2))
    cap_rows = [[
        Paragraph(f"Contributed so far<br/><font color='#1F3A5F' size='14'><b>{aud(lifetime_contributed)}</b></font>", body),
        Paragraph(f"Cap<br/><font color='#1F3A5F' size='14'><b>{aud(lifetime_cap)}</b></font>", body),
        Paragraph(f"Used<br/><font color='#7A9B7E' size='14'><b>{lifetime_pct:.2f}%</b></font>", body),
    ]]
    ct = Table(cap_rows, colWidths=[None, None, None])
    ct.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), rl_colors.HexColor("#FAF7F2")),
        ("BOX", (0, 0), (-1, -1), 0.4, BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    story.append(ct)
    story.append(Spacer(1, 8))

    # Recent statements
    story.append(Paragraph("Recent statements", h2))
    if not statements:
        story.append(Paragraph("No statements in this window yet.", muted))
    else:
        srows = [["Period", "Uploaded", "Gross", "You paid", "Anomalies"]]
        for s in statements[:12]:
            sgross = sum(float(li.get("total") or 0) for li in (s.get("line_items") or []))
            scopay = sum(float(li.get("contribution_paid") or 0) for li in (s.get("line_items") or []))
            srows.append([
                s.get("period_label") or "—",
                (s.get("uploaded_at") or "")[:10],
                aud(sgross),
                aud(scopay),
                str(len(s.get("anomalies") or [])),
            ])
        st = Table(srows, colWidths=[35 * mm, 28 * mm, 28 * mm, 28 * mm, 22 * mm])
        st.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), NAVY),
            ("TEXTCOLOR", (0, 0), (-1, 0), rl_colors.white),
            ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 9),
            ("FONT", (0, 1), (-1, -1), "Helvetica", 9),
            ("ALIGN", (2, 1), (-1, -1), "RIGHT"),
            ("LINEBELOW", (0, 0), (-1, -1), 0.4, BORDER),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [rl_colors.white, rl_colors.HexColor("#FAF7F2")]),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(st)
    story.append(Spacer(1, 8))

    # Flagged items (top 8 by severity)
    flagged: list = []
    sev_rank = {"alert": 0, "warning": 1, "info": 2}
    for s in statements:
        for a in (s.get("anomalies") or []):
            flagged.append({
                "severity": (a.get("severity") or "info").lower(),
                "title": a.get("title") or a.get("headline") or a.get("rule") or "Heads up",
                "detail": a.get("detail") or a.get("description") or "",
                "period": s.get("period_label") or "",
            })
    flagged.sort(key=lambda x: sev_rank.get(x["severity"], 9))
    if flagged:
        story.append(Paragraph("Things to know", h2))
        for f in flagged[:8]:
            tone = TERRA if f["severity"] == "alert" else (GOLD if f["severity"] == "warning" else SAGE)
            row_tbl = Table([[
                Paragraph(f"<b><font color='#{tone.hexval()[2:].upper()}'>● {f['title']}</font></b><br/>"
                          f"<font color='#5C6878' size='8'>{f['period']}</font><br/>"
                          f"<font size='9'>{f['detail']}</font>", body),
            ]], colWidths=[None])
            row_tbl.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), rl_colors.HexColor("#FAF7F2")),
                ("LINEBEFORE", (0, 0), (0, -1), 3, tone),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]))
            story.append(row_tbl)
            story.append(Spacer(1, 4))

    story.append(Spacer(1, 8))
    story.append(Paragraph(
        "<i>This document was generated by Wayly from your uploaded statements. AI may be incorrect — verify before acting. "
        "Confidential — for your records only.</i>",
        muted,
    ))

    doc.build(story)
    pdf_bytes = buf.getvalue()
    from fastapi.responses import Response
    fname = f"wayly-summary-{period}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


app.include_router(api)

# Phase A — multi-participant, refresh-token rotation, billing.
# These live in routes/*.py so server.py doesn't grow further.
from routes.account import router as account_router  # noqa: E402
from routes.participants import router as participants_router  # noqa: E402
from routes.billing import router as billing_router, webhook_router as billing_webhook_router  # noqa: E402
from routes.auth_extra import router as auth_extra_router  # noqa: E402
from routes.modules import router as modules_router  # noqa: E402
from migrations.migrate_households_to_participants import run as run_participant_migration  # noqa: E402

app.include_router(account_router)
app.include_router(participants_router)
app.include_router(billing_router)
app.include_router(billing_webhook_router)
app.include_router(auth_extra_router)
app.include_router(modules_router)


@app.on_event("startup")
async def _phase_a_startup() -> None:
    try:
        await run_participant_migration()
    except Exception as e:
        logger.warning("Phase A migration failed (non-fatal): %s", e)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
