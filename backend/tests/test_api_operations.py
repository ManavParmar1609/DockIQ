"""Auth, reference data, orders and scanning, load plans, floor operations, chat and analytics."""

from collections.abc import Callable

from fastapi.testclient import TestClient

from app.domain.barcodes import demo_gtin
from tests.conftest import DEMO_PASSWORD, Headers, token_of

Login = Callable[[str], Headers]


# ── Auth ──


def test_health_is_public(client: TestClient) -> None:
    assert client.get("/api/health").json() == {"status": "ok"}


def test_login_returns_a_token_and_the_user(client: TestClient) -> None:
    response = client.post("/api/auth/login", data={"username": "op-001", "password": DEMO_PASSWORD})
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["user"]["employee_id"] == "OP-001"
    assert body["user"]["supervisor_name"] == "Sarah Mitchell"
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"}).json()
    assert me["id"] == body["user"]["id"]


def test_wrong_password_and_unknown_user_look_the_same(client: TestClient) -> None:
    wrong = client.post("/api/auth/login", data={"username": "OP-001", "password": "nope"})
    unknown = client.post("/api/auth/login", data={"username": "OP-999", "password": "nope"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()


def test_login_is_rate_limited(client: TestClient) -> None:
    codes = [
        client.post("/api/auth/login", data={"username": "OP-001", "password": "x"}).status_code
        for _ in range(11)
    ]
    assert codes[-1] == 429


def test_everything_but_health_and_login_needs_a_token(client: TestClient) -> None:
    for path in ("/api/docks", "/api/issues", "/api/orders", "/api/taxonomy", "/api/auth/me"):
        assert client.get(path).status_code == 401
    assert client.get("/api/docks", headers={"Authorization": "Bearer forged"}).status_code == 401


def test_demo_accounts_list_names_but_never_passwords(client: TestClient) -> None:
    accounts = client.get("/api/auth/demo-accounts").json()
    assert {a["role"] for a in accounts} == {"operator", "supervisor", "quality"}
    assert all(set(a) == {"employee_id", "name", "role", "zone", "supervisor_name"} for a in accounts)


# ── Reference ──


def test_taxonomy_is_the_single_source_of_lists(client: TestClient, login: Login) -> None:
    taxonomy = client.get("/api/taxonomy", headers=login("OP-001")).json()
    names = [t["name"] for t in taxonomy["issue_types"]]
    assert len(names) == 12
    assert {"Safety Incident", "WMS/System Issue", "Count Discrepancy"} <= set(names)
    safety = next(t for t in taxonomy["issue_types"] if t["name"] == "Safety Incident")
    assert safety["floor"]["Employee injury"] == "critical"
    assert "Partial Accept" in taxonomy["operator_resolutions"]
    assert "Override — Accept Anyway" in taxonomy["supervisor_decisions"]


def test_users_are_scoped_to_the_team(client: TestClient, login: Login) -> None:
    team = client.get("/api/users", headers=login("SUP-001")).json()
    assert {u["employee_id"] for u in team} == {"SUP-001", "OP-001", "OP-002", "OP-005", "OP-009"}
    own = client.get("/api/users", headers=login("OP-001")).json()
    assert {u["employee_id"] for u in own} == {"OP-001", "SUP-001"}


def test_reference_data_is_fictional_and_complete(client: TestClient, login: Login) -> None:
    headers = login("OP-001")
    companies = client.get("/api/companies", headers=headers).json()
    assert (len(companies), companies[0]["name"]) == (20, "Crestline Markets")
    products = client.get("/api/products", headers=headers).json()
    assert len(products) == 80
    assert products[0]["gtin"] == demo_gtin(1)
    assert len(client.get("/api/docks", headers=headers).json()) == 12


# ── Orders, scanning, load plans ──


def test_operator_sees_only_their_orders(client: TestClient, login: Login) -> None:
    orders = client.get("/api/orders", headers=login("OP-001")).json()
    assert [o["order_number"] for o in orders] == ["ORD-2026-4521"]
    assert client.get("/api/orders/2", headers=login("OP-001")).status_code == 404
    team = client.get("/api/orders", headers=login("SUP-001")).json()
    assert {o["operator_name"] for o in team} == {"Mike Johnson", "Lisa Chen", "Tanya Brooks"}


def test_scanning_the_right_case_counts_it(client: TestClient, login: Login) -> None:
    op = login("OP-001")
    result = client.post(
        "/api/orders/1/scan", json={"code": demo_gtin(1)[1:]}, headers=op
    ).json()  # as EAN-13
    assert result["result"] == "match"
    assert result["item"]["actual_quantity"] == 1
    assert result["item"]["verified"] is True


def test_scanning_the_wrong_product_is_a_mismatch_and_counts_nothing(
    client: TestClient, login: Login
) -> None:
    op = login("OP-001")
    # Scenario 3: a near-identical milk from another customer is staged instead.
    result = client.post("/api/orders/1/scan", json={"code": "BHC-RF-2002"}, headers=op).json()
    assert result["result"] == "mismatch"
    assert result["scanned_sku"] == "BHC-RF-2002"
    assert result["expected_skus"] == ["CRM-FZ-1001", "CRM-RF-1002"]
    assert result["item"] is None
    items = client.get("/api/orders/1", headers=op).json()["items"]
    assert all(item["actual_quantity"] == 0 for item in items)


def test_scanning_an_unknown_code(client: TestClient, login: Login) -> None:
    result = client.post("/api/orders/1/scan", json={"code": "0000000000000"}, headers=login("OP-001")).json()
    assert result["result"] == "unknown"


def test_counting_and_completing_an_order(client: TestClient, login: Login) -> None:
    op, sup = login("OP-001"), login("SUP-001")
    counted = client.put("/api/orders/1/items", json={"product_id": 1, "actual_quantity": 198}, headers=op)
    assert counted.status_code == 200
    with client.websocket_connect("/ws", subprotocols=["dockiq", token_of(sup)]) as socket:
        done = client.post("/api/orders/1/complete", json={"seal_number": "SL-1"}, headers=op)
        assert done.json() == {"status": "completed", "discrepancy_issue_ids": []}  # outbound: no auto-filing
        assert socket.receive_json() == {"type": "order_complete", "order_id": 1}
    dock = client.get("/api/docks/1", headers=op).json()
    assert (dock["status"], dock["lifecycle_phase"]) == ("idle", "complete")
    again = client.put("/api/orders/1/items", json={"product_id": 1, "actual_quantity": 1}, headers=op)
    assert again.status_code == 403


def test_load_plan_follows_the_customer_rules(client: TestClient, login: Login) -> None:
    plan = client.get("/api/orders/1/load-plan", headers=login("OP-001")).json()
    # Crestline: straight, max 2 high, heavy bottom, slip sheets. 200 chicken @48 + 150 milk @36.
    assert (plan["floor_pattern"], plan["max_height"], plan["rows"]) == ("straight", 2, 13)
    assert plan["total_pallets"] == 5 + 5
    assert plan["stacks_used"] == 5
    assert "Slip sheet between every layer" in plan["checklist"]
    bottom = [p for p in plan["pallets"] if p["level"] == 0]
    top = [p for p in plan["pallets"] if p["level"] == 1]
    assert min(p["weight_lbs"] for p in bottom) >= max(p["weight_lbs"] for p in top)
    assert (plan["pallets"][0]["load_sequence"], plan["pallets"][0]["row"]) == (1, 0)


def test_probe_temperature_is_judged_server_side(client: TestClient, login: Login) -> None:
    op = login("OP-002")  # order 2: inbound, Bulkhaven salmon (Frozen, max 0°F) + milk (max 40°F)
    critical = client.post("/api/orders/2/temperature-check", json={"reading": 28}, headers=op).json()
    assert (critical["status"], critical["limit"], critical["delta"]) == ("critical", 0, 28)
    assert "DO NOT UNLOAD" in critical["guidance"]
    ok = client.post("/api/orders/2/temperature-check", json={"reading": -4}, headers=op).json()
    assert ok["status"] == "ok"


def test_inbound_completion_files_count_discrepancies(client: TestClient, login: Login) -> None:
    op, sup = login("OP-002"), login("SUP-001")
    detail = client.get("/api/orders/2", headers=op).json()
    salmon, milk = detail["items"]
    client.put(
        "/api/orders/2/items", json={"product_id": salmon["product_id"], "actual_quantity": 100}, headers=op
    )
    client.put(
        "/api/orders/2/items",
        json={"product_id": milk["product_id"], "actual_quantity": milk["expected_quantity"]},
        headers=op,
    )
    done = client.post("/api/orders/2/complete", json={}, headers=op).json()
    assert len(done["discrepancy_issue_ids"]) == 1  # salmon 100 of 120; milk exact
    issue = client.get(f"/api/issues/{done['discrepancy_issue_ids'][0]}", headers=sup).json()
    assert (issue["issue_type"], issue["issue_subtype"]) == ("Count Discrepancy", "Short count")
    assert "Count shortage 16.7% exceeds 5% (+3)" in issue["severity_reason"]


# ── Floor ──


def inspection(**overrides: object) -> dict[str, object]:
    return {
        "dock_door_id": 1,
        "seal_condition": "intact",
        "interior_cleanliness": "clean",
        "visible_damage": "none",
        **overrides,
    }


def test_inspection_gate_follows_the_load_not_a_fixed_45f(client: TestClient, login: Login) -> None:
    op = login("OP-001")
    # Order 1 carries a Frozen line (max 0°F): a 40°F trailer used to pass the fixed 45°F gate.
    warm = client.post("/api/inspections", json=inspection(interior_temperature=40), headers=op).json()
    assert (warm["overall_pass"], warm["temperature_limit"], warm["failed_checks"]) == (
        False,
        0,
        ["temperature"],
    )
    cold = client.post("/api/inspections", json=inspection(interior_temperature=-5), headers=op).json()
    assert cold["overall_pass"] is True
    assert client.get("/api/docks/1", headers=op).json()["lifecycle_phase"] == "inspection"


def test_inspection_without_a_load_uses_the_default_limit(client: TestClient, login: Login) -> None:
    result = client.post(
        "/api/inspections", json=inspection(dock_door_id=12, interior_temperature=45), headers=login("OP-001")
    ).json()
    assert (result["overall_pass"], result["temperature_limit"]) == (True, 45)


def test_quick_request_reaches_the_supervisor(client: TestClient, login: Login) -> None:
    op, sup = login("OP-002"), login("SUP-001")
    with client.websocket_connect("/ws", subprotocols=["dockiq", token_of(sup)]) as socket:
        created = client.post(
            "/api/requests", json={"dock_door_id": 3, "request_type": "Supplies — Pallet Wrap"}, headers=op
        ).json()
        assert socket.receive_json()["type"] == "new_request"
    pending = client.get("/api/requests", params={"status": "pending"}, headers=sup).json()
    assert pending[0]["operator_name"] == "Lisa Chen"
    assert client.get("/api/requests", headers=login("SUP-002")).json() == []
    assert client.put(f"/api/requests/{created['id']}/fulfill", headers=sup).json() == {"status": "fulfilled"}
    assert client.post("/api/requests", json={"request_type": "Pizza"}, headers=op).status_code == 422


def test_broadcast_reaches_the_team_only(client: TestClient, login: Login) -> None:
    sup = login("SUP-001")
    with client.websocket_connect("/ws", subprotocols=["dockiq", token_of(login("OP-001"))]) as socket:
        created = client.post("/api/broadcasts", json={"message": "Dock 5 closed"}, headers=sup).json()
        assert socket.receive_json() == {"type": "broadcast", "message": "Dock 5 closed", "id": created["id"]}
    assert client.get("/api/broadcasts", headers=login("OP-001")).json()[0]["message"] == "Dock 5 closed"
    assert client.get("/api/broadcasts", headers=login("OP-003")).json() == []


def test_handoffs_are_per_zone(client: TestClient, login: Login) -> None:
    client.post("/api/shift-handoffs", json={"shift": "day", "notes": "All clear"}, headers=login("SUP-001"))
    assert client.get("/api/shift-handoffs", headers=login("OP-001")).json()[0]["notes"] == "All clear"
    assert client.get("/api/shift-handoffs", headers=login("OP-003")).json() == []


# ── Chat and analytics ──


def test_chat_uses_the_token_identity(client: TestClient, login: Login) -> None:
    op = login("OP-001")
    reply = client.post("/api/chat", json={"message": "where are the slip sheets?"}, headers=op).json()
    assert reply["source"] == "Facility Layout Guide"
    assert [m["role"] for m in client.get("/api/chat/history", headers=op).json()] == ["user", "assistant"]
    assert client.get("/api/chat/history", headers=login("OP-002")).json() == []


def test_analytics_are_team_scoped_for_supervisors(client: TestClient, login: Login) -> None:
    facility = client.get("/api/analytics/summary", headers=login("QA-001")).json()
    team = client.get("/api/analytics/summary", headers=login("SUP-001")).json()
    assert facility["total_issues"] == 50
    assert 0 < team["total_issues"] < 50
    assert sum(row["count"] for row in facility["by_type"]) == 50
    assert client.get("/api/analytics/summary", headers=login("OP-001")).status_code == 403
