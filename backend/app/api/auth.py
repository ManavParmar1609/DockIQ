from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi import status as http
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.api.deps import CurrentUser, SessionDep, SettingsDep
from app.models import User
from app.schemas import DemoAccount, MeOut, TokenOut, UserOut
from app.security import create_access_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])

INVALID_LOGIN = HTTPException(
    http.HTTP_401_UNAUTHORIZED, "Employee ID or password is incorrect", headers={"WWW-Authenticate": "Bearer"}
)


async def me_out(session: AsyncSession, user: User) -> MeOut:
    supervisor_name = (
        await session.scalar(select(User.name).where(User.id == user.supervisor_id))
        if user.supervisor_id is not None
        else None
    )
    return MeOut.model_validate(
        {**UserOut.model_validate(user).model_dump(), "supervisor_name": supervisor_name}
    )


@router.post("/login")
async def login(
    request: Request,
    form: Annotated[OAuth2PasswordRequestForm, Depends()],
    session: SessionDep,
    settings: SettingsDep,
) -> TokenOut:
    """`username` is the employee ID (e.g. `OP-001`); case-insensitive."""
    employee_id = form.username.strip().upper()
    client = request.client.host if request.client else "unknown"
    # Two limits: the client address can be forged behind a proxy (X-Forwarded-For), the account cannot.
    request.app.state.login_limit.check(f"ip:{client}")
    request.app.state.login_limit.check(f"id:{employee_id}")
    user = await session.scalar(select(User).where(func.upper(User.employee_id) == employee_id))
    # Always verify (against a dummy hash if needed) so a missing account costs the same time.
    password_ok = verify_password(form.password, user.password_hash if user else None)
    if user is None or not password_ok or not user.is_active:
        raise INVALID_LOGIN
    return TokenOut(
        access_token=create_access_token(settings, user.id, user.role),
        expires_in=settings.access_token_minutes * 60,
        user=await me_out(session, user),
    )


@router.get("/me")
async def me(user: CurrentUser, session: SessionDep) -> MeOut:
    return await me_out(session, user)


@router.get("/demo-accounts")
async def demo_accounts(session: SessionDep, settings: SettingsDep) -> list[DemoAccount]:
    """Names and employee IDs of the seeded accounts, for the demo login screen. Never passwords."""
    if not settings.demo_accounts_listed:
        raise HTTPException(http.HTTP_404_NOT_FOUND, "Not found")
    supervisor = aliased(User)
    rows = await session.execute(
        select(User.employee_id, User.name, User.role, User.zone, supervisor.name.label("supervisor_name"))
        .outerjoin(supervisor, User.supervisor_id == supervisor.id)
        .where(User.is_active, User.password_hash.is_not(None), User.simulated.is_(False))
        .order_by(User.role, User.employee_id)
    )
    return [DemoAccount.model_validate(dict(row._mapping)) for row in rows]
