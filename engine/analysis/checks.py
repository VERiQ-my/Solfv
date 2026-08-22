"""
4.2 - the reconciliation engine. THE MOAT.

Deterministic accounting-identity checks over LLM output. There is no AI
anywhere in this file and there must never be. A figure that fails a check is
quarantined and never reaches the dashboard as trustworthy.

A failing check is never swallowed. It surfaces in red with expected vs actual,
on purpose, and we demo it deliberately (spec section 10, the 2:30 beat).
"""

from __future__ import annotations

from .schema import CANONICAL_KEY_SET, Check, to_map

# 1% relative - absorbs the rounding published accounts are printed with.
TOLERANCE = 0.01

# Current-asset composition legitimately under-sums in real reports: prepayments,
# tax recoverable and derivative assets sit in current assets but have no
# canonical key. So it gets its own looser bound and is labelled a "composition
# check", not an identity.
COMPOSITION_TOLERANCE = 0.05

PASS = "PASS"
FAIL = "FAIL"
UNVERIFIABLE = "UNVERIFIABLE"


# --------------------------------------------------------------------------
# Derivation
# --------------------------------------------------------------------------

# key -> (formula label, operand keys, combining function)
#
# Deliberately excludes every balance-sheet key. Deriving total_equity from
# total_assets - total_liabilities would make the balance sheet identity check
# pass by construction and the moat would be checking its own arithmetic. Only
# income-statement subtotals that no check tests are derived here.
_DERIVABLE: dict[str, tuple[str, tuple[str, ...]]] = {
    "gross_profit": ("revenue - cogs", ("revenue", "cogs")),
    "ebit": ("gross_profit - opex", ("gross_profit", "opex")),
}


def derive_missing(line_items: list[dict]) -> list[dict]:
    """Fill absent income-statement subtotals from their components.

    Returned items carry `derived: True` and a `derivation` label, which
    assign_trust turns into the DERIVED badge. Order matters: ebit depends on
    gross_profit, so gross_profit is derived first.
    """
    items = [dict(item) for item in line_items or []]
    present = to_map(items)

    for key, (formula, operands) in _DERIVABLE.items():
        if key in present:
            continue
        if any(operand not in present for operand in operands):
            continue

        if key == "gross_profit":
            value = present["revenue"] - present["cogs"]
        else:  # ebit
            value = present["gross_profit"] - present["opex"]

        items.append({
            "canonical_key": key,
            "label_as_printed": None,
            "value": value,
            "page": None,
            "bbox": None,
            "trust": "DERIVED",
            "derived": True,
            "derivation": formula,
        })
        present[key] = value

    return items


# --------------------------------------------------------------------------
# The three checks
# --------------------------------------------------------------------------

def _build(
    name: str,
    formula: str,
    expected: float | None,
    actual: float | None,
    affected_keys: list[str],
    tolerance: float,
    missing: list[str],
) -> Check:
    """Assemble one Check, resolving PASS / FAIL / UNVERIFIABLE."""
    if missing:
        return {
            "name": name,
            "formula": formula,
            "expected": None,
            "actual": None,
            "delta": None,
            "delta_pct": None,
            "tolerance": tolerance,
            "passed": False,
            "status": UNVERIFIABLE,
            "detail": "Not present in the document: " + ", ".join(sorted(missing)),
            "affected_keys": affected_keys,
        }

    delta = actual - expected
    if expected == 0:
        # No meaningful relative measure against zero; fall back to an absolute
        # sub-unit bound (values are in whole thousands).
        within = abs(delta) < 1.0
        delta_pct = None
    else:
        delta_pct = abs(delta) / abs(expected)
        within = delta_pct <= tolerance

    return {
        "name": name,
        "formula": formula,
        "expected": expected,
        "actual": actual,
        "delta": delta,
        "delta_pct": delta_pct,
        "tolerance": tolerance,
        "passed": within,
        "status": PASS if within else FAIL,
        "detail": (
            f"Reconciles within {tolerance:.0%}."
            if within
            else f"Off by {delta:+,.0f} against a {tolerance:.0%} tolerance."
        ),
        "affected_keys": affected_keys,
    }


def run_checks(
    line_items: list[dict],
    prior_line_items: list[dict] | None = None,
) -> list[Check]:
    """Run all three reconciliation checks.

    `prior_line_items` is optional and only feeds check 3. Without it the
    retained-earnings roll-forward reports UNVERIFIABLE rather than guessing.
    """
    li = to_map(line_items)
    prior = to_map(prior_line_items) if prior_line_items else {}

    checks: list[Check] = []

    # 1. Balance sheet identity ------------------------------------------------
    keys = ("total_liabilities", "total_equity", "total_assets")
    missing = [k for k in keys if k not in li]
    checks.append(_build(
        name="Balance sheet identity",
        formula="total_assets == total_liabilities + total_equity",
        expected=(li["total_liabilities"] + li["total_equity"]) if not missing else None,
        actual=li.get("total_assets"),
        affected_keys=["total_assets", "total_liabilities", "total_equity"],
        tolerance=TOLERANCE,
        missing=missing,
    ))

    # 2. Current assets composition --------------------------------------------
    keys = ("cash", "receivables", "inventory", "current_assets")
    missing = [k for k in keys if k not in li]
    checks.append(_build(
        name="Current assets composition",
        formula="current_assets == cash + receivables + inventory",
        expected=(li["cash"] + li["receivables"] + li["inventory"]) if not missing else None,
        actual=li.get("current_assets"),
        affected_keys=["current_assets", "cash", "receivables", "inventory"],
        tolerance=COMPOSITION_TOLERANCE,
        missing=missing,
    ))

    # 3. Retained earnings roll-forward ----------------------------------------
    missing = [k for k in ("retained_earnings", "pat", "dividends") if k not in li]
    if "retained_earnings" not in prior:
        missing.append("prior-period retained_earnings")
    checks.append(_build(
        name="Retained earnings roll-forward",
        formula="retained_earnings_close == retained_earnings_open + pat - dividends",
        expected=(
            prior["retained_earnings"] + li["pat"] - li["dividends"]
            if not missing else None
        ),
        actual=li.get("retained_earnings"),
        affected_keys=["retained_earnings", "pat", "dividends"],
        tolerance=TOLERANCE,
        missing=missing,
    ))

    return checks


# --------------------------------------------------------------------------
# Trust assignment
# --------------------------------------------------------------------------

def assign_trust(line_items: list[dict], checks: list[Check]) -> list[dict]:
    """Overwrite the `trust` Backend wrote with the verdict of the checks.

    VERIFIED   -> traceable to a bbox AND not implicated in any failing check
    DERIVED    -> computed here, not extracted from the document
    UNVERIFIED -> implicated in a failing check, OR has no bbox to point at

    An UNVERIFIABLE check quarantines nothing. A missing prior year is our gap,
    not evidence against the figure, so it must not turn the number amber.
    """
    failing_keys: set[str] = set()
    passing_by_key: dict[str, list[str]] = {}

    for check in checks:
        if check.get("status") == FAIL:
            failing_keys.update(check.get("affected_keys") or [])
        elif check.get("status") == PASS:
            for key in check.get("affected_keys") or []:
                passing_by_key.setdefault(key, []).append(check["name"])

    out: list[dict] = []
    for item in line_items or []:
        item = dict(item)
        key = item.get("canonical_key")

        # `checked_by` is not a trust level, it is the honest detail behind the
        # badge: which identity actually vouched for this number. A figure with
        # a bbox but no covering check reads VERIFIED, and the UI should be able
        # to say "traced to source, not cross-checked".
        item["checked_by"] = passing_by_key.get(key, [])

        if key not in CANONICAL_KEY_SET:
            item["trust"] = "UNVERIFIED"
        elif key in failing_keys:
            item["trust"] = "UNVERIFIED"
        elif item.get("derived"):
            item["trust"] = "DERIVED"
        elif item.get("bbox") is None or item.get("page") is None:
            item["trust"] = "UNVERIFIED"
        else:
            item["trust"] = "VERIFIED"

        out.append(item)

    return out


def quarantined_keys(checks: list[Check]) -> list[str]:
    """Keys the engine refuses to stand behind. Used by ratios.py to withhold
    any ratio built on a figure that failed reconciliation."""
    out: set[str] = set()
    for check in checks:
        if check.get("status") == FAIL:
            out.update(check.get("affected_keys") or [])
    return sorted(out)
