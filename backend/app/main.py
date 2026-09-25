import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api import analytics, auth, chat, floor, issues, orders, reference
from app.api.deps import RateLimit, SessionDep, user_from_token
from app.config import Settings, get_settings
from app.db import Database
from app.realtime import SUBPROTOCOL, ConnectionManager
from app.services.assistant import Assistant

logger = logging.getLogger("dockiq")

LOGIN_ATTEMPTS_PER_MINUTE = 10
CHAT_MESSAGES_PER_MINUTE = 12


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    logging.basicConfig(level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.settings = settings
        app.state.db = Database(settings)
        app.state.realtime = ConnectionManager()
        app.state.assistant = Assistant(settings)
        app.state.login_limit = RateLimit(LOGIN_ATTEMPTS_PER_MINUTE, 60)
        app.state.chat_limit = RateLimit(CHAT_MESSAGES_PER_MINUTE, 60)
        logger.info("DockIQ API starting (%s)", settings.environment)
        yield
        await app.state.db.dispose()

    app = FastAPI(title="DockIQ.AI", version="2.0.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PUT"],
        allow_headers=["Content-Type", "Authorization"],
    )

    api = APIRouter(prefix="/api")

    @api.get("/health", tags=["meta"])
    async def health(session: SessionDep) -> dict[str, str]:
        await session.execute(text("SELECT 1"))
        return {"status": "ok"}

    for module in (auth, reference, orders, issues, floor, chat, analytics):
        api.include_router(module.router)
    app.include_router(api)

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket) -> None:
        """Authenticated by subprotocol: the client offers ["dockiq", <access token>]."""
        offered = [p.strip() for p in websocket.headers.get("sec-websocket-protocol", "").split(",")]
        token = offered[1] if len(offered) == 2 and offered[0] == SUBPROTOCOL else None
        database: Database = websocket.app.state.db
        async with database.sessionmaker() as session:
            user = await user_from_token(session, settings, token)
        if user is None:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        manager: ConnectionManager = websocket.app.state.realtime
        await manager.connect(websocket, user.id, SUBPROTOCOL)
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            manager.disconnect(websocket, user.id)

    return app


app = create_app()
