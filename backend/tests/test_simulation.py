"""The simulated WMS: a deterministic plan, a virtual clock, and an idempotent materialiser.
See docs/architecture/business-rules.md §12."""

from collections.abc import Callable, Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.domain.taxonomy import is_valid_subtype
from app.main import create_app
from app.wms.clock import SHIFT_MINUTES, Clock, clock_label, shift_end
from app.wms.plan import CustomerRef, ProductRef, ShiftPlan, inventory, plan_shift, work_minutes
from tests.conftest import token_of

Login = Callable[[str], dict[str, str]]

T0 = datetime(2026, 9, 25, 12, 0, tzinfo=UTC)
SIMULATED_CREW = {"Priya Raman", "Owen Castillo", "Hana Kowalski", "Marcus Bell"}  # users.json

PRODUCTS = (
    ProductRef("FZ-1", "Frozen peas", "Frozen", 60, 0.0),
    ProductRef("DR-1", "Yogurt", "Refrigerated", 80, 38.0),
    ProductRef("DG-1", "Crackers", "Dry", 100, None),
)
CUSTOMERS = (CustomerRef("North Market", PRODUCTS[:2]), CustomerRef("Coastal Grocers", PRODUCTS[1:]))
CARRIERS = (("FRZX", "Frostline Express"), ("CCL", "Coldchain Lines"))


def plan(seed: int = 7, shift: int = 0) -> ShiftPlan:
    return plan_shift(seed, shift, range(1, 13), CUSTOMERS, CARRIERS)


# ── The plan ──


def test_same_seed_plans_the_same_shift() -> None:
    assert plan(7) == plan(7)
    assert plan(7) != plan(8)
    assert plan(7, 0) != plan(7, 1)


def test_plan_is_ordered_and_stays_inside_the_shift() -> None:
    shift = plan(7, 2)
    arrivals = [a.arrival for a in shift.appointments]
    assert arrivals == sorted(arrivals)
    assert all(2 * SHIFT_MINUTES <= a < 3 * SHIFT_MINUTES for a in arrivals)
    assert all(2 * SHIFT_MINUTES <= start < end < 3 * SHIFT_MINUTES for start, end in shift.outages)
    assert len({a.key for a in shift.appointments}) == len(shift.appointments)


def test_every_planned_exception_is_a_real_taxonomy_entry() -> None:
    exceptions = [a.exception for seed in range(20) for a in plan(seed).appointments if a.exception]
    assert len(exceptions) > 20
    for exc in exceptions:
        assert is_valid_subtype(exc.issue_type, exc.subtype), exc


def test_temperature_exceptions_only_on_inbound_cold_loads() -> None:
    for seed in range(20):
        for a in plan(seed).appointments:
            if a.exception and a.exception.issue_type == "Temperature Deviation":
                assert a.type == "inbound"
                assert a.exception.temp_reading is not None
                assert a.exception.temp_limit is not None
                assert a.exception.temp_reading > a.exception.temp_limit


def test_work_time_scales_with_experience() -> None:
    assert work_minutes(10, "senior") < work_minutes(10, "experienced") < work_minutes(10, "new")
    assert work_minutes(10, None) == work_minutes(10, "experienced")


def test_inventory_is_deterministic_per_seed() -> None:
    assert inventory(1, PRODUCTS) == inventory(1, PRODUCTS)
    assert inventory(1, PRODUCTS) != inventory(2, PRODUCTS)
    assert {p.sku for p in inventory(1, PRODUCTS)} == {"FZ-1", "DR-1", "DG-1"}


# ── The clock ──


def test_paused_clock_does_not_move() -> None:
    clock = Clock(1, 15, False, T0, 30.0)
    assert clock.minutes_at(T0 + timedelta(hours=5)) == 30.0


def test_running_clock_advances_at_its_speed_and_stops_at_shift_end() -> None:
    clock = Clock(1, 15, True, T0, 0.0)
    assert clock.minutes_at(T0 + timedelta(minutes=2)) == pytest.approx(30.0)
    assert clock.minutes_at(T0 + timedelta(days=1)) == shift_end(0)
    assert clock_label(clock.minutes_at(T0 + timedelta(days=1))) == "Shift 1 · 13:59"


def test_pause_play_and_speed_re_anchor_without_jumping() -> None:
    clock = Clock(1, 15, True, T0, 0.0)
    later = T0 + timedelta(minutes=1)
    paused = clock.pause(later)
    assert paused.minutes_at(later + timedelta(hours=1)) == pytest.approx(15.0)
    faster = paused.play(later).with_speed(later, 60)
    assert faster.minutes_at(later + timedelta(minutes=1)) == pytest.approx(75.0)


def test_step_and_next_shift() -> None:
    clock = Clock(1, 15, False, T0, 100.0)
    assert clock.step(T0, 25).minutes_at(T0) == 125.0
    assert clock.step(T0, 999).minutes_at(T0) == shift_end(100.0)
    upcoming = clock.next_shift(T0)
    assert (upcoming.minutes_at(T0), upcoming.running) == (SHIFT_MINUTES, False)
    assert clock_label(upcoming.minutes_at(T0)) == "Shift 2 · 06:00"


# ── The engine, through the API ──


def step(client: TestClient, headers: dict[str, str], minutes: float) -> dict:  # type: ignore[type-arg]
    response = client.post("/api/sim/step", json={"minutes": minutes}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_stepping_the_clock_brings_trailers_to_the_doors(client: TestClient, login: Login) -> None:
    sup = login("SUP-001")
    before = client.get("/api/sim/status", headers=sup).json()
    assert (before["minute"], before["running"], before["simulated"]) == (0, False, True)

    status = step(client, sup, 180)
    assert status["clock"] == "Shift 1 · 09:00"
    assert status["trailers"]["at_door"] + status["trailers"]["departed"] > 0
    assert any(event["kind"] == "arrival" for event in status["events"])

    orders = client.get("/api/orders", headers=sup).json()
    simulated = [order for order in orders if order["simulated"]]
    assert simulated, "the team's doors should have simulated trailers"
    assert all(order["order_number"].startswith("SIM-") for order in simulated)


def test_the_engine_applies_each_event_once(client: TestClient, login: Login) -> None:
    sup = login("SUP-001")
    step(client, sup, 240)
    first = client.get("/api/sim/status", headers=sup).json()
    again = client.get("/api/sim/status", headers=sup).json()
    assert first["events"] == again["events"]
    issues = client.get("/api/issues?limit=200", headers=sup).json()
    ids = [issue["id"] for issue in issues]
    assert len(ids) == len(set(ids))


def test_a_full_shift_files_simulated_issues_through_the_real_formula(
    client: TestClient, login: Login
) -> None:
    sup = login("SUP-001")
    step(client, sup, SHIFT_MINUTES)
    issues = [i for i in client.get("/api/issues?limit=200", headers=sup).json() if i["simulated"]]
    assert issues
    for issue in issues:
        assert issue["severity"] in {"low", "medium", "high", "critical"}
        assert issue["severity_reason"]
        assert issue["status"] in {"self_resolved", "escalated", "resolution_in_progress"}


def test_injected_temperature_emergency_is_critical_and_reaches_quality(
    client: TestClient, login: Login
) -> None:
    sup, qa = login("SUP-001"), login("QA-001")
    step(client, sup, 120)
    with client.websocket_connect("/ws", subprotocols=["dockiq", token_of(qa)]) as quality:
        injected = client.post("/api/sim/inject", json={"scenario": "temperature_emergency"}, headers=sup)
        assert injected.status_code == 200, injected.text
        event = quality.receive_json()
        assert event["type"] == "new_issue"
        issue = event["issue"]
        assert (issue["issue_type"], issue["severity"], issue["simulated"]) == (
            "Temperature Deviation",
            "critical",
            True,
        )


def test_scenarios_only_ever_target_simulated_trailers(client: TestClient, login: Login) -> None:
    sup = login("SUP-001")
    # At 06:00 no simulated trailer has arrived; the seeded demo orders at the doors are people's work.
    response = client.post("/api/sim/inject", json={"scenario": "injury"}, headers=sup)
    assert response.status_code == 409
    assert client.post("/api/sim/inject", json={"scenario": "unknown"}, headers=sup).status_code == 422

    step(client, sup, 120)
    assert client.post("/api/sim/inject", json={"scenario": "injury"}, headers=sup).status_code == 200
    # Quality sees every critical issue, facility-wide.
    issues = client.get("/api/issues?limit=200", headers=login("QA-001")).json()
    injury = next(i for i in issues if i["issue_subtype"] == "Employee injury" and i["simulated"])
    assert injury["operator_name"] in SIMULATED_CREW


def test_wms_outage_makes_lookups_fail_and_queues_write_back(client: TestClient, login: Login) -> None:
    sup, op = login("SUP-001"), login("OP-001")
    assert client.get("/api/wms/status", headers=op).json()["online"] is True
    sku = client.get("/api/products", headers=op).json()[0]["sku"]
    assert client.get(f"/api/wms/inventory?sku={sku}", headers=op).status_code == 200

    assert client.post("/api/sim/inject", json={"scenario": "wms_outage"}, headers=sup).status_code == 200
    assert client.get("/api/wms/status", headers=op).json()["online"] is False
    assert client.get(f"/api/wms/inventory?sku={sku}", headers=op).status_code == 503

    completed = client.post("/api/orders/1/complete", json={"seal_number": "SL-1"}, headers=op)
    assert completed.status_code == 200
    assert client.get("/api/orders/1", headers=op).json()["wms_synced"] is False

    step(client, sup, 10)  # the outage is 8 simulated minutes
    assert client.get("/api/wms/status", headers=op).json()["online"] is True
    assert client.get("/api/orders/1", headers=op).json()["wms_synced"] is True


def test_pallet_lookup(client: TestClient, login: Login) -> None:
    op = login("OP-001")
    sku = client.get("/api/products", headers=op).json()[0]["sku"]
    pallets = client.get(f"/api/wms/inventory?sku={sku}", headers=op).json()
    assert pallets
    assert all(p["sku"] == sku for p in pallets)
    found = client.get(f"/api/wms/pallets/{pallets[0]['pallet_id']}", headers=op)
    assert found.json() == pallets[0]
    assert client.get("/api/wms/pallets/000", headers=op).status_code == 404


def test_a_person_taking_over_stops_the_simulator(client: TestClient, login: Login) -> None:
    sup = login("SUP-001")
    step(client, sup, 150)  # carriers run late: give Zone A's first trailer time to reach its door
    order = next(o for o in client.get("/api/orders", headers=sup).json() if o["simulated"])
    operator = next(
        u for u in client.get("/api/users", headers=sup).json() if u["id"] == order["operator_id"]
    )
    op = login(operator["employee_id"])
    detail = client.get(f"/api/orders/{order['id']}", headers=op).json()
    item = detail["items"][0]
    taken = client.put(
        f"/api/orders/{order['id']}/items",
        json={"product_id": item["product_id"], "actual_quantity": 1},
        headers=op,
    )
    assert taken.status_code == 200

    step(client, sup, 300)
    after = client.get(f"/api/orders/{order['id']}", headers=op).json()
    assert after["status"] == "in_progress"
    assert next(i for i in after["items"] if i["product_id"] == item["product_id"])["actual_quantity"] == 1


def test_reset_removes_everything_simulated(client: TestClient, login: Login) -> None:
    sup = login("SUP-001")
    step(client, sup, SHIFT_MINUTES)
    reset = client.post("/api/sim/reset", json={"seed": 99}, headers=sup)
    assert reset.status_code == 200
    body = reset.json()
    assert (body["seed"], body["minute"], body["events"]) == (99, 0, [])
    assert not [o for o in client.get("/api/orders", headers=sup).json() if o["simulated"]]
    assert not [i for i in client.get("/api/issues?limit=200", headers=sup).json() if i["simulated"]]


def test_operators_cannot_drive_the_simulator(client: TestClient, login: Login) -> None:
    op = login("OP-001")
    assert client.post("/api/sim/play", headers=op).status_code == 403
    assert client.get("/api/wms/appointments", headers=op).status_code == 403


def test_yard_board(client: TestClient, login: Login) -> None:
    sup = login("SUP-001")
    step(client, sup, 90)
    yard = client.get("/api/wms/appointments", headers=sup).json()
    assert yard
    assert all(entry["simulated"] for entry in yard)
    assert {entry["state"] for entry in yard} <= {"scheduled", "in_yard", "at_door", "departed"}


@pytest.fixture
def no_wms_client(seeded_db: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(seeded_db.model_copy(update={"wms_mode": "none"}))) as test_client:
        yield test_client


def test_without_a_wms_the_boundary_reports_offline(no_wms_client: TestClient) -> None:
    token = no_wms_client.post(
        "/api/auth/login", data={"username": "SUP-001", "password": "test-password"}
    ).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert no_wms_client.get("/api/wms/status", headers=headers).json() == {
        "mode": "none",
        "online": False,
        "message": "No WMS is connected",
    }
    assert no_wms_client.get("/api/sim/status", headers=headers).status_code == 404
    assert no_wms_client.get("/api/wms/appointments", headers=headers).status_code == 503


# ── Realism: punctuality, reefer, yard, FEFO inventory, KPIs (business-rules §12.6) ──


def test_arrivals_follow_each_carriers_punctuality_profile() -> None:
    from app.wms.plan import PUNCTUALITY, punctuality

    for appointment in plan(7).appointments:
        low, _, high = PUNCTUALITY[punctuality(7, appointment.carrier)]
        late = appointment.arrival - appointment.scheduled
        assert low - 0.01 <= late <= high + 0.01 or appointment.arrival == 0
    assert punctuality(7, "FRZX") == punctuality(7, "FRZX")  # a carrier keeps its habits


def test_reefer_is_set_below_the_strictest_limit_on_the_load() -> None:
    from app.wms.plan import REEFER_BELOW_LIMIT

    limits = {product.sku: product.temp_max for product in PRODUCTS}
    for appointment in plan(3).appointments:
        cold = [limits[sku] for sku, _ in appointment.lines if limits[sku] is not None]
        expected = min(cold) - REEFER_BELOW_LIMIT if cold else None  # type: ignore[type-var]
        assert appointment.reefer_setpoint == expected
        assert appointment.yard_spot.startswith("Y-")


def test_inventory_is_stored_by_temperature_room_and_listed_first_expiring_first() -> None:
    records = inventory(5, PRODUCTS)
    rooms = {"FZ-1": "F-", "DR-1": "C-", "DG-1": "D-"}  # freezer, cooler, dry
    for record in records:
        assert record.location.startswith(rooms[record.sku])
        assert record.lot.startswith("L")
    for sku in ("FZ-1", "DR-1", "DG-1"):
        dates = [record.best_before for record in records if record.sku == sku]
        assert dates == sorted(dates)


def test_shift_kpis() -> None:
    from app.wms.plan import Appointment, Visit, shift_kpis

    def appointment(key: str, scheduled: float, arrival: float, pallets: int) -> Appointment:
        return Appointment(
            key,
            0,
            1,
            "inbound",
            "C",
            "X",
            "SIM",
            "T",
            "B",
            "S",
            scheduled,
            arrival,
            None,
            "Y-01",
            5.0,
            (),
            pallets,
            None,
        )

    appointments = [
        appointment("on-time", 10, 20, 10),  # 10 min late: on time, left after 60
        appointment("late", 10, 40, 4),  # 30 min late, still on site 140 min later: detention
        appointment("future", 300, 300, 8),  # not arrived yet
    ]
    visits = {"on-time": Visit(at_door=25, departed=80), "late": Visit(at_door=45, departed=None)}
    kpis = shift_kpis(appointments, visits, minute=180, doors=2, shift_start=0)
    assert (kpis.arrived, kpis.on_time_percent, kpis.average_turn_minutes, kpis.on_detention) == (
        2,
        50.0,
        60.0,
        1,
    )
    assert kpis.pallets_per_hour == round(10 / 3, 1)
    assert kpis.door_utilization_percent == round((55 + 135) / (2 * 180) * 100, 1)


def test_yard_board_and_status_carry_appointment_times_and_kpis(client: TestClient, login: Login) -> None:
    sup = login("SUP-001")
    status = step(client, sup, 200)
    assert set(status["kpis"]) == {
        "arrived",
        "on_time_percent",
        "average_turn_minutes",
        "on_detention",
        "pallets_per_hour",
        "door_utilization_percent",
    }
    yard = client.get("/api/wms/appointments", headers=sup).json()
    arrived = [entry for entry in yard if entry["arrived_at"]]
    assert arrived
    assert all(len(entry["scheduled_at"]) == 5 for entry in yard)
    assert all(entry["dwell_minutes"] is not None for entry in arrived)
    sku = client.get("/api/products", headers=sup).json()[0]["sku"]
    pallets = client.get(f"/api/wms/inventory?sku={sku}", headers=sup).json()
    assert [pallet["best_before"] for pallet in pallets] == sorted(
        pallet["best_before"] for pallet in pallets
    )
