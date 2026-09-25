"""Dock-door state transitions. See docs/requirements/functional-specs.md §5.

A door carries two fields: `status` (is something wrong here?) and `lifecycle_phase` (where is the
trailer in its visit?). Every change to either goes through `transition` so the pair is decided in
one place rather than by each route handler.
"""

from enum import StrEnum

from app.domain.enums import DockStatus, LifecyclePhase, Severity


class DockEvent(StrEnum):
    ISSUE_REPORTED = "issue_reported"
    ISSUE_ESCALATED = "issue_escalated"
    ISSUE_RESOLVED = "issue_resolved"
    INSPECTION_SUBMITTED = "inspection_submitted"
    ORDER_COMPLETED = "order_completed"


def transition(
    status: DockStatus,
    phase: LifecyclePhase,
    event: DockEvent,
    severity: Severity | None = None,
) -> tuple[DockStatus, LifecyclePhase]:
    match event:
        case DockEvent.ISSUE_REPORTED:
            return DockStatus.ISSUE, phase
        case DockEvent.ISSUE_ESCALATED:
            return (DockStatus.CRITICAL if severity == Severity.CRITICAL else DockStatus.ISSUE), phase
        case DockEvent.ISSUE_RESOLVED:
            return DockStatus.ACTIVE, phase
        case DockEvent.INSPECTION_SUBMITTED:
            return status, LifecyclePhase.INSPECTION
        case DockEvent.ORDER_COMPLETED:
            return DockStatus.IDLE, LifecyclePhase.COMPLETE
