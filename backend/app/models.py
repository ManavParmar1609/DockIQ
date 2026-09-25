"""ORM models. The schema itself is owned by Alembic migrations in `backend/migrations/`."""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Float,
    ForeignKey,
    Integer,
    LargeBinary,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, UTCDateTime, enum_column, utcnow
from app.domain.enums import (
    ChatRole,
    Confidence,
    DockStatus,
    IssueStatus,
    LifecyclePhase,
    OrderStatus,
    OrderType,
    ProductCategory,
    RequestStatus,
    Role,
    ScanResult,
    Severity,
)

Money = Numeric(12, 2, asdecimal=False)


class Company(Base):
    __tablename__ = "companies"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    tier: Mapped[int] = mapped_column(Integer)
    count_tolerance: Mapped[float] = mapped_column(Float)
    load_pattern: Mapped[dict[str, Any]] = mapped_column(JSON)
    sop_rules: Mapped[dict[str, Any]] = mapped_column(JSON)


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    sku: Mapped[str] = mapped_column(String(32), unique=True)
    gtin: Mapped[str | None] = mapped_column(String(14), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    category: Mapped[ProductCategory] = mapped_column(enum_column(ProductCategory))
    weight_per_case: Mapped[float] = mapped_column(Float)
    cases_per_pallet: Mapped[int] = mapped_column(Integer)
    temp_min: Mapped[float | None] = mapped_column(Float)
    temp_max: Mapped[float | None] = mapped_column(Float)
    is_allergen: Mapped[bool] = mapped_column(Boolean, default=False)
    lot_tracking_required: Mapped[bool] = mapped_column(Boolean, default=False)
    case_value: Mapped[float] = mapped_column(Money)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    role: Mapped[Role] = mapped_column(enum_column(Role), index=True)
    employee_id: Mapped[str] = mapped_column(String(32), unique=True)
    shift: Mapped[str] = mapped_column(String(16))
    zone: Mapped[str | None] = mapped_column(String(32))
    experience_level: Mapped[str | None] = mapped_column(String(32))
    password_hash: Mapped[str | None] = mapped_column(String(255))
    # An operator's supervisor; supervisors and quality staff have none. This is the team.
    supervisor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Simulated crew (Phase 3): worked by the shift simulator, never by a person logging in.
    simulated: Mapped[bool] = mapped_column(Boolean, default=False)


class Carrier(Base):
    __tablename__ = "carriers"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    code: Mapped[str] = mapped_column(String(8), unique=True)


class DockDoor(Base):
    __tablename__ = "dock_doors"

    id: Mapped[int] = mapped_column(primary_key=True)
    door_number: Mapped[int] = mapped_column(Integer, unique=True)
    zone: Mapped[str] = mapped_column(String(32))
    status: Mapped[DockStatus] = mapped_column(enum_column(DockStatus), default=DockStatus.IDLE)
    lifecycle_phase: Mapped[LifecyclePhase] = mapped_column(
        enum_column(LifecyclePhase), default=LifecyclePhase.IDLE
    )
    current_trailer: Mapped[str | None] = mapped_column(String(32))
    # dock_doors <-> orders reference each other; use_alter breaks the creation cycle.
    current_order_id: Mapped[int | None] = mapped_column(
        ForeignKey("orders.id", use_alter=True, ondelete="SET NULL"), index=True
    )
    current_operator_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    trailer_arrived_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    last_activity_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_number: Mapped[str] = mapped_column(String(32), unique=True)
    type: Mapped[OrderType] = mapped_column(enum_column(OrderType))
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    carrier_id: Mapped[int] = mapped_column(ForeignKey("carriers.id"), index=True)
    trailer_number: Mapped[str] = mapped_column(String(32))
    bol_number: Mapped[str] = mapped_column(String(32))
    dock_door_id: Mapped[int | None] = mapped_column(ForeignKey("dock_doors.id"), index=True)
    operator_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[OrderStatus] = mapped_column(
        enum_column(OrderStatus), default=OrderStatus.PENDING, index=True
    )
    seal_number: Mapped[str | None] = mapped_column(String(64))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    # Simulation (Phase 3). `external_ref` is the WMS appointment key; `sim_managed` is cleared the
    # moment a person works the order, and the simulator stops driving it.
    simulated: Mapped[bool] = mapped_column(Boolean, default=False)
    external_ref: Mapped[str | None] = mapped_column(String(64), unique=True)
    sim_managed: Mapped[bool] = mapped_column(Boolean, default=False)
    sim_arrived_minute: Mapped[float | None] = mapped_column(Float)
    sim_departed_minute: Mapped[float | None] = mapped_column(Float)
    wms_synced: Mapped[bool] = mapped_column(Boolean, default=True)


class OrderItem(Base):
    __tablename__ = "order_items"
    __table_args__ = (UniqueConstraint("order_id", "product_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    expected_quantity: Mapped[int] = mapped_column(Integer)
    actual_quantity: Mapped[int] = mapped_column(Integer, default=0)
    verified: Mapped[bool] = mapped_column(Boolean, default=False)


class Issue(Base):
    __tablename__ = "issues"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"), index=True)
    dock_door_id: Mapped[int | None] = mapped_column(ForeignKey("dock_doors.id"), index=True)
    operator_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    supervisor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    issue_type: Mapped[str] = mapped_column(String(64), index=True)
    issue_subtype: Mapped[str | None] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(Text)
    quick_tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    severity: Mapped[Severity] = mapped_column(enum_column(Severity), index=True)
    severity_score: Mapped[float | None] = mapped_column(Float)
    severity_reason: Mapped[str | None] = mapped_column(Text)
    status: Mapped[IssueStatus] = mapped_column(
        enum_column(IssueStatus), default=IssueStatus.RESOLUTION_IN_PROGRESS, index=True
    )
    ai_resolution: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    recurring_patterns: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    ai_confidence: Mapped[Confidence | None] = mapped_column(enum_column(Confidence))
    resolution_type: Mapped[str | None] = mapped_column(String(64))
    resolution_notes: Mapped[str | None] = mapped_column(Text)
    supervisor_notes: Mapped[str | None] = mapped_column(Text)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id"), index=True)
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id"), index=True)
    carrier_id: Mapped[int | None] = mapped_column(ForeignKey("carriers.id"), index=True)
    estimated_cost_impact: Mapped[float] = mapped_column(Money, default=0)
    simulated: Mapped[bool] = mapped_column(Boolean, default=False)
    escalated_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    acknowledged_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    resolved_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)


class KnowledgeBaseEntry(Base):
    __tablename__ = "knowledge_base"

    id: Mapped[int] = mapped_column(primary_key=True)
    issue_type: Mapped[str] = mapped_column(String(64), index=True)
    scenario: Mapped[str] = mapped_column(String(200))
    keywords: Mapped[list[str]] = mapped_column(JSON)
    resolution_steps: Mapped[list[str]] = mapped_column(JSON)
    confidence: Mapped[Confidence] = mapped_column(enum_column(Confidence))
    source_reference: Mapped[str] = mapped_column(String(200))
    applicable_categories: Mapped[list[str]] = mapped_column(JSON, default=list)
    applicable_companies: Mapped[list[str]] = mapped_column(JSON, default=list)


class TrailerInspection(Base):
    __tablename__ = "trailer_inspections"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"), index=True)
    dock_door_id: Mapped[int] = mapped_column(ForeignKey("dock_doors.id"), index=True)
    operator_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    seal_condition: Mapped[str] = mapped_column(String(32))
    interior_cleanliness: Mapped[str] = mapped_column(String(32))
    interior_temperature: Mapped[float | None] = mapped_column(Float)
    visible_damage: Mapped[str] = mapped_column(String(32))
    overall_pass: Mapped[bool] = mapped_column(Boolean)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class QuickRequest(Base):
    __tablename__ = "quick_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    dock_door_id: Mapped[int | None] = mapped_column(ForeignKey("dock_doors.id"), index=True)
    operator_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    request_type: Mapped[str] = mapped_column(String(64))
    details: Mapped[str | None] = mapped_column(Text)
    status: Mapped[RequestStatus] = mapped_column(
        enum_column(RequestStatus), default=RequestStatus.PENDING, index=True
    )
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
    fulfilled_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class Broadcast(Base):
    __tablename__ = "broadcasts"

    id: Mapped[int] = mapped_column(primary_key=True)
    supervisor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    message: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)


class ShiftHandoff(Base):
    __tablename__ = "shift_handoffs"

    id: Mapped[int] = mapped_column(primary_key=True)
    supervisor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    shift: Mapped[str] = mapped_column(String(16))
    notes: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    role: Mapped[ChatRole] = mapped_column(enum_column(ChatRole))
    message: Mapped[str] = mapped_column(Text)
    source_reference: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)


class IssuePhoto(Base):
    """Photo evidence, stored in the database: the free tiers have no object storage. The client
    downscales to a JPEG well under MAX_PHOTO_BYTES before upload."""

    __tablename__ = "issue_photos"

    id: Mapped[int] = mapped_column(primary_key=True)
    issue_id: Mapped[int] = mapped_column(ForeignKey("issues.id", ondelete="CASCADE"), index=True)
    uploaded_by: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    content_type: Mapped[str] = mapped_column(String(32))
    size_bytes: Mapped[int] = mapped_column(Integer)
    data: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class ScanEvent(Base):
    """Every barcode scan against an order, including mismatches — the audit trail for Scenario 3."""

    __tablename__ = "scan_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    code: Mapped[str] = mapped_column(String(64))
    result: Mapped[ScanResult] = mapped_column(enum_column(ScanResult))
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)


class SimState(Base):
    """The simulation clock: one row. See app/wms/clock.py."""

    __tablename__ = "sim_state"

    id: Mapped[int] = mapped_column(primary_key=True)
    seed: Mapped[int] = mapped_column(Integer)
    speed: Mapped[float] = mapped_column(Float)
    running: Mapped[bool] = mapped_column(Boolean)
    anchor_real: Mapped[datetime] = mapped_column(UTCDateTime)
    anchor_minutes: Mapped[float] = mapped_column(Float)
    outage_until_minute: Mapped[float | None] = mapped_column(Float)


class SimEvent(Base):
    """The ledger of simulated events already applied. `key` makes every event happen exactly once."""

    __tablename__ = "sim_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(96), unique=True)
    kind: Mapped[str] = mapped_column(String(32), index=True)
    minute: Mapped[float] = mapped_column(Float)
    message: Mapped[str] = mapped_column(Text)
    issue_id: Mapped[int | None] = mapped_column(ForeignKey("issues.id", ondelete="SET NULL"), index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, index=True)
