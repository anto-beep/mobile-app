"""Kindred help-chat + family-thread — extracted from server.py (P3 iter 2).

Five routes:
  * POST   /api/chat              — caregiver chat with full household context
  * GET    /api/chat/history      — replay session
  * DELETE /api/chat/history      — clear session for this household
  * POST   /api/family-thread     — append a message to the family wall
  * GET    /api/family-thread     — list family wall messages

The chat call enriches every prompt with the participant's classification,
quarterly budget, burn, lifetime cap, and latest statement summary — so the
model can answer "what's left this quarter?" without the user having to
repeat themselves. The LLM call uses the Emergent universal key with
Claude Sonnet 4.5 (`anthropic / claude-sonnet-4-5-20250929`).
"""
from __future__ import annotations

import logging
import os
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

import budget as budget_lib
from auth import get_current_user_id
from deps import db, get_user, require_household
from models import new_id, now_iso

router = APIRouter(prefix="/api", tags=["chat"])
logger = logging.getLogger("wayly")


# ─────────────────────────── request bodies ───────────────────────────────
class ChatBody(BaseModel):
    message: str
    session_id: Optional[str] = None


class FamilyMessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=2000)
    related_statement_id: Optional[str] = None


# ─────────────────────────── chat ─────────────────────────────────────────
@router.post("/chat")
async def chat(body: ChatBody, user_id: str = Depends(get_current_user_id)):
    h = await require_household(user_id)
    user = await get_user(user_id)
    classification = h["classification"]
    q_start, q_end, q_label = budget_lib.get_quarter_window()
    docs = await db.statements.find({"household_id": h["id"]}, {"_id": 0}).to_list(200)
    items: List[dict] = []
    for s in docs:
        items.extend(s.get("line_items", []))
    burn = budget_lib.compute_burn(items, q_start, q_end)
    contributions = budget_lib.compute_contributions(items)
    cap_amount = budget_lib.lifetime_cap(h.get("is_grandfathered", False))
    latest_summary = (
        sorted(docs, key=lambda d: d.get("uploaded_at", ""), reverse=True)[0].get("summary")
        if docs else "No statements uploaded yet."
    )
    burn_str = ", ".join(f"{k}: ${v:,.2f}" for k, v in burn.items())
    context = (
        f"You are Kindred — Wayly's calm aged-care helper for caregivers in Australia. "
        f"User is {user['name']} caring for {h['participant_name']} on {budget_lib.CLASSIFICATIONS[classification]['label']}. "
        f"Provider: {h['provider_name']}. Quarter: {q_label}. Quarterly budget ${budget_lib.quarterly_budget(classification):,.2f}. "
        f"Burn so far: {burn_str or 'no spend yet'}. Lifetime contributions ${contributions:,.2f} of ${cap_amount:,.2f}. "
        f"Latest statement summary: {latest_summary}. "
        "Tone: warm, plain English, never alarmist. Two-three sentences max unless asked for detail."
    )
    session_id = body.session_id or f"chat-{h['id']}"
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        api_key = os.environ.get("EMERGENT_LLM_KEY")
        if not api_key:
            raise RuntimeError("EMERGENT_LLM_KEY not set")
        chat_inst = (
            LlmChat(api_key=api_key, session_id=session_id, system_message=context)
            .with_model("anthropic", "claude-sonnet-4-5-20250929")
            .with_params(max_tokens=600)
        )
        reply = await chat_inst.send_message(UserMessage(text=body.message))
        reply_text = str(reply or "")
    except Exception:
        logger.exception("chat failed")
        reply_text = "I'm having trouble reaching my brain at the moment — try again in a minute."

    await db.chat_turns.insert_many([
        {"id": new_id(), "household_id": h["id"], "role": "user", "content": body.message, "created_at": now_iso()},
        {"id": new_id(), "household_id": h["id"], "role": "assistant", "content": reply_text, "created_at": now_iso()},
    ])
    return {"reply": reply_text, "session_id": session_id}


@router.get("/chat/history")
async def chat_history(user_id: str = Depends(get_current_user_id)):
    h = await require_household(user_id)
    return (
        await db.chat_turns.find({"household_id": h["id"]}, {"_id": 0})
        .sort("created_at", 1)
        .to_list(500)
    )


@router.delete("/chat/history")
async def chat_history_clear(user_id: str = Depends(get_current_user_id)):
    h = await require_household(user_id)
    result = await db.chat_turns.delete_many({"household_id": h["id"]})
    return {"ok": True, "deleted": result.deleted_count}


# ─────────────────────────── family thread ────────────────────────────────
@router.post("/family-thread")
async def post_family_message(
    payload: FamilyMessageCreate, user_id: str = Depends(get_current_user_id)
):
    h = await require_household(user_id)
    user = await get_user(user_id)
    msg = {
        "id": new_id(),
        "household_id": h["id"],
        "author_id": user_id,
        "author_name": user["name"],
        "body": payload.body,
        "related_statement_id": payload.related_statement_id,
        "created_at": now_iso(),
    }
    response = dict(msg)  # snapshot before Mongo mutates with _id
    await db.family_messages.insert_one(msg)
    return response


@router.get("/family-thread")
async def list_family_messages(user_id: str = Depends(get_current_user_id)):
    h = await require_household(user_id)
    return (
        await db.family_messages.find({"household_id": h["id"]}, {"_id": 0})
        .sort("created_at", 1)
        .to_list(500)
    )
