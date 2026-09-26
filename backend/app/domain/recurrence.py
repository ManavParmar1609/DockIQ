"""Recurring-issue detection. See docs/architecture/business-rules.md §4.

The counting is a query (see `app.queries.count_recent_issues`); the decision lives here.
"""

from typing import Any

RECURRENCE_WINDOW_DAYS = 7
RECURRENCE_THRESHOLD = 3


def ordinal(n: int) -> str:
    """1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st, 22nd, 101st, 111th."""
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def dock_pattern(count: int, issue_type: str, door_label: int | str, days: int) -> dict[str, Any] | None:
    if count < RECURRENCE_THRESHOLD:
        return None
    return {
        "type": "dock",
        "message": (
            f"This is the {ordinal(count)} '{issue_type}' at Dock {door_label} in the last {days} days. "
            "Possible root cause: environmental (lighting, equipment, dock condition)."
        ),
        "count": count,
    }


def carrier_pattern(count: int, issue_type: str, carrier_name: str, days: int) -> dict[str, Any] | None:
    if count < RECURRENCE_THRESHOLD:
        return None
    return {
        "type": "carrier",
        "message": (
            f"This is the {ordinal(count)} '{issue_type}' from {carrier_name} in the last {days} days. "
            "Recommend carrier quality review."
        ),
        "count": count,
    }
