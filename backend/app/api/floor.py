"""Floor operations: trailer inspections, quick requests, broadcasts, shift handoffs."""

from fastapi import APIRouter
from sqlalchemy import select

from app import realtime
from app.api.deps import RealtimeDep, SessionDep, get_or_404
from app.db import utcnow
from app.domain.dock import DockEvent, transition
from app.domain.enums import RequestStatus
from app.domain.inspection import inspection_passes
from app.models import Broadcast, DockDoor, QuickRequest, ShiftHandoff, TrailerInspection, User
from app.queries import request_select
from app.schemas import (
    BroadcastCreate,
    BroadcastOut,
    Created,
    InspectionCreate,
    InspectionResult,
    QuickRequestCreate,
    QuickRequestCreated,
    QuickRequestOut,
    ShiftHandoffCreate,
    ShiftHandoffOut,
    StatusOut,
)

router = APIRouter(tags=["floor"])


@router.post("/inspections")
async def create_inspection(body: InspectionCreate, session: SessionDep) -> InspectionResult:
    dock = await get_or_404(session, DockDoor, body.dock_door_id, "Dock")
    await get_or_404(session, User, body.operator_id, "Operator")
    passed = inspection_passes(
        body.seal_condition, body.interior_cleanliness, body.visible_damage, body.interior_temperature
    )
    now = utcnow()
    inspection = TrailerInspection(
        order_id=body.order_id,
        dock_door_id=dock.id,
        operator_id=body.operator_id,
        seal_condition=body.seal_condition,
        interior_cleanliness=body.interior_cleanliness,
        interior_temperature=body.interior_temperature,
        visible_damage=body.visible_damage,
        overall_pass=passed,
        notes=body.notes,
        created_at=now,
    )
    session.add(inspection)
    dock.status, dock.lifecycle_phase = transition(
        dock.status, dock.lifecycle_phase, DockEvent.INSPECTION_SUBMITTED
    )
    dock.last_activity_at = now
    await session.commit()
    return InspectionResult(id=inspection.id, overall_pass=passed)


@router.get("/requests")
async def list_requests(session: SessionDep, status: RequestStatus | None = None) -> list[QuickRequestOut]:
    stmt = request_select()
    if status is not None:
        stmt = stmt.where(QuickRequest.status == status)
    return [QuickRequestOut.model_validate(dict(row._mapping)) for row in await session.execute(stmt)]


@router.post("/requests")
async def create_request(
    body: QuickRequestCreate, session: SessionDep, events: RealtimeDep
) -> QuickRequestCreated:
    await get_or_404(session, User, body.operator_id, "Operator")
    if body.dock_door_id is not None:
        await get_or_404(session, DockDoor, body.dock_door_id, "Dock")
    request = QuickRequest(
        dock_door_id=body.dock_door_id,
        operator_id=body.operator_id,
        request_type=body.request_type,
        details=body.details,
        status=RequestStatus.PENDING,
        created_at=utcnow(),
    )
    session.add(request)
    await session.commit()
    await events.broadcast(realtime.new_request(request.id, request.request_type))
    return QuickRequestCreated(id=request.id, status=request.status)


@router.put("/requests/{request_id}/fulfill")
async def fulfill_request(request_id: int, session: SessionDep) -> StatusOut:
    request = await get_or_404(session, QuickRequest, request_id, "Request")
    request.status = RequestStatus.FULFILLED
    request.fulfilled_at = utcnow()
    await session.commit()
    return StatusOut(status=RequestStatus.FULFILLED.value)


@router.get("/broadcasts")
async def list_broadcasts(session: SessionDep) -> list[BroadcastOut]:
    stmt = (
        select(*Broadcast.__table__.c, User.name.label("supervisor_name"))
        .join(User, Broadcast.supervisor_id == User.id)
        .order_by(Broadcast.created_at.desc())
        .limit(20)
    )
    return [BroadcastOut.model_validate(dict(row._mapping)) for row in await session.execute(stmt)]


@router.post("/broadcasts")
async def create_broadcast(body: BroadcastCreate, session: SessionDep, events: RealtimeDep) -> Created:
    await get_or_404(session, User, body.supervisor_id, "Supervisor")
    broadcast = Broadcast(supervisor_id=body.supervisor_id, message=body.message, created_at=utcnow())
    session.add(broadcast)
    await session.commit()
    await events.broadcast(realtime.broadcast_message(broadcast.id, broadcast.message))
    return Created(id=broadcast.id)


@router.get("/shift-handoffs")
async def list_handoffs(session: SessionDep) -> list[ShiftHandoffOut]:
    stmt = (
        select(*ShiftHandoff.__table__.c, User.name.label("supervisor_name"))
        .join(User, ShiftHandoff.supervisor_id == User.id)
        .order_by(ShiftHandoff.created_at.desc())
        .limit(10)
    )
    return [ShiftHandoffOut.model_validate(dict(row._mapping)) for row in await session.execute(stmt)]


@router.post("/shift-handoffs")
async def create_handoff(body: ShiftHandoffCreate, session: SessionDep) -> StatusOut:
    await get_or_404(session, User, body.supervisor_id, "Supervisor")
    session.add(
        ShiftHandoff(
            supervisor_id=body.supervisor_id, shift=body.shift, notes=body.notes, created_at=utcnow()
        )
    )
    await session.commit()
    return StatusOut(status="created")
