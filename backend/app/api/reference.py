"""Reference data: users, companies, products, carriers, dock doors, and the issue taxonomy."""

from fastapi import APIRouter, HTTPException
from fastapi import status as http
from sqlalchemy import or_, select

from app.api.deps import CurrentUser, SessionDep, get_or_404
from app.domain.enums import Role
from app.domain.severity import ISSUE_TYPE_WEIGHTS
from app.domain.taxonomy import (
    ISSUE_TAXONOMY,
    OPERATOR_RESOLUTIONS,
    QUALITY_ISSUE_TYPES,
    REQUEST_TYPES,
    SEVERITY_FLOORS,
    SUPERVISOR_DECISIONS,
)
from app.models import Carrier, Company, DockDoor, Product, User
from app.queries import dock_select
from app.schemas import CarrierOut, CompanyOut, DockOut, IssueTypeOut, ProductOut, TaxonomyOut, UserOut

router = APIRouter(tags=["reference"])


@router.get("/taxonomy")
async def taxonomy(_: CurrentUser) -> TaxonomyOut:
    """Every closed list the floor chooses from. The frontend keeps no copies."""
    return TaxonomyOut(
        issue_types=[
            IssueTypeOut(
                name=spec.name,
                group=spec.group,
                icon=spec.icon,
                weight=ISSUE_TYPE_WEIGHTS[spec.name],
                subtypes=list(spec.subtypes),
                quality_relevant=spec.name in QUALITY_ISSUE_TYPES,
                floor={key or "*": value for key, value in SEVERITY_FLOORS.get(spec.name, {}).items()},
            )
            for spec in ISSUE_TAXONOMY
        ],
        operator_resolutions=list(OPERATOR_RESOLUTIONS),
        supervisor_decisions=list(SUPERVISOR_DECISIONS),
        request_types=list(REQUEST_TYPES),
    )


@router.get("/users")
async def list_users(user: CurrentUser, session: SessionDep, role: Role | None = None) -> list[UserOut]:
    """Supervisors see their team; operators see themselves and their supervisor; quality sees all."""
    stmt = select(User).where(User.is_active).order_by(User.id)
    match user.role:
        case Role.SUPERVISOR:
            stmt = stmt.where(or_(User.supervisor_id == user.id, User.id == user.id))
        case Role.OPERATOR:
            stmt = stmt.where(User.id.in_([user.id, user.supervisor_id or user.id]))
    if role is not None:
        stmt = stmt.where(User.role == role)
    return [UserOut.model_validate(row) for row in await session.scalars(stmt)]


@router.get("/users/{user_id}")
async def get_user(user_id: int, user: CurrentUser, session: SessionDep) -> UserOut:
    visible = {row.id for row in await list_users(user, session)}
    if user_id not in visible:
        raise HTTPException(http.HTTP_404_NOT_FOUND, "User not found")
    return UserOut.model_validate(await get_or_404(session, User, user_id, "User"))


@router.get("/companies")
async def list_companies(_: CurrentUser, session: SessionDep) -> list[CompanyOut]:
    companies = await session.scalars(select(Company).order_by(Company.id))
    return [CompanyOut.model_validate(company) for company in companies]


@router.get("/companies/{company_id}")
async def get_company(company_id: int, _: CurrentUser, session: SessionDep) -> CompanyOut:
    return CompanyOut.model_validate(await get_or_404(session, Company, company_id, "Company"))


@router.get("/products")
async def list_products(
    _: CurrentUser, session: SessionDep, company_id: int | None = None
) -> list[ProductOut]:
    stmt = select(Product).order_by(Product.id)
    if company_id is not None:
        stmt = stmt.where(Product.company_id == company_id)
    return [ProductOut.model_validate(product) for product in await session.scalars(stmt)]


@router.get("/carriers")
async def list_carriers(_: CurrentUser, session: SessionDep) -> list[CarrierOut]:
    carriers = await session.scalars(select(Carrier).order_by(Carrier.id))
    return [CarrierOut.model_validate(carrier) for carrier in carriers]


@router.get("/docks")
async def list_docks(_: CurrentUser, session: SessionDep) -> list[DockOut]:
    """The whole floor: every door is visible to everyone signed in."""
    rows = await session.execute(dock_select())
    return [DockOut.model_validate(dict(row._mapping)) for row in rows]


@router.get("/docks/{dock_id}")
async def get_dock(dock_id: int, _: CurrentUser, session: SessionDep) -> DockOut:
    row = (await session.execute(dock_select().where(DockDoor.id == dock_id))).first()
    if row is None:
        raise HTTPException(http.HTTP_404_NOT_FOUND, "Dock not found")
    return DockOut.model_validate(dict(row._mapping))
