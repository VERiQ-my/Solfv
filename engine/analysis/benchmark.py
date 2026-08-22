"""
4.4 - Bursa peer comparison.

Benchmarking a company against a population is what a credit bureau does. A
single set of statements can never tell you that gearing of 2.4x sits against
a sector median of 0.87x.

Peers are read from fixtures/sector_peers.json - cached and committed. Live
yfinance calls are a fallback only, never the default path, because a network
dependency upstream of the dashboard is a demo that dies at step one.
"""

from __future__ import annotations

from .schema import HIGHER_IS_BETTER, PERCENT_RATIOS, RATIO_KEYS

# Within this much of the sector median counts as IN_LINE.
IN_LINE_BAND = 0.20

BETTER = "BETTER"
IN_LINE = "IN_LINE"
WORSE = "WORSE"
INSUFFICIENT = "INSUFFICIENT_DATA"

LABELS: dict[str, str] = {
    "current_ratio":  "Current ratio",
    "gearing":        "Gearing",
    "interest_cover": "Interest cover",
    "gross_margin":   "Gross margin",
    "net_margin":     "Net margin",
    "roe":            "Return on equity",
}


def _percentile(value: float, peer_values: list[float], higher_better: bool) -> float | None:
    """Share of peers this company beats, 0-100, already direction-aware.

    Reported as goodness, not as raw rank: a low gearing scores high. The UI
    can then say "82nd percentile" for every metric without the reader having
    to remember which way each ratio points.
    """
    values = [v for v in peer_values if isinstance(v, (int, float))]
    if not values:
        return None
    if higher_better:
        beaten = sum(1 for v in values if value > v)
    else:
        beaten = sum(1 for v in values if value < v)
    return round(100.0 * beaten / len(values), 1)


def benchmark(ratios: dict, peers: dict) -> list[dict]:
    """Compare the company's ratios against sector medians.

    Returns [{metric, label, company, sector_median, percentile, verdict, ...}]
    verdict in {BETTER, IN_LINE, WORSE, INSUFFICIENT_DATA}.

    INSUFFICIENT_DATA is not in the spec's original three, but it is the honest
    outcome when the reconciliation engine has quarantined the figures a ratio
    needs. The row still renders, greyed, rather than vanishing and leaving the
    chart quietly shorter than it was a moment ago.
    """
    metrics = (peers or {}).get("metrics") or {}
    out: list[dict] = []

    for metric in RATIO_KEYS:
        peer = metrics.get(metric) or {}
        median = peer.get("median")
        if not isinstance(median, (int, float)):
            continue

        company = (ratios or {}).get(metric)
        higher_better = HIGHER_IS_BETTER.get(metric, True)
        row = {
            "metric": metric,
            "label": LABELS.get(metric, metric),
            "company": company if isinstance(company, (int, float)) else None,
            "sector_median": median,
            "peer_count": peer.get("n") or len(peer.get("values") or []),
            "higher_is_better": higher_better,
            "is_percentage": metric in PERCENT_RATIOS,
        }

        if row["company"] is None:
            out.append({**row, "percentile": None, "gap_pct": None,
                        "verdict": INSUFFICIENT})
            continue

        if median == 0:
            out.append({**row, "percentile": None, "gap_pct": None,
                        "verdict": INSUFFICIENT})
            continue

        gap = company / median - 1
        if abs(gap) <= IN_LINE_BAND:
            verdict = IN_LINE
        elif (gap > 0) == higher_better:
            verdict = BETTER
        else:
            verdict = WORSE

        out.append({
            **row,
            "percentile": _percentile(company, peer.get("values") or [], higher_better),
            "gap_pct": gap,
            "verdict": verdict,
        })

    return out
