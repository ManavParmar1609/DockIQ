"""A procedure's suggested decision (advice only), a cancelled quick request, and a report's
idempotency key so a report retried from an offline queue is filed once.
See business-rules §3.4, §7.2 and functional-specs §2.4 and §2.7.

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TS = sa.DateTime(timezone=True)

REQUEST_STATUSES = ("pending", "fulfilled")


def one_of(column: str, *values: str) -> str:
    return f"{column} IN ({', '.join(f"'{v}'" for v in values)})"


def upgrade() -> None:
    with op.batch_alter_table("knowledge_base") as batch:
        batch.add_column(sa.Column("suggested_decision", sa.String(64)))

    with op.batch_alter_table("quick_requests") as batch:
        batch.add_column(sa.Column("cancelled_at", TS))
        batch.drop_constraint("ck_quick_requests_status", type_="check")
        batch.create_check_constraint(
            "ck_quick_requests_status", one_of("status", *REQUEST_STATUSES, "cancelled")
        )

    with op.batch_alter_table("issues") as batch:
        batch.add_column(sa.Column("client_key", sa.String(64)))
        batch.create_unique_constraint("uq_issues_client_key", ["client_key"])


def downgrade() -> None:
    with op.batch_alter_table("issues") as batch:
        batch.drop_constraint("uq_issues_client_key", type_="unique")
        batch.drop_column("client_key")

    # The older vocabulary has no `cancelled`: a withdrawn request is removed with it.
    requests = sa.table("quick_requests", sa.column("status", sa.String))
    op.execute(requests.delete().where(requests.c.status == "cancelled"))
    with op.batch_alter_table("quick_requests") as batch:
        batch.drop_constraint("ck_quick_requests_status", type_="check")
        batch.create_check_constraint("ck_quick_requests_status", one_of("status", *REQUEST_STATUSES))
        batch.drop_column("cancelled_at")

    with op.batch_alter_table("knowledge_base") as batch:
        batch.drop_column("suggested_decision")
