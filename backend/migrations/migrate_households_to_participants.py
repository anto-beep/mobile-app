"""One-shot migration — Phase A.

For each existing user that has `household_id` but no `account_id`, create
a corresponding `participants` row from their household record and set
`account_id = household_id` on the user. Idempotent: safe to call on every
boot.

Seeded test users:
  - cathy@example.com    (consumer)
  - mark.adviser@...     (adviser)
  - hello@techglove...   (admin)

The migration runs from server.py on startup.
"""
from __future__ import annotations

import logging
from typing import Any, Dict

from deps import db
from models import new_id, now_iso

logger = logging.getLogger("wayly.migrations")


async def run() -> Dict[str, Any]:
    """Returns counters {migrated_users, created_participants, skipped}."""
    migrated_users = 0
    created_participants = 0
    skipped = 0

    # Ensure indexes
    try:
        await db.participants.create_index("id", unique=True)
        await db.participants.create_index("account_id")
        await db.refresh_tokens.create_index("token_hash", unique=True)
        await db.refresh_tokens.create_index("user_id")
        await db.refresh_tokens.create_index("expires_at", expireAfterSeconds=0)
    except Exception as e:
        logger.warning("Index creation skipped: %s", e)

    cursor = db.users.find({}, {"_id": 0})
    async for user in cursor:
        user_id = user["id"]
        household_id = user.get("household_id")
        if not household_id:
            skipped += 1
            continue
        # If a participant for this household already exists, just stamp account_id and move on.
        existing = await db.participants.find_one({"account_id": household_id}, {"_id": 0})
        if existing:
            if not user.get("account_id"):
                await db.users.update_one({"id": user_id}, {"$set": {"account_id": household_id}})
                migrated_users += 1
            else:
                skipped += 1
            continue

        h = await db.households.find_one({"id": household_id}, {"_id": 0})
        if not h:
            skipped += 1
            continue

        parts = (h.get("participant_name") or "").strip().split(" ", 1)
        first = parts[0] or "Participant"
        last = parts[1] if len(parts) > 1 else ""
        pid = new_id()
        short = pid[:6]
        household_email = f"{first.lower()}-{short}@in.wayly.com.au"
        await db.participants.insert_one({
            "id": pid,
            "account_id": household_id,
            "household_id": household_id,
            "first_name": first,
            "last_name": last,
            "date_of_birth": None,
            "classification": h.get("classification", 4),
            "provider_name": h.get("provider_name", "Your provider"),
            "provider_id": None,
            "household_email": household_email,
            "is_primary": True,
            "status": "ACTIVE",
            "color_index": 0,
            "created_at": now_iso(),
            "updated_at": now_iso(),
        })
        created_participants += 1

        await db.users.update_one(
            {"id": user_id},
            {"$set": {"account_id": household_id}},
        )
        migrated_users += 1

    summary = {
        "migrated_users": migrated_users,
        "created_participants": created_participants,
        "skipped": skipped,
    }
    logger.info("Household→participant migration: %s", summary)
    return summary
