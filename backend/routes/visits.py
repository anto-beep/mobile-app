"""Visits / Calendar — extracted from server.py.

Owns the CRUD surface for clinical / home / telehealth visits attached to a
household. Wire-compatible with the iter30 implementation that previously
lived inline in server.py.
"""
from __future__ import annotations

from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user_id
from deps import db, get_household, require_household
from models import new_id, now_iso

router = APIRouter(prefix="/api", tags=["visits"])

VISIT_KINDS = ["appointment", "home_visit", "telehealth", "assessment", "other"]


class VisitIn(BaseModel):
    title: str = Field(min_length=1, max_length=140)
    starts_at: str = Field(min_length=10)  # ISO datetime
    duration_minutes: int = Field(ge=5, le=24 * 60, default=60)
    location: Optional[str] = Field(default="", max_length=200)
    provider: Optional[str] = Field(default="", max_length=120)
    kind: str = "appointment"
    notes: Optional[str] = Field(default="", max_length=600)


class VisitPatch(BaseModel):
    title: Optional[str] = None
    starts_at: Optional[str] = None
    duration_minutes: Optional[int] = None
    location: Optional[str] = None
    provider: Optional[str] = None
    kind: Optional[str] = None
    notes: Optional[str] = None


def _validate_visit_kind(k: str) -> None:
    if k not in VISIT_KINDS:
        raise HTTPException(
            status_code=422,
            detail=f"kind must be one of: {', '.join(VISIT_KINDS)}",
        )


@router.get("/visits")
async def visits_list(upcoming_only: bool = False, user_id: str = Depends(get_current_user_id)):
    h = await get_household(user_id)
    if not h:
        return []
    q: Dict = {"household_id": h["id"]}
    if upcoming_only:
        q["starts_at"] = {"$gte": now_iso()}
    rows = await db.visits.find(q, {"_id": 0}).sort("starts_at", 1 if upcoming_only else -1).to_list(500)
    return rows


@router.post("/visits")
async def visits_create(payload: VisitIn, user_id: str = Depends(get_current_user_id)):
    h = await require_household(user_id)
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


@router.get("/visits/{vid}")
async def visits_detail(vid: str, user_id: str = Depends(get_current_user_id)):
    h = await require_household(user_id)
    v = await db.visits.find_one({"id": vid, "household_id": h["id"]}, {"_id": 0})
    if not v:
        raise HTTPException(status_code=404, detail="Visit not found.")
    return v


@router.patch("/visits/{vid}")
async def visits_update(vid: str, payload: VisitPatch, user_id: str = Depends(get_current_user_id)):
    h = await require_household(user_id)
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


@router.delete("/visits/{vid}")
async def visits_delete(vid: str, user_id: str = Depends(get_current_user_id)):
    h = await require_household(user_id)
    res = await db.visits.delete_one({"id": vid, "household_id": h["id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Visit not found.")
    return {"ok": True}
