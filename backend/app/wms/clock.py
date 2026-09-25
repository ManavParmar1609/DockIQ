"""The simulation's virtual clock. See docs/architecture/business-rules.md §12.

Simulated time is a pure function of the stored anchor and the real time — never a counter a loop
increments. Play, pause, speed and step all *re-anchor*; nothing else changes it. That is what lets
the simulation survive restarts, redeploys and a sleeping free-tier host.
"""

from dataclasses import dataclass, replace
from datetime import datetime

SHIFT_MINUTES = 8 * 60
SHIFT_START_HOUR = 6  # the simulated shift runs 06:00–14:00


@dataclass(frozen=True, slots=True)
class Clock:
    seed: int
    speed: float
    running: bool
    anchor_real: datetime
    anchor_minutes: float  # simulated minutes since the start of shift 0 at the anchor

    def minutes_at(self, now: datetime) -> float:
        """Simulated minutes at real time `now`. Stops at the end of the current shift."""
        if not self.running:
            return self.anchor_minutes
        elapsed = max(0.0, (now - self.anchor_real).total_seconds()) / 60 * self.speed
        return min(self.anchor_minutes + elapsed, shift_end(self.anchor_minutes))

    def play(self, now: datetime) -> "Clock":
        return replace(self, running=True, anchor_real=now, anchor_minutes=self.minutes_at(now))

    def pause(self, now: datetime) -> "Clock":
        return replace(self, running=False, anchor_real=now, anchor_minutes=self.minutes_at(now))

    def with_speed(self, now: datetime, speed: float) -> "Clock":
        return replace(self, speed=speed, anchor_real=now, anchor_minutes=self.minutes_at(now))

    def step(self, now: datetime, minutes: float) -> "Clock":
        current = self.minutes_at(now)
        return replace(self, anchor_real=now, anchor_minutes=min(current + minutes, shift_end(current)))

    def next_shift(self, now: datetime) -> "Clock":
        start = (shift_of(self.minutes_at(now)) + 1) * SHIFT_MINUTES
        return replace(self, running=False, anchor_real=now, anchor_minutes=float(start))


def shift_of(minutes: float) -> int:
    return int(minutes // SHIFT_MINUTES)


END_OF_SHIFT_MARGIN = 0.01  # the clock stops just short of the next shift, so it stays in this one


def shift_end(minutes: float) -> float:
    """The latest simulated minute of the shift containing `minutes`."""
    return (shift_of(minutes) + 1) * SHIFT_MINUTES - END_OF_SHIFT_MARGIN


def clock_label(minutes: float) -> str:
    """'Shift 1 · 09:42' for display."""
    shift = shift_of(minutes)
    within = minutes - shift * SHIFT_MINUTES
    total = SHIFT_START_HOUR * 60 + int(within)
    return f"Shift {shift + 1} · {total // 60:02d}:{total % 60:02d}"
