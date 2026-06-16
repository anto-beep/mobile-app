"""Iteration 6 backend smoke — `trial_used: bool` propagated through auth endpoints.

Verifies:
- POST /api/auth/login returns user.trial_used (existing /login).
- POST /api/auth/login/v2 returns user.trial_used.
- GET /api/auth/me returns trial_used after login.
"""
import os
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/") or "http://localhost:8001"

DEMO_EMAIL = "demo@wayly.com.au"
DEMO_PASSWORD = "Wayly123!"


class TestTrialUsedField:
    def test_login_returns_trial_used(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD},
            timeout=15,
        )
        assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
        body = r.json()
        assert "user" in body and "token" in body
        assert "trial_used" in body["user"], f"user payload missing trial_used: {body['user']}"
        assert isinstance(body["user"]["trial_used"], bool)

    def test_login_v2_returns_trial_used(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/login/v2",
            json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD},
            timeout=15,
        )
        assert r.status_code == 200, f"login/v2 failed: {r.status_code} {r.text[:200]}"
        body = r.json()
        assert "user" in body and "token" in body and "refresh_token" in body
        assert "trial_used" in body["user"], f"login/v2 user payload missing trial_used: {body['user']}"
        assert isinstance(body["user"]["trial_used"], bool)

    def test_me_returns_trial_used(self):
        login = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD},
            timeout=15,
        )
        assert login.status_code == 200
        token = login.json()["token"]
        r = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        assert r.status_code == 200, f"/me failed: {r.status_code} {r.text[:200]}"
        body = r.json()
        assert "trial_used" in body, f"/me payload missing trial_used: {body}"
        assert isinstance(body["trial_used"], bool)
        # Sanity: all the other publicly documented fields are still present.
        for key in ("id", "email", "name", "role", "plan", "created_at"):
            assert key in body, f"/me missing field {key}"
