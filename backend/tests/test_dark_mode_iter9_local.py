"""Iteration 9 — Dark mode backend endpoints against LOCAL FastAPI.

The production backend has not yet been deployed with the new endpoints
(preferences + family/wall). This file validates the code merged into the
local backend works end-to-end.
"""
from __future__ import annotations

import pytest
import requests

BASE_URL = "http://localhost:8001"
EMAIL = "demo@wayly.com.au"
PASSWORD = "Wayly123!"


@pytest.fixture(scope="module")
def auth_headers():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": EMAIL, "password": PASSWORD},
        timeout=10,
    )
    assert r.status_code == 200, f"Local login failed: {r.status_code} {r.text[:200]}"
    token = r.json()["token"]
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# /users/me/preferences — appearance round-trip on local backend
class TestPreferencesLocal:
    def test_get_default(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/users/me/preferences", headers=auth_headers, timeout=10)
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        assert "appearance" in r.json()

    def test_patch_dark_persists(self, auth_headers):
        r = requests.patch(
            f"{BASE_URL}/api/users/me/preferences",
            json={"appearance": "dark"},
            headers=auth_headers,
            timeout=10,
        )
        assert r.status_code == 200
        assert r.json()["appearance"] == "dark"
        # Round-trip GET
        r2 = requests.get(f"{BASE_URL}/api/users/me/preferences", headers=auth_headers, timeout=10)
        assert r2.json()["appearance"] == "dark"

    def test_patch_light(self, auth_headers):
        r = requests.patch(
            f"{BASE_URL}/api/users/me/preferences",
            json={"appearance": "light"},
            headers=auth_headers,
            timeout=10,
        )
        assert r.status_code == 200
        assert r.json()["appearance"] == "light"

    def test_patch_system(self, auth_headers):
        r = requests.patch(
            f"{BASE_URL}/api/users/me/preferences",
            json={"appearance": "system"},
            headers=auth_headers,
            timeout=10,
        )
        assert r.status_code == 200
        assert r.json()["appearance"] == "system"

    def test_invalid_value_rejected(self, auth_headers):
        r = requests.patch(
            f"{BASE_URL}/api/users/me/preferences",
            json={"appearance": "neon"},
            headers=auth_headers,
            timeout=10,
        )
        assert r.status_code == 400


# /family/wall — empty list + post + verify
class TestFamilyWallLocal:
    def test_get_returns_items_and_active_pid(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/family/wall", headers=auth_headers, timeout=10)
        assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
        data = r.json()
        assert "items" in data and isinstance(data["items"], list)
        assert "active_participant_id" in data
        assert isinstance(data["active_participant_id"], str)

    def test_post_text_and_verify(self, auth_headers):
        body = {"text": "TEST_iter9_dark_mode_post"}
        r = requests.post(f"{BASE_URL}/api/family/wall", json=body, headers=auth_headers, timeout=10)
        assert r.status_code in (200, 201), f"{r.status_code} {r.text[:200]}"
        created = r.json()
        assert created.get("text") == body["text"]
        assert created.get("id")
        # Verify via GET
        r2 = requests.get(f"{BASE_URL}/api/family/wall", headers=auth_headers, timeout=10)
        assert r2.status_code == 200
        texts = [i.get("text") for i in r2.json().get("items", [])]
        assert body["text"] in texts

    def test_post_requires_content(self, auth_headers):
        r = requests.post(f"{BASE_URL}/api/family/wall", json={}, headers=auth_headers, timeout=10)
        assert r.status_code == 400
