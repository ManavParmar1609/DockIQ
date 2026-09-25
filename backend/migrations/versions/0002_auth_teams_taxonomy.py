"""Phase 2: authentication, supervisor teams, the quality role, issue subtypes, persisted recurrence,
photo evidence, barcode identity and the scan audit trail.

Also renames the issue type 'Count Shortage' to 'Count Discrepancy' (it now covers overages).

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TS = sa.DateTime(timezone=True)


def _rename_issue_type(old: str, new: str) -> None:
    for name in ("issues", "knowledge_base"):
        table = sa.table(name, sa.column("issue_type", sa.String))
        op.execute(table.update().where(table.c.issue_type == old).values(issue_type=new))


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("password_hash", sa.String(255)))
        batch.add_column(sa.Column("supervisor_id", sa.Integer()))
        batch.add_column(sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()))
        batch.create_foreign_key("fk_users_supervisor_id_users", "users", ["supervisor_id"], ["id"])
        batch.create_index("ix_users_supervisor_id", ["supervisor_id"])
        batch.drop_constraint("ck_users_role", type_="check")
        batch.create_check_constraint("ck_users_role", "role IN ('operator', 'supervisor', 'quality')")

    with op.batch_alter_table("products") as batch:
        batch.add_column(sa.Column("gtin", sa.String(14)))
        batch.create_unique_constraint("uq_products_gtin", ["gtin"])

    with op.batch_alter_table("issues") as batch:
        batch.add_column(sa.Column("issue_subtype", sa.String(120)))
        batch.add_column(
            sa.Column("recurring_patterns", sa.JSON(), nullable=False, server_default=sa.text("'[]'"))
        )

    _rename_issue_type("Count Shortage", "Count Discrepancy")

    op.create_table(
        "issue_photos",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("issue_id", sa.Integer(), nullable=False),
        sa.Column("uploaded_by", sa.Integer(), nullable=False),
        sa.Column("content_type", sa.String(32), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", TS, nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_issue_photos"),
        sa.ForeignKeyConstraint(
            ["issue_id"], ["issues.id"], name="fk_issue_photos_issue_id_issues", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["uploaded_by"], ["users.id"], name="fk_issue_photos_uploaded_by_users"),
    )
    op.create_index("ix_issue_photos_issue_id", "issue_photos", ["issue_id"])
    op.create_index("ix_issue_photos_uploaded_by", "issue_photos", ["uploaded_by"])

    op.create_table(
        "scan_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("order_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(64), nullable=False),
        sa.Column("result", sa.String(32), nullable=False),
        sa.Column("product_id", sa.Integer()),
        sa.Column("created_at", TS, nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_scan_events"),
        sa.ForeignKeyConstraint(
            ["order_id"], ["orders.id"], name="fk_scan_events_order_id_orders", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_scan_events_user_id_users"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], name="fk_scan_events_product_id_products"),
        sa.CheckConstraint("result IN ('match', 'mismatch', 'unknown')", name="ck_scan_events_result"),
    )
    for column in ("order_id", "user_id", "product_id", "created_at"):
        op.create_index(f"ix_scan_events_{column}", "scan_events", [column])


def downgrade() -> None:
    op.drop_table("scan_events")
    op.drop_table("issue_photos")
    _rename_issue_type("Count Discrepancy", "Count Shortage")
    with op.batch_alter_table("issues") as batch:
        batch.drop_column("recurring_patterns")
        batch.drop_column("issue_subtype")
    with op.batch_alter_table("products") as batch:
        batch.drop_constraint("uq_products_gtin", type_="unique")
        batch.drop_column("gtin")
    op.execute(sa.text("DELETE FROM users WHERE role = 'quality'"))
    with op.batch_alter_table("users") as batch:
        batch.drop_constraint("ck_users_role", type_="check")
        batch.create_check_constraint("ck_users_role", "role IN ('operator', 'supervisor')")
        batch.drop_index("ix_users_supervisor_id")
        batch.drop_constraint("fk_users_supervisor_id_users", type_="foreignkey")
        batch.drop_column("is_active")
        batch.drop_column("supervisor_id")
        batch.drop_column("password_hash")
