"""Recurring-issue detection. See docs/architecture/business-rules.md §4.

The counting is a query (see `app.queries.count_recent_issues`); the decision lives here.
"""

from typing import Any

RECURRENCE_WINDOW_DAYS = 7
RECURRENCE_THRESHOLD = 3


def dock_pattern(count: int, issue_type: str, door_label: int | str, days: int) -> dict[str, Any] | None:
    if count < RECURRENCE_THRESHOLD:
        return None
    return {
        "type": "dock",
        "message": (
            f"This is the {count}th '{issue_type}' at Dock {door_label} in the last {days} days. "
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
            f"This is the {count}th '{issue_type}' from {carrier_name} in the last {days} days. "
            "Recommend carrier quality review."
        ),
        "count": count,
    }
