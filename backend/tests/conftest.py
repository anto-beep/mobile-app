"""Shared fixtures for Wayly mobile backend tests."""
import os
import pytest
import requests

# Use public Expo backend URL (env var name is EXPO_PUBLIC_BACKEND_URL in frontend/.env)
BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
    or "https://mobile-care-os.preview.emergentagent.com"
).rstrip("/")


@pytest.fixture(scope="session")
def base_url() -> str:
    return BASE_URL


@pytest.fixture
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def demo_token() -> str:
    """Login as the seeded demo user once and reuse the JWT for the session."""
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": "demo@wayly.com.au", "password": "Wayly123!"},
        timeout=15,
    )
    if r.status_code != 200:
        pytest.skip(f"Demo login failed ({r.status_code}): {r.text}")
    return r.json()["token"]


@pytest.fixture
def auth_headers(demo_token):
    return {"Authorization": f"Bearer {demo_token}", "Content-Type": "application/json"}
