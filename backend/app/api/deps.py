import time
from collections import defaultdict, deque
from collections.abc import Awaitable, Callable
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from fastapi import status as http
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db import Base, get_session
from app.domain.enums import Role
from app.models import User
from app.realtime import ConnectionManager
from app.security import decode_access_token
from app.services.agent import Agent
from app.wms.client import WmsClient

SessionDep = Annotated[AsyncSession, Depends(get_session)]

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def get_settings_dep(request: Request) -> Settings:
    return request.app.state.settings


def get_realtime(request: Request) -> ConnectionManager:
    return request.app.state.realtime


def get_agent(request: Request) -> Agent:
    return request.app.state.agent


def get_wms(request: Request) -> WmsClient:
    return request.app.state.wms


SettingsDep = Annotated[Settings, Depends(get_settings_dep)]
RealtimeDep = Annotated[ConnectionManager, Depends(get_realtime)]
AgentDep = Annotated[Agent, Depends(get_agent)]
WmsDep = Annotated[WmsClient, Depends(get_wms)]

UNAUTHORIZED = HTTPException(
    http.HTTP_401_UNAUTHORIZED, "Not authenticated", headers={"WWW-Authenticate": "Bearer"}
)


async def user_from_token(session: AsyncSession, settings: Settings, token: str | None) -> User | None:
    if not token:
        return None
    claims = decode_access_token(settings, token)
    if claims is None:
        return None
    user = await session.get(User, claims.user_id)
    if user is None or not user.is_active:
        return None
    return user


async def get_current_user(
    session: SessionDep, settings: SettingsDep, token: Annotated[str | None, Depends(oauth2_scheme)]
) -> User:
    user = await user_from_token(session, settings, token)
    if user is None:
        raise UNAUTHORIZED
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_roles(*roles: Role) -> Callable[[User], Awaitable[User]]:
    async def dependency(user: CurrentUser) -> User:
        if user.role not in roles:
            raise HTTPException(http.HTTP_403_FORBIDDEN, "Your role cannot do this")
        return user

    return dependency


Operator = Annotated[User, Depends(require_roles(Role.OPERATOR))]
Supervisor = Annotated[User, Depends(require_roles(Role.SUPERVISOR))]
Staff = Annotated[User, Depends(require_roles(Role.SUPERVISOR, Role.QUALITY))]


async def get_or_404[ModelT: Base](
    session: AsyncSession, model: type[ModelT], ident: int, label: str
) -> ModelT:
    instance = await session.get(model, ident)
    if instance is None:
        raise HTTPException(http.HTTP_404_NOT_FOUND, f"{label} not found")
    return instance


class RateLimit:
    """Sliding-window limit per key, in process memory. One API instance, so this is sufficient."""

    def __init__(self, limit: int, window_seconds: float) -> None:
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str) -> None:
        now = time.monotonic()
        hits = self._hits[key]
        while hits and now - hits[0] > self.window:
            hits.popleft()
        if len(hits) >= self.limit:
            raise HTTPException(
                http.HTTP_429_TOO_MANY_REQUESTS,
                "Too many requests — wait a moment and try again",
                headers={"Retry-After": str(int(self.window))},
            )
        hits.append(now)
