"""The WMS as the app sees it — through the WmsClient boundary only (architecture.md §4).

Nothing here knows whether the warehouse system is the simulator or a real one. When it is offline
these answer 503 and the operator falls back to the paper load sheet.
"""

from collections.abc import Awaitable
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Path, Query
from fastapi import status as http

from app.api.deps import CurrentUser, Staff, WmsDep
from app.db import MAX_ID
from app.domain.enums import OrderType, TaskKind, TaskStatus
from app.schemas import (
    ColdRoomOut,
    CrewProductivityOut,
    GateEventOut,
    LedgerEntryOut,
    PalletOut,
    ShipmentOut,
    StockOut,
    WarehouseTaskOut,
    WmsStatusOut,
    YardEntryOut,
)
from app.wms.client import WmsUnavailable

router = APIRouter(prefix="/wms", tags=["wms"])


def _unavailable(exc: WmsUnavailable) -> HTTPException:
    return HTTPException(http.HTTP_503_SERVICE_UNAVAILABLE, str(exc))


async def _ask[T](call: Awaitable[T]) -> T:
    try:
        return await call
    except WmsUnavailable as exc:
        raise _unavailable(exc) from exc


Sku = Annotated[str | None, Query(min_length=1, max_length=32)]
PalletId = Annotated[str | None, Query(min_length=1, max_length=24)]
Room = Literal["F", "C", "P", "D"]


@router.get("/status")
async def wms_status(user: CurrentUser, wms: WmsDep) -> WmsStatusOut:
    status = await wms.status()
    return WmsStatusOut(mode=status.mode, online=status.online, message=status.message)


@router.get("/appointments")
async def appointments(user: Staff, wms: WmsDep) -> list[YardEntryOut]:
    try:
        entries = await wms.appointments()
    except WmsUnavailable as exc:
        raise _unavailable(exc) from exc
    return [YardEntryOut.model_validate(entry, from_attributes=True) for entry in entries]


@router.get("/inventory")
async def inventory(sku: str, user: CurrentUser, wms: WmsDep) -> list[PalletOut]:
    try:
        pallets = await wms.inventory(sku.strip().upper())
    except WmsUnavailable as exc:
        raise _unavailable(exc) from exc
    return [PalletOut.model_validate(pallet, from_attributes=True) for pallet in pallets]


@router.get("/pallets/{pallet_id}")
async def pallet(pallet_id: str, user: CurrentUser, wms: WmsDep) -> PalletOut:
    try:
        found = await wms.find_pallet(pallet_id.strip())
    except WmsUnavailable as exc:
        raise _unavailable(exc) from exc
    if found is None:
        raise HTTPException(http.HTTP_404_NOT_FOUND, "No pallet with that ID")
    return PalletOut.model_validate(found, from_attributes=True)


@router.get("/stock")
async def stock(
    user: CurrentUser,
    wms: WmsDep,
    room: Room | None = None,
    sku: Sku = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> list[StockOut]:
    """On hand by licence plate and location — racking, quality hold, dock and staging lanes, and
    trailers at a door — first-expiring first."""
    records = await _ask(wms.stock(room, sku.strip().upper() if sku else None, limit))
    return [StockOut.model_validate(record, from_attributes=True) for record in records]


@router.get("/tasks")
async def tasks(
    user: Staff,
    wms: WmsDep,
    status: TaskStatus | None = None,
    kind: TaskKind | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 60,
) -> list[WarehouseTaskOut]:
    found = await _ask(wms.tasks(status.value if status else None, kind.value if kind else None, limit))
    return [WarehouseTaskOut.model_validate(task, from_attributes=True) for task in found]


@router.get("/productivity")
async def crew_productivity(user: Staff, wms: WmsDep) -> list[CrewProductivityOut]:
    rows = await _ask(wms.productivity())
    return [CrewProductivityOut.model_validate(row, from_attributes=True) for row in rows]


@router.get("/transactions")
async def transactions(
    user: Staff,
    wms: WmsDep,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    before_id: Annotated[int | None, Query(ge=1, le=MAX_ID)] = None,
    sku: Sku = None,
    pallet_id: PalletId = None,
) -> list[LedgerEntryOut]:
    """The movement ledger, newest first. Page back with `before_id` = the last `id` you have."""
    entries = await _ask(
        wms.transactions(
            limit, before_id, sku.strip().upper() if sku else None, pallet_id.strip() if pallet_id else None
        )
    )
    return [LedgerEntryOut.model_validate(entry, from_attributes=True) for entry in entries]


@router.get("/shipments")
async def shipments(
    user: Staff,
    wms: WmsDep,
    direction: OrderType | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 40,
) -> list[ShipmentOut]:
    """Inbound advance ship notices and receipts; outbound loads from wave release to ship
    confirmation. Most recent first."""
    found = await _ask(wms.shipments(direction.value if direction else None, limit))
    return [ShipmentOut.model_validate(shipment, from_attributes=True) for shipment in found]


@router.get("/shipments/{ref}")
async def shipment(
    ref: Annotated[str, Path(min_length=1, max_length=64)], user: Staff, wms: WmsDep
) -> ShipmentOut:
    """One shipment by appointment reference or order number."""
    found = await _ask(wms.shipment(ref.strip()))
    if found is None:
        raise HTTPException(http.HTTP_404_NOT_FOUND, "No shipment with that reference")
    return ShipmentOut.model_validate(found, from_attributes=True)


@router.get("/gate")
async def gate_log(
    user: Staff, wms: WmsDep, limit: Annotated[int, Query(ge=1, le=200)] = 60
) -> list[GateEventOut]:
    """Gate check-ins (seal, reefer reading, late flag), yard moves to a door, and check-outs (seal,
    dwell, detention), newest first."""
    events = await _ask(wms.gate_log(limit))
    return [GateEventOut.model_validate(event, from_attributes=True) for event in events]


@router.get("/rooms")
async def cold_rooms(
    user: Staff, wms: WmsDep, readings: Annotated[int, Query(ge=1, le=96)] = 12
) -> list[ColdRoomOut]:
    """Each temperature room: set-point, alarm limit, the latest `readings` samples, whether it is
    over its limit or in alarm, and its occupancy."""
    found = await _ask(wms.rooms(readings))
    return [ColdRoomOut.model_validate(room, from_attributes=True) for room in found]
