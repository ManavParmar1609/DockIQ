"""Simulator controls for staff. See business-rules §12 and functional-specs §2.

These drive the simulation clock and inject scenarios; they are not part of the WMS boundary (a real
WMS has no play button). Everything the simulator creates is marked `simulated`.
"""

from fastapi import APIRouter, HTTPException, Request
from fastapi import status as http

from app.api.deps import SessionDep, Staff
from app.schemas import SimInject, SimInjected, SimReset, SimSpeed, SimStatusOut, SimStep
from app.wms.engine import SimulationEngine

router = APIRouter(prefix="/sim", tags=["simulation"])


def _engine(request: Request) -> SimulationEngine:
    engine: SimulationEngine | None = request.app.state.sim
    if engine is None:
        raise HTTPException(http.HTTP_404_NOT_FOUND, "The simulator is not enabled (WMS_MODE=none)")
    return engine


async def _status(request: Request, session: SessionDep) -> SimStatusOut:
    snapshot = await _engine(request).snapshot(session)
    await session.commit()
    return SimStatusOut.model_validate(snapshot)


@router.get("/status")
async def sim_status(request: Request, user: Staff, session: SessionDep) -> SimStatusOut:
    await _engine(request).advance()
    return await _status(request, session)


@router.post("/play")
async def play(request: Request, user: Staff, session: SessionDep) -> SimStatusOut:
    await _engine(request).change_clock("play")
    return await _status(request, session)


@router.post("/pause")
async def pause(request: Request, user: Staff, session: SessionDep) -> SimStatusOut:
    await _engine(request).change_clock("pause")
    return await _status(request, session)


@router.post("/speed")
async def speed(body: SimSpeed, request: Request, user: Staff, session: SessionDep) -> SimStatusOut:
    await _engine(request).change_clock("speed", value=body.speed)
    return await _status(request, session)


@router.post("/step")
async def step(body: SimStep, request: Request, user: Staff, session: SessionDep) -> SimStatusOut:
    await _engine(request).change_clock("step", value=body.minutes)
    return await _status(request, session)


@router.post("/next-shift")
async def next_shift(request: Request, user: Staff, session: SessionDep) -> SimStatusOut:
    await _engine(request).change_clock("next_shift")
    return await _status(request, session)


@router.post("/reset")
async def reset(body: SimReset, request: Request, user: Staff, session: SessionDep) -> SimStatusOut:
    await _engine(request).reset(body.seed)
    return await _status(request, session)


@router.post("/inject")
async def inject(body: SimInject, request: Request, user: Staff) -> SimInjected:
    try:
        message = await _engine(request).inject(body.scenario)
    except LookupError as exc:
        raise HTTPException(http.HTTP_409_CONFLICT, str(exc)) from exc
    return SimInjected(message=message)
