"""Resolutions that fit the issue type, reasons for rejecting or overriding, the procedure's suggested
decision, withdrawn quick requests, the audit columns and filters of the issue log, Quality's
analytics, and a report filed once however often it is retried.
See docs/architecture/business-rules.md §3.4, §7.2, §7.6 and functional-specs §2.4, §2.7, §2.8."""

import asyncio
import csv
import io
from collections.abc import Callable

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import Settings
from app.db import Database, utcnow
from app.domain.enums import DockStatus, IssueStatus, Severity
from app.models import DockDoor, Issue
from tests.conftest import Headers, token_of

Login = Callable[[str], Headers]

# Seed facts (app/seed/data): OP-001 runs order 1 — outbound, dock 1 — in SUP-001's team with OP-002,
# who runs order 2 — inbound, dock 3. OP-003 is in SUP-002's team. QA-001 is Quality.
LEVELER = {"order_id": 1, "issue_type": "Equipment Failure", "issue_subtype": "Dock leveler not working"}
MINOR_DAMAGE = {  # receiving: a few damaged cases, no product named, so nothing scales it to critical
    "order_id": 2,
    "issue_type": "Damaged Pallet",
    "issue_subtype": "Damaged cartons or packaging",
    "description": "minor damage, a few dented cases",
}
WARM = {
    "order_id": 1,
    "issue_type": "Temperature Deviation",
    "issue_subtype": "Product temperature out of range",
    "product_id": 1,
    "company_id": 1,
    "carrier_id": 1,
    "quantity_affected": 6,
    "temp_reading": 2.0,
    "temp_threshold_max": 0.0,
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


# ── §7.6 Resolutions that fit the issue type ──


def test_the_taxonomy_lists_each_types_resolutions(client: TestClient, login: Login) -> None:
    taxonomy = client.get("/api/taxonomy", headers=login("OP-001")).json()
    by_name = {spec["name"]: spec for spec in taxonomy["issue_types"]}
    assert by_name["Equipment Failure"]["resolutions"] == [
        "Equipment Swapped",
        "Corrected and Continued",
        "Other",
    ]
    assert "Temp Re-check OK" in by_name["Temperature Deviation"]["resolutions"]
    assert taxonomy["noted_decisions"] == ["Full Reject", "Override — Accept Anyway"]


def test_a_resolution_that_does_not_fit_the_type_is_refused(client: TestClient, login: Login) -> None:
    op = login("OP-001")
    issue = file(client, op, LEVELER)
    url = f"/api/issues/{issue['id']}/self-resolve"
    refused = client.put(url, json={"resolution_type": "Temp Re-check OK"}, headers=op)
    assert refused.status_code == 422
    assert "Equipment Swapped" in refused.json()["detail"]  # the ones that fit are named
    assert client.get(f"/api/issues/{issue['id']}", headers=op).json()["status"] == "resolution_in_progress"
    assert client.put(url, json={"resolution_type": "Equipment Swapped"}, headers=op).status_code == 200


def test_self_resolving_someone_elses_issue_is_still_404(client: TestClient, login: Login) -> None:
    issue = file(client, login("OP-001"), LEVELER)
    response = client.put(
        f"/api/issues/{issue['id']}/self-resolve",
        json={"resolution_type": "Equipment Swapped"},
        headers=login("OP-003"),
    )
    assert response.status_code == 404


# ── §7.2 Full Reject and Override always carry a reason ──


def test_full_reject_and_override_need_a_reason_on_any_issue(client: TestClient, login: Login) -> None:
    op, sup = login("OP-001"), login("SUP-001")
    issue = file(client, op, LEVELER)
    assert issue["severity"] != "critical"
    for decision in ("Full Reject", "Override — Accept Anyway"):
        assert decide(client, sup, issue["id"], decision) == 422
        assert decide(client, sup, issue["id"], decision, "   ") == 422
    assert decide(client, sup, issue["id"], "Accept") == 200  # accepting a leveler fault needs none
    other = file(client, op, LEVELER)
    assert decide(client, sup, other["id"], "Override — Accept Anyway", "Leveler pinned, load is safe") == 200


# ── §3.4 The procedure's suggested decision ──


def test_the_procedure_suggests_a_decision_and_decides_nothing(client: TestClient, login: Login) -> None:
    op, sup = login("OP-002"), login("SUP-001")
    filed = file(client, op, MINOR_DAMAGE)
    procedure = filed["ai_resolution"]
    assert procedure["scenario"] == "Less than 5% of cases damaged"
    assert procedure["suggested_decision"] == "Partial Accept"
    stored = client.get(f"/api/issues/{filed['id']}", headers=sup).json()
    assert stored["ai_resolution"]["suggested_decision"] == "Partial Accept"
    # Advice only: nothing was decided for the supervisor.
    assert (stored["resolution_type"], stored["supervisor_id"]) == (None, None)


# ── Quick requests: the operator withdraws one ──


def test_the_operator_cancels_their_own_pending_request(client: TestClient, login: Login) -> None:
    op, sup = login("OP-001"), login("SUP-001")
    request = client.post("/api/requests", json={"request_type": "Cleanup Needed"}, headers=op).json()
    with client.websocket_connect("/ws", subprotocols=["dockiq", token_of(sup)]) as supervisor:
        cancelled = client.put(f"/api/requests/{request['id']}/cancel", headers=op)
        assert cancelled.status_code == 200, cancelled.text
        event = supervisor.receive_json()
    assert (event["type"], event["request_id"], event["status"]) == (
        "new_request",
        request["id"],
        "cancelled",
    )
    assert cancelled.json()["status"] == "cancelled"
    pending = client.get("/api/requests", params={"status": "pending"}, headers=sup).json()
    assert request["id"] not in {r["id"] for r in pending}
    mine = next(r for r in client.get("/api/requests/mine", headers=op).json() if r["id"] == request["id"])
    assert mine["status"] == "cancelled"
    assert mine["cancelled_at"] is not None
    # Withdrawn is final: neither cancelled again nor fulfilled.
    assert client.put(f"/api/requests/{request['id']}/cancel", headers=op).status_code == 409
    assert client.put(f"/api/requests/{request['id']}/fulfill", headers=sup).status_code == 409
    draft = client.get("/api/shift-handoffs/draft", headers=sup).json()
    assert request["id"] not in {r["id"] for r in draft["pending_requests"]}


def test_only_the_operator_who_asked_can_cancel(client: TestClient, login: Login) -> None:
    op, sup = login("OP-001"), login("SUP-001")
    request = client.post("/api/requests", json={"request_type": "Cleanup Needed"}, headers=op).json()
    assert client.put(f"/api/requests/{request['id']}/cancel", headers=login("OP-002")).status_code == 404
    assert client.put(f"/api/requests/{request['id']}/cancel", headers=sup).status_code == 403
    assert client.put("/api/requests/99999/cancel", headers=op).status_code == 404
    assert client.put(f"/api/requests/{request['id']}/fulfill", headers=sup).status_code == 200
    assert client.put(f"/api/requests/{request['id']}/cancel", headers=op).status_code == 409


# ── The issue log's audit trail ──


def test_the_log_says_who_decided_and_filters_by_type_and_disposition(
    client: TestClient, login: Login
) -> None:
    op, sup, qa = login("OP-001"), login("SUP-001"), login("QA-001")
    closed = file(client, op, LEVELER)
    client.put(
        f"/api/issues/{closed['id']}/self-resolve", json={"resolution_type": "Equipment Swapped"}, headers=op
    )
    decided = file(client, op, LEVELER)
    assert decide(client, sup, decided["id"], "Full Reject", "Leveler failed twice") == 200
    warm = file(client, op, WARM)
    disposed = client.put(
        f"/api/issues/{warm['id']}/disposition",
        json={"disposition": "destroy", "notes": "Thawed"},
        headers=qa,
    )
    assert disposed.status_code == 200, disposed.text

    by_id = {i["id"]: i for i in client.get("/api/issues", params={"limit": 500}, headers=sup).json()}
    assert by_id[closed["id"]]["decided_by_name"] == "Mike Johnson"
    assert (by_id[decided["id"]]["decided_by_name"], by_id[decided["id"]]["resolution_type"]) == (
        "Sarah Mitchell",
        "Full Reject",
    )
    assert by_id[warm["id"]]["decided_by_name"] is None  # Quality's call is the disposition, not a decision

    destroyed = client.get("/api/issues", params={"disposition": "destroy"}, headers=sup).json()
    assert [i["id"] for i in destroyed] == [warm["id"]]
    typed = client.get("/api/issues", params={"issue_type": "Equipment Failure"}, headers=sup).json()
    assert {closed["id"], decided["id"]} <= {i["id"] for i in typed}
    assert {i["issue_type"] for i in typed} == {"Equipment Failure"}
    assert client.get("/api/issues", params={"disposition": "burn"}, headers=sup).status_code == 422

    rows = list(
        csv.DictReader(
            io.StringIO(
                client.get("/api/issues/export.csv", params={"disposition": "destroy"}, headers=sup).text
            )
        )
    )
    assert [(r["id"], r["disposition"], r["disposition_notes"]) for r in rows] == [
        (str(warm["id"]), "destroy", "Thawed")
    ]
    exported = csv.DictReader(
        io.StringIO(
            client.get("/api/issues/export.csv", params={"issue_type": "Equipment Failure"}, headers=sup).text
        )
    )
    decided_row = next(r for r in exported if r["id"] == str(decided["id"]))
    assert (decided_row["decided_by_name"], decided_row["supervisor_notes"]) == (
        "Sarah Mitchell",
        "Leveler failed twice",
    )


# ── §2.8 Quality's analytics ──


async def _room_alarm(settings: Settings) -> None:
    database = Database(settings)
    try:
        async with database.sessionmaker() as session:
            session.add(
                Issue(
                    issue_type="Temperature Deviation",
                    issue_subtype="Freezer door left open too long",
                    severity=Severity.CRITICAL,
                    status=IssueStatus.ESCALATED,
                    room="F",
                    quick_tags=[],
                    recurring_patterns=[],
                    held_pallets=["LP-000001", "LP-000002"],
                    estimated_cost_impact=0,
                    created_at=utcnow(),
                )
            )
            await session.commit()
    finally:
        await database.dispose()


def test_quality_sees_disposition_timing_holds_and_excursions(
    client: TestClient, seeded_db: Settings, login: Login
) -> None:
    op, qa, sup = login("OP-001"), login("QA-001"), login("SUP-001")
    before = client.get("/api/analytics/summary", headers=qa).json()["quality"]
    asyncio.run(_room_alarm(seeded_db))
    warm = file(client, op, WARM)
    client.put(
        f"/api/issues/{warm['id']}/disposition",
        json={"disposition": "release", "notes": "Re-probed"},
        headers=qa,
    )

    summary = client.get("/api/analytics/summary", headers=qa).json()
    assert summary["scope"] == "quality"
    quality = summary["quality"]
    assert quality["disposed"] == before["disposed"] + 1
    assert quality["avg_minutes_to_disposition"] is not None
    released = {row["disposition"]: row["count"] for row in quality["by_disposition"]}["release"]
    assert (
        released
        == {row["disposition"]: row["count"] for row in before["by_disposition"]}.get("release", 0) + 1
    )
    assert quality["pallets_on_hold"] == before["pallets_on_hold"] + 2
    assert quality["issues_on_hold"] == before["issues_on_hold"] + 1
    rooms = {row["room"]: row["count"] for row in quality["excursions_by_room"]}
    assert rooms["F"] == {row["room"]: row["count"] for row in before["excursions_by_room"]}.get("F", 0) + 1

    team = client.get("/api/analytics/summary", headers=sup).json()
    assert team["quality"] is None  # a supervisor's analytics stay the team's
    assert all("carrier_id" in row for row in team["by_carrier"])  # for the drill-down to the log
    assert client.get("/api/analytics/summary", headers=op).status_code == 403


# ── A report retried from the offline queue is filed once ──


def test_a_retried_report_is_filed_once(client: TestClient, login: Login) -> None:
    op, sup = login("OP-001"), login("SUP-001")
    body = {**LEVELER, "client_key": "5f0c2a8e-3c1d-4b7e-9f4a-2d6e8b1c0a93"}
    first = file(client, op, body)
    again = file(client, op, body)
    assert again["id"] == first["id"]
    assert again["severity"] == first["severity"]
    listed = client.get("/api/issues", params={"issue_type": "Equipment Failure"}, headers=sup).json()
    assert [i["id"] for i in listed].count(first["id"]) == 1
    assert len([i for i in listed if i["issue_subtype"] == "Dock leveler not working"]) == 1
    # A new key is a new report.
    assert (
        file(client, op, {**LEVELER, "client_key": "0b9d7c2e-1111-4a2b-8c3d-000000000001"})["id"]
        != first["id"]
    )


def test_a_report_key_is_the_reporters_own(client: TestClient, login: Login) -> None:
    key = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d"
    file(client, login("OP-001"), {**LEVELER, "client_key": key})
    other = client.post(
        "/api/issues",
        json={"issue_type": "Safety Incident", "issue_subtype": "Near miss", "client_key": key},
        headers=login("OP-003"),
    )
    assert other.status_code == 409
    for bad in ("short", "has spaces in it!", "x" * 65):
        response = client.post("/api/issues", json={**LEVELER, "client_key": bad}, headers=login("OP-001"))
        assert response.status_code == 422, bad


# ── §7.7 The door shows everything still open on it ──

CRUSHED = {  # critical on order 1 at dock 1 (tests/test_api_issues.py)
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


def door(client: TestClient, headers: Headers, dock_id: int) -> str:
    return client.get(f"/api/docks/{dock_id}", headers=headers).json()["status"]


def test_a_critical_door_stays_critical_until_its_critical_issue_is_decided(
    client: TestClient, login: Login
) -> None:
    op, sup = login("OP-001"), login("SUP-001")
    critical = file(client, op, CRUSHED)
    assert (critical["severity"], door(client, op, 1)) == ("critical", "critical")
    lesser = file(client, op, LEVELER)
    assert lesser["severity"] != "critical"
    assert door(client, op, 1) == "critical"  # a later, lesser report never downgrades the door
    resolved = client.put(
        f"/api/issues/{lesser['id']}/self-resolve", json={"resolution_type": "Equipment Swapped"}, headers=op
    )
    assert resolved.status_code == 200
    assert door(client, op, 1) == "critical"  # the critical one is still open
    assert decide(client, sup, critical["id"], "Partial Accept", "3 cases out, rest sound") == 200
    assert door(client, op, 1) == "active"


def test_resolving_one_issue_leaves_the_door_flagged_while_another_is_open(
    client: TestClient, login: Login
) -> None:
    op = login("OP-001")
    first, second = file(client, op, LEVELER), file(client, op, LEVELER)
    assert door(client, op, 1) == "issue"
    url = "/api/issues/{}/self-resolve"
    body = {"resolution_type": "Equipment Swapped"}
    assert client.put(url.format(first["id"]), json=body, headers=op).status_code == 200
    assert door(client, op, 1) == "issue"
    assert client.put(url.format(second["id"]), json=body, headers=op).status_code == 200
    assert door(client, op, 1) == "active"


async def _stale_doors(settings: Settings, door_numbers: list[int]) -> None:
    database = Database(settings)
    try:
        async with database.sessionmaker() as session:
            for dock in await session.scalars(select(DockDoor).where(DockDoor.door_number.in_(door_numbers))):
                dock.status = DockStatus.CRITICAL  # what an old reset left behind
            await session.commit()
    finally:
        await database.dispose()


def test_a_simulator_reset_recomputes_every_door(
    client: TestClient, seeded_db: Settings, login: Login
) -> None:
    op, sup = login("OP-001"), login("SUP-001")
    file(client, op, CRUSHED)  # a person's critical report on a seeded (not simulated) order
    docks = client.get("/api/docks", headers=sup).json()
    asyncio.run(_stale_doors(seeded_db, [d["door_number"] for d in docks]))
    assert client.post("/api/sim/reset", json={}, headers=sup).status_code == 200

    after = {d["door_number"]: d for d in client.get("/api/docks", headers=sup).json()}
    assert after[1]["status"] == "critical"  # the person's report is not the simulator's to clear
    for number, dock in after.items():
        if dock["open_issues"] == 0:  # nothing open: at rest, or active while a trailer is worked
            expected = "idle" if dock["current_order_id"] is None else "active"
            assert dock["status"] == expected, number
        else:
            assert dock["status"] in ("issue", "critical"), number
    assert any(d["status"] != "critical" for d in after.values())  # every door was left critical
