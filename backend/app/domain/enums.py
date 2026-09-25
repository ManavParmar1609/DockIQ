"""Closed vocabularies. Each is stored as a CHECK-constrained string column."""

from enum import StrEnum


class Role(StrEnum):
    OPERATOR = "operator"
    SUPERVISOR = "supervisor"
    QUALITY = "quality"


class ProductCategory(StrEnum):
    FROZEN = "Frozen"
    REFRIGERATED = "Refrigerated"
    PRODUCE = "Produce"
    DRY = "Dry"


class Severity(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class Confidence(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class IssueStatus(StrEnum):
    RESOLUTION_IN_PROGRESS = "resolution_in_progress"
    SELF_RESOLVED = "self_resolved"
    ESCALATED = "escalated"
    SUPERVISOR_RESOLVED = "supervisor_resolved"


class OrderType(StrEnum):
    INBOUND = "inbound"
    OUTBOUND = "outbound"


class OrderStatus(StrEnum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETE = "complete"


class DockStatus(StrEnum):
    IDLE = "idle"
    ACTIVE = "active"
    ISSUE = "issue"
    CRITICAL = "critical"


class LifecyclePhase(StrEnum):
    IDLE = "idle"
    INSPECTION = "inspection"
    LOADING = "loading"
    UNLOADING = "unloading"
    COMPLETE = "complete"


class RequestStatus(StrEnum):
    PENDING = "pending"
    FULFILLED = "fulfilled"


class ChatRole(StrEnum):
    USER = "user"
    ASSISTANT = "assistant"


class ScanResult(StrEnum):
    MATCH = "match"
    MISMATCH = "mismatch"
    UNKNOWN = "unknown"


# ── The warehouse behind the WMS (business-rules §12.7–§12.10) ──


class MovementKind(StrEnum):
    RECEIVE = "receive"
    PUTAWAY = "putaway"
    REPLENISH = "replenish"
    PICK = "pick"
    LOAD = "load"
    SHIP = "ship"
    ADJUST = "adjust"


class TaskKind(StrEnum):
    PUTAWAY = "putaway"
    PICK = "pick"
    REPLENISH = "replenish"
    CYCLE_COUNT = "cycle_count"


class TaskStatus(StrEnum):
    OPEN = "open"
    ASSIGNED = "assigned"
    DONE = "done"
    CANCELLED = "cancelled"


class ShipmentStatus(StrEnum):
    EXPECTED = "expected"  # inbound: advance ship notice received
    ARRIVED = "arrived"  # inbound: through the gate
    RECEIVING = "receiving"
    RECEIVED = "received"
    RELEASED = "released"  # outbound: wave released, picks queued
    STAGED = "staged"  # every allocated pallet is at the door lane
    LOADING = "loading"
    SHIPPED = "shipped"
    CANCELLED = "cancelled"  # the trailer never reached a door in its shift


class YardEventKind(StrEnum):
    GATE_IN = "gate_in"
    YARD_MOVE = "yard_move"
    GATE_OUT = "gate_out"
