"""Admin portal — extracted from server.py.

Owns:
  * Admin auth (login → TOTP setup / verify, logout, dev TOTP shortcut, /me)
  * Tickets / Inbox CRUD + macros
  * Users / Households / Statements / Payments admin lists + detail + actions
  * Search, analytics, maintenance toggle (+ history), system health
  * Data-requests stub, failed-payments stub
  * CSV exports

Two auth gates live here:
  * `_get_admin_session`  — TOTP-backed admin JWT (`kind: admin`)
  * `_require_admin`      — regular user JWT with `is_admin: True` (used by
                              analytics / users / households lists)
Both names are preserved verbatim from the pre-refactor server.py for diff
clarity.
"""
from __future__ import annotations

import base64
import io
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import pyotp
import qrcode
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel

from auth import (
    bearer_scheme,
    get_current_user_id,
    hash_password,
    verify_password,
)
from deps import csv_response, db
from models import new_id, now_iso

router = APIRouter(prefix="/api", tags=["admin"])
logger = logging.getLogger("wayly")

ADMIN_ROLE_DEFAULTS = ("super_admin", "operations_admin", "support_admin", "content_admin")


# ─────────────────── token helpers ───────────────────
def _admin_token(user_id: str, kind: str = "admin", ttl_hours: float = 24) -> str:
    """Issue a JWT marked with `kind` so we can distinguish admin sessions."""
    import os
    import jwt as _jwt
    payload = {
        "sub": user_id,
        "kind": kind,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(hours=ttl_hours),
    }
    secret = os.environ.get("JWT_SECRET", "wayly-dev-secret-change-me")
    return _jwt.encode(payload, secret, algorithm="HS256")


def _decode_admin(token: str) -> dict:
    import os
    import jwt as _jwt
    secret = os.environ.get("JWT_SECRET", "wayly-dev-secret-change-me")
    try:
        return _jwt.decode(token, secret, algorithms=["HS256"])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid admin session")


async def _get_admin_session(
    creds: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> dict:
    if not creds:
        raise HTTPException(status_code=401, detail="Admin sign-in required")
    payload = _decode_admin(creds.credentials)
    if payload.get("kind") != "admin":
        raise HTTPException(status_code=403, detail="Admin session required")
    u = await db.users.find_one(
        {"id": payload["sub"]}, {"_id": 0, "password_hash": 0}
    )
    if not u or not u.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return u


async def _require_admin(user_id: str = Depends(get_current_user_id)) -> dict:
    """Lighter gate used by analytics/users/households endpoints which accept
    a regular user JWT that happens to carry `is_admin: True`."""
    u = await db.users.find_one({"id": user_id}, {"_id": 0})
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


# ─────────────────── admin auth ───────────────────
class _AdminLoginReq(BaseModel):
    email: str
    password: str


class _Admin2FAVerifyReq(BaseModel):
    temp_token: str
    code: str


class _Admin2FAEnableReq(BaseModel):
    setup_token: str
    code: str


@router.post("/admin/auth/login")
async def admin_auth_login(payload: _AdminLoginReq):
    u = await db.users.find_one({"email": payload.email.lower()}, {"_id": 0})
    if not u or not u.get("is_admin"):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not verify_password(payload.password, u.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    role = u.get("admin_role", "super_admin")

    if u.get("totp_enabled"):
        temp = _admin_token(u["id"], kind="admin_temp", ttl_hours=0.1)
        return {"requires_2fa": True, "temp_token": temp, "role": role}

    # First-time TOTP setup — generate secret + provisioning URI + QR
    totp_secret = pyotp.random_base32()
    totp = pyotp.TOTP(totp_secret)
    issuer = "Wayly Admin"
    uri = totp.provisioning_uri(name=u["email"], issuer_name=issuer)
    qr = qrcode.QRCode(box_size=6, border=2)
    qr.add_data(uri)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#1F3A5F", back_color="#FAF7F2")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    qr_data_uri = f"data:image/png;base64,{base64.b64encode(buf.getvalue()).decode('ascii')}"

    await db.users.update_one({"id": u["id"]}, {"$set": {"totp_pending_secret": totp_secret}})

    setup = _admin_token(u["id"], kind="admin_setup", ttl_hours=0.25)
    return {
        "requires_2fa_setup": True,
        "setup_token": setup,
        "qr_data_uri": qr_data_uri,
        "secret": totp_secret,
        "role": role,
    }


@router.post("/admin/auth/2fa/enable")
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
    backup = [secrets.token_hex(4).upper() for _ in range(10)]
    backup_hashes = [hash_password(c) for c in backup]
    await db.users.update_one(
        {"id": u["id"]},
        {
            "$set": {
                "totp_secret": pending,
                "totp_enabled": True,
                "backup_codes_hashes": backup_hashes,
            },
            "$unset": {"totp_pending_secret": ""},
        },
    )
    refreshed = await db.users.find_one(
        {"id": u["id"]}, {"_id": 0, "password_hash": 0}
    )
    token = _admin_token(u["id"], kind="admin", ttl_hours=24)
    return {"token": token, "admin": _admin_pub(refreshed), "backup_codes": backup}


@router.post("/admin/auth/2fa/verify")
async def admin_2fa_verify(payload: _Admin2FAVerifyReq):
    decoded = _decode_admin(payload.temp_token)
    if decoded.get("kind") != "admin_temp":
        raise HTTPException(status_code=401, detail="Invalid temp token")
    u = await db.users.find_one({"id": decoded["sub"]}, {"_id": 0})
    if not u or not u.get("is_admin") or not u.get("totp_enabled"):
        raise HTTPException(status_code=400, detail="2FA not set up")
    code = payload.code.replace(" ", "").upper()
    matched = False
    if code.isdigit() and len(code) == 6:
        matched = pyotp.TOTP(u["totp_secret"]).verify(code, valid_window=1)
    if not matched and len(code) == 8:
        hashes = u.get("backup_codes_hashes") or []
        for i, h in enumerate(hashes):
            if verify_password(code, h):
                remaining = hashes[:i] + hashes[i + 1:]
                await db.users.update_one(
                    {"id": u["id"]}, {"$set": {"backup_codes_hashes": remaining}}
                )
                matched = True
                break
    if not matched:
        raise HTTPException(status_code=400, detail="That code didn't match — try again")
    token = _admin_token(u["id"], kind="admin", ttl_hours=24)
    return {"token": token, "admin": _admin_pub(u)}


@router.post("/admin/auth/logout")
async def admin_auth_logout(_: dict = Depends(_get_admin_session)):
    return {"ok": True}


@router.get("/admin/auth/dev/current-code")
async def admin_dev_current_code(email: str):
    """DEV-ONLY shortcut — returns the TOTP code computed off the server clock.

    Kept because container clocks can drift relative to phones. In production
    this endpoint MUST be removed or gated behind a debug flag.
    """
    u = await db.users.find_one({"email": email.lower()}, {"_id": 0})
    if not u or not u.get("is_admin"):
        raise HTTPException(status_code=404, detail="Admin not found")
    totp_secret = u.get("totp_pending_secret") or u.get("totp_secret")
    if not totp_secret:
        raise HTTPException(
            status_code=400,
            detail="No TOTP secret on file — start a sign-in first to generate one",
        )
    return {
        "code": pyotp.TOTP(totp_secret).now(),
        "valid_seconds": 30 - int(datetime.now(timezone.utc).timestamp()) % 30,
        "note": "Dev shortcut. Server clock may differ from your phone; this code uses the server clock.",
    }


@router.get("/admin/auth/me")
async def admin_auth_me(admin: dict = Depends(_get_admin_session)):
    return _admin_pub(admin)


# ─────────────────── tickets / inbox ───────────────────
TICKET_MACROS = [
    {"id": "m1", "title": "Acknowledge", "body": "Thanks for reaching out — we've got this and will come back to you shortly with an update."},
    {"id": "m2", "title": "Need more info", "body": "Could you share a screenshot of what you're seeing, plus the email on the affected account?"},
    {"id": "m3", "title": "Bug logged", "body": "We've logged this with engineering. We'll email you again the moment it's fixed."},
    {"id": "m4", "title": "Resolved", "body": "We've sorted this for you. Let us know if anything else pops up."},
]


async def seed_tickets():
    """Idempotent ticket seed — only if collection is empty. Exposed for
    server.py to call on startup."""
    if await db.tickets.count_documents({}) > 0:
        return
    admin = await db.users.find_one({"email": "hello@techglove.com.au"}, {"id": 1})
    cathy = await db.users.find_one(
        {"email": "demo@wayly.com.au"}, {"id": 1, "email": 1, "name": 1}
    )
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


@router.get("/admin/ticket-reports")
async def admin_ticket_reports(_: dict = Depends(_get_admin_session)):
    open_p1 = await db.tickets.count_documents({"status": "open", "priority": "P1"})
    opened_7d = await db.tickets.count_documents(
        {"created_at": {"$gte": (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()}}
    )
    oldest = (
        await db.tickets.find({"status": {"$in": ["open", "in_progress"]}})
        .sort("created_at", 1).limit(1).to_list(1)
    )
    return {
        "open_p1": open_p1,
        "opened_7d": opened_7d,
        "oldest_unresolved": (oldest[0]["created_at"] if oldest else None),
    }


@router.get("/admin/tickets")
async def admin_tickets_list(
    status: Optional[str] = None,
    priority: Optional[str] = None,
    page: int = 1,
    page_size: int = 25,
    _: dict = Depends(_get_admin_session),
):
    query: dict = {}
    if status:
        query["status"] = status
    if priority:
        query["priority"] = priority
    total = await db.tickets.count_documents(query)
    skip = max(0, (page - 1) * page_size)
    rows = (
        await db.tickets.find(query, {"_id": 0}).sort("created_at", -1)
        .skip(skip).limit(page_size).to_list(page_size)
    )
    out = []
    for t in rows:
        msgs = t.get("messages") or []
        last = msgs[-1] if msgs else None
        out.append({
            **{k: v for k, v in t.items() if k != "messages"},
            "last_message_preview": (last["body"][:140] if last else None),
            "message_count": len(msgs),
        })
    return {"items": out, "total": total, "page": page, "page_size": page_size}


@router.get("/admin/tickets/{ticket_id}")
async def admin_ticket_get(ticket_id: str, _: dict = Depends(_get_admin_session)):
    t = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return t


class _TicketUpdate(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    assigned_admin_id: Optional[str] = None


@router.put("/admin/tickets/{ticket_id}")
async def admin_ticket_update(
    ticket_id: str,
    payload: _TicketUpdate,
    _: dict = Depends(_get_admin_session),
):
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")
    update["updated_at"] = now_iso()
    res = await db.tickets.update_one({"id": ticket_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return await db.tickets.find_one({"id": ticket_id}, {"_id": 0})


class _TicketMessage(BaseModel):
    body: str
    internal: bool = False


@router.post("/admin/tickets/{ticket_id}/messages")
async def admin_ticket_reply(
    ticket_id: str,
    payload: _TicketMessage,
    admin: dict = Depends(_get_admin_session),
):
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
    res = await db.tickets.update_one(
        {"id": ticket_id},
        {"$push": {"messages": msg}, "$set": {"updated_at": now_iso()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return msg


@router.get("/admin/macros")
async def admin_macros(_: dict = Depends(_get_admin_session)):
    return TICKET_MACROS


@router.get("/admin/failed-payments")
async def admin_failed_payments(days: int = 1, _: dict = Depends(_get_admin_session)):
    return {"items": [], "since": (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()}


@router.get("/admin/data-requests")
async def admin_data_requests(
    status: Optional[str] = None,
    _: dict = Depends(_get_admin_session),
):
    if status == "received":
        return {"items": [{
            "id": new_id(),
            "user_email": "margaret@example.com",
            "user_name": "Margaret Williams",
            "type": "delete",
            "status": "received",
            "submitted_at": now_iso(),
            "due_at": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
        }]}
    return {"items": []}


# ─────────────────── system health ───────────────────
async def _ping_mongo_ms() -> tuple[str, int]:
    import time as _time
    t0 = _time.perf_counter()
    try:
        await db.command("ping")
        return "healthy", int((_time.perf_counter() - t0) * 1000)
    except Exception:
        return "down", int((_time.perf_counter() - t0) * 1000)


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


@router.get("/admin/system-health")
async def admin_system_health(_: dict = Depends(_get_admin_session)):
    mongo_status, mongo_ms = await _ping_mongo_ms()
    services = [
        {**_mock_service_stats("MongoDB", mongo_ms, mongo_status)},
        {**_mock_service_stats("Stripe", 142, "healthy")},
        {**_mock_service_stats("Resend", 88, "healthy")},
        {**_mock_service_stats("LLM", 412, "healthy")},
    ]
    return {"services": services, "llm_errors_24h": 0}


@router.get("/admin/system-health/{service}")
async def admin_system_health_detail(
    service: str, _: dict = Depends(_get_admin_session)
):
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
    points = []
    for i in range(24):
        jitter = rnd.randint(-25, 60)
        points.append({
            "t": (datetime.now(timezone.utc) - timedelta(hours=23 - i)).isoformat(),
            "ms": max(10, base_ms + jitter),
        })
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


# ─────────────────── maintenance ───────────────────
@router.get("/admin/maintenance")
async def admin_maintenance_get(_: dict = Depends(_get_admin_session)):
    doc = (
        await db.app_state.find_one({"key": "maintenance"}, {"_id": 0})
        or {"enabled": False, "message": ""}
    )
    return {
        "enabled": bool(doc.get("enabled")),
        "message": doc.get("message", ""),
        "updated_at": doc.get("updated_at"),
        "updated_by": doc.get("updated_by"),
    }


@router.get("/admin/maintenance/history")
async def admin_maintenance_history(_: dict = Depends(_get_admin_session)):
    items = await db.maintenance_log.find({}, {"_id": 0}).sort("at", -1).limit(20).to_list(20)
    return {"items": items}


class _Maintenance(BaseModel):
    enabled: bool
    message: Optional[str] = ""


@router.post("/admin/maintenance")
async def admin_maintenance_set(
    payload: _Maintenance,
    admin: dict = Depends(_get_admin_session),
):
    if admin.get("admin_role") != "super_admin":
        raise HTTPException(status_code=403, detail="Only super_admin can toggle maintenance")
    await db.app_state.update_one(
        {"key": "maintenance"},
        {"$set": {
            "key": "maintenance",
            "enabled": payload.enabled,
            "message": payload.message or "",
            "updated_at": now_iso(),
            "updated_by": admin["email"],
        }},
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


# ─────────────────── search ───────────────────
@router.get("/admin/search")
async def admin_search(q: str = "", _: dict = Depends(_get_admin_session)):
    if not q.strip():
        return {"users": [], "tickets": [], "households": []}
    rx = {"$regex": re.escape(q.strip()), "$options": "i"}
    users = (
        await db.users.find(
            {"$or": [{"email": rx}, {"name": rx}]},
            {"_id": 0, "password_hash": 0},
        ).limit(10).to_list(10)
    )
    tickets = (
        await db.tickets.find(
            {"$or": [{"subject": rx}, {"user_email": rx}, {"user_name": rx}]},
            {"_id": 0, "messages": 0},
        ).limit(10).to_list(10)
    )
    households = (
        await db.households.find(
            {"$or": [{"participant_name": rx}, {"provider_name": rx}]},
            {"_id": 0},
        ).limit(10).to_list(10)
    )
    return {
        "users": [_admin_user_row(u) for u in users],
        "tickets": tickets,
        "households": households,
    }


# ─────────────────── user profile / actions ───────────────────
@router.get("/admin/users/{user_id}/profile")
async def admin_user_profile(user_id: str, _: dict = Depends(_get_admin_session)):
    u = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, "password_hash": 0, "totp_secret": 0, "backup_codes_hashes": 0},
    )
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    notes = (
        await db.user_notes.find({"user_id": user_id}, {"_id": 0})
        .sort("created_at", -1).to_list(50)
    )
    h = None
    if u.get("household_id"):
        h = await db.households.find_one({"id": u["household_id"]}, {"_id": 0})
    return {"user": u, "household": h, "notes": notes}


class _UserNote(BaseModel):
    body: str


@router.post("/admin/users/{user_id}/notes")
async def admin_user_add_note(
    user_id: str, payload: _UserNote, admin: dict = Depends(_get_admin_session)
):
    if not payload.body.strip():
        raise HTTPException(status_code=400, detail="Note cannot be empty")
    note = {
        "id": new_id(),
        "user_id": user_id,
        "body": payload.body.strip(),
        "admin_email": admin["email"],
        "created_at": now_iso(),
    }
    await db.user_notes.insert_one(note)
    note.pop("_id", None)
    return note


class _Suspend(BaseModel):
    suspended: bool
    reason: Optional[str] = None


@router.post("/admin/users/{user_id}/suspend")
async def admin_user_suspend(
    user_id: str, payload: _Suspend, admin: dict = Depends(_get_admin_session)
):
    if admin.get("admin_role") not in ("super_admin", "operations_admin"):
        raise HTTPException(status_code=403, detail="Not allowed")
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Cannot suspend yourself")
    res = await db.users.update_one(
        {"id": user_id},
        {"$set": {"suspended": payload.suspended, "suspended_reason": payload.reason or None}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True, "suspended": payload.suspended}


class _ExtendTrial(BaseModel):
    days: int = 7


@router.post("/admin/users/{user_id}/extend-trial")
async def admin_user_extend_trial(
    user_id: str, payload: _ExtendTrial, admin: dict = Depends(_get_admin_session)
):
    if admin.get("admin_role") not in ("super_admin", "operations_admin"):
        raise HTTPException(status_code=403, detail="Not allowed")
    if payload.days <= 0 or payload.days > 90:
        raise HTTPException(status_code=400, detail="Days must be 1-90")
    new_end = (datetime.now(timezone.utc) + timedelta(days=payload.days)).isoformat()
    res = await db.users.update_one(
        {"id": user_id},
        {"$set": {"trial_ends_at": new_end, "subscription_status": "trialing"}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True, "trial_ends_at": new_end}


# ─────────────────── analytics / users / households / payments / statements ───────────────────
@router.get("/admin/analytics")
async def admin_analytics(_: dict = Depends(_require_admin)):
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    total_users = await db.users.count_documents({})
    new_users = await db.users.count_documents({"created_at": {"$gte": week_ago}})
    total_households = await db.households.count_documents({})
    total_statements = await db.statements.count_documents({})
    new_statements = await db.statements.count_documents({"uploaded_at": {"$gte": week_ago}})

    plans = await db.users.aggregate(
        [{"$group": {"_id": "$plan", "count": {"$sum": 1}}}]
    ).to_list(20)
    subs = await db.users.aggregate([
        {"$match": {"subscription_status": {"$exists": True, "$ne": None}}},
        {"$group": {"_id": "$subscription_status", "count": {"$sum": 1}}},
    ]).to_list(20)

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
        "total_revenue": 0,
        "plans": [{"plan": (p["_id"] or "free"), "count": p["count"]} for p in plans],
        "subscriptions": [{"status": s["_id"], "count": s["count"]} for s in subs],
        "top_households": top_households,
    }


@router.get("/admin/users")
async def admin_users_list(
    q: Optional[str] = None,
    plan: Optional[str] = None,
    page: int = 1,
    page_size: int = 25,
    _: dict = Depends(_require_admin),
):
    query: dict = {}
    if q:
        rx = {"$regex": re.escape(q), "$options": "i"}
        query["$or"] = [{"email": rx}, {"name": rx}]
    if plan and plan != "all":
        query["plan"] = plan
    total = await db.users.count_documents(query)
    skip = max(0, (page - 1) * page_size)
    rows = (
        await db.users.find(query, {"_id": 0, "password_hash": 0})
        .sort("created_at", -1).skip(skip).limit(page_size).to_list(page_size)
    )
    return {
        "items": [_admin_user_row(u) for u in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/admin/users/{user_id}")
async def admin_user_detail(user_id: str, _: dict = Depends(_require_admin)):
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    h = None
    if u.get("household_id"):
        h = await db.households.find_one({"id": u["household_id"]}, {"_id": 0})
    statements = (
        await db.statements.find(
            {"household_id": u.get("household_id")},
            {"_id": 0, "line_items": 0, "anomalies": 0, "raw_text_preview": 0},
        ).sort("uploaded_at", -1).limit(10).to_list(10)
    )
    for s in statements:
        full = await db.statements.find_one(
            {"id": s["id"]}, {"_id": 0, "line_items": 1, "anomalies": 1}
        )
        if full:
            s["gross_amount"] = sum(float(li.get("total", 0) or 0) for li in (full.get("line_items") or []))
            s["anomalies_count"] = len(full.get("anomalies") or [])
            s["period"] = s.get("period_label")
    return {
        "user": {**u, "is_admin": bool(u.get("is_admin", False))},
        "household": h,
        "statements": statements,
        "payments": [],
        "audit_trail": [],
    }


class _AdminFlag(BaseModel):
    is_admin: bool


class _AdminPlan(BaseModel):
    plan: str


@router.post("/admin/users/{user_id}/reset-password")
async def admin_reset_pw(user_id: str, admin: dict = Depends(_require_admin)):
    u = await db.users.find_one({"id": user_id})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    logger.info("Admin %s requested password reset for %s", admin["email"], u["email"])
    return {"ok": True, "message": "Reset email queued"}


@router.put("/admin/users/{user_id}/admin")
async def admin_toggle_admin(
    user_id: str, payload: _AdminFlag, admin: dict = Depends(_require_admin)
):
    if user_id == admin["id"] and not payload.is_admin:
        raise HTTPException(status_code=400, detail="Cannot remove your own admin access")
    res = await db.users.update_one(
        {"id": user_id}, {"$set": {"is_admin": bool(payload.is_admin)}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True, "is_admin": bool(payload.is_admin)}


@router.put("/admin/users/{user_id}/plan")
async def admin_set_plan(
    user_id: str, payload: _AdminPlan, _: dict = Depends(_require_admin)
):
    if payload.plan not in ("free", "solo", "family", "advisor"):
        raise HTTPException(status_code=400, detail="Invalid plan")
    res = await db.users.update_one({"id": user_id}, {"$set": {"plan": payload.plan}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True, "plan": payload.plan}


@router.post("/admin/users/{user_id}/cancel-subscription")
async def admin_cancel_sub(user_id: str, _: dict = Depends(_require_admin)):
    res = await db.users.update_one(
        {"id": user_id}, {"$set": {"subscription_status": "canceled"}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True}


@router.delete("/admin/users/{user_id}")
async def admin_delete_user(user_id: str, admin: dict = Depends(_require_admin)):
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    res = await db.users.delete_one({"id": user_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"ok": True}


@router.get("/admin/households")
async def admin_households(
    q: Optional[str] = None,
    page: int = 1,
    page_size: int = 25,
    _: dict = Depends(_require_admin),
):
    query: dict = {}
    if q:
        rx = {"$regex": re.escape(q), "$options": "i"}
        query["$or"] = [{"participant_name": rx}, {"provider_name": rx}]
    total = await db.households.count_documents(query)
    skip = max(0, (page - 1) * page_size)
    rows = (
        await db.households.find(query, {"_id": 0})
        .skip(skip).limit(page_size).to_list(page_size)
    )
    items = []
    for h in rows:
        mc = await db.users.count_documents({"household_id": h["id"]})
        sc = await db.statements.count_documents({"household_id": h["id"]})
        items.append({**h, "member_count": mc, "statement_count": sc})
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/admin/payments")
async def admin_payments(
    status: Optional[str] = None,
    page: int = 1,
    page_size: int = 25,
    _: dict = Depends(_require_admin),
):
    return {"items": [], "total": 0, "page": page, "page_size": page_size}


@router.get("/admin/statements")
async def admin_statements(
    q: Optional[str] = None,
    page: int = 1,
    page_size: int = 25,
    _: dict = Depends(_require_admin),
):
    query: dict = {}
    if q:
        rx = {"$regex": re.escape(q), "$options": "i"}
        query["$or"] = [{"period_label": rx}, {"filename": rx}]
    total = await db.statements.count_documents(query)
    skip = max(0, (page - 1) * page_size)
    rows = (
        await db.statements.find(query, {"_id": 0, "raw_text_preview": 0})
        .sort("uploaded_at", -1).skip(skip).limit(page_size).to_list(page_size)
    )
    items = []
    for s in rows:
        h = await db.households.find_one(
            {"id": s.get("household_id")}, {"_id": 0, "participant_name": 1}
        )
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


# ─────────────────── CSV exports ───────────────────
@router.get("/admin/export/users.csv")
async def admin_export_users(_: dict = Depends(_require_admin)):
    rows = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(10_000)
    return csv_response(
        [{
            "email": r.get("email"),
            "name": r.get("name"),
            "plan": r.get("plan"),
            "is_admin": r.get("is_admin", False),
            "created_at": r.get("created_at"),
        } for r in rows],
        ["email", "name", "plan", "is_admin", "created_at"],
        "users.csv",
    )


@router.get("/admin/export/payments.csv")
async def admin_export_payments(_: dict = Depends(_require_admin)):
    return csv_response(
        [],
        ["user_email", "plan", "amount", "currency", "status", "session_id", "created_at"],
        "payments.csv",
    )


@router.get("/admin/export/statements.csv")
async def admin_export_statements(_: dict = Depends(_require_admin)):
    rows = await db.statements.find({}, {"_id": 0}).to_list(10_000)
    out = []
    for s in rows:
        h = await db.households.find_one(
            {"id": s.get("household_id")}, {"_id": 0, "participant_name": 1}
        )
        out.append({
            "participant": (h or {}).get("participant_name", ""),
            "period": s.get("period_label", ""),
            "gross": sum(float(li.get("total", 0) or 0) for li in (s.get("line_items") or [])),
            "anomalies": len(s.get("anomalies") or []),
            "uploaded_at": s.get("uploaded_at"),
        })
    return csv_response(
        out,
        ["participant", "period", "gross", "anomalies", "uploaded_at"],
        "statements.csv",
    )
