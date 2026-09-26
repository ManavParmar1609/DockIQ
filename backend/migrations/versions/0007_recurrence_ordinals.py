"""Data only: recurring-pattern messages stored before the ordinal fix (business-rules §6) read
"the 3th" or "the 1th"; they are rewritten to English ordinals — 1st, 2nd, 3rd, 4th, 11th, 21st.

Only `issues.recurring_patterns[*].message` changes, and only the count after "the" in the message
("This is the 3th 'Damaged Pallet' at Dock 4 …"). The helper is copied here, not imported: a
migration keeps the behaviour it was written with.

The downgrade leaves the corrected text: nothing records the wrong form, and it was wrong.

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-25
"""

import re
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# "the 3th", "the 11st", "the 22th": a number with any English ordinal suffix, after "the ".
ORDINAL_AFTER_THE = re.compile(r"\b(the )(\d+)(st|nd|rd|th)\b")


def ordinal(n: int) -> str:
    """As `app.domain.recurrence.ordinal`: 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st, 101st, 111th."""
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def corrected(message: str) -> str:
    return ORDINAL_AFTER_THE.sub(lambda match: match.group(1) + ordinal(int(match.group(2))), message)


def corrected_patterns(patterns: Any) -> Any:
    """The same list with each message's ordinal corrected; anything not shaped like one is kept."""
    if not isinstance(patterns, list):
        return patterns
    fixed: list[Any] = []
    for pattern in patterns:
        if isinstance(pattern, dict) and isinstance(pattern.get("message"), str):
            pattern = {**pattern, "message": corrected(pattern["message"])}
        fixed.append(pattern)
    return fixed


def upgrade() -> None:
    issues = sa.table("issues", sa.column("id", sa.Integer), sa.column("recurring_patterns", sa.JSON))
    connection = op.get_bind()
    rows = connection.execute(sa.select(issues.c.id, issues.c.recurring_patterns)).all()
    for issue_id, patterns in rows:
        fixed = corrected_patterns(patterns)
        if fixed != patterns:
            connection.execute(
                issues.update().where(issues.c.id == issue_id).values(recurring_patterns=fixed)
            )


def downgrade() -> None:
    pass
