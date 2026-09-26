"""WebSocket delivery. `/ws` carries exactly the event types built below — see
docs/requirements/functional-specs.md §3. Adding one means changing the frontend handler too.

The handshake is authenticated with the access token passed as the second WebSocket subprotocol
(`new WebSocket(url, ["dockiq", token])`) — browsers cannot set headers on a WebSocket.
"""

import asyncio
import logging
from collections import defaultdict
from collections.abc import Iterable
from typing import Any

from fastapi import WebSocket
from fastapi.encoders import jsonable_encoder

logger = logging.getLogger(__name__)

SUBPROTOCOL = "dockiq"


class ConnectionManager:
    """Authenticated sockets, grouped by user. Events carrying data are addressed to users; only the
    data-free `floor_update` signal goes to every socket (each client refetches through its own scope)."""

    def __init__(self) -> None:
        self._sockets: dict[int, set[WebSocket]] = defaultdict(set)

    async def connect(self, websocket: WebSocket, user_id: int, subprotocol: str) -> None:
        await websocket.accept(subprotocol=subprotocol)
        self._sockets[user_id].add(websocket)

    def disconnect(self, websocket: WebSocket, user_id: int) -> None:
        sockets = self._sockets.get(user_id)
        if sockets is not None:
            sockets.discard(websocket)
            if not sockets:
                del self._sockets[user_id]

    async def send_all(self, event: dict[str, Any]) -> None:
        await self.send(list(self._sockets), event)

    async def send(self, user_ids: Iterable[int | None], event: dict[str, Any]) -> None:
        payload = jsonable_encoder(event)
        targets = [
            (user_id, socket)
            for user_id in {uid for uid in user_ids if uid is not None}
            for socket in list(self._sockets.get(user_id, ()))
        ]
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
