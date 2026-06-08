"""Scaffold endpoints for Phase C modules that don't have a backend yet.

Each route returns either an empty list / a default object so the mobile
screens can fetch + render their empty state without 404'ing. Follow-up
sessions will replace these stubs with full implementations (writes,
business logic, indexes, etc.).

Convention: every endpoint is scoped to the active participant via the
`X-Participant-Id` header (the existing `active_participant` dependency).
That way the frontend's participantSig refetch loop already does the right
thing when a user switches participants.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from active_participant import get_active_participant
from auth import get_current_user_id
from deps import db
from models import new_id, now_iso

router = APIRouter(prefix="/api", tags=["scaffold"])


async def _list(collection: str, p: dict, limit: int = 50) -> List[Dict[str, Any]]:
    cursor = db[collection].find({"participant_id": p["id"]}, {"_id": 0}).sort("created_at", -1).limit(limit)
    return await cursor.to_list(limit)


# ─────────────────────── BUDGET ALERTS ───────────────────────
@router.get("/budget/alerts")
async def list_budget_alerts(p: dict = Depends(get_active_participant)):
    return {"items": await _list("budget_alerts", p), "active_participant_id": p["id"]}


# ─────────────────────── REPORTS (summary index) ───────────────────────
@router.get("/reports")
async def list_reports(p: dict = Depends(get_active_participant)):
    # The existing /reports/summary.pdf endpoint already generates a PDF
    # on demand. This endpoint surfaces the *index* of previously-generated
    # reports (a future migration will persist them).
    items = await _list("generated_reports", p)
    return {"items": items, "active_participant_id": p["id"]}


# ─────────────────────── HOSPITAL HANDOVER ───────────────────────
@router.get("/hospital/handover")
async def get_hospital_handover(p: dict = Depends(get_active_participant)):
    doc = await db.hospital_handovers.find_one({"participant_id": p["id"]}, {"_id": 0})
    return doc or {
        "participant_id": p["id"],
        "summary": "",
        "medications": [],
        "allergies": [],
        "emergency_contact": None,
        "last_updated": None,
    }


@router.post("/hospital/handover")
async def upsert_hospital_handover(
    body: Dict[str, Any] = Body(...),
    p: dict = Depends(get_active_participant),
):
    payload = {**body, "participant_id": p["id"], "last_updated": now_iso()}
    await db.hospital_handovers.update_one(
        {"participant_id": p["id"]}, {"$set": payload}, upsert=True
    )
    return payload


# ─────────────────────── AT-HM (Assistive Tech & Home Mods) ───────────────────────
@router.get("/at-hm")
async def list_at_hm(p: dict = Depends(get_active_participant)):
    return {"items": await _list("at_hm_items", p), "active_participant_id": p["id"]}


@router.post("/at-hm")
async def create_at_hm(
    body: Dict[str, Any] = Body(...),
    p: dict = Depends(get_active_participant),
    user_id: str = Depends(get_current_user_id),
):
    item = {
        "id": new_id(),
        "participant_id": p["id"],
        "created_by": user_id,
        "created_at": now_iso(),
        **body,
    }
    await db.at_hm_items.insert_one(item)
    item.pop("_id", None)
    return item


# ─────────────────────── AMENDMENTS ───────────────────────
@router.get("/amendments")
async def list_amendments(p: dict = Depends(get_active_participant)):
    return {"items": await _list("amendments", p), "active_participant_id": p["id"]}


@router.post("/amendments")
async def create_amendment(
    body: Dict[str, Any] = Body(...),
    p: dict = Depends(get_active_participant),
    user_id: str = Depends(get_current_user_id),
):
    item = {
        "id": new_id(),
        "participant_id": p["id"],
        "created_by": user_id,
        "status": body.get("status", "OPEN"),
        "created_at": now_iso(),
        **body,
    }
    await db.amendments.insert_one(item)
    item.pop("_id", None)
    return item


# ─────────────────────── CORRESPONDENCE ───────────────────────
@router.get("/correspondence")
async def list_correspondence(p: dict = Depends(get_active_participant)):
    return {"items": await _list("correspondence", p), "active_participant_id": p["id"]}


# ─────────────────────── PROVIDER SWITCH ───────────────────────
@router.get("/provider-switch/status")
async def provider_switch_status(p: dict = Depends(get_active_participant)):
    doc = await db.provider_switches.find_one(
        {"participant_id": p["id"]}, {"_id": 0}, sort=[("created_at", -1)]
    )
    if not doc:
        return {"in_progress": False, "current_provider": p.get("provider_name", "Your provider")}
    return doc


# ─────────────────────── PROVIDER RATINGS ───────────────────────
@router.get("/ratings")
async def list_ratings(p: dict = Depends(get_active_participant)):
    return {"items": await _list("provider_ratings", p), "active_participant_id": p["id"]}


@router.post("/ratings")
async def create_rating(
    body: Dict[str, Any] = Body(...),
    p: dict = Depends(get_active_participant),
    user_id: str = Depends(get_current_user_id),
):
    score = int(body.get("score", 0))
    if score < 1 or score > 5:
        raise HTTPException(status_code=400, detail="score must be 1-5")
    item = {
        "id": new_id(),
        "participant_id": p["id"],
        "created_by": user_id,
        "score": score,
        "comment": (body.get("comment") or "")[:500],
        "created_at": now_iso(),
    }
    await db.provider_ratings.insert_one(item)
    item.pop("_id", None)
    return item


# ─────────────────────── REFERRALS ───────────────────────
@router.get("/referrals")
async def list_referrals(p: dict = Depends(get_active_participant)):
    return {"items": await _list("referrals", p), "active_participant_id": p["id"]}


# ─────────────────────── AUDIT TRAIL ───────────────────────
@router.get("/audit")
async def audit_trail(
    user_id: str = Depends(get_current_user_id),
    limit: int = Query(50, ge=1, le=200),
):
    cursor = db.audit_log.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).limit(limit)
    return {"items": await cursor.to_list(limit)}


# ─────────────────────── FAMILY WALL (events feed) ───────────────────────
@router.get("/family/wall")
async def family_wall(p: dict = Depends(get_active_participant), limit: int = Query(50, ge=1, le=200)):
    cursor = db.family_events.find({"participant_id": p["id"]}, {"_id": 0}).sort("created_at", -1).limit(limit)
    items = await cursor.to_list(limit)
    return {"items": items, "active_participant_id": p["id"]}


@router.post("/family/wall")
async def post_family_event(
    body: Dict[str, Any] = Body(...),
    p: dict = Depends(get_active_participant),
    user_id: str = Depends(get_current_user_id),
):
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    item = {
        "id": new_id(),
        "participant_id": p["id"],
        "author_id": user_id,
        "kind": body.get("kind", "note"),
        "text": text[:2000],
        "created_at": now_iso(),
    }
    await db.family_events.insert_one(item)
    item.pop("_id", None)
    return item


# ─────────────────────── GLOBAL SEARCH ───────────────────────
@router.get("/search")
async def global_search(
    q: str = Query("", min_length=0, max_length=128),
    user_id: str = Depends(get_current_user_id),
    p: Optional[dict] = Depends(get_active_participant),
):
    q = q.strip()
    if not q:
        return {"q": q, "groups": []}

    qrx = {"$regex": q, "$options": "i"}
    groups: List[Dict[str, Any]] = []

    # Statements (provider, period, anomaly notes)
    stmt_filter = {"user_id": user_id, "$or": [{"provider": qrx}, {"period": qrx}]}
    stmts = await db.statements.find(stmt_filter, {"_id": 0}).limit(8).to_list(8)
    if stmts:
        groups.append({
            "kind": "statement",
            "label": "Statements",
            "items": [{
                "id": s.get("id"),
                "title": f"{s.get('provider', 'Statement')} · {s.get('period', '')}",
                "subtitle": s.get("status", ""),
                "deeplink": f"/statements/{s.get('id')}",
            } for s in stmts],
        })

    # Documents (filename)
    docs = await db.documents.find(
        {"user_id": user_id, "filename": qrx}, {"_id": 0}
    ).limit(8).to_list(8)
    if docs:
        groups.append({
            "kind": "document",
            "label": "Documents",
            "items": [{
                "id": d.get("id"),
                "title": d.get("filename") or "Document",
                "subtitle": d.get("kind", "document"),
                "deeplink": f"/documents/{d.get('id')}",
            } for d in docs],
        })

    # Visits (title)
    visits = await db.visits.find(
        {"user_id": user_id, "$or": [{"title": qrx}, {"notes": qrx}]}, {"_id": 0}
    ).limit(8).to_list(8)
    if visits:
        groups.append({
            "kind": "visit",
            "label": "Visits",
            "items": [{
                "id": v.get("id"),
                "title": v.get("title") or "Visit",
                "subtitle": v.get("starts_at", ""),
                "deeplink": "/visits",
            } for v in visits],
        })

    return {"q": q, "groups": groups}
