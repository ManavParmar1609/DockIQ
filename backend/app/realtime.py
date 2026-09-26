"""WebSocket delivery. `/ws` carries exactly the event types built below — see
docs/requirements/functional-specs.md §3. Adding one means changing the frontend handler too.

The handshake is authenticated with the access token passed as the second WebSocket subprotocol
(`new WebSocket(url, ["dockiq", token])`) — browsers cannot set headers on a WebSocket. A socket
lives no longer than its token: past the token's `exp` it is closed with 1008 (policy violation),
on the next send to it or by the periodic sweep, whichever comes first.
"""

import asyncio
import contextlib
import logging
from collections import defaultdict
from collections.abc import Callable, Iterable
from datetime import datetime
from typing import Any

from fastapi import WebSocket, status
from fastapi.encoders import jsonable_encoder

from app.db import utcnow

logger = logging.getLogger(__name__)

SUBPROTOCOL = "dockiq"
SWEEP_SECONDS = 30  # how often sockets whose token has expired are closed, at the latest


class ConnectionManager:
    """Authenticated sockets, grouped by user. Events carrying data are addressed to users; only the
    data-free `floor_update` signal goes to every socket (each client refetches through its own scope)."""

    def __init__(self, clock: Callable[[], datetime] = utcnow) -> None:
        self._sockets: dict[int, set[WebSocket]] = defaultdict(set)
        self._expires: dict[WebSocket, datetime] = {}  # each socket's token `exp`
        self.clock = clock

    async def connect(
        self, websocket: WebSocket, user_id: int, subprotocol: str, expires_at: datetime | None = None
    ) -> None:
        await websocket.accept(subprotocol=subprotocol)
        self._sockets[user_id].add(websocket)
        if expires_at is not None:
            self._expires[websocket] = expires_at

    def disconnect(self, websocket: WebSocket, user_id: int) -> None:
        self._expires.pop(websocket, None)
        sockets = self._sockets.get(user_id)
        if sockets is not None:
            sockets.discard(websocket)
            if not sockets:
                del self._sockets[user_id]

    def _expired(self, websocket: WebSocket) -> bool:
        expires = self._expires.get(websocket)
        return expires is not None and expires <= self.clock()

    async def _close_expired(self, user_id: int, websocket: WebSocket) -> None:
        self.disconnect(websocket, user_id)
        with contextlib.suppress(Exception):  # already gone: nothing to close
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Session expired")

    async def sweep(self) -> int:
        """Close every socket whose token has expired; returns how many."""
        expired = [
            (user_id, socket)
            for user_id, sockets in list(self._sockets.items())
            for socket in list(sockets)
            if self._expired(socket)
        ]
        for user_id, socket in expired:
            await self._close_expired(user_id, socket)
        return len(expired)

    async def send_all(self, event: dict[str, Any]) -> None:
        await self.send(list(self._sockets), event)

    async def send(self, user_ids: Iterable[int | None], event: dict[str, Any]) -> None:
        payload = jsonable_encoder(event)
        targets: list[tuple[int, WebSocket]] = []
        for user_id in {uid for uid in user_ids if uid is not None}:
            for socket in list(self._sockets.get(user_id, ())):
                if self._expired(socket):
                    await self._close_expired(user_id, socket)  # never deliver past the token
                else:
                    targets.append((user_id, socket))
        results = await asyncio.gather(
            *(socket.send_json(payload) for _, socket in targets), return_exceptions=True
        )
        for (user_id, socket), result in zip(targets, results, strict=True):
            if isinstance(result, Exception):
                logger.debug("dropping dead websocket: %s", result)
                self.disconnect(socket, user_id)


# ── Event constructors: the complete /ws vocabulary ──


def new_issue(issue: dict[str, Any]) -> dict[str, Any]:
    return {"type": "new_issue", "issue": issue}


def issue_escalated(issue: dict[str, Any]) -> dict[str, Any]:
    return {"type": "issue_escalated", "issue": issue}


def issue_resolved(issue_id: int, method: str, resolution: str | None = None) -> dict[str, Any]:
    return {"type": "issue_resolved", "issue_id": issue_id, "method": method, "resolution": resolution}


def issue_acknowledged(issue_id: int, supervisor_name: str, door_number: int | None) -> dict[str, Any]:
    """A supervisor is on the way: the reporting operator is told who, and to which door."""
    return {
        "type": "issue_acknowledged",
        "issue_id": issue_id,
        "supervisor_name": supervisor_name,
        "door_number": door_number,
    }


def order_complete(order_id: int) -> dict[str, Any]:
    return {"type": "order_complete", "order_id": order_id}


def new_request(request_id: int, request_type: str, status: str = "pending") -> dict[str, Any]:
    """A quick request was made (`pending`, to the operator and their supervisor) or answered
    (`fulfilled`, to the operator who asked and their supervisor)."""
    return {"type": "new_request", "request_id": request_id, "request_type": request_type, "status": status}


def broadcast_message(broadcast_id: int, message: str) -> dict[str, Any]:
    return {"type": "broadcast", "message": message, "id": broadcast_id}


def floor_update() -> dict[str, Any]:
    """Something on the floor changed (a trailer arrived or left, the simulator moved on). No payload:
    clients refetch docks and orders through their own row scope."""
    return {"type": "floor_update"}
