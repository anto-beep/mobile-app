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


@router.post("/budget/alerts")
async def create_budget_alert(
    body: Dict[str, Any] = Body(...),
    p: dict = Depends(get_active_participant),
    user_id: str = Depends(get_current_user_id),
):
    """Configure a new threshold-style budget alert (per-stream % cap)."""
    stream = (body.get("stream") or "ALL").upper().replace(" ", "_")
    try:
        threshold = float(body.get("threshold_pct") or body.get("threshold") or 80)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="threshold_pct must be a number")
    threshold = max(1.0, min(threshold, 100.0))
    doc = {
        "id": new_id(),
        "participant_id": p["id"],
        "user_id": user_id,
        "stream": stream,
        "threshold_pct": threshold,
        "email_me": bool(body.get("email_me", True)),
        "active": True,
        "created_at": now_iso(),
    }
    await db.budget_alerts.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.delete("/budget/alerts/{alert_id}")
async def delete_budget_alert(
    alert_id: str,
    p: dict = Depends(get_active_participant),
):
    res = await db.budget_alerts.delete_one({"id": alert_id, "participant_id": p["id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Alert not found")
    return {"ok": True}


# ─────────────────────── HOSPITAL LIAISON (stays) ───────────────────────
@router.get("/hospital/admissions")
async def list_hospital_admissions(p: dict = Depends(get_active_participant)):
    cur = db.hospital_admissions.find(
        {"participant_id": p["id"]}, {"_id": 0}
    ).sort("admitted_at", -1).limit(50)
    return {"items": await cur.to_list(50)}


@router.post("/hospital/admissions")
async def create_hospital_admission(
    body: Dict[str, Any] = Body(...),
    p: dict = Depends(get_active_participant),
    user_id: str = Depends(get_current_user_id),
):
    hospital = (body.get("hospital") or "").strip()
    admitted_at = (body.get("admitted_at") or "").strip()
    if not hospital:
        raise HTTPException(status_code=400, detail="hospital is required")
    if not admitted_at:
        raise HTTPException(status_code=400, detail="admitted_at is required")
    doc = {
        "id": new_id(),
        "participant_id": p["id"],
        "user_id": user_id,
        "hospital": hospital[:200],
        "reason": (body.get("reason") or "")[:500],
        "admitted_at": admitted_at,
        "discharged_at": body.get("discharged_at"),
        "restorative_pathway": bool(body.get("restorative_pathway", False)),
        "services_paused": bool(body.get("services_paused", True)),
        "notes": (body.get("notes") or "")[:2000],
        "status": "ADMITTED" if not body.get("discharged_at") else "DISCHARGED",
        "created_at": now_iso(),
    }
    await db.hospital_admissions.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.patch("/hospital/admissions/{admission_id}")
async def update_hospital_admission(
    admission_id: str,
    body: Dict[str, Any] = Body(...),
    p: dict = Depends(get_active_participant),
):
    update: Dict[str, Any] = {}
    for key in ("discharged_at", "reason", "notes", "restorative_pathway", "services_paused"):
        if key in body:
            update[key] = body[key]
    if update.get("discharged_at"):
        update["status"] = "DISCHARGED"
    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")
    update["updated_at"] = now_iso()
    res = await db.hospital_admissions.update_one(
        {"id": admission_id, "participant_id": p["id"]},
        {"$set": update},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Admission not found")
    doc = await db.hospital_admissions.find_one(
        {"id": admission_id, "participant_id": p["id"]}, {"_id": 0}
    )
    return doc


@router.delete("/hospital/admissions/{admission_id}")
async def delete_hospital_admission(
    admission_id: str,
    p: dict = Depends(get_active_participant),
):
    res = await db.hospital_admissions.delete_one({"id": admission_id, "participant_id": p["id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Admission not found")
    return {"ok": True}


# ─────────────────────── REPORTS (summary index) ───────────────────────
# Replaced by routes/reports.py which owns the full Reports tab now —
# per-participant library, 8 report types, persisted PDFs.


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


@router.post("/provider-switch/start")
async def provider_switch_start(
    body: Dict[str, Any] = Body(...),
    p: dict = Depends(get_active_participant),
    user_id: str = Depends(get_current_user_id),
):
    new_provider = (body.get("new_provider") or "").strip()
    if not new_provider:
        raise HTTPException(status_code=400, detail="new_provider is required")
    doc = {
        "id": new_id(),
        "participant_id": p["id"],
        "created_by": user_id,
        "in_progress": True,
        "current_provider": p.get("provider_name", "Your provider"),
        "new_provider": new_provider,
        "reason": (body.get("reason") or "")[:500],
        "target_date": body.get("target_date"),
        "status": "DRAFT",
        "created_at": now_iso(),
    }
    await db.provider_switches.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.post("/provider-switch/cancel")
async def provider_switch_cancel(p: dict = Depends(get_active_participant)):
    await db.provider_switches.update_many(
        {"participant_id": p["id"], "in_progress": True},
        {"$set": {"in_progress": False, "status": "CANCELLED", "updated_at": now_iso()}},
    )
    return {"ok": True}


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
        "provider_name": (body.get("provider_name") or "").strip()[:120],
        "would_recommend": bool(body.get("would_recommend", True)),
        "comment": (body.get("comment") or "")[:500],
        "created_at": now_iso(),
    }
    await db.provider_ratings.insert_one(item)
    item.pop("_id", None)
    return item


@router.delete("/ratings/{rating_id}")
async def delete_rating(
    rating_id: str,
    p: dict = Depends(get_active_participant),
):
    res = await db.provider_ratings.delete_one({"id": rating_id, "participant_id": p["id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Rating not found")
    return {"ok": True}


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
    """Unified activity log. We don't have a dedicated `audit_log` collection
    on this backend, so we synthesise the audit trail by pulling recent
    write events from the existing domain collections and merging them on
    `created_at`. This mirrors the web app's "every privacy-sensitive
    action" timeline.
    """
    from deps import get_user as _get_user

    user = await _get_user(user_id)
    user_email = (user or {}).get("email", "")
    household_id = (user or {}).get("household_id")

    events: List[Dict[str, Any]] = []

    # Statements — upload + decode runs
    async for s in db.statements.find(
        {"user_id": user_id}, {"_id": 0, "id": 1, "provider": 1, "period": 1,
                               "uploaded_at": 1, "status": 1, "decoded_at": 1}
    ).sort("uploaded_at", -1).limit(50):
        if s.get("uploaded_at"):
            events.append({
                "id": f"stmt-up-{s.get('id')}",
                "action": "Statement uploaded",
                "detail": f"{s.get('provider', 'Statement')} · {s.get('period', '')}".strip(' ·'),
                "kind": "statement",
                "user_email": user_email,
                "created_at": s.get("uploaded_at"),
            })
        if s.get("decoded_at"):
            events.append({
                "id": f"stmt-dec-{s.get('id')}",
                "action": "Statement decoded",
                "detail": f"{s.get('provider', 'Statement')} · {s.get('period', '')}".strip(' ·'),
                "kind": "decoder",
                "user_email": user_email,
                "created_at": s.get("decoded_at"),
            })

    # Amendments — submissions + status updates
    async for a in db.amendments.find(
        {"user_id": user_id} if household_id is None else {"$or": [{"user_id": user_id}, {"household_id": household_id}]},
        {"_id": 0, "id": 1, "subject": 1, "status": 1, "created_at": 1, "updated_at": 1}
    ).sort("created_at", -1).limit(50):
        events.append({
            "id": f"amend-{a.get('id')}",
            "action": f"Amendment {str(a.get('status', 'created')).lower()}",
            "detail": a.get("subject") or "Care plan change",
            "kind": "amendment",
            "user_email": user_email,
            "created_at": a.get("updated_at") or a.get("created_at"),
        })

    # Documents — uploads
    async for d in db.documents.find(
        {"user_id": user_id}, {"_id": 0, "id": 1, "filename": 1, "uploaded_at": 1, "kind": 1}
    ).sort("uploaded_at", -1).limit(40):
        events.append({
            "id": f"doc-{d.get('id')}",
            "action": "Document uploaded",
            "detail": d.get("filename") or d.get("kind") or "Document",
            "kind": "document",
            "user_email": user_email,
            "created_at": d.get("uploaded_at"),
        })

    # Visits — created
    async for v in db.visits.find(
        {"household_id": household_id} if household_id else {"user_id": user_id},
        {"_id": 0, "id": 1, "title": 1, "starts_at": 1, "created_at": 1, "kind": 1}
    ).sort("created_at", -1).limit(40):
        events.append({
            "id": f"visit-{v.get('id')}",
            "action": "Visit added",
            "detail": v.get("title") or (v.get("kind") or "Visit"),
            "kind": "visit",
            "user_email": user_email,
            "created_at": v.get("created_at"),
        })

    # Family wall posts (audit who shared what)
    async for f in db.family_events.find(
        {"author_id": user_id}, {"_id": 0, "id": 1, "kind": 1, "text": 1, "created_at": 1}
    ).sort("created_at", -1).limit(40):
        snippet = (f.get("text") or "").strip()
        if len(snippet) > 80:
            snippet = snippet[:77].rstrip() + "…"
        events.append({
            "id": f"wall-{f.get('id')}",
            "action": "Family wall post",
            "detail": snippet or f"{(f.get('kind') or 'note').title()}",
            "kind": "wall",
            "user_email": user_email,
            "created_at": f.get("created_at"),
        })

    # Login events from chat_turns (rough proxy) — skipped for now to keep
    # the feed focused on user-meaningful actions.

    # Merge any rows that may exist in the dedicated audit_log collection
    # (kept for future when we wire explicit logging hooks).
    async for row in db.audit_log.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1).limit(50):
        events.append({
            "id": row.get("id") or f"audit-{row.get('created_at')}",
            "action": row.get("action") or "Event",
            "detail": row.get("detail") or row.get("description") or "",
            "kind": row.get("kind") or "system",
            "user_email": row.get("user_email") or user_email,
            "created_at": row.get("created_at"),
        })

    # Filter out anything without a timestamp and sort newest-first.
    events = [e for e in events if e.get("created_at")]
    events.sort(key=lambda e: str(e.get("created_at", "")), reverse=True)

    return {"items": events[:limit]}


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
    image_b64 = body.get("image_b64") or None
    audio_b64 = body.get("audio_b64") or None
    audio_duration_ms = body.get("audio_duration_ms")
    # Either text, image, or audio must be present.
    if not text and not image_b64 and not audio_b64:
        raise HTTPException(status_code=400, detail="text, image_b64 or audio_b64 is required")
    # Trim out any data-URL prefix so consumers can render uniformly.
    if isinstance(image_b64, str) and image_b64.startswith("data:"):
        image_b64 = image_b64.split(",", 1)[-1]
    if isinstance(audio_b64, str) and audio_b64.startswith("data:"):
        audio_b64 = audio_b64.split(",", 1)[-1]
    # Soft caps: ~4MB of base64 ≈ ~3MB raw — enough for a short voice/photo note.
    MAX_B64 = 6_000_000
    if image_b64 and len(image_b64) > MAX_B64:
        raise HTTPException(status_code=413, detail="image too large (max ~4 MB)")
    if audio_b64 and len(audio_b64) > MAX_B64:
        raise HTTPException(status_code=413, detail="audio clip too long (max ~4 MB)")
    item = {
        "id": new_id(),
        "participant_id": p["id"],
        "author_id": user_id,
        "kind": body.get("kind") or ("photo" if image_b64 else ("voice" if audio_b64 else "note")),
        "text": (text or "")[:2000],
        "image_b64": image_b64,
        "audio_b64": audio_b64,
        "audio_duration_ms": int(audio_duration_ms) if isinstance(audio_duration_ms, (int, float)) and audio_duration_ms else None,
        "image_mime": body.get("image_mime") or None,
        "audio_mime": body.get("audio_mime") or None,
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
