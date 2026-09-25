"""The warehouse behind the simulated WMS: licence-plated stock, the movement ledger, the task queue,
shipments (ASNs, waves, ship confirmations) and the gate log. See business-rules §12.7–§12.11.

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TS = sa.DateTime(timezone=True)

MOVEMENT_KINDS = ("receive", "putaway", "replenish", "pick", "load", "ship", "adjust")
TASK_KINDS = ("putaway", "pick", "replenish", "cycle_count")
TASK_STATUSES = ("open", "assigned", "done", "cancelled")
SHIPMENT_STATUSES = (
    "expected",
    "arrived",
    "receiving",
    "received",
    "released",
    "staged",
    "loading",
    "shipped",
    "cancelled",
)
YARD_EVENT_KINDS = ("gate_in", "yard_move", "gate_out")


def pk(table: str) -> sa.PrimaryKeyConstraint:
    return sa.PrimaryKeyConstraint("id", name=f"pk_{table}")


def one_of(table: str, column: str, *values: str) -> sa.CheckConstraint:
    allowed = ", ".join(f"'{v}'" for v in values)
    return sa.CheckConstraint(f"{column} IN ({allowed})", name=f"ck_{table}_{column}")


def indexes(table: str, *columns: str) -> None:
    for column in columns:
        op.create_index(f"ix_{table}_{column}", table, [column])


def simulated() -> sa.Column[bool]:
    return sa.Column("simulated", sa.Boolean(), nullable=False, server_default=sa.true())


def upgrade() -> None:
    with op.batch_alter_table("sim_state") as batch:
        batch.add_column(sa.Column("ledger_minute", sa.Float()))
        batch.add_column(sa.Column("next_lpn", sa.Integer(), nullable=False, server_default="0"))

    op.create_table(
        "wms_stock",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("lpn", sa.String(24), nullable=False),
        sa.Column("location", sa.String(32), nullable=False),
        sa.Column("area", sa.String(16), nullable=False),
        sa.Column("room", sa.String(4)),
        sa.Column("sku", sa.String(32), nullable=False),
        sa.Column("lot", sa.String(16), nullable=False),
        sa.Column("best_before", sa.Date(), nullable=False),
        sa.Column("cases", sa.Integer(), nullable=False),
        pk("wms_stock"),
        sa.UniqueConstraint("lpn", "location", name="uq_wms_stock_lpn"),
        sa.CheckConstraint("cases > 0", name="ck_wms_stock_cases"),
    )
    indexes("wms_stock", "lpn", "location", "area", "sku")

    op.create_table(
        "wms_transactions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(96), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("minute", sa.Float(), nullable=False),
        sa.Column("lpn", sa.String(24), nullable=False),
        sa.Column("sku", sa.String(32), nullable=False),
        sa.Column("lot", sa.String(16), nullable=False),
        sa.Column("best_before", sa.Date(), nullable=False),
        sa.Column("from_location", sa.String(32)),
        sa.Column("to_location", sa.String(32)),
        sa.Column("cases", sa.Integer(), nullable=False),
        sa.Column("actor", sa.String(32), nullable=False),
        sa.Column("ref", sa.String(96)),
        simulated(),
        sa.Column("created_at", TS, nullable=False),
        pk("wms_transactions"),
        sa.UniqueConstraint("key", name="uq_wms_transactions_key"),
        one_of("wms_transactions", "kind", *MOVEMENT_KINDS),
    )
    indexes("wms_transactions", "kind", "minute", "lpn", "sku", "actor")

    op.create_table(
        "wms_tasks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(96), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("sku", sa.String(32), nullable=False),
        sa.Column("lpn", sa.String(24)),
        sa.Column("from_location", sa.String(32)),
        sa.Column("to_location", sa.String(32)),
        sa.Column("cases", sa.Integer(), nullable=False),
        sa.Column("assignee", sa.String(32), nullable=False),
        sa.Column("created_minute", sa.Float(), nullable=False),
        sa.Column("assigned_minute", sa.Float(), nullable=False),
        sa.Column("done_minute", sa.Float(), nullable=False),
        sa.Column("ref", sa.String(96)),
        sa.Column("counted_cases", sa.Integer()),
        sa.Column("cleared_minute", sa.Float()),
        sa.Column("note", sa.String(120)),
        simulated(),
        pk("wms_tasks"),
        sa.UniqueConstraint("key", name="uq_wms_tasks_key"),
        one_of("wms_tasks", "kind", *TASK_KINDS),
        one_of("wms_tasks", "status", *TASK_STATUSES),
    )
    indexes("wms_tasks", "kind", "status", "sku", "assignee", "done_minute", "ref")

    op.create_table(
        "wms_shipments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("direction", sa.String(32), nullable=False),
        sa.Column("order_number", sa.String(32), nullable=False),
        sa.Column("customer", sa.String(120), nullable=False),
        sa.Column("carrier", sa.String(8), nullable=False),
        sa.Column("trailer", sa.String(32), nullable=False),
        sa.Column("door", sa.Integer(), nullable=False),
        sa.Column("wave", sa.String(16)),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("created_minute", sa.Float(), nullable=False),
        sa.Column("arrived_minute", sa.Float()),
        sa.Column("completed_minute", sa.Float()),
        sa.Column("seal", sa.String(64)),
        sa.Column("confirmation", sa.String(32)),
        sa.Column("pallets", sa.Integer(), nullable=False),
        sa.Column("lines", sa.JSON(), nullable=False),
        simulated(),
        pk("wms_shipments"),
        sa.UniqueConstraint("key", name="uq_wms_shipments_key"),
        one_of("wms_shipments", "direction", "inbound", "outbound"),
        one_of("wms_shipments", "status", *SHIPMENT_STATUSES),
    )
    indexes("wms_shipments", "direction", "status", "created_minute")

    op.create_table(
        "wms_yard_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(96), nullable=False),
        sa.Column("ref", sa.String(64), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("minute", sa.Float(), nullable=False),
        sa.Column("trailer", sa.String(32), nullable=False),
        sa.Column("carrier", sa.String(8), nullable=False),
        sa.Column("door", sa.Integer()),
        sa.Column("yard_spot", sa.String(8)),
        sa.Column("seal", sa.String(64)),
        sa.Column("reefer_temp", sa.Float()),
        sa.Column("dwell_minutes", sa.Float()),
        sa.Column("late", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("detention", sa.Boolean(), nullable=False, server_default=sa.false()),
        simulated(),
        pk("wms_yard_events"),
        sa.UniqueConstraint("key", name="uq_wms_yard_events_key"),
        one_of("wms_yard_events", "kind", *YARD_EVENT_KINDS),
    )
    indexes("wms_yard_events", "ref", "kind", "minute")


def downgrade() -> None:
    for table in ("wms_yard_events", "wms_shipments", "wms_tasks", "wms_transactions", "wms_stock"):
        op.drop_table(table)
    with op.batch_alter_table("sim_state") as batch:
        batch.drop_column("next_lpn")
        batch.drop_column("ledger_minute")
