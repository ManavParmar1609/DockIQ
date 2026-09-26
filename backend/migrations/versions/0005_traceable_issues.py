"""Traceable issues and the decisions that act on them: who acknowledged, a non-terminal `on_hold`
status, the reading / quantity / lot / room as reported, the order as it was when filed, the simulated
minute, quality hold and disposition; the HACCP probe log and receiving checks per order; the load
guide's step per order; the handoff read receipt; `hold` and `release` ledger movements.
See business-rules §7, §11 and §12.7.

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TS = sa.DateTime(timezone=True)

ISSUE_STATUSES = ("resolution_in_progress", "self_resolved", "escalated", "supervisor_resolved")
MOVEMENT_KINDS = ("receive", "putaway", "replenish", "pick", "load", "ship", "adjust")
DISPOSITIONS = ("hold", "release", "destroy", "return_to_vendor")
PROBE_STATUSES = ("not_applicable", "ok", "marginal", "warning", "critical")


def one_of(column: str, *values: str) -> str:
    return f"{column} IN ({', '.join(f"'{v}'" for v in values)})"


def upgrade() -> None:
    with op.batch_alter_table("issues") as batch:
        batch.add_column(sa.Column("acknowledged_by", sa.Integer()))
        batch.add_column(sa.Column("on_hold_at", TS))
        batch.add_column(sa.Column("temp_reading", sa.Float()))
        batch.add_column(sa.Column("temp_limit", sa.Float()))
        batch.add_column(sa.Column("quantity_affected", sa.Integer()))
        batch.add_column(sa.Column("lot", sa.String(16)))
        batch.add_column(sa.Column("room", sa.String(4)))
        batch.add_column(sa.Column("order_number", sa.String(32)))
        batch.add_column(sa.Column("trailer_number", sa.String(32)))
        batch.add_column(sa.Column("bol_number", sa.String(32)))
        batch.add_column(sa.Column("sim_minute", sa.Float()))
        batch.add_column(sa.Column("held_pallets", sa.JSON(), nullable=False, server_default=sa.text("'[]'")))
        batch.add_column(sa.Column("disposition", sa.String(32)))
        batch.add_column(sa.Column("disposition_notes", sa.Text()))
        batch.add_column(sa.Column("disposition_by", sa.Integer()))
        batch.add_column(sa.Column("disposition_at", TS))
        batch.create_foreign_key("fk_issues_acknowledged_by_users", "users", ["acknowledged_by"], ["id"])
        batch.create_foreign_key("fk_issues_disposition_by_users", "users", ["disposition_by"], ["id"])
        batch.create_index("ix_issues_acknowledged_by", ["acknowledged_by"])
        batch.create_index("ix_issues_disposition_by", ["disposition_by"])
        batch.drop_constraint("ck_issues_status", type_="check")
        batch.create_check_constraint("ck_issues_status", one_of("status", *ISSUE_STATUSES, "on_hold"))
        batch.create_check_constraint("ck_issues_disposition", one_of("disposition", *DISPOSITIONS))

    # Back-fill: the order as it is now, and who acknowledged (until now the one `supervisor_id`).
    issues = sa.table(
        "issues",
        sa.column("order_id", sa.Integer),
        sa.column("order_number", sa.String),
        sa.column("trailer_number", sa.String),
        sa.column("bol_number", sa.String),
        sa.column("supervisor_id", sa.Integer),
        sa.column("acknowledged_by", sa.Integer),
        sa.column("acknowledged_at", TS),
    )
    orders = sa.table(
        "orders",
        sa.column("id", sa.Integer),
        sa.column("order_number", sa.String),
        sa.column("trailer_number", sa.String),
        sa.column("bol_number", sa.String),
    )

    def of_order(column: str) -> sa.ScalarSelect[str]:
        return sa.select(orders.c[column]).where(orders.c.id == issues.c.order_id).scalar_subquery()

    op.execute(
        issues.update()
        .where(issues.c.order_id.is_not(None))
        .values(
            order_number=of_order("order_number"),
            trailer_number=of_order("trailer_number"),
            bol_number=of_order("bol_number"),
        )
    )
    op.execute(
        issues.update()
        .where(issues.c.acknowledged_at.is_not(None))
        .values(acknowledged_by=issues.c.supervisor_id)
    )

    with op.batch_alter_table("wms_transactions") as batch:
        batch.drop_constraint("ck_wms_transactions_kind", type_="check")
        batch.create_check_constraint(
            "ck_wms_transactions_kind", one_of("kind", *MOVEMENT_KINDS, "hold", "release")
        )

    with op.batch_alter_table("orders") as batch:
        batch.add_column(sa.Column("load_step", sa.Integer()))

    with op.batch_alter_table("shift_handoffs") as batch:
        batch.add_column(sa.Column("read_by", sa.Integer()))
        batch.add_column(sa.Column("read_at", TS))
        batch.create_foreign_key("fk_shift_handoffs_read_by_users", "users", ["read_by"], ["id"])
        batch.create_index("ix_shift_handoffs_read_by", ["read_by"])

    op.create_table(
        "temperature_checks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("order_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("reading", sa.Float(), nullable=False),
        sa.Column("limit", sa.Float()),
        sa.Column("delta", sa.Float()),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("issue_id", sa.Integer()),
        sa.Column("created_at", TS, nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_temperature_checks"),
        sa.ForeignKeyConstraint(
            ["order_id"], ["orders.id"], name="fk_temperature_checks_order_id_orders", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_temperature_checks_user_id_users"),
        sa.ForeignKeyConstraint(
            ["issue_id"], ["issues.id"], name="fk_temperature_checks_issue_id_issues", ondelete="SET NULL"
        ),
        sa.CheckConstraint(one_of("status", *PROBE_STATUSES), name="ck_temperature_checks_status"),
    )
    for column in ("order_id", "user_id", "issue_id", "created_at"):
        op.create_index(f"ix_temperature_checks_{column}", "temperature_checks", [column])

    op.create_table(
        "receiving_checks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("order_id", sa.Integer(), nullable=False),
        sa.Column("check_id", sa.String(32), nullable=False),
        sa.Column("answer", sa.Boolean(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("answered_at", TS, nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_receiving_checks"),
        sa.ForeignKeyConstraint(
            ["order_id"], ["orders.id"], name="fk_receiving_checks_order_id_orders", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_receiving_checks_user_id_users"),
        sa.UniqueConstraint("order_id", "check_id", name="uq_receiving_checks_order_id"),
    )
    for column in ("order_id", "user_id"):
        op.create_index(f"ix_receiving_checks_{column}", "receiving_checks", [column])


def downgrade() -> None:
    op.drop_table("receiving_checks")
    op.drop_table("temperature_checks")

    with op.batch_alter_table("shift_handoffs") as batch:
        batch.drop_index("ix_shift_handoffs_read_by")
        batch.drop_constraint("fk_shift_handoffs_read_by_users", type_="foreignkey")
        batch.drop_column("read_at")
        batch.drop_column("read_by")

    with op.batch_alter_table("orders") as batch:
        batch.drop_column("load_step")

    # The older vocabularies have no `on_hold`, `hold` or `release`: map them onto the nearest state.
    issues = sa.table("issues", sa.column("status", sa.String))
    op.execute(issues.update().where(issues.c.status == "on_hold").values(status="escalated"))
    moves = sa.table("wms_transactions", sa.column("kind", sa.String))
    op.execute(moves.update().where(moves.c.kind.in_(("hold", "release"))).values(kind="putaway"))
    with op.batch_alter_table("wms_transactions") as batch:
        batch.drop_constraint("ck_wms_transactions_kind", type_="check")
        batch.create_check_constraint("ck_wms_transactions_kind", one_of("kind", *MOVEMENT_KINDS))

    with op.batch_alter_table("issues") as batch:
        batch.drop_constraint("ck_issues_disposition", type_="check")
        batch.drop_constraint("ck_issues_status", type_="check")
        batch.create_check_constraint("ck_issues_status", one_of("status", *ISSUE_STATUSES))
        batch.drop_index("ix_issues_disposition_by")
        batch.drop_index("ix_issues_acknowledged_by")
        batch.drop_constraint("fk_issues_disposition_by_users", type_="foreignkey")
        batch.drop_constraint("fk_issues_acknowledged_by_users", type_="foreignkey")
        for column in (
            "disposition_at",
            "disposition_by",
            "disposition_notes",
            "disposition",
            "held_pallets",
            "sim_minute",
            "bol_number",
            "trailer_number",
            "order_number",
            "room",
            "lot",
            "quantity_affected",
            "temp_limit",
            "temp_reading",
            "on_hold_at",
            "acknowledged_by",
        ):
            batch.drop_column(column)
