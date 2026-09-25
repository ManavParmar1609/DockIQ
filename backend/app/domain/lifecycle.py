"""Issue status transitions. See docs/architecture/business-rules.md §7.

resolution_in_progress ──┬──▶ self_resolved
                         ├──▶ escalated ──▶ supervisor_resolved
                         └──▶ supervisor_resolved   (a supervisor may close it directly)
"""

from app.domain.enums import IssueStatus

ALLOWED_TRANSITIONS: dict[IssueStatus, frozenset[IssueStatus]] = {
    IssueStatus.RESOLUTION_IN_PROGRESS: frozenset(
        {IssueStatus.SELF_RESOLVED, IssueStatus.ESCALATED, IssueStatus.SUPERVISOR_RESOLVED}
    ),
    IssueStatus.ESCALATED: frozenset({IssueStatus.SUPERVISOR_RESOLVED}),
    IssueStatus.SELF_RESOLVED: frozenset(),
    IssueStatus.SUPERVISOR_RESOLVED: frozenset(),
}

OPEN_STATUSES: frozenset[IssueStatus] = frozenset({IssueStatus.RESOLUTION_IN_PROGRESS, IssueStatus.ESCALATED})


def can_transition(current: IssueStatus, target: IssueStatus) -> bool:
    return target in ALLOWED_TRANSITIONS[current]
