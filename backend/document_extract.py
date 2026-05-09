"""Document extraction — routes uploads to text or vision-OCR pipelines.

Returns: (text, input_method, page_count, parsing_warnings)
"""
from __future__ import annotations
import asyncio
import base64
import io
import logging
import os
import re
from typing import Tuple, List, Dict, Any

logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = {".pdf", ".txt", ".csv", ".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp"}

MAX_BYTES = 20 * 1024 * 1024  # 20 MB

_HEIF_REGISTERED = False


class UnsupportedFormatError(Exception):
    pass


class FileTooLargeError(Exception):
    def __init__(self, ext: str, limit_bytes: int):
        self.ext = ext
        self.limit_bytes = limit_bytes
        super().__init__(f"{ext} exceeds limit of {limit_bytes} bytes")


class CorruptFileError(Exception):
    pass


class PasswordProtectedError(Exception):
    pass


def _ext(filename: str) -> str:
    name = (filename or "").lower()
    m = re.search(r"\.[a-z0-9]{2,5}$", name)
    return m.group(0) if m else ""


def _ensure_heif():
    global _HEIF_REGISTERED
    if _HEIF_REGISTERED:
        return
    try:
        from pillow_heif import register_heif_opener
        register_heif_opener()
        _HEIF_REGISTERED = True
    except Exception as e:
        logger.warning("HEIF support unavailable: %s", e)


def _decode_text(raw: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8", "latin-1", "cp1252"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    raise CorruptFileError("Could not decode text file")


def _extract_pdf_text(raw: bytes) -> Tuple[str, int]:
    try:
        import pdfplumber
        with pdfplumber.open(io.BytesIO(raw)) as pdf:
            chunks = []
            for p in pdf.pages:
                try:
                    t = p.extract_text() or ""
                except Exception:
                    t = ""
                if t:
                    chunks.append(t)
            return "\n".join(chunks), len(pdf.pages)
    except Exception as e:
        msg = str(e).lower()
        if "password" in msg or "encrypted" in msg:
            raise PasswordProtectedError("PDF is password-protected") from e
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(raw))
        if getattr(reader, "is_encrypted", False):
            raise PasswordProtectedError("PDF is password-protected")
        text = "\n".join((p.extract_text() or "") for p in reader.pages)
        return text, len(reader.pages)


def _image_to_b64_jpeg(raw: bytes, ext: str) -> str:
    _ensure_heif()
    from PIL import Image, ImageOps
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception as e:
        raise CorruptFileError(f"Could not open {ext}: {e}") from e
    try:
        img = ImageOps.exif_transpose(img)
    except Exception:
        pass
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGB")
    # Resize to fit reasonable bound (longest side <= 2000px for vision)
    w, h = img.size
    max_side = max(w, h)
    if max_side > 2000:
        scale = 2000.0 / max_side
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88)
    return base64.b64encode(buf.getvalue()).decode("ascii")


VISION_PROMPT = """You are reading a photographed Australian Support at Home aged-care monthly statement. Extract every piece of information visible — preserving the original column structure of any tables.

TABLES: Statement line items are usually a table with columns: date, service description, service code, hours/units, rate, total, participant contribution, government paid. Output each row tab-separated, one per line.

DOLLAR AMOUNTS: Read every figure precisely. Never round. If genuinely unclear, write [unclear: best-guess].

DATES: Read exactly as written.

PROVIDER NAME: Usually in the header.

STREAM LABELS: Look for Clinical, Independence, Everyday Living section headers.

Return ONLY the extracted text — no commentary, no markdown, no headings of your own.
"""


async def _vision_extract(image_b64: str, label: str = "image") -> str:
    from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent
    api_key = os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise CorruptFileError("Vision processing unavailable — EMERGENT_LLM_KEY not set")
    chat = LlmChat(
        api_key=api_key,
        session_id=f"vision-{label}",
        system_message=VISION_PROMPT,
    ).with_model("anthropic", "claude-sonnet-4-5-20250929").with_params(max_tokens=4000)
    msg = UserMessage(
        text="Read this Support at Home statement.",
        file_contents=[ImageContent(image_base64=image_b64)],
    )
    try:
        result = await chat.send_message(msg)
    except Exception as e:
        raise CorruptFileError(f"Vision extraction failed: {e}") from e
    return str(result or "")


async def extract_document(filename: str, raw: bytes) -> Tuple[str, str, int, List[str]]:
    """Returns (text, input_method, page_count, warnings)."""
    ext = _ext(filename)
    if ext not in ALLOWED_EXTENSIONS:
        raise UnsupportedFormatError(ext or "(no extension)")
    if len(raw) > MAX_BYTES:
        raise FileTooLargeError(ext, MAX_BYTES)

    warnings: list[str] = []

    if ext in (".txt", ".csv"):
        return _decode_text(raw), "text_file", 1, warnings

    if ext == ".pdf":
        text, page_count = _extract_pdf_text(raw)
        cleaned = (text or "").strip()
        if len(cleaned) > 200:
            return cleaned, "pdf_text", page_count, warnings
        # Sparse — would need pdf2image+vision, out of scope for mobile MVP
        if cleaned:
            warnings.append("PDF text was sparse — result may be incomplete. Try uploading a clear photo.")
            return cleaned, "pdf_text", page_count, warnings
        raise CorruptFileError("PDF has no extractable text. Try uploading a photo of the page instead.")

    if ext in (".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp"):
        b64 = _image_to_b64_jpeg(raw, ext)
        text = await _vision_extract(b64, label=f"single-{ext.lstrip('.')}")
        if not text or len(text.strip()) < 20:
            warnings.append("Image read returned little text. Try better lighting and hold steady.")
        return text, "image_vision", 1, warnings

    raise UnsupportedFormatError(ext)
