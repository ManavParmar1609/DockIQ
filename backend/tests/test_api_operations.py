"""Reference data, orders, floor operations, chat and analytics."""

from fastapi.testclient import TestClient


def test_health(client: TestClient) -> None:
    assert client.get("/api/health").json() == {"status": "ok"}


def test_reference_lists_are_fictional_and_complete(client: TestClient) -> None:
    companies = client.get("/api/companies").json()
    assert len(companies) == 20
    assert companies[0]["name"] == "Crestline Markets"
    assert isinstance(companies[0]["load_pattern"], dict)
    assert len(client.get("/api/products").json()) == 80
    assert len(client.get("/api/products", params={"company_id": 1}).json()) == 4
    assert len(client.get("/api/carriers").json()) == 5
    assert len(client.get("/api/docks").json()) == 12


def test_users_filter_by_role(client: TestClient) -> None:
    operators = client.get("/api/users", params={"role": "operator"}).json()
    supervisors = client.get("/api/users", params={"role": "supervisor"}).json()
    assert (len(operators), len(supervisors)) == (8, 3)
    assert client.get("/api/users/1").json()["employee_id"] == "OP-001"
    assert client.get("/api/users/999").status_code == 404


def test_active_dock_joins_its_order(client: TestClient) -> None:
    dock = client.get("/api/docks/1").json()
    assert dock["status"] == "active"
    assert dock["lifecycle_phase"] == "loading"
    assert dock["order_number"] == "ORD-2026-4521"
    assert dock["operator_name"] == "Mike Johnson"


def test_order_detail_carries_items_and_customer_rules(client: TestClient) -> None:
    orders = client.get("/api/orders", params={"operator_id": 1, "status": "in_progress"}).json()
    assert [o["order_number"] for o in orders] == ["ORD-2026-4521"]
    detail = client.get(f"/api/orders/{orders[0]['id']}").json()
    assert detail["company_tier"] == 1
    assert detail["sop_rules"]["receiving"]
    assert [item["sku"] for item in detail["items"]] == ["CRM-FZ-1001", "CRM-RF-1002"]
    assert detail["items"][0]["verified"] is False


def test_counting_an_item_marks_it_verified(client: TestClient) -> None:
    response = client.put("/api/orders/1/items", json={"product_id": 1, "actual_quantity": 198})
    assert response.json() == {"status": "updated"}
    item = client.get("/api/orders/1").json()["items"][0]
    assert (item["actual_quantity"], item["verified"]) == (198, True)
    assert client.put("/api/orders/1/items", json={"product_id": 80, "actual_quantity": 1}).status_code == 404


def test_completing_an_order_frees_the_dock(client: TestClient) -> None:
    with client.websocket_connect("/ws") as socket:
        response = client.post("/api/orders/1/complete", json={"order_id": 1, "seal_number": "SL-1"})
        assert response.json() == {"status": "completed"}
        assert socket.receive_json() == {"type": "order_complete", "order_id": 1}
    order = client.get("/api/orders/1").json()
    assert (order["status"], order["seal_number"]) == ("complete", "SL-1")
    dock = client.get("/api/docks/1").json()
    assert (dock["status"], dock["lifecycle_phase"]) == ("idle", "complete")


def inspection(**overrides: object) -> dict[str, object]:
    return {
        "dock_door_id": 4,
        "operator_id": 1,
        "seal_condition": "intact",
        "interior_cleanliness": "clean",
        "visible_damage": "none",
        "interior_temperature": 45.0,
        **overrides,
    }


def test_inspection_pass_and_fail(client: TestClient) -> None:
    assert client.post("/api/inspections", json=inspection()).json()["overall_pass"] is True
    assert (
        client.post("/api/inspections", json=inspection(interior_temperature=45.1)).json()["overall_pass"]
        is False
    )
    assert client.get("/api/docks/4").json()["lifecycle_phase"] == "inspection"


def test_quick_request_round_trip(client: TestClient) -> None:
    with client.websocket_connect("/ws") as socket:
        created = client.post(
            "/api/requests", json={"dock_door_id": 2, "operator_id": 2, "request_type": "Pallet Wrap"}
        ).json()
        assert created["status"] == "pending"
        assert socket.receive_json()["type"] == "new_request"
    pending = client.get("/api/requests", params={"status": "pending"}).json()
    assert pending[0]["id"] == created["id"]
    assert pending[0]["operator_name"] == "Lisa Chen"
    assert client.put(f"/api/requests/{created['id']}/fulfill").json() == {"status": "fulfilled"}
    assert client.get("/api/requests", params={"status": "pending"}).json() == []


def test_broadcast_and_handoff(client: TestClient) -> None:
    with client.websocket_connect("/ws") as socket:
        created = client.post("/api/broadcasts", json={"supervisor_id": 9, "message": "Dock 5 closed"}).json()
        assert socket.receive_json() == {"type": "broadcast", "message": "Dock 5 closed", "id": created["id"]}
    assert client.get("/api/broadcasts").json()[0]["supervisor_name"] == "Sarah Mitchell"

    assert client.post(
        "/api/shift-handoffs", json={"supervisor_id": 10, "shift": "day", "notes": "All clear"}
    ).json() == {"status": "created"}
    handoffs = client.get("/api/shift-handoffs").json()
    assert handoffs[0]["notes"] == "All clear"
    assert len(handoffs) == 2  # plus the seeded night-shift handoff


def test_chat_falls_back_to_keywords_without_an_api_key(client: TestClient) -> None:
    reply = client.post("/api/chat", json={"user_id": 1, "message": "where are the slip sheets?"}).json()
    assert reply["source"] == "Facility Layout Guide"
    assert "Aisle 14" in reply["response"]
    history = client.get("/api/chat/history/1").json()
    assert [m["role"] for m in history] == ["user", "assistant"]


def test_chat_answers_from_the_knowledge_base(client: TestClient) -> None:
    reply = client.post("/api/chat", json={"user_id": 1, "message": "the seal is broken and tampered"}).json()
    assert reply["source"] == "Security SOP 8.1 — Seal Verification"


def test_analytics_summary_is_consistent(client: TestClient) -> None:
    summary = client.get("/api/analytics/summary").json()
    assert summary["total_issues"] == 50
    assert sum(row["count"] for row in summary["by_type"]) == 50
    assert sum(row["count"] for row in summary["by_severity"]) == 50
    assert summary["self_resolution_rate"] == round(summary["self_resolved"] / 50 * 100, 1)
    assert summary["avg_resolution_minutes"] > 0
    assert len(summary["by_company"]) <= 10
    assert all(len(point["date"]) == 10 for point in summary["over_time"])
