"""Initial schema: the SQLite prototype's 14 tables, now with foreign keys, indexes, CHECK-constrained
enums, JSON columns and timezone-aware timestamps.

Revision ID: 0001
Revises:
Create Date: 2026-09-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TS = sa.DateTime(timezone=True)
MONEY = sa.Numeric(12, 2)


def pk(table: str) -> sa.PrimaryKeyConstraint:
    return sa.PrimaryKeyConstraint("id", name=f"pk_{table}")


def fk(table: str, column: str, target: str, **kwargs: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        [column], [f"{target}.id"], name=f"fk_{table}_{column}_{target}", **kwargs
    )


def one_of(table: str, column: str, *values: str) -> sa.CheckConstraint:
    allowed = ", ".join(f"'{v}'" for v in values)
    return sa.CheckConstraint(f"{column} IN ({allowed})", name=f"ck_{table}_{column}")


def indexes(table: str, *columns: str) -> None:
    for column in columns:
        op.create_index(f"ix_{table}_{column}", table, [column])


SEVERITIES = ("low", "medium", "high", "critical")
CONFIDENCES = ("low", "medium", "high")


def upgrade() -> None:
    op.create_table(
        "companies",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("tier", sa.Integer(), nullable=False),
        sa.Column("count_tolerance", sa.Float(), nullable=False),
        sa.Column("load_pattern", sa.JSON(), nullable=False),
        sa.Column("sop_rules", sa.JSON(), nullable=False),
        pk("companies"),
        sa.UniqueConstraint("name", name="uq_companies_name"),
        sa.CheckConstraint("tier IN (1, 2, 3)", name="ck_companies_tier"),
    )

    op.create_table(
        "carriers",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("code", sa.String(8), nullable=False),
        pk("carriers"),
        sa.UniqueConstraint("code", name="uq_carriers_code"),
    )

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("role", sa.String(32), nullable=False),
        sa.Column("employee_id", sa.String(32), nullable=False),
        sa.Column("shift", sa.String(16), nullable=False),
        sa.Column("zone", sa.String(32)),
        sa.Column("experience_level", sa.String(32)),
        pk("users"),
        sa.UniqueConstraint("employee_id", name="uq_users_employee_id"),
        one_of("users", "role", "operator", "supervisor"),
    )
    indexes("users", "role")

    op.create_table(
        "knowledge_base",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("issue_type", sa.String(64), nullable=False),
        sa.Column("scenario", sa.String(200), nullable=False),
        sa.Column("keywords", sa.JSON(), nullable=False),
        sa.Column("resolution_steps", sa.JSON(), nullable=False),
        sa.Column("confidence", sa.String(32), nullable=False),
        sa.Column("source_reference", sa.String(200), nullable=False),
        sa.Column("applicable_categories", sa.JSON(), nullable=False),
        sa.Column("applicable_companies", sa.JSON(), nullable=False),
        pk("knowledge_base"),
        one_of("knowledge_base", "confidence", *CONFIDENCES),
    )
    indexes("knowledge_base", "issue_type")

    op.create_table(
        "products",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("sku", sa.String(32), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("category", sa.String(32), nullable=False),
        sa.Column("weight_per_case", sa.Float(), nullable=False),
        sa.Column("cases_per_pallet", sa.Integer(), nullable=False),
        sa.Column("temp_min", sa.Float()),
        sa.Column("temp_max", sa.Float()),
        sa.Column("is_allergen", sa.Boolean(), nullable=False),
        sa.Column("lot_tracking_required", sa.Boolean(), nullable=False),
        sa.Column("case_value", MONEY, nullable=False),
        pk("products"),
        fk("products", "company_id", "companies"),
        sa.UniqueConstraint("sku", name="uq_products_sku"),
        one_of("products", "category", "Frozen", "Refrigerated", "Produce", "Dry"),
    )
    indexes("products", "company_id")

    # dock_doors <-> orders reference each other; the dock -> order key is added after both exist.
    op.create_table(
        "dock_doors",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("door_number", sa.Integer(), nullable=False),
        sa.Column("zone", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("lifecycle_phase", sa.String(32), nullable=False),
        sa.Column("current_trailer", sa.String(32)),
        sa.Column("current_order_id", sa.Integer()),
        sa.Column("current_operator_id", sa.Integer()),
        sa.Column("trailer_arrived_at", TS),
        sa.Column("last_activity_at", TS),
        pk("dock_doors"),
        fk("dock_doors", "current_operator_id", "users"),
        sa.UniqueConstraint("door_number", name="uq_dock_doors_door_number"),
        one_of("dock_doors", "status", "idle", "active", "issue", "critical"),
        one_of("dock_doors", "lifecycle_phase", "idle", "inspection", "loading", "unloading", "complete"),
    )
    indexes("dock_doors", "current_order_id", "current_operator_id")

    op.create_table(
        "orders",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("order_number", sa.String(32), nullable=False),
        sa.Column("type", sa.String(32), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("carrier_id", sa.Integer(), nullable=False),
        sa.Column("trailer_number", sa.String(32), nullable=False),
        sa.Column("bol_number", sa.String(32), nullable=False),
        sa.Column("dock_door_id", sa.Integer()),
        sa.Column("operator_id", sa.Integer()),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("seal_number", sa.String(64)),
        sa.Column("notes", sa.Text()),
        sa.Column("created_at", TS, nullable=False),
        sa.Column("completed_at", TS),
        pk("orders"),
        fk("orders", "company_id", "companies"),
        fk("orders", "carrier_id", "carriers"),
        fk("orders", "dock_door_id", "dock_doors"),
        fk("orders", "operator_id", "users"),
        sa.UniqueConstraint("order_number", name="uq_orders_order_number"),
        one_of("orders", "type", "inbound", "outbound"),
        one_of("orders", "status", "pending", "in_progress", "complete"),
    )
    indexes("orders", "company_id", "carrier_id", "dock_door_id", "operator_id", "status", "created_at")

    with op.batch_alter_table("dock_doors") as batch:
        batch.create_foreign_key(
            "fk_dock_doors_current_order_id_orders", "orders", ["current_order_id"], ["id"], ondelete="SET NULL"
        )

    op.create_table(
        "order_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("order_id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("expected_quantity", sa.Integer(), nullable=False),
        sa.Column("actual_quantity", sa.Integer(), nullable=False),
        sa.Column("verified", sa.Boolean(), nullable=False),
        pk("order_items"),
        fk("order_items", "order_id", "orders", ondelete="CASCADE"),
        fk("order_items", "product_id", "products"),
        sa.UniqueConstraint("order_id", "product_id", name="uq_order_items_order_id"),
        sa.CheckConstraint("expected_quantity >= 0 AND actual_quantity >= 0", name="ck_order_items_quantities"),
    )
    indexes("order_items", "order_id", "product_id")

    op.create_table(
        "issues",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("order_id", sa.Integer()),
        sa.Column("dock_door_id", sa.Integer()),
        sa.Column("operator_id", sa.Integer()),
        sa.Column("supervisor_id", sa.Integer()),
        sa.Column("issue_type", sa.String(64), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("quick_tags", sa.JSON(), nullable=False),
        sa.Column("severity", sa.String(32), nullable=False),
        sa.Column("severity_score", sa.Float()),
        sa.Column("severity_reason", sa.Text()),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("ai_resolution", sa.JSON()),
        sa.Column("ai_confidence", sa.String(32)),
        sa.Column("resolution_type", sa.String(64)),
        sa.Column("resolution_notes", sa.Text()),
        sa.Column("supervisor_notes", sa.Text()),
        sa.Column("product_id", sa.Integer()),
        sa.Column("company_id", sa.Integer()),
        sa.Column("carrier_id", sa.Integer()),
        sa.Column("estimated_cost_impact", MONEY, nullable=False),
        sa.Column("escalated_at", TS),
        sa.Column("acknowledged_at", TS),
        sa.Column("resolved_at", TS),
        sa.Column("created_at", TS, nullable=False),
        pk("issues"),
        fk("issues", "order_id", "orders"),
        fk("issues", "dock_door_id", "dock_doors"),
        fk("issues", "operator_id", "users"),
        fk("issues", "supervisor_id", "users"),
        fk("issues", "product_id", "products"),
        fk("issues", "company_id", "companies"),
        fk("issues", "carrier_id", "carriers"),
        one_of("issues", "severity", *SEVERITIES),
        one_of("issues", "status", "resolution_in_progress", "self_resolved", "escalated", "supervisor_resolved"),
        one_of("issues", "ai_confidence", *CONFIDENCES),
    )
    indexes(
        "issues",
        "order_id",
        "dock_door_id",
        "operator_id",
        "supervisor_id",
        "issue_type",
        "severity",
        "status",
        "product_id",
        "company_id",
        "carrier_id",
        "created_at",
    )

    op.create_table(
        "trailer_inspections",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("order_id", sa.Integer()),
        sa.Column("dock_door_id", sa.Integer(), nullable=False),
        sa.Column("operator_id", sa.Integer(), nullable=False),
        sa.Column("seal_condition", sa.String(32), nullable=False),
        sa.Column("interior_cleanliness", sa.String(32), nullable=False),
        sa.Column("interior_temperature", sa.Float()),
        sa.Column("visible_damage", sa.String(32), nullable=False),
        sa.Column("overall_pass", sa.Boolean(), nullable=False),
        sa.Column("notes", sa.Text()),
        sa.Column("created_at", TS, nullable=False),
        pk("trailer_inspections"),
        fk("trailer_inspections", "order_id", "orders"),
        fk("trailer_inspections", "dock_door_id", "dock_doors"),
        fk("trailer_inspections", "operator_id", "users"),
    )
    indexes("trailer_inspections", "order_id", "dock_door_id", "operator_id")

    op.create_table(
        "quick_requests",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("dock_door_id", sa.Integer()),
        sa.Column("operator_id", sa.Integer(), nullable=False),
        sa.Column("request_type", sa.String(64), nullable=False),
        sa.Column("details", sa.Text()),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("created_at", TS, nullable=False),
        sa.Column("fulfilled_at", TS),
        pk("quick_requests"),
        fk("quick_requests", "dock_door_id", "dock_doors"),
        fk("quick_requests", "operator_id", "users"),
        one_of("quick_requests", "status", "pending", "fulfilled"),
    )
    indexes("quick_requests", "dock_door_id", "operator_id", "status", "created_at")

    op.create_table(
        "broadcasts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("supervisor_id", sa.Integer(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("created_at", TS, nullable=False),
        pk("broadcasts"),
        fk("broadcasts", "supervisor_id", "users"),
    )
    indexes("broadcasts", "supervisor_id", "created_at")

    op.create_table(
        "shift_handoffs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("supervisor_id", sa.Integer(), nullable=False),
        sa.Column("shift", sa.String(16), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("created_at", TS, nullable=False),
        pk("shift_handoffs"),
        fk("shift_handoffs", "supervisor_id", "users"),
    )
    indexes("shift_handoffs", "supervisor_id", "created_at")

    op.create_table(
        "chat_messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(32), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("source_reference", sa.String(200)),
        sa.Column("created_at", TS, nullable=False),
        pk("chat_messages"),
        fk("chat_messages", "user_id", "users"),
        one_of("chat_messages", "role", "user", "assistant"),
    )
    indexes("chat_messages", "user_id", "created_at")


def downgrade() -> None:
    with op.batch_alter_table("dock_doors") as batch:
        batch.drop_constraint("fk_dock_doors_current_order_id_orders", type_="foreignkey")
    for table in (
        "chat_messages",
        "shift_handoffs",
        "broadcasts",
        "quick_requests",
        "trailer_inspections",
        "issues",
        "order_items",
        "orders",
        "dock_doors",
        "products",
        "knowledge_base",
        "users",
        "carriers",
        "companies",
    ):
        op.drop_table(table)
