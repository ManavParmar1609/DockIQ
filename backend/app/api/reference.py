"""Reference data: users, companies, products, carriers, dock doors."""

from fastapi import APIRouter, HTTPException
from fastapi import status as http
from sqlalchemy import select

from app.api.deps import SessionDep, get_or_404
from app.domain.enums import Role
from app.models import Carrier, Company, DockDoor, Product, User
from app.queries import dock_select
from app.schemas import CarrierOut, CompanyOut, DockOut, ProductOut, UserOut

router = APIRouter(tags=["reference"])


@router.get("/users")
async def list_users(session: SessionDep, role: Role | None = None) -> list[UserOut]:
    stmt = select(User).order_by(User.id)
    if role is not None:
        stmt = stmt.where(User.role == role)
    return [UserOut.model_validate(user) for user in await session.scalars(stmt)]


@router.get("/users/{user_id}")
async def get_user(user_id: int, session: SessionDep) -> UserOut:
    return UserOut.model_validate(await get_or_404(session, User, user_id, "User"))


@router.get("/companies")
async def list_companies(session: SessionDep) -> list[CompanyOut]:
    companies = await session.scalars(select(Company).order_by(Company.id))
    return [CompanyOut.model_validate(company) for company in companies]


@router.get("/companies/{company_id}")
async def get_company(company_id: int, session: SessionDep) -> CompanyOut:
    return CompanyOut.model_validate(await get_or_404(session, Company, company_id, "Company"))


@router.get("/products")
async def list_products(session: SessionDep, company_id: int | None = None) -> list[ProductOut]:
    stmt = select(Product).order_by(Product.id)
    if company_id is not None:
        stmt = stmt.where(Product.company_id == company_id)
    return [ProductOut.model_validate(product) for product in await session.scalars(stmt)]


@router.get("/carriers")
async def list_carriers(session: SessionDep) -> list[CarrierOut]:
    carriers = await session.scalars(select(Carrier).order_by(Carrier.id))
    return [CarrierOut.model_validate(carrier) for carrier in carriers]


@router.get("/docks")
async def list_docks(session: SessionDep) -> list[DockOut]:
    rows = await session.execute(dock_select())
    return [DockOut.model_validate(dict(row._mapping)) for row in rows]


@router.get("/docks/{dock_id}")
async def get_dock(dock_id: int, session: SessionDep) -> DockOut:
    row = (await session.execute(dock_select().where(DockDoor.id == dock_id))).first()
    if row is None:
        raise HTTPException(http.HTTP_404_NOT_FOUND, "Dock not found")
    return DockOut.model_validate(dict(row._mapping))
