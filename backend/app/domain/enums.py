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
