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
    import secrets as _secrets
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
    except Exception:
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

# Phase B — domain extractions (admin / adviser / statements / documents / visits).
# Each module owns its own helpers + APIRouter; server.py is now ~1.3k lines instead of 3.4k.
from routes.statements import router as statements_router  # noqa: E402
from routes.documents import router as documents_router  # noqa: E402
from routes.visits import router as visits_router  # noqa: E402
from routes.adviser import router as adviser_router  # noqa: E402
from routes.admin import router as admin_router, seed_tickets as _seed_admin_tickets  # noqa: E402

app.include_router(statements_router)
app.include_router(documents_router)
app.include_router(visits_router)
app.include_router(adviser_router)
app.include_router(admin_router)


@app.on_event("startup")
async def _seed_tickets_on_start() -> None:
    try:
        await _seed_admin_tickets()
    except Exception as e:
        logger.warning("Ticket seed skipped: %s", e)


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
