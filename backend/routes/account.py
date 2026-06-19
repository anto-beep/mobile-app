"""GET /api/account — returns the participants + addons + plan summary that
the mobile (and web) clients use as the source of truth for the participant
switcher, billing tile-card, and trial banner.

Shape mirrors `frontend/src/context/ParticipantsContext.jsx` on the web.
"""
from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, Body, Depends

from auth import get_current_user_id
from deps import db

router = APIRouter(prefix="/api", tags=["account"])

# Plan pricing (AUD/month, excl. tax). Source of truth — billing.py reads from here too.
PLAN_PRICING = {
    "FREE":   {"base": 0.0,  "included": 1, "max": 1,  "label": "Free"},
    "SOLO":   {"base": 19.0, "included": 1, "max": 1,  "label": "Solo"},
    "FAMILY": {"base": 39.0, "included": 2, "max": 10, "label": "Family"},
}
ADDON_PRICE_MONTHLY = 19.0


async def build_account_payload(user_id: str) -> Dict[str, Any]:
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        return {"summary": {}, "participants": [], "addons": []}

    account_id = user.get("account_id") or user.get("household_id") or user_id
    base_plan_raw = (user.get("plan") or "free").upper()
    if base_plan_raw not in PLAN_PRICING:
        base_plan_raw = "FREE"
    pricing = PLAN_PRICING[base_plan_raw]

    parts: List[dict] = await db.participants.find(
        {"account_id": account_id}, {"_id": 0}
    ).sort([("is_primary", -1), ("created_at", 1)]).to_list(50)

    addons: List[dict] = await db.participant_addons.find(
        {"account_id": account_id, "status": "ACTIVE"}, {"_id": 0}
    ).to_list(50)

    active_parts = [p for p in parts if p.get("status") != "REMOVED"]
    addon_count = len(addons)
    addon_monthly_total = round(addon_count * ADDON_PRICE_MONTHLY, 2)
    monthly_total = round(pricing["base"] + addon_monthly_total, 2)

    summary = {
        "account_id": account_id,
        "base_plan": base_plan_raw,
        "base_plan_status": user.get("subscription_status") or ("ACTIVE" if base_plan_raw != "FREE" else "FREE"),
        "trial_ends_at": user.get("trial_ends_at"),
        "base_price_monthly": pricing["base"],
        "addon_price_monthly": ADDON_PRICE_MONTHLY,
        "addon_count": addon_count,
        "addon_monthly_total": addon_monthly_total,
        "monthly_total": monthly_total,
        "participants_included": pricing["included"],
        "participants_active": len(active_parts),
        "participants_max": pricing["max"],
        "seat_limit": 1 if base_plan_raw == "SOLO" else (3 if base_plan_raw == "FAMILY" else 1),
        "seats_used": 1,
        "pending_downgrade_to": user.get("pending_downgrade_to"),
        "pending_downgrade_at": user.get("pending_downgrade_at"),
    }

    return {
        "summary": summary,
        "participants": parts,
        "addons": addons,
    }


@router.get("/account")
async def get_account(user_id: str = Depends(get_current_user_id)):
    return await build_account_payload(user_id)


# ─────────────────── User preferences (Phase 1 — appearance) ───────────────────
@router.get("/users/me/preferences")
async def get_preferences(user_id: str = Depends(get_current_user_id)):
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "preferences": 1})
    prefs = (user or {}).get("preferences") or {}
    return {
        "appearance": prefs.get("appearance", "system"),
    }


@router.patch("/users/me/preferences")
async def patch_preferences(
    body: Dict[str, Any] = Body(...),
    user_id: str = Depends(get_current_user_id),
):
    update: Dict[str, Any] = {}
    if "appearance" in body:
        v = str(body["appearance"]).lower()
        if v not in ("light", "dark", "system"):
            from fastapi import HTTPException
            raise HTTPException(status_code=400, detail="appearance must be light|dark|system")
        update["preferences.appearance"] = v
    if not update:
        return await get_preferences(user_id)
    await db.users.update_one({"id": user_id}, {"$set": update})
    return await get_preferences(user_id)
