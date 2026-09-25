"""Who may see what, and who is told about what. Every scoping rule lives here.

Teams: an operator's `supervisor_id` is their supervisor. Quality staff see facility-wide quality
issues (see `domain.taxonomy.is_quality_relevant`). A record outside your scope is a 404, not a
403, so its existence is not disclosed.
"""

from fastapi import HTTPException
from fastapi import status as http
from sqlalchemy import ColumnElement, Select, false, or_, select, true
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.enums import Role, Severity
from app.domain.taxonomy import QUALITY_ISSUE_TYPES, is_quality_relevant
from app.models import Issue, Order, QuickRequest, User


def team_ids(supervisor_id: int) -> Select[tuple[int]]:
    return select(User.id).where(User.supervisor_id == supervisor_id)


def issue_scope(user: User) -> ColumnElement[bool]:
    match user.role:
        case Role.OPERATOR:
            return Issue.operator_id == user.id
        case Role.SUPERVISOR:
            return Issue.operator_id.in_(team_ids(user.id))
        case Role.QUALITY:
            return or_(Issue.issue_type.in_(QUALITY_ISSUE_TYPES), Issue.severity == Severity.CRITICAL)
    return false()


def order_scope(user: User) -> ColumnElement[bool]:
    match user.role:
        case Role.OPERATOR:
            return Order.operator_id == user.id
        case Role.SUPERVISOR:
            return Order.operator_id.in_(team_ids(user.id))
        case Role.QUALITY:
            return true()
    return false()


def request_scope(user: User) -> ColumnElement[bool]:
    match user.role:
        case Role.OPERATOR:
            return QuickRequest.operator_id == user.id
        case Role.SUPERVISOR:
            return QuickRequest.operator_id.in_(team_ids(user.id))
    return false()


def not_found(label: str) -> HTTPException:
    return HTTPException(http.HTTP_404_NOT_FOUND, f"{label} not found")


async def visible_issue(session: AsyncSession, user: User, issue_id: int) -> Issue:
    issue = await session.scalar(select(Issue).where(Issue.id == issue_id, issue_scope(user)))
    if issue is None:
        raise not_found("Issue")
    return issue


async def visible_order(session: AsyncSession, user: User, order_id: int) -> Order:
    order = await session.scalar(select(Order).where(Order.id == order_id, order_scope(user)))
    if order is None:
        raise not_found("Order")
    return order


async def supervisor_of(session: AsyncSession, user_id: int | None) -> int | None:
    if user_id is None:
        return None
    return await session.scalar(select(User.supervisor_id).where(User.id == user_id))


async def quality_ids(session: AsyncSession) -> list[int]:
    return list(await session.scalars(select(User.id).where(User.role == Role.QUALITY, User.is_active)))


async def issue_audience(session: AsyncSession, issue: Issue) -> set[int | None]:
    """The reporter, their supervisor, and — for quality-relevant issues — the Quality team."""
    audience: set[int | None] = {issue.operator_id, await supervisor_of(session, issue.operator_id)}
    if is_quality_relevant(issue.issue_type, issue.severity):
        audience.update(await quality_ids(session))
    return audience


async def team_audience(session: AsyncSession, supervisor_id: int) -> set[int | None]:
    return {supervisor_id, *(await session.scalars(team_ids(supervisor_id)))}


def ensure(condition: bool, detail: str = "Your role cannot do this") -> None:
    if not condition:
        raise HTTPException(http.HTTP_403_FORBIDDEN, detail)
