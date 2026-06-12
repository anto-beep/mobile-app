"""Document Vault — extracted from server.py.

Owns the household document vault (upload, list, detail, download, patch,
delete) plus an adviser read-only access path and a `send-to-decoder` shortcut
that reuses the statements upload pipeline.
"""
from __future__ import annotations

import base64
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from auth import get_current_user_id
from deps import db, get_household, get_user, require_household
from models import new_id, now_iso

router = APIRouter(prefix="/api", tags=["documents"])
logger = logging.getLogger("wayly")

DOC_MAX_BYTES = 10 * 1024 * 1024          # 10 MB per file
DOC_VAULT_MAX_BYTES = 100 * 1024 * 1024   # 100 MB per household vault
DOC_CATEGORIES = ["assessment", "statement", "care_plan", "medical", "financial", "legal", "other"]
ADVISER_PLANS = {"adviser"}


async def _vault_used_bytes(household_id: str) -> int:
    pipeline = [
        {"$match": {"household_id": household_id}},
        {"$group": {"_id": None, "total": {"$sum": "$size_bytes"}}},
    ]
    rows = await db.documents.aggregate(pipeline).to_list(1)
    return int(rows[0]["total"]) if rows else 0


async def _doc_authorize(doc: dict, user_id: str, as_client_id: Optional[str]) -> None:
    """A document is readable if it's in the user's own household OR via an
    adviser linked-client relationship."""
    user = await get_user(user_id)
    if as_client_id:
        if user.get("plan") not in ADVISER_PLANS:
            raise HTTPException(status_code=403, detail="Adviser plan required.")
        client = await db.adviser_clients.find_one({"id": as_client_id, "adviser_id": user_id})
        if not client or client.get("linked_household_id") != doc.get("household_id"):
            raise HTTPException(status_code=403, detail="Not authorised for this document.")
        return
    h = await get_household(user_id)
    if not h or h.get("id") != doc.get("household_id"):
        raise HTTPException(status_code=403, detail="Not authorised for this document.")


@router.get("/documents")
async def documents_list(
    as_client_id: Optional[str] = None,
    user_id: str = Depends(get_current_user_id),
):
    user = await get_user(user_id)
    household_id: Optional[str] = None
    scope = "own"
    if as_client_id:
        if user.get("plan") not in ADVISER_PLANS:
            raise HTTPException(status_code=403, detail="Adviser plan required.")
        client = await db.adviser_clients.find_one({"id": as_client_id, "adviser_id": user_id})
        if not client or not client.get("linked_household_id"):
            raise HTTPException(status_code=409, detail={"error": "client_not_linked"})
        household_id = client["linked_household_id"]
        scope = "adviser_readonly"
    else:
        h = await get_household(user_id)
        if not h:
            return {
                "documents": [],
                "scope": scope,
                "limits": {
                    "vault_used_bytes": 0,
                    "vault_remaining_bytes": DOC_VAULT_MAX_BYTES,
                    "max_file_bytes": DOC_MAX_BYTES,
                    "max_vault_bytes": DOC_VAULT_MAX_BYTES,
                },
                "categories": DOC_CATEGORIES,
            }
        household_id = h["id"]
    docs = (
        await db.documents.find({"household_id": household_id}, {"_id": 0, "data": 0})
        .sort("uploaded_at", -1)
        .to_list(500)
    )
    used = await _vault_used_bytes(household_id)
    return {
        "documents": docs,
        "scope": scope,
        "limits": {
            "vault_used_bytes": used,
            "vault_remaining_bytes": max(0, DOC_VAULT_MAX_BYTES - used),
            "max_file_bytes": DOC_MAX_BYTES,
            "max_vault_bytes": DOC_VAULT_MAX_BYTES,
        },
        "categories": DOC_CATEGORIES,
    }


@router.post("/documents")
async def documents_upload(
    file: UploadFile = File(...),
    category: str = "other",
    title: str = "",
    notes: str = "",
    user_id: str = Depends(get_current_user_id),
):
    h = await require_household(user_id)
    if category not in DOC_CATEGORIES:
        raise HTTPException(
            status_code=422,
            detail=f"Category must be one of: {', '.join(DOC_CATEGORIES)}",
        )
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file.")
    if len(raw) > DOC_MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds {DOC_MAX_BYTES // 1024 // 1024}MB per-file limit.",
        )
    used = await _vault_used_bytes(h["id"])
    if used + len(raw) > DOC_VAULT_MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Vault would exceed {DOC_VAULT_MAX_BYTES // 1024 // 1024}MB total. Delete older files first.",
        )
    doc = {
        "id": new_id(),
        "household_id": h["id"],
        "uploader_id": user_id,
        "filename": file.filename or "upload",
        "content_type": file.content_type or "application/octet-stream",
        "size_bytes": len(raw),
        "category": category,
        "title": (title or file.filename or "Untitled").strip()[:120],
        "notes": (notes or "").strip()[:500],
        "data": base64.b64encode(raw).decode("ascii"),
        "uploaded_at": now_iso(),
    }
    await db.documents.insert_one(doc)
    return {k: v for k, v in doc.items() if k not in ("data",)}


@router.get("/documents/{doc_id}")
async def documents_detail(
    doc_id: str,
    as_client_id: Optional[str] = None,
    user_id: str = Depends(get_current_user_id),
):
    doc = await db.documents.find_one({"id": doc_id}, {"_id": 0, "data": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    await _doc_authorize(doc, user_id, as_client_id)
    return doc


@router.get("/documents/{doc_id}/download")
async def documents_download(
    doc_id: str,
    as_client_id: Optional[str] = None,
    user_id: str = Depends(get_current_user_id),
):
    doc = await db.documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    await _doc_authorize(doc, user_id, as_client_id)
    from fastapi.responses import Response
    raw = base64.b64decode(doc.get("data") or "")
    return Response(
        content=raw,
        media_type=doc.get("content_type") or "application/octet-stream",
        headers={
            "Content-Disposition": f'inline; filename="{doc.get("filename", "download")}"',
        },
    )


class DocPatch(BaseModel):
    title: Optional[str] = None
    category: Optional[str] = None
    notes: Optional[str] = None


@router.patch("/documents/{doc_id}")
async def documents_patch(
    doc_id: str,
    payload: DocPatch,
    user_id: str = Depends(get_current_user_id),
):
    doc = await db.documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    await _doc_authorize(doc, user_id, None)
    update: Dict[str, str] = {}
    if payload.title is not None:
        update["title"] = payload.title.strip()[:120]
    if payload.category is not None:
        if payload.category not in DOC_CATEGORIES:
            raise HTTPException(status_code=422, detail="Invalid category.")
        update["category"] = payload.category
    if payload.notes is not None:
        update["notes"] = payload.notes.strip()[:500]
    if not update:
        raise HTTPException(status_code=422, detail="Nothing to update.")
    await db.documents.update_one({"id": doc_id}, {"$set": update})
    return await db.documents.find_one({"id": doc_id}, {"_id": 0, "data": 0})


@router.delete("/documents/{doc_id}")
async def documents_delete(doc_id: str, user_id: str = Depends(get_current_user_id)):
    doc = await db.documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    await _doc_authorize(doc, user_id, None)
    await db.documents.delete_one({"id": doc_id})
    return {"ok": True}


@router.post("/documents/{doc_id}/send-to-decoder")
async def documents_send_to_decoder(
    doc_id: str,
    user_id: str = Depends(get_current_user_id),
):
    doc = await db.documents.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    await _doc_authorize(doc, user_id, None)
    if doc.get("category") != "statement":
        raise HTTPException(
            status_code=400,
            detail="Only documents categorised 'statement' can be decoded.",
        )
    raw = base64.b64decode(doc.get("data") or "")
    from document_extract import extract_document
    try:
        text, _im, _pc, _pw = await extract_document(doc.get("filename") or "doc", raw)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read document: {e}")
    if not (text or "").strip():
        raise HTTPException(status_code=400, detail="No readable text. Try a clearer file.")
    # Reuse the authenticated upload pipeline for the actual decode
    from routes.statements import submit_upload_job
    h = await require_household(user_id)
    user = await get_user(user_id)
    job_id = submit_upload_job(
        text,
        doc.get("filename") or "vault-doc",
        h["id"],
        user_id,
        user.get("name", ""),
        len(raw),
    )
    return {"job_id": job_id, "status": "pending"}
