"""SimulatedWms: the WmsClient the live simulator stands behind. See business-rules §12.

Everything it serves is a function of the simulation seed and clock — the yard board is the planned
shift joined to the orders the engine has materialised; inventory is the seeded pallet snapshot. It
goes offline exactly when the plan (or an injected scenario) says the WMS is down.
"""

from sqlalchemy import select

from app.db import Database, utcnow
from app.models import Order, Product
from app.wms.client import Pallet, WmsStatus, WmsUnavailable, YardEntry
from app.wms.clock import shift_of
from app.wms.engine import SimulationEngine
from app.wms.plan import ProductRef, inventory

YARD_LOOKAHEAD_MINUTES = 90
YARD_DEPARTED_SHOWN = 6


class SimulatedWms:
    def __init__(self, database: Database, engine: SimulationEngine) -> None:
        self._database = database
        self._engine = engine

    async def _online(self) -> tuple[bool, int]:
        async with self._database.sessionmaker() as session:
            clock = await self._engine.clock(session)
            minute = clock.minutes_at(utcnow())
            reference = await self._engine.reference(session)
            plan = self._engine.plan(reference, clock.seed, shift_of(minute))
            online = not await self._engine.outage_active(session, clock, plan, minute)
            await session.commit()
            return online, clock.seed

    async def status(self) -> WmsStatus:
        online, _ = await self._online()
        return WmsStatus(
            mode="simulated",
            online=online,
            message="Simulated WMS online" if online else "Simulated WMS offline: use the paper load sheet",
        )

    async def _require_online(self) -> int:
        online, seed = await self._online()
        if not online:
            raise WmsUnavailable("The WMS is not responding")
        return seed

    async def appointments(self) -> list[YardEntry]:
        await self._require_online()
        async with self._database.sessionmaker() as session:
            clock = await self._engine.clock(session)
            minute = clock.minutes_at(utcnow())
            reference = await self._engine.reference(session)
            plan = self._engine.plan(reference, clock.seed, shift_of(minute))
            orders = {
                order.external_ref: order
                for order in await session.scalars(
                    select(Order).where(Order.external_ref.in_([a.key for a in plan.appointments]))
                )
            }
            carriers = {code: carrier.name for code, carrier in reference.carriers.items()}
            entries: list[YardEntry] = []
            for appointment in plan.appointments:
                state = SimulationEngine.yard_state(appointment, orders.get(appointment.key), minute)
                if state == "scheduled" and appointment.arrival - minute > YARD_LOOKAHEAD_MINUTES:
                    continue
                entries.append(
                    YardEntry(
                        ref=appointment.key,
                        order_number=appointment.order_number,
                        door=appointment.door,
                        type=appointment.type,
                        customer=appointment.customer,
                        carrier=carriers.get(appointment.carrier, appointment.carrier),
                        trailer=appointment.trailer,
                        state=state,
                        due_in_minutes=round(appointment.arrival - minute, 1)
                        if state == "scheduled"
                        else None,
                        simulated=True,
                    )
                )
            departed = [entry for entry in entries if entry.state == "departed"][-YARD_DEPARTED_SHOWN:]
            return [entry for entry in entries if entry.state != "departed"] + departed

    async def _inventory(self) -> list[Pallet]:
        seed = await self._require_online()
        async with self._database.sessionmaker() as session:
            products = [
                ProductRef(p.sku, p.name, p.category.value, p.cases_per_pallet, p.temp_max)
                for p in await session.scalars(select(Product))
            ]
        return [Pallet(r.pallet_id, r.sku, r.location, r.cases) for r in inventory(seed, products)]

    async def inventory(self, sku: str) -> list[Pallet]:
        return [pallet for pallet in await self._inventory() if pallet.sku == sku]

    async def find_pallet(self, pallet_id: str) -> Pallet | None:
        return next((pallet for pallet in await self._inventory() if pallet.pallet_id == pallet_id), None)

    async def confirm_order(self, order_ref: str, counts: dict[str, int]) -> None:
        await self._require_online()
