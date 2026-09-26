"""Issue status transitions and the supervisor's decisions. See docs/architecture/business-rules.md §7.

resolution_in_progress ──┬──▶ self_resolved
                         ├──▶ escalated ──┬──▶ supervisor_resolved
                         │                ├──▶ self_resolved   (not critical; the worker's note, §7.5)
                         │                └──▶ on_hold ──▶ supervisor_resolved
                         ├──▶ on_hold      (a decision that waits on the carrier or a re-inspection)
                         └──▶ supervisor_resolved   (a supervisor may close it directly)
"""

from collections.abc import Sequence
from dataclasses import dataclass

from app.domain.enums import IssueStatus, Severity
from app.domain.taxonomy import COLD_CHAIN_ISSUE_TYPES

ALLOWED_TRANSITIONS: dict[IssueStatus, frozenset[IssueStatus]] = {
    IssueStatus.RESOLUTION_IN_PROGRESS: frozenset(
        {
            IssueStatus.SELF_RESOLVED,
            IssueStatus.ESCALATED,
            IssueStatus.ON_HOLD,
            IssueStatus.SUPERVISOR_RESOLVED,
        }
    ),
    # The reporter may still close an escalated issue that is not critical, with a note (§7.5).
    IssueStatus.ESCALATED: frozenset(
        {IssueStatus.SELF_RESOLVED, IssueStatus.ON_HOLD, IssueStatus.SUPERVISOR_RESOLVED}
    ),
    # A pending decision may be replaced by another pending one (carrier first, then a re-inspection).
    IssueStatus.ON_HOLD: frozenset({IssueStatus.ON_HOLD, IssueStatus.SUPERVISOR_RESOLVED}),
    IssueStatus.SELF_RESOLVED: frozenset(),
    IssueStatus.SUPERVISOR_RESOLVED: frozenset(),
}

OPEN_STATUSES: frozenset[IssueStatus] = frozenset(
    {IssueStatus.RESOLUTION_IN_PROGRESS, IssueStatus.ESCALATED, IssueStatus.ON_HOLD}
)


def can_transition(current: IssueStatus, target: IssueStatus) -> bool:
    return target in ALLOWED_TRANSITIONS[current]


# ── Supervisor decisions (business-rules §7.2) ──

FULL_REJECT = "Full Reject"
OVERRIDE = "Override — Accept Anyway"
REQUEST_REINSPECTION = "Request Re-inspection"
CONTACT_CARRIER = "Contact Carrier"

# Decisions that accept product: on a critical or cold-chain issue they must say why (notes required).
ACCEPT_DECISIONS: frozenset[str] = frozenset({"Accept", "Partial Accept", "Override — Accept Anyway"})

# Decisions that wait on someone else: the issue goes `on_hold`, still open, not resolved.
PENDING_DECISIONS: dict[str, str] = {
    CONTACT_CARRIER: "Awaiting the carrier",
    REQUEST_REINSPECTION: "Awaiting a re-inspection",
}


def decision_status(decision: str) -> IssueStatus:
    return IssueStatus.ON_HOLD if decision in PENDING_DECISIONS else IssueStatus.SUPERVISOR_RESOLVED


# Decisions that always carry the supervisor's reason, whatever the issue: rejecting a load and
# overriding the procedure are the two calls an auditor asks "why?" about first.
ALWAYS_NOTED_DECISIONS: frozenset[str] = frozenset({FULL_REJECT, OVERRIDE})


def decision_needs_notes(decision: str, severity: Severity, issue_type: str) -> bool:
    """Full Reject and Override always need the supervisor's reason; accepting product on a critical
    or temperature issue does too."""
    if decision in ALWAYS_NOTED_DECISIONS:
        return True
    return decision in ACCEPT_DECISIONS and (
        severity is Severity.CRITICAL or issue_type in COLD_CHAIN_ISSUE_TYPES
    )


# ── Decision targets (business-rules §7.4): how long an open issue may wait for its decision ──

# Minutes from the issue reaching the queue (escalated, else filed) to a supervisor's decision. An
# acknowledgement ("on my way") does not stop the clock; a pending decision (`on_hold`) does.
DECISION_TARGET_MINUTES: dict[Severity, int] = {
    Severity.CRITICAL: 15,  # people or product at risk now: the 10-minute re-probe (§4.2) plus the walk
    Severity.HIGH: 60,  # within the hour: a trailer at the door past 30 minutes already scores higher (§1.4)
    Severity.MEDIUM: 240,  # half a shift
    Severity.LOW: 480,  # the same shift: nothing low is handed over undecided (§12.1, 480-minute shift)
}


def is_overdue(status: IssueStatus, severity: Severity, minutes_waiting: float) -> bool:
    """An open issue without a decision, waiting longer than its severity's target."""
    if status not in OPEN_STATUSES or status is IssueStatus.ON_HOLD:
        return False
    return minutes_waiting > DECISION_TARGET_MINUTES[severity]


# ── Guardrails (business-rules §7.1): a critical issue is always a supervisor's decision ──


def requires_supervisor(severity: Severity) -> bool:
    """A critical issue is escalated the moment it is filed and cannot be self-resolved."""
    return severity is Severity.CRITICAL


# ── Self-resolve (business-rules §7.5): the reporting worker closes their own issue ──


def can_self_resolve(status: IssueStatus, severity: Severity) -> bool:
    """Any open issue of the reporter's that is not critical, `resolution_in_progress` or `escalated`
    (acknowledged or not). Never `on_hold`: that is a supervisor's pending decision."""
    return can_transition(status, IssueStatus.SELF_RESOLVED) and not requires_supervisor(severity)


def self_resolve_needs_note(status: IssueStatus) -> bool:
    """Closing an escalated issue takes it back from the supervisor's queue: the worker says why."""
    return status is IssueStatus.ESCALATED


def why_not_self_resolve(status: IssueStatus, severity: Severity) -> str | None:
    """The worker's reason, in their words, when they may not close it themselves; None when they may."""
    if can_self_resolve(status, severity):
        return None
    if status not in OPEN_STATUSES:
        return "Already resolved."
    if requires_supervisor(severity):
        return "Critical: your supervisor decides. A critical issue cannot be resolved on your own."
    return "Your supervisor has a decision pending on it (on hold), so they close it."


@dataclass(frozen=True, slots=True)
class Rejection:
    by: str
    reason: str | None


def completion_blockers(
    open_critical: int,
    inspection_failed: bool,
    inspection_cleared: bool,
    *,
    rejections: Sequence[Rejection] = (),
    reinspection_requested_by: Sequence[str] = (),
) -> list[str]:
    """Why an order cannot be signed off yet — empty when it can.

    `inspection_failed`: the most recent trailer inspection for the order failed.
    `inspection_cleared`: a supervisor has since resolved an issue on this order (their decision on
    the failed trailer).
    `rejections`: Full Reject decisions on the order — a rejected load is never signed off.
    `reinspection_requested_by`: supervisors whose re-inspection request no passing inspection has met.
    """
    blockers: list[str] = []
    for rejection in rejections:
        reason = (rejection.reason or "").strip()
        blockers.append(f"Rejected by {rejection.by}" + (f" — {reason}" if reason else "."))
    if open_critical:
        noun = "issue is" if open_critical == 1 else "issues are"
        blockers.append(f"{open_critical} critical {noun} still open: your supervisor decides first.")
    if inspection_failed and not inspection_cleared:
        blockers.append(
            "The trailer failed inspection. Report it and escalate; a supervisor decides before sign-off."
        )
    for name in reinspection_requested_by:
        blockers.append(f"Re-inspection requested by {name}: a new trailer inspection must pass first.")
    return blockers
