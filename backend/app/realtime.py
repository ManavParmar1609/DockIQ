"""WebSocket fan-out. `/ws` carries exactly the event types built below — see
docs/requirements/functional-specs.md §4. Adding one means changing both frontend layouts too.
"""

import asyncio
import logging
from typing import Any

from fastapi import WebSocket
from fastapi.encoders import jsonable_encoder

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self) -> None:
        self._sockets: set[WebSocket] = set()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self._sockets.add(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        self._sockets.discard(websocket)

    @property
    def connection_count(self) -> int:
        return len(self._sockets)

    async def broadcast(self, event: dict[str, Any]) -> None:
        payload = jsonable_encoder(event)
        sockets = list(self._sockets)
        results = await asyncio.gather(
            *(socket.send_json(payload) for socket in sockets), return_exceptions=True
        )
        for socket, result in zip(sockets, results, strict=True):
            if isinstance(result, Exception):
                logger.debug("dropping dead websocket: %s", result)
                self._sockets.discard(socket)


# ── Event constructors: the complete /ws vocabulary ──


def new_issue(issue: dict[str, Any]) -> dict[str, Any]:
    return {"type": "new_issue", "issue": issue}


def issue_escalated(issue: dict[str, Any]) -> dict[str, Any]:
    return {"type": "issue_escalated", "issue": issue}


def issue_resolved(issue_id: int, method: str) -> dict[str, Any]:
    return {"type": "issue_resolved", "issue_id": issue_id, "method": method}


def order_complete(order_id: int) -> dict[str, Any]:
    return {"type": "order_complete", "order_id": order_id}


def new_request(request_id: int, request_type: str) -> dict[str, Any]:
    return {"type": "new_request", "request_id": request_id, "request_type": request_type}


def broadcast_message(broadcast_id: int, message: str) -> dict[str, Any]:
    return {"type": "broadcast", "message": message, "id": broadcast_id}
