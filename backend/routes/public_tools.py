"""Public AI tools — extracted from server.py (P3 iter 4, final).

Five public endpoints used by the unauthenticated marketing surface AND by
the paid-plan in-app tools (Budget Calc, Provider Price Checker,
Classification Check, Reassessment Letter):

  * POST /api/public/budget-calc            — budget summary by classification
  * POST /api/public/price-check            — single-service rate verdict
  * GET  /api/public/price-check/services   — discoverable service list + medians
  * POST /api/public/classification-check   — 12-question self-assessment
  * POST /api/public/reassessment-letter    — LLM-drafted reassessment letter

Note: the prod backend additionally serves `/api/public/aged-care-chat` (the
renamed family-coordinator-chat). That route lives in the production code path
only — this preview pod doesn't carry it.
"""
from __future__ import annotations

import logging
import os
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

import budget as budget_lib
from models import new_id

router = APIRouter(prefix="/api", tags=["public-tools"])
logger = logging.getLogger("wayly")


# ─────────────────────────── budget calculator ────────────────────────────
class PublicBudgetBody(BaseModel):
    classification: int = Field(ge=1, le=8)
    is_grandfathered: bool = False
    current_lifetime_balance: float = 0.0
    expected_annual_burn: Optional[float] = None


@router.post("/public/budget-calc")
async def public_budget_calc(body: PublicBudgetBody):
    classification = body.classification
    annual = budget_lib.CLASSIFICATIONS[classification]["annual"]
    quarterly = budget_lib.quarterly_budget(classification)
    allocations = budget_lib.stream_allocations(classification)
    rollover = budget_lib.rollover_cap(classification)
    cap_amount = budget_lib.lifetime_cap(body.is_grandfathered)
    contributions = max(0.0, body.current_lifetime_balance)
    pct = (contributions / cap_amount * 100) if cap_amount else 0.0
    years_to_cap = None
    if body.expected_annual_burn and body.expected_annual_burn > 0:
        remaining = max(0.0, cap_amount - contributions)
        years_to_cap = round(remaining / body.expected_annual_burn, 2)
    return {
        "classification": classification,
        "classification_label": budget_lib.CLASSIFICATIONS[classification]["label"],
        "annual_total": annual,
        "quarterly_total": quarterly,
        "rollover_cap": rollover,
        "streams": [{"stream": s, "allocated": allocations[s]} for s in budget_lib.STREAMS],
        "lifetime_cap": cap_amount,
        "lifetime_contributions": contributions,
        "lifetime_pct": round(pct, 2),
        "years_to_cap": years_to_cap,
        "is_grandfathered": body.is_grandfathered,
    }


# ─────────────────────────── price check ──────────────────────────────────
PRICE_BENCHMARKS = {
    "Personal care":        {"median": 65.0,  "cap": 90.00},
    "Domestic assistance":  {"median": 58.0,  "cap": 79.00},
    "Nursing":              {"median": 145.0, "cap": 178.00},
    "Physiotherapy":        {"median": 125.0, "cap": 156.00},
    "Cleaning":             {"median": 55.0,  "cap": 75.00},
    "Transport":            {"median": 32.0,  "cap": 48.00},
}


class PublicPriceBody(BaseModel):
    service: str
    rate: float


@router.post("/public/price-check")
async def public_price_check(body: PublicPriceBody):
    bench = PRICE_BENCHMARKS.get(body.service, {"median": body.rate, "cap": body.rate})
    median = bench["median"]
    cap = bench["cap"]
    delta_pct = ((body.rate - median) / median * 100) if median else 0.0
    if body.rate > cap:
        verdict, label = "high", "Above the 1 July 2026 cap"
        assessment = (
            f"At ${body.rate:.2f}/unit, this is above the published cap of ${cap:.2f}. "
            "From that date, providers cannot exceed the cap."
        )
        suggested = "Ask the provider for a corrected rate, or raise it with the Aged Care Quality and Safety Commission."
    elif body.rate > median * 1.10:
        verdict, label = "high", "Higher than the typical rate"
        assessment = f"At ${body.rate:.2f}/unit, that's about {delta_pct:.0f}% above the network median of ${median:.2f}."
        suggested = "Email the provider asking for a written explanation of the rate."
    elif body.rate < median * 0.85:
        verdict, label = "low", "Below the typical rate"
        assessment = f"At ${body.rate:.2f}/unit, this is below the network median of ${median:.2f}."
        suggested = None
    else:
        verdict, label = "fair", "About what you'd expect"
        assessment = f"At ${body.rate:.2f}/unit, you're within typical range (network median ${median:.2f})."
        suggested = None
    return {
        "service": body.service, "charged": body.rate, "median": median, "cap": cap,
        "delta_pct": round(delta_pct, 2), "verdict": verdict, "verdict_label": label,
        "assessment": assessment, "suggested_action": suggested,
    }


@router.get("/public/price-check/services")
async def public_price_services():
    return [{"name": k, "median": v["median"], "cap": v["cap"]} for k, v in PRICE_BENCHMARKS.items()]


# ─────────────────────────── classification check ─────────────────────────
class PublicClassificationBody(BaseModel):
    answers: List[int] = Field(min_length=12, max_length=12)
    current_classification: Optional[int] = None


@router.post("/public/classification-check")
async def public_classification_check(body: PublicClassificationBody):
    if not all(0 <= a <= 4 for a in body.answers):
        raise HTTPException(status_code=400, detail="Each answer must be 0–4")
    score = sum(body.answers)
    if score <= 6:
        low, high = 1, 2
    elif score <= 12:
        low, high = 2, 3
    elif score <= 18:
        low, high = 3, 4
    elif score <= 24:
        low, high = 4, 5
    elif score <= 30:
        low, high = 5, 6
    elif score <= 36:
        low, high = 6, 7
    else:
        low, high = 7, 8
    annual_low = budget_lib.CLASSIFICATIONS[low]["annual"]
    annual_high = budget_lib.CLASSIFICATIONS[high]["annual"]
    suggest = body.current_classification is not None and (
        body.current_classification < low or body.current_classification > high + 1
    )
    return {
        "score": score, "score_max": 48,
        "likely_low": low, "likely_high": high,
        "likely_label": f"Classification {low}" if low == high else f"Classification {low}–{high}",
        "annual_range": [annual_low, annual_high],
        "current_classification": body.current_classification,
        "suggest_reassessment": suggest,
        "caveat": "This is informational only. Only the My Aged Care Independent Assessment Tool determines the actual classification.",
    }


# ─────────────────────────── reassessment letter ──────────────────────────
class PublicReassessmentBody(BaseModel):
    participant_name: str
    current_classification: int = Field(ge=1, le=8)
    changes_summary: str = Field(min_length=10, max_length=4000)
    recent_events: Optional[str] = None
    sender_name: str
    relationship: Optional[str] = "family caregiver"


@router.post("/public/reassessment-letter")
async def public_reassessment_letter(body: PublicReassessmentBody):
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="LLM unavailable")
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    system = (
        "You are a paperwork drafter for Australian Support at Home. Draft a polite, factual "
        "reassessment request letter to My Aged Care. Australian English. 250–400 words. "
        "Plain professional tone. Use the participant's name and the sender's name. Use "
        "gender-neutral language. Reference Aged Care Act 2024 framework where relevant. "
        "End with a specific request and a 14-day response timeframe. Output ONLY the letter "
        "body — no preamble, no markdown. NEVER claim a specific reassessment outcome — "
        "you ASK for reassessment, you don't predict its result."
    )
    user_msg = (
        f"Participant: {body.participant_name}\n"
        f"Current classification: Level {body.current_classification}\n"
        f"Sender: {body.sender_name} ({body.relationship or 'family caregiver'})\n\n"
        f"Changes since assessment:\n{body.changes_summary}\n\n"
        f"Recent events: {body.recent_events or '(none)'}"
    )
    chat_inst = (
        LlmChat(api_key=api_key, session_id=f"reassess-{new_id()[:8]}", system_message=system)
        .with_model("anthropic", "claude-sonnet-4-5-20250929")
        .with_params(max_tokens=1200)
    )
    out = await chat_inst.send_message(UserMessage(text=user_msg))
    return {"letter": str(out or "")}
