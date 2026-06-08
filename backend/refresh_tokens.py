"""Refresh-token rotation (Phase A).

The web client uses a paired access-JWT + long-lived refresh-token. On any
401 the client posts the refresh token to /api/auth/refresh and swaps it
for a new pair, then retries the original request (web does it once,
deduplicated via in-flight Promise). Mobile mirrors that.

Refresh tokens are random URL-safe strings, persisted in MongoDB with a
hashed lookup column and TTL. We persist a hash (sha256 hex) — never the
raw token — so even a DB leak doesn't let an attacker mint sessions.

Each refresh ROTATES: the consumed refresh-token is deleted, a fresh one
is issued. This mitigates replay if an old refresh token is stolen.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Tuple

from deps import db

REFRESH_TOKEN_TTL_DAYS = 60   # 60-day sliding window
ACCESS_TOKEN_TTL_HOURS = 24   # 24h access window (auth.py uses 30d JWT — we override conceptually)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def issue_refresh_token(user_id: str) -> str:
    """Generate, persist (hashed), and return a fresh refresh token."""
    raw = secrets.token_urlsafe(48)
    expires_at = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_TTL_DAYS)
    await db.refresh_tokens.insert_one({
        "token_hash": _hash(raw),
        "user_id": user_id,
        "expires_at": expires_at,
        "created_at": datetime.now(timezone.utc),
    })
    return raw


async def consume_refresh_token(raw: str) -> Tuple[str, str]:
    """Validate + rotate. Returns (user_id, new_refresh_token). Raises ValueError on failure."""
    h = _hash(raw)
    doc = await db.refresh_tokens.find_one({"token_hash": h})
    if not doc:
        raise ValueError("Invalid refresh token")
    expires_at = doc.get("expires_at")
    # Mongo round-trips datetimes naive → coerce to UTC
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at < datetime.now(timezone.utc):
        await db.refresh_tokens.delete_one({"token_hash": h})
        raise ValueError("Refresh token expired")
    # Rotate
    await db.refresh_tokens.delete_one({"token_hash": h})
    new_raw = await issue_refresh_token(doc["user_id"])
    return doc["user_id"], new_raw


async def revoke_all_for_user(user_id: str) -> int:
    res = await db.refresh_tokens.delete_many({"user_id": user_id})
    return res.deleted_count or 0
