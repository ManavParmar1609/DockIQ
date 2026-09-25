"""Barcode identity and the scan check behind Scenario 3 ("The Wrong Product").

Demo GTINs use the GS1 restricted-circulation prefix `2`, which is never assigned to a real trade
item, so a demo barcode can never collide with a real product.
"""

from collections.abc import Collection
from dataclasses import dataclass

from app.domain.enums import ScanResult

DEMO_GTIN_PREFIX = "2860"


def gs1_check_digit(body: str) -> str:
    """Mod-10 check digit for any GTIN body (GTIN-8/12/13/14 without its last digit)."""
    total = sum(int(digit) * (3 if i % 2 == 0 else 1) for i, digit in enumerate(reversed(body)))
    return str((10 - total % 10) % 10)


def demo_gtin(product_number: int) -> str:
    """Deterministic GTIN-14 for the n-th seeded product."""
    body = f"{DEMO_GTIN_PREFIX}{product_number:08d}"  # 12 digits → a GTIN-13 body
    return "0" + body + gs1_check_digit(body)


def is_valid_gtin(code: str) -> bool:
    return code.isdigit() and len(code) in (8, 12, 13, 14) and gs1_check_digit(code[:-1]) == code[-1]


def normalize_code(raw: str) -> str:
    """Scanner output → GTIN-14 when it is a GTIN; otherwise an upper-cased SKU."""
    code = raw.strip().replace(" ", "")
    if code.isdigit() and len(code) in (8, 12, 13, 14):
        return code.zfill(14)
    return code.upper()


@dataclass(frozen=True, slots=True)
class ScanDecision:
    """MISMATCH is a known product that is not on this order — DO NOT LOAD.
    UNKNOWN means nothing in the catalogue carries the code."""

    outcome: ScanResult
    scanned_sku: str | None


def decide_scan(scanned_sku: str | None, expected_skus: Collection[str]) -> ScanDecision:
    """`scanned_sku` is the catalogue SKU the code resolved to, or None if it resolved to nothing."""
    if scanned_sku is None:
        return ScanDecision(ScanResult.UNKNOWN, None)
    if scanned_sku in expected_skus:
        return ScanDecision(ScanResult.MATCH, scanned_sku)
    return ScanDecision(ScanResult.MISMATCH, scanned_sku)
