from fastapi import APIRouter
from sqlalchemy import select

from app.api.deps import AssistantDep, SessionDep, get_or_404
from app.db import utcnow
from app.domain.enums import ChatRole
from app.models import ChatMessage, Company, User
from app.queries import load_kb_entries
from app.schemas import ChatCreate, ChatMessageOut, ChatReply
from app.services.assistant import CompanyContext

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("")
async def post_chat(body: ChatCreate, session: SessionDep, assistant: AssistantDep) -> ChatReply:
    await get_or_404(session, User, body.user_id, "User")
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
    session.add(ChatMessage(user_id=body.user_id, role=ChatRole.USER, message=body.message, created_at=now))
    reply = await assistant.answer(
        body.message, await load_kb_entries(session), company_context, body.product_category
    )
    session.add(
        ChatMessage(
            user_id=body.user_id,
            role=ChatRole.ASSISTANT,
            message=reply["response"],
            source_reference=reply["source"],
            created_at=utcnow(),
        )
    )
    await session.commit()
    return ChatReply.model_validate(reply)


@router.get("/history/{user_id}")
async def chat_history(user_id: int, session: SessionDep) -> list[ChatMessageOut]:
    """The most recent 100 messages, oldest first."""
    stmt = (
        select(ChatMessage)
        .where(ChatMessage.user_id == user_id)
        .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
        .limit(100)
    )
    messages = list(await session.scalars(stmt))
    return [ChatMessageOut.model_validate(message) for message in reversed(messages)]
