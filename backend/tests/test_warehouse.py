"""The warehouse behind the simulated WMS: stock ledger, inbound, outbound, the task queue.
See docs/architecture/business-rules.md §12.7–§12.10."""

import asyncio
import re
from collections import Counter
from collections.abc import Callable
from datetime import date
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import Base, Database
from app.domain.enums import MovementKind, TaskKind, TaskStatus
from app.models import SimEvent, WmsShipment, WmsStock, WmsTask, WmsTransaction, WmsYardEvent
from app.wms import layout, rooms, warehouse
from app.wms.clock import SHIFT_MINUTES
from app.wms.engine import WAREHOUSE_FOLLOW_UP_MINUTES
from app.wms.plan import (
    OPENING_PALLETS,
    OPENING_SERIALS,
    Appointment,
    PlannedException,
    ProductRef,
    inventory,
)
from app.wms.warehouse import (
    StockLine,
    Trailer,
    Warehouse,
    inbound_pallets,
    task_minutes,
    wave_of,
)
from tests.conftest import token_of

Login = Callable[[str], dict[str, str]]

FROZEN = ProductRef("FZ-1", "Frozen peas", "Frozen", 60, 0.0)
PRODUCTS = {FROZEN.sku: FROZEN}
FACE = "F-10-B01-1"  # the only frozen SKU's pick face


def appointment(**overrides: Any) -> Appointment:
    fields: dict[str, Any] = {
        "key": "s0-d4-1",
        "shift": 0,
        "door": 4,
        "type": "outbound",
        "customer": "North Market",
        "carrier": "FRZX",
        "order_number": "SIM-1-001",
        "trailer": "TRL-FR-1000",
        "bol": "BOL-1",
        "seal": "SL-1",
        "scheduled": 120.0,
        "arrival": 120.0,
        "reefer_setpoint": -5.0,
        "yard_spot": "Y-01",
        "inspection_minutes": 5.0,
        "lines": (("FZ-1", 100),),
        "pallets": 2,
        "exception": None,
    }
    return Appointment(**(fields | overrides))


# ── Pinned numbers (business-rules §12.7–§12.10) ──


def test_layout_and_opening_stock_are_pinned() -> None:
    # see docs/architecture/business-rules.md §12.7
    assert layout.ROOMS == ("F", "C", "P", "D")
    assert (tuple(range(10, 18)), 12, 4, 1) == (layout.AISLES, layout.BAYS, layout.LEVELS, layout.PICK_LEVEL)
    assert len(layout.reserve_slots("F")) == 288
    assert OPENING_PALLETS == (6, 10)
    assert OPENING_SERIALS == 1_000_000


def test_flow_and_task_numbers_are_pinned() -> None:
    # see docs/architecture/business-rules.md §12.8, §12.9, §12.10
    assert warehouse.ASN_LEAD_MINUTES == 120.0
    assert warehouse.REEFER_READING_SPREAD == 1.5
    assert (warehouse.WAVE_INTERVAL_MINUTES, warehouse.WAVE_LEAD_MINUTES) == (30.0, 60.0)
    assert warehouse.REPLENISH_BELOW == 0.25
    assert warehouse.STANDARD_MINUTES == {
        TaskKind.PUTAWAY: 3.0,
        TaskKind.PICK: 2.5,
        TaskKind.REPLENISH: 3.0,
        TaskKind.CYCLE_COUNT: 4.0,
    }
    assert warehouse.CASE_PICK_MINUTES == (1.5, 0.05)
    assert warehouse.ROOM_FACTOR == {"F": 1.3, "C": 1.1, "P": 1.1, "D": 1.0}
    assert warehouse.CREW_FACTOR == {"senior": 0.85, "experienced": 1.0, "new": 1.2}
    assert warehouse.CYCLE_COUNT_EVERY == 30.0
    assert [(m.code, m.experience) for m in warehouse.CREW] == [
        ("WH-01", "senior"),
        ("WH-02", "experienced"),
        ("WH-03", "experienced"),
        ("WH-04", "new"),
    ]


# ── Pure rules ──


def test_opening_stock_puts_the_earliest_pallet_on_the_pick_face() -> None:
    records = inventory(3, [FROZEN])
    assert OPENING_PALLETS[0] <= len(records) <= OPENING_PALLETS[1]
    assert records[0].location == FACE
    assert all(layout.slot_of(r.location) and r.location[0] == "F" for r in records)
    assert len({r.location for r in records}) == len(records)
    assert [r.best_before for r in records] == sorted(r.best_before for r in records)


def test_put_away_goes_to_the_nearest_free_reserve_slot() -> None:
    face = layout.Slot("F", 12, 4, 1)
    assert layout.nearest_free(face, set()) == "F-12-B04-2"
    assert layout.nearest_free(face, {"F-12-B04-2", "F-12-B04-3", "F-12-B04-4"}) == "F-12-B03-2"
    everything = {slot.code for slot in layout.reserve_slots("F")}
    assert layout.nearest_free(face, everything) == "F-OVF"


def test_waves_release_sixty_to_ninety_minutes_ahead() -> None:
    assert wave_of(appointment(scheduled=120.0)) == (2, 60.0)
    assert wave_of(appointment(scheduled=149.0)) == (2, 60.0)  # 89 minutes of lead
    assert wave_of(appointment(scheduled=30.0)) == (0, 0.0)  # never before the shift starts
    assert wave_of(appointment(shift=1, scheduled=SHIFT_MINUTES + 200.0)) == (4, SHIFT_MINUTES + 120.0)


def test_inbound_pallets_arrive_short_and_put_damage_on_hold() -> None:
    assert inbound_pallets(appointment(lines=(("FZ-1", 130),)), PRODUCTS) == (
        [("FZ-1", 60)] * 2 + [("FZ-1", 10)],
        None,
    )
    short = PlannedException(
        0.5, "Count Discrepancy", "Short count", "", "FZ-1", 10, count_expected=130, count_actual=120
    )
    assert inbound_pallets(appointment(lines=(("FZ-1", 130),), exception=short), PRODUCTS) == (
        [("FZ-1", 60)] * 2,
        None,
    )
    damage = PlannedException(0.5, "Damaged Pallet", "Crushed or collapsed pallet", "", "FZ-1", 5)
    assert inbound_pallets(appointment(lines=(("FZ-1", 130),), exception=damage), PRODUCTS) == (
        [("FZ-1", 60), ("FZ-1", 60), ("FZ-1", 5)],
        ("FZ-1", 5),
    )


def test_task_times_scale_with_the_room_and_the_crew() -> None:
    assert task_minutes(TaskKind.PUTAWAY, 60, True, "D", "experienced") == 3.0
    assert task_minutes(TaskKind.PUTAWAY, 60, True, "F", "experienced") == 3.0 * 1.3
    assert task_minutes(TaskKind.PICK, 20, False, "D", "senior") == (1.5 + 0.05 * 20) * 0.85


def test_waves_allocate_first_expiring_first_and_replenish_the_pick_face() -> None:
    stock = [
        StockLine("A", "FZ-1", "L1", date(2026, 12, 1), FACE, 20),
        StockLine("B", "FZ-1", "L2", date(2026, 11, 1), "F-10-B01-2", 60),
        StockLine("C", "FZ-1", "L3", date(2027, 1, 1), "F-10-B01-3", 60),
        StockLine("D", "FZ-1", "L4", date(2027, 2, 1), "F-10-B01-4", 60),
    ]
    house = Warehouse(1, -1.0, OPENING_SERIALS, PRODUCTS, stock)
    house.run([Trailer(appointment())], until=61.0)
    picks = [(t.lpn, t.cases) for t in house.tasks.values() if t.kind is TaskKind.PICK]
    assert picks == [("B", 60), ("A", 20), ("C", 20)]
    shipment = house.shipments["s0-d4-1"]
    assert (shipment.wave, shipment.lines[0].allocated) == ("W1-03", 100)
    replenish = [t for t in house.tasks.values() if t.kind is TaskKind.REPLENISH]
    assert [(t.lpn, t.from_location, t.to_location) for t in replenish] == [("D", "F-10-B01-4", FACE)]


def test_a_load_is_short_when_the_stock_runs_out() -> None:
    house = Warehouse(
        1, -1.0, OPENING_SERIALS, PRODUCTS, [StockLine("B", "FZ-1", "L2", date(2026, 11, 1), FACE, 40)]
    )
    house.run([Trailer(appointment())], until=61.0)
    assert house.shipments["s0-d4-1"].lines[0].allocated == 40


# ── Through the API ──


def step(client: TestClient, headers: dict[str, str], minutes: float) -> None:
    response = client.post("/api/sim/step", json={"minutes": minutes}, headers=headers)
    assert response.status_code == 200, response.text


def read[M: Base](client: TestClient, model: type[M]) -> list[M]:
    async def fetch() -> list[M]:
        database = Database(client.app.state.settings)  # type: ignore[attr-defined]
        try:
            async with database.sessionmaker() as session:
                return list(await session.scalars(select(model).order_by(model.id)))  # type: ignore[attr-defined]
        finally:
            await database.dispose()

    return asyncio.run(fetch())


def test_the_ledger_opens_with_the_stock_received_and_put_away(client: TestClient, login: Login) -> None:
    sup = login("SUP-001")
    ledger = client.get("/api/wms/transactions?limit=200", headers=sup)
    assert ledger.status_code == 200, ledger.text
    entries = ledger.json()
    assert entries
    assert all(e["minute"] == 0 and e["actor"] == "system" and e["simulated"] for e in entries)
    assert {e["kind"] for e in entries} == {"receive", "putaway"}
    assert entries == sorted(entries, key=lambda e: -e["id"])  # newest first
    older = client.get(f"/api/wms/transactions?limit=5&before_id={entries[-1]['id']}", headers=sup).json()
    assert older
    assert all(e["id"] < entries[-1]["id"] for e in older)


def test_on_hand_always_equals_the_sum_of_the_movements(client: TestClient, login: Login) -> None:
    sup = login("SUP-001")
    for minutes in (0.5, 150, 330):
        step(client, sup, minutes)
        balance: Counter[tuple[str, str]] = Counter()
        for movement in read(client, WmsTransaction):
            if movement.from_location:
                balance[(movement.lpn, movement.from_location)] -= movement.cases
            if movement.to_location:
                balance[(movement.lpn, movement.to_location)] += movement.cases
        on_hand = {(row.lpn, row.location): row.cases for row in read(client, WmsStock)}
        assert on_hand == {key: cases for key, cases in balance.items() if cases}


def test_inbound_asn_gate_receipt_and_put_away(client: TestClient, login: Login) -> None:
    sup = login("SUP-001")
    step(client, sup, 300)
    received = [
        s
        for s in client.get("/api/wms/shipments?direction=inbound&limit=100", headers=sup).json()
        if s["status"] == "received"
    ]
    assert received
    shipment = received[0]
    assert shipment["confirmation"] == "RC-" + shipment["order_number"].removeprefix("SIM-")
    assert 0 < shipment["cases_done"] <= shipment["cases_expected"]
    gate_in = next(e for e in read(client, WmsYardEvent) if e.ref == shipment["ref"] and e.kind == "gate_in")
    assert gate_in.seal
    assert gate_in.yard_spot

    rooms = {p["sku"]: p["category"] for p in client.get("/api/products", headers=sup).json()}
    zone = {"Frozen": "F", "Refrigerated": "C", "Produce": "P", "Dry": "D"}
    receipts = [m for m in read(client, WmsTransaction) if m.ref == shipment["ref"] and m.kind == "receive"]
    assert sum(m.cases for m in receipts) == shipment["cases_done"]
    ledger = read(client, WmsTransaction)
    put_away = [r for r in receipts if sum(m.lpn == r.lpn for m in ledger) > 1]
    assert put_away
    for receipt in put_away:
        moves = [m for m in ledger if m.lpn == receipt.lpn]
        assert [m.kind for m in moves][:2] == [MovementKind.RECEIVE, MovementKind.PUTAWAY]
        assert moves[1].from_location
        assert moves[1].from_location.startswith("DOCK-")
        assert moves[1].to_location
        assert moves[1].to_location[0] == zone[rooms[receipt.sku]]
        assert moves[1].actor.startswith("WH-")


def test_outbound_wave_pick_stage_load_and_ship(client: TestClient, login: Login) -> None:
    sup = login("SUP-001")
    step(client, sup, 300)
    shipped = [
        s
        for s in client.get("/api/wms/shipments?direction=outbound&limit=100", headers=sup).json()
        if s["status"] == "shipped"
    ]
    assert shipped
    shipment = shipped[0]
    assert shipment["wave"]
    assert shipment["seal"]
    assert shipment["confirmation"] == "SC-" + shipment["order_number"].removeprefix("SIM-")
    assert client.get(f"/api/wms/shipments/{shipment['order_number']}", headers=sup).json() == shipment
    moves = [m for m in read(client, WmsTransaction) if m.ref == shipment["ref"]]
    kinds = Counter(m.kind.value for m in moves)
    assert kinds["pick"] == kinds["load"] == kinds["ship"] > 0
    assert sum(m.cases for m in moves if m.kind == "ship") == shipment["cases_done"]
    for pick in (m for m in moves if m.kind == "pick"):
        assert pick.to_location == f"STAGE-{shipment['door']:02d}"
    gate_out = next(
        e for e in read(client, WmsYardEvent) if e.ref == shipment["ref"] and e.kind == "gate_out"
    )
    assert gate_out.seal == shipment["seal"]


def test_task_queue_and_crew_productivity(client: TestClient, login: Login) -> None:
    sup = login("SUP-001")
    step(client, sup, 240)
    tasks = client.get("/api/wms/tasks?limit=200", headers=sup).json()
    assert {t["kind"] for t in tasks} >= {"putaway", "pick", "replenish", "cycle_count"}
    assert all(t["assignee"].startswith("WH-") and t["simulated"] for t in tasks)
    done = client.get("/api/wms/tasks?status=done&kind=putaway&limit=5", headers=sup).json()
    assert done
    assert all(t["status"] == "done" and t["kind"] == "putaway" for t in done)
    for task in read(client, WmsTask):
        assert task.created_minute <= task.assigned_minute < task.done_minute
    crew = client.get("/api/wms/productivity", headers=sup).json()
    warehouse_crew = [row for row in crew if row["role"] == "warehouse"]
    assert [row["code"] for row in warehouse_crew] == ["WH-01", "WH-02", "WH-03", "WH-04"]
    assert all(row["tasks_per_hour"] > 0 and 0 < row["busy_percent"] <= 100 for row in warehouse_crew)
    assert any(row["role"] == "dock" and row["cases"] > 0 for row in crew)


def ledger_dump(client: TestClient) -> list[tuple[object, ...]]:
    return [
        *[
            (m.key, m.kind, round(m.minute, 6), m.lpn, m.from_location, m.to_location, m.cases, m.actor)
            for m in sorted(read(client, WmsTransaction), key=lambda m: m.key)
        ],
        *[
            (t.key, t.status, t.assignee, round(t.done_minute, 6), t.to_location, t.cases, t.cleared_minute)
            for t in sorted(read(client, WmsTask), key=lambda t: t.key)
        ],
        *[
            (s.key, s.status, s.wave, s.pallets, str(s.lines))
            for s in sorted(read(client, WmsShipment), key=lambda s: s.key)
        ],
        *[
            (e.key, round(e.minute, 6), e.reefer_temp)
            for e in sorted(read(client, WmsYardEvent), key=lambda e: e.key)
        ],
        *[  # the problems the warehouse found and filed, and their follow-ups
            (e.key, e.kind, round(e.minute, 6), re.sub(r"#\d+", "#", e.message))  # ids differ after a reset
            for e in sorted(read(client, SimEvent), key=lambda e: e.key)
            if e.kind in ("stock_exception", "room_excursion") or e.key.endswith(":fu")
        ],
    ]


def test_one_jump_and_many_small_steps_write_the_same_ledger(client: TestClient, login: Login) -> None:
    sup = login("SUP-001")
    step(client, sup, 250)
    coarse = ledger_dump(client)
    assert client.post("/api/sim/reset", json={"seed": 42}, headers=sup).status_code == 200
    for _ in range(35):
        step(client, sup, 7)
    step(client, sup, 5)
    assert ledger_dump(client) == coarse


def test_every_warehouse_change_reaches_the_floor(client: TestClient, login: Login) -> None:
    sup = login("SUP-001")
    with client.websocket_connect("/ws", subprotocols=["dockiq", token_of(sup)]) as socket:
        assert client.get("/api/wms/stock?limit=1", headers=sup).status_code == 200  # opens the ledger
        assert socket.receive_json() == {"type": "floor_update"}


def test_operators_read_stock_but_not_the_warehouse_back_office(client: TestClient, login: Login) -> None:
    op = login("OP-001")
    stock = client.get("/api/wms/stock?room=F&limit=10", headers=op)
    assert stock.status_code == 200
    assert stock.json()
    assert all(row["room"] == "F" and row["simulated"] for row in stock.json())
    first = client.get("/api/wms/stock?limit=500", headers=op).json()
    assert [r["best_before"] for r in first] == sorted(r["best_before"] for r in first)
    for path in ("tasks", "productivity", "transactions", "shipments", "shipments/SIM-1-001"):
        assert client.get(f"/api/wms/{path}", headers=op).status_code == 403


def test_warehouse_endpoints_validate_and_404(client: TestClient, login: Login) -> None:
    sup = login("SUP-001")
    for path in (
        "stock?limit=0",
        "stock?limit=501",
        "stock?room=X",
        "tasks?status=lost",
        "tasks?kind=dance",
        "tasks?limit=201",
        "transactions?limit=0",
        "transactions?before_id=0",
        "shipments?direction=sideways",
        "shipments?limit=101",
    ):
        assert client.get(f"/api/wms/{path}", headers=sup).status_code == 422, path
    assert client.get("/api/wms/shipments/SIM-9-999", headers=sup).status_code == 404
    assert client.get("/api/wms/tasks?status=open", headers=sup).status_code == 200
    assert client.get("/api/wms/productivity", headers=sup).status_code == 200


def test_the_warehouse_is_offline_with_the_wms(client: TestClient, login: Login) -> None:
    sup = login("SUP-001")
    assert client.post("/api/sim/inject", json={"scenario": "wms_outage"}, headers=sup).status_code == 200
    for path in ("stock", "tasks", "productivity", "transactions", "shipments"):
        assert client.get(f"/api/wms/{path}", headers=sup).status_code == 503, path


def test_reset_empties_the_warehouse_and_reopens_it(client: TestClient, login: Login) -> None:
    sup = login("SUP-001")
    step(client, sup, 120)
    assert client.post("/api/sim/reset", json={"seed": 7}, headers=sup).status_code == 200
    assert not read(client, WmsTask)
    assert not read(client, WmsShipment)
    entries = client.get("/api/wms/transactions?limit=3", headers=sup).json()
    assert entries
    assert all(e["minute"] == 0 and e["pallet_id"].startswith("00286007") for e in entries)


# ── Pass 2: the gate, cold rooms and organic exceptions (business-rules §12.11–§12.13) ──


def test_cold_room_and_exception_numbers_are_pinned() -> None:
    # see docs/architecture/business-rules.md §12.12 and §12.13
    assert (rooms.SAMPLE_EVERY, rooms.READING_NOISE, rooms.ALARM_AFTER) == (
        5.0,
        0.8,
        15.0,
    )
    assert rooms.CLIMATE == {
        "F": (-10.0, 0.0),
        "C": (34.0, 40.0),
        "P": (38.0, 45.0),
        "D": (65.0, 80.0),
    }
    assert rooms.EXCURSION_CHANCE == {"F": 0.25, "C": 0.25, "P": 0.2, "D": 0.0}
    assert (
        rooms.EXCURSION_WINDOW,
        rooms.EXCURSION_OVER,
        rooms.EXCURSION_RAMP,
        rooms.EXCURSION_HOLD,
    ) == (
        (60.0, 400.0),
        (3.0, 9.0),
        10.0,
        (10.0, 40.0),
    )
    assert (warehouse.SHORT_PICK_CHANCE, warehouse.SHORT_PICK_MAX) == (0.02, 6)
    assert warehouse.NOT_AT_LOCATION_CHANCE == 0.01
    assert (warehouse.RECEIVING_DAMAGE_CHANCE, warehouse.DAMAGED_CASES_MAX) == (0.02, 6)
    assert (warehouse.COUNT_VARIANCE_CHANCE, warehouse.COUNT_VARIANCE_MAX) == (0.05, 4)
    assert WAREHOUSE_FOLLOW_UP_MINUTES == 8.0


def test_room_readings_hold_the_set_point_until_an_excursion_raises_the_alarm() -> None:
    assert rooms.reading(42, "F", 100.0) == rooms.reading(42, "F", 100.0)
    for room, (setpoint, _) in rooms.CLIMATE.items():
        episode = rooms.excursion(9, room, 0)
        quiet = [
            rooms.reading(9, room, float(m))
            for m in range(0, SHIFT_MINUTES, 5)
            if episode is None or not episode.start <= m <= episode.end
        ]
        assert all(abs(t - setpoint) <= rooms.READING_NOISE + 0.05 for t in quiet)
    alarms = [e for seed in range(30) for room in "FCP" if (e := rooms.excursion(seed, room, 0))]
    assert alarms
    for found in alarms:
        assert found.alarm_at is not None
        _, limit = rooms.CLIMATE[found.room]
        over = [found.alarm_at - n * rooms.SAMPLE_EVERY for n in range(int(rooms.ALARM_AFTER // 5) + 1)]
        seed = next(s for s in range(30) if rooms.excursion(s, found.room, 0) == found)
        assert all(rooms.reading(seed, found.room, m) > limit for m in over)
    assert rooms.excursion(1, "D", 0) is None  # the dry room is monitored but never alarms


def outbound_house() -> Warehouse:
    stock = [
        StockLine("B", "FZ-1", "L2", date(2026, 11, 1), "F-10-B01-2", 60),
        StockLine("C", "FZ-1", "L3", date(2027, 1, 1), "F-10-B01-3", 60),
        StockLine("D", "FZ-1", "L4", date(2027, 2, 1), "F-10-B01-4", 60),
    ]
    return Warehouse(1, -1.0, OPENING_SERIALS, PRODUCTS, stock)


def test_a_short_pick_writes_off_the_difference_and_allocates_again(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(warehouse, "SHORT_PICK_CHANCE", 1.0)
    house = outbound_house()
    house.run([Trailer(appointment(lines=(("FZ-1", 60),)))], until=90.0)
    adjust = [m for m in house.movements if m.kind is MovementKind.ADJUST]
    assert adjust
    assert adjust[0].lpn == "B"
    assert adjust[0].to_location is None
    picks = [t for t in house.tasks.values() if t.kind is TaskKind.PICK]
    assert len(picks) >= 2  # the missing cases were allocated again, from the next pallet
    assert picks[1].lpn == "D"  # C, the next to expire, is already on its way to the empty pick face
    issue = house.issues[0]
    assert (issue.issue_type, issue.subtype, issue.sku) == (
        "Count Discrepancy",
        "Short count",
        "FZ-1",
    )
    assert issue.count_expected == 60
    assert issue.count_actual == 60 - adjust[0].cases


def test_a_pallet_not_at_its_location_is_written_off_and_recounted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(warehouse, "NOT_AT_LOCATION_CHANCE", 1.0)
    house = outbound_house()
    house.run([Trailer(appointment(lines=(("FZ-1", 60),)))], until=70.0)
    first = house.tasks["s0-d4-1:pick:B"]
    assert (first.status, first.note) == (
        TaskStatus.CANCELLED,
        "Pallet not at location",
    )
    assert ("B", "F-10-B01-2") not in house.stock
    assert "s0-d4-1:pick:B:recount" in house.tasks
    again = [t for t in house.tasks.values() if t.kind is TaskKind.PICK and t.lpn != "B"]
    assert again  # the line was allocated again from what is left
    assert house.issues[0].subtype == "WMS shows a different location"


def test_receiving_damage_goes_on_quality_hold(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(warehouse, "RECEIVING_DAMAGE_CHANCE", 1.0)
    inbound = appointment(type="inbound", lines=(("FZ-1", 60),), pallets=1)
    house = Warehouse(1, -1.0, OPENING_SERIALS, PRODUCTS)
    trailer = Trailer(
        inbound,
        at_door=125.0,
        door=4,
        work_start=130.0,
        work_minutes=4.0,
        operator="OP-009",
    )
    house.run([trailer], 200.0)
    held = [line for line in house.stock.values() if line.location == "F-HOLD"]
    stored = [line for line in house.stock.values() if layout.area_of(line.location) is layout.Area.STORAGE]
    assert held
    assert sum(line.cases for line in held + stored) == 60
    assert house.issues[0].issue_type == "Damaged Pallet"


def test_the_gate_log_records_check_in_yard_moves_and_check_out(client: TestClient, login: Login) -> None:
    sup = login("SUP-001")
    step(client, sup, 300)
    log = client.get("/api/wms/gate?limit=200", headers=sup)
    assert log.status_code == 200, log.text
    events = log.json()
    assert {e["kind"] for e in events} == {"gate_in", "yard_move", "gate_out"}
    assert [e["minute"] for e in events] == sorted((e["minute"] for e in events), reverse=True)
    for event in events:
        assert event["simulated"]
        if event["kind"] == "gate_out":
            assert event["detention"] == (event["dwell_minutes"] > 120)
        if event["kind"] == "yard_move":
            assert event["door"] is not None
            assert event["yard_spot"]
    assert client.get("/api/wms/gate?limit=0", headers=sup).status_code == 422
    assert client.get("/api/wms/gate", headers=login("OP-001")).status_code == 403


def test_a_room_excursion_is_filed_once_as_a_cold_chain_issue(client: TestClient, login: Login) -> None:
    sup, qa = login("SUP-001"), login("QA-001")
    produce = rooms.excursion(42, "P", 0)  # the seeded run: the produce room alarms in shift 1
    assert produce is not None
    assert produce.alarm_at is not None
    step(client, sup, produce.alarm_at + 1)
    room = next(r for r in client.get("/api/wms/rooms?readings=4", headers=sup).json() if r["code"] == "P")
    assert room["alarm"]
    assert len(room["readings"]) == 4
    assert room["simulated"]
    step(client, sup, 120)
    filed = [
        i
        for i in client.get("/api/issues?limit=200", headers=qa).json()
        if i["simulated"]
        and i["issue_type"] == "Temperature Deviation"
        and "Produce" in (i["description"] or "")
    ]
    assert len(filed) == 1
    # A whole room over its limit for the alarm's 15 minutes is critical (business-rules §1.10).
    assert filed[0]["severity"] == "critical"
    assert filed[0]["status"] == "escalated"
    assert filed[0]["dock_door_id"] is None
    assert client.get("/api/wms/rooms?readings=97", headers=sup).status_code == 422


def test_rooms_report_occupancy(client: TestClient, login: Login) -> None:
    sup = login("SUP-001")
    found = client.get("/api/wms/rooms", headers=sup).json()
    assert [r["code"] for r in found] == ["F", "C", "P", "D"]
    for room in found:
        assert room["slots"] == 384
        assert 0 < room["occupied"] <= room["slots"]
        assert room["pallets"] > 0
        assert room["cases"] > 0
    assert client.get("/api/wms/rooms", headers=login("OP-001")).status_code == 403


# ── Quality hold and disposition (business-rules §7.3) ──


def test_a_hold_takes_named_plates_the_same_lot_or_a_rooms_exposed_stock() -> None:
    from app.wms.warehouse import select_for_hold

    chilled = ProductRef("DR-1", "Yogurt", "Refrigerated", 80, 38.0)
    products = {FROZEN.sku: FROZEN, chilled.sku: chilled}
    stock = [
        StockLine("A", "FZ-1", "L1", date(2026, 12, 1), FACE, 20),
        StockLine("B", "FZ-1", "L1", date(2026, 12, 1), "F-10-B01-2", 60),
        StockLine("C", "FZ-1", "L2", date(2027, 1, 1), "DOCK-04", 60),
        StockLine("D", "FZ-1", "L2", date(2027, 1, 1), "STAGE-04", 30),
        StockLine("E", "FZ-1", "L2", date(2027, 1, 1), "TRL-1", 30),  # on a trailer: never held
        StockLine("F", "FZ-1", "L1", date(2026, 12, 1), "F-HOLD", 5),  # already held
        StockLine("G", "DR-1", "L9", date(2026, 10, 1), "C-10-B01-2", 80),
    ]

    def lpns(lines: list[StockLine]) -> list[str]:
        return [line.lpn for line in lines]

    assert lpns(select_for_hold(stock, products, plates=["C", "D", "E", "F"])) == ["C", "D"]
    assert lpns(select_for_hold(stock, products, plates=["A", "G"], sku="DR-1")) == ["G"]
    # a quality concern is about the lot: every other plate of it in storage
    assert lpns(select_for_hold(stock, products, plates=["A"], same_lot=True)) == ["A", "B"]
    # a cold-room alarm: stock in that room whose own limit the reading is over
    assert lpns(select_for_hold(stock, products, room="F", above=3.0)) == ["A", "B"]
    assert lpns(select_for_hold(stock, products, room="C", above=38.0)) == []
    assert lpns(select_for_hold(stock, products, room="C", above=38.5)) == ["G"]


def test_held_stock_is_never_picked_and_its_pick_is_allocated_again() -> None:
    stock = [
        StockLine("A", "FZ-1", "L1", date(2026, 12, 1), FACE, 20),
        StockLine("B", "FZ-1", "L2", date(2026, 11, 1), "F-10-B01-2", 60),
        StockLine("C", "FZ-1", "L3", date(2027, 1, 1), "F-10-B01-3", 60),
        StockLine("D", "FZ-1", "L4", date(2027, 2, 1), "F-10-B01-4", 60),
    ]
    house = Warehouse(1, -1.0, OPENING_SERIALS, PRODUCTS, stock)
    house.run([Trailer(appointment())], until=61.0)
    assert ("B", 60) in [(t.lpn, t.cases) for t in house.tasks.values() if t.kind is TaskKind.PICK]

    held = house.hold([house.stock[("B", "F-10-B01-2")]], 61.0, "QA-001", "ISSUE-1", "ISSUE-1:t")
    assert held == ["B"]
    assert house.stock[("B", "F-HOLD")].cases == 60
    assert any(m.kind is MovementKind.HOLD and m.lpn == "B" for m in house.movements)
    open_picks = [
        t for t in house.tasks.values() if t.kind is TaskKind.PICK and t.status in warehouse.OPEN_STATUSES
    ]
    assert all(t.lpn != "B" for t in open_picks)
    assert all(layout.area_of(t.from_location or "") is layout.Area.STORAGE for t in open_picks)
    assert all(line.location != "F-HOLD" for line, _ in house._available("FZ-1"))  # FEFO skips held

    # Quality's call: release puts it back in a reserve slot, destroy takes it out of the building.
    assert house.dispose(["B"], "release", 62.0, "QA-001", "ISSUE-1", "ISSUE-1:r") == ["B"]
    [(plate, location)] = [key for key in house.stock if key[0] == "B"]
    assert layout.area_of(location) is layout.Area.STORAGE
    house.hold([house.stock[(plate, location)]], 63.0, "QA-001", "ISSUE-2", "ISSUE-2:t")
    assert house.dispose(["B"], "destroy", 64.0, "QA-001", "ISSUE-2", "ISSUE-2:d") == ["B"]
    assert not [key for key in house.stock if key[0] == "B"]
    assert house.movements[-1].kind is MovementKind.ADJUST
    assert house.dispose(["B"], "release", 65.0, "QA-001", "ISSUE-2", "ISSUE-2:x") == []  # nothing held
