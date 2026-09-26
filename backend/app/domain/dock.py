"""Dock-door state transitions. See docs/requirements/functional-specs.md §4.

A door carries two fields: `status` (is something wrong here?) and `lifecycle_phase` (where is the
trailer in its visit?). Every change to either goes through `transition` so the pair is decided in
one place rather than by each route handler or the simulator.

An issue event never decides the door's status from itself alone: the caller passes the worst
severity among the door's open issues after the event (`open_severity`, found by
`queries.open_severities`), and whether the load at the door was rejected. So a second report never
downgrades a critical door, and resolving one issue never clears a door another still flags.
"""

from collections.abc import Iterable
from enum import StrEnum

from app.domain.enums import DockStatus, LifecyclePhase, OrderType, Severity


class DockEvent(StrEnum):
    TRAILER_ARRIVED = "trailer_arrived"
    INSPECTION_SUBMITTED = "inspection_submitted"
    WORK_STARTED = "work_started"
    ISSUE_REPORTED = "issue_reported"
    ISSUE_ESCALATED = "issue_escalated"
    ISSUE_RESOLVED = "issue_resolved"
    LOAD_REJECTED = "load_rejected"  # a supervisor's Full Reject: the door stays flagged
    ORDER_COMPLETED = "order_completed"
    # The door's open issues changed other than by one report or decision (a simulator reset).
    ISSUES_CHANGED = "issues_changed"


SEVERITY_RANK: dict[Severity, int] = {
    Severity.LOW: 0,
    Severity.MEDIUM: 1,
    Severity.HIGH: 2,
    Severity.CRITICAL: 3,
}

# Phases with no trailer being worked: a door with nothing open here is idle, not active.
AT_REST: frozenset[LifecyclePhase] = frozenset({LifecyclePhase.IDLE, LifecyclePhase.COMPLETE})


def worst_severity(severities: Iterable[Severity | None]) -> Severity | None:
    known = [severity for severity in severities if severity is not None]
    return max(known, key=SEVERITY_RANK.__getitem__) if known else None


def door_status(
    open_severity: Severity | None, phase: LifecyclePhase, *, rejected: bool = False
) -> DockStatus:
    """What the door says, from what is open on it: critical if any open issue is critical; an issue
    if any is open or its load was rejected; otherwise active while a trailer is worked, else idle."""
    if open_severity is Severity.CRITICAL:
        return DockStatus.CRITICAL
    if open_severity is not None or rejected:
        return DockStatus.ISSUE
    return DockStatus.IDLE if phase in AT_REST else DockStatus.ACTIVE


def transition(
    status: DockStatus,
    phase: LifecyclePhase,
    event: DockEvent,
    severity: Severity | None = None,
    order_type: OrderType | None = None,
    *,
    open_severity: Severity | None = None,
    rejected: bool = False,
) -> tuple[DockStatus, LifecyclePhase]:
    """`severity`: the issue the event is about. `open_severity`: the worst severity open on the door
    after the event; `rejected`: the load at the door was fully rejected (issue events only)."""
    match event:
        case DockEvent.TRAILER_ARRIVED:
            return DockStatus.ACTIVE, LifecyclePhase.INSPECTION
        case DockEvent.INSPECTION_SUBMITTED:
            return status, LifecyclePhase.INSPECTION
        case DockEvent.WORK_STARTED:
            return (
                status,
                LifecyclePhase.LOADING if order_type is OrderType.OUTBOUND else LifecyclePhase.UNLOADING,
            )
        case DockEvent.ISSUE_REPORTED | DockEvent.ISSUE_ESCALATED:
            # The issue itself is open: the door shows at least an issue, whatever else is open.
            worst = worst_severity((open_severity, severity)) or Severity.LOW
            return door_status(worst, phase, rejected=rejected), phase
        case DockEvent.ISSUE_RESOLVED | DockEvent.ISSUES_CHANGED:
            return door_status(open_severity, phase, rejected=rejected), phase
        case DockEvent.LOAD_REJECTED:
            return door_status(open_severity, phase, rejected=True), phase
        case DockEvent.ORDER_COMPLETED:
            return DockStatus.IDLE, LifecyclePhase.COMPLETE
