"""Request and response models. Responses are explicit so a column rename cannot leak to clients."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.domain.enums import (
    ChatRole,
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


class Schema(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ── Requests ──


class IssueCreate(BaseModel):
    order_id: int | None = None
    dock_door_id: int
    issue_type: str = Field(min_length=1, max_length=64)
    issue_subtype: str | None = Field(default=None, max_length=120)
    description: str | None = ""
    quick_tags: list[str] = []
    product_id: int | None = None
    company_id: int | None = None
    carrier_id: int | None = None
    quantity_affected: int | None = Field(default=1, ge=0)
    temp_reading: float | None = None
    temp_threshold_max: float | None = None
    count_expected: int | None = Field(default=None, ge=0)
    count_actual: int | None = Field(default=None, ge=0)


class IssueSelfResolve(BaseModel):
    resolution_type: str = Field(min_length=1, max_length=64)
    resolution_notes: str | None = ""


class IssueSupervisorResolve(BaseModel):
    resolution_type: str = Field(min_length=1, max_length=64)
    supervisor_notes: str | None = ""


class InspectionCreate(BaseModel):
    order_id: int | None = None
    dock_door_id: int
    seal_condition: str
    interior_cleanliness: str
    interior_temperature: float | None = None
    visible_damage: str
    notes: str | None = ""


class ChatCreate(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    company_id: int | None = None
    product_category: str | None = None


class QuickRequestCreate(BaseModel):
    dock_door_id: int | None = None
    request_type: str = Field(min_length=1, max_length=64)
    details: str | None = ""


class BroadcastCreate(BaseModel):
    message: str = Field(min_length=1, max_length=1000)


class ShiftHandoffCreate(BaseModel):
    shift: str = Field(min_length=1, max_length=16)
    notes: str = Field(min_length=1)


class OrderItemUpdate(BaseModel):
    actual_quantity: int = Field(ge=0)
    product_id: int


class OrderComplete(BaseModel):
    seal_number: str | None = None
    notes: str | None = ""


class ScanCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)


class TemperatureCheckCreate(BaseModel):
    reading: float = Field(ge=-80, le=150)


# ── Responses ──


class StatusOut(BaseModel):
    status: str


class UserOut(Schema):
    id: int
    name: str
    role: Role
    employee_id: str
    shift: str
    zone: str | None
    experience_level: str | None
    supervisor_id: int | None


class MeOut(UserOut):
    supervisor_name: str | None


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"  # noqa: S105 — the OAuth2 scheme name, not a secret
    expires_in: int
    user: MeOut


class DemoAccount(BaseModel):
    employee_id: str
    name: str
    role: Role
    zone: str | None
    supervisor_name: str | None


class CompanyOut(Schema):
    id: int
    name: str
    tier: int
    count_tolerance: float
    load_pattern: dict[str, Any]
    sop_rules: dict[str, Any]


class ProductOut(Schema):
    id: int
    company_id: int
    sku: str
    gtin: str | None
    name: str
    category: ProductCategory
    weight_per_case: float
    cases_per_pallet: int
    temp_min: float | None
    temp_max: float | None
    is_allergen: bool
    lot_tracking_required: bool
    case_value: float


class CarrierOut(Schema):
    id: int
    name: str
    code: str


class DockOut(Schema):
    id: int
    door_number: int
    zone: str
    status: DockStatus
    lifecycle_phase: LifecyclePhase
    current_trailer: str | None
    current_order_id: int | None
    current_operator_id: int | None
    trailer_arrived_at: datetime | None
    last_activity_at: datetime | None
    operator_name: str | None
    order_number: str | None
    trailer_number: str | None
    company_name: str | None
    order_type: OrderType | None


class OrderItemOut(Schema):
    id: int
    order_id: int
    product_id: int
    expected_quantity: int
    actual_quantity: int
    verified: bool
    sku: str
    gtin: str | None
    product_name: str
    category: ProductCategory
    weight_per_case: float
    cases_per_pallet: int
    temp_min: float | None
    temp_max: float | None
    is_allergen: bool
    lot_tracking_required: bool
    case_value: float


class OrderOut(Schema):
    id: int
    order_number: str
    type: OrderType
    company_id: int
    carrier_id: int
    trailer_number: str
    bol_number: str
    dock_door_id: int | None
    operator_id: int | None
    status: OrderStatus
    seal_number: str | None
    notes: str | None
    created_at: datetime
    completed_at: datetime | None
    company_name: str
    company_tier: int
    count_tolerance: float
    load_pattern: dict[str, Any]
    sop_rules: dict[str, Any]
    carrier_name: str
    operator_name: str | None
    door_number: int | None


class OrderDetailOut(OrderOut):
    items: list[OrderItemOut]


class IssueOut(Schema):
    id: int
    order_id: int | None
    dock_door_id: int | None
    operator_id: int | None
    supervisor_id: int | None
    issue_type: str
    issue_subtype: str | None
    description: str | None
    quick_tags: list[str]
    severity: Severity
    severity_score: float | None
    severity_reason: str | None
    status: IssueStatus
    ai_resolution: dict[str, Any] | None
    recurring_patterns: list[dict[str, Any]]
    ai_confidence: str | None
    resolution_type: str | None
    resolution_notes: str | None
    supervisor_notes: str | None
    product_id: int | None
    company_id: int | None
    carrier_id: int | None
    estimated_cost_impact: float
    escalated_at: datetime | None
    acknowledged_at: datetime | None
    resolved_at: datetime | None
    created_at: datetime
    operator_name: str | None
    supervisor_name: str | None
    door_number: int | None
    company_name: str | None
    product_name: str | None
    product_sku: str | None
    carrier_name: str | None
    photo_count: int


class RecurringPattern(BaseModel):
    type: str
    message: str
    count: int


class IssueCreated(BaseModel):
    id: int
    severity: Severity
    severity_score: float
    severity_reason: str
    ai_resolution: dict[str, Any]
    estimated_cost_impact: float
    recurring_patterns: list[RecurringPattern]


class InspectionResult(BaseModel):
    id: int
    overall_pass: bool
    temperature_limit: float
    failed_checks: list[str]


class ScanOut(BaseModel):
    result: ScanResult
    code: str
    scanned_sku: str | None
    scanned_product_name: str | None
    expected_skus: list[str]
    item: "OrderItemOut | None"


class TemperatureCheckOut(BaseModel):
    status: str
    reading: float
    limit: float | None
    delta: float | None
    guidance: str


class OrderCompleted(BaseModel):
    status: str
    discrepancy_issue_ids: list[int]


class PlacedPalletOut(BaseModel):
    load_sequence: int
    row: int
    side: str
    level: int
    orientation: str
    sku: str
    product_name: str
    category: str
    cases: int
    weight_lbs: float
    partial: bool
    stop: int


class LoadPlanOut(BaseModel):
    order_id: int
    company_name: str
    floor_pattern: str
    sequence: str
    max_height: int
    heavy_bottom: bool
    slip_sheets: bool
    label_direction: str
    segregate_categories: bool
    max_pallets: int | None
    special: str
    rows: int
    floor_positions: int
    stacks_used: int
    total_pallets: int
    total_weight_lbs: float
    checklist: list[str]
    warnings: list[str]
    pallets: list[PlacedPalletOut]


class PhotoOut(Schema):
    id: int
    issue_id: int
    uploaded_by: int
    content_type: str
    size_bytes: int
    created_at: datetime


class IssueTypeOut(BaseModel):
    name: str
    group: str
    icon: str
    weight: int
    subtypes: list[str]
    quality_relevant: bool
    floor: dict[str, Severity]


class TaxonomyOut(BaseModel):
    issue_types: list[IssueTypeOut]
    operator_resolutions: list[str]
    supervisor_decisions: list[str]
    request_types: list[str]


class ChatReply(BaseModel):
    response: str
    source: str
    confidence: str


class ChatMessageOut(Schema):
    id: int
    user_id: int
    role: ChatRole
    message: str
    source_reference: str | None
    created_at: datetime


class QuickRequestOut(Schema):
    id: int
    dock_door_id: int | None
    operator_id: int
    request_type: str
    details: str | None
    status: RequestStatus
    created_at: datetime
    fulfilled_at: datetime | None
    operator_name: str | None
    door_number: int | None


class Created(BaseModel):
    id: int


class QuickRequestCreated(Created):
    status: RequestStatus


class BroadcastOut(Schema):
    id: int
    supervisor_id: int
    message: str
    created_at: datetime
    supervisor_name: str


class ShiftHandoffOut(Schema):
    id: int
    supervisor_id: int
    shift: str
    notes: str
    created_at: datetime
    supervisor_name: str


class CountByLabel(BaseModel):
    count: int


class TypeCount(CountByLabel):
    issue_type: str


class SeverityCount(CountByLabel):
    severity: Severity


class DockCount(CountByLabel):
    door_number: int


class NameCount(CountByLabel):
    name: str


class OperatorCount(BaseModel):
    name: str
    total: int
    self_resolved: int


class DateCount(CountByLabel):
    date: str


class AnalyticsSummary(BaseModel):
    total_issues: int
    self_resolved: int
    escalated: int
    self_resolution_rate: float
    total_cost_impact: float
    avg_resolution_minutes: float
    by_type: list[TypeCount]
    by_severity: list[SeverityCount]
    by_dock: list[DockCount]
    by_operator: list[OperatorCount]
    by_company: list[NameCount]
    by_carrier: list[NameCount]
    over_time: list[DateCount]
