"""Quality hold for an issue, through the WMS (business-rules §7.3).

The WMS is a system of its own: a hold is asked for once the issue is on record (its id names the
hold on every ledger movement), and what the WMS held is then recorded on the issue.
"""

import logging

from app.domain.quality_hold import lot_wide
from app.models import Issue, Order, Product
from app.wms.client import HoldRequest, WmsClient, WmsUnavailable

logger = logging.getLogger(__name__)


async def hold_for_issue(
    wms: WmsClient, issue: Issue, order: Order | None, product: Product | None, actor: str
) -> list[str] | None:
    """Every plate now held for the issue, or None when the WMS could not be reached (nothing moved).
    An issue without an order, or on an order with no WMS reference (`external_ref`), holds nothing
    new: the WMS has no stock for it. Its disposition is still recorded."""
    if order is None or order.external_ref is None:  # not an order the WMS holds stock for
        return list(issue.held_pallets)
    try:
        held = await wms.hold_stock(
            HoldRequest(
                ref=f"ISSUE-{issue.id}",
                actor=actor,
                order_ref=order.external_ref,
                sku=product.sku if product is not None else None,
                same_lot=lot_wide(issue.issue_type),
            )
        )
    except WmsUnavailable:
        logger.warning("WMS unavailable: issue %s has no quality hold yet", issue.id)
        return None
    return sorted(set(issue.held_pallets) | set(held))
