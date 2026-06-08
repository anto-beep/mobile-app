"""Billing — six endpoints + Stripe webhook.

This module is **safe to call even when a real Stripe key is not
configured**. The integration-playbook detects `sk_test_emergent` (the
placeholder shipped in the pod env) and runs in *stub mode*: writes flow
through to MongoDB so the mobile UI can be exercised end-to-end (trial
start, plan switch, cancel, downgrade) without ever calling Stripe.

When a real `sk_test_*` or `sk_live_*` key lands in `STRIPE_API_KEY`, the
module automatically swaps to real Stripe Checkout Sessions.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from auth import get_current_user_id
from deps import db
from models import new_id, now_iso
from routes.account import ADDON_PRICE_MONTHLY, PLAN_PRICING

logger = logging.getLogger("wayly.billing")

STRIPE_KEY = os.environ.get("STRIPE_API_KEY", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
STRIPE_AVAILABLE = STRIPE_KEY.startswith(("sk_test_", "sk_live_")) and "emergent" not in STRIPE_KEY

if STRIPE_AVAILABLE:
    import stripe  # noqa: E402
    stripe.api_key = STRIPE_KEY
else:
    logger.warning(
        "Billing running in STUB MODE — STRIPE_API_KEY is placeholder. Set a real sk_test_* or sk_live_* key to enable Stripe Checkout."
    )
    stripe = None

router = APIRouter(prefix="/api/billing", tags=["billing"])


class _PlanBody(BaseModel):
    plan: str = Field(pattern=r"^(solo|family|SOLO|FAMILY)$")


class _CheckoutBody(_PlanBody):
    origin_url: str = Field(default="wayly://", max_length=512)


async def _user(user_id: str) -> dict:
    u = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    return u


def _normalise_plan(raw: str) -> str:
    p = raw.upper()
    if p not in ("FREE", "SOLO", "FAMILY"):
        raise HTTPException(status_code=400, detail="Unknown plan")
    return p


# ───────────────────── GET /subscription ─────────────────────
@router.get("/subscription")
async def get_subscription(user_id: str = Depends(get_current_user_id)):
    u = await _user(user_id)
    plan = (u.get("plan") or "free").upper()
    return {
        "plan": plan,
        "status": u.get("subscription_status") or ("active" if plan != "FREE" else None),
        "trial_ends_at": u.get("trial_ends_at"),
        "current_period_end": u.get("current_period_end"),
        "cancel_at_period_end": bool(u.get("cancel_at_period_end", False)),
        "stripe_customer_id": u.get("stripe_customer_id"),
        "stripe_subscription_id": u.get("stripe_subscription_id"),
        "stub_mode": not STRIPE_AVAILABLE,
    }


# ───────────────────── POST /start-trial ─────────────────────
@router.post("/start-trial")
async def start_trial(body: _PlanBody, user_id: str = Depends(get_current_user_id)):
    plan = _normalise_plan(body.plan)
    if plan == "FREE":
        raise HTTPException(status_code=400, detail="Cannot start a trial on the Free plan.")
    u = await _user(user_id)
    if u.get("trial_used"):
        raise HTTPException(status_code=400, detail="trial_used")
    if u.get("subscription_status") in ("active", "trialing"):
        raise HTTPException(status_code=400, detail="You already have an active subscription.")
    trial_end = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    await db.users.update_one({"id": user_id}, {"$set": {
        "plan": plan.lower(),
        "subscription_status": "trialing",
        "trial_used": True,
        "trial_ends_at": trial_end,
        "cancel_at_period_end": False,
    }})
    return {
        "ok": True,
        "plan": plan,
        "trial_ends_at": trial_end,
        "status": "trialing",
    }


# ───────────────────── POST /checkout ─────────────────────
@router.post("/checkout")
async def checkout(body: _CheckoutBody, user_id: str = Depends(get_current_user_id)):
    plan = _normalise_plan(body.plan)
    u = await _user(user_id)

    if not STRIPE_AVAILABLE:
        # Stub mode: simulate a successful checkout immediately so the mobile flow can be exercised.
        await db.users.update_one({"id": user_id}, {"$set": {
            "plan": plan.lower(),
            "subscription_status": "active",
            "cancel_at_period_end": False,
            "current_period_end": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
        }})
        return {
            "url": f"{body.origin_url.rstrip('/')}/billing/success?stub=1&plan={plan.lower()}",
            "stub_mode": True,
        }

    # Real Stripe path.
    customer_id = u.get("stripe_customer_id")
    if not customer_id:
        customer = stripe.Customer.create(email=u["email"], name=u.get("name"), metadata={"app_user_id": user_id})
        customer_id = customer.id
        await db.users.update_one({"id": user_id}, {"$set": {"stripe_customer_id": customer_id}})

    price_amount = int(PLAN_PRICING[plan]["base"] * 100)
    line_items = [{"price_data": {
        "currency": "aud",
        "product_data": {"name": f"Wayly {PLAN_PRICING[plan]['label']} plan"},
        "unit_amount": price_amount,
        "recurring": {"interval": "month"},
    }, "quantity": 1}]
    origin = body.origin_url.rstrip('/')
    session = stripe.checkout.Session.create(
        customer=customer_id,
        mode="subscription",
        line_items=line_items,
        success_url=f"{origin}/billing/success?session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{origin}/billing/cancel",
        metadata={"app_user_id": user_id, "app_plan": plan.lower()},
    )
    return {"url": session.url, "session_id": session.id, "stub_mode": False}


# ───────────────────── POST /upgrade ─────────────────────
@router.post("/upgrade")
async def upgrade(body: _PlanBody, user_id: str = Depends(get_current_user_id)):
    plan = _normalise_plan(body.plan)
    u = await _user(user_id)
    cur_plan = (u.get("plan") or "free").upper()
    if cur_plan == plan:
        return {"ok": True, "plan": plan, "no_change": True}
    # Solo guard already enforced on the client; double-check server-side.
    if plan == "SOLO":
        account_id = u.get("account_id") or u.get("household_id") or user_id
        active = await db.participants.count_documents({"account_id": account_id, "status": "ACTIVE"})
        if active > 1:
            raise HTTPException(status_code=400, detail="Solo allows 1 participant. Remove extras first.")
    await db.users.update_one({"id": user_id}, {"$set": {
        "plan": plan.lower(),
        "subscription_status": "active",
    }})
    return {"ok": True, "plan": plan}


# ───────────────────── POST /cancel ─────────────────────
@router.post("/cancel")
async def cancel(user_id: str = Depends(get_current_user_id)):
    u = await _user(user_id)
    end = u.get("current_period_end") or (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    await db.users.update_one({"id": user_id}, {"$set": {
        "cancel_at_period_end": True,
        "current_period_end": end,
    }})
    return {"ok": True, "current_period_end": end}


# ───────────────────── POST /downgrade-to-free ─────────────────────
@router.post("/downgrade-to-free")
async def downgrade_to_free(user_id: str = Depends(get_current_user_id)):
    u = await _user(user_id)
    account_id = u.get("account_id") or u.get("household_id") or user_id
    # Free = 1 participant; if they have more we block.
    active = await db.participants.count_documents({"account_id": account_id, "status": "ACTIVE"})
    if active > 1:
        raise HTTPException(
            status_code=400,
            detail=f"Free allows 1 participant. You currently have {active}. Remove the extras first.",
        )
    await db.users.update_one({"id": user_id}, {"$set": {
        "plan": "free",
        "subscription_status": None,
        "cancel_at_period_end": False,
        "trial_ends_at": None,
        "current_period_end": None,
    }})
    # Cancel addon rows.
    await db.participant_addons.update_many({"account_id": account_id}, {"$set": {"status": "CANCELED"}})
    return {"ok": True}


# ───────────────────── POST /webhooks/stripe ─────────────────────
# Mounted as /api/webhooks/stripe in server.py via a separate include.
webhook_router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])


@webhook_router.post("/stripe")
async def stripe_webhook(request: Request):
    if not STRIPE_AVAILABLE:
        return {"received": True, "stub_mode": True}
    payload = await request.body()
    sig = request.headers.get("stripe-signature")
    if not sig:
        raise HTTPException(status_code=400, detail="Missing Stripe-Signature")
    try:
        event = stripe.Webhook.construct_event(payload=payload, sig_header=sig, secret=STRIPE_WEBHOOK_SECRET)
    except Exception as e:
        logger.warning("Stripe webhook signature failure: %s", e)
        raise HTTPException(status_code=400, detail="Invalid signature")
    et = event.get("type")
    obj = event.get("data", {}).get("object", {})
    md = obj.get("metadata") or {}
    app_user_id = md.get("app_user_id")
    if et == "checkout.session.completed" and app_user_id:
        await db.users.update_one({"id": app_user_id}, {"$set": {
            "subscription_status": "active",
            "stripe_subscription_id": obj.get("subscription"),
            "plan": (md.get("app_plan") or "family").lower(),
        }})
    elif et == "customer.subscription.deleted" and obj.get("customer"):
        await db.users.update_one({"stripe_customer_id": obj.get("customer")}, {"$set": {
            "plan": "free",
            "subscription_status": None,
            "stripe_subscription_id": None,
        }})
    return {"received": True}
