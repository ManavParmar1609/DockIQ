"""Request and response models. Responses are explicit so a column rename cannot leak to clients."""

from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.db import MAX_ID
from app.domain.enums import (
    ChatRole,
    Disposition,
    DockStatus,
    IssueStatus,
    LifecyclePhase,
    MovementKind,
    OrderStatus,
    OrderType,
    ProductCategory,
    RequestStatus,
    Role,
    ScanResult,
    Severity,
    ShipmentStatus,
    TaskKind,
    TaskStatus,
    YardEventKind,
)
from app.domain.lifecycle import PENDING_DECISIONS, can_self_resolve, self_resolve_needs_note
from app.wms.clock import shift_of, time_of


class Schema(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ── Requests ──

# A record id as Postgres INTEGER holds it: anything else is a 422, never a driver error.
Id = Annotated[int, Field(ge=1, le=MAX_ID)]
# Free text a person types: long enough for any note, short enough to bound a row.
FreeText = Annotated[str, Field(max_length=2000)]
Tag = Annotated[str, Field(min_length=1, max_length=32)]
Choice = Annotated[str, Field(max_length=32)]  # a short vocabulary value, stored as VARCHAR(32)
# A measurement a person enters: NaN and ±Infinity are a 422, never a stored reading or a 500.
Finite = Annotated[float, Field(allow_inf_nan=False)]


class IssueCreate(BaseModel):
    # A person's product issue names its order; people and systems issues may name neither (§8).
    order_id: Id | None = None
    dock_door_id: Id | None = None
    issue_type: str = Field(min_length=1, max_length=64)
    issue_subtype: str | None = Field(default=None, max_length=120)
    description: FreeText | None = ""
    quick_tags: list[Tag] = Field(default=[], max_length=10)
    product_id: Id | None = None
    company_id: Id | None = None
    carrier_id: Id | None = None
    quantity_affected: int | None = Field(default=1, ge=0)
    temp_reading: Finite | None = None
    temp_threshold_max: Finite | None = None
    count_expected: int | None = Field(default=None, ge=0)
    count_actual: int | None = Field(default=None, ge=0)
    lot: str | None = Field(default=None, max_length=16)


class IssueSelfResolve(BaseModel):
    resolution_type: str = Field(min_length=1, max_length=64)
    # Required (non-blank) when the issue is escalated: business-rules §7.5.
    resolution_notes: FreeText | None = ""


class IssueSupervisorResolve(BaseModel):
    resolution_type: str = Field(min_length=1, max_length=64)
    supervisor_notes: FreeText | None = ""


class InspectionCreate(BaseModel):
    order_id: Id | None = None
    dock_door_id: Id
    seal_condition: Choice
    interior_cleanliness: Choice
    interior_temperature: Finite | None = None
    visible_damage: Choice
    notes: FreeText | None = ""


class ChatCreate(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    company_id: Id | None = None
    product_category: Choice | None = None


class QuickRequestCreate(BaseModel):
    dock_door_id: Id | None = None
    request_type: str = Field(min_length=1, max_length=64)
    details: FreeText | None = ""


class BroadcastCreate(BaseModel):
    message: str = Field(min_length=1, max_length=1000)


class ShiftHandoffCreate(BaseModel):
    shift: str = Field(min_length=1, max_length=16)
    notes: str = Field(min_length=1, max_length=2000)


class OrderItemUpdate(BaseModel):
    actual_quantity: int = Field(ge=0, le=MAX_ID)
    product_id: Id


class OrderComplete(BaseModel):
    seal_number: str | None = Field(default=None, max_length=64)
    notes: FreeText | None = ""


class ScanCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)


class TemperatureCheckCreate(BaseModel):
    reading: float = Field(ge=-80, le=150, allow_inf_nan=False)


class IssueDispositionUpdate(BaseModel):
    disposition: Disposition
    notes: str = Field(min_length=1, max_length=2000)


class ReceivingChecksUpdate(BaseModel):
    """Answers by check id (from `GET /api/taxonomy` → `receiving_checks`). Unnamed checks keep theirs."""

    answers: dict[Annotated[str, Field(max_length=32)], bool] = Field(min_length=1, max_length=20)


class LoadStepUpdate(BaseModel):
    """The load guide's current pallet. With `count`, moving on by one counts the pallet just loaded
    on its order line, and moving back by one takes it off again."""

    step: int = Field(ge=1, le=1000)
    count: bool = False


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
    simulated: bool = False


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
    cases_done: int | None  # on the current order; None when the door has no order
    cases_expected: int | None
    # Open issues at this door, whoever's team they are: a count only, so another zone's door can say
    # "handled by that zone's supervisor" without showing records outside the viewer's scope.
    open_issues: int = 0


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
    simulated: bool = False
    wms_synced: bool = True


class InspectionSummary(BaseModel):
    """The order's most recent trailer inspection, judged by the same rule as when it was submitted."""

    id: int
    overall_pass: bool
    temperature_limit: float
    failed_checks: list[str]
    interior_temperature: float | None
    created_at: datetime


class OrderDetailOut(OrderOut):
    items: list[OrderItemOut]
    # Why it cannot be signed off yet (business-rules §7.1, §11.3). Empty when it can.
    completion_blockers: list[str] = []
    load_step: int | None = None  # the load guide's current pallet, kept on the server
    inspection: InspectionSummary | None = None  # None until the trailer is inspected


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
    simulated: bool = False
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
    # Who said "on my way" (`supervisor_name` is who decided) and a pending decision (§7.2).
    acknowledged_by: int | None = None
    acknowledged_by_name: str | None = None
    on_hold_at: datetime | None = None
    pending_action: str | None = None  # e.g. "Awaiting the carrier" while `on_hold`
    # As reported, and the order as it was when filed (§7).
    temp_reading: float | None = None
    temp_limit: float | None = None
    quantity_affected: int | None = None
    lot: str | None = None
    room: str | None = None  # a cold-room alarm: F, C, P or D
    order_number: str | None = None
    trailer_number: str | None = None
    bol_number: str | None = None
    # Simulated issues: when, on the WMS clock ("07:42" in shift 1).
    sim_minute: float | None = None
    sim_time: str | None = None
    sim_shift: int | None = None
    # Quality hold and disposition (§7.3).
    held_pallets: list[str] = []
    disposition: Disposition | None = None
    disposition_notes: str | None = None
    disposition_by: int | None = None
    disposition_by_name: str | None = None
    disposition_at: datetime | None = None
    # Whether the reporting worker may close it themselves, and whether that needs their note (§7.5).
    can_self_resolve: bool = False
    self_resolve_needs_note: bool = False

    @model_validator(mode="after")
    def _derived(self) -> "IssueOut":
        if self.sim_minute is not None:
            self.sim_time, self.sim_shift = time_of(self.sim_minute), shift_of(self.sim_minute) + 1
        if self.status is IssueStatus.ON_HOLD and self.resolution_type in PENDING_DECISIONS:
            self.pending_action = PENDING_DECISIONS[self.resolution_type]
        self.can_self_resolve = can_self_resolve(self.status, self.severity)
        self.self_resolve_needs_note = self.can_self_resolve and self_resolve_needs_note(self.status)
        return self


class RecurringPattern(BaseModel):
    type: str
    message: str
    count: int


class IssueCreated(BaseModel):
    id: int
    status: IssueStatus  # escalated already when critical (business-rules §7.1)
    severity: Severity
    severity_score: float
    severity_reason: str
    ai_resolution: dict[str, Any]
    estimated_cost_impact: float
    recurring_patterns: list[RecurringPattern]
    can_self_resolve: bool = False  # business-rules §7.5
    self_resolve_needs_note: bool = False

    @model_validator(mode="after")
    def _derived(self) -> "IssueCreated":
        self.can_self_resolve = can_self_resolve(self.status, self.severity)
        self.self_resolve_needs_note = self.can_self_resolve and self_resolve_needs_note(self.status)
        return self


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
    id: int | None = None  # the HACCP log entry (§11.1)
    issue_id: int | None = None  # the Temperature Deviation a critical reading filed, or joined
    created_at: datetime | None = None


class TemperatureLogOut(Schema):
    """One probe reading in the order's HACCP log."""

    id: int
    order_id: int
    user_id: int
    operator_name: str | None
    reading: float
    limit: float | None
    delta: float | None
    status: str
    issue_id: int | None
    created_at: datetime


class ReceivingCheckOut(BaseModel):
    id: str
    question: str
    issue_type: str  # what a "No" is reported as
    issue_subtype: str
    answer: bool | None  # None: not answered yet
    answered_at: datetime | None
    answered_by_name: str | None


class ReceivingChecksOut(BaseModel):
    order_id: int
    checks: list[ReceivingCheckOut]
    all_answered: bool
    probes: int  # probe readings recorded on the order
    needs_probe: bool  # the load has a temperature-controlled product


class LoadStepOut(BaseModel):
    order_id: int
    load_step: int
    counted: "OrderItemOut | None"  # with `count`: the line the pallet was counted on or taken off


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


class ReceivingCheckSpecOut(BaseModel):
    id: str
    question: str
    issue_type: str
    issue_subtype: str


class TaxonomyOut(BaseModel):
    issue_types: list[IssueTypeOut]
    operator_resolutions: list[str]
    supervisor_decisions: list[str]
    request_types: list[str]
    # Decisions that accept product (notes required on a critical or temperature issue) and those that
    # wait on someone else (the issue goes `on_hold`), business-rules §7.2.
    accept_decisions: list[str] = []
    pending_decisions: list[str] = []
    # Minutes an open issue may wait for its decision, by severity (business-rules §7.4).
    decision_targets: dict[str, int] = {}
    # What each pending decision waits on ("Awaiting the carrier"), and the issue types on which accepting
    # product needs the supervisor's reason alongside critical ones (§7.2).
    pending_actions: dict[str, str] = {}
    cold_chain_issue_types: list[str] = []
    receiving_checks: list[ReceivingCheckSpecOut] = []


# ── The assistant (an agent over the user's own scoped data) ──
# Cards carry the tool's numbers, rendered as data, so a figure on screen never comes from model text.
# Actions are drafts: the assistant cannot file or send anything; a person confirms with a button.


class ProcedureCard(BaseModel):
    kind: Literal["procedure"] = "procedure"
    title: str
    steps: list[str]
    source: str
    confidence: Literal["low", "medium", "high"]


class TemperatureCard(BaseModel):
    kind: Literal["temperature"] = "temperature"
    status: str
    reading: float
    limit: float | None
    delta: float | None
    guidance: str
    order_number: str | None


class StockPallet(BaseModel):
    pallet_id: str
    location: str
    cases: int
    lot: str
    best_before: date


class StockCard(BaseModel):
    kind: Literal["stock"] = "stock"
    sku: str
    product_name: str | None
    pallets: list[StockPallet]
    wms_online: bool


class IssueLine(BaseModel):
    id: int
    severity: Severity
    title: str
    door: int | None
    status: IssueStatus
    minutes_open: int


class IssuesCard(BaseModel):
    kind: Literal["issues"] = "issues"
    title: str
    issues: list[IssueLine]


class OrderLine(BaseModel):
    sku: str
    name: str
    counted: int
    expected: int


class OrderCard(BaseModel):
    kind: Literal["order"] = "order"
    order_id: int
    order_number: str
    customer: str
    type: OrderType
    door: int | None
    status: OrderStatus
    lines: list[OrderLine]
    simulated: bool


class RoomLine(BaseModel):
    code: str
    name: str
    temp: float
    limit: float
    setpoint: float
    over_limit: bool
    alarm: bool
    on_hold_cases: int


class RoomsCard(BaseModel):
    kind: Literal["rooms"] = "rooms"
    rooms: list[RoomLine]
    wms_online: bool
    simulated: bool


class TraceMove(BaseModel):
    time: str
    kind: str  # receive | putaway | ship | adjust | … — a WMS movement
    pallet_id: str
    lot: str
    cases: int
    from_location: str | None
    to_location: str | None
    order_number: str | None


class TraceCard(BaseModel):
    kind: Literal["trace"] = "trace"
    sku: str
    product_name: str | None
    lot: str | None  # None: every lot of the SKU
    on_hand: list[StockPallet]
    movements: list[TraceMove]
    wms_online: bool
    simulated: bool


AgentCard = Annotated[
    ProcedureCard | TemperatureCard | StockCard | IssuesCard | OrderCard | RoomsCard | TraceCard,
    Field(discriminator="kind"),
]


class IssueDraft(BaseModel):
    """A report the assistant prepared. Severity is the formula's preview, recomputed when filed."""

    kind: Literal["file_issue"] = "file_issue"
    payload: IssueCreate
    severity: Severity
    severity_score: float
    severity_reason: str
    steps: list[str]
    source: str


class BroadcastDraft(BaseModel):
    kind: Literal["send_broadcast"] = "send_broadcast"
    message: str


class HandoffDraft(BaseModel):
    kind: Literal["handoff_note"] = "handoff_note"
    notes: str


class SelfResolveDraft(BaseModel):
    """Closing the worker's own issue. They confirm it; PUT /api/issues/{id}/self-resolve applies it."""

    kind: Literal["self_resolve"] = "self_resolve"
    issue_id: int
    title: str
    severity: Severity
    resolution_type: str | None  # one of the taxonomy's operator_resolutions; None: the worker picks
    resolution_notes: str
    # Escalated: the worker writes the note on the card before confirming (business-rules §7.5).
    note_required: bool = False


AgentAction = Annotated[
    IssueDraft | BroadcastDraft | HandoffDraft | SelfResolveDraft, Field(discriminator="kind")
]


class AgentStep(BaseModel):
    tool: str
    label: str
    ok: bool
    summary: str


class ChatReply(BaseModel):
    response: str
    source: str
    confidence: str
    steps: list[AgentStep] = []
    cards: list[AgentCard] = []
    actions: list[AgentAction] = []


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
    read_by: int | None = None  # the read receipt: the first other supervisor of the zone to open it
    read_by_name: str | None = None
    read_at: datetime | None = None


class HandoffIssueLine(BaseModel):
    id: int
    severity: Severity
    status: IssueStatus
    title: str
    door_number: int | None
    order_number: str | None
    operator_name: str | None
    created_at: datetime


class HandoffDecisionLine(BaseModel):
    id: int
    title: str
    decision: str
    status: IssueStatus  # supervisor_resolved, or on_hold for a decision still pending
    notes: str | None
    decided_by: str | None
    decided_at: datetime | None


class HandoffTrailerLine(BaseModel):
    order_number: str
    trailer: str
    carrier: str
    customer: str
    state: Literal["scheduled", "in_yard", "at_door"]
    door: int
    due_in_minutes: float | None
    detention: bool
    simulated: bool


class HandoffRoomLine(BaseModel):
    code: str
    name: str
    temp: float
    limit: float
    alarm: bool
    simulated: bool


class HandoffDraftOut(BaseModel):
    """A pre-filled handoff for the supervisor's zone: what the next shift inherits."""

    zone: str | None
    since: datetime  # "this shift": decisions since then
    open_criticals: list[HandoffIssueLine]
    decisions: list[HandoffDecisionLine]
    trailers: list[HandoffTrailerLine]  # in the yard, at a door, or due in the next 90 minutes
    room_alarms: list[HandoffRoomLine]  # rooms in alarm or over their limit now
    pending_requests: list[QuickRequestOut]
    wms_online: bool
    notes: str  # the same, as text for the notes field


class CountByLabel(BaseModel):
    count: int


class TypeCount(CountByLabel):
    issue_type: str
    cost_impact: float


class SeverityCount(CountByLabel):
    severity: Severity
    open: int
    avg_resolution_minutes: float | None


class DockCount(CountByLabel):
    door_number: int
    open: int


class TypeSeverityCount(CountByLabel):
    issue_type: str
    severity: Severity


class DockRepeat(CountByLabel):
    """The same kind of problem at the same door, more than once in the trend window."""

    issue_type: str
    door_number: int


class CarrierRepeat(CountByLabel):
    """The same kind of problem from the same carrier, more than once in the trend window."""

    issue_type: str
    name: str


class NameCount(CountByLabel):
    name: str


class OperatorCount(BaseModel):
    name: str
    total: int
    self_resolved: int
    simulated: bool = False  # simulated crew: shown as simulated wherever it is listed


class DateCount(CountByLabel):
    date: str


class AnalyticsSummary(BaseModel):
    # Whose issues these are: a supervisor's team, or what Quality can open (quality issues and every
    # critical issue) — the same scope as the issue list.
    scope: Literal["team", "quality"] = "team"
    total_issues: int
    self_resolved: int
    escalated: int
    self_resolution_rate: float
    total_cost_impact: float
    avg_resolution_minutes: float
    open_issues: int
    open_critical: int
    open_cost_impact: float
    cold_chain_breaches: int
    cold_chain_open: int
    by_type: list[TypeCount]
    by_severity: list[SeverityCount]
    by_type_severity: list[TypeSeverityCount]
    by_dock: list[DockCount]
    by_operator: list[OperatorCount]
    by_company: list[NameCount]
    by_carrier: list[NameCount]
    over_time: list[DateCount]
    repeat_at_doors: list[DockRepeat]
    repeat_with_carriers: list[CarrierRepeat]


# ── Simulation and WMS (business-rules §12) ──


class SimEventOut(BaseModel):
    minute: float
    clock: str
    kind: str
    message: str
    issue_id: int | None


class SimTrailerCounts(BaseModel):
    scheduled: int
    in_yard: int
    at_door: int
    departed: int


class ShiftKpisOut(BaseModel):
    arrived: int
    on_time_percent: float | None
    average_turn_minutes: float | None
    on_detention: int
    pallets_per_hour: float
    door_utilization_percent: float


class SimStatusOut(BaseModel):
    simulated: bool = True
    seed: int
    speed: float
    running: bool
    minute: float
    clock: str
    shift: int
    shift_progress: float
    wms_online: bool
    trailers: SimTrailerCounts
    kpis: ShiftKpisOut
    events: list[SimEventOut]


class SimSpeed(BaseModel):
    speed: Literal[1, 5, 15, 60]


class SimStep(BaseModel):
    minutes: float = Field(gt=0, le=480, allow_inf_nan=False)


class SimReset(BaseModel):
    seed: int | None = Field(default=None, ge=0, le=999_999)


class SimInject(BaseModel):
    scenario: Literal["temperature_emergency", "wrong_product", "damaged_pallet", "injury", "wms_outage"]


class SimInjected(BaseModel):
    message: str


class WmsStatusOut(BaseModel):
    mode: str
    online: bool
    message: str


class YardEntryOut(BaseModel):
    ref: str
    order_number: str
    door: int  # the door it is at (or left from); the booked door until it reaches one
    booked_door: int | None = None  # the door the appointment was booked onto
    type: str
    customer: str
    carrier: str
    trailer: str
    state: Literal["scheduled", "in_yard", "at_door", "departed"]
    due_in_minutes: float | None
    simulated: bool
    scheduled_at: str
    arrived_at: str | None
    late_minutes: float | None
    reefer_setpoint: float | None
    yard_spot: str | None
    dwell_minutes: float | None
    detention: bool


class PalletOut(BaseModel):
    pallet_id: str
    sku: str
    location: str
    cases: int
    lot: str
    best_before: date


# ── The warehouse behind the WMS (business-rules §12.7–§12.10) ──

StockArea = Literal["storage", "hold", "dock", "stage", "trailer"]


class StockOut(BaseModel):
    pallet_id: str
    sku: str
    location: str
    area: StockArea
    room: str | None
    cases: int
    lot: str
    best_before: date
    simulated: bool


class LedgerEntryOut(BaseModel):
    id: int
    kind: MovementKind
    minute: float
    time: str
    pallet_id: str
    sku: str
    lot: str
    best_before: date
    from_location: str | None
    to_location: str | None
    cases: int
    actor: str
    actor_name: str
    order_number: str | None
    simulated: bool


class WarehouseTaskOut(BaseModel):
    key: str
    kind: TaskKind
    status: TaskStatus
    sku: str
    pallet_id: str | None
    from_location: str | None
    to_location: str | None
    cases: int
    assignee: str
    assignee_name: str
    queued_at: str
    started_at: str
    finished_at: str
    standard_minutes: float
    order_number: str | None
    counted_cases: int | None
    note: str | None
    simulated: bool


class CrewProductivityOut(BaseModel):
    code: str
    name: str
    role: Literal["warehouse", "dock"]
    tasks_done: int
    cases: int
    tasks_per_hour: float
    cases_per_hour: float
    busy_percent: float | None
    simulated: bool


class ShipmentLineOut(BaseModel):
    sku: str
    expected: int
    allocated: int
    done: int


class ShipmentOut(BaseModel):
    ref: str
    direction: OrderType
    order_number: str
    customer: str
    carrier: str
    trailer: str
    door: int
    wave: str | None
    status: ShipmentStatus
    created_at: str
    arrived_at: str | None
    completed_at: str | None
    seal: str | None
    confirmation: str | None
    pallets: int
    cases_expected: int
    cases_allocated: int
    cases_done: int
    lines: list[ShipmentLineOut]
    simulated: bool


class GateEventOut(BaseModel):
    id: int
    kind: YardEventKind
    minute: float
    time: str
    order_number: str | None
    trailer: str
    carrier: str
    door: int | None
    yard_spot: str | None
    seal: str | None
    reefer_temp: float | None
    dwell_minutes: float | None
    late: bool
    detention: bool
    simulated: bool


class RoomReadingOut(BaseModel):
    minute: float
    time: str
    temp: float


class ColdRoomOut(BaseModel):
    code: Literal["F", "C", "P", "D"]
    name: str
    setpoint: float
    limit: float
    temp: float
    over_limit: bool
    alarm: bool
    readings: list[RoomReadingOut]
    slots: int
    occupied: int
    pallets: int
    cases: int
    on_hold_cases: int
    simulated: bool
