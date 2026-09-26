"""Demo data. Everything here is fictional — see .claude/rules/security.md §2.

Reference data lives in `data/*.json` and links by natural keys (company name, SKU, employee ID,
carrier code), never by row id. Historical issues are generated deterministically and scored by the
real severity formula, so the demo history is consistent with the live engine.

`seed()` fills an empty database. `sync_reference()` runs on every boot against an existing one: it
replaces the knowledge base with the repo's copy and backfills accounts, teams and GTINs, so
reference-data changes deploy without hand-written data migrations.
"""

import json
import random
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import utcnow
from app.domain.barcodes import demo_gtin
from app.domain.cost import estimate_cost_impact
from app.domain.enums import (
    Confidence,
    DockStatus,
    IssueStatus,
    LifecyclePhase,
    OrderStatus,
    OrderType,
    ProductCategory,
    Role,
)
from app.domain.lifecycle import PENDING_DECISIONS, requires_supervisor
from app.domain.severity import classify_severity
from app.domain.taxonomy import ISSUE_TAXONOMY, OPERATOR_RESOLUTIONS, SUPERVISOR_DECISIONS
from app.models import (
    Carrier,
    Company,
    DockDoor,
    Issue,
    KnowledgeBaseEntry,
    Order,
    OrderItem,
    Product,
    ShiftHandoff,
    User,
)
from app.security import demo_password_hash

DATA_DIR = Path(__file__).parent / "data"
DOCK_COUNT = 12
HISTORICAL_ISSUES = 50
QUICK_TAGS = ("Crushed", "Wet", "Torn Label", "Short Count", "Wrong Product", "Bad Odor")
# A historical decision is a final one: Contact Carrier and Request Re-inspection leave an issue open.
FINAL_DECISIONS = tuple(d for d in SUPERVISOR_DECISIONS[:-1] if d not in PENDING_DECISIONS)
HISTORICAL_STATUSES = (
    IssueStatus.SELF_RESOLVED,
    IssueStatus.SUPERVISOR_RESOLVED,
    IssueStatus.SELF_RESOLVED,
    IssueStatus.SELF_RESOLVED,
    IssueStatus.ESCALATED,
)


def load(name: str) -> list[dict[str, Any]]:
    return json.loads((DATA_DIR / f"{name}.json").read_text(encoding="utf-8"))


def zone_for(door_number: int) -> str:
    return "Zone A" if door_number <= 4 else "Zone B" if door_number <= 8 else "Zone C"


def _user(row: dict[str, Any], password_hash: str | None) -> User:
    fields = {key: value for key, value in row.items() if key not in ("supervisor", "role")}
    return User(**fields, role=Role(row["role"]), password_hash=password_hash, is_active=True)


def _knowledge_base() -> list[KnowledgeBaseEntry]:
    return [
        KnowledgeBaseEntry(**{**row, "confidence": Confidence(row["confidence"])})
        for row in load("knowledge_base")
    ]


async def is_seeded(session: AsyncSession) -> bool:
    return bool(await session.scalar(select(func.count()).select_from(Company)))


async def seed(
    session: AsyncSession,
    *,
    demo_password: str | None,
    now: datetime | None = None,
    seed_value: int = 42,
) -> None:
    now = now or utcnow()
    rng = random.Random(seed_value)
    password_hash = demo_password_hash(demo_password) if demo_password else None

    user_rows = load("users")
    companies = {row["name"]: Company(**row) for row in load("companies")}
    users = {row["employee_id"]: _user(row, password_hash) for row in user_rows}
    carriers = {row["code"]: Carrier(**row) for row in load("carriers")}
    docks = {
        number: DockDoor(
            door_number=number,
            zone=zone_for(number),
            status=DockStatus.IDLE,
            lifecycle_phase=LifecyclePhase.IDLE,
        )
        for number in range(1, DOCK_COUNT + 1)
    }
    session.add_all([*companies.values(), *users.values(), *carriers.values(), *docks.values()])
    session.add_all(_knowledge_base())
    await session.flush()  # assign ids to everything referenced below

    for row in user_rows:
        if row.get("supervisor"):
            users[row["employee_id"]].supervisor_id = users[row["supervisor"]].id

    products: dict[str, Product] = {}
    for number, row in enumerate(load("products"), start=1):
        fields = {key: value for key, value in row.items() if key != "company"}
        products[row["sku"]] = Product(
            **{**fields, "category": ProductCategory(row["category"])},
            company_id=companies[row["company"]].id,
            gtin=demo_gtin(number),
        )
    session.add_all(products.values())
    await session.flush()

    for row in load("orders"):
        arrived = now - timedelta(minutes=rng.randint(30, 120))
        dock = docks[row["dock_door"]]
        operator = users[row["operator"]]
        order_type = OrderType(row["type"])
        order = Order(
            order_number=row["order_number"],
            type=order_type,
            company_id=companies[row["company"]].id,
            carrier_id=carriers[row["carrier"]].id,
            trailer_number=row["trailer_number"],
            bol_number=row["bol_number"],
            dock_door_id=dock.id,
            operator_id=operator.id,
            status=OrderStatus.IN_PROGRESS,
            created_at=arrived,
        )
        session.add(order)
        await session.flush()
        session.add_all(
            OrderItem(
                order_id=order.id,
                product_id=products[item["sku"]].id,
                expected_quantity=item["expected_quantity"],
                actual_quantity=0,
                verified=False,
            )
            for item in row["items"]
        )
        dock.status = DockStatus.ACTIVE
        dock.lifecycle_phase = (
            LifecyclePhase.LOADING if order_type is OrderType.OUTBOUND else LifecyclePhase.UNLOADING
        )
        dock.current_trailer = row["trailer_number"]
        dock.current_order_id = order.id
        dock.current_operator_id = operator.id
        dock.trailer_arrived_at = arrived
        dock.last_activity_at = now

    _seed_history(
        session,
        rng,
        now,
        docks=list(docks.values()),
        operators=[u for u in users.values() if u.role is Role.OPERATOR],
        products=list(products.values()),
        companies={c.id: c for c in companies.values()},
        carriers=list(carriers.values()),
    )

    for row in load("shift_handoffs"):
        session.add(
            ShiftHandoff(
                supervisor_id=users[row["supervisor"]].id,
                shift=row["shift"],
                notes=row["notes"],
                created_at=now,
            )
        )
    await session.commit()


async def sync_reference(session: AsyncSession, *, demo_password: str | None) -> None:
    """Bring an already-seeded database up to the repo's reference data. Idempotent."""
    await session.execute(delete(KnowledgeBaseEntry))
    session.add_all(_knowledge_base())

    companies = {company.name: company for company in await session.scalars(select(Company))}
    for row in load("companies"):
        if (company := companies.get(row["name"])) is not None:
            company.load_pattern = row["load_pattern"]
            company.sop_rules = row["sop_rules"]

    password_hash = demo_password_hash(demo_password) if demo_password else None
    user_rows = load("users")
    existing = {user.employee_id: user for user in await session.scalars(select(User))}
    for row in user_rows:
        if row["employee_id"] not in existing:
            existing[row["employee_id"]] = _user(row, password_hash)
            session.add(existing[row["employee_id"]])
        elif existing[row["employee_id"]].password_hash is None:
            existing[row["employee_id"]].password_hash = password_hash
    await session.flush()
    for row in user_rows:
        user = existing[row["employee_id"]]
        user.simulated = bool(row.get("simulated", False))
        if row.get("supervisor") and user.supervisor_id is None:
            user.supervisor_id = existing[row["supervisor"]].id

    rows = load("products")
    gtins = {row["sku"]: demo_gtin(number) for number, row in enumerate(rows, start=1)}
    names = {row["sku"]: row["name"] for row in rows}
    for product in await session.scalars(select(Product)):
        product.gtin = product.gtin or gtins.get(product.sku)
        product.name = names.get(product.sku, product.name)  # fictional names are corrected in place
    await session.commit()


def _seed_history(
    session: AsyncSession,
    rng: random.Random,
    now: datetime,
    *,
    docks: list[DockDoor],
    operators: list[User],
    products: list[Product],
    companies: dict[int, Company],
    carriers: list[Carrier],
) -> None:
    for _ in range(HISTORICAL_ISSUES):
        created = now - timedelta(days=rng.randint(1, 30), hours=rng.randint(0, 23))
        spec = rng.choice(ISSUE_TAXONOMY)
        subtype = rng.choice(spec.subtypes)
        dock = rng.choice(docks)
        operator = rng.choice(operators)
        # People and systems issues are not about a product.
        product = rng.choice(products) if spec.group == "product" else None
        company = companies[product.company_id] if product else None
        status = rng.choice(HISTORICAL_STATUSES)
        quantity = rng.randint(1, 12)
        scored = classify_severity(
            spec.name,
            product_category=product.category.value if product else None,
            customer_tier=company.tier if company else None,
            is_allergen=product.is_allergen if product else False,
            issue_subtype=subtype,
        )
        if requires_supervisor(scored.severity) and status is IssueStatus.SELF_RESOLVED:
            status = IssueStatus.SUPERVISOR_RESOLVED  # history keeps the §7.1 guardrail too
        escalated = status in (IssueStatus.ESCALATED, IssueStatus.SUPERVISOR_RESOLVED)
        escalated_at = created + timedelta(minutes=rng.randint(1, 5)) if escalated else None
        resolution = (
            rng.choice(OPERATOR_RESOLUTIONS[:-1])
            if status is IssueStatus.SELF_RESOLVED
            else rng.choice(FINAL_DECISIONS)
            if status is IssueStatus.SUPERVISOR_RESOLVED
            else None
        )
        session.add(
            Issue(
                dock_door_id=dock.id,
                operator_id=operator.id,
                supervisor_id=operator.supervisor_id if status is IssueStatus.SUPERVISOR_RESOLVED else None,
                acknowledged_by=operator.supervisor_id if status is IssueStatus.SUPERVISOR_RESOLVED else None,
                issue_type=spec.name,
                issue_subtype=subtype,
                description=f"{subtype} at Dock {dock.door_number}",
                quick_tags=rng.sample(QUICK_TAGS, rng.randint(1, 3)) if product else [],
                severity=scored.severity,
                severity_score=scored.score,
                severity_reason=scored.reason,
                status=status,
                recurring_patterns=[],
                ai_confidence=rng.choice(list(Confidence)),
                resolution_type=resolution,
                resolution_notes=(
                    "Resolved with the suggested procedure"
                    if status is IssueStatus.SELF_RESOLVED
                    else "Decided by supervisor"
                    if status is IssueStatus.SUPERVISOR_RESOLVED
                    else None
                ),
                product_id=product.id if product else None,
                company_id=company.id if company else None,
                carrier_id=rng.choice(carriers).id,
                estimated_cost_impact=estimate_cost_impact(
                    product.case_value if product else None, quantity, spec.name, subtype
                ),
                escalated_at=escalated_at,
                acknowledged_at=(
                    escalated_at + timedelta(minutes=rng.randint(1, 10))
                    if escalated_at and status is IssueStatus.SUPERVISOR_RESOLVED
                    else None
                ),
                resolved_at=created + timedelta(minutes=rng.randint(3, 45)) if resolution else None,
                created_at=created,
            )
        )
