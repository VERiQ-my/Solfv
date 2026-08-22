"""
4.1 - the single public interface of the Data lane.

Backend calls analyse() once and returns the result verbatim. This is the only
coupling point between Data and the rest of the system; nothing in `analysis/`
is imported anywhere else.

Order matters and is not arbitrary:

    derive -> check -> quarantine -> ratios -> risk / benchmark / say-do

Ratios are computed from figures the reconciliation engine has already vetted.
Reversing that order would let a doctored balance sheet produce a confident
gearing number, which is the exact failure this whole system exists to prevent.
"""

from __future__ import annotations

from .benchmark import benchmark
from .checks import assign_trust, derive_missing, quarantined_keys, run_checks
from .ratios import altman, compute_ratios
from .saydo import say_do_gap


def analyse(
    extraction: dict,
    market_data: dict | None = None,
    peers: dict | None = None,
) -> dict:
    """Run the whole Data lane over one extraction.

    `peers` is the parsed fixtures/sector_peers.json. Backend loads it - nothing
    in `analysis/` touches the filesystem. Omit it and `benchmark` comes back
    empty, which is the intended degradation: the benchmark is first on the cut
    list and its absence must never break the dashboard.

    `market_data` is optional: {"market_cap": float, "share_price_1y": float}.
    market_cap switches Altman from Z'' to the original listed-company Z, and
    share_price_1y unlocks the market-vs-narrative Say-Do rows.
    """
    extraction = extraction or {}
    market_data = market_data or {}

    raw_items = extraction.get("line_items") or []
    prior_block = extraction.get("prior_period") or {}
    prior_items = prior_block.get("line_items") or []

    # 1. Fill income-statement subtotals the document did not print.
    items = derive_missing(raw_items)

    # 2. Reconcile, then quarantine whatever failed.
    checks = run_checks(items, prior_items)
    quarantined = set(quarantined_keys(checks))

    # 3. Re-badge every figure against the check results.
    items = assign_trust(items, checks)
    prior_items_scored = assign_trust(derive_missing(prior_items), [])

    # 4. Ratios, withholding anything built on a quarantined figure.
    ratios = compute_ratios(items, excluded=quarantined)
    prior_ratios = compute_ratios(prior_items_scored) if prior_items else {}

    # 5. Risk, benchmark, narrative.
    risk = altman(items, market_cap=market_data.get("market_cap"),
                  excluded=quarantined)

    return {
        "entity": extraction.get("entity"),
        "period": extraction.get("period"),
        "prior_period": prior_block.get("period"),
        "currency": extraction.get("currency"),
        "unit": extraction.get("unit"),
        "ticker": extraction.get("ticker"),

        "line_items": items,
        "prior_line_items": prior_items_scored,

        "checks": checks,
        "quarantined": sorted(quarantined),

        "ratios": ratios,
        "prior_ratios": prior_ratios,
        "risk": risk,
        "benchmark": benchmark(ratios, peers) if peers else [],
        "say_do_gap": say_do_gap(
            extraction.get("narrative_claims") or [],
            ratios,
            prior_ratios,
            market_data,
            items,
            prior_items_scored,
        ),

        "summary": _summary(items, checks),
    }


def _summary(line_items: list[dict], checks: list[dict]) -> dict:
    """Headline counts for the dashboard chrome and the pitch."""
    trust_counts = {"VERIFIED": 0, "DERIVED": 0, "UNVERIFIED": 0}
    for item in line_items:
        trust = item.get("trust", "UNVERIFIED")
        if trust in trust_counts:
            trust_counts[trust] += 1

    return {
        "line_item_count": len(line_items),
        "trust": trust_counts,
        "checks_passed": sum(1 for c in checks if c.get("status") == "PASS"),
        "checks_failed": sum(1 for c in checks if c.get("status") == "FAIL"),
        "checks_unverifiable": sum(1 for c in checks if c.get("status") == "UNVERIFIABLE"),
    }
