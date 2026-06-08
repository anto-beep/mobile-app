"""Participants CRUD — POST/PATCH/DELETE/undo-removal.

Deletion is a 30-day soft-delete: status flips to PENDING_REMOVAL and the
row can be restored via /undo-removal until a nightly job permanently
flips it to REMOVED. (The nightly job is out of scope for Phase A — for
now PENDING_REMOVAL rows still count toward `participants_active = 0`
because we filter on status != REMOVED, but the Solo downgrade guard on
the frontend uses status === 'ACTIVE' specifically.)
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user_id
from deps import db
from models import new_id, now_iso
from routes.account import ADDON_PRICE_MONTHLY, PLAN_PRICING

router = APIRouter(prefix="/api/participants", tags=["participants"])

COLOR_SWATCH_COUNT = 5  # matches mobile palette


class ParticipantCreate(BaseModel):
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(default="", max_length=80)
    classification: int = Field(ge=1, le=8, default=4)
    provider_name: str = Field(default="Your provider", max_length=160)
    date_of_birth: Optional[str] = None


class ParticipantPatch(BaseModel):
    first_name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    last_name: Optional[str] = Field(default=None, max_length=80)
    classification: Optional[int] = Field(default=None, ge=1, le=8)
    provider_name: Optional[str] = Field(default=None, max_length=160)
    date_of_birth: Optional[str] = None
    is_primary: Optional[bool] = None


async def _account_for_user(user_id: str) -> tuple[dict, str]:
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    account_id = user.get("account_id") or user.get("household_id") or user_id
    if not user.get("account_id"):
        # Lazily set so subsequent calls are consistent.
        await db.users.update_one({"id": user_id}, {"$set": {"account_id": account_id}})
    return user, account_id


@router.post("")
async def create_participant(body: ParticipantCreate, user_id: str = Depends(get_current_user_id)):
    user, account_id = await _account_for_user(user_id)
    plan = (user.get("plan") or "free").upper()
    if plan not in PLAN_PRICING:
        plan = "FREE"
    pricing = PLAN_PRICING[plan]

    existing = await db.participants.count_documents({
        "account_id": account_id, "status": {"$ne": "REMOVED"},
    })
    if existing >= pricing["max"]:
        raise HTTPException(
            status_code=400,
            detail=f"Your {pricing['label']} plan allows up to {pricing['max']} participant(s). Upgrade or remove one first.",
        )

    # Auto add-on charging: any participant beyond `included` becomes a billable add-on row.
    needs_addon = existing >= pricing["included"] and plan != "FREE"

    is_primary = existing == 0
    color_index = existing % COLOR_SWATCH_COUNT
    first_name_clean = body.first_name.strip()
    pid = new_id()
    short = pid[:6]
    household_email = f"{first_name_clean.lower().replace(' ', '-')}-{short}@in.wayly.com.au"

    doc = {
        "id": pid,
        "account_id": account_id,
        "household_id": user.get("household_id"),
        "first_name": first_name_clean,
        "last_name": body.last_name.strip(),
        "date_of_birth": body.date_of_birth,
        "classification": body.classification,
        "provider_name": body.provider_name.strip() or "Your provider",
        "provider_id": None,
        "household_email": household_email,
        "is_primary": is_primary,
        "status": "ACTIVE",
        "color_index": color_index,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.participants.insert_one(doc)

    if needs_addon:
        await db.participant_addons.insert_one({
            "id": new_id(),
            "account_id": account_id,
            "participant_id": pid,
            "status": "ACTIVE",
            "price_monthly": ADDON_PRICE_MONTHLY,
            "created_at": now_iso(),
        })

    doc.pop("_id", None)
    return doc


@router.patch("/{participant_id}")
async def update_participant(
    participant_id: str, body: ParticipantPatch, user_id: str = Depends(get_current_user_id)
):
    _user, account_id = await _account_for_user(user_id)
    p = await db.participants.find_one({"id": participant_id}, {"_id": 0})
    if not p or p.get("account_id") != account_id:
        raise HTTPException(status_code=404, detail="Participant not found")
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        return p
    updates["updated_at"] = now_iso()
    if updates.get("is_primary"):
        # Demote any other primary to make sure we end with exactly one.
        await db.participants.update_many(
            {"account_id": account_id, "id": {"$ne": participant_id}}, {"$set": {"is_primary": False}},
        )
    await db.participants.update_one({"id": participant_id}, {"$set": updates})
    return await db.participants.find_one({"id": participant_id}, {"_id": 0})


@router.delete("/{participant_id}")
async def delete_participant(participant_id: str, user_id: str = Depends(get_current_user_id)):
    _user, account_id = await _account_for_user(user_id)
    p = await db.participants.find_one({"id": participant_id}, {"_id": 0})
    if not p or p.get("account_id") != account_id:
        raise HTTPException(status_code=404, detail="Participant not found")
    if p.get("is_primary"):
        remaining = await db.participants.count_documents({
            "account_id": account_id, "id": {"$ne": participant_id}, "status": {"$ne": "REMOVED"},
        })
        if remaining > 0:
            raise HTTPException(status_code=400, detail="Promote another participant to primary before removing this one.")
    from datetime import datetime, timezone, timedelta
    removal_at = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    await db.participants.update_one(
        {"id": participant_id},
        {"$set": {"status": "PENDING_REMOVAL", "removal_scheduled_at": removal_at, "updated_at": now_iso()}},
    )
    # Pause any addon billing for this participant.
    await db.participant_addons.update_many(
        {"participant_id": participant_id}, {"$set": {"status": "PAUSED"}}
    )
    return {"ok": True, "removal_scheduled_at": removal_at}


@router.post("/{participant_id}/undo-removal")
async def undo_removal(participant_id: str, user_id: str = Depends(get_current_user_id)):
    _user, account_id = await _account_for_user(user_id)
    p = await db.participants.find_one({"id": participant_id}, {"_id": 0})
    if not p or p.get("account_id") != account_id:
        raise HTTPException(status_code=404, detail="Participant not found")
    if p.get("status") != "PENDING_REMOVAL":
        return {"ok": True}
    await db.participants.update_one(
        {"id": participant_id},
        {"$set": {"status": "ACTIVE", "removal_scheduled_at": None, "updated_at": now_iso()}},
    )
    await db.participant_addons.update_many(
        {"participant_id": participant_id, "status": "PAUSED"}, {"$set": {"status": "ACTIVE"}}
    )
    return {"ok": True}
