"""Wayly Support at Home budget logic — quarterly windows, allocations, burn."""
from datetime import date, timedelta

# Annual budget by classification level (Support at Home programme — illustrative figures)
CLASSIFICATIONS = {
    1: {"label": "Level 1", "annual": 11500},
    2: {"label": "Level 2", "annual": 16500},
    3: {"label": "Level 3", "annual": 24000},
    4: {"label": "Level 4", "annual": 35000},
    5: {"label": "Level 5", "annual": 48000},
    6: {"label": "Level 6", "annual": 60000},
    7: {"label": "Level 7", "annual": 75000},
    8: {"label": "Level 8", "annual": 92000},
}

STREAMS = ["Clinical", "Independence", "Everyday Living"]

# Stream allocation percentages (Clinical heaviest at higher levels)
STREAM_PCT = {"Clinical": 0.50, "Independence": 0.30, "Everyday Living": 0.20}


def quarterly_budget(classification: int) -> float:
    return round(CLASSIFICATIONS[classification]["annual"] / 4, 2)


def stream_allocations(classification: int) -> dict:
    q = quarterly_budget(classification)
    return {s: round(q * STREAM_PCT[s], 2) for s in STREAMS}


def lifetime_cap(is_grandfathered: bool) -> float:
    return 130000.0 if is_grandfathered else 165000.0


def rollover_cap(classification: int) -> float:
    return round(quarterly_budget(classification) * 0.10, 2)


def get_quarter_window():
    today = date.today()
    q_index = (today.month - 1) // 3
    q_start_month = q_index * 3 + 1
    q_start = date(today.year, q_start_month, 1)
    if q_start_month + 3 > 12:
        q_end = date(today.year, 12, 31)
    else:
        q_end = date(today.year, q_start_month + 3, 1) - timedelta(days=1)
    q_label = f"Q{q_index + 1} {today.year}"
    return q_start, q_end, q_label


def compute_burn(line_items: list, q_start, q_end) -> dict:
    """Returns {stream: amount_spent_in_quarter}."""
    out = {s: 0.0 for s in STREAMS}
    for it in line_items:
        d = it.get("date", "")
        try:
            from datetime import datetime as _dt
            it_date = _dt.fromisoformat(d).date() if "T" in d else _dt.strptime(d, "%Y-%m-%d").date()
        except Exception:
            continue
        if q_start <= it_date <= q_end:
            stream = it.get("stream")
            if stream in out:
                out[stream] += float(it.get("total", 0) or 0)
    return {k: round(v, 2) for k, v in out.items()}


def compute_contributions(line_items: list) -> float:
    return round(sum(float(it.get("contribution_paid", 0) or 0) for it in line_items), 2)
