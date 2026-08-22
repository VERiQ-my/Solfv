"""
4.5 - the Say-Do Gap. THE DIFFERENTIATOR.

Deterministic. The LLM's only job happened upstream during extraction: turning
a sentence into {metric, direction}. This file tests that assertion against
computed values and nothing here is generative.

The verdict rules are conventional credit-analysis rules of thumb, declared as
data below so the UI can show the threshold next to the verdict. A judge who
disagrees with a threshold can see exactly which one we applied, which is a far
better position than "the model thought so".
"""

from __future__ import annotations

from .schema import (
    HIGHER_IS_BETTER,
    MARKET_METRICS,
    PERCENT_RATIOS,
    Gap,
    to_map,
)

# metric -> level at which an absolute "strong" claim is honest.
# For gearing, lower is better, so the comparison is inverted.
STRONG_THRESHOLD: dict[str, float] = {
    "current_ratio":  1.50,   # conventional banker's comfort level
    "gearing":        1.00,   # debt no greater than equity
    "interest_cover": 3.00,   # earnings cover finance costs three times over
    "gross_margin":   0.30,
    "net_margin":     0.10,
    "roe":            0.15,
}

# A YoY move smaller than this is flat, not a trend.
MATERIAL_MOVE = 0.01

# "stable" tolerates this much drift before it becomes a misstatement.
STABLE_BAND = 0.05

# Line items whose YoY move explains a ratio move. Used only to enrich the
# human-readable "actual" string - never to decide a verdict.
#
# These are the ratio's own numerator and denominator, not merely related
# figures. Picking something adjacent misexplains the move: pairing net_margin
# with opex reads "opex -43%" next to a halved margin, which invites exactly
# the wrong conclusion when the real cause is collapsed gross profit.
_CONTEXT_KEYS: dict[str, tuple[str, ...]] = {
    "current_ratio":  ("current_assets", "current_liabilities"),
    "gearing":        ("st_debt", "lt_debt", "total_equity"),
    "interest_cover": ("ebit", "interest_expense"),
    "gross_margin":   ("revenue", "cogs"),
    "net_margin":     ("pat", "revenue"),
    "roe":            ("pat", "total_equity"),
}

SUPPORTED = "SUPPORTED"
CONTRADICTED = "CONTRADICTED"
UNVERIFIABLE = "UNVERIFIABLE"


def _fmt(metric: str, value: float | None) -> str:
    if value is None:
        return "n/a"
    if metric in PERCENT_RATIOS:
        return f"{value:.2%}"
    if metric == "share_price_1y":
        return f"{value:+.1%}"
    # A debt-free balance sheet gives a gearing of 0.0001, and rounding that to
    # "0.00" makes a real figure look like a missing one.
    if value != 0 and abs(value) < 0.01:
        return f"{value:.4f}"
    return f"{value:.2f}"


def _pct_change(now: float, before: float) -> float | None:
    if before == 0:
        return None
    return now / before - 1


def _context(metric: str, li: dict[str, float], prior: dict[str, float]) -> str:
    """e.g. "opex +31.0%, revenue +4.0%" - the colour behind a margin move."""
    parts = []
    for key in _CONTEXT_KEYS.get(metric, ()):
        if key in li and key in prior:
            change = _pct_change(li[key], prior[key])
            if change is not None:
                parts.append(f"{key} {change:+.1%}")
    return f" ({', '.join(parts)})" if parts else ""


def _gap(claim: dict, claimed: str, actual: str, verdict: str, basis: str) -> Gap:
    return {
        "sentence": claim.get("sentence", ""),
        "page": claim.get("page"),
        "metric": claim.get("metric", ""),
        "claimed": claimed,
        "actual": actual,
        "verdict": verdict,
        "basis": basis,
    }


def say_do_gap(
    claims: list[dict],
    ratios: dict,
    prior_ratios: dict | None = None,
    market_data: dict | None = None,
    line_items: list[dict] | None = None,
    prior_line_items: list[dict] | None = None,
) -> list[Gap]:
    """Test every narrative claim against the computed numbers.

    `line_items` / `prior_line_items` are optional and feed the explanatory
    suffix only. They can never change a verdict.

    A metric missing from `ratios` yields UNVERIFIABLE. We never guess - and
    note that a figure quarantined by the reconciliation engine arrives here
    already stripped out of `ratios`, so a doctored balance sheet turns its
    dependent claims UNVERIFIABLE rather than silently mis-judging them.
    """
    prior_ratios = prior_ratios or {}
    market_data = market_data or {}
    li = to_map(line_items) if line_items else {}
    prior_li = to_map(prior_line_items) if prior_line_items else {}

    gaps: list[Gap] = []

    for claim in claims or []:
        metric = claim.get("metric")
        direction = claim.get("direction")

        # ---- market-vs-narrative rows -------------------------------------
        if metric in MARKET_METRICS:
            value = market_data.get(metric)
            if not isinstance(value, (int, float)):
                gaps.append(_gap(
                    claim, f"{direction}", "n/a", UNVERIFIABLE,
                    "No market data for this ticker.",
                ))
                continue
            favourable = value > 0
            wants_up = direction in ("improving", "strong", "stable")
            verdict = SUPPORTED if favourable == wants_up else CONTRADICTED
            gaps.append(_gap(
                claim, f"{direction}", f"{_fmt(metric, value)} over 12 months",
                verdict, "Claim tested against market price movement.",
            ))
            continue

        # ---- ratio rows ----------------------------------------------------
        now = ratios.get(metric)
        if not isinstance(now, (int, float)):
            gaps.append(_gap(
                claim, f"{direction}", "insufficient data", UNVERIFIABLE,
                "Metric could not be computed from verified figures.",
            ))
            continue

        before = prior_ratios.get(metric)
        has_prior = isinstance(before, (int, float))
        higher_better = HIGHER_IS_BETTER.get(metric, True)
        suffix = _context(metric, li, prior_li) if has_prior else ""

        # Absolute-level claims -------------------------------------------
        if direction in ("strong", "weak"):
            threshold = STRONG_THRESHOLD.get(metric)
            if threshold is None:
                gaps.append(_gap(
                    claim, direction, _fmt(metric, now), UNVERIFIABLE,
                    "No absolute threshold defined for this metric.",
                ))
                continue
            healthy = now >= threshold if higher_better else now <= threshold
            wants_healthy = direction == "strong"
            verdict = SUPPORTED if healthy == wants_healthy else CONTRADICTED
            comparator = "at or above" if higher_better else "at or below"
            gaps.append(_gap(
                claim, direction, _fmt(metric, now), verdict,
                f"'{direction}' requires {metric} {comparator} "
                f"{_fmt(metric, threshold)}; actual {_fmt(metric, now)}.",
            ))
            continue

        # Trend claims -----------------------------------------------------
        if not has_prior:
            gaps.append(_gap(
                claim, direction, _fmt(metric, now), UNVERIFIABLE,
                "No prior-period comparative in the document, so a "
                "year-on-year claim cannot be tested.",
            ))
            continue

        movement = f"{_fmt(metric, before)} -> {_fmt(metric, now)}{suffix}"
        change = _pct_change(now, before)

        if direction == "stable":
            steady = change is not None and abs(change) <= STABLE_BAND
            gaps.append(_gap(
                claim, "stable", movement,
                SUPPORTED if steady else CONTRADICTED,
                f"'stable' allows a move of up to {STABLE_BAND:.0%}; "
                f"actual move {change:+.1%}." if change is not None
                else "Prior value is zero, so no relative move exists.",
            ))
            continue

        if direction in ("improving", "declining"):
            delta = now - before
            if abs(change or 0) < MATERIAL_MOVE:
                moved = "flat"
            elif (delta > 0) == higher_better:
                moved = "improving"
            else:
                moved = "declining"
            verdict = SUPPORTED if moved == direction else CONTRADICTED
            better = "higher" if higher_better else "lower"
            gaps.append(_gap(
                claim, direction, movement, verdict,
                f"{metric} is better when {better}; it actually moved "
                f"{change:+.1%}, i.e. {moved}.",
            ))
            continue

        gaps.append(_gap(
            claim, str(direction), _fmt(metric, now), UNVERIFIABLE,
            f"Unrecognised direction {direction!r}.",
        ))

    # CONTRADICTED first - the demo leads with the gaps, not the agreements.
    order = {CONTRADICTED: 0, UNVERIFIABLE: 1, SUPPORTED: 2}
    gaps.sort(key=lambda g: order.get(g["verdict"], 3))
    return gaps
