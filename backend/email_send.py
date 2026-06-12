"""Resend transactional email helper.

Used by `/auth/forgot` (password resets) and adviser-invite flows. Falls back
to a no-op + log when `RESEND_API_KEY` is missing or set to a placeholder, so
local dev still works without sending real mail.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logger = logging.getLogger("wayly.email")


def _client():
    """Lazy resend client — imported on demand so missing dep doesn't break boot."""
    import resend  # type: ignore

    api_key = os.environ.get("RESEND_API_KEY", "").strip()
    if not api_key or api_key.startswith("re_REPLACE") or api_key == "placeholder":
        return None
    resend.api_key = api_key
    return resend


def _resolve_from(from_email: Optional[str]) -> Optional[str]:
    """Resolution order:
      1. Explicit `from_email=` argument (only used by tests / one-offs)
      2. `RESEND_FROM_EMAIL` env var (the canonical source of truth)
    If neither is set we return None so `send_email` can refuse to send,
    rather than silently delivering from a wrong address.
    """
    if from_email and from_email.strip():
        return from_email.strip()
    env_val = os.environ.get("RESEND_FROM_EMAIL", "").strip()
    return env_val or None


def send_email(
    to: str,
    subject: str,
    html: str,
    text: Optional[str] = None,
    from_email: Optional[str] = None,
) -> bool:
    """Send one email via Resend. Returns True on success, False on failure
    (so callers can decide whether to surface a soft warning).

    Falls back to logging + returning False when RESEND_API_KEY is missing —
    that way the password-reset endpoint still succeeds in dev with the link
    appearing in the backend logs (matches the pre-Resend behaviour).
    """
    resend = _client()
    if not resend:
        logger.warning(
            "Resend STUB MODE — RESEND_API_KEY missing/placeholder. "
            "Skipping send to=%s subject=%r (link should be in earlier log lines).",
            to, subject,
        )
        return False

    sender = _resolve_from(from_email)
    if not sender:
        logger.error(
            "Refusing to send: RESEND_FROM_EMAIL env var is empty and no from_email argument given. "
            "Set RESEND_FROM_EMAIL in backend/.env (e.g. 'Wayly <hello@wayly.com.au>').",
        )
        return False
    try:
        params: dict = {
            "from": sender,
            "to": [to],
            "subject": subject,
            "html": html,
        }
        if text:
            params["text"] = text
        resp = resend.Emails.send(params)  # type: ignore[attr-defined]
        msg_id = (resp or {}).get("id") if isinstance(resp, dict) else None
        logger.info("Resend OK to=%s from=%r subject=%r id=%s", to, sender, subject, msg_id)
        return True
    except Exception as e:
        logger.exception("Resend send FAILED to=%s subject=%r: %s", to, subject, e)
        return False


# ─── domain-specific helpers (small, opinionated) ───────────────────────────
def send_password_reset(to: str, reset_link_mobile: str, reset_link_web: str) -> bool:
    subject = "Reset your Wayly password"
    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; color: #1F3A5F;">
      <h1 style="font-size: 24px; margin: 0 0 16px;">Reset your password</h1>
      <p style="font-size: 15px; line-height: 1.55; color: #4A5568;">
        We received a request to reset your Wayly password. Tap the button below to choose a new one.
      </p>
      <p style="margin: 24px 0;">
        <a href="{reset_link_mobile}" style="background: #1F3A5F; color: #FAF7F2; padding: 12px 22px; border-radius: 8px; font-weight: 600; text-decoration: none;">Open Wayly</a>
      </p>
      <p style="font-size: 13px; color: #5C6878; line-height: 1.5;">
        On a desktop? Use this link instead:<br/>
        <a href="{reset_link_web}" style="color: #1F3A5F;">{reset_link_web}</a>
      </p>
      <p style="font-size: 12px; color: #8B9B82; margin-top: 32px; line-height: 1.5;">
        The link expires in 60 minutes. If you didn't request a reset, you can safely ignore this email — your account is still secure.
      </p>
    </div>
    """.strip()
    text = (
        f"Reset your Wayly password\n\n"
        f"Open in the app: {reset_link_mobile}\n"
        f"Or paste this in a browser: {reset_link_web}\n\n"
        f"The link expires in 60 minutes. Didn't ask for a reset? Just ignore this email."
    )
    return send_email(to, subject, html, text)


def send_adviser_invite(
    to: str,
    adviser_name: str,
    client_name: str,
    invite_link_mobile: str,
    invite_link_web: str,
) -> bool:
    subject = f"{adviser_name} invited you to Wayly"
    html = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; color: #1F3A5F;">
      <h1 style="font-size: 24px; margin: 0 0 16px;">{adviser_name} invited you to Wayly</h1>
      <p style="font-size: 15px; line-height: 1.55; color: #4A5568;">
        Hi {client_name},<br/><br/>
        {adviser_name} would like to help you keep an eye on your Support at Home statements through Wayly.
        Tap below to create your account — it takes about a minute.
      </p>
      <p style="margin: 24px 0;">
        <a href="{invite_link_mobile}" style="background: #1F3A5F; color: #FAF7F2; padding: 12px 22px; border-radius: 8px; font-weight: 600; text-decoration: none;">Accept invite</a>
      </p>
      <p style="font-size: 13px; color: #5C6878; line-height: 1.5;">
        On a desktop? Use this link instead:<br/>
        <a href="{invite_link_web}" style="color: #1F3A5F;">{invite_link_web}</a>
      </p>
      <p style="font-size: 12px; color: #8B9B82; margin-top: 32px; line-height: 1.5;">
        You can ignore this email if you'd rather not connect. {adviser_name} won't see your statements unless you accept.
      </p>
    </div>
    """.strip()
    text = (
        f"{adviser_name} invited you to Wayly.\n\n"
        f"Open in the app: {invite_link_mobile}\n"
        f"Or paste this in a browser: {invite_link_web}\n\n"
        f"You can ignore this email if you'd rather not connect."
    )
    return send_email(to, subject, html, text)
