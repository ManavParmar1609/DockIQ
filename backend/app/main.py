import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI, Request, WebSocket, WebSocketDisconnect, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.websockets import WebSocketState
from sqlalchemy import text

from app.api import analytics, auth, chat, floor, issues, orders, reference, sim, wms
from app.api.deps import RateLimit, SessionDep, session_from_token
from app.config import Settings, get_settings
from app.db import Database
from app.realtime import SUBPROTOCOL, SWEEP_SECONDS, ConnectionManager
from app.services.agent import Agent
from app.wms.client import NoWms, WmsClient
from app.wms.engine import SimulationEngine
from app.wms.simulated import SimulatedWms

logger = logging.getLogger("dockiq")

LOGIN_ATTEMPTS_PER_MINUTE = 10
CHAT_MESSAGES_PER_MINUTE = 12


async def _tick(engine: SimulationEngine, seconds: float) -> None:
    """Keeps the floor moving while someone watches. Correctness never depends on this loop: the
    engine catches up from the clock on every call, so a sleeping host just catches up later."""
    while True:
        await asyncio.sleep(seconds)
        try:
            await engine.tick()
        except Exception:
            logger.exception("simulation tick failed")


async def _sweep(manager: ConnectionManager, seconds: float) -> None:
    """Closes sockets whose token has expired, even when nothing is being sent to them."""
    while True:
        await asyncio.sleep(seconds)
        try:
            await manager.sweep()
        except Exception:
            logger.exception("websocket sweep failed")


async def _validation_error(_: Request, exc: Exception) -> JSONResponse:
    """422 with where and what only. The default handler echoes the input, and an input of NaN or
    Infinity cannot be written as JSON: the client got a 500 instead of the validation error."""
    errors = exc.errors() if isinstance(exc, RequestValidationError) else []
    detail = [
        {
            "loc": [part if isinstance(part, int) else str(part) for part in error.get("loc", ())],
            "msg": str(error.get("msg", "")),
            "type": str(error.get("type", "")),
        }
        for error in errors
    ]
    return JSONResponse(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, content={"detail": detail})


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    logging.basicConfig(level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.settings = settings
        app.state.db = Database(settings)
        app.state.realtime = ConnectionManager()
        app.state.agent = Agent(settings)
        app.state.login_limit = RateLimit(LOGIN_ATTEMPTS_PER_MINUTE, 60)
        app.state.chat_limit = RateLimit(CHAT_MESSAGES_PER_MINUTE, 60)
        engine: SimulationEngine | None = None
        wms_client: WmsClient = NoWms()
        if settings.wms_mode == "simulated":
            engine = SimulationEngine(app.state.db, app.state.realtime)
            wms_client = SimulatedWms(app.state.db, engine)
        app.state.sim, app.state.wms = engine, wms_client
        ticker = (
            asyncio.create_task(_tick(engine, settings.sim_tick_seconds))
            if engine is not None and settings.sim_tick_seconds > 0
            else None
        )
        sweeper = asyncio.create_task(_sweep(app.state.realtime, SWEEP_SECONDS))
        logger.info("DockIQ API starting (%s, WMS %s)", settings.environment, settings.wms_mode)
        yield
        for task in (ticker, sweeper):
            if task is not None:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
        await app.state.db.dispose()

    app = FastAPI(title="DockIQ.AI", version="2.0.0", lifespan=lifespan)
    app.add_exception_handler(RequestValidationError, _validation_error)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=settings.cors_origin_regex or None,
        allow_methods=["GET", "POST", "PUT"],
        allow_headers=["Content-Type", "Authorization"],
    )

    api = APIRouter(prefix="/api")

    @api.get("/health", tags=["meta"])
    async def health(session: SessionDep) -> dict[str, str]:
        await session.execute(text("SELECT 1"))
        return {"status": "ok"}

    for module in (auth, reference, orders, issues, floor, chat, analytics, wms, sim):
        api.include_router(module.router)
    app.include_router(api)

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket) -> None:
        """Authenticated by subprotocol: the client offers ["dockiq", <access token>]."""
        offered = [p.strip() for p in websocket.headers.get("sec-websocket-protocol", "").split(",")]
        token = offered[1] if len(offered) == 2 and offered[0] == SUBPROTOCOL else None
        database: Database = websocket.app.state.db
        async with database.sessionmaker() as session:
            found = await session_from_token(session, settings, token)
        if found is None:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        user, expires_at = found

        manager: ConnectionManager = websocket.app.state.realtime
        # The socket lives as long as its token: closed with 1008 once `exp` passes.
        await manager.connect(websocket, user.id, SUBPROTOCOL, expires_at)
        try:
            while websocket.application_state is WebSocketState.CONNECTED:  # until closed on expiry
                await websocket.receive_text()
        except WebSocketDisconnect:
            pass
        finally:
            manager.disconnect(websocket, user.id)

    return app


app = create_app()
