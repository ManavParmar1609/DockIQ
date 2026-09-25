"""Cold-room temperatures: a pure function of (seed, room, simulated minute). See business-rules §12.12.

Each room is sampled every SAMPLE_EVERY minutes: its set-point plus a little sensor noise, and now and
then an excursion — a door left open, a defrost cycle that overruns, a compressor that trips — that
lifts it over the room's alarm limit and back. An excursion that stays over the limit for
ALARM_AFTER minutes raises the alarm once, and the warehouse files it as a cold-chain issue.
"""

import random
from dataclasses import dataclass

from app.wms.clock import SHIFT_MINUTES

SAMPLE_EVERY = 5.0  # simulated minutes between readings
READING_NOISE = 0.8  # °F either side of the set-point
ALARM_AFTER = 15.0  # minutes continuously over the limit before the alarm is raised

# (set-point, alarm limit) in °F
CLIMATE: dict[str, tuple[float, float]] = {
    "F": (-10.0, 0.0),
    "C": (34.0, 40.0),
    "P": (38.0, 45.0),
    "D": (65.0, 80.0),
}
EXCURSION_CHANCE: dict[str, float] = {"F": 0.25, "C": 0.25, "P": 0.2, "D": 0.0}  # per room per shift
EXCURSION_WINDOW = (60.0, 400.0)  # when in the shift it starts
EXCURSION_OVER = (3.0, 9.0)  # peak °F over the limit
EXCURSION_RAMP = 10.0  # minutes to climb to the peak, and to recover from it
EXCURSION_HOLD = (10.0, 40.0)  # minutes at the peak
EXCURSION_CAUSES: dict[str, str] = {
    "door": "Freezer door left open too long",
    "defrost": "Cold chain compromised",
    "compressor": "Cold chain compromised",
}
CAUSE_TEXT = {
    "door": "dock door left open",
    "defrost": "defrost cycle overran",
    "compressor": "compressor tripped",
}


@dataclass(frozen=True, slots=True)
class Excursion:
    room: str
    shift: int
    start: float
    peak_at: float
    recover_at: float
    end: float
    over: float  # peak °F above the set-point
    cause: str
    alarm_at: float | None  # the reading that raises the alarm, if the excursion lasts long enough


def _episode(seed: int, room: str, shift: int) -> tuple[float, float, float, float, str] | None:
    rng = random.Random(f"dockiq-excursion:{seed}:{room}:{shift}")
    if rng.random() >= EXCURSION_CHANCE.get(room, 0.0):
        return None
    setpoint, limit = CLIMATE[room]
    start = shift * SHIFT_MINUTES + rng.uniform(*EXCURSION_WINDOW)
    over = limit - setpoint + rng.uniform(*EXCURSION_OVER)
    hold = rng.uniform(*EXCURSION_HOLD)
    cause = rng.choice(sorted(EXCURSION_CAUSES))
    return start, start + EXCURSION_RAMP, start + EXCURSION_RAMP + hold, over, cause


def _lift(episode: tuple[float, float, float, float, str] | None, minute: float) -> float:
    if episode is None:
        return 0.0
    start, peak_at, recover_at, over, _ = episode
    end = recover_at + EXCURSION_RAMP
    if minute <= start or minute >= end:
        return 0.0
    if minute < peak_at:
        return over * (minute - start) / EXCURSION_RAMP
    if minute <= recover_at:
        return over
    return over * (end - minute) / EXCURSION_RAMP


def sample_minute(minute: float) -> float:
    """The latest sampling minute at or before `minute`."""
    return (minute // SAMPLE_EVERY) * SAMPLE_EVERY


def reading(seed: int, room: str, minute: float) -> float:
    """The room's reading at a sampling minute."""
    setpoint, _ = CLIMATE[room]
    index = round(minute / SAMPLE_EVERY)
    noise = random.Random(f"dockiq-room:{seed}:{room}:{index}").uniform(-READING_NOISE, READING_NOISE)
    shift = int(minute // SHIFT_MINUTES)
    return round(setpoint + noise + _lift(_episode(seed, room, shift), minute), 1)


def excursion(seed: int, room: str, shift: int) -> Excursion | None:
    """This shift's excursion in a room, if there is one, and when its alarm goes off."""
    episode = _episode(seed, room, shift)
    if episode is None:
        return None
    start, peak_at, recover_at, over, cause = episode
    end = recover_at + EXCURSION_RAMP
    _, limit = CLIMATE[room]
    first_over: float | None = None
    alarm_at: float | None = None
    minute = sample_minute(start) + SAMPLE_EVERY
    while minute <= end + SAMPLE_EVERY:
        if reading(seed, room, minute) > limit:
            first_over = minute if first_over is None else first_over
            if minute - first_over >= ALARM_AFTER:
                alarm_at = minute
                break
        else:
            first_over = None
        minute += SAMPLE_EVERY
    return Excursion(room, shift, start, peak_at, recover_at, end, over, cause, alarm_at)


def recent(seed: int, room: str, minute: float, count: int) -> list[tuple[float, float]]:
    """The last `count` (minute, °F) readings up to `minute`, oldest first, within the shift."""
    latest = sample_minute(minute)
    shift_start = (minute // SHIFT_MINUTES) * SHIFT_MINUTES
    minutes = [latest - n * SAMPLE_EVERY for n in range(count)]
    return [(m, reading(seed, room, m)) for m in reversed(minutes) if m >= shift_start]
