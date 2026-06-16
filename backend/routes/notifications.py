"""Notifications + push-token registry — extracted from server.py (P3).

Five routes:
  * GET    /api/notifications              — list 50 most recent for the caller + unread count
  * POST   /api/notifications/read         — bulk mark-as-read (single id, or no ids = all)
  * POST   /api/notifications/register-push — upsert an Expo push token for the device
  * DELETE /api/notifications/register-push — invalidate this device's token on sign-out
  * POST   /api/notifications/test         — dev/QA helper that fires a sample push + in-app notif

Owns all three Pydantic request bodies (PushTokenUnregister, NotificationReadBody,
TestPushBody). Push delivery itself goes through `deps.push_to_user`.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from auth import get_current_user_id
from deps import db, get_household, push_to_user
from models import NotificationItem, PushTokenRegister, now_iso

router = APIRouter(prefix="/api", tags=["notifications"])
logger = logging.getLogger("wayly")


# ─────────────────────────── request models ───────────────────────────────
class PushTokenUnregister(BaseModel):
    expo_push_token: str


class NotificationReadBody(BaseModel):
    ids: List[str] = Field(default_factory=list)


class TestPushBody(BaseModel):
    type: str = Field(default="statement_ready")
    title: Optional[str] = None
    body: Optional[str] = None
    statement_id: Optional[str] = None
    visit_id: Optional[str] = None
    client_id: Optional[str] = None
    deeplink: Optional[str] = None


# ─────────────────────────── routes ───────────────────────────────────────
@router.get("/notifications")
async def list_notifications(user_id: str = Depends(get_current_user_id)):
    docs = (
        await db.notifications.find({"user_id": user_id}, {"_id": 0})
        .sort("created_at", -1)
        .limit(50)
        .to_list(50)
    )
    unread = await db.notifications.count_documents({"user_id": user_id, "read": False})
    return {"items": docs, "unread": unread}


@router.post("/notifications/read")
async def mark_read(body: NotificationReadBody, user_id: str = Depends(get_current_user_id)):
    q: dict = {"user_id": user_id}
    if body.ids:
        q["id"] = {"$in": body.ids}
    res = await db.notifications.update_many(
        q, {"$set": {"read": True, "read_at": now_iso()}}
    )
    return {"ok": True, "modified": res.modified_count}


@router.post("/notifications/register-push")
async def register_push(
    body: PushTokenRegister, user_id: str = Depends(get_current_user_id)
):
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


@router.delete("/notifications/register-push")
async def unregister_push(
    body: PushTokenUnregister, user_id: str = Depends(get_current_user_id)
):
    """Phase 3 hardening: invalidate THIS device's push token without nuking
    other devices owned by the same user. Called from the mobile client when
    the user logs out, so notifications stop landing on the signed-out device."""
    await db.push_tokens.delete_one(
        {"user_id": user_id, "expo_push_token": body.expo_push_token}
    )
    return {"ok": True}


@router.post("/notifications/test")
async def notifications_test(
    payload: TestPushBody, user_id: str = Depends(get_current_user_id)
):
    """Dev/QA helper: fire a sample push + in-app notification to the caller so the
    NotificationRouter on mobile can be exercised end-to-end. Returns the deeplink
    we resolved + the persisted NotificationItem id."""
    deeplink = payload.deeplink
    statement_id = payload.statement_id
    visit_id = payload.visit_id
    client_id = payload.client_id

    if not deeplink:
        if payload.type in ("statement_ready", "anomaly_alert"):
            if not statement_id:
                h = await get_household(user_id)
                if h:
                    s = await db.statements.find_one(
                        {"household_id": h["id"]},
                        {"id": 1, "_id": 0},
                        sort=[("uploaded_at", -1)],
                    )
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

    data: Dict[str, Any] = {
        "type": payload.type,
        "deeplink": deeplink,
        "notification_id": note.id,
    }
    if statement_id:
        data["statement_id"] = statement_id
    if visit_id:
        data["visit_id"] = visit_id
    if client_id:
        data["client_id"] = client_id
    await push_to_user(user_id, title, body_text, data)
    return {
        "ok": True,
        "deeplink": deeplink,
        "notification_id": note.id,
        "data": data,
    }
