"""
SEMAK - frozen contracts for the Data lane.

Nothing in `analysis/` may import a framework, touch the network, or read a
file. Every function here must be unit-testable with a dict literal.

Section references are to SEMAK_BUILD_SPEC.md.
"""

from __future__ import annotations

from typing import Any, Literal, TypedDict

# --------------------------------------------------------------------------
# 2.1 Canonical chart of accounts - FROZEN. Nothing else is a valid key.
# --------------------------------------------------------------------------

CANONICAL_KEYS: list[str] = [
    "total_assets", "total_liabilities", "total_equity",
    "current_assets", "current_liabilities",
    "cash", "receivables", "inventory",
    "st_debt", "lt_debt", "retained_earnings",
    "revenue", "cogs", "gross_profit", "opex",
    "ebit", "interest_expense", "pat",
    "operating_cf", "dividends",
]

CANONICAL_KEY_SET = frozenset(CANONICAL_KEYS)

# Human labels for the UI. Backend keeps `label_as_printed` from the source
# document; this is the fallback when a key is DERIVED and never printed.
CANONICAL_LABELS: dict[str, str] = {
    "total_assets": "Total assets",
    "total_liabilities": "Total liabilities",
    "total_equity": "Total equity",
    "current_assets": "Current assets",
    "current_liabilities": "Current liabilities",
    "cash": "Cash and cash equivalents",
    "receivables": "Trade and other receivables",
    "inventory": "Inventories",
    "st_debt": "Short-term borrowings",
    "lt_debt": "Long-term borrowings",
    "retained_earnings": "Retained earnings",
    "revenue": "Revenue",
    "cogs": "Cost of sales",
    "gross_profit": "Gross profit",
    "opex": "Operating expenses",
    "ebit": "Operating profit (EBIT)",
    "interest_expense": "Finance costs",
    "pat": "Profit after tax",
    "operating_cf": "Net cash from operating activities",
    "dividends": "Dividends paid",
}

# --------------------------------------------------------------------------
# Trust levels (4.2) and narrative directions (2.2)
# --------------------------------------------------------------------------

Trust = Literal["VERIFIED", "DERIVED", "UNVERIFIED"]
TRUST_LEVELS: tuple[str, ...] = ("VERIFIED", "DERIVED", "UNVERIFIED")

Direction = Literal["strong", "weak", "improving", "declining", "stable"]
DIRECTIONS: tuple[str, ...] = ("strong", "weak", "improving", "declining", "stable")

Verdict = Literal["SUPPORTED", "CONTRADICTED", "UNVERIFIABLE"]
VERDICTS: tuple[str, ...] = ("SUPPORTED", "CONTRADICTED", "UNVERIFIABLE")

# 2.2: `metric` on a narrative claim must be a key returned by compute_ratios().
RATIO_KEYS: tuple[str, ...] = (
    "current_ratio",
    "gearing",
    "interest_cover",
    "gross_margin",
    "net_margin",
    "roe",
)

# Ratios where a *higher* number is the better outcome. Used by saydo.py to
# turn a YoY move into improving/declining without a lookup table per claim.
HIGHER_IS_BETTER: dict[str, bool] = {
    "current_ratio": True,
    "gearing": False,
    "interest_cover": True,
    "gross_margin": True,
    "net_margin": True,
    "roe": True,
}

# Ratios rendered as percentages in the UI.
PERCENT_RATIOS: frozenset[str] = frozenset({"gross_margin", "net_margin", "roe"})

# 4.5 sanctions market-vs-narrative Gap rows, which carry a metric that is not
# a compute_ratios() key. These resolve against `market_data`, not `ratios`.
MARKET_METRICS: tuple[str, ...] = ("share_price_1y", "market_cap")

VALID_CLAIM_METRICS: frozenset[str] = frozenset(RATIO_KEYS) | frozenset(MARKET_METRICS)


# --------------------------------------------------------------------------
# 2.2 Contract 1 - extraction JSON
# --------------------------------------------------------------------------

class LineItem(TypedDict, total=False):
    canonical_key: str
    label_as_printed: str
    value: float
    page: int | None
    bbox: list[float] | None   # [x0, top, x1, bottom] in pdfplumber coords
    trust: Trust


class NarrativeClaim(TypedDict, total=False):
    sentence: str
    page: int | None
    metric: str                # must be in RATIO_KEYS
    direction: Direction


class Check(TypedDict):
    name: str
    expected: float
    actual: float
    delta: float
    passed: bool
    affected_keys: list[str]


class Gap(TypedDict):
    sentence: str
    page: int | None
    metric: str
    claimed: str
    actual: str
    verdict: Verdict


# --------------------------------------------------------------------------
# Helpers - the only shared vocabulary between checks/ratios/saydo/query
# --------------------------------------------------------------------------

def to_map(line_items: list[dict]) -> dict[str, float]:
    """Collapse Contract 1 line_items into {canonical_key: value}.

    Ignores unknown keys and null values rather than raising. A malformed
    extraction must degrade into missing ratios, never a 500.
    """
    out: dict[str, float] = {}
    for item in line_items or []:
        key = item.get("canonical_key")
        value = item.get("value")
        if key in CANONICAL_KEY_SET and isinstance(value, (int, float)):
            out[key] = float(value)
    return out


def get(li: dict[str, Any], *keys: str) -> tuple[float, ...] | None:
    """Fetch several values at once, or None if ANY of them is missing.

    Guards the 4.3 rule: return None for a ratio with missing inputs. Never
    substitute zero.
    """
    values = []
    for key in keys:
        value = li.get(key)
        if not isinstance(value, (int, float)):
            return None
        values.append(float(value))
    return tuple(values)


def safe_div(numerator: float | None, denominator: float | None) -> float | None:
    """Division that yields None instead of raising or returning inf."""
    if numerator is None or denominator is None:
        return None
    if denominator == 0:
        return None
    return numerator / denominator
