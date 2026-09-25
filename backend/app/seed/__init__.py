"""Demo data. Everything here is fictional — see .claude/rules/security.md §2.

Reference data lives in `data/*.json` and links by natural keys (company name, SKU, employee ID,
carrier code), never by row id. Historical issues are generated deterministically and scored by the
real severity formula, so the demo history is consistent with the live engine.
"""

import json
import random
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import utcnow
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
from app.domain.severity import ISSUE_TYPE_WEIGHTS, classify_severity
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

DATA_DIR = Path(__file__).parent / "data"
DOCK_COUNT = 12
HISTORICAL_ISSUES = 50
QUICK_TAGS = ("Crushed", "Wet", "Torn Label", "Short Count", "Wrong Product", "Bad Odor")
HISTORICAL_STATUSES = (
    IssueStatus.SELF_RESOLVED,
    IssueStatus.SUPERVISOR_RESOLVED,
    IssueStatus.SELF_RESOLVED,
    IssueStatus.SELF_RESOLVED,
    IssueStatus.ESCALATED,
)
RESOLUTION_TYPES = (
    "partial_accept",
    "full_reject",
    "manual_entry",
    "temp_recheck_ok",
    "equipment_swapped",
    "product_segregated",
)


def load(name: str) -> list[dict[str, Any]]:
    return json.loads((DATA_DIR / f"{name}.json").read_text(encoding="utf-8"))


def zone_for(door_number: int) -> str:
    return "Zone A" if door_number <= 4 else "Zone B" if door_number <= 8 else "Zone C"


async def is_seeded(session: AsyncSession) -> bool:
    return bool(await session.scalar(select(func.count()).select_from(Company)))


async def seed(session: AsyncSession, now: datetime | None = None, seed_value: int = 42) -> None:
    now = now or utcnow()
    rng = random.Random(seed_value)

    companies = {row["name"]: Company(**row) for row in load("companies")}
    users = {row["employee_id"]: User(**{**row, "role": Role(row["role"])}) for row in load("users")}
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
    session.add_all(
        KnowledgeBaseEntry(**{**row, "confidence": Confidence(row["confidence"])})
        for row in load("knowledge_base")
    )
    await session.flush()  # assign ids to everything referenced below

    products: dict[str, Product] = {}
    for row in load("products"):
        fields = {key: value for key, value in row.items() if key != "company"}
        products[row["sku"]] = Product(
            **{**fields, "category": ProductCategory(row["category"])},
            company_id=companies[row["company"]].id,
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
        supervisors=[u for u in users.values() if u.role is Role.SUPERVISOR],
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


def _seed_history(
    session: AsyncSession,
    rng: random.Random,
    now: datetime,
    *,
    docks: list[DockDoor],
    operators: list[User],
    supervisors: list[User],
    products: list[Product],
    companies: dict[int, Company],
    carriers: list[Carrier],
) -> None:
    issue_types = list(ISSUE_TYPE_WEIGHTS)
    for n in range(1, HISTORICAL_ISSUES + 1):
        created = now - timedelta(days=rng.randint(1, 30), hours=rng.randint(0, 23))
        issue_type = rng.choice(issue_types)
        dock = rng.choice(docks)
        product = rng.choice(products)
        company = companies[product.company_id]
        status = rng.choice(HISTORICAL_STATUSES)
        quantity = rng.randint(1, 12)
        scored = classify_severity(
            issue_type,
            product_category=product.category.value,
            customer_tier=company.tier,
            is_allergen=product.is_allergen,
        )
        escalated = status in (IssueStatus.ESCALATED, IssueStatus.SUPERVISOR_RESOLVED)
        escalated_at = created + timedelta(minutes=rng.randint(1, 5)) if escalated else None
        resolved = status is not IssueStatus.ESCALATED
        session.add(
            Issue(
                dock_door_id=dock.id,
                operator_id=rng.choice(operators).id,
                supervisor_id=rng.choice(supervisors).id
                if status is IssueStatus.SUPERVISOR_RESOLVED
                else None,
                issue_type=issue_type,
                description=f"Historical issue #{n} — {issue_type} at Dock {dock.door_number}",
                quick_tags=rng.sample(QUICK_TAGS, rng.randint(1, 3)),
                severity=scored.severity,
                severity_score=scored.score,
                severity_reason=scored.reason,
                status=status,
                ai_confidence=rng.choice(list(Confidence)),
                resolution_type=rng.choice(RESOLUTION_TYPES) if resolved else None,
                resolution_notes=(
                    (
                        "Resolved via AI guidance"
                        if status is IssueStatus.SELF_RESOLVED
                        else "Resolved via supervisor"
                    )
                    if resolved
                    else None
                ),
                product_id=product.id,
                company_id=company.id,
                carrier_id=rng.choice(carriers).id,
                estimated_cost_impact=estimate_cost_impact(product.case_value, quantity, issue_type),
                escalated_at=escalated_at,
                acknowledged_at=(
                    escalated_at + timedelta(minutes=rng.randint(1, 10))
                    if escalated_at and status is IssueStatus.SUPERVISOR_RESOLVED
                    else None
                ),
                resolved_at=created + timedelta(minutes=rng.randint(3, 45)) if resolved else None,
                created_at=created,
            )
        )
