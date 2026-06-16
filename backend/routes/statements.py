"""Statements + public statement decoder — extracted from server.py.

Owns:
  * In-memory `UPLOAD_JOBS` queue (job state for the async parse pipeline)
  * `submit_upload_job()` — the async pipeline shared with documents.py
  * `/statements/upload`, `/statements/upload-text`, `/statements/upload-job/{id}`
  * `/statements`, `/statements/{id}`
  * Public free-tier decoder (`/public/decode-statement*`, `/public/decode-job/{id}`)

The functions here intentionally keep the same names/signatures as their
pre-refactor counterparts so other modules (documents.py) can drop the
underscore and import them directly.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from auth import get_current_user_id
from deps import db, get_user, push_to_user, require_household
from models import (
    Anomaly,
    NotificationItem,
    Statement,
    StatementLineItem,
    new_id,
    now_iso,
)

router = APIRouter(prefix="/api", tags=["statements"])
logger = logging.getLogger("wayly")


# ─────────────────── upload job pipeline ───────────────────
UPLOAD_JOBS: Dict[str, dict] = {}


def submit_upload_job(
    text: str,
    filename: str,
    household_id: str,
    user_id: str,
    user_name: str,
    file_size: int,
) -> str:
    """Kick off the async parse → persist → notify pipeline. Returns job_id
    immediately; consumers poll `/statements/upload-job/{job_id}` for status.
    """
    job_id = new_id()
    UPLOAD_JOBS[job_id] = {
        "user_id": user_id,
        "household_id": household_id,
        "status": "pending",
        "phase": "parsing",
    }

    async def _run():
        try:
            from agents import parse_statement
            UPLOAD_JOBS[job_id]["phase"] = "parsing"
            data = await parse_statement(text)
            line_items: List[dict] = []
            for li in data.get("line_items", []) or []:
                try:
                    line_items.append(StatementLineItem(**li).model_dump())
                except Exception as e:
                    logger.warning("Skipped invalid line item: %s", e)
            anomalies: List[dict] = []
            for an in data.get("anomalies", []) or []:
                try:
                    anomalies.append(Anomaly(**an).model_dump())
                except Exception as e:
                    logger.warning("Skipped invalid anomaly: %s", e)
            stmt = Statement(
                household_id=household_id,
                filename=filename,
                period_label=data.get("period_label"),
                line_items=[StatementLineItem(**li) for li in line_items],
                summary=data.get("summary"),
                anomalies=[Anomaly(**a) for a in anomalies],
                raw_text_preview=(text or "")[:500],
            )
            doc = stmt.model_dump()
            doc["file_size_bytes"] = file_size
            await db.statements.insert_one(doc)

            # Notify on HIGH/MEDIUM (alert/warning) anomalies
            for an in anomalies:
                if an.get("severity") in ("alert", "warning"):
                    deeplink = f"/statements/{stmt.id}"
                    note = NotificationItem(
                        user_id=user_id,
                        title=an.get("title", "New alert on your statement"),
                        body=an.get("detail", ""),
                        category="anomaly",
                        severity=an.get("severity", "info"),
                        related_statement_id=stmt.id,
                        type="anomaly_alert",
                        deeplink=deeplink,
                    )
                    await db.notifications.insert_one(note.model_dump())
                    await push_to_user(
                        user_id,
                        title=an.get("title", "New alert"),
                        body=an.get("detail", "") or "",
                        data={
                            "type": "anomaly_alert",
                            "deeplink": deeplink,
                            "statement_id": stmt.id,
                            "anomaly_id": an.get("id"),
                            "notification_id": note.id,
                        },
                    )

            # "statement_ready" push when no anomalies — so users still land
            # on the new statement on completion.
            if not any((a.get("severity") in ("alert", "warning")) for a in anomalies):
                ready_deeplink = f"/statements/{stmt.id}"
                ready_note = NotificationItem(
                    user_id=user_id,
                    title="Statement decoded",
                    body=(stmt.period_label or "Your statement") + " is ready to review.",
                    category="statement",
                    severity="info",
                    related_statement_id=stmt.id,
                    type="statement_ready",
                    deeplink=ready_deeplink,
                )
                await db.notifications.insert_one(ready_note.model_dump())
                await push_to_user(
                    user_id,
                    title=ready_note.title,
                    body=ready_note.body,
                    data={
                        "type": "statement_ready",
                        "deeplink": ready_deeplink,
                        "statement_id": stmt.id,
                        "notification_id": ready_note.id,
                    },
                )

            UPLOAD_JOBS[job_id]["status"] = "done"
            UPLOAD_JOBS[job_id]["statement_id"] = stmt.id
            UPLOAD_JOBS[job_id]["phase"] = "done"
        except Exception as e:
            logger.exception("Upload job failed")
            UPLOAD_JOBS[job_id]["status"] = "error"
            UPLOAD_JOBS[job_id]["error"] = str(e)

    asyncio.create_task(_run())
    return job_id


# ─────────────────── free-tier quota (statement decoder) ─────────────────
FREE_TIER_DECODE_WINDOW_S = 30 * 24 * 60 * 60  # rolling 30 days


async def _check_free_tier_quota(user: dict) -> None:
    """Free-plan users get ONE statement decode per rolling 30 days. Solo /
    Family / Adviser plans bypass this check entirely. Raises 402 with the
    upgrade payload + retry-at when the quota is exhausted.
    """
    plan = (user.get("plan") or "free").lower()
    if plan and plan != "free":
        return  # paid plans unlimited
    import time
    last = float(user.get("free_decode_last_at_ts") or 0)
    now = time.time()
    if last and (now - last) < FREE_TIER_DECODE_WINDOW_S:
        retry_at = last + FREE_TIER_DECODE_WINDOW_S
        days = max(1, int((retry_at - now) / 86400))
        raise HTTPException(
            status_code=402,
            detail={
                "error": "free_tier_exhausted",
                "message": f"You've used your free decode for this 30-day window. Next decode in ~{days} day(s), or upgrade for unlimited.",
                "retry_at_unix": int(retry_at),
                "redirect": "/pricing",
            },
            headers={"Retry-After": str(int(retry_at - now))},
        )


async def _record_free_tier_use(user_id: str) -> None:
    """Stamp the user's `free_decode_last_at_ts` to start the 30-day window."""
    import time
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"free_decode_last_at_ts": time.time(), "free_decode_last_at": now_iso()}},
    )


@router.post("/statements/upload")
async def upload_statement(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
):
    """Async upload — kicks off OCR + parse, returns {job_id} immediately."""
    h = await require_household(user_id)
    user = await get_user(user_id)
    await _check_free_tier_quota(user)
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file")
    from document_extract import (
        CorruptFileError,
        FileTooLargeError,
        PasswordProtectedError,
        UnsupportedFormatError,
        extract_document,
    )
    try:
        text, _input_method, _page_count, _parse_warnings = await extract_document(
            file.filename or "", raw
        )
    except UnsupportedFormatError as e:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {e}")
    except FileTooLargeError as e:
        raise HTTPException(status_code=413, detail=f"File too large: {e}")
    except PasswordProtectedError:
        raise HTTPException(status_code=400, detail="This PDF is password-protected.")
    except CorruptFileError as e:
        raise HTTPException(status_code=400, detail=f"Could not read file: {e}")
    if not (text or "").strip():
        raise HTTPException(status_code=400, detail="Could not extract text. Try a clearer photo.")
    if len(raw) > 0:
        await _record_free_tier_use(user_id)
    job_id = submit_upload_job(
        text, file.filename or "statement", h["id"], user_id, user["name"], len(raw)
    )
    return {"job_id": job_id, "status": "pending"}


class UploadTextBody(BaseModel):
    text: str = Field(min_length=10, max_length=200_000)
    filename: Optional[str] = None


@router.post("/statements/upload-text")
async def upload_statement_text(
    payload: UploadTextBody,
    user_id: str = Depends(get_current_user_id),
):
    """Same as /statements/upload but for pasted text — no OCR phase needed."""
    h = await require_household(user_id)
    user = await get_user(user_id)
    await _check_free_tier_quota(user)
    text = (payload.text or "").strip()
    if len(text) < 10:
        raise HTTPException(status_code=400, detail="Paste a bit more — at least 10 characters.")
    fname = (
        payload.filename
        or f"pasted-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.txt"
    ).strip()
    job_id = submit_upload_job(
        text, fname, h["id"], user_id, user["name"], len(text.encode("utf-8"))
    )
    return {"job_id": job_id, "status": "pending"}


@router.get("/statements/upload-job/{job_id}")
async def get_upload_job(job_id: str, user_id: str = Depends(get_current_user_id)):
    job = UPLOAD_JOBS.get(job_id)
    if not job or job.get("user_id") != user_id:
        raise HTTPException(status_code=404, detail="Job not found or expired")
    out = {"status": job["status"], "phase": job.get("phase", job["status"])}
    if job["status"] == "done":
        out["statement_id"] = job.get("statement_id")
    elif job["status"] == "error":
        out["error"] = job.get("error", "decode failed")
    return out


# ─────────────────── public statement decoder (free tier) ───────────────────
PUBLIC_DECODE_JOBS: Dict[str, dict] = {}
PUBLIC_DECODE_USAGE: Dict[str, List[float]] = {}
PUBLIC_DECODE_DAILY_LIMIT = 3
PUBLIC_DECODE_WINDOW_S = 24 * 60 * 60
PUBLIC_DECODE_JOB_TIMEOUT_S = 90


def _client_key(request: Request, user_id: Optional[str]) -> str:
    """Authenticated users bypass IP-keyed limit by using their user_id."""
    if user_id:
        return f"user:{user_id}"
    fwd = request.headers.get("x-forwarded-for") or ""
    if fwd:
        return f"ip:{fwd.split(',')[0].strip()}"
    return f"ip:{(request.client.host if request.client else 'unknown')}"


def _check_public_decode_quota(key: str) -> Optional[float]:
    import time
    now = time.time()
    bucket = [t for t in PUBLIC_DECODE_USAGE.get(key, []) if now - t < PUBLIC_DECODE_WINDOW_S]
    PUBLIC_DECODE_USAGE[key] = bucket
    if key.startswith("user:"):
        return None
    if len(bucket) >= PUBLIC_DECODE_DAILY_LIMIT:
        oldest = min(bucket)
        return oldest + PUBLIC_DECODE_WINDOW_S
    return None


def _record_public_decode(key: str) -> None:
    import time
    PUBLIC_DECODE_USAGE.setdefault(key, []).append(time.time())


def _refund_public_decode(key: str) -> None:
    """Pop the most-recent quota mark. Called when a decode fails so a hung
    LLM doesn't lock a free-tier user out for 24 hours."""
    try:
        bucket = PUBLIC_DECODE_USAGE.get(key) or []
        if bucket:
            bucket.pop()
            PUBLIC_DECODE_USAGE[key] = bucket
    except Exception:
        pass


INFORMATIONAL_KINDS = {
    "at_hm_active_commitment",
    "previous_period_adjustment",
}


def _submit_public_decode_job(text: str, refund_key: Optional[str] = None) -> str:
    job_id = new_id()
    PUBLIC_DECODE_JOBS[job_id] = {"status": "pending", "created_at": now_iso()}

    async def _run():
        try:
            from agents import parse_statement
            data = await asyncio.wait_for(
                parse_statement(text), timeout=PUBLIC_DECODE_JOB_TIMEOUT_S
            )
            line_items: List[dict] = []
            for li in data.get("line_items", []) or []:
                try:
                    line_items.append(StatementLineItem(**li).model_dump())
                except Exception:
                    line_items.append({
                        "service_name": li.get("service_name") or li.get("service") or "Service",
                        "total": float(li.get("total") or 0),
                    })
            anomalies_raw: List[dict] = list(data.get("anomalies", []) or [])
            informational_notes: List[dict] = list(
                data.get("informational_notes")
                or (data.get("audit") or {}).get("informational_notes")
                or []
            )

            normalised_anomalies: List[dict] = []
            for an in anomalies_raw:
                kind = (an.get("kind") or an.get("type") or "").strip().lower()
                if kind in INFORMATIONAL_KINDS:
                    informational_notes.append({
                        "kind": kind,
                        "title": an.get("title") or "Statement note",
                        "detail": an.get("detail") or an.get("description") or "",
                        "suggested_action": an.get("suggested_action"),
                    })
                    continue
                try:
                    norm = Anomaly(**an).model_dump()
                    if kind:
                        norm["kind"] = kind
                    normalised_anomalies.append(norm)
                except Exception:
                    normalised_anomalies.append({
                        "severity": an.get("severity") or "info",
                        "title": an.get("title") or "Heads up",
                        "detail": an.get("detail") or an.get("description") or "",
                        **({"kind": kind} if kind else {}),
                    })

            audit = {
                "anomalies": normalised_anomalies,
                "informational_notes": informational_notes,
            }
            PUBLIC_DECODE_JOBS[job_id].update({
                "status": "done",
                "result": {
                    "period_label": data.get("period_label"),
                    "summary": data.get("summary"),
                    "line_items": line_items,
                    "anomalies": normalised_anomalies,
                    "informational_notes": informational_notes,
                    "audit": audit,
                },
            })
        except asyncio.TimeoutError:
            logger.warning("Public decode job %s timed out", job_id)
            PUBLIC_DECODE_JOBS[job_id].update({
                "status": "error",
                "error": "The decoder is taking longer than usual. Please try again — your free quota wasn't used.",
            })
            if refund_key:
                _refund_public_decode(refund_key)
        except Exception as e:
            logger.exception("Public decode job failed")
            PUBLIC_DECODE_JOBS[job_id].update({
                "status": "error",
                "error": str(e) or "decode failed",
            })
            if refund_key:
                _refund_public_decode(refund_key)

    asyncio.create_task(_run())
    return job_id


class DecodeText(BaseModel):
    text: str = Field(min_length=1, max_length=200_000)


async def _maybe_user_id(request: Request) -> Optional[str]:
    """Optional auth — extract user_id from a valid bearer token, else None."""
    auth_header = request.headers.get("authorization") or ""
    if not auth_header.lower().startswith("bearer "):
        return None
    token = auth_header.split(" ", 1)[1].strip()
    if not token:
        return None
    try:
        from auth import decode_token as _decode
        return _decode(token)
    except Exception:
        return None


@router.post("/public/decode-statement-text")
async def public_decode_statement_text(request: Request, payload: DecodeText):
    user_id = await _maybe_user_id(request)
    key = _client_key(request, user_id)
    retry_at = _check_public_decode_quota(key)
    if retry_at is not None:
        import time as _time
        raise HTTPException(
            status_code=429,
            detail=f"Free decoder limit reached — {PUBLIC_DECODE_DAILY_LIMIT} per 24 hours. Sign in for unlimited.",
            headers={"Retry-After": str(int(retry_at - _time.time()))},
        )
    if not payload.text.strip():
        raise HTTPException(status_code=400, detail="Paste the statement text first.")
    _record_public_decode(key)
    refund_key = key if not key.startswith("user:") else None
    job_id = _submit_public_decode_job(payload.text, refund_key=refund_key)
    return {"job_id": job_id, "status": "pending"}


@router.post("/public/decode-statement")
async def public_decode_statement(request: Request, file: UploadFile = File(...)):
    user_id = await _maybe_user_id(request)
    key = _client_key(request, user_id)
    retry_at = _check_public_decode_quota(key)
    if retry_at is not None:
        import time as _time
        raise HTTPException(
            status_code=429,
            detail=f"Free decoder limit reached — {PUBLIC_DECODE_DAILY_LIMIT} per 24 hours. Sign in for unlimited.",
            headers={"Retry-After": str(int(retry_at - _time.time()))},
        )
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file")
    from document_extract import (
        CorruptFileError,
        FileTooLargeError,
        PasswordProtectedError,
        UnsupportedFormatError,
        extract_document,
    )
    try:
        text, _input_method, _page_count, _parse_warnings = await extract_document(
            file.filename or "", raw
        )
    except UnsupportedFormatError as e:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {e}")
    except FileTooLargeError as e:
        raise HTTPException(status_code=413, detail=f"File too large: {e}")
    except PasswordProtectedError:
        raise HTTPException(status_code=400, detail="This PDF is password-protected.")
    except CorruptFileError as e:
        raise HTTPException(status_code=400, detail=f"Could not read file: {e}")
    if not (text or "").strip():
        raise HTTPException(status_code=400, detail="Could not extract text. Try a clearer photo.")
    _record_public_decode(key)
    refund_key = key if not key.startswith("user:") else None
    job_id = _submit_public_decode_job(text, refund_key=refund_key)
    return {"job_id": job_id, "status": "pending"}


@router.get("/public/decode-job/{job_id}")
async def public_decode_job(job_id: str):
    job = PUBLIC_DECODE_JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found or expired")
    out = {"status": job["status"]}
    if job["status"] == "done":
        out["result"] = job.get("result")
    elif job["status"] == "error":
        out["error"] = job.get("error", "decode failed")
    return out


@router.post("/public/decode-statement-text/_sample")
async def public_decode_sample():
    """Dev/QA helper — returns a fully populated decode result that exercises
    both `audit.anomalies` and `audit.informational_notes` without burning AI calls."""
    job_id = new_id()
    PUBLIC_DECODE_JOBS[job_id] = {
        "status": "done",
        "created_at": now_iso(),
        "result": {
            "period_label": "May 2026",
            "summary": (
                "Total billed $2,184. Provider charged a weekend rate on a Tuesday visit, "
                "and your statement carries an active AT-HM commitment from last quarter."
            ),
            "line_items": [
                {"service_name": "Personal care", "total": 1240.50},
                {"service_name": "Domestic assistance", "total": 384.00},
                {"service_name": "Nursing", "total": 560.00},
            ],
            "anomalies": [
                {
                    "id": new_id(),
                    "severity": "alert",
                    "title": "Weekend rate on a Tuesday",
                    "detail": "A personal-care visit on Tue 14 May was billed at the weekend loading rate.",
                    "suggested_action": "Ask the provider to re-bill at the weekday rate.",
                    "kind": "weekend_rate_misapplied",
                },
                {
                    "id": new_id(),
                    "severity": "warning",
                    "title": "Nursing visit duration unusually long",
                    "detail": "A 180-minute nursing visit is 3× the median for your plan.",
                    "kind": "duration_outlier",
                },
            ],
            "informational_notes": [
                {
                    "kind": "at_hm_active_commitment",
                    "title": "Active AT-HM commitment",
                    "detail": "$3,200 commitment from Q1 2026 is still being drawn down — $1,420 remaining.",
                },
                {
                    "kind": "previous_period_adjustment",
                    "title": "Adjustment from previous period",
                    "detail": "−$42.50 credit applied for a duplicate visit in April 2026.",
                },
            ],
            "audit": {"anomalies": [], "informational_notes": []},
        },
    }
    r = PUBLIC_DECODE_JOBS[job_id]["result"]
    r["audit"]["anomalies"] = r["anomalies"]
    r["audit"]["informational_notes"] = r["informational_notes"]
    return {"job_id": job_id, "status": "pending"}


# ─────────────────── statement list/detail (authenticated) ───────────────────
@router.get("/statements", response_model=List[Statement])
async def list_statements(user_id: str = Depends(get_current_user_id)):
    h = await require_household(user_id)
    docs = (
        await db.statements.find({"household_id": h["id"]}, {"_id": 0})
        .sort("uploaded_at", -1)
        .to_list(100)
    )
    return [Statement(**d) for d in docs]


@router.get("/statements/{statement_id}", response_model=Statement)
async def get_statement(statement_id: str, user_id: str = Depends(get_current_user_id)):
    h = await require_household(user_id)
    doc = await db.statements.find_one(
        {"id": statement_id, "household_id": h["id"]}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Statement not found")
    return Statement(**doc)
