"""Issue status transitions. See docs/architecture/business-rules.md §7.

resolution_in_progress ──┬──▶ self_resolved
                         ├──▶ escalated ──▶ supervisor_resolved
                         └──▶ supervisor_resolved   (a supervisor may close it directly)
"""

from app.domain.enums import IssueStatus, Severity

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


# ── Guardrails (business-rules §7.1): a critical issue is always a supervisor's decision ──


def requires_supervisor(severity: Severity) -> bool:
    """A critical issue is escalated the moment it is filed and cannot be self-resolved."""
    return severity is Severity.CRITICAL


def can_self_resolve(status: IssueStatus, severity: Severity) -> bool:
    return can_transition(status, IssueStatus.SELF_RESOLVED) and not requires_supervisor(severity)


def completion_blockers(open_critical: int, inspection_failed: bool, inspection_cleared: bool) -> list[str]:
    """Why an order cannot be signed off yet — empty when it can.

    `inspection_failed`: the most recent trailer inspection for the order failed.
    `inspection_cleared`: a supervisor has since resolved an issue on this order (their decision on
    the failed trailer).
    """
    blockers: list[str] = []
    if open_critical:
        noun = "issue is" if open_critical == 1 else "issues are"
        blockers.append(f"{open_critical} critical {noun} still open: your supervisor decides first.")
    if inspection_failed and not inspection_cleared:
        blockers.append(
            "The trailer failed inspection. Report it and escalate; a supervisor decides before sign-off."
        )
    return blockers
