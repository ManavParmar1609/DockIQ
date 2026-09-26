"""Decisions that take effect, quality hold and disposition, traceable issue records, receiving
evidence, reports without an order, requests both ways, scoped analytics and export, the handoff draft
and read receipt, and the load guide's step. See docs/architecture/business-rules.md §7, §11, §12."""

import asyncio
import csv
import io
from collections.abc import Callable

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import Settings
from app.db import Database
from app.domain.enums import Role
from app.models import Order, User, WmsStock, WmsTransaction
from app.security import demo_password_hash
from tests.conftest import DEMO_PASSWORD, Headers, token_of

Login = Callable[[str], Headers]

# Seed facts (app/seed/data): OP-001 runs order 1 — outbound, dock 1, Crestline Markets, BOL-884201,
# CRM-FZ-1001 (product 1, limit 0°F) 200 cases + CRM-RF-1002 150 cases. OP-002 runs order 2 — inbound,
# dock 3, BHC-FZ-2001 (limit 0°F) + BHC-RF-2002. Both are in SUP-001's team (Sarah Mitchell, Zone A).
CRUSHED = {
    "order_id": 1,
    "dock_door_id": 1,
    "issue_type": "Damaged Pallet",
    "issue_subtype": "Crushed or collapsed pallet",
    "description": "pallet is crushed",
    "product_id": 1,
    "company_id": 1,
    "carrier_id": 1,
    "quantity_affected": 10,
}
LEVELER = {  # a systems issue on order 1: never critical
    "order_id": 1,
    "issue_type": "Equipment Failure",
    "issue_subtype": "Dock leveler not working",
    "description": "leveler stuck",
}
WARM = {
    "order_id": 1,
    "issue_type": "Temperature Deviation",
    "issue_subtype": "Product temperature out of range",
    "description": "probe reads warm",
    "product_id": 1,
    "company_id": 1,
    "carrier_id": 1,
    "quantity_affected": 6,
    "temp_reading": 2.0,
    "temp_threshold_max": 0.0,
    "lot": "L2601A",
}


def file(client: TestClient, headers: Headers, body: dict[str, object]) -> dict:  # type: ignore[type-arg]
    response = client.post("/api/issues", json=body, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def decide(client: TestClient, headers: Headers, issue_id: int, decision: str, notes: str = "") -> int:
    return client.put(
        f"/api/issues/{issue_id}/supervisor-resolve",
        json={"resolution_type": decision, "supervisor_notes": notes},
        headers=headers,
    ).status_code


def blockers(client: TestClient, headers: Headers, order_id: int) -> list[str]:
    return client.get(f"/api/orders/{order_id}", headers=headers).json()["completion_blockers"]


def run[T](settings: Settings, work: Callable[..., object]) -> T:
    async def go() -> T:
        database = Database(settings)
        try:
            async with database.sessionmaker() as session:
                return await work(session)  # type: ignore[no-any-return, misc]
        finally:
            await database.dispose()

    return asyncio.run(go())


# ── §7.2 Decisions take effect ──


def test_accepting_product_on_a_critical_issue_needs_a_reason(client: TestClient, login: Login) -> None:
    op, sup = login("OP-001"), login("SUP-001")
    issue = file(client, op, CRUSHED)
    assert issue["severity"] == "critical"
    for decision in ("Accept", "Partial Accept", "Override — Accept Anyway"):
        assert decide(client, sup, issue["id"], decision) == 422
        assert decide(client, sup, issue["id"], decision, "   ") == 422
    assert decide(client, sup, issue["id"], "Partial Accept", "3 cases out, rest sound") == 200
    stored = client.get(f"/api/issues/{issue['id']}", headers=sup).json()
    assert stored["supervisor_notes"] == "3 cases out, rest sound"


def test_accepting_product_on_a_temperature_issue_needs_a_reason(client: TestClient, login: Login) -> None:
    op, sup = login("OP-001"), login("SUP-001")
    issue = file(client, op, WARM)
    assert decide(client, sup, issue["id"], "Accept") == 422
    assert decide(client, sup, issue["id"], "Accept", "Re-probed at 0°F") == 200


def test_contact_carrier_puts_the_issue_on_hold_and_it_stays_open(client: TestClient, login: Login) -> None:
    op, sup = login("OP-001"), login("SUP-001")
    issue = file(client, op, LEVELER)
    assert decide(client, sup, issue["id"], "Contact Carrier", "Called Tiger Freight") == 200
    held = client.get(f"/api/issues/{issue['id']}", headers=sup).json()
    assert held["status"] == "on_hold"
    assert held["pending_action"] == "Awaiting the carrier"
    assert held["on_hold_at"] is not None
    assert held["resolved_at"] is None
    assert held["supervisor_name"] == "Sarah Mitchell"
    active = client.get("/api/issues", params={"status": "active"}, headers=sup).json()
    assert issue["id"] in {i["id"] for i in active}
    assert (
        client.put(
            f"/api/issues/{issue['id']}/self-resolve", json={"resolution_type": "Other"}, headers=op
        ).status_code
        == 409
    )
    assert (
        decide(client, sup, issue["id"], "Request Re-inspection") == 200
    )  # one pending call replaces another
    assert decide(client, sup, issue["id"], "Accept") == 200  # the final decision
    closed = client.get(f"/api/issues/{issue['id']}", headers=sup).json()
    assert (closed["status"], closed["pending_action"]) == ("supervisor_resolved", None)
    assert decide(client, sup, issue["id"], "Contact Carrier") == 409


def test_request_reinspection_blocks_sign_off_until_an_inspection_passes(
    client: TestClient, login: Login
) -> None:
    op, sup = login("OP-001"), login("SUP-001")
    issue = file(client, op, LEVELER)
    assert decide(client, sup, issue["id"], "Request Re-inspection") == 200
    assert blockers(client, op, 1) == [
        "Re-inspection requested by Sarah Mitchell: a new trailer inspection must pass first."
    ]
    assert client.post("/api/orders/1/complete", json={}, headers=op).status_code == 409
    passed = client.post(
        "/api/inspections",
        json={
            "order_id": 1,
            "dock_door_id": 1,
            "seal_condition": "intact",
            "interior_cleanliness": "clean",
            "visible_damage": "none",
        },
        headers=op,
    ).json()
    assert passed["overall_pass"] is True
    assert blockers(client, op, 1) == []
    assert client.post("/api/orders/1/complete", json={}, headers=op).status_code == 200


def test_full_reject_blocks_sign_off_and_flags_the_dock(client: TestClient, login: Login) -> None:
    op, sup = login("OP-001"), login("SUP-001")
    issue = file(client, op, CRUSHED)
    assert decide(client, sup, issue["id"], "Full Reject", "Seal broken at the door") == 200
    assert client.get(f"/api/issues/{issue['id']}", headers=sup).json()["status"] == "supervisor_resolved"
    assert client.get("/api/docks/1", headers=sup).json()["status"] == "issue"
    assert blockers(client, op, 1) == ["Rejected by Sarah Mitchell — Seal broken at the door"]
    refused = client.post("/api/orders/1/complete", json={}, headers=op)
    assert refused.status_code == 409
    assert "Rejected by Sarah Mitchell" in refused.json()["detail"]


def test_who_acknowledged_is_kept_apart_from_who_decided(client: TestClient, login: Login) -> None:
    op, sup = login("OP-001"), login("SUP-001")
    unacknowledged = file(client, op, LEVELER)
    assert decide(client, sup, unacknowledged["id"], "Other") == 200
    stored = client.get(f"/api/issues/{unacknowledged['id']}", headers=sup).json()
    assert stored["acknowledged_at"] is None  # a decision no longer back-fills "on my way"
    assert stored["acknowledged_by_name"] is None
    assert stored["supervisor_name"] == "Sarah Mitchell"


# ── §7.3 Quality hold and disposition ──


def test_quality_decides_the_disposition_supervisors_only_read_it(client: TestClient, login: Login) -> None:
    op, sup, qa = login("OP-001"), login("SUP-001"), login("QA-001")
    issue = file(client, op, WARM)
    url = f"/api/issues/{issue['id']}/disposition"
    assert client.put(url, json={"disposition": "hold", "notes": "x"}, headers=sup).status_code == 403
    assert client.put(url, json={"disposition": "hold", "notes": "x"}, headers=op).status_code == 403
    assert client.put(url, json={"disposition": "hold", "notes": ""}, headers=qa).status_code == 422
    assert client.put(url, json={"disposition": "hold", "notes": "   "}, headers=qa).status_code == 422
    assert client.put(url, json={"disposition": "burn", "notes": "x"}, headers=qa).status_code == 422
    assert (
        client.put(
            "/api/issues/99999/disposition", json={"disposition": "hold", "notes": "x"}, headers=qa
        ).status_code
        == 404
    )

    # A person's own order has no stock in the WMS: the disposition is recorded all the same.
    held = client.put(url, json={"disposition": "hold", "notes": "Pending lab result"}, headers=qa)
    assert held.status_code == 200, held.text
    assert (held.json()["disposition"], held.json()["held_pallets"]) == ("hold", [])
    destroyed = client.put(url, json={"disposition": "destroy", "notes": "Lab: unsafe"}, headers=qa).json()
    assert destroyed["disposition"] == "destroy"
    assert destroyed["disposition_notes"] == "Lab: unsafe"
    assert destroyed["disposition_by_name"] == "Dana Okafor"
    assert destroyed["disposition_at"] is not None
    assert client.put(url, json={"disposition": "release", "notes": "oops"}, headers=qa).status_code == 409
    assert client.get(f"/api/issues/{issue['id']}", headers=sup).json()["disposition"] == "destroy"


# ── §7 Traceable records ──


def test_an_issue_record_carries_its_order_reading_quantity_and_lot(client: TestClient, login: Login) -> None:
    op = login("OP-001")
    issue = client.get(f"/api/issues/{file(client, op, WARM)['id']}", headers=op).json()
    assert (issue["order_number"], issue["trailer_number"], issue["bol_number"]) == (
        "ORD-2026-4521",
        "TRL-TG-8842",
        "BOL-884201",
    )
    assert (issue["temp_reading"], issue["temp_limit"], issue["quantity_affected"], issue["lot"]) == (
        2.0,
        0.0,
        6,
        "L2601A",
    )
    assert issue["dock_door_id"] == 1  # the order's dock, when the report names none
    assert (issue["sim_minute"], issue["sim_time"], issue["held_pallets"]) == (None, None, [])
    assert issue["created_at"].endswith(("Z", "+00:00"))


# ── §8 Reporting without an order ──


def test_people_and_systems_issues_need_no_order_but_product_issues_do(
    client: TestClient, login: Login
) -> None:
    op = login("OP-001")
    near_miss = file(
        client, op, {"issue_type": "Safety Incident", "issue_subtype": "Near miss", "description": "forklift"}
    )
    stored = client.get(f"/api/issues/{near_miss['id']}", headers=op).json()
    assert (stored["order_id"], stored["dock_door_id"]) == (None, None)
    scanner = file(client, op, {"dock_door_id": 12, "issue_type": "Equipment Failure", "description": "dead"})
    assert client.get(f"/api/issues/{scanner['id']}", headers=op).json()["door_number"] == 12
    product = client.post("/api/issues", json={**CRUSHED, "order_id": None, "dock_door_id": 12}, headers=op)
    assert product.status_code == 422
    assert "order" in product.json()["detail"]
    assert client.post("/api/issues", json={**CRUSHED, "order_id": 2}, headers=op).status_code == 404


# ── §11 Receiving evidence ──


def test_inbound_sign_off_needs_every_check_answered_and_a_probe(client: TestClient, login: Login) -> None:
    op = login("OP-002")
    refused = client.post("/api/orders/2/complete", json={}, headers=op)
    assert refused.status_code == 409
    assert "5 receiving checks are not answered yet." in refused.json()["detail"]
    assert "No probe reading recorded" in refused.json()["detail"]

    url = "/api/orders/2/receiving-checks"
    assert client.put(url, json={"answers": {"gremlins": True}}, headers=op).status_code == 422
    assert client.put(url, json={"answers": {}}, headers=op).status_code == 422
    assert client.put(url, json={"answers": {"pallets": True}}, headers=login("QA-001")).status_code == 403
    assert (
        client.put(
            "/api/orders/1/receiving-checks", json={"answers": {"pallets": True}}, headers=login("OP-001")
        )
    ).status_code == 422  # outbound: nothing to receive
    assert client.put(url, json={"answers": {"pallets": True}}, headers=login("OP-001")).status_code == 404

    partial = client.put(url, json={"answers": {"pallets": False, "labels": True}}, headers=op).json()
    pallets = next(check for check in partial["checks"] if check["id"] == "pallets")
    assert (pallets["answer"], pallets["answered_by_name"], pallets["issue_type"]) == (
        False,
        "Lisa Chen",
        "Damaged Pallet",
    )
    assert (partial["all_answered"], partial["needs_probe"], partial["probes"]) == (False, True, 0)
    everything = {check["id"]: True for check in partial["checks"]}
    assert client.put(url, json={"answers": everything}, headers=op).json()["all_answered"] is True
    assert blockers(client, op, 2) == [
        "No probe reading recorded: probe the centre of a case before sign-off."
    ]
    assert client.post("/api/orders/2/temperature-check", json={"reading": -8}, headers=op).status_code == 200
    assert blockers(client, op, 2) == []
    assert client.get(url, headers=login("SUP-001")).json()["probes"] == 1


def test_every_probe_is_logged_and_a_critical_one_files_a_deviation_that_holds_sign_off(
    client: TestClient, login: Login
) -> None:
    op, sup, qa = login("OP-002"), login("SUP-001"), login("QA-001")
    probe = "/api/orders/2/temperature-check"
    fine = client.post(probe, json={"reading": -5}, headers=op).json()
    assert (fine["status"], fine["issue_id"]) == ("ok", None)
    assert fine["id"] is not None
    with client.websocket_connect("/ws", subprotocols=["dockiq", token_of(qa)]) as quality:
        hot = client.post(probe, json={"reading": 15}, headers=op).json()
        assert hot["status"] == "critical"
        event = quality.receive_json()
        assert (event["type"], event["issue"]["id"]) == ("new_issue", hot["issue_id"])
    deviation = client.get(f"/api/issues/{hot['issue_id']}", headers=sup).json()
    assert (deviation["issue_type"], deviation["temp_reading"], deviation["temp_limit"]) == (
        "Temperature Deviation",
        15.0,
        0.0,
    )
    assert deviation["order_number"] == "ORD-2026-4522"
    assert deviation["severity_reason"]  # scored by the formula, like any report
    again = client.post(probe, json={"reading": 18}, headers=op).json()
    assert again["issue_id"] == hot["issue_id"]  # joins the open deviation, never a second one

    log = client.get("/api/orders/2/temperature-checks", headers=sup).json()
    assert [(entry["reading"], entry["status"]) for entry in log] == [
        (-5.0, "ok"),
        (15.0, "critical"),
        (18.0, "critical"),
    ]
    assert all(entry["operator_name"] == "Lisa Chen" for entry in log)
    assert client.get("/api/orders/2/temperature-checks", headers=login("OP-001")).status_code == 404

    client.put(
        "/api/orders/2/receiving-checks",
        json={"answers": {c: True for c in ("pallets", "packaging", "labels", "bol", "lot")}},
        headers=op,
    )
    assert any(
        b.startswith(f"Critical probe reading 18°F: Temperature Deviation #{hot['issue_id']}")
        for b in blockers(client, op, 2)
    )
    assert client.post("/api/orders/2/complete", json={}, headers=op).status_code == 409
    assert decide(client, sup, hot["issue_id"], "Partial Accept", "Top layer destroyed; core at 0°F") == 200
    assert blockers(client, op, 2) == []
    assert client.post("/api/orders/2/complete", json={}, headers=op).status_code == 200


# ── Requests both ways ──


def test_fulfilling_a_request_tells_the_operator_who_asked(client: TestClient, login: Login) -> None:
    op, sup = login("OP-001"), login("SUP-001")
    with client.websocket_connect("/ws", subprotocols=["dockiq", token_of(op)]) as operator:
        made = client.post("/api/requests", json={"request_type": "Cleanup Needed"}, headers=op).json()
        assert operator.receive_json() == {
            "type": "new_request",
            "request_id": made["id"],
            "request_type": "Cleanup Needed",
            "status": "pending",
        }
        assert client.put(f"/api/requests/{made['id']}/fulfill", headers=sup).status_code == 200
        assert operator.receive_json() == {
            "type": "new_request",
            "request_id": made["id"],
            "request_type": "Cleanup Needed",
            "status": "fulfilled",
        }
    assert client.put(f"/api/requests/{made['id']}/fulfill", headers=sup).status_code == 409
    mine = client.get("/api/requests/mine", headers=op).json()
    assert [(r["id"], r["status"]) for r in mine] == [(made["id"], "fulfilled")]
    assert client.get("/api/requests/mine", params={"status": "pending"}, headers=op).json() == []
    assert client.get("/api/requests/mine", headers=login("OP-002")).json() == []
    assert client.put("/api/requests/99999/fulfill", headers=sup).status_code == 404


# ── Analytics and the issue list: same scope, date filters, CSV export ──


def test_analytics_and_the_issue_list_filter_by_date_door_and_carrier(
    client: TestClient, login: Login
) -> None:
    sup = login("SUP-001")
    everything = client.get("/api/analytics/summary", headers=sup).json()
    future = client.get("/api/analytics/summary", params={"from": "2100-01-01"}, headers=sup).json()
    assert everything["total_issues"] > 0
    assert (future["total_issues"], future["over_time"]) == (0, [])
    assert (
        client.get(
            "/api/analytics/summary", params={"from": "2026-09-02", "to": "2026-09-01"}, headers=sup
        ).status_code
        == 422
    )
    assert client.get("/api/analytics/summary", params={"from": "not-a-date"}, headers=sup).status_code == 422

    at_door = client.get("/api/issues", params={"dock": 1, "limit": 500}, headers=sup).json()
    assert at_door
    assert {issue["door_number"] for issue in at_door} == {1}
    by_carrier = client.get("/api/issues", params={"carrier_id": 1, "limit": 500}, headers=sup).json()
    assert {issue["carrier_id"] for issue in by_carrier} == {1}
    assert client.get("/api/issues", params={"from": "2100-01-01"}, headers=sup).json() == []
    assert client.get("/api/issues", params={"to": "2000-01-01"}, headers=sup).json() == []
    assert client.get("/api/issues", params={"dock": 0}, headers=sup).status_code == 422


def test_the_issue_list_exports_as_csv_with_the_same_scope_and_filters(
    client: TestClient, login: Login
) -> None:
    op, sup = login("OP-001"), login("SUP-001")
    file(client, op, {**LEVELER, "description": '=HYPERLINK("http://example.invalid")'})
    exported = client.get("/api/issues/export.csv", params={"dock": 1, "limit": 500}, headers=sup)
    assert exported.status_code == 200
    assert exported.headers["content-type"].startswith("text/csv")
    assert "attachment" in exported.headers["content-disposition"]
    rows = list(csv.DictReader(io.StringIO(exported.text)))
    listed = client.get("/api/issues", params={"dock": 1, "limit": 500}, headers=sup).json()
    assert [int(row["id"]) for row in rows] == [issue["id"] for issue in listed]
    assert {row["door_number"] for row in rows} == {"1"}

    own = list(csv.DictReader(io.StringIO(client.get("/api/issues/export.csv", headers=op).text)))
    assert own
    assert {row["operator_name"] for row in own} == {"Mike Johnson"}  # an operator exports their own
    assert own[0]["description"].startswith("'=")  # never runs as a spreadsheet formula
    assert client.get("/api/issues/export.csv", params={"limit": 5001}, headers=sup).status_code == 422
    assert client.get("/api/issues/export.csv").status_code == 401


# ── The handoff: a draft, and a read receipt ──


async def _second_zone_a_supervisor(session) -> None:  # type: ignore[no-untyped-def]
    session.add(
        User(
            name="Nia Adebayo",
            role=Role.SUPERVISOR,
            employee_id="SUP-009",
            shift="night",
            zone="Zone A",
            password_hash=demo_password_hash(DEMO_PASSWORD),
        )
    )
    await session.commit()


def test_the_handoff_draft_carries_what_the_next_shift_inherits(client: TestClient, login: Login) -> None:
    op, sup = login("OP-001"), login("SUP-001")
    critical = file(client, op, CRUSHED)
    pending = file(client, op, LEVELER)
    decide(client, sup, pending["id"], "Contact Carrier", "Called the carrier")
    request = client.post("/api/requests", json={"request_type": "Cleanup Needed"}, headers=op).json()

    draft = client.get("/api/shift-handoffs/draft", headers=sup)
    assert draft.status_code == 200, draft.text
    body = draft.json()
    assert body["zone"] == "Zone A"
    assert critical["id"] in {line["id"] for line in body["open_criticals"]}
    decision = next(line for line in body["decisions"] if line["id"] == pending["id"])
    assert (decision["decision"], decision["status"], decision["decided_by"]) == (
        "Contact Carrier",
        "on_hold",
        "Sarah Mitchell",
    )
    assert request["id"] in {r["id"] for r in body["pending_requests"]}
    assert body["wms_online"] is True
    assert "Open critical issues:" in body["notes"]
    assert client.get("/api/shift-handoffs/draft", headers=op).status_code == 403
    assert client.get("/api/shift-handoffs/draft", headers=login("QA-001")).status_code == 403


def test_the_incoming_supervisor_opening_a_handoff_is_its_read_receipt(
    client: TestClient, seeded_db: Settings, login: Login
) -> None:
    run(seeded_db, _second_zone_a_supervisor)
    sup = login("SUP-001")
    client.post("/api/shift-handoffs", json={"shift": "day", "notes": "Door 1 leveler is out"}, headers=sup)
    handoff = next(
        h
        for h in client.get("/api/shift-handoffs", headers=sup).json()
        if h["notes"] == "Door 1 leveler is out"
    )
    assert handoff["read_by"] is None
    url = f"/api/shift-handoffs/{handoff['id']}/read"
    assert client.put(url, headers=sup).status_code == 409  # your own
    assert client.put(url, headers=login("SUP-002")).status_code == 404  # another zone's
    assert client.put(url, headers=login("OP-001")).status_code == 403
    assert client.put("/api/shift-handoffs/99999/read", headers=sup).status_code == 404
    incoming = login("SUP-009")
    read = client.put(url, headers=incoming).json()
    assert (read["read_by_name"], read["read_at"] is not None) == ("Nia Adebayo", True)
    first = read["read_at"]
    assert client.put(url, headers=incoming).json()["read_at"] == first  # the first opening stands
    listed = next(
        h for h in client.get("/api/shift-handoffs", headers=sup).json() if h["id"] == handoff["id"]
    )
    assert listed["read_by_name"] == "Nia Adebayo"


# ── The load guide's step, on the server ──


def test_the_load_step_is_kept_on_the_server_and_can_count_the_pallet(
    client: TestClient, login: Login
) -> None:
    op = login("OP-001")
    assert client.get("/api/orders/1", headers=op).json()["load_step"] is None
    plan = client.get("/api/orders/1/load-plan", headers=op).json()
    first = next(p for p in plan["pallets"] if p["load_sequence"] == 1)
    before = next(
        i for i in client.get("/api/orders/1", headers=op).json()["items"] if i["sku"] == first["sku"]
    )

    moved = client.put("/api/orders/1/load-step", json={"step": 2, "count": True}, headers=op).json()
    assert moved["load_step"] == 2
    assert moved["counted"]["sku"] == first["sku"]
    assert moved["counted"]["actual_quantity"] == min(
        before["expected_quantity"], before["actual_quantity"] + first["cases"]
    )
    assert client.get("/api/orders/1", headers=op).json()["load_step"] == 2  # survives a tablet swap

    back = client.put("/api/orders/1/load-step", json={"step": 1, "count": True}, headers=op).json()
    assert back["counted"]["actual_quantity"] == before["actual_quantity"]  # counts stay consistent
    quiet = client.put("/api/orders/1/load-step", json={"step": 4}, headers=op).json()
    assert (quiet["load_step"], quiet["counted"]) == (4, None)

    jump = client.put("/api/orders/1/load-step", json={"step": 6, "count": True}, headers=op)
    assert jump.status_code == 422
    past = client.put("/api/orders/1/load-step", json={"step": len(plan["pallets"]) + 2}, headers=op)
    assert past.status_code == 422
    assert client.put("/api/orders/1/load-step", json={"step": 0}, headers=op).status_code == 422
    assert client.put("/api/orders/2/load-step", json={"step": 1}, headers=login("OP-002")).status_code == 422
    assert client.put("/api/orders/1/load-step", json={"step": 1}, headers=login("OP-002")).status_code == 404


# ── The simulator: reset guard, the yard's real door, holds on simulated stock ──


def step(client: TestClient, headers: Headers, minutes: float) -> None:
    response = client.post("/api/sim/step", json={"minutes": minutes}, headers=headers)
    assert response.status_code == 200, response.text


def test_reset_is_a_supervisors_call_and_never_deletes_a_persons_report(
    client: TestClient, login: Login
) -> None:
    sup = login("SUP-001")
    assert client.post("/api/sim/reset", json={}, headers=login("QA-001")).status_code == 403
    step(client, sup, 150)
    order = next(o for o in client.get("/api/orders", headers=sup).json() if o["simulated"])
    crew = next(u for u in client.get("/api/users", headers=sup).json() if u["id"] == order["operator_id"])
    person = login(crew["employee_id"])
    report = file(
        client,
        person,
        {
            "order_id": order["id"],
            "issue_type": "Safety Incident",
            "issue_subtype": "Near miss",
            "description": "x",
        },
    )
    assert client.post("/api/sim/reset", json={}, headers=sup).status_code == 200
    kept = client.get(f"/api/issues/{report['id']}", headers=person)
    assert kept.status_code == 200
    body = kept.json()
    assert (body["order_id"], body["order_number"], body["simulated"]) == (None, order["order_number"], False)
    assert client.get(f"/api/orders/{order['id']}", headers=sup).status_code == 404


def test_the_yard_board_shows_the_door_a_trailer_actually_reached(client: TestClient, login: Login) -> None:
    sup = login("SUP-001")
    step(client, sup, 150)
    doors = {
        o["order_number"]: o["door_number"] for o in client.get("/api/orders", headers=login("QA-001")).json()
    }
    yard = client.get("/api/wms/appointments", headers=sup).json()
    at_doors = [entry for entry in yard if entry["state"] in ("at_door", "departed")]
    assert at_doors
    for entry in at_doors:
        assert entry["door"] == doors[entry["order_number"]]
        assert entry["booked_door"] is not None
    for entry in yard:
        if entry["state"] in ("scheduled", "in_yard"):
            assert entry["door"] == entry["booked_door"]


def test_a_room_alarm_holds_the_exposed_stock_and_quality_releases_it(
    client: TestClient, seeded_db: Settings, login: Login
) -> None:
    from app.wms import rooms

    sup, qa = login("SUP-001"), login("QA-001")
    produce = rooms.excursion(42, "P", 0)  # the seeded run: the produce room alarms in shift 1
    assert produce is not None
    assert produce.alarm_at is not None
    step(client, sup, produce.alarm_at + 1)
    alarm = next(
        i
        for i in client.get("/api/issues", params={"limit": 200}, headers=qa).json()
        if i["simulated"] and i["room"] == "P"
    )
    assert alarm["held_pallets"]
    assert (alarm["sim_shift"], alarm["sim_time"]) == (
        1,
        f"{6 + int(produce.alarm_at) // 60:02d}:{int(produce.alarm_at) % 60:02d}",
    )
    assert alarm["temp_reading"] is not None
    stock = {row.lpn: row for row in run(seeded_db, lambda s: _all(s, WmsStock))}  # type: ignore[arg-type]
    assert all(stock[lpn].location == "P-HOLD" for lpn in alarm["held_pallets"])
    held_sku = stock[alarm["held_pallets"][0]].sku
    pickable = client.get("/api/wms/inventory", params={"sku": held_sku}, headers=sup).json()
    assert not set(alarm["held_pallets"]) & {p["pallet_id"] for p in pickable}  # FEFO skips held stock

    url = f"/api/issues/{alarm['id']}/disposition"
    released = client.put(url, json={"disposition": "release", "notes": "Core temps in range"}, headers=qa)
    assert released.status_code == 200, released.text
    stock = {row.lpn: row for row in run(seeded_db, lambda s: _all(s, WmsStock))}  # type: ignore[arg-type]
    assert all(stock[lpn].area == "storage" for lpn in alarm["held_pallets"])
    moves = run(seeded_db, lambda s: _all(s, WmsTransaction))  # type: ignore[arg-type]
    assert {m.lpn for m in moves if m.kind.value == "release"} == set(alarm["held_pallets"])
    assert client.put(url, json={"disposition": "hold", "notes": "again"}, headers=qa).status_code == 409


async def _all(session, model):  # type: ignore[no-untyped-def]
    return list(await session.scalars(select(model).order_by(model.id)))


def test_a_temperature_report_on_a_simulated_load_holds_what_it_unloaded(
    client: TestClient, seeded_db: Settings, login: Login
) -> None:
    sup = login("SUP-001")
    target: Order | None = None
    receipts: list[WmsTransaction] = []
    for _ in range(12):
        step(client, sup, 20)
        orders = run(seeded_db, lambda s: _all(s, Order))  # type: ignore[arg-type]
        moves = run(seeded_db, lambda s: _all(s, WmsTransaction))  # type: ignore[arg-type]
        for order in orders:
            if order.simulated and order.type.value == "inbound" and order.status.value == "in_progress":
                receipts = [m for m in moves if m.kind.value == "receive" and m.ref == order.external_ref]
                if receipts:
                    target = order
                    break
        if target is not None:
            break
    assert target is not None, "an inbound simulated trailer should be unloading by now"
    crew = run(seeded_db, lambda s: s.get(User, target.operator_id))  # type: ignore[union-attr, arg-type]
    person = login(crew.employee_id)
    product = next(
        p for p in client.get("/api/products", headers=person).json() if p["sku"] == receipts[0].sku
    )
    filed = file(
        client,
        person,
        {
            "order_id": target.id,
            "issue_type": "Temperature Deviation",
            "issue_subtype": "Product temperature out of range",
            "product_id": product["id"],
            "company_id": target.company_id,
            "temp_reading": (product["temp_max"] or 0) + 12,
            "temp_threshold_max": product["temp_max"],
        },
    )
    issue = client.get(f"/api/issues/{filed['id']}", headers=person).json()
    assert issue["held_pallets"]
    assert set(issue["held_pallets"]) <= {m.lpn for m in receipts if m.sku == product["sku"]}
    stock = run(seeded_db, lambda s: _all(s, WmsStock))  # type: ignore[arg-type]
    assert all(row.area == "hold" for row in stock if row.lpn in issue["held_pallets"])
    moves = run(seeded_db, lambda s: _all(s, WmsTransaction))  # type: ignore[arg-type]
    holds = [m for m in moves if m.kind.value == "hold"]
    assert {m.lpn for m in holds} == set(issue["held_pallets"])
    assert all(m.ref == f"ISSUE-{issue['id']}" and m.actor == crew.employee_id for m in holds)


def test_no_critical_issue_ever_waits_on_the_operator(client: TestClient, login: Login) -> None:
    sup, qa = login("SUP-001"), login("QA-001")
    step(client, sup, 150)
    for scenario in ("temperature_emergency", "injury", "damaged_pallet"):
        client.post("/api/sim/inject", json={"scenario": scenario}, headers=sup)
    step(client, sup, 200)
    issues = client.get("/api/issues", params={"limit": 500}, headers=qa).json()  # every critical issue
    critical = [i for i in issues if i["severity"] == "critical"]
    assert critical
    assert not [i for i in critical if i["status"] == "resolution_in_progress"]
    assert all(i["escalated_at"] for i in critical)
