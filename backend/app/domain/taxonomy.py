"""The operator issue taxonomy and the other closed lists the floor chooses from.

Source: `DocumentsforProj/list of issues operators faces.docx` — 8 issue categories and 8 discrepancy
categories, mapped onto 12 reportable types with subtypes. See docs/architecture/business-rules.md §8.
The frontend renders these lists from `GET /api/taxonomy`; it does not keep its own copies.
"""

from dataclasses import dataclass

from app.domain.enums import Severity


@dataclass(frozen=True, slots=True)
class IssueTypeSpec:
    name: str
    group: str  # "product", "people", "systems" — drives UI grouping only
    icon: str  # a stable key the frontend maps to an icon
    subtypes: tuple[str, ...]


ISSUE_TAXONOMY: tuple[IssueTypeSpec, ...] = (
    IssueTypeSpec(
        "Temperature Deviation",
        "product",
        "thermometer",
        (
            "Product temperature out of range",
            "Trailer not at required setpoint",
            "Reefer unit not running",
            "Trailer not pre-cooled",
            "Freezer door left open too long",
            "Cold chain compromised",
        ),
    ),
    IssueTypeSpec(
        "Product Quality Concern",
        "product",
        "alert",
        (
            "Signs of thawing or refreezing",
            "Ice or frost on product",
            "Water damage from condensation",
            "Contamination or foreign material",
            "Mould, bruising or pest damage",
        ),
    ),
    IssueTypeSpec(
        "Damaged Pallet",
        "product",
        "package",
        (
            "Damaged or broken pallet",
            "Crushed or collapsed pallet",
            "Damaged cartons or packaging",
            "Leaning or unstable load",
            "Product fallen off pallet",
            "Torn or loose shrink wrap",
            "Frozen pallet stuck to floor",
            "Cannot safely remove or place pallet",
        ),
    ),
    IssueTypeSpec(
        "SKU Mismatch",
        "product",
        "shuffle",
        (
            "SKU does not match pick list",
            "Wrong product staged",
            "Paperwork does not match product",
        ),
    ),
    IssueTypeSpec(
        "Count Discrepancy",
        "product",
        "list",
        (
            "Short count",
            "Overage",
            "Partial pallet when full expected",
            "Missing pallet from staging",
            "Extra pallet not on load",
            "Mixed SKUs on one pallet",
            "Wrong number of pallets staged",
        ),
    ),
    IssueTypeSpec(
        "Lot/Expiry Issue",
        "product",
        "calendar",
        (
            "Expired product",
            "Short-dated product",
            "Wrong lot or batch number",
        ),
    ),
    IssueTypeSpec(
        "Seal/Trailer Condition",
        "product",
        "lock",
        (
            "Seal broken or missing",
            "Seal number does not match paperwork",
            "Wrong trailer at dock",
            "Trailer damaged (floor or walls)",
            "Dirty or contaminated trailer",
            "Ice or water on trailer floor",
            "Trailer shifted away from dock",
            "Trailer restraint not engaged",
        ),
    ),
    IssueTypeSpec(
        "Safety Incident",
        "people",
        "shield",
        (
            "Employee injury",
            "Near miss",
            "Pedestrian in loading area",
            "Slip hazard (ice or water)",
            "Product spill",
            "Obstructed path or blocked exit",
            "Poor lighting in trailer",
            "Unsafe trailer condition",
            "Overweight pallet",
            "Oversized load",
            "Unsafe stacking or shifted load",
        ),
    ),
    IssueTypeSpec(
        "Equipment Failure",
        "systems",
        "wrench",
        (
            "Scanner not working",
            "Scanner battery dead",
            "Scanner lost Wi-Fi",
            "Handheld frozen or unresponsive",
            "Cannot log in to handheld",
            "Forklift will not start",
            "Forklift low battery or fuel",
            "Hydraulic lift fault",
            "Steering or brake fault",
            "Forks bent or damaged",
            "Warning light or fault code",
            "Horn, lights or backup alarm fault",
            "Dock leveler not working",
            "Dock plate damaged or icy",
        ),
    ),
    IssueTypeSpec(
        "WMS/System Issue",
        "systems",
        "server",
        (
            "WMS offline or not responding",
            "Pallet not found in WMS",
            "Loading task missing",
            "Shipment information incorrect",
            "System inventory differs from physical",
            "Cannot confirm pick or load",
            "Wrong trailer or dock assignment",
            "Shipment already marked loaded",
            "WMS shows a different location",
        ),
    ),
    IssueTypeSpec(
        "Barcode Issue",
        "systems",
        "scan",
        (
            "Barcode will not scan",
            "Barcode damaged or unreadable",
            "Barcode covered by frost, dirt or wrap",
            "Label missing",
            "Wrong barcode on pallet",
            "Duplicate barcode",
            "Barcode does not match shipment",
        ),
    ),
    IssueTypeSpec(
        "Paperwork Mismatch",
        "systems",
        "file",
        (
            "Waiting for paperwork",
            "Paperwork does not match load",
            "Missing BOL or shipping documents",
            "Wrong destination or customer order",
            "Incorrect loading sequence",
            "Trailer at max weight before load complete",
        ),
    ),
)

ISSUE_TYPES: dict[str, IssueTypeSpec] = {spec.name: spec for spec in ISSUE_TAXONOMY}

# Types whose risk is to people, not product: product and customer multipliers do not apply.
PEOPLE_RISK_TYPES: frozenset[str] = frozenset({"Safety Incident"})

# Minimum severity regardless of score. `None` = every subtype of that type.
SEVERITY_FLOORS: dict[str, dict[str | None, Severity]] = {
    "Safety Incident": {
        None: Severity.MEDIUM,
        "Near miss": Severity.HIGH,
        "Pedestrian in loading area": Severity.HIGH,
        "Unsafe trailer condition": Severity.HIGH,
        "Employee injury": Severity.CRITICAL,
    },
}

# Damage whose severity scales with the share of cases it touches (business-rules §1.9). `None` = the
# type reported without a subtype. Structural and handling subtypes — a crushed, leaning or stuck
# pallet — are about whether the pallet is safe to move, not how many cases are hurt: never scaled.
QUANTITY_SCALED_SUBTYPES: dict[str, frozenset[str | None]] = {
    "Damaged Pallet": frozenset(
        {None, "Damaged cartons or packaging", "Torn or loose shrink wrap", "Product fallen off pallet"}
    ),
    "Product Quality Concern": frozenset({"Water damage from condensation"}),
}

# Issues the Quality team is notified about (in addition to any critical issue).
QUALITY_ISSUE_TYPES: frozenset[str] = frozenset(
    {"Temperature Deviation", "Product Quality Concern", "Lot/Expiry Issue"}
)

# A cold-chain break: product found outside its temperature range. Counted separately in analytics.
COLD_CHAIN_ISSUE_TYPES: frozenset[str] = frozenset({"Temperature Deviation"})

OPERATOR_RESOLUTIONS: tuple[str, ...] = (
    "Partial Accept",
    "Full Reject",
    "Manual Entry",
    "Temp Re-check OK",
    "Equipment Swapped",
    "Product Segregated",
    "Corrected and Continued",
    "Other",
)

OTHER_RESOLUTION = "Other"

# What a worker may say they did, by issue type (business-rules §7.6). Listed in OPERATOR_RESOLUTIONS
# order; "Other" is always offered. A reefer re-check never closes a forklift fault, and a swapped
# scanner never closes a temperature deviation.
RESOLUTIONS_BY_TYPE: dict[str, tuple[str, ...]] = {
    "Temperature Deviation": ("Full Reject", "Temp Re-check OK", "Product Segregated", "Other"),
    "Product Quality Concern": ("Partial Accept", "Full Reject", "Product Segregated", "Other"),
    "Damaged Pallet": (
        "Partial Accept",
        "Full Reject",
        "Product Segregated",
        "Corrected and Continued",
        "Other",
    ),
    "SKU Mismatch": ("Full Reject", "Product Segregated", "Corrected and Continued", "Other"),
    "Count Discrepancy": ("Partial Accept", "Full Reject", "Corrected and Continued", "Other"),
    "Lot/Expiry Issue": (
        "Partial Accept",
        "Full Reject",
        "Product Segregated",
        "Corrected and Continued",
        "Other",
    ),
    "Seal/Trailer Condition": ("Full Reject", "Corrected and Continued", "Other"),
    "Safety Incident": ("Corrected and Continued", "Other"),
    "Equipment Failure": ("Equipment Swapped", "Corrected and Continued", "Other"),
    "WMS/System Issue": ("Manual Entry", "Corrected and Continued", "Other"),
    "Barcode Issue": ("Manual Entry", "Corrected and Continued", "Other"),
    "Paperwork Mismatch": ("Manual Entry", "Corrected and Continued", "Other"),
}


def allowed_resolutions(issue_type: str) -> tuple[str, ...]:
    """The operator resolutions that fit this issue type; every one for a type the map does not name."""
    return RESOLUTIONS_BY_TYPE.get(issue_type, OPERATOR_RESOLUTIONS)


SUPERVISOR_DECISIONS: tuple[str, ...] = (
    "Accept",
    "Partial Accept",
    "Full Reject",
    "Override — Accept Anyway",
    "Request Re-inspection",
    "Contact Carrier",
    "Other",
)

REQUEST_TYPES: tuple[str, ...] = (
    "Equipment Swap — Scanner",
    "Equipment Swap — Forklift Battery",
    "Supplies — Pallet Wrap",
    "Supplies — Slip Sheets",
    "Dock Plate Adjustment",
    "Cleanup Needed",
)


# Receiving checks answered per inbound order before sign-off (business-rules §11.3). A "No" answer is
# reported as the issue named beside it.
@dataclass(frozen=True, slots=True)
class ReceivingCheckSpec:
    id: str
    question: str
    issue_type: str
    issue_subtype: str


RECEIVING_CHECKS: tuple[ReceivingCheckSpec, ...] = (
    ReceivingCheckSpec("pallets", "Pallets intact?", "Damaged Pallet", "Damaged or broken pallet"),
    ReceivingCheckSpec(
        "packaging", "Packaging sealed, not punctured?", "Damaged Pallet", "Damaged cartons or packaging"
    ),
    ReceivingCheckSpec(
        "labels", "Labels readable and matching?", "Barcode Issue", "Barcode damaged or unreadable"
    ),
    ReceivingCheckSpec("bol", "Product matches the BOL?", "SKU Mismatch", "Paperwork does not match product"),
    ReceivingCheckSpec("lot", "Lot and expiry verified?", "Lot/Expiry Issue", "Wrong lot or batch number"),
)

RECEIVING_CHECK_IDS: tuple[str, ...] = tuple(check.id for check in RECEIVING_CHECKS)

# A person may report these without an order: they concern people or systems, not a load.
ORDERLESS_GROUPS: frozenset[str] = frozenset({"people", "systems"})


def is_valid_subtype(issue_type: str, subtype: str | None) -> bool:
    if subtype is None:
        return True
    spec = ISSUE_TYPES.get(issue_type)
    return spec is not None and subtype in spec.subtypes


def severity_floor(issue_type: str, subtype: str | None) -> Severity | None:
    floors = SEVERITY_FLOORS.get(issue_type)
    if not floors:
        return None
    if subtype is not None and subtype in floors:
        return floors[subtype]
    return floors.get(None)


def is_quantity_scaled(issue_type: str, subtype: str | None) -> bool:
    return subtype in QUANTITY_SCALED_SUBTYPES.get(issue_type, frozenset())


def is_quality_relevant(issue_type: str, severity: Severity) -> bool:
    return issue_type in QUALITY_ISSUE_TYPES or severity == Severity.CRITICAL


def needs_order(issue_type: str) -> bool:
    """A product issue is about a load: a person's report of one names its order (§8)."""
    spec = ISSUE_TYPES.get(issue_type)
    return spec is not None and spec.group not in ORDERLESS_GROUPS
