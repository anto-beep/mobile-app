"""Participant view + wellbeing — extracted from server.py (P3 iter 3).

Three routes:
  * GET  /api/participant/today      — single-glance "what's happening today" card
  * POST /api/participant/wellbeing  — log mood + optionally notify caregiver
  * GET  /api/participant/wellbeing  — last 14 wellbeing check-ins

The wellbeing post fires a push notification to the household owner when the
participant marks a 'not_great' day with notify_caregiver=True.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

import budget as budget_lib
from auth import get_current_user_id
from deps import db, get_household, get_user, push_to_user, require_household
from models import NotificationItem, new_id, now_iso

router = APIRouter(prefix="/api", tags=["participant"])
logger = logging.getLogger("wayly")


@router.get("/participant/today")
async def participant_today(user_id: str = Depends(get_current_user_id)):
    h = await require_household(user_id)
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
        "caregiver_name": (await get_user(h.get("owner_id", user_id)))["name"],
    }


class WellbeingBody(BaseModel):
    mood: str = Field(pattern="^(good|okay|not_great)$")
    notify_caregiver: bool = False


@router.post("/participant/wellbeing")
async def log_wellbeing(body: WellbeingBody, user_id: str = Depends(get_current_user_id)):
    h = await get_household(user_id)
    user = await get_user(user_id)
    doc = {
        "id": new_id(),
        "user_id": user_id,
        "household_id": h["id"] if h else None,
        "mood": body.mood,
        "notify_caregiver": body.notify_caregiver,
        "created_at": now_iso(),
    }
    await db.wellbeing.insert_one(doc)
    if (
        h
        and body.mood == "not_great"
        and body.notify_caregiver
        and h.get("owner_id")
        and h["owner_id"] != user_id
    ):
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
        await push_to_user(
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


@router.get("/participant/wellbeing")
async def recent_wellbeing(user_id: str = Depends(get_current_user_id)):
    h = await get_household(user_id)
    if not h:
        return []
    return (
        await db.wellbeing.find({"household_id": h["id"]}, {"_id": 0})
        .sort("created_at", -1)
        .limit(14)
        .to_list(14)
    )
