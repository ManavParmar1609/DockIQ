"""The assistant. `POST /api/chat/stream` streams the agent's work as server-sent events; `POST
/api/chat` runs the same agent and returns the finished reply. See functional-specs §2.6."""

import json
import logging
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse
from pydantic import TypeAdapter
from sqlalchemy import select

from app.api.deps import AgentDep, CurrentUser, SessionDep
from app.db import Database, utcnow
from app.domain.enums import ChatRole
from app.models import ChatMessage, User
from app.schemas import AgentAction, AgentCard, AgentStep, ChatCreate, ChatMessageOut, ChatReply
from app.services.agent import HISTORY_TURNS, Agent, Event, Turn
from app.services.agent_tools import ToolContext

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/chat", tags=["chat"])

STREAM_ERROR = {"type": "error", "message": "The assistant hit a problem. Try again."}
MODEL_SOURCE = "DockIQ assistant (model + your data)"
RULES_SOURCE = "DockIQ assistant (rules + your data)"
CARDS: TypeAdapter[AgentCard] = TypeAdapter(AgentCard)
ACTIONS: TypeAdapter[AgentAction] = TypeAdapter(AgentAction)


async def _history(session: Any, user_id: int) -> list[Turn]:
    rows = await session.scalars(
        select(ChatMessage)
        .where(ChatMessage.user_id == user_id)
        .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
        .limit(HISTORY_TURNS)
    )
    return [Turn(message.role.value, message.message) for message in reversed(list(rows))]


async def _converse(
    database: Database, agent: Agent, request: Request, user_id: int, text: str
) -> AsyncIterator[Event]:
    """Run one exchange in its own session (a stream outlives the request's dependencies) and store it."""
    async with database.sessionmaker() as session:
        user = await session.get(User, user_id)
        if user is None:
            return
        history = await _history(session, user.id)
        session.add(ChatMessage(user_id=user.id, role=ChatRole.USER, message=text, created_at=utcnow()))
        await session.commit()

        ctx = ToolContext(session=session, user=user, wms=request.app.state.wms, now=utcnow())
        answer, source = "", MODEL_SOURCE if agent.uses_model else RULES_SOURCE
        confidence = "high"
        async for event in agent.run(ctx, text, history):
            if event["type"] == "delta":
                answer += event["text"]
            elif event["type"] == "source":
                source, confidence = event["source"], event["confidence"]
            yield event

        stored = ChatMessage(
            user_id=user.id,
            role=ChatRole.ASSISTANT,
            message=answer.strip() or "Done — see the details above.",
            source_reference=source,
            created_at=utcnow(),
        )
        session.add(stored)
        await session.commit()
        yield {"type": "done", "message_id": stored.id, "source": source, "confidence": confidence}


@router.post(
    "/stream",
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {}}, "description": "Server-sent agent events"}},
)
async def stream_chat(
    body: ChatCreate, request: Request, user: CurrentUser, agent: AgentDep
) -> StreamingResponse:
    """Events, one JSON object per `data:` line: `step` (a tool running / done / failed), `card`,
    `action` (a draft to confirm), `delta` (answer text), `source`, and finally `done`."""
    request.app.state.chat_limit.check(str(user.id))

    async def events() -> AsyncIterator[str]:
        try:
            async for event in _converse(request.app.state.db, agent, request, user.id, body.message):
                yield f"data: {json.dumps(jsonable_encoder(event))}\n\n"
        except Exception:
            # Headers are already sent: tell the client in-band, and log without the message text.
            logger.exception("assistant stream failed")
            yield f"data: {json.dumps(STREAM_ERROR)}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("")
async def post_chat(body: ChatCreate, request: Request, user: CurrentUser, agent: AgentDep) -> ChatReply:
    """The same agent, collected into one reply."""
    request.app.state.chat_limit.check(str(user.id))
    reply: dict[str, Any] = {
        "response": "",
        "source": "",
        "confidence": "",
        "steps": [],
        "cards": [],
        "actions": [],
    }
    async for event in _converse(request.app.state.db, agent, request, user.id, body.message):
        match event["type"]:
            case "delta":
                reply["response"] += event["text"]
            case "step" if event["state"] != "running":
                reply["steps"].append(
                    AgentStep(
                        tool=event["tool"],
                        label=event["label"],
                        ok=event["state"] == "done",
                        summary=event["summary"],
                    )
                )
            case "card":
                reply["cards"].append(CARDS.validate_python(event["card"]))
            case "action":
                reply["actions"].append(ACTIONS.validate_python(event["action"]))
            case "done":
                reply["source"], reply["confidence"] = event["source"], event["confidence"]
    reply["response"] = reply["response"].strip()
    return ChatReply.model_validate(reply)


@router.get("/history")
async def chat_history(user: CurrentUser, session: SessionDep) -> list[ChatMessageOut]:
    """The most recent 100 messages, oldest first."""
    stmt = (
        select(ChatMessage)
        .where(ChatMessage.user_id == user.id)
        .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
        .limit(100)
    )
    messages = list(await session.scalars(stmt))
    return [ChatMessageOut.model_validate(message) for message in reversed(messages)]
