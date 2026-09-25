"""The warehouse's physical layout: temperature rooms, racking, pick faces and the dock lanes.
Pure. See docs/architecture/business-rules.md §12.7.

A storage location is `{room}-{aisle}-B{bay}-{level}` (the §12.6 scheme). Level 1 of every bay is a
pick position; one per SKU is that SKU's **pick face**. Levels 2–4 are reserve racking. Besides the
racking a room has a quality-hold area (`F-HOLD`) and an overflow floor (`F-OVF`) for when its racking
is full. Pallets on their way in wait on a door's dock lane (`DOCK-04`); picked pallets wait on its
staging lane (`STAGE-04`); a loaded pallet is on the trailer (its trailer number).
"""

import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from functools import lru_cache

ROOMS: tuple[str, ...] = ("F", "C", "P", "D")
ROOM_NAMES: dict[str, str] = {"F": "Freezer", "C": "Cooler", "P": "Produce", "D": "Dry"}
AISLES: tuple[int, ...] = tuple(range(10, 18))  # 8 aisles per room
BAYS = 12
LEVELS = 4
PICK_LEVEL = 1
SLOTS_PER_ROOM = len(AISLES) * BAYS * LEVELS  # 384: 96 pick positions and 288 reserve slots

OPENING_LANE = "DOCK-00"  # where the opening stock is received, before the first shift

_SLOT = re.compile(r"^([A-Z])-(\d{2})-B(\d{2})-(\d)$")


class Area(StrEnum):
    STORAGE = "storage"  # racking and overflow: pickable
    HOLD = "hold"  # quality hold: on hand, not pickable
    DOCK = "dock"  # received, waiting for put-away
    STAGE = "stage"  # picked, waiting for the trailer
    TRAILER = "trailer"  # loaded


@dataclass(frozen=True, slots=True)
class Slot:
    room: str
    aisle: int
    bay: int
    level: int

    @property
    def code(self) -> str:
        return f"{self.room}-{self.aisle:02d}-B{self.bay:02d}-{self.level}"


def slot_of(location: str) -> Slot | None:
    match = _SLOT.match(location)
    if match is None:
        return None
    room, aisle, bay, level = match.groups()
    return Slot(room, int(aisle), int(bay), int(level))


def dock_lane(door: int) -> str:
    return f"DOCK-{door:02d}"


def stage_lane(door: int) -> str:
    return f"STAGE-{door:02d}"


def hold_area(room: str) -> str:
    return f"{room}-HOLD"


def overflow(room: str) -> str:
    return f"{room}-OVF"


def area_of(location: str) -> Area:
    if slot_of(location) is not None or location.endswith("-OVF"):
        return Area.STORAGE
    if location.endswith("-HOLD"):
        return Area.HOLD
    if location.startswith("DOCK-"):
        return Area.DOCK
    if location.startswith("STAGE-"):
        return Area.STAGE
    return Area.TRAILER


def room_of(location: str) -> str | None:
    """The temperature room a location is in, or None for the dock, staging lanes and trailers."""
    if area_of(location) in (Area.STORAGE, Area.HOLD):
        return location[0]
    return None


def reserve_slots(room: str) -> tuple[Slot, ...]:
    return tuple(
        Slot(room, aisle, bay, level)
        for aisle in AISLES
        for bay in range(1, BAYS + 1)
        for level in range(PICK_LEVEL + 1, LEVELS + 1)
    )


def pick_faces(skus_by_room: Mapping[str, Sequence[str]]) -> dict[str, Slot]:
    """One level-1 position per SKU: the room's SKUs in order, across the aisles, then along them."""
    faces: dict[str, Slot] = {}
    for room, skus in skus_by_room.items():
        for index, sku in enumerate(sorted(skus)):
            faces[sku] = Slot(room, AISLES[index % len(AISLES)], 1 + index // len(AISLES), PICK_LEVEL)
    return faces


def nearest_free(face: Slot, taken: Iterable[str] | set[str]) -> str:
    """The free reserve slot closest to a SKU's pick face — same aisle first, then the nearest bay,
    lowest level first — or the room's overflow floor when the racking is full."""
    blocked = taken if isinstance(taken, set) else set(taken)
    return next((code for code in _by_distance(face) if code not in blocked), overflow(face.room))


@lru_cache(maxsize=512)
def _by_distance(face: Slot) -> tuple[str, ...]:
    return tuple(
        slot.code
        for slot in sorted(
            reserve_slots(face.room),
            key=lambda s: (abs(s.aisle - face.aisle), abs(s.bay - face.bay), s.level, s.aisle, s.bay),
        )
    )
