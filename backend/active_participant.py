"""Active-participant header dependency.

Every authenticated, data-bearing API call from the mobile client sets
`X-Participant-Id: <uuid>` (mirrors the web's `X-Participant-Id` interceptor).
This dependency resolves it to a participant dict, raising 400 if missing
and 403 if the participant doesn't belong to the caller's account.

Routes that DON'T need a participant context (auth, billing, account
summary, admin) simply don't use this dependency.

Backwards compatibility: if the header is missing AND the user has a
legacy `household_id`, we return a synthesised participant view of the
household so existing single-household callers keep working during the
migration window.
"""
from __future__ import annotations

from typing import Optional

from fastapi import Depends, Header, HTTPException

from auth import get_current_user_id
from deps import db


async def get_active_participant(
    x_participant_id: Optional[str] = Header(default=None, alias="X-Participant-Id"),
    user_id: str = Depends(get_current_user_id),
) -> dict:
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    account_id = user.get("account_id") or user.get("household_id")

    if x_participant_id:
        p = await db.participants.find_one({"id": x_participant_id}, {"_id": 0})
        if not p:
            raise HTTPException(status_code=404, detail="Participant not found")
        if account_id and p.get("account_id") != account_id:
            raise HTTPException(status_code=403, detail="Participant does not belong to this account")
        if p.get("status") == "REMOVED":
            raise HTTPException(status_code=410, detail="Participant has been removed")
        return p

    # No header — try to fall back to the primary participant of this account.
    if account_id:
        primary = await db.participants.find_one(
            {"account_id": account_id, "is_primary": True, "status": {"$ne": "REMOVED"}},
            {"_id": 0},
        )
        if primary:
            return primary
        any_p = await db.participants.find_one(
            {"account_id": account_id, "status": {"$ne": "REMOVED"}},
            {"_id": 0},
        )
        if any_p:
            return any_p

    # Last-resort: legacy household
    if user.get("household_id"):
        h = await db.households.find_one({"id": user["household_id"]}, {"_id": 0})
        if h:
            return {
                "id": h["id"],
                "account_id": h["id"],
                "household_id": h["id"],
                "first_name": h.get("participant_name", "").split(" ")[0] if h.get("participant_name") else "",
                "last_name": " ".join(h.get("participant_name", "").split(" ")[1:]) if h.get("participant_name") else "",
                "classification": h.get("classification", 4),
                "provider_name": h.get("provider_name", "Your provider"),
                "status": "ACTIVE",
                "is_primary": True,
                "color_index": 0,
            }

    raise HTTPException(status_code=400, detail="No active participant — create one first.")


async def get_active_participant_id(
    p: dict = Depends(get_active_participant),
) -> str:
    return p["id"]
