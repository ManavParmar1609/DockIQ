from fastapi.testclient import TestClient

# Seed facts used below (see app/seed/data): dock 1 runs order ORD-2026-4521 for Crestline Markets
# (tier 1); product 1 is CRM-FZ-1001, Frozen, $28.50/case, not an allergen. User 1 is an operator,
# user 9 a supervisor.
FROZEN_TIER1_DAMAGE = {
    "dock_door_id": 1,
    "operator_id": 1,
    "issue_type": "Damaged Pallet",
    "description": "pallet is crushed and torn",
    "quick_tags": ["Crushed"],
    "product_id": 1,
    "company_id": 1,
    "carrier_id": 1,
    "quantity_affected": 10,
}


def dock(client: TestClient, dock_id: int) -> dict:
    return client.get(f"/api/docks/{dock_id}").json()


def test_reporting_an_issue_scores_it_and_flags_the_dock(client: TestClient) -> None:
    response = client.post("/api/issues", json=FROZEN_TIER1_DAMAGE)
    assert response.status_code == 200
    body = response.json()

    # 4 (Damaged Pallet) × 3.0 (Frozen) × 1.5 (tier 1) = 18 → critical
    assert body["severity"] == "critical"
    assert body["severity_score"] == 18.0
    assert body["severity_reason"].startswith("Score: 18.0 → CRITICAL")
    assert body["estimated_cost_impact"] == 85.5  # 28.50 × 10 × 0.3
    assert body["ai_resolution"]["found"] is True
    assert body["ai_resolution"]["source"].startswith("Company SOP")
    assert dock(client, 1)["status"] == "issue"

    stored = client.get(f"/api/issues/{body['id']}").json()
    assert stored["status"] == "resolution_in_progress"
    assert stored["quick_tags"] == ["Crushed"]
    assert stored["door_number"] == 1
    assert stored["company_name"] == "Crestline Markets"
    assert stored["created_at"].endswith(("Z", "+00:00"))


def test_escalating_a_critical_issue_marks_the_dock_critical(client: TestClient) -> None:
    issue_id = client.post("/api/issues", json=FROZEN_TIER1_DAMAGE).json()["id"]
    assert client.put(f"/api/issues/{issue_id}/escalate").json() == {"status": "escalated"}
    assert dock(client, 1)["status"] == "critical"
    issue = client.get(f"/api/issues/{issue_id}").json()
    assert issue["status"] == "escalated"
    assert issue["escalated_at"] is not None


def test_supervisor_resolution_records_who_and_reopens_the_dock(client: TestClient) -> None:
    issue_id = client.post("/api/issues", json=FROZEN_TIER1_DAMAGE).json()["id"]
    client.put(f"/api/issues/{issue_id}/escalate")
    response = client.put(
        f"/api/issues/{issue_id}/supervisor-resolve",
        json={"supervisor_id": 9, "resolution_type": "Partial Accept", "supervisor_notes": "3 cases out"},
    )
    assert response.json() == {"status": "supervisor_resolved"}
    issue = client.get(f"/api/issues/{issue_id}").json()
    assert issue["supervisor_name"] == "Sarah Mitchell"
    assert issue["resolved_at"] is not None
    assert dock(client, 1)["status"] == "active"


def test_self_resolution(client: TestClient) -> None:
    issue_id = client.post("/api/issues", json=FROZEN_TIER1_DAMAGE).json()["id"]
    response = client.put(
        f"/api/issues/{issue_id}/self-resolve",
        json={"resolution_type": "Partial Accept", "resolution_notes": "ok"},
    )
    assert response.json() == {"status": "self_resolved"}
    assert client.get(f"/api/issues/{issue_id}").json()["resolution_type"] == "Partial Accept"
    assert dock(client, 1)["status"] == "active"


def test_active_filter_returns_open_issues_only(client: TestClient) -> None:
    open_id = client.post("/api/issues", json=FROZEN_TIER1_DAMAGE).json()["id"]
    active = client.get("/api/issues", params={"status": "active"}).json()
    assert open_id in {issue["id"] for issue in active}
    assert {issue["status"] for issue in active} <= {"escalated", "resolution_in_progress"}


def test_list_filters_and_limit(client: TestClient) -> None:
    issues = client.get("/api/issues", params={"operator_id": 1, "limit": 5}).json()
    assert len(issues) <= 5
    assert all(issue["operator_id"] == 1 for issue in issues)
    assert client.get("/api/issues", params={"status": "nonsense"}).status_code == 422


def test_third_issue_at_a_dock_in_a_week_reports_a_pattern(client: TestClient) -> None:
    payload = {**FROZEN_TIER1_DAMAGE, "dock_door_id": 12, "carrier_id": None}
    patterns = [client.post("/api/issues", json=payload).json()["recurring_patterns"] for _ in range(4)]
    # Seeded history is 1–30 days old, so dock 12 may already carry some; the 4th report must trip it.
    assert any(p["type"] == "dock" and p["count"] >= 3 for p in patterns[-1])


def test_unknown_references_are_404_not_500(client: TestClient) -> None:
    assert client.post("/api/issues", json={**FROZEN_TIER1_DAMAGE, "dock_door_id": 999}).status_code == 404
    assert client.post("/api/issues", json={**FROZEN_TIER1_DAMAGE, "product_id": 999}).status_code == 404
    assert client.put("/api/issues/999/escalate").status_code == 404
    assert client.get("/api/issues/999").status_code == 404


def test_new_issue_is_broadcast_over_websocket(client: TestClient) -> None:
    with client.websocket_connect("/ws") as socket:
        issue_id = client.post("/api/issues", json=FROZEN_TIER1_DAMAGE).json()["id"]
        event = socket.receive_json()
        assert event["type"] == "new_issue"
        assert event["issue"]["id"] == issue_id
        assert event["issue"]["severity"] == "critical"

        client.put(f"/api/issues/{issue_id}/escalate")
        escalated = socket.receive_json()
        assert escalated["type"] == "issue_escalated"
        assert escalated["issue"]["door_number"] == 1
