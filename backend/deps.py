"""Shared dependencies for Wayly route modules.

Phase A refactor (June 2026): extracted from server.py so new route modules
(account.py, participants.py, billing.py) can be added without growing the
monolith. Existing 3300-line server.py imports its DB handle from here too,
so we have one source of truth.

Follow-up sessions should move the remaining domain routes (admin/adviser/
statements/docs/visits) into routes/*.py and pull their state from this
module.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import HTTPException
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("wayly")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]


# ─────────────── shared helpers ───────────────
async def get_user(user_id: str) -> dict:
    """Fetch a user by id; raise 404 if missing. Strips password_hash + _id."""
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


async def get_household(user_id: str) -> Optional[dict]:
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user or not user.get("household_id"):
        return None
    return await db.households.find_one({"id": user["household_id"]}, {"_id": 0})


async def require_household(user_id: str) -> dict:
    h = await get_household(user_id)
    if not h:
        raise HTTPException(status_code=400, detail="No household yet — create one first.")
    return h
