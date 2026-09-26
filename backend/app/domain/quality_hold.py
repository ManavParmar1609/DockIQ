"""Quality hold and disposition. See docs/architecture/business-rules.md §7.3.

Which issues put product on hold, how wide the hold is, and what Quality may decide about held
product. Which licence plates that means is the warehouse's to find (`app/wms/warehouse.py`); the
decision is here.
"""

from app.domain.enums import Disposition

# Filing one of these against an order puts its stock on quality hold.
HOLD_ISSUE_TYPES: frozenset[str] = frozenset({"Temperature Deviation", "Product Quality Concern"})

# A quality concern is about the lot, not one trailer: every plate of the same SKU and lot is held.
LOT_WIDE_ISSUE_TYPES: frozenset[str] = frozenset({"Product Quality Concern"})

FINAL_DISPOSITIONS: frozenset[Disposition] = frozenset(
    {Disposition.RELEASE, Disposition.DESTROY, Disposition.RETURN_TO_VENDOR}
)

# Destroyed or returned product leaves the building: an `adjust` out of the hold area.
LEAVES_THE_BUILDING: frozenset[Disposition] = frozenset({Disposition.DESTROY, Disposition.RETURN_TO_VENDOR})


def holds_stock(issue_type: str) -> bool:
    return issue_type in HOLD_ISSUE_TYPES


def lot_wide(issue_type: str) -> bool:
    return issue_type in LOT_WIDE_ISSUE_TYPES


def can_dispose(current: Disposition | None, target: Disposition) -> bool:
    """Hold may be applied again (to catch stock the first hold missed); release, destroy and return
    are final."""
    return current not in FINAL_DISPOSITIONS
