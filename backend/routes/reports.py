"""Reports — extracted from server.py.

Owns the "Reports" tab of the mobile app:
  * Eight on-demand report generators (Household summary, Quarterly budget,
    Annual Financial Summary, Anomaly & Savings, Provider Performance,
    Complaint Dossier, Care Timeline, Statement Digest)
  * A persisted "Your reports" library — each generated PDF is base64'd into
    MongoDB so it can be downloaded later or shared with a family member
  * Strict per-participant isolation — every list/detail/delete is filtered by
    the `X-Participant-Id` header AND validated against the caller's account

This module deliberately reuses the Wayly brand palette + reportlab patterns
already established by `adviser_review_pack_pdf` in routes/adviser.py.
"""
from __future__ import annotations

import base64
import io
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from reportlab.lib import colors as rl_colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from active_participant import get_active_participant
from auth import get_current_user_id
from deps import db
from models import new_id, now_iso

router = APIRouter(prefix="/api", tags=["reports"])
logger = logging.getLogger("wayly")

# ─── shared palette ────────────────────────────────────────────────────────
NAVY = rl_colors.HexColor("#1F3A5F")
GOLD = rl_colors.HexColor("#D4A24E")
SAGE = rl_colors.HexColor("#7A9B7E")
TERRA = rl_colors.HexColor("#C5734D")
MUTED = rl_colors.HexColor("#5C6878")
CREAM = rl_colors.HexColor("#FAF7F2")
BORDER = rl_colors.HexColor("#E8E2D6")
BLACK = rl_colors.HexColor("#1A1A1A")

REPORT_TYPES = {
    "household_summary":      "Household summary",
    "quarterly_budget":       "Quarterly budget",
    "annual_financial":       "Annual financial summary",
    "anomaly_savings":        "Anomaly & savings",
    "provider_performance":   "Provider performance",
    "complaint_dossier":      "Complaint dossier",
    "care_timeline":          "Care timeline",
    "statement_digest":       "Statement digest",
}


def _styles():
    base = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=base["Heading1"], fontName="Helvetica-Bold", fontSize=22, textColor=NAVY, leading=26, spaceAfter=6)
    h2 = ParagraphStyle("h2", parent=base["Heading2"], fontName="Helvetica-Bold", fontSize=13, textColor=NAVY, leading=16, spaceBefore=10, spaceAfter=6)
    body = ParagraphStyle("body", parent=base["BodyText"], fontName="Helvetica", fontSize=10, textColor=BLACK, leading=14)
    muted = ParagraphStyle("muted", parent=body, textColor=MUTED, fontSize=9, leading=12)
    overline = ParagraphStyle("overline", parent=muted, fontName="Helvetica-Bold", textColor=MUTED, fontSize=8, spaceAfter=2)
    return h1, h2, body, muted, overline


def _doc(title: str, author: str) -> tuple[SimpleDocTemplate, io.BytesIO]:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=title,
        author=author,
    )
    return doc, buf


def _header(story: list, participant: dict, label: str, period_label: str, user: dict) -> None:
    h1, _, _, muted, overline = _styles()
    participant_name = " ".join(
        n for n in [participant.get("first_name"), participant.get("last_name")] if n
    ) or "Participant"
    story.append(Paragraph(f"WAYLY  ·  {label.upper()}", overline))
    story.append(Paragraph(participant_name, h1))
    story.append(Paragraph(
        f"{period_label}  ·  Prepared {datetime.now(timezone.utc).strftime('%d %b %Y')}"
        f"  ·  by {user.get('name') or user.get('email','')}",
        muted,
    ))
    story.append(Spacer(1, 8))


def _meta_table(rows: list[list[str]]) -> Table:
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
    return tbl


def _metrics_strip(items: list[tuple[str, str]]) -> Table:
    """3-up KPI strip — items: list of (label, value)."""
    head = [lbl for lbl, _ in items]
    row = [val for _, val in items]
    tbl = Table([head, row], colWidths=[None] * len(items))
    tbl.setStyle(TableStyle([
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
    return tbl


def _footer(story: list) -> None:
    _, _, _, muted, _ = _styles()
    story.append(Spacer(1, 12))
    story.append(Paragraph(
        "<i>Generated by Wayly from this participant's uploaded statements and timeline events. "
        "AI assistance was used — verify before sharing externally.</i>",
        muted,
    ))


# ───────────────────────── data helpers ───────────────────────────────────
async def _statements_for_participant(participant: dict, limit: int = 100) -> list[dict]:
    """Statements are still keyed by household_id in the legacy schema; the
    participant record stores its household_id so we can scope cleanly."""
    hh = participant.get("household_id") or participant.get("account_id")
    if not hh:
        return []
    return await db.statements.find({"household_id": hh}, {"_id": 0}).sort("uploaded_at", -1).to_list(limit)


async def _visits_for_participant(participant: dict, limit: int = 100) -> list[dict]:
    hh = participant.get("household_id") or participant.get("account_id")
    if not hh:
        return []
    return await db.visits.find({"household_id": hh}, {"_id": 0}).sort("starts_at", -1).to_list(limit)


async def _events_for_participant(participant: dict, limit: int = 200) -> list[dict]:
    """Scenario timeline events, if the participant has any."""
    return await db.scenario_events.find(
        {"participant_id": participant["id"]}, {"_id": 0}
    ).sort("ts", -1).to_list(limit)


# ───────────────────────── 8 report builders ──────────────────────────────
def _b_household_summary(participant: dict, statements: list[dict], visits: list[dict], user: dict) -> bytes:
    h1, h2, body, muted, _ = _styles()
    doc, buf = _doc("Household summary — Wayly", user.get("name") or "Wayly")
    story: list = []
    _header(story, participant, "Household summary", "Snapshot today", user)

    name = " ".join(n for n in [participant.get("first_name"), participant.get("last_name")] if n) or "Participant"
    cls = participant.get("classification") or "—"
    provider = participant.get("provider_name") or participant.get("provider") or "—"

    story.append(_meta_table([
        ["Participant", name],
        ["Classification", f"Level {cls}" if isinstance(cls, int) else str(cls)],
        ["Provider", str(provider)],
        ["Statements on file", str(len(statements))],
        ["Upcoming visits", str(sum(1 for v in visits if (v.get("starts_at") or "") >= now_iso()))],
        ["Status", (participant.get("status") or "active").capitalize()],
    ]))

    # Last 5 statements
    story.append(Paragraph("Recent statements", h2))
    if not statements:
        story.append(Paragraph("No statements uploaded yet.", muted))
    else:
        data = [["Period", "Uploaded", "Items", "Anomalies", "Gross"]]
        for s in statements[:5]:
            gross = sum(float(li.get("total") or 0) for li in (s.get("line_items") or []))
            data.append([
                s.get("period_label") or "—",
                (s.get("uploaded_at") or "")[:10],
                str(len(s.get("line_items") or [])),
                str(len(s.get("anomalies") or [])),
                f"${gross:,.0f}",
            ])
        t = Table(data, colWidths=[40 * mm, 28 * mm, 22 * mm, 22 * mm, 28 * mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), CREAM),
            ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8.5),
            ("TEXTCOLOR", (0, 0), (-1, 0), MUTED),
            ("FONT", (0, 1), (-1, -1), "Helvetica", 9.5),
            ("TEXTCOLOR", (0, 1), (-1, -1), NAVY),
            ("LINEBELOW", (0, 0), (-1, -1), 0.4, BORDER),
            ("ALIGN", (2, 1), (-1, -1), "RIGHT"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(t)

    _footer(story)
    doc.build(story)
    return buf.getvalue()


def _b_quarterly_budget(participant: dict, statements: list[dict], user: dict, period: str) -> bytes:
    h1, h2, body, muted, _ = _styles()
    doc, buf = _doc(f"Quarterly budget — {period}", user.get("name") or "Wayly")
    story: list = []
    _header(story, participant, "Quarterly budget", period, user)

    in_period = []
    for s in statements:
        per = (s.get("period_label") or "").lower()
        if period.lower() in per or (s.get("uploaded_at", "")[:7] in period.lower()):
            in_period.append(s)
    if not in_period:
        in_period = statements[:3]

    gross = sum(
        sum(float(li.get("total") or 0) for li in (s.get("line_items") or []))
        for s in in_period
    )
    line_count = sum(len(s.get("line_items") or []) for s in in_period)
    anomaly_count = sum(len(s.get("anomalies") or []) for s in in_period)

    story.append(_metrics_strip([
        ("Statements", str(len(in_period))),
        ("Line items", str(line_count)),
        ("Gross billed", f"${gross:,.0f}"),
    ]))

    # By-service breakdown
    by_service: dict[str, float] = {}
    for s in in_period:
        for li in s.get("line_items") or []:
            key = li.get("service_name") or li.get("service") or "Other"
            by_service[key] = by_service.get(key, 0) + float(li.get("total") or 0)
    sorted_svc = sorted(by_service.items(), key=lambda kv: kv[1], reverse=True)

    story.append(Paragraph("Spend by service", h2))
    if not sorted_svc:
        story.append(Paragraph("No line items in this quarter.", muted))
    else:
        data = [["Service", "Amount", "Share"]]
        for name, amt in sorted_svc[:12]:
            data.append([name, f"${amt:,.0f}", f"{(amt / gross * 100):.1f}%" if gross else "—"])
        t = Table(data, colWidths=[None, 30 * mm, 22 * mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), CREAM),
            ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8.5),
            ("TEXTCOLOR", (0, 0), (-1, 0), MUTED),
            ("FONT", (0, 1), (-1, -1), "Helvetica", 9.5),
            ("TEXTCOLOR", (0, 1), (-1, -1), NAVY),
            ("LINEBELOW", (0, 0), (-1, -1), 0.4, BORDER),
            ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(t)

    if anomaly_count:
        story.append(Paragraph(f"⚠ {anomaly_count} anomalies flagged this quarter — see Anomaly & Savings report for detail.", muted))

    _footer(story)
    doc.build(story)
    return buf.getvalue()


def _b_annual_financial(participant: dict, statements: list[dict], user: dict, fy_label: str) -> bytes:
    h1, h2, body, muted, _ = _styles()
    doc, buf = _doc(f"Annual financial summary — {fy_label}", user.get("name") or "Wayly")
    story: list = []
    _header(story, participant, "Annual financial summary", fy_label, user)

    total_gross = sum(
        sum(float(li.get("total") or 0) for li in (s.get("line_items") or []))
        for s in statements
    )
    total_anomalies = sum(len(s.get("anomalies") or []) for s in statements)
    months: dict[str, float] = {}
    for s in statements:
        key = (s.get("uploaded_at") or "")[:7]
        gross = sum(float(li.get("total") or 0) for li in (s.get("line_items") or []))
        if key:
            months[key] = months.get(key, 0) + gross
    avg_monthly = (total_gross / max(1, len(months))) if months else 0

    story.append(_metrics_strip([
        ("Annual gross", f"${total_gross:,.0f}"),
        ("Statements", str(len(statements))),
        ("Avg / month", f"${avg_monthly:,.0f}"),
    ]))

    # Month-by-month
    story.append(Paragraph("Month by month", h2))
    if not months:
        story.append(Paragraph("No statements uploaded yet for this year.", muted))
    else:
        data = [["Month", "Statements", "Gross"]]
        for m in sorted(months.keys()):
            stmts_in_month = sum(1 for s in statements if (s.get("uploaded_at") or "").startswith(m))
            data.append([m, str(stmts_in_month), f"${months[m]:,.0f}"])
        t = Table(data, colWidths=[40 * mm, 30 * mm, 40 * mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), CREAM),
            ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8.5),
            ("TEXTCOLOR", (0, 0), (-1, 0), MUTED),
            ("FONT", (0, 1), (-1, -1), "Helvetica", 9.5),
            ("TEXTCOLOR", (0, 1), (-1, -1), NAVY),
            ("LINEBELOW", (0, 0), (-1, -1), 0.4, BORDER),
            ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(t)

    story.append(Paragraph("Anomaly summary", h2))
    story.append(Paragraph(
        f"{total_anomalies} anomalies flagged across the year. See the Anomaly & savings report for the line-by-line view.",
        muted,
    ))

    _footer(story)
    doc.build(story)
    return buf.getvalue()


def _b_anomaly_savings(participant: dict, statements: list[dict], user: dict) -> bytes:
    h1, h2, body, muted, _ = _styles()
    doc, buf = _doc("Anomaly & savings — Wayly", user.get("name") or "Wayly")
    story: list = []
    _header(story, participant, "Anomaly & savings", "All time", user)

    flat: list[tuple[dict, dict]] = []
    estimated_savings = 0.0
    for s in statements:
        for a in s.get("anomalies") or []:
            flat.append((s, a))
            try:
                estimated_savings += float(a.get("estimated_overcharge") or 0)
            except (TypeError, ValueError):
                pass

    by_sev = {"alert": 0, "warning": 0, "info": 0}
    for _, a in flat:
        sev = (a.get("severity") or "info").lower()
        by_sev[sev] = by_sev.get(sev, 0) + 1

    story.append(_metrics_strip([
        ("Total flagged", str(len(flat))),
        ("Alerts", str(by_sev.get("alert", 0))),
        ("Est. savings", f"${estimated_savings:,.0f}" if estimated_savings else "—"),
    ]))

    story.append(Paragraph("Top flagged items", h2))
    if not flat:
        story.append(Paragraph("No anomalies detected. Your statements look clean.", muted))
    else:
        sev_color = {"alert": TERRA, "warning": GOLD, "info": SAGE}
        for s, a in flat[:18]:
            sev = (a.get("severity") or "info").lower()
            chip = sev_color.get(sev, MUTED)
            t = Table([
                [
                    Paragraph(f"<b>{a.get('headline') or a.get('title') or 'Heads up'}</b>", body),
                    Paragraph(f"<font color='#5C6878' size='8'>{sev.upper()}</font>", muted),
                ],
                [Paragraph(a.get("detail") or a.get("description") or "", muted), ""],
                [Paragraph(
                    f"<font color='#5C6878' size='8'>Statement: {s.get('period_label') or (s.get('uploaded_at') or '')[:10]}</font>",
                    muted,
                ), ""],
            ], colWidths=[None, 18 * mm])
            t.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), CREAM),
                ("LINEBEFORE", (0, 0), (0, -1), 2.4, chip),
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

    _footer(story)
    doc.build(story)
    return buf.getvalue()


def _b_provider_performance(participant: dict, statements: list[dict], user: dict) -> bytes:
    h1, h2, body, muted, _ = _styles()
    doc, buf = _doc("Provider performance — Wayly", user.get("name") or "Wayly")
    story: list = []
    _header(story, participant, "Provider performance", "All time", user)

    by_provider: dict[str, dict] = {}
    for s in statements:
        prov = s.get("provider_name") or participant.get("provider_name") or "Provider"
        entry = by_provider.setdefault(prov, {"statements": 0, "gross": 0.0, "anomalies": 0})
        entry["statements"] += 1
        entry["gross"] += sum(float(li.get("total") or 0) for li in (s.get("line_items") or []))
        entry["anomalies"] += len(s.get("anomalies") or [])

    if not by_provider:
        story.append(Paragraph("No statements uploaded yet to compare providers.", muted))
    else:
        story.append(_metrics_strip([
            ("Providers", str(len(by_provider))),
            ("Total statements", str(sum(e["statements"] for e in by_provider.values()))),
            ("Total flagged", str(sum(e["anomalies"] for e in by_provider.values()))),
        ]))
        story.append(Paragraph("By provider", h2))
        data = [["Provider", "Statements", "Anomalies", "Gross"]]
        for prov, e in sorted(by_provider.items(), key=lambda kv: kv[1]["gross"], reverse=True):
            data.append([prov, str(e["statements"]), str(e["anomalies"]), f"${e['gross']:,.0f}"])
        t = Table(data, colWidths=[None, 28 * mm, 28 * mm, 32 * mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), CREAM),
            ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8.5),
            ("TEXTCOLOR", (0, 0), (-1, 0), MUTED),
            ("FONT", (0, 1), (-1, -1), "Helvetica", 9.5),
            ("TEXTCOLOR", (0, 1), (-1, -1), NAVY),
            ("LINEBELOW", (0, 0), (-1, -1), 0.4, BORDER),
            ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(t)

    _footer(story)
    doc.build(story)
    return buf.getvalue()


def _b_complaint_dossier(participant: dict, events: list[dict], statements: list[dict], user: dict) -> bytes:
    h1, h2, body, muted, _ = _styles()
    doc, buf = _doc("Complaint dossier — Wayly", user.get("name") or "Wayly")
    story: list = []
    _header(story, participant, "Complaint dossier", "All time", user)

    complaints = [e for e in events if (e.get("type") or "").startswith("COMPLAINT")]
    anom_alerts = [a for s in statements for a in (s.get("anomalies") or []) if (a.get("severity") or "").lower() == "alert"]

    story.append(_metrics_strip([
        ("Complaint events", str(len(complaints))),
        ("Alert anomalies", str(len(anom_alerts))),
        ("Affected statements", str(len({(s.get("id"), s.get("period_label")) for s in statements for a in (s.get("anomalies") or []) if (a.get("severity") or "").lower() == "alert"}))),
    ]))

    story.append(Paragraph("Event log", h2))
    if not complaints and not anom_alerts:
        story.append(Paragraph(
            "No complaint events logged yet. Items flagged as ALERT anomalies will be summarised here when raised.",
            muted,
        ))
    else:
        for e in complaints[:25]:
            story.append(Paragraph(
                f"<b>{(e.get('type') or 'COMPLAINT').replace('_', ' ').title()}</b>  ·  <font color='#5C6878' size='8'>{(e.get('ts') or '')[:10]}</font>",
                body,
            ))
            story.append(Paragraph(e.get("summary") or e.get("description") or "—", muted))
            story.append(Spacer(1, 4))

        if anom_alerts:
            story.append(Paragraph("Statement alerts referenced in this dossier", h2))
            for a in anom_alerts[:15]:
                story.append(Paragraph(
                    f"<b>{a.get('headline') or a.get('title') or 'Alert'}</b> — {a.get('detail') or a.get('description') or ''}",
                    muted,
                ))
                story.append(Spacer(1, 3))

    _footer(story)
    doc.build(story)
    return buf.getvalue()


def _b_care_timeline(participant: dict, statements: list[dict], visits: list[dict], events: list[dict], user: dict) -> bytes:
    h1, h2, body, muted, _ = _styles()
    doc, buf = _doc("Care timeline — Wayly", user.get("name") or "Wayly")
    story: list = []
    _header(story, participant, "Care timeline", "All time", user)

    rows: list[tuple[str, str, str]] = []
    for v in visits:
        rows.append((v.get("starts_at") or "", "Visit", f"{v.get('title','—')} · {v.get('provider','')}".strip(" ·")))
    for s in statements:
        rows.append((s.get("uploaded_at") or "", "Statement", s.get("period_label") or s.get("filename") or "Statement"))
    for e in events:
        rows.append((e.get("ts") or "", (e.get("type") or "Event").title(), e.get("summary") or e.get("description") or ""))

    rows.sort(key=lambda r: r[0], reverse=True)

    if not rows:
        story.append(Paragraph("No timeline activity yet. Upload statements or add visits to populate.", muted))
    else:
        data = [["When", "Kind", "Detail"]]
        for when, kind, detail in rows[:40]:
            data.append([(when or "")[:10], kind, detail or ""])
        t = Table(data, colWidths=[25 * mm, 30 * mm, None])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), CREAM),
            ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8.5),
            ("TEXTCOLOR", (0, 0), (-1, 0), MUTED),
            ("FONT", (0, 1), (-1, -1), "Helvetica", 9.5),
            ("TEXTCOLOR", (0, 1), (-1, -1), NAVY),
            ("LINEBELOW", (0, 0), (-1, -1), 0.4, BORDER),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]))
        story.append(t)

    _footer(story)
    doc.build(story)
    return buf.getvalue()


def _b_statement_digest(participant: dict, statement: dict, user: dict) -> bytes:
    h1, h2, body, muted, _ = _styles()
    doc, buf = _doc("Statement digest — Wayly", user.get("name") or "Wayly")
    story: list = []
    _header(story, participant, "Statement digest", statement.get("period_label") or "Statement", user)

    line_items = statement.get("line_items") or []
    anomalies = statement.get("anomalies") or []
    gross = sum(float(li.get("total") or 0) for li in line_items)

    story.append(_metrics_strip([
        ("Line items", str(len(line_items))),
        ("Anomalies", str(len(anomalies))),
        ("Gross", f"${gross:,.0f}"),
    ]))

    if statement.get("summary"):
        story.append(Paragraph("Plain-English summary", h2))
        story.append(Paragraph(statement["summary"], body))

    story.append(Paragraph("Line items", h2))
    if not line_items:
        story.append(Paragraph("No line items parsed from this statement.", muted))
    else:
        data = [["Service", "Total"]]
        for li in line_items[:30]:
            data.append([li.get("service_name") or li.get("service") or "—", f"${float(li.get('total') or 0):,.2f}"])
        t = Table(data, colWidths=[None, 30 * mm])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), CREAM),
            ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8.5),
            ("TEXTCOLOR", (0, 0), (-1, 0), MUTED),
            ("FONT", (0, 1), (-1, -1), "Helvetica", 9.5),
            ("TEXTCOLOR", (0, 1), (-1, -1), NAVY),
            ("LINEBELOW", (0, 0), (-1, -1), 0.4, BORDER),
            ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(t)

    if anomalies:
        story.append(Paragraph("Flagged items", h2))
        for a in anomalies[:15]:
            story.append(Paragraph(
                f"<b>{a.get('headline') or a.get('title') or 'Heads up'}</b> — {a.get('detail') or a.get('description') or ''}",
                muted,
            ))
            story.append(Spacer(1, 3))

    _footer(story)
    doc.build(story)
    return buf.getvalue()


# ───────────────────────── API surface ────────────────────────────────────
class GenerateBody(BaseModel):
    report_type: str = Field(min_length=2)
    period_label: Optional[str] = None
    # Statement-digest only: which statement to digest
    statement_id: Optional[str] = None


def _period_default(report_type: str) -> str:
    now = datetime.now(timezone.utc)
    if report_type == "quarterly_budget":
        q = (now.month - 1) // 3 + 1
        return f"Q{q} {now.year}"
    if report_type == "annual_financial":
        return f"FY {now.year - 1}-{str(now.year)[-2:]}"
    return now.strftime("%b %Y")


@router.post("/reports/generate")
async def reports_generate(
    payload: GenerateBody,
    participant: dict = Depends(get_active_participant),
    user_id: str = Depends(get_current_user_id),
):
    if payload.report_type not in REPORT_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown report_type. Must be one of: {', '.join(REPORT_TYPES)}",
        )
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    period_label = payload.period_label or _period_default(payload.report_type)
    statements = await _statements_for_participant(participant)
    visits = await _visits_for_participant(participant)
    events = await _events_for_participant(participant)

    try:
        if payload.report_type == "household_summary":
            pdf = _b_household_summary(participant, statements, visits, user)
        elif payload.report_type == "quarterly_budget":
            pdf = _b_quarterly_budget(participant, statements, user, period_label)
        elif payload.report_type == "annual_financial":
            pdf = _b_annual_financial(participant, statements, user, period_label)
        elif payload.report_type == "anomaly_savings":
            pdf = _b_anomaly_savings(participant, statements, user)
        elif payload.report_type == "provider_performance":
            pdf = _b_provider_performance(participant, statements, user)
        elif payload.report_type == "complaint_dossier":
            pdf = _b_complaint_dossier(participant, events, statements, user)
        elif payload.report_type == "care_timeline":
            pdf = _b_care_timeline(participant, statements, visits, events, user)
        elif payload.report_type == "statement_digest":
            stmt = None
            if payload.statement_id:
                stmt = await db.statements.find_one(
                    {"id": payload.statement_id, "household_id": participant.get("household_id") or participant.get("account_id")},
                    {"_id": 0},
                )
            elif statements:
                stmt = statements[0]
            if not stmt:
                raise HTTPException(status_code=400, detail="No statement available to digest.")
            pdf = _b_statement_digest(participant, stmt, user)
        else:  # pragma: no cover — guarded above
            raise HTTPException(status_code=422, detail="Unsupported report_type")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Report generation failed")
        raise HTTPException(status_code=500, detail=f"Could not build report: {e}")

    # Persist
    rec = {
        "id": new_id(),
        "participant_id": participant["id"],
        "account_id": participant.get("account_id") or participant.get("household_id"),
        "generated_by": user_id,
        "report_type": payload.report_type,
        "title": REPORT_TYPES[payload.report_type],
        "period_label": period_label,
        "generated_at": now_iso(),
        "size_bytes": len(pdf),
        "pdf_data_b64": base64.b64encode(pdf).decode("ascii"),
        "status": "done",
    }
    await db.reports.insert_one(rec)
    # Mongo mutates `rec` with `_id`; pop it + heavy payload before returning.
    return {k: v for k, v in rec.items() if k not in ("pdf_data_b64", "_id")}


@router.get("/reports/types")
async def reports_types():
    """Discoverable list of report types and human labels — no auth required."""
    return [{"key": k, "label": v} for k, v in REPORT_TYPES.items()]


@router.get("/reports")
async def reports_list(participant: dict = Depends(get_active_participant)):
    """Per-participant library — never returns reports from other participants."""
    rows = (
        await db.reports.find(
            {"participant_id": participant["id"]},
            {"_id": 0, "pdf_data_b64": 0},
        )
        .sort("generated_at", -1)
        .to_list(500)
    )
    return {"items": rows, "participant_id": participant["id"]}


@router.get("/reports/{report_id}")
async def reports_detail(
    report_id: str, participant: dict = Depends(get_active_participant)
):
    rec = await db.reports.find_one(
        {"id": report_id, "participant_id": participant["id"]},
        {"_id": 0, "pdf_data_b64": 0},
    )
    if not rec:
        raise HTTPException(status_code=404, detail="Report not found.")
    return rec


@router.get("/reports/{report_id}/download")
async def reports_download(
    report_id: str, participant: dict = Depends(get_active_participant)
):
    rec = await db.reports.find_one({"id": report_id, "participant_id": participant["id"]})
    if not rec:
        raise HTTPException(status_code=404, detail="Report not found.")
    pdf = base64.b64decode(rec.get("pdf_data_b64") or "")
    safe = (rec.get("title") or "report").lower().replace(" ", "-")
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="wayly-{safe}-{report_id[:8]}.pdf"',
        },
    )


@router.delete("/reports/{report_id}")
async def reports_delete(
    report_id: str, participant: dict = Depends(get_active_participant)
):
    res = await db.reports.delete_one(
        {"id": report_id, "participant_id": participant["id"]}
    )
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Report not found.")
    return {"ok": True}
