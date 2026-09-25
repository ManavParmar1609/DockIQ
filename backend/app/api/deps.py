from typing import Annotated

from fastapi import Depends, HTTPException, Request
from fastapi import status as http
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import Base, get_session
from app.realtime import ConnectionManager
from app.services.assistant import Assistant

SessionDep = Annotated[AsyncSession, Depends(get_session)]


def get_realtime(request: Request) -> ConnectionManager:
    return request.app.state.realtime


def get_assistant(request: Request) -> Assistant:
    return request.app.state.assistant


RealtimeDep = Annotated[ConnectionManager, Depends(get_realtime)]
AssistantDep = Annotated[Assistant, Depends(get_assistant)]


async def get_or_404[ModelT: Base](
    session: AsyncSession, model: type[ModelT], ident: int, label: str
) -> ModelT:
    instance = await session.get(model, ident)
    if instance is None:
        raise HTTPException(http.HTTP_404_NOT_FOUND, f"{label} not found")
    return instance
