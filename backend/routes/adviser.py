"""Adviser portal — extracted from server.py.

Owns the adviser roster CRUD (`/adviser/clients/*`), summary tile, snapshot,
public invite-preview endpoint, and the Wayly-branded A4 review-pack PDF.
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import get_current_user_id
from deps import db, get_user
from models import new_id, now_iso

router = APIRouter(prefix="/api", tags=["adviser"])
logger = logging.getLogger("wayly")

ADVISER_CLIENT_CAP = 25
ADVISER_PLANS = {"adviser"}


def require_adviser_user(user: dict) -> None:
    """Shared 403 raiser — re-exported so documents.py can reuse the gate too."""
    if user.get("plan") not in ADVISER_PLANS:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "plan_required",
                "current_plan": user.get("plan"),
                "required_plans": list(ADVISER_PLANS),
                "redirect": "/pricing",
            },
        )


@router.get("/adviser/summary")
async def adviser_summary(user_id: str = Depends(get_current_user_id)):
    user = await get_user(user_id)
    require_adviser_user(user)
    rows = await db.adviser_clients.find({"adviser_id": user_id}, {"_id": 0}).to_list(500)
    total = len(rows)
    active = sum(1 for r in rows if r.get("status") in ("active", "linked"))
    invited = sum(1 for r in rows if r.get("status") == "invited")
    return {
        "plan": user.get("plan"),
        "adviser_name": user.get("name"),
        "max_clients": ADVISER_CLIENT_CAP,
        "clients_total": total,
        "clients_active": active,
        "clients_invited": invited,
        "seats_remaining": max(0, ADVISER_CLIENT_CAP - total),
    }


@router.get("/adviser/clients")
async def adviser_clients(user_id: str = Depends(get_current_user_id)):
    user = await get_user(user_id)
    require_adviser_user(user)
    rows = (
        await db.adviser_clients.find(
            {"adviser_id": user_id}, {"_id": 0, "invite_token": 0}
        ).sort("created_at", -1).to_list(500)
    )
    return rows


class NewClient(BaseModel):
    client_name: str = Field(min_length=1, max_length=120)
    client_email: str = Field(min_length=3, max_length=320)
    notes: Optional[str] = Field(default="", max_length=500)


@router.post("/adviser/clients")
async def adviser_clients_create(payload: NewClient, user_id: str = Depends(get_current_user_id)):
    user = await get_user(user_id)
    require_adviser_user(user)
    email = payload.client_email.strip().lower()
    if "@" not in email:
        raise HTTPException(status_code=422, detail="Enter a valid email address.")
    count = await db.adviser_clients.count_documents({"adviser_id": user_id})
    if count >= ADVISER_CLIENT_CAP:
        raise HTTPException(
            status_code=403,
            detail={"error": "client_cap_reached", "max": ADVISER_CLIENT_CAP},
        )
    existing = await db.adviser_clients.find_one({"adviser_id": user_id, "client_email": email})
    if existing:
        raise HTTPException(status_code=409, detail="That client is already in your roster.")
    invite_token = secrets.token_urlsafe(32)
    doc = {
        "id": new_id(),
        "adviser_id": user_id,
        "adviser_name": user.get("name"),
        "adviser_email": user.get("email"),
        "client_name": payload.client_name.strip(),
        "client_email": email,
        "notes": (payload.notes or "").strip(),
        "status": "invited",
        "invite_token": invite_token,
        "linked_user_id": None,
        "linked_household_id": None,
        "created_at": now_iso(),
        "invited_at": now_iso(),
        "linked_at": None,
    }
    await db.adviser_clients.insert_one(doc)
    invite_url = f"wayly://signup?plan=family&invite={invite_token}"
    web_url = f"https://wayly.com.au/signup?plan=family&invite={invite_token}"
    logger.info(
        "ADVISER INVITE for %s -> %s  (mobile: %s | web: %s)",
        user.get("email"), email, invite_url, web_url,
    )
    try:
        from email_send import send_adviser_invite
        send_adviser_invite(
            to=email,
            adviser_name=user.get("name") or user.get("email", "Your adviser"),
            client_name=payload.client_name.strip(),
            invite_link_mobile=invite_url,
            invite_link_web=web_url,
        )
    except Exception as e:
        logger.warning("Adviser invite email dispatch failed (non-fatal): %s", e)
    return {k: v for k, v in doc.items() if k not in ("_id", "invite_token")}


class UpdateClient(BaseModel):
    client_name: Optional[str] = None
    notes: Optional[str] = None
    status: Optional[str] = None


@router.patch("/adviser/clients/{cid}")
async def adviser_clients_update(
    cid: str,
    payload: UpdateClient,
    user_id: str = Depends(get_current_user_id),
):
    user = await get_user(user_id)
    require_adviser_user(user)
    update = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(status_code=422, detail="Nothing to update.")
    res = await db.adviser_clients.update_one(
        {"id": cid, "adviser_id": user_id}, {"$set": update}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Client not found.")
    return await db.adviser_clients.find_one(
        {"id": cid}, {"_id": 0, "invite_token": 0}
    )


@router.delete("/adviser/clients/{cid}")
async def adviser_clients_delete(cid: str, user_id: str = Depends(get_current_user_id)):
    user = await get_user(user_id)
    require_adviser_user(user)
    res = await db.adviser_clients.delete_one({"id": cid, "adviser_id": user_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Client not found.")
    return {"ok": True}


@router.post("/adviser/clients/{cid}/resend-invite")
async def adviser_resend_invite(cid: str, user_id: str = Depends(get_current_user_id)):
    user = await get_user(user_id)
    require_adviser_user(user)
    client = await db.adviser_clients.find_one({"id": cid, "adviser_id": user_id})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found.")
    new_token = secrets.token_urlsafe(32)
    await db.adviser_clients.update_one(
        {"id": cid},
        {"$set": {"invite_token": new_token, "invited_at": now_iso(), "status": "invited"}},
    )
    invite_url = f"wayly://signup?plan=family&invite={new_token}"
    logger.info(
        "ADVISER RE-INVITE for %s -> %s (%s)",
        user.get("email"), client.get("client_email"), invite_url,
    )
    return {"ok": True, "invited_at": now_iso()}


@router.get("/adviser/clients/{cid}/snapshot")
async def adviser_client_snapshot(cid: str, user_id: str = Depends(get_current_user_id)):
    user = await get_user(user_id)
    require_adviser_user(user)
    client = await db.adviser_clients.find_one(
        {"id": cid, "adviser_id": user_id}, {"_id": 0, "invite_token": 0}
    )
    if not client:
        raise HTTPException(status_code=404, detail="Client not found.")
    linked_uid = client.get("linked_user_id")
    if not linked_uid:
        raise HTTPException(
            status_code=409, detail={"error": "client_not_linked", "client": client}
        )
    household = await db.households.find_one({"owner_id": linked_uid}, {"_id": 0}) or {}
    statements = (
        await db.statements.find({"household_id": household.get("id")}, {"_id": 0})
        .sort("uploaded_at", -1).to_list(10)
    )
    recent = []
    flagged = []
    for s in statements:
        gross = sum(float(li.get("total") or 0) for li in (s.get("line_items") or []))
        recent.append({
            "id": s["id"],
            "period_label": s.get("period_label"),
            "uploaded_at": s.get("uploaded_at"),
            "gross": gross,
            "anomaly_count": len(s.get("anomalies") or []),
        })
        for a in (s.get("anomalies") or []):
            flagged.append({
                "statement_id": s["id"],
                "severity": a.get("severity"),
                "headline": a.get("headline") or a.get("title") or a.get("rule"),
                "detail": a.get("detail") or a.get("description"),
            })
    members_count = (
        await db.users.count_documents({"household_id": household.get("id")})
        if household else 0
    )
    return {
        "client": client,
        "household": household,
        "metrics": {
            "statements_total": len(statements),
            "anomalies_total": sum(len(s.get("anomalies") or []) for s in statements),
        },
        "recent_statements": recent[:5],
        "flagged_sample": flagged[:10],
        "members_count": members_count,
    }


# Public — used by the signup deep-link to fetch invite preview.
@router.get("/public/adviser/invite/{token}")
async def public_adviser_invite(token: str):
    client = await db.adviser_clients.find_one(
        {"invite_token": token}, {"_id": 0, "invite_token": 0}
    )
    if not client:
        raise HTTPException(status_code=404, detail="Invite not found or already used.")
    return {
        "adviser_name": client.get("adviser_name"),
        "client_name": client.get("client_name"),
        "client_email": client.get("client_email"),
        "notes": client.get("notes"),
    }


# ─────────────────────── adviser review-pack PDF (iter27) ───────────────────────
@router.get("/adviser/clients/{cid}/review-pack.pdf")
async def adviser_review_pack_pdf(cid: str, user_id: str = Depends(get_current_user_id)):
    """Generate a Wayly-branded A4 PDF summarising a client's recent statements + anomalies."""
    user = await get_user(user_id)
    require_adviser_user(user)
    client = await db.adviser_clients.find_one(
        {"id": cid, "adviser_id": user_id}, {"_id": 0, "invite_token": 0}
    )
    if not client:
        raise HTTPException(status_code=404, detail="Client not found.")
    linked_uid = client.get("linked_user_id")
    household: dict = {}
    statements: list = []
    members_count = 0
    if linked_uid:
        household = await db.households.find_one({"owner_id": linked_uid}, {"_id": 0}) or {}
        statements = (
            await db.statements.find({"household_id": household.get("id")}, {"_id": 0})
            .sort("uploaded_at", -1).to_list(20)
        )
        members_count = (
            await db.users.count_documents({"household_id": household.get("id")})
            if household else 0
        )

    import io
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.lib import colors as rl_colors
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    )

    NAVY = rl_colors.HexColor("#1F3A5F")
    GOLD = rl_colors.HexColor("#D4A24E")
    SAGE = rl_colors.HexColor("#7A9B7E")
    TERRA = rl_colors.HexColor("#C5734D")
    MUTED = rl_colors.HexColor("#5C6878")
    CREAM = rl_colors.HexColor("#FAF7F2")
    BORDER = rl_colors.HexColor("#E8E2D6")

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=18 * mm, bottomMargin=18 * mm,
        title=f"Wayly review pack — {client.get('client_name','client')}",
        author=user.get("name", "Wayly Adviser"),
    )

    base = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=base["Heading1"], fontName="Helvetica-Bold", fontSize=22, textColor=NAVY, leading=26, spaceAfter=6)
    h2 = ParagraphStyle("h2", parent=base["Heading2"], fontName="Helvetica-Bold", fontSize=13, textColor=NAVY, leading=16, spaceBefore=10, spaceAfter=6)
    body = ParagraphStyle("body", parent=base["BodyText"], fontName="Helvetica", fontSize=10, textColor=rl_colors.HexColor("#1A1A1A"), leading=14)
    muted = ParagraphStyle("muted", parent=body, textColor=MUTED, fontSize=9, leading=12)
    overline = ParagraphStyle("overline", parent=muted, fontName="Helvetica-Bold", textColor=MUTED, fontSize=8, spaceAfter=2)

    story = []
    story.append(Paragraph("WAYLY  ·  ADVISER REVIEW PACK", overline))
    story.append(Paragraph(f"{client.get('client_name','')}", h1))
    story.append(Paragraph(
        f"Prepared by {user.get('name','')} ({user.get('email','')}) — "
        f"{datetime.now(timezone.utc).strftime('%d %b %Y')}",
        muted,
    ))
    story.append(Spacer(1, 6))

    # Client + household card
    rows = [
        ["Client email", client.get("client_email", "")],
        ["Status", (client.get("status") or "").capitalize()],
        ["Participant", household.get("participant_name", "—") if household else "Not yet linked"],
        ["Classification", (f"Level {household.get('classification')}" if household.get("classification") else "—")],
        ["Provider", household.get("provider_name", "—") if household else "—"],
        ["Household members", str(members_count) if linked_uid else "—"],
    ]
    if client.get("notes"):
        rows.append(["Adviser notes", client.get("notes", "")])
    tbl = Table(rows, colWidths=[45 * mm, None])
    tbl.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, -1), "Helvetica", 9.5),
        ("TEXTCOLOR", (0, 0), (0, -1), MUTED),
        ("TEXTCOLOR", (1, 0), (1, -1), NAVY),
        ("FONT", (1, 0), (1, -1), "Helvetica-Bold", 10),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(Paragraph("Client & household", h2))
    story.append(tbl)
    story.append(Spacer(1, 8))

    # Metrics
    total_statements = len(statements)
    total_anomalies = sum(len(s.get("anomalies") or []) for s in statements)
    total_gross = sum(
        sum(float(li.get("total") or 0) for li in (s.get("line_items") or []))
        for s in statements
    )
    metrics = Table([
        ["Statements (24 mo)", "Anomalies", "Gross billed"],
        [str(total_statements), str(total_anomalies), f"${total_gross:,.0f}"],
    ], colWidths=[None, None, None])
    metrics.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, 0), "Helvetica", 8.5),
        ("TEXTCOLOR", (0, 0), (-1, 0), MUTED),
        ("FONT", (0, 1), (-1, 1), "Helvetica-Bold", 18),
        ("TEXTCOLOR", (0, 1), (-1, 1), NAVY),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("LINEABOVE", (0, 0), (-1, 0), 0.4, BORDER),
        ("LINEBELOW", (0, 1), (-1, 1), 0.4, BORDER),
        ("TOPPADDING", (0, 0), (-1, 0), 6),
        ("BOTTOMPADDING", (0, 1), (-1, 1), 10),
    ]))
    story.append(metrics)

    # Recent statements table
    story.append(Paragraph("Recent statements", h2))
    if not statements:
        story.append(Paragraph(
            "No statements on file yet. Once the client uploads, future packs will include line-item summaries here.",
            muted,
        ))
    else:
        head = ["Period", "Uploaded", "Line items", "Anomalies", "Gross"]
        data = [head]
        for s in statements[:10]:
            gross = sum(float(li.get("total") or 0) for li in (s.get("line_items") or []))
            up = (s.get("uploaded_at") or "")[:10]
            data.append([
                s.get("period_label") or "—",
                up,
                str(len(s.get("line_items") or [])),
                str(len(s.get("anomalies") or [])),
                f"${gross:,.0f}",
            ])
        tbl = Table(data, colWidths=[40 * mm, 28 * mm, 22 * mm, 22 * mm, 28 * mm])
        tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), CREAM),
            ("TEXTCOLOR", (0, 0), (-1, 0), MUTED),
            ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8.5),
            ("FONT", (0, 1), (-1, -1), "Helvetica", 9.5),
            ("TEXTCOLOR", (0, 1), (-1, -1), NAVY),
            ("LINEBELOW", (0, 0), (-1, -1), 0.4, BORDER),
            ("ALIGN", (2, 1), (-1, -1), "RIGHT"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(tbl)

    # Flagged anomalies
    story.append(Paragraph("Flagged items", h2))
    flat: list = []
    for s in statements[:10]:
        for a in (s.get("anomalies") or []):
            flat.append((s, a))
    if not flat:
        story.append(Paragraph("No anomalies flagged in this review window.", muted))
    else:
        sev_color = {
            "alert": TERRA, "HIGH": TERRA,
            "warning": GOLD, "MEDIUM": GOLD,
            "info": SAGE, "LOW": SAGE,
        }
        for s, a in flat[:12]:
            sev = (a.get("severity") or "info")
            chip_color = sev_color.get(sev, MUTED)
            t = Table([
                [
                    Paragraph(
                        f"<b>{(a.get('headline') or a.get('title') or a.get('rule') or 'Heads up')}</b>",
                        body,
                    ),
                    Paragraph(f"<font color='#5C6878' size='8'>{sev.upper()}</font>", muted),
                ],
                [Paragraph((a.get("detail") or a.get("description") or ""), muted), ""],
                [
                    Paragraph(
                        f"<font color='#5C6878' size='8'>Statement: "
                        f"{s.get('period_label') or (s.get('uploaded_at') or '')[:10]}</font>",
                        muted,
                    ),
                    "",
                ],
            ], colWidths=[None, 18 * mm])
            t.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), CREAM),
                ("LINEBEFORE", (0, 0), (0, -1), 2.4, chip_color),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("SPAN", (0, 1), (1, 1)),
                ("SPAN", (0, 2), (1, 2)),
            ]))
            story.append(t)
            story.append(Spacer(1, 4))

    # Footer / disclaimer
    story.append(Spacer(1, 8))
    story.append(Paragraph(
        "<i>This document was generated by Wayly from the household's uploaded statements. "
        "AI may be incorrect — verify before acting. Confidential — for the named adviser and client only.</i>",
        muted,
    ))

    doc.build(story)
    pdf_bytes = buf.getvalue()
    from fastapi.responses import Response
    safe_name = "".join(
        c for c in (client.get("client_name") or "client") if c.isalnum() or c in " -_"
    ).strip().replace(" ", "_")
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="wayly-review-{safe_name}.pdf"',
        },
    )
