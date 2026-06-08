"""Refresh-token endpoint + login wrapper that returns refresh_token alongside access JWT.

We do NOT replace the existing /api/auth/login (it stays in server.py for
backward compat). Instead this module exposes:
  - POST /api/auth/refresh  { refresh_token } -> { token, refresh_token }
  - POST /api/auth/login/v2 { email, password } -> { token, refresh_token, user }

The mobile client uses /v2; the web (legacy) keeps using the original.
Follow-up: collapse /login into /login/v2 once web is on the new client.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr, Field

from auth import create_token, verify_password
from deps import db
from refresh_tokens import consume_refresh_token, issue_refresh_token

router = APIRouter(prefix="/api/auth", tags=["auth-refresh"])


class _LoginBody(BaseModel):
    email: EmailStr
    password: str


class _RefreshBody(BaseModel):
    refresh_token: str = Field(min_length=20, max_length=512)


@router.post("/login/v2")
async def login_v2(body: _LoginBody):
    user = await db.users.find_one({"email": body.email.lower()}, {"_id": 0})
    if not user or not verify_password(body.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_token(user["id"])
    refresh = await issue_refresh_token(user["id"])
    return {
        "token": token,
        "refresh_token": refresh,
        "user": {
            "id": user["id"],
            "email": user["email"],
            "name": user["name"],
            "role": user["role"],
            "plan": user.get("plan", "free"),
            "household_id": user.get("household_id"),
            "account_id": user.get("account_id") or user.get("household_id"),
            "created_at": user["created_at"],
            "is_admin": bool(user.get("is_admin", False)),
            "subscription_status": user.get("subscription_status"),
            "trial_ends_at": user.get("trial_ends_at"),
        },
    }


@router.post("/refresh")
async def refresh(body: _RefreshBody):
    try:
        user_id, new_refresh = await consume_refresh_token(body.refresh_token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))
    return {
        "token": create_token(user_id),
        "refresh_token": new_refresh,
    }
