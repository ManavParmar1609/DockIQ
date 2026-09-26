"""Data only: a critical issue is escalated the moment it is filed (business-rules §7.1). Rows filed
before that rule — open, critical and still `resolution_in_progress` — are moved to `escalated`, with
`escalated_at` set to when they were filed, which is when the rule would have escalated them.

The downgrade leaves them escalated: nothing records which rows this moved, and escalated is correct.

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    issues = sa.table(
        "issues",
        sa.column("severity", sa.String),
        sa.column("status", sa.String),
        sa.column("escalated_at", TS),
        sa.column("created_at", TS),
    )
    op.execute(
        issues.update()
        .where(issues.c.severity == "critical", issues.c.status == "resolution_in_progress")
        .values(status="escalated", escalated_at=sa.func.coalesce(issues.c.escalated_at, issues.c.created_at))
    )


def downgrade() -> None:
    pass
