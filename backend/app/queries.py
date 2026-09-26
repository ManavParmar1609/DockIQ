"""Read queries shared by more than one route. Each select returns flat rows shaped like its schema."""

from datetime import datetime
from typing import Any

from sqlalchemy import Float, Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import aliased
from sqlalchemy.sql.compiler import SQLCompiler
from sqlalchemy.sql.expression import ColumnElement, FunctionElement

from app.domain.lifecycle import OPEN_STATUSES
from app.domain.retrieval import KbEntry
from app.models import (
    Carrier,
    Company,
    DockDoor,
    Issue,
    IssuePhoto,
    KnowledgeBaseEntry,
    Order,
    OrderItem,
    Product,
    QuickRequest,
    User,
)


def issue_select() -> Select[Any]:
    operator = aliased(User)
    supervisor = aliased(User)
    acknowledger = aliased(User)
    quality = aliased(User)
    photo_count = select(func.count(IssuePhoto.id)).where(IssuePhoto.issue_id == Issue.id).scalar_subquery()
    return (
        select(
            *Issue.__table__.c,
            operator.name.label("operator_name"),
            supervisor.name.label("supervisor_name"),
            acknowledger.name.label("acknowledged_by_name"),
            quality.name.label("disposition_by_name"),
            DockDoor.door_number,
            Company.name.label("company_name"),
            Product.name.label("product_name"),
            Product.sku.label("product_sku"),
            Carrier.name.label("carrier_name"),
            photo_count.label("photo_count"),
        )
        .outerjoin(operator, Issue.operator_id == operator.id)
        .outerjoin(supervisor, Issue.supervisor_id == supervisor.id)
        .outerjoin(acknowledger, Issue.acknowledged_by == acknowledger.id)
        .outerjoin(quality, Issue.disposition_by == quality.id)
        .outerjoin(DockDoor, Issue.dock_door_id == DockDoor.id)
        .outerjoin(Company, Issue.company_id == Company.id)
        .outerjoin(Product, Issue.product_id == Product.id)
        .outerjoin(Carrier, Issue.carrier_id == Carrier.id)
    )


def order_select() -> Select[Any]:
    return (
        select(
            *Order.__table__.c,
            Company.name.label("company_name"),
            Company.tier.label("company_tier"),
            Company.count_tolerance,
            Company.load_pattern,
            Company.sop_rules,
            Carrier.name.label("carrier_name"),
            User.name.label("operator_name"),
            DockDoor.door_number,
        )
        .join(Company, Order.company_id == Company.id)
        .join(Carrier, Order.carrier_id == Carrier.id)
        .outerjoin(User, Order.operator_id == User.id)
        .outerjoin(DockDoor, Order.dock_door_id == DockDoor.id)
    )


def order_items_select(order_id: int) -> Select[Any]:
    return (
        select(
            *OrderItem.__table__.c,
            Product.sku,
            Product.gtin,
            Product.name.label("product_name"),
            Product.category,
            Product.weight_per_case,
            Product.cases_per_pallet,
            Product.temp_min,
            Product.temp_max,
            Product.is_allergen,
            Product.lot_tracking_required,
            Product.case_value,
        )
        .join(Product, OrderItem.product_id == Product.id)
        .where(OrderItem.order_id == order_id)
        .order_by(OrderItem.id)
    )


def dock_select() -> Select[Any]:
    # Cases counted against cases expected on the door's current order: the floor's progress bar.
    cases = (
        select(
            OrderItem.order_id,
            func.sum(OrderItem.actual_quantity).label("cases_done"),
            func.sum(OrderItem.expected_quantity).label("cases_expected"),
        )
        .group_by(OrderItem.order_id)
        .subquery()
    )
    # A count only: the door's open issues are visible as records only to the teams they belong to.
    open_issues = (
        select(func.count(Issue.id))
        .where(Issue.dock_door_id == DockDoor.id, Issue.status.in_(list(OPEN_STATUSES)))
        .scalar_subquery()
    )
    return (
        select(
            *DockDoor.__table__.c,
            User.name.label("operator_name"),
            Order.order_number,
            Order.trailer_number,
            Company.name.label("company_name"),
            Order.type.label("order_type"),
            cases.c.cases_done,
            cases.c.cases_expected,
            open_issues.label("open_issues"),
        )
        .outerjoin(User, DockDoor.current_operator_id == User.id)
        .outerjoin(Order, DockDoor.current_order_id == Order.id)
        .outerjoin(Company, Order.company_id == Company.id)
        .outerjoin(cases, cases.c.order_id == Order.id)
        .order_by(DockDoor.door_number)
    )


def request_select() -> Select[Any]:
    return (
        select(
            *QuickRequest.__table__.c,
            User.name.label("operator_name"),
            DockDoor.door_number,
        )
        .outerjoin(User, QuickRequest.operator_id == User.id)
        .outerjoin(DockDoor, QuickRequest.dock_door_id == DockDoor.id)
        .order_by(QuickRequest.created_at.desc(), QuickRequest.id.desc())
    )


async def load_kb_entries(session: AsyncSession) -> list[KbEntry]:
    rows = await session.scalars(select(KnowledgeBaseEntry).order_by(KnowledgeBaseEntry.id))
    return [
        KbEntry(
            issue_type=row.issue_type,
            scenario=row.scenario,
            keywords=row.keywords,
            resolution_steps=row.resolution_steps,
            confidence=row.confidence.value,
            source_reference=row.source_reference,
            applicable_categories=row.applicable_categories or (),
            applicable_companies=row.applicable_companies or (),
        )
        for row in rows
    ]


async def count_recent_issues(
    session: AsyncSession,
    issue_type: str,
    since: datetime,
    *,
    dock_door_id: int | None = None,
    carrier_id: int | None = None,
) -> int:
    stmt = (
        select(func.count())
        .select_from(Issue)
        .where(Issue.issue_type == issue_type, Issue.created_at >= since)
    )
    if dock_door_id is not None:
        stmt = stmt.where(Issue.dock_door_id == dock_door_id)
    if carrier_id is not None:
        stmt = stmt.where(Issue.carrier_id == carrier_id)
    return (await session.scalar(stmt)) or 0


# ── Portable SQL: elapsed minutes between two timestamp columns ──


class minutes_between(FunctionElement[float]):  # noqa: N801 — SQL function naming
    type = Float()
    inherit_cache = True
    name = "minutes_between"


@compiles(minutes_between, "sqlite")
def _minutes_sqlite(element: minutes_between, compiler: SQLCompiler, **kw: Any) -> str:
    start, end = list(element.clauses)
    return (
        f"((julianday({compiler.process(end, **kw)}) - julianday({compiler.process(start, **kw)})) * 1440.0)"
    )


@compiles(minutes_between, "postgresql")
def _minutes_postgres(element: minutes_between, compiler: SQLCompiler, **kw: Any) -> str:
    start, end = list(element.clauses)
    return f"(EXTRACT(EPOCH FROM ({compiler.process(end, **kw)} - {compiler.process(start, **kw)})) / 60.0)"


def elapsed_minutes(start: ColumnElement[Any], end: ColumnElement[Any]) -> minutes_between:
    return minutes_between(start, end)
