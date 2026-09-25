"""Dock-door state transitions. See docs/requirements/functional-specs.md §4.

A door carries two fields: `status` (is something wrong here?) and `lifecycle_phase` (where is the
trailer in its visit?). Every change to either goes through `transition` so the pair is decided in
one place rather than by each route handler or the simulator.
"""

from enum import StrEnum

from app.domain.enums import DockStatus, LifecyclePhase, OrderType, Severity


class DockEvent(StrEnum):
    TRAILER_ARRIVED = "trailer_arrived"
    INSPECTION_SUBMITTED = "inspection_submitted"
    WORK_STARTED = "work_started"
    ISSUE_REPORTED = "issue_reported"
    ISSUE_ESCALATED = "issue_escalated"
    ISSUE_RESOLVED = "issue_resolved"
    ORDER_COMPLETED = "order_completed"


def transition(
    status: DockStatus,
    phase: LifecyclePhase,
    event: DockEvent,
    severity: Severity | None = None,
    order_type: OrderType | None = None,
) -> tuple[DockStatus, LifecyclePhase]:
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
        case DockEvent.ISSUE_REPORTED:
            return DockStatus.ISSUE, phase
        case DockEvent.ISSUE_ESCALATED:
            return (DockStatus.CRITICAL if severity == Severity.CRITICAL else DockStatus.ISSUE), phase
        case DockEvent.ISSUE_RESOLVED:
            return DockStatus.ACTIVE, phase
        case DockEvent.ORDER_COMPLETED:
            return DockStatus.IDLE, LifecyclePhase.COMPLETE
