from fastapi import APIRouter, Request
from sqlalchemy import select

from app.api.deps import AssistantDep, CurrentUser, SessionDep, get_or_404
from app.db import utcnow
from app.domain.enums import ChatRole
from app.models import ChatMessage, Company
from app.queries import load_kb_entries
from app.schemas import ChatCreate, ChatMessageOut, ChatReply
from app.services.assistant import CompanyContext

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("")
async def post_chat(
    body: ChatCreate, request: Request, user: CurrentUser, session: SessionDep, assistant: AssistantDep
) -> ChatReply:
    request.app.state.chat_limit.check(str(user.id))
    company_context: CompanyContext | None = None
    if body.company_id is not None:
        company = await get_or_404(session, Company, body.company_id, "Company")
        company_context = CompanyContext(
            name=company.name,
            tier=company.tier,
            count_tolerance=company.count_tolerance,
            load_pattern=company.load_pattern,
            sop_rules=company.sop_rules,
        )

    now = utcnow()
    session.add(ChatMessage(user_id=user.id, role=ChatRole.USER, message=body.message, created_at=now))
    reply = await assistant.answer(
        body.message, await load_kb_entries(session), company_context, body.product_category
    )
    session.add(
        ChatMessage(
            user_id=user.id,
            role=ChatRole.ASSISTANT,
            message=reply["response"],
            source_reference=reply["source"],
            created_at=utcnow(),
        )
    )
    await session.commit()
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
