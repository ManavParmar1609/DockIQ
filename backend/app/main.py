import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api import analytics, chat, floor, issues, orders, reference
from app.api.deps import SessionDep
from app.config import Settings, get_settings
from app.db import Database
from app.realtime import ConnectionManager
from app.services.assistant import Assistant

logger = logging.getLogger("dockiq")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    logging.basicConfig(level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.settings = settings
        app.state.db = Database(settings)
        app.state.realtime = ConnectionManager()
        app.state.assistant = Assistant(settings)
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

    for module in (reference, orders, issues, floor, chat, analytics):
        api.include_router(module.router)
    app.include_router(api)

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket) -> None:
        manager: ConnectionManager = websocket.app.state.realtime
        await manager.connect(websocket)
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            manager.disconnect(websocket)

    return app


app = create_app()
