"""Speech-to-text endpoint — OpenAI whisper-1 via the Emergent universal key.

Accepts a multipart audio upload at POST /api/transcribe with a single field
`file` containing the audio bytes. Returns `{"text": "..."}`.

The integration uses `emergentintegrations.llm.openai.speech_to_text` which
proxies through the Emergent gateway when the EMERGENT_LLM_KEY is in use.
"""
from __future__ import annotations

import io
import logging
import os
import tempfile
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, Form

from auth import get_current_user_id

load_dotenv()

router = APIRouter(prefix="/api", tags=["transcribe"])
logger = logging.getLogger("wayly")

# Whisper-1 supported extensions per the SDK.
_SUPPORTED_EXTS = {"mp3", "mp4", "mpeg", "mpga", "m4a", "wav", "webm"}
_MAX_BYTES = 25 * 1024 * 1024  # 25 MB hard cap (OpenAI limit)


@router.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language: Optional[str] = Form(None),
    _: str = Depends(get_current_user_id),  # auth-gate (user_id unused here)
):
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty audio file.")
    if len(raw) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail="Audio file too large (max 25 MB).")

    # Pick an extension whisper accepts. Some mobile recorders default to m4a
    # (iOS) or 3gp (Android); we coerce non-whisper formats by simply using
    # the suffix from the upload filename or falling back to m4a.
    filename = (file.filename or "clip.m4a").lower()
    suffix = Path(filename).suffix.lstrip(".") or "m4a"
    if suffix not in _SUPPORTED_EXTS:
        # Map a couple of common mobile defaults.
        mapping = {"aac": "m4a", "3gp": "m4a", "ogg": "webm", "oga": "webm"}
        suffix = mapping.get(suffix, "m4a")

    api_key = os.environ.get("EMERGENT_LLM_KEY") or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        logger.error("transcribe: missing EMERGENT_LLM_KEY / OPENAI_API_KEY")
        raise HTTPException(status_code=500, detail="Transcription service not configured.")

    try:
        from emergentintegrations.llm.openai.speech_to_text import OpenAISpeechToText

        stt = OpenAISpeechToText(api_key=api_key)
        # Write to a real temp file — litellm + openai SDK want a file path
        # so the multipart upload can include the proper filename + content-type.
        with tempfile.NamedTemporaryFile(delete=False, suffix=f".{suffix}") as tmp:
            tmp.write(raw)
            tmp_path = tmp.name
        try:
            response = await stt.transcribe(
                file=tmp_path,
                model="whisper-1",
                response_format="json",
                language=language or None,
            )
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

        # Response shape: TranscriptionResponse or dict-like with .text
        text = ""
        if hasattr(response, "text"):
            text = response.text or ""
        elif isinstance(response, dict):
            text = response.get("text", "") or ""
        else:
            text = str(response or "")
        return {"text": text.strip()}
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        logger.exception("transcribe failed")
        raise HTTPException(status_code=502, detail=f"Transcription failed: {e}")
