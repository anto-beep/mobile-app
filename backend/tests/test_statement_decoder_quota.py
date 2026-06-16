"""Statement Decoder free-tier quota tests + sanity for the routes refactor.

Hits the LOCAL backend at http://localhost:8001/api/* (per the review request).
Uses the seeded demo user demo@wayly.com.au / Wayly123! (plan='family').
Temporarily flips the user to plan='free' via Mongo to exercise the 402 gate,
then restores to 'family' in teardown.
"""
import os
import time
import asyncio
import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = "http://localhost:8001/api"
DEMO_EMAIL = "demo@wayly.com.au"
DEMO_PASSWORD = "Wayly123!"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "wayly_mobile")

SAMPLE_STATEMENT_TEXT = (
    "HomeCare Plus — May 2026 statement\n"
    "Service: Personal care, 14 May 2026, 60 min, $84.00\n"
    "Service: Domestic assistance, 16 May 2026, 90 min, $76.50\n"
    "Total billed: $160.50\n"
)


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def auth(session):
    r = session.post(
        f"{BASE_URL}/auth/login",
        json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD},
        timeout=10,
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    body = r.json()
    assert "token" in body and "user" in body
    return {"token": body["token"], "user": body["user"]}


@pytest.fixture(scope="module")
def auth_headers(auth):
    return {"Authorization": f"Bearer {auth['token']}", "Content-Type": "application/json"}


# ─────────────────── routes refactor sanity ───────────────────
class TestRoutesSanity:
    def test_root_health(self, session):
        # Note: review asked for /api/health but actual endpoint is /api/
        r = session.get(f"{BASE_URL}/", timeout=10)
        assert r.status_code == 200
        assert r.json().get("status") == "ok"

    def test_users_me(self, session, auth_headers, auth):
        # NOTE: actual route is /api/auth/me — review request had this wrong
        r = session.get(f"{BASE_URL}/auth/me", headers=auth_headers, timeout=10)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["email"] == DEMO_EMAIL
        # Family plan = paid (unlimited)
        assert (body.get("plan") or "").lower() == "family"

    def test_list_statements(self, session, auth_headers):
        r = session.get(f"{BASE_URL}/statements", headers=auth_headers, timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ─────────────────── paid-plan (family) bypasses gate ───────────────────
class TestPaidPlanUnlimited:
    """Family plan should be UNLIMITED — multiple upload-text calls must all 200."""

    def test_paid_plan_two_uploads_both_succeed(self, session, auth_headers):
        for i in range(2):
            r = session.post(
                f"{BASE_URL}/statements/upload-text",
                headers=auth_headers,
                json={"text": SAMPLE_STATEMENT_TEXT, "filename": f"paid-{i}.txt"},
                timeout=20,
            )
            assert r.status_code == 200, f"call #{i+1} failed: {r.status_code} {r.text}"
            body = r.json()
            assert "job_id" in body
            assert body.get("status") == "pending"


# ─────────────────── free-plan gate ───────────────────
@pytest.fixture
def free_plan_user(auth):
    """Temporarily flip demo to plan='free' and clear quota stamp. Restore in teardown."""
    user_id = auth["user"]["id"]

    async def _set_free():
        client = AsyncIOMotorClient(MONGO_URL)
        try:
            await client[DB_NAME].users.update_one(
                {"id": user_id},
                {
                    "$set": {"plan": "free"},
                    "$unset": {
                        "free_decode_last_at_ts": "",
                        "free_decode_last_at": "",
                    },
                },
            )
        finally:
            client.close()

    async def _restore():
        client = AsyncIOMotorClient(MONGO_URL)
        try:
            await client[DB_NAME].users.update_one(
                {"id": user_id},
                {
                    "$set": {"plan": "family"},
                    "$unset": {
                        "free_decode_last_at_ts": "",
                        "free_decode_last_at": "",
                    },
                },
            )
        finally:
            client.close()

    asyncio.run(_set_free())
    yield user_id
    asyncio.run(_restore())


class TestFreeTierQuota:
    def test_first_upload_succeeds_second_returns_402(
        self, session, auth_headers, free_plan_user
    ):
        # 1st call → 200 + job_id (records the quota stamp)
        r1 = session.post(
            f"{BASE_URL}/statements/upload-text",
            headers=auth_headers,
            json={"text": SAMPLE_STATEMENT_TEXT, "filename": "free-1.txt"},
            timeout=20,
        )
        assert r1.status_code == 200, f"first call should succeed: {r1.status_code} {r1.text}"
        body1 = r1.json()
        assert "job_id" in body1
        assert body1.get("status") == "pending"

        # tiny pause so the upload-text handler can stamp free_decode_last_at_ts
        time.sleep(0.5)

        # 2nd call → 402 with the upgrade payload
        r2 = session.post(
            f"{BASE_URL}/statements/upload-text",
            headers=auth_headers,
            json={"text": SAMPLE_STATEMENT_TEXT, "filename": "free-2.txt"},
            timeout=20,
        )
        assert r2.status_code == 402, f"second call should be 402: {r2.status_code} {r2.text}"

        # Validate payload shape (FastAPI wraps HTTPException.detail under "detail")
        body2 = r2.json()
        detail = body2.get("detail") or {}
        assert isinstance(detail, dict), f"detail not an object: {body2}"
        assert detail.get("error") == "free_tier_exhausted", body2
        assert detail.get("redirect") == "/pricing", body2
        assert "free decode" in (detail.get("message") or "").lower(), body2
        assert isinstance(detail.get("retry_at_unix"), int), body2

        # Retry-After header present and positive
        retry_after = r2.headers.get("Retry-After")
        assert retry_after is not None and int(retry_after) > 0, r2.headers

    def test_upload_endpoint_also_gated(
        self, session, auth, free_plan_user
    ):
        """The multipart /statements/upload endpoint must also enforce the gate.
        We don't need a real PDF — sending bytes the OCR can't read is fine because
        the gate check happens BEFORE _record_free_tier_use, and after the previous
        test the user's quota is already exhausted (from the prior 200).
        """
        # Re-stamp so this test is independent: first burn the quota.
        # Easiest is just to call upload-text once (200), then expect upload to 402.
        headers_json = {"Authorization": f"Bearer {auth['token']}", "Content-Type": "application/json"}
        burn = session.post(
            f"{BASE_URL}/statements/upload-text",
            headers=headers_json,
            json={"text": SAMPLE_STATEMENT_TEXT, "filename": "burn.txt"},
            timeout=20,
        )
        assert burn.status_code == 200, f"burn-the-quota call: {burn.status_code} {burn.text}"
        time.sleep(0.5)

        # Now attempt multipart upload — should 402 before file parsing.
        # Use a fresh requests.post (NOT session) so the session's
        # Content-Type: application/json header doesn't clobber the multipart boundary.
        files = {"file": ("dummy.txt", SAMPLE_STATEMENT_TEXT.encode("utf-8"), "text/plain")}
        headers_mp = {"Authorization": f"Bearer {auth['token']}"}  # let requests set boundary
        r = requests.post(
            f"{BASE_URL}/statements/upload",
            headers=headers_mp,
            files=files,
            timeout=20,
        )
        assert r.status_code == 402, f"expected 402, got {r.status_code}: {r.text}"
        detail = r.json().get("detail") or {}
        assert detail.get("error") == "free_tier_exhausted"
        assert detail.get("redirect") == "/pricing"
