"""Wayly mobile API — comprehensive backend tests.

Coverage:
 - Health
 - Auth (signup / login / me)
 - Household (read seeded demo household)
 - Statements (list, detail, upload via .csv text path)
 - Budget / today summary
 - Notifications (list, mark-read, register-push)
"""
import io
import os
import time
import uuid

import pytest
import requests

from conftest import BASE_URL


# ─────────────────── health ───────────────────
class TestHealth:
    def test_root_ok(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/")
        assert r.status_code == 200
        body = r.json()
        assert body.get("status") == "ok"
        assert "Wayly" in body.get("app", "")


# ─────────────────── auth ───────────────────
class TestAuth:
    def test_signup_creates_user_and_returns_jwt(self, api_client):
        email = f"test_{uuid.uuid4().hex[:10]}@example.com"
        r = api_client.post(
            f"{BASE_URL}/api/auth/signup",
            json={"email": email, "password": "Strong123!", "name": "Test User", "role": "caregiver"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "token" in body and isinstance(body["token"], str) and len(body["token"]) > 20
        assert body["user"]["email"] == email
        assert body["user"]["role"] == "caregiver"
        assert body["user"]["plan"] == "free"
        assert body["user"]["household_id"] is None
        # No password leak
        assert "password" not in body["user"]
        assert "password_hash" not in body["user"]

    def test_signup_rejects_short_password(self, api_client):
        email = f"TEST_{uuid.uuid4().hex[:8]}@wayly.test"
        r = api_client.post(
            f"{BASE_URL}/api/auth/signup",
            json={"email": email, "password": "short", "name": "Bob"},
        )
        assert r.status_code in (400, 422), r.text

    def test_signup_duplicate_email(self, api_client):
        # Demo email is already seeded
        r = api_client.post(
            f"{BASE_URL}/api/auth/signup",
            json={"email": "demo@wayly.com.au", "password": "Wayly123!", "name": "X"},
        )
        assert r.status_code == 409

    def test_login_demo_returns_token_and_user(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "demo@wayly.com.au", "password": "Wayly123!"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "token" in data
        u = data["user"]
        assert u["email"] == "demo@wayly.com.au"
        assert u["name"] == "Cathy Williams"
        assert u["role"] == "caregiver"
        assert u["household_id"]  # seeded household linked

    def test_login_wrong_password_returns_401(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "demo@wayly.com.au", "password": "wrong-password"},
        )
        assert r.status_code == 401

    def test_me_requires_bearer(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 401

    def test_me_returns_current_user(self, api_client, auth_headers):
        r = api_client.get(f"{BASE_URL}/api/auth/me", headers=auth_headers)
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["email"] == "demo@wayly.com.au"
        assert u["name"] == "Cathy Williams"
        assert u["household_id"]


# ─────────────────── household ───────────────────
class TestHousehold:
    def test_get_household_returns_seeded(self, api_client, auth_headers):
        r = api_client.get(f"{BASE_URL}/api/household", headers=auth_headers)
        assert r.status_code == 200, r.text
        h = r.json()
        assert h is not None
        assert h["participant_name"] == "Margaret"
        assert h["classification"] == 4
        assert h["provider_name"] == "HomeCare Plus"
        assert h["is_grandfathered"] is False

    def test_create_household_for_new_user(self, api_client):
        # Sign up a fresh user, then create their household
        email = f"test_{uuid.uuid4().hex[:10]}@example.com"
        s = api_client.post(
            f"{BASE_URL}/api/auth/signup",
            json={"email": email, "password": "Strong123!", "name": "Fresh User"},
        )
        assert s.status_code == 200
        token = s.json()["token"]
        h_headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

        # Initially no household
        g = api_client.get(f"{BASE_URL}/api/household", headers=h_headers)
        assert g.status_code == 200
        assert g.json() is None

        # Create
        c = api_client.post(
            f"{BASE_URL}/api/household",
            headers=h_headers,
            json={
                "participant_name": "TEST_Patricia",
                "classification": 3,
                "provider_name": "TEST Provider",
                "is_grandfathered": True,
            },
        )
        assert c.status_code == 200, c.text
        h = c.json()
        assert h["participant_name"] == "TEST_Patricia"
        assert h["classification"] == 3
        assert h["is_grandfathered"] is True
        assert h["owner_id"]

        # Verify GET now returns it (persistence)
        g2 = api_client.get(f"{BASE_URL}/api/household", headers=h_headers)
        assert g2.status_code == 200
        assert g2.json()["id"] == h["id"]

        # And /auth/me now reports household_id
        me = api_client.get(f"{BASE_URL}/api/auth/me", headers=h_headers)
        assert me.status_code == 200
        assert me.json()["household_id"] == h["id"]


# ─────────────────── statements ───────────────────
class TestStatements:
    def test_list_returns_seeded_statement(self, api_client, auth_headers):
        r = api_client.get(f"{BASE_URL}/api/statements", headers=auth_headers)
        assert r.status_code == 200, r.text
        items = r.json()
        assert isinstance(items, list)
        assert len(items) >= 1
        # Find the seeded statement (others may exist from prior upload tests)
        seeded = next((s for s in items if s["filename"] == "sample-statement.pdf"), None)
        assert seeded is not None, "seeded sample-statement.pdf not found"
        # No mongo _id leak on any
        for s in items:
            assert "_id" not in s
        assert seeded["period_label"]
        assert len(seeded["line_items"]) == 7
        assert len(seeded["anomalies"]) == 2
        sevs = sorted(a["severity"] for a in seeded["anomalies"])
        assert sevs == ["info", "warning"]

    def test_get_statement_detail(self, api_client, auth_headers):
        r = api_client.get(f"{BASE_URL}/api/statements", headers=auth_headers)
        seeded = next((s for s in r.json() if s["filename"] == "sample-statement.pdf"), None)
        assert seeded is not None
        sid = seeded["id"]
        d = api_client.get(f"{BASE_URL}/api/statements/{sid}", headers=auth_headers)
        assert d.status_code == 200
        body = d.json()
        assert body["id"] == sid
        assert "_id" not in body
        assert len(body["line_items"]) == 7
        for li in body["line_items"]:
            assert li["stream"] in ("Clinical", "Independence", "Everyday Living")
            assert "_id" not in li
        for an in body["anomalies"]:
            assert an["severity"] in ("info", "warning", "alert")
            assert an["title"]
            assert "_id" not in an

    def test_get_unknown_statement_404(self, api_client, auth_headers):
        r = api_client.get(f"{BASE_URL}/api/statements/does-not-exist", headers=auth_headers)
        assert r.status_code == 404

    def test_upload_csv_returns_job_and_completes(self, api_client, auth_headers, demo_token):
        # Use multipart upload, NOT JSON — drop Content-Type
        headers = {"Authorization": f"Bearer {demo_token}"}
        csv = (
            b"date,service,stream,units,unit_price,total,contribution,gov\n"
            b"2026-01-03,Personal care,Independence,2,62.50,125.00,12.50,112.50\n"
            b"2026-01-05,Cleaning,Everyday Living,2,55.00,110.00,11.00,99.00\n"
            b"2026-01-09,Nursing visit,Clinical,1,145.00,145.00,0.00,145.00\n"
        )
        files = {"file": ("test_upload.csv", io.BytesIO(csv), "text/csv")}
        r = requests.post(
            f"{BASE_URL}/api/statements/upload", headers=headers, files=files, timeout=30
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "job_id" in body
        assert body["status"] == "pending"
        job_id = body["job_id"]

        # Poll for completion (LLM parse can take ~10–30s)
        deadline = time.time() + 90
        last = None
        while time.time() < deadline:
            jr = requests.get(
                f"{BASE_URL}/api/statements/upload-job/{job_id}", headers=headers, timeout=15
            )
            assert jr.status_code == 200, jr.text
            last = jr.json()
            if last["status"] in ("done", "error"):
                break
            time.sleep(2)
        assert last is not None, "no job status"
        assert last["status"] == "done", f"job did not finish OK: {last}"
        assert last.get("statement_id")

        # Verify statement persisted
        sd = api_client.get(
            f"{BASE_URL}/api/statements/{last['statement_id']}", headers=auth_headers
        )
        assert sd.status_code == 200
        assert sd.json()["id"] == last["statement_id"]

    def test_upload_empty_file_400(self, demo_token):
        headers = {"Authorization": f"Bearer {demo_token}"}
        files = {"file": ("empty.csv", io.BytesIO(b""), "text/csv")}
        r = requests.post(f"{BASE_URL}/api/statements/upload", headers=headers, files=files, timeout=15)
        assert r.status_code == 400


# ─────────────────── budget / today ───────────────────
class TestBudget:
    def test_current_budget_shape(self, api_client, auth_headers):
        r = api_client.get(f"{BASE_URL}/api/budget/current", headers=auth_headers)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["participant_name"] == "Margaret"
        assert "remaining_this_quarter" in b
        assert isinstance(b["streams"], list) and len(b["streams"]) == 3
        stream_names = sorted(s["stream"] for s in b["streams"])
        assert stream_names == ["Clinical", "Everyday Living", "Independence"]
        for s in b["streams"]:
            for k in ("allocated", "spent", "remaining", "pct"):
                assert k in s
        assert "lifetime_pct" in b
        assert "alert_count" in b
        assert b["latest_statement"] is not None
        assert b["latest_statement"]["period_label"]
        # latest_statement may be the seeded one (2 anomalies) or a CSV uploaded
        # earlier in the suite — just assert the count is sane.
        assert b["latest_statement"]["anomaly_count"] >= 0


# ─────────────────── notifications ───────────────────
class TestNotifications:
    def test_list_unread(self, api_client, auth_headers):
        r = api_client.get(f"{BASE_URL}/api/notifications", headers=auth_headers)
        assert r.status_code == 200, r.text
        b = r.json()
        assert "items" in b and "unread" in b
        # At least the seeded warning notification
        assert len(b["items"]) >= 1
        assert b["unread"] >= 1
        # No _id leak
        for n in b["items"]:
            assert "_id" not in n
            assert n["category"] == "anomaly" or n["category"]

    def test_mark_read_then_unread_zero(self, api_client, auth_headers):
        # Mark all as read
        r = api_client.post(
            f"{BASE_URL}/api/notifications/read", headers=auth_headers, json={"ids": []}
        )
        assert r.status_code == 200, r.text
        assert r.json()["ok"] is True

        g = api_client.get(f"{BASE_URL}/api/notifications", headers=auth_headers)
        assert g.status_code == 200
        # After mark-all-read, unread should be 0 (until upload test creates new ones)
        assert g.json()["unread"] == 0
        for n in g.json()["items"]:
            assert n["read"] is True

    def test_register_push_token(self, api_client, auth_headers):
        r = api_client.post(
            f"{BASE_URL}/api/notifications/register-push",
            headers=auth_headers,
            json={"expo_push_token": "ExponentPushToken[TEST_xxxxxxxxxxxxxxxx]", "platform": "ios"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["ok"] is True

        # Idempotent (upsert) — second call should also succeed
        r2 = api_client.post(
            f"{BASE_URL}/api/notifications/register-push",
            headers=auth_headers,
            json={"expo_push_token": "ExponentPushToken[TEST_xxxxxxxxxxxxxxxx]", "platform": "ios"},
        )
        assert r2.status_code == 200
