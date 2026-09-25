from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from tests.conftest import Headers, token_of

# Seed facts used below (see app/seed/data): OP-001 (user 1) runs order 1 at dock 1 for Crestline
# Markets (tier 1), in SUP-001's team (user 9, Zone A). OP-003 (user 3) is in SUP-002's team (user 10).
# QA-001 (user 12) is Quality. Product 1 is CRM-FZ-1001: Frozen, $28.50/case, not an allergen.
# Dock 1's trailer arrived 111 minutes before seeding; dock 12 has no trailer.
FROZEN_TIER1_DAMAGE = {
    "dock_door_id": 1,
    "issue_type": "Damaged Pallet",
    "issue_subtype": "Crushed or collapsed pallet",
    "description": "pallet is crushed and torn",
    "quick_tags": ["Crushed"],
    "product_id": 1,
    "company_id": 1,
    "carrier_id": 1,
    "quantity_affected": 10,
}

Login = Callable[[str], Headers]


def report(client: TestClient, headers: Headers, **overrides: object) -> dict:
    response = client.post("/api/issues", json={**FROZEN_TIER1_DAMAGE, **overrides}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def dock(client: TestClient, headers: Headers, dock_id: int) -> dict:
    return client.get(f"/api/docks/{dock_id}", headers=headers).json()


def test_reporting_scores_the_issue_and_flags_the_dock(client: TestClient, login: Login) -> None:
    op = login("OP-001")
    body = report(client, op)
    # 4 (Damaged Pallet) × 3.0 (Frozen) × 1.5 (tier 1) = 18, + 2 trailer dwell > 30 min
    assert body["severity"] == "critical"
    assert body["severity_score"] == 20.0
    assert "Trailer dwell time" in body["severity_reason"]
    assert body["estimated_cost_impact"] == 85.5  # 28.50 × 10 × 0.3
    assert body["ai_resolution"]["source"].startswith("Company SOP")
    # Critical goes straight to the supervisor (business-rules §7.1).
    assert body["status"] == "escalated"
    assert dock(client, op, 1)["status"] == "critical"

    stored = client.get(f"/api/issues/{body['id']}", headers=op).json()
    assert stored["operator_id"] == 1  # identity comes from the token, never the body
    assert stored["issue_subtype"] == "Crushed or collapsed pallet"
    assert stored["company_name"] == "Crestline Markets"
    assert stored["photo_count"] == 0
    assert stored["created_at"].endswith(("Z", "+00:00"))


def test_company_bonus_now_reaches_retrieval(client: TestClient, login: Login) -> None:
    # "crushed" + "torn" → 2 keyword hits, + 2 category, + 1 company = 5 → high (was medium without company)
    body = report(client, login("OP-001"), issue_subtype=None, description="crushed and torn")
    assert body["ai_resolution"]["confidence"] == "high"


def test_employee_injury_is_always_critical(client: TestClient, login: Login) -> None:
    body = report(
        client,
        login("OP-001"),
        dock_door_id=12,
        issue_type="Safety Incident",
        issue_subtype="Employee injury",
        description="operator hurt hand",
        product_id=None,
        company_id=None,
    )
    assert body["severity"] == "critical"
    assert "never below CRITICAL" in body["severity_reason"]
    assert body["estimated_cost_impact"] == 0
    assert body["ai_resolution"]["source"] == "Safety SOP 10.1 — Injury Response"


def test_unknown_type_or_mismatched_subtype_is_rejected(client: TestClient, login: Login) -> None:
    op = login("OP-001")
    bad_type = client.post("/api/issues", json={**FROZEN_TIER1_DAMAGE, "issue_type": "Gremlins"}, headers=op)
    bad_subtype = client.post(
        "/api/issues", json={**FROZEN_TIER1_DAMAGE, "issue_subtype": "Overage"}, headers=op
    )
    assert (bad_type.status_code, bad_subtype.status_code) == (422, 422)


def test_escalation_reaches_the_team_supervisor_only(client: TestClient, login: Login) -> None:
    op, own_supervisor, other_supervisor = login("OP-001"), login("SUP-001"), login("SUP-002")
    # No product: 4 × 1.5 (tier 1) + 2 dwell = 8 → medium, so the operator escalates it by hand.
    created = report(client, op, product_id=None)
    issue_id = created["id"]
    assert (created["severity"], created["status"]) == ("medium", "resolution_in_progress")
    assert client.put(f"/api/issues/{issue_id}/escalate", headers=op).json() == {"status": "escalated"}
    assert dock(client, op, 1)["status"] == "issue"

    queue = client.get("/api/issues", params={"status": "escalated"}, headers=own_supervisor).json()
    assert issue_id in {issue["id"] for issue in queue}
    other_queue = client.get("/api/issues", params={"status": "escalated"}, headers=other_supervisor).json()
    assert issue_id not in {issue["id"] for issue in other_queue}
    assert client.get(f"/api/issues/{issue_id}", headers=other_supervisor).status_code == 404


def test_supervisor_resolution_records_who_and_reopens_the_dock(client: TestClient, login: Login) -> None:
    op, sup = login("OP-001"), login("SUP-001")
    issue_id = report(client, op)["id"]  # critical: already escalated
    response = client.put(
        f"/api/issues/{issue_id}/supervisor-resolve",
        json={"resolution_type": "Partial Accept", "supervisor_notes": "3 cases out"},
        headers=sup,
    )
    assert response.json() == {"status": "supervisor_resolved"}
    issue = client.get(f"/api/issues/{issue_id}", headers=sup).json()
    assert issue["supervisor_name"] == "Sarah Mitchell"
    assert dock(client, sup, 1)["status"] == "active"


def test_other_teams_supervisor_cannot_resolve(client: TestClient, login: Login) -> None:
    issue_id = report(client, login("OP-001"))["id"]
    response = client.put(
        f"/api/issues/{issue_id}/supervisor-resolve",
        json={"resolution_type": "Accept"},
        headers=login("SUP-002"),
    )
    assert response.status_code == 404


def test_lifecycle_forbids_double_resolution(client: TestClient, login: Login) -> None:
    op = login("OP-001")
    issue_id = report(client, op, product_id=None)["id"]
    ok = client.put(
        f"/api/issues/{issue_id}/self-resolve", json={"resolution_type": "Partial Accept"}, headers=op
    )
    assert ok.status_code == 200
    again = client.put(f"/api/issues/{issue_id}/escalate", headers=op)
    assert again.status_code == 409


def test_a_critical_issue_cannot_be_self_resolved(client: TestClient, login: Login) -> None:
    op = login("OP-001")
    issue_id = report(client, op)["id"]
    refused = client.put(
        f"/api/issues/{issue_id}/self-resolve", json={"resolution_type": "Partial Accept"}, headers=op
    )
    assert refused.status_code == 409
    assert "supervisor" in refused.json()["detail"]


def test_resolution_lists_are_enforced(client: TestClient, login: Login) -> None:
    op = login("OP-001")
    issue_id = report(client, op)["id"]
    bad = client.put(f"/api/issues/{issue_id}/self-resolve", json={"resolution_type": "Vibes"}, headers=op)
    assert bad.status_code == 422


def test_roles_are_enforced(client: TestClient, login: Login) -> None:
    assert client.post("/api/issues", json=FROZEN_TIER1_DAMAGE, headers=login("SUP-001")).status_code == 403
    assert client.post("/api/issues", json=FROZEN_TIER1_DAMAGE).status_code == 401


def test_operator_sees_only_their_own_issues(client: TestClient, login: Login) -> None:
    issues = client.get("/api/issues", params={"limit": 500}, headers=login("OP-001")).json()
    assert issues
    assert {issue["operator_id"] for issue in issues} == {1}


def test_third_issue_in_a_week_at_a_dock_reports_the_pattern(client: TestClient, login: Login) -> None:
    op = login("OP-001")
    payload = {"dock_door_id": 12, "carrier_id": None}
    reports = [report(client, op, **payload)["recurring_patterns"] for _ in range(3)]
    assert reports[0] == [] or reports[0][0]["count"] >= 3  # seeded history may already count
    assert any(p["type"] == "dock" and p["count"] >= 3 for p in reports[-1])
    latest = client.get("/api/issues", params={"limit": 1}, headers=op).json()[0]
    assert latest["recurring_patterns"] == reports[-1]  # persisted, not discarded


def test_new_issue_goes_to_reporter_and_supervisor_not_other_teams(client: TestClient, login: Login) -> None:
    op, sup, other = login("OP-001"), login("SUP-001"), login("SUP-002")
    with (
        client.websocket_connect("/ws", subprotocols=["dockiq", token_of(sup)]) as own,
        client.websocket_connect("/ws", subprotocols=["dockiq", token_of(other)]) as outsider,
    ):
        issue_id = report(client, op)["id"]
        event = own.receive_json()
        assert (event["type"], event["issue"]["id"]) == ("new_issue", issue_id)
        # The outsider's next frame must be *their* event, not this one.
        client.post("/api/broadcasts", json={"message": "Zone B ping"}, headers=other)
        assert outsider.receive_json()["message"] == "Zone B ping"


def test_quality_is_told_about_temperature_issues(client: TestClient, login: Login) -> None:
    op, qa = login("OP-001"), login("QA-001")
    with client.websocket_connect("/ws", subprotocols=["dockiq", token_of(qa)]) as quality:
        report(
            client,
            op,
            issue_type="Temperature Deviation",
            issue_subtype="Product temperature out of range",
            temp_reading=28,
            temp_threshold_max=0,
        )
        event = quality.receive_json()
        assert event["type"] == "new_issue"
        assert event["issue"]["issue_type"] == "Temperature Deviation"


def test_websocket_rejects_missing_or_bad_tokens(client: TestClient) -> None:
    for protocols in ([], ["dockiq", "not-a-token"]):
        with (
            pytest.raises(WebSocketDisconnect) as refused,
            client.websocket_connect("/ws", subprotocols=protocols),
        ):
            pass
        assert refused.value.code == 1008


# ── Photos ──

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 200


def test_photo_evidence_round_trip(client: TestClient, login: Login) -> None:
    op, sup = login("OP-001"), login("SUP-001")
    issue_id = report(client, op)["id"]
    created = client.post(
        f"/api/issues/{issue_id}/photos", files={"file": ("p.jpg", JPEG, "image/jpeg")}, headers=op
    )
    assert created.status_code == 201
    photo = created.json()
    assert photo["content_type"] == "image/jpeg"
    assert client.get(f"/api/issues/{issue_id}", headers=op).json()["photo_count"] == 1
    image = client.get(f"/api/photos/{photo['id']}", headers=sup)
    assert (image.status_code, image.content) == (200, JPEG)
    assert client.get(f"/api/photos/{photo['id']}", headers=login("SUP-002")).status_code == 404


def test_photo_content_is_sniffed_not_trusted(client: TestClient, login: Login) -> None:
    op = login("OP-001")
    issue_id = report(client, op)["id"]
    fake = client.post(
        f"/api/issues/{issue_id}/photos", files={"file": ("x.jpg", b"<script>", "image/jpeg")}, headers=op
    )
    assert fake.status_code == 415


def test_photo_limits(client: TestClient, login: Login) -> None:
    op = login("OP-001")
    issue_id = report(client, op)["id"]
    huge = client.post(
        f"/api/issues/{issue_id}/photos",
        files={"file": ("big.jpg", JPEG + b"\x00" * 700_000, "image/jpeg")},
        headers=op,
    )
    assert huge.status_code == 413
    for _ in range(4):
        client.post(
            f"/api/issues/{issue_id}/photos", files={"file": ("p.jpg", JPEG, "image/jpeg")}, headers=op
        )
    fifth = client.post(
        f"/api/issues/{issue_id}/photos", files={"file": ("p.jpg", JPEG, "image/jpeg")}, headers=op
    )
    assert fifth.status_code == 422
