"""
4.6 - grounded lookup, not a chatbot.

An LLM maps the question to (canonical_key | ratio_name, period). This module
then does a DICT LOOKUP. It physically cannot hallucinate a number because it
never generates one - it only retrieves.

The guaranteed refusal is the point. When a judge asks a spontaneous question
the system cannot answer, it says so. That reads as more trustworthy than a
system that always has an answer.
"""

from __future__ import annotations

import re

from .schema import (
    CANONICAL_KEY_SET,
    CANONICAL_LABELS,
    PERCENT_RATIOS,
    RATIO_KEYS,
)

NOT_FOUND_MESSAGE = "Not present in these documents."

# Which extracted figures each ratio is built from. Lets the UI highlight the
# source cells behind a ratio, so click-to-source survives one level of
# arithmetic instead of stopping at raw line items.
RATIO_INPUTS: dict[str, tuple[str, ...]] = {
    "current_ratio":  ("current_assets", "current_liabilities"),
    "gearing":        ("st_debt", "lt_debt", "total_equity"),
    "interest_cover": ("ebit", "interest_expense"),
    "gross_margin":   ("gross_profit", "revenue"),
    "net_margin":     ("pat", "revenue"),
    "roe":            ("pat", "total_equity"),
}

RATIO_LABELS: dict[str, str] = {
    "current_ratio":  "Current ratio",
    "gearing":        "Gearing",
    "interest_cover": "Interest cover",
    "gross_margin":   "Gross margin",
    "net_margin":     "Net margin",
    "roe":            "Return on equity",
}

# Deterministic fallback router. Used when no LLM router is supplied, and as
# insurance for when the provider is down mid-demo - the query bar keeps
# working for the obvious questions rather than going dark.
# Longest phrases first so "current assets" never matches on "assets".
_KEYWORDS: list[tuple[str, str, str]] = [
    (r"\bcurrent ratio\b|\bliquidity\b",                    "current_ratio",       "ratio"),
    (r"\bgearing\b|\bleverage\b|\bdebt to equity\b",         "gearing",             "ratio"),
    (r"\binterest cover\b|\bfinance cost cover\b",           "interest_cover",      "ratio"),
    (r"\bgross margin\b",                                    "gross_margin",        "ratio"),
    (r"\bnet margin\b|\bprofit margin\b",                    "net_margin",          "ratio"),
    (r"\broe\b|\breturn on equity\b",                        "roe",                 "ratio"),
    (r"\bcurrent assets\b",                                  "current_assets",      "line_item"),
    (r"\bcurrent liabilities\b",                             "current_liabilities", "line_item"),
    (r"\btotal assets\b",                                    "total_assets",        "line_item"),
    (r"\btotal liabilit",                                    "total_liabilities",   "line_item"),
    (r"\btotal equity\b|\bshareholders.? funds\b",           "total_equity",        "line_item"),
    (r"\bretained earnings\b",                               "retained_earnings",   "line_item"),
    (r"\bshort.?term (debt|borrowing)",                      "st_debt",             "line_item"),
    (r"\blong.?term (debt|borrowing)",                       "lt_debt",             "line_item"),
    (r"\breceivable",                                        "receivables",         "line_item"),
    (r"\binventor|\bstock in trade\b",                       "inventory",           "line_item"),
    (r"\bcash\b|\bbank balance",                             "cash",                "line_item"),
    (r"\brevenue\b|\bturnover\b|\bsales\b|\btop line\b",     "revenue",             "line_item"),
    (r"\bcost of sales\b|\bcogs\b",                          "cogs",                "line_item"),
    (r"\bgross profit\b",                                    "gross_profit",        "line_item"),
    (r"\boperating expens|\bopex\b|\boverhead",              "opex",                "line_item"),
    (r"\bebit\b|\boperating profit\b",                       "ebit",                "line_item"),
    (r"\bfinance cost|\binterest expense\b",                 "interest_expense",    "line_item"),
    (r"\bprofit after tax\b|\bpat\b|\bnet profit\b|\bbottom line\b", "pat",         "line_item"),
    (r"\boperating cash|\bcash flow from operat",            "operating_cf",        "line_item"),
    (r"\bdividend",                                          "dividends",           "line_item"),
]

_PRIOR = re.compile(
    r"\blast year\b|\bprior year\b|\bprevious year\b|\bcomparative\b|\bprior period\b",
    re.IGNORECASE,
)


def keyword_router(question: str) -> dict:
    """Zero-LLM routing. Returns {"target": None} when nothing clearly matches."""
    text = (question or "").lower()
    period = "prior" if _PRIOR.search(text) else "current"
    for pattern, target, kind in _KEYWORDS:
        if re.search(pattern, text):
            return {"target": target, "kind": kind, "period": period}
    return {"target": None}


def _not_found(message: str = NOT_FOUND_MESSAGE) -> dict:
    return {"not_found": True, "message": message}


def _fmt_value(target: str, value: float, unit: str | None, currency: str | None) -> str:
    if target in PERCENT_RATIOS:
        return f"{value:.2%}"
    if target in RATIO_KEYS:
        return f"{value:.2f}x"
    scale = f" {currency} {unit}" if currency and unit else ""
    return f"{value:,.0f}{scale}"


def resolve_query(
    question: str,
    line_items: list[dict],
    ratios: dict,
    router=None,
    prior_line_items: list[dict] | None = None,
    prior_ratios: dict | None = None,
    context: dict | None = None,
) -> dict:
    """Answer a question by retrieval only.

    `router` is a callable(question) -> {"target", "kind", "period"} - Backend
    passes the LLM-backed one. Without it the deterministic keyword router runs,
    which is what keeps the query bar alive if the provider falls over.

    -> {answer, value, source: {page, bbox}, trust, inputs}
    -> {not_found: true, message: "Not present in these documents."}
    """
    context = context or {}
    route = (router or keyword_router)(question) or {}
    target = route.get("target")

    if not target:
        return _not_found()

    want_prior = route.get("period") == "prior"
    items = (prior_line_items if want_prior else line_items) or []
    pack = (prior_ratios if want_prior else ratios) or {}
    period_label = (
        context.get("prior_period") if want_prior else context.get("period")
    ) or ("prior period" if want_prior else "the period")

    if want_prior and not items and not pack:
        return _not_found("No comparative period was extracted from these documents.")

    by_key = {i.get("canonical_key"): i for i in items if isinstance(i, dict)}
    unit, currency = context.get("unit"), context.get("currency")

    # ---- ratio target ----------------------------------------------------
    if target in RATIO_KEYS:
        value = pack.get(target)
        if not isinstance(value, (int, float)):
            return _not_found(
                f"{RATIO_LABELS[target]} could not be computed from verified "
                f"figures in these documents."
            )
        inputs = []
        trusts = set()
        for key in RATIO_INPUTS.get(target, ()):
            item = by_key.get(key)
            if item:
                inputs.append({
                    "canonical_key": key,
                    "label": item.get("label_as_printed") or CANONICAL_LABELS.get(key),
                    "value": item.get("value"),
                    "page": item.get("page"),
                    "bbox": item.get("bbox"),
                })
                trusts.add(item.get("trust", "UNVERIFIED"))
        trust = (
            "UNVERIFIED" if "UNVERIFIED" in trusts or not trusts
            else "DERIVED" if "DERIVED" in trusts
            else "VERIFIED"
        )
        return {
            "answer": (
                f"{RATIO_LABELS[target]} for {period_label} is "
                f"{_fmt_value(target, value, unit, currency)}."
            ),
            "value": value,
            # A ratio is not printed anywhere, so it has no single source cell.
            # `inputs` carries the cells it was computed from instead.
            "source": None,
            "trust": trust,
            "inputs": inputs,
        }

    # ---- line item target ------------------------------------------------
    if target not in CANONICAL_KEY_SET:
        return _not_found()

    item = by_key.get(target)
    if item is None or not isinstance(item.get("value"), (int, float)):
        return _not_found(
            f"{CANONICAL_LABELS.get(target, target)} was not found in these documents."
        )

    label = item.get("label_as_printed") or CANONICAL_LABELS.get(target, target)
    return {
        "answer": (
            f"{label} for {period_label} is "
            f"{_fmt_value(target, item['value'], unit, currency)}."
        ),
        "value": item["value"],
        "source": {"page": item.get("page"), "bbox": item.get("bbox")},
        "trust": item.get("trust", "UNVERIFIED"),
        "inputs": [],
    }
