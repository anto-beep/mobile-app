"""LLM-powered statement parsing — turns extracted text into structured line items + plain-English summary + anomaly flags."""
import json
import logging
import os
import re
from typing import List, Dict, Any

logger = logging.getLogger(__name__)


PARSE_SYSTEM = """You are Wayly's statement-parsing agent. Given the raw text of an Australian Support at Home aged-care monthly statement, you produce structured JSON.

Return ONLY valid JSON with this exact shape:
{
  "period_label": "October 2025" or null,
  "summary": "Two short sentences in plain English. Warm, calm tone. Mention total spent and what the participant contributed. Never alarmist.",
  "line_items": [
    {
      "date": "YYYY-MM-DD",
      "service_code": "string or empty",
      "service_name": "Personal care",
      "stream": "Clinical" | "Independence" | "Everyday Living",
      "units": 1.5,
      "unit_price": 75.00,
      "total": 112.50,
      "contribution_paid": 11.25,
      "government_paid": 101.25
    }
  ],
  "anomalies": [
    {
      "severity": "info" | "warning" | "alert",
      "title": "Short title (under 8 words)",
      "detail": "One sentence in plain English explaining what we found.",
      "suggested_action": "What the caregiver could do next, or null."
    }
  ]
}

Stream classification rules:
- Clinical: nursing, allied health, wound care, physio, OT, podiatry, dietetics
- Independence: personal care, social support, transport, domestic assistance with mobility
- Everyday Living: cleaning, laundry, meal prep, shopping, gardening

Anomaly heuristics:
- alert: duplicate identical line on same date; total > $500 single line; rate appears 30%+ above stream typical (~$80/hr Clinical, ~$60/hr Independence, ~$50/hr Everyday Living)
- warning: weekend/public-holiday rate without flag; new provider not seen before
- info: first appearance of a new service category

Be conservative — if uncertain, omit the line. Never invent line items."""


async def parse_statement(text: str) -> Dict[str, Any]:
    """Returns dict with period_label, summary, line_items, anomalies."""
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise RuntimeError("EMERGENT_LLM_KEY not configured")
    chat = LlmChat(
        api_key=api_key,
        session_id=f"parse-{abs(hash(text[:200])) % 10**8}",
        system_message=PARSE_SYSTEM,
    ).with_model("anthropic", "claude-sonnet-4-5-20250929").with_params(max_tokens=4000)
    msg = UserMessage(text=f"Parse this statement text:\n\n{text[:12000]}")
    raw = await chat.send_message(msg)
    raw_str = str(raw or "")
    # Strip markdown code fences if model adds them
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw_str.strip(), flags=re.MULTILINE)
    try:
        data = json.loads(cleaned)
    except Exception as e:
        logger.warning("Parse JSON failed: %s; raw=%s", e, raw_str[:300])
        # Fallback: try to find {...} block
        m = re.search(r"\{[\s\S]*\}", cleaned)
        if m:
            try:
                data = json.loads(m.group(0))
            except Exception:
                data = {"period_label": None, "summary": "We had trouble reading this statement automatically. The original text is saved.", "line_items": [], "anomalies": []}
        else:
            data = {"period_label": None, "summary": "We had trouble reading this statement automatically.", "line_items": [], "anomalies": []}
    # Normalise
    data.setdefault("period_label", None)
    data.setdefault("summary", "")
    data.setdefault("line_items", [])
    data.setdefault("anomalies", [])
    return data
