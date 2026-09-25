"""The WMS as the app sees it — through the WmsClient boundary only (architecture.md §4).

Nothing here knows whether the warehouse system is the simulator or a real one. When it is offline
these answer 503 and the operator falls back to the paper load sheet.
"""

from fastapi import APIRouter, HTTPException
from fastapi import status as http

from app.api.deps import CurrentUser, Staff, WmsDep
from app.schemas import PalletOut, WmsStatusOut, YardEntryOut
from app.wms.client import WmsUnavailable

router = APIRouter(prefix="/wms", tags=["wms"])


def _unavailable(exc: WmsUnavailable) -> HTTPException:
    return HTTPException(http.HTTP_503_SERVICE_UNAVAILABLE, str(exc))


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
