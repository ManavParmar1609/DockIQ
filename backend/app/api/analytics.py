from datetime import timedelta

from fastapi import APIRouter
from sqlalchemy import case, func, select, true

from app.api.access import issue_scope
from app.api.deps import SessionDep, Staff
from app.db import utcnow
from app.domain.enums import IssueStatus, Role
from app.models import Carrier, Company, DockDoor, Issue, User
from app.queries import elapsed_minutes
from app.schemas import AnalyticsSummary

router = APIRouter(prefix="/analytics", tags=["analytics"])

TREND_WINDOW_DAYS = 30


@router.get("/summary")
async def analytics_summary(user: Staff, session: SessionDep) -> AnalyticsSummary:
    """A supervisor sees their team; quality staff see every issue in the facility."""
    scope = issue_scope(user) if user.role is Role.SUPERVISOR else true()
    totals = (
        await session.execute(
            select(
                func.count(Issue.id),
                func.count(Issue.id).filter(Issue.status == IssueStatus.SELF_RESOLVED),
                func.count(Issue.id).filter(
                    Issue.status.in_((IssueStatus.ESCALATED, IssueStatus.SUPERVISOR_RESOLVED))
                ),
                func.coalesce(func.sum(Issue.estimated_cost_impact), 0),
                func.avg(elapsed_minutes(Issue.created_at, Issue.resolved_at)).filter(
                    Issue.resolved_at.is_not(None)
                ),
            ).where(scope)
        )
    ).one()
    total, self_resolved, escalated, total_cost, avg_minutes = totals

    by_type = await session.execute(
        select(Issue.issue_type, func.count().label("count"))
        .group_by(Issue.issue_type)
        .order_by(func.count().desc(), Issue.issue_type)
        .where(scope)
    )
    by_severity = await session.execute(
        select(Issue.severity, func.count().label("count"))
        .group_by(Issue.severity)
        .order_by(Issue.severity)
        .where(scope)
    )
    by_dock = await session.execute(
        select(DockDoor.door_number, func.count(Issue.id).label("count"))
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
        )
        .join(User, Issue.operator_id == User.id)
        .group_by(User.id, User.name)
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
        select(Carrier.name, func.count(Issue.id).label("count"))
        .join(Carrier, Issue.carrier_id == Carrier.id)
        .group_by(Carrier.id, Carrier.name)
        .order_by(func.count(Issue.id).desc(), Carrier.name)
        .where(scope)
    )
    day = func.date(Issue.created_at)
    over_time = await session.execute(
        select(day.label("date"), func.count().label("count"))
        .where(Issue.created_at >= utcnow() - timedelta(days=TREND_WINDOW_DAYS))
        .group_by(day)
        .order_by(day)
        .where(scope)
    )

    return AnalyticsSummary(
        total_issues=total,
        self_resolved=self_resolved,
        escalated=escalated,
        self_resolution_rate=round(self_resolved / total * 100, 1) if total else 0,
        total_cost_impact=round(float(total_cost), 2),
        avg_resolution_minutes=round(float(avg_minutes), 1) if avg_minutes is not None else 0,
        by_type=[dict(row._mapping) for row in by_type],
        by_severity=[dict(row._mapping) for row in by_severity],
        by_dock=[dict(row._mapping) for row in by_dock],
        by_operator=[dict(row._mapping) for row in by_operator],
        by_company=[dict(row._mapping) for row in by_company],
        by_carrier=[dict(row._mapping) for row in by_carrier],
        over_time=[{"date": str(row.date), "count": row.count} for row in over_time],
    )
