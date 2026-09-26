from datetime import timedelta

from fastapi import APIRouter
from sqlalchemy import ColumnElement, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.access import issue_scope
from app.api.deps import SessionDep, Staff
from app.api.issues import FromFilter, ToFilter, day_range
from app.db import utcnow
from app.domain.enums import Disposition, IssueStatus, Role, Severity
from app.domain.lifecycle import OPEN_STATUSES
from app.domain.taxonomy import COLD_CHAIN_ISSUE_TYPES
from app.models import Carrier, Company, DockDoor, Issue, User
from app.queries import elapsed_minutes
from app.schemas import AnalyticsSummary, QualityAnalytics

router = APIRouter(prefix="/analytics", tags=["analytics"])

TREND_WINDOW_DAYS = 30
REPEAT_LIMIT = 5


def _minutes(value: float | None) -> float | None:
    return round(float(value), 1) if value is not None else None


@router.get("/summary")
async def analytics_summary(
    user: Staff, session: SessionDep, date_from: FromFilter = None, date_to: ToFilter = None
) -> AnalyticsSummary:
    """The same issues the person can open: a supervisor's team; for Quality, quality issues and every
    critical issue (`scope` says which). `from` / `to` (UTC days) bound everything, the trend and the
    repeats included; without `from` the trend and repeats cover the last 30 days."""
    start, end = day_range(date_from, date_to)
    scope = issue_scope(user)
    if start is not None:
        scope = scope & (Issue.created_at >= start)
    if end is not None:
        scope = scope & (Issue.created_at < end)
    is_open = Issue.status.in_(OPEN_STATUSES)
    open_count = func.count(Issue.id).filter(is_open)
    resolution_minutes = func.avg(elapsed_minutes(Issue.created_at, Issue.resolved_at)).filter(
        Issue.resolved_at.is_not(None)
    )
    cold_chain = Issue.issue_type.in_(COLD_CHAIN_ISSUE_TYPES)
    window_start = start if start is not None else utcnow() - timedelta(days=TREND_WINDOW_DAYS)

    totals = (
        await session.execute(
            select(
                func.count(Issue.id),
                func.count(Issue.id).filter(Issue.status == IssueStatus.SELF_RESOLVED),
                func.count(Issue.id).filter(
                    Issue.status.in_((IssueStatus.ESCALATED, IssueStatus.SUPERVISOR_RESOLVED))
                ),
                func.coalesce(func.sum(Issue.estimated_cost_impact), 0),
                resolution_minutes,
                open_count,
                func.count(Issue.id).filter(is_open, Issue.severity == Severity.CRITICAL),
                func.coalesce(func.sum(Issue.estimated_cost_impact).filter(is_open), 0),
                func.count(Issue.id).filter(cold_chain),
                func.count(Issue.id).filter(cold_chain, is_open),
            ).where(scope)
        )
    ).one()
    (
        total,
        self_resolved,
        escalated,
        total_cost,
        avg_minutes,
        open_issues,
        open_critical,
        open_cost,
        cold_chain_breaches,
        cold_chain_open,
    ) = totals

    by_type = await session.execute(
        select(
            Issue.issue_type,
            func.count().label("count"),
            func.coalesce(func.sum(Issue.estimated_cost_impact), 0).label("cost_impact"),
        )
        .group_by(Issue.issue_type)
        .order_by(func.count().desc(), Issue.issue_type)
        .where(scope)
    )
    by_severity = await session.execute(
        select(
            Issue.severity,
            func.count(Issue.id).label("count"),
            open_count.label("open"),
            resolution_minutes.label("avg_resolution_minutes"),
        )
        .group_by(Issue.severity)
        .order_by(Issue.severity)
        .where(scope)
    )
    by_type_severity = await session.execute(
        select(Issue.issue_type, Issue.severity, func.count().label("count"))
        .group_by(Issue.issue_type, Issue.severity)
        .order_by(Issue.issue_type, Issue.severity)
        .where(scope)
    )
    by_dock = await session.execute(
        select(DockDoor.door_number, func.count(Issue.id).label("count"), open_count.label("open"))
        .join(DockDoor, Issue.dock_door_id == DockDoor.id)
        .group_by(DockDoor.door_number)
        .order_by(DockDoor.door_number)
        .where(scope)
    )
    self_resolved_flag = case((Issue.status == IssueStatus.SELF_RESOLVED, 1), else_=0)
    by_operator = await session.execute(
        select(
            User.name,
            func.count(Issue.id).label("total"),
            func.sum(self_resolved_flag).label("self_resolved"),
            User.simulated,
        )
        .join(User, Issue.operator_id == User.id)
        .group_by(User.id, User.name, User.simulated)
        .order_by(func.count(Issue.id).desc(), User.name)
        .where(scope)
    )
    by_company = await session.execute(
        select(Company.name, func.count(Issue.id).label("count"))
        .join(Company, Issue.company_id == Company.id)
        .group_by(Company.id, Company.name)
        .order_by(func.count(Issue.id).desc(), Company.name)
        .limit(10)
        .where(scope)
    )
    by_carrier = await session.execute(
        select(Carrier.name, Carrier.id.label("carrier_id"), func.count(Issue.id).label("count"))
        .join(Carrier, Issue.carrier_id == Carrier.id)
        .group_by(Carrier.id, Carrier.name)
        .order_by(func.count(Issue.id).desc(), Carrier.name)
        .where(scope)
    )
    day = func.date(Issue.created_at)
    over_time = await session.execute(
        select(day.label("date"), func.count().label("count"))
        .where(Issue.created_at >= window_start)
        .group_by(day)
        .order_by(day)
        .where(scope)
    )
    # ── Repeats: the same problem more than once at one door, or from one carrier, in the window ──
    repeat_at_doors = await session.execute(
        select(Issue.issue_type, DockDoor.door_number, func.count(Issue.id).label("count"))
        .join(DockDoor, Issue.dock_door_id == DockDoor.id)
        .where(scope, Issue.created_at >= window_start)
        .group_by(Issue.issue_type, DockDoor.door_number)
        .having(func.count(Issue.id) > 1)
        .order_by(func.count(Issue.id).desc(), DockDoor.door_number, Issue.issue_type)
        .limit(REPEAT_LIMIT)
    )
    repeat_with_carriers = await session.execute(
        select(
            Issue.issue_type,
            Carrier.name,
            Carrier.id.label("carrier_id"),
            func.count(Issue.id).label("count"),
        )
        .join(Carrier, Issue.carrier_id == Carrier.id)
        .where(scope, Issue.created_at >= window_start)
        .group_by(Issue.issue_type, Carrier.id, Carrier.name)
        .having(func.count(Issue.id) > 1)
        .order_by(func.count(Issue.id).desc(), Carrier.name, Issue.issue_type)
        .limit(REPEAT_LIMIT)
    )

    return AnalyticsSummary(
        scope="team" if user.role is Role.SUPERVISOR else "quality",
        total_issues=total,
        self_resolved=self_resolved,
        escalated=escalated,
        self_resolution_rate=round(self_resolved / total * 100, 1) if total else 0,
        total_cost_impact=round(float(total_cost), 2),
        avg_resolution_minutes=round(float(avg_minutes), 1) if avg_minutes is not None else 0,
        open_issues=open_issues,
        open_critical=open_critical,
        open_cost_impact=round(float(open_cost), 2),
        cold_chain_breaches=cold_chain_breaches,
        cold_chain_open=cold_chain_open,
        by_type=[
            {
                "issue_type": row.issue_type,
                "count": row.count,
                "cost_impact": round(float(row.cost_impact), 2),
            }
            for row in by_type
        ],
        by_severity=[
            {
                "severity": row.severity,
                "count": row.count,
                "open": row.open,
                "avg_resolution_minutes": _minutes(row.avg_resolution_minutes),
            }
            for row in by_severity
        ],
        by_type_severity=[dict(row._mapping) for row in by_type_severity],
        by_dock=[dict(row._mapping) for row in by_dock],
        by_operator=[dict(row._mapping) for row in by_operator],
        by_company=[dict(row._mapping) for row in by_company],
        by_carrier=[dict(row._mapping) for row in by_carrier],
        over_time=[{"date": str(row.date), "count": row.count} for row in over_time],
        repeat_at_doors=[dict(row._mapping) for row in repeat_at_doors],
        repeat_with_carriers=[dict(row._mapping) for row in repeat_with_carriers],
        quality=await _quality(session, scope) if user.role is Role.QUALITY else None,
    )


async def _quality(session: AsyncSession, scope: ColumnElement[bool]) -> QualityAnalytics:
    """Disposition timing and split, what is still held, and cold-room excursions (§7.3, §12.12)."""
    disposed = Issue.disposition.is_not(None)
    timing = (
        await session.execute(
            select(
                func.count(Issue.id).filter(disposed),
                func.avg(elapsed_minutes(Issue.created_at, Issue.disposition_at)).filter(
                    disposed, Issue.disposition_at.is_not(None)
                ),
            ).where(scope)
        )
    ).one()
    by_disposition = await session.execute(
        select(Issue.disposition, func.count(Issue.id).label("count"))
        .where(scope, disposed)
        .group_by(Issue.disposition)
        .order_by(Issue.disposition)
    )
    # Plates still held: the issue's product is on hold, or awaits Quality's first call. The plate
    # lists are JSON, counted here rather than in SQL (portable across SQLite and Postgres).
    held_lists = await session.scalars(
        select(Issue.held_pallets).where(
            scope, or_(Issue.disposition.is_(None), Issue.disposition == Disposition.HOLD)
        )
    )
    held = [plates for plates in held_lists if plates]
    by_room = await session.execute(
        select(Issue.room, func.count(Issue.id).label("count"))
        .where(scope, Issue.room.is_not(None))
        .group_by(Issue.room)
        .order_by(Issue.room)
    )
    return QualityAnalytics(
        avg_minutes_to_disposition=_minutes(timing[1]),
        disposed=timing[0],
        by_disposition=[{"disposition": row.disposition, "count": row.count} for row in by_disposition],
        pallets_on_hold=sum(len(plates) for plates in held),
        issues_on_hold=len(held),
        excursions_by_room=[{"room": row.room, "count": row.count} for row in by_room],
    )
