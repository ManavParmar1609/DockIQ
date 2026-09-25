"""Phase 3: the simulated WMS — the simulation clock, the applied-event ledger, and the columns that
keep simulated orders and issues visibly marked as simulated.

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    with op.batch_alter_table("orders") as batch:
        batch.add_column(sa.Column("simulated", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("external_ref", sa.String(64)))
        batch.add_column(sa.Column("sim_managed", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("sim_arrived_minute", sa.Float()))
        batch.add_column(sa.Column("sim_departed_minute", sa.Float()))
        batch.add_column(sa.Column("wms_synced", sa.Boolean(), nullable=False, server_default=sa.true()))
        batch.create_unique_constraint("uq_orders_external_ref", ["external_ref"])

    with op.batch_alter_table("issues") as batch:
        batch.add_column(sa.Column("simulated", sa.Boolean(), nullable=False, server_default=sa.false()))

    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("simulated", sa.Boolean(), nullable=False, server_default=sa.false()))

    op.create_table(
        "sim_state",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("seed", sa.Integer(), nullable=False),
        sa.Column("speed", sa.Float(), nullable=False),
        sa.Column("running", sa.Boolean(), nullable=False),
        sa.Column("anchor_real", TS, nullable=False),
        sa.Column("anchor_minutes", sa.Float(), nullable=False),
        sa.Column("outage_until_minute", sa.Float()),
        sa.PrimaryKeyConstraint("id", name="pk_sim_state"),
    )

    op.create_table(
        "sim_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(96), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("minute", sa.Float(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("issue_id", sa.Integer()),
        sa.Column("created_at", TS, nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_sim_events"),
        sa.UniqueConstraint("key", name="uq_sim_events_key"),
        sa.ForeignKeyConstraint(
            ["issue_id"], ["issues.id"], name="fk_sim_events_issue_id_issues", ondelete="SET NULL"
        ),
    )
    for column in ("kind", "issue_id", "created_at"):
        op.create_index(f"ix_sim_events_{column}", "sim_events", [column])


def downgrade() -> None:
    op.drop_table("sim_events")
    op.drop_table("sim_state")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("simulated")
    with op.batch_alter_table("issues") as batch:
        batch.drop_column("simulated")
    with op.batch_alter_table("orders") as batch:
        batch.drop_constraint("uq_orders_external_ref", type_="unique")
        for column in (
            "wms_synced",
            "sim_departed_minute",
            "sim_arrived_minute",
            "sim_managed",
            "external_ref",
            "simulated",
        ):
            batch.drop_column(column)
