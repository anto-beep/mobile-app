"""Wayly Phase 2/3 backend tests.

Coverage:
 - Chat (/api/chat, /api/chat/history)
 - Family thread
 - Participant view + Wellbeing
 - Dashboard share
 - Public AI tools (budget-calc, price-check, classification-check, reassessment-letter)
 - Google session endpoint existence
"""
import time

import requests

from conftest import BASE_URL


# ─────────────────── chat ───────────────────
class TestChat:
    def test_chat_post_returns_reply_and_session(self, api_client, auth_headers):
        r = api_client.post(
            f"{BASE_URL}/api/chat",
            headers=auth_headers,
            json={"message": "How much budget do I have left this quarter?"},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "reply" in body and isinstance(body["reply"], str) and len(body["reply"]) > 0
        assert "session_id" in body and body["session_id"]

    def test_chat_history_ordered(self, api_client, auth_headers):
        r = api_client.get(f"{BASE_URL}/api/chat/history", headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        items = r.json()
        assert isinstance(items, list)
        assert len(items) >= 2  # the test_chat_post above creates user+assistant turns
        for it in items:
            assert "_id" not in it
            assert it["role"] in ("user", "assistant")
            assert "content" in it
        # Confirm sorted ascending by created_at
        ts = [it["created_at"] for it in items]
        assert ts == sorted(ts)


# ─────────────────── family thread ───────────────────
class TestFamilyThread:
    def test_post_then_list_message(self, api_client, auth_headers):
        body_text = "TEST_family_msg — hello family"
        c = api_client.post(
            f"{BASE_URL}/api/family-thread",
            headers=auth_headers,
            json={"body": body_text},
        )
        assert c.status_code == 200, c.text
        msg = c.json()
        assert msg["body"] == body_text
        assert "_id" not in msg
        assert msg["author_name"] == "Cathy Williams"
        assert msg["id"]

        g = api_client.get(f"{BASE_URL}/api/family-thread", headers=auth_headers)
        assert g.status_code == 200
        items = g.json()
        assert any(m["id"] == msg["id"] for m in items)
        for m in items:
            assert "_id" not in m
        # Ascending order by created_at
        ts = [m["created_at"] for m in items]
        assert ts == sorted(ts)

    def test_post_empty_body_rejected(self, api_client, auth_headers):
        r = api_client.post(
            f"{BASE_URL}/api/family-thread",
            headers=auth_headers,
            json={"body": ""},
        )
        assert r.status_code in (400, 422)


# ─────────────────── participant ───────────────────
class TestParticipant:
    def test_today_shape(self, api_client, auth_headers):
        r = api_client.get(f"{BASE_URL}/api/participant/today", headers=auth_headers)
        assert r.status_code == 200, r.text
        b = r.json()
        for k in (
            "participant_name",
            "today_label",
            "appointment",
            "quarter_remaining",
            "quarter_remaining_sentence",
            "caregiver_name",
        ):
            assert k in b
        assert b["participant_name"] == "Margaret"
        assert b["caregiver_name"] == "Cathy Williams"
        assert isinstance(b["appointment"], dict)
        for k in ("time", "name", "service", "duration"):
            assert k in b["appointment"]
        assert isinstance(b["quarter_remaining"], (int, float))

    def test_wellbeing_post_and_list(self, api_client, auth_headers):
        r = api_client.post(
            f"{BASE_URL}/api/participant/wellbeing",
            headers=auth_headers,
            json={"mood": "good", "notify_caregiver": False},
        )
        assert r.status_code == 200, r.text
        entry = r.json()
        assert entry["mood"] == "good"
        assert "_id" not in entry
        assert entry["id"]

        g = api_client.get(f"{BASE_URL}/api/participant/wellbeing", headers=auth_headers)
        assert g.status_code == 200
        items = g.json()
        assert isinstance(items, list)
        assert len(items) >= 1
        assert any(it["id"] == entry["id"] for it in items)
        # at most 14 entries and DESC by created_at
        assert len(items) <= 14
        ts = [it["created_at"] for it in items]
        assert ts == sorted(ts, reverse=True)

    def test_wellbeing_invalid_mood_rejected(self, api_client, auth_headers):
        r = api_client.post(
            f"{BASE_URL}/api/participant/wellbeing",
            headers=auth_headers,
            json={"mood": "amazing", "notify_caregiver": False},
        )
        assert r.status_code in (400, 422)


# ─────────────────── dashboard share ───────────────────
class TestDashboardShare:
    def test_share_with_emails_ok(self, api_client, auth_headers):
        r = api_client.post(
            f"{BASE_URL}/api/dashboard/share",
            headers=auth_headers,
            json={"extra_emails": ["family1@example.com", "family2@example.com"], "note": "FYI"},
        )
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["sent_to"] == ["family1@example.com", "family2@example.com"]
        assert b["failures"] == []

    def test_share_no_emails_400(self, api_client, auth_headers):
        r = api_client.post(
            f"{BASE_URL}/api/dashboard/share",
            headers=auth_headers,
            json={"extra_emails": [], "note": ""},
        )
        assert r.status_code == 400


# ─────────────────── public budget calc ───────────────────
class TestPublicBudgetCalc:
    def test_basic(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/public/budget-calc",
            json={
                "classification": 4,
                "is_grandfathered": False,
                "current_lifetime_balance": 1000.0,
                "expected_annual_burn": 5000.0,
            },
        )
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["classification"] == 4
        assert b["annual_total"] > 0
        assert b["quarterly_total"] > 0
        assert isinstance(b["streams"], list) and len(b["streams"]) == 3
        for s in b["streams"]:
            assert "stream" in s and "allocated" in s
        assert b["lifetime_cap"] > 0
        assert b["lifetime_contributions"] == 1000.0
        assert b["years_to_cap"] is not None
        assert b["years_to_cap"] > 0

    def test_invalid_classification_422(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/public/budget-calc",
            json={"classification": 99, "current_lifetime_balance": 0},
        )
        assert r.status_code == 422


# ─────────────────── public price check ───────────────────
class TestPublicPriceCheck:
    def test_services_list(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/public/price-check/services")
        assert r.status_code == 200, r.text
        items = r.json()
        assert isinstance(items, list)
        names = [i["name"] for i in items]
        assert "Personal care" in names
        for s in items:
            assert "median" in s and "cap" in s

    def test_fair_verdict(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/public/price-check",
            json={"service": "Personal care", "rate": 65.0},
        )
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["verdict"] == "fair"
        assert b["service"] == "Personal care"
        assert b["assessment"]

    def test_high_above_cap(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/public/price-check",
            json={"service": "Personal care", "rate": 200.0},
        )
        assert r.status_code == 200
        b = r.json()
        assert b["verdict"] == "high"
        assert "cap" in b["verdict_label"].lower()
        assert b["suggested_action"]

    def test_low_verdict(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/public/price-check",
            json={"service": "Personal care", "rate": 30.0},
        )
        assert r.status_code == 200
        assert r.json()["verdict"] == "low"


# ─────────────────── public classification check ───────────────────
class TestPublicClassificationCheck:
    def test_low_score_range(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/public/classification-check",
            json={"answers": [0] * 12, "current_classification": 4},
        )
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["score"] == 0
        assert b["likely_low"] == 1
        assert b["likely_high"] == 2
        assert b["score_max"] == 48
        assert isinstance(b["annual_range"], list) and len(b["annual_range"]) == 2
        assert b["suggest_reassessment"] is True  # current=4, range 1-2

    def test_high_score_range(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/public/classification-check",
            json={"answers": [4] * 12},
        )
        assert r.status_code == 200
        b = r.json()
        assert b["score"] == 48
        assert b["likely_low"] == 7
        assert b["likely_high"] == 8
        assert b["suggest_reassessment"] is False  # no current_classification supplied

    def test_invalid_answer_value(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/public/classification-check",
            json={"answers": [5] * 12},
        )
        assert r.status_code == 400

    def test_invalid_answer_length(self, api_client):
        r = api_client.post(
            f"{BASE_URL}/api/public/classification-check",
            json={"answers": [1] * 10},
        )
        assert r.status_code == 422


# ─────────────────── public reassessment letter (Claude, slow) ───────────────────
class TestPublicReassessmentLetter:
    def test_generates_letter(self, api_client):
        payload = {
            "participant_name": "Margaret",
            "current_classification": 4,
            "changes_summary": "Falls have increased to twice weekly. Mobility worsening; needs more nursing visits.",
            "recent_events": "Fell on 3 December and again 18 December. Started using a walker.",
            "sender_name": "Cathy Williams",
            "relationship": "daughter",
        }
        # Allow up to 60s for Claude
        r = requests.post(
            f"{BASE_URL}/api/public/reassessment-letter",
            json=payload,
            timeout=60,
        )
        assert r.status_code == 200, r.text
        b = r.json()
        assert "letter" in b
        letter = b["letter"]
        assert isinstance(letter, str) and len(letter) > 100


# ─────────────────── auth google session endpoint exists ───────────────────
class TestGoogleSession:
    def test_endpoint_exists_and_validates(self, api_client):
        # Don't run real OAuth — just verify endpoint exists, validates body, and
        # rejects an invalid session_id with 400 (not 404 / 405).
        r = api_client.post(
            f"{BASE_URL}/api/auth/google-session",
            json={"session_id": "INVALID_TEST_SESSION_ID"},
        )
        assert r.status_code in (400, 401), r.text
        # Missing body should 422
        r2 = api_client.post(f"{BASE_URL}/api/auth/google-session", json={})
        assert r2.status_code == 422
