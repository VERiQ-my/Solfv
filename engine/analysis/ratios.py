"""
4.3 - the ratio pack and Altman Z.

Six ratios. Nobody counts ratios in a demo.

Hard rule: a ratio whose inputs are missing returns None. Never substitute
zero. A missing ratio renders as "insufficient data", not as 0.0 - a 0.0
gearing on screen is a lie the UI cannot walk back.
"""

from __future__ import annotations

from .schema import RATIO_KEYS, safe_div, to_map


def _as_map(li: dict | list) -> dict[str, float]:
    """Accept either a {key: value} map or a raw Contract 1 line_items list."""
    return to_map(li) if isinstance(li, list) else dict(li or {})


def compute_ratios(li: dict | list, excluded: set[str] | None = None) -> dict:
    """The six ratios, or None per ratio where inputs are missing.

    `excluded` carries the keys checks.quarantined_keys() refused to stand
    behind. A ratio touching a quarantined figure is withheld rather than
    printed - that is the whole point of the reconciliation engine. Without it
    a doctored balance sheet would still render a confident gearing number.
    """
    values = _as_map(li)
    for key in (excluded or set()):
        values.pop(key, None)

    def v(key: str) -> float | None:
        value = values.get(key)
        return float(value) if isinstance(value, (int, float)) else None

    st_debt, lt_debt = v("st_debt"), v("lt_debt")
    total_debt = None if st_debt is None or lt_debt is None else st_debt + lt_debt

    ratios = {
        "current_ratio":  safe_div(v("current_assets"), v("current_liabilities")),
        "gearing":        safe_div(total_debt, v("total_equity")),
        "interest_cover": safe_div(v("ebit"), v("interest_expense")),
        "gross_margin":   safe_div(v("gross_profit"), v("revenue")),
        "net_margin":     safe_div(v("pat"), v("revenue")),
        "roe":            safe_div(v("pat"), v("total_equity")),
    }
    assert set(ratios) == set(RATIO_KEYS), "compute_ratios drifted from RATIO_KEYS"
    return ratios


# --------------------------------------------------------------------------
# Altman Z
# --------------------------------------------------------------------------

# variant -> (safe threshold, distress threshold)
_ZONES = {
    "Z''": (2.60, 1.10),
    "Z":   (2.99, 1.81),
}


def _zone(score: float, variant: str) -> str:
    safe, distress = _ZONES[variant]
    if score > safe:
        return "SAFE"
    if score < distress:
        return "DISTRESS"
    return "GREY"


def altman(li: dict | list, market_cap: float | None = None,
           excluded: set[str] | None = None) -> dict:
    """Altman Z-Score, both variants.

    Without market_cap -> Z'' (private / non-manufacturer)
        Z'' = 6.56*X1 + 3.26*X2 + 6.72*X3 + 1.05*X4
        Zones: >2.60 SAFE | 1.10-2.60 GREY | <1.10 DISTRESS

    With market_cap -> original Z (listed)
        Z = 1.2*X1 + 1.4*X2 + 3.3*X3 + 0.6*X4 + 1.0*X5
        Zones: >2.99 SAFE | 1.81-2.99 GREY | <1.81 DISTRESS

    `drivers` is the explainability requirement satisfied without an LLM: the
    UI shows which components pushed the score down, ranked by contribution.
    """
    values = _as_map(li)
    for key in (excluded or set()):
        values.pop(key, None)

    def v(key: str) -> float | None:
        value = values.get(key)
        return float(value) if isinstance(value, (int, float)) else None

    total_assets = v("total_assets")
    variant = "Z" if market_cap is not None else "Z''"

    working_capital = None
    if v("current_assets") is not None and v("current_liabilities") is not None:
        working_capital = v("current_assets") - v("current_liabilities")

    if variant == "Z''":
        spec = [
            ("X1", "Working capital / total assets", 6.56,
             safe_div(working_capital, total_assets)),
            ("X2", "Retained earnings / total assets", 3.26,
             safe_div(v("retained_earnings"), total_assets)),
            ("X3", "EBIT / total assets", 6.72,
             safe_div(v("ebit"), total_assets)),
            ("X4", "Total equity / total liabilities", 1.05,
             safe_div(v("total_equity"), v("total_liabilities"))),
        ]
    else:
        spec = [
            ("X1", "Working capital / total assets", 1.2,
             safe_div(working_capital, total_assets)),
            ("X2", "Retained earnings / total assets", 1.4,
             safe_div(v("retained_earnings"), total_assets)),
            ("X3", "EBIT / total assets", 3.3,
             safe_div(v("ebit"), total_assets)),
            ("X4", "Market capitalisation / total liabilities", 0.6,
             safe_div(market_cap, v("total_liabilities"))),
            ("X5", "Revenue / total assets", 1.0,
             safe_div(v("revenue"), total_assets)),
        ]

    drivers = [
        {
            "name": name,
            "label": label,
            "weight": weight,
            "value": value,
            "contribution": None if value is None else weight * value,
        }
        for name, label, weight, value in spec
    ]

    missing = [d["name"] for d in drivers if d["value"] is None]
    if missing:
        return {
            "score": None,
            "zone": None,
            "variant": variant,
            "drivers": drivers,
            "detail": (
                "Insufficient data: " + ", ".join(missing) +
                " could not be computed from verified figures."
            ),
        }

    score = sum(d["contribution"] for d in drivers)
    zone = _zone(score, variant)

    # Most negative contribution first - the UI leads with what hurt.
    drivers.sort(key=lambda d: d["contribution"])

    return {
        "score": score,
        "zone": zone,
        "variant": variant,
        "drivers": drivers,
        "detail": f"{variant} = {score:.2f} ({zone} zone).",
    }
