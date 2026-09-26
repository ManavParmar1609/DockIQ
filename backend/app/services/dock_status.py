"""A door's status after an issue event, from everything open on it (business-rules §7.7).

The rule is `domain.dock.transition`; this fetches what it needs — the severities open on the door
and whether its load was rejected — so no caller decides a door's status from one issue alone.
"""

from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.dock import DockEvent, transition, worst_severity
from app.domain.enums import Severity
from app.models import DockDoor
from app.queries import door_issues


async def apply_issue_event(
    session: AsyncSession, dock: DockDoor, event: DockEvent, severity: Severity | None = None
) -> None:
    """Move the door for `event`. Call it after the issue's own status has changed on the session:
    the query flushes it first, so the issue is counted as it now is."""
    severities, rejected = await door_issues(session, dock)
    dock.status, dock.lifecycle_phase = transition(
        dock.status,
        dock.lifecycle_phase,
        event,
        severity,
        open_severity=worst_severity(severities),
        rejected=rejected,
    )
