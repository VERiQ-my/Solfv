"""
The LLM boundary, owned by the Data lane so the rules live next to the schema
they must satisfy.

Backend imports from here. Do not retype these prompts into extract.py.

Provider note (matters for extract.py):
  DeepSeek vision is `deepseek-v4-flash-vision-exp` only - deepseek-chat and
  plain V4 are text-only and 400 on image input. That model has NO documented
  JSON output mode, so strict JSON is prompt-enforced plus parse_llm_json()
  plus the single retry, not response_format. Images are accepted in USER
  messages only. Each image is squeezed to an upper bound of ~384 tokens
  regardless of its pixel size, so send a CROP of the statement table rather
  than a whole A4 page - the token cost is identical and the effective
  resolution on small figures is several times better. Up to 600 images per
  request, so tiling a dense page is free.
"""

from __future__ import annotations

import json
import re
from typing import Any

from .schema import (
    CANONICAL_KEY_SET,
    CANONICAL_KEYS,
    DIRECTIONS,
    VALID_CLAIM_METRICS,
)

_KEY_LIST = "\n".join(f"  {k}" for k in CANONICAL_KEYS)


# --------------------------------------------------------------------------
# Prompt 1 - line item extraction from financial statement page images
# --------------------------------------------------------------------------

EXTRACTION_PROMPT = f"""You are reading page images from a Malaysian annual report's audited financial statements. Transcribe figures. You are not analysing anything.

Return ONLY these canonical keys. Anything not on this list is not reported:
{_KEY_LIST}

Rules, in order of importance:

1. TRANSCRIBE, NEVER COMPUTE. Report a figure only if it is printed on the page. If a subtotal is not printed, omit the key entirely. Do not add columns together. Do not infer. An omitted key is correct; an invented one is a failure.
2. Copy the number exactly as printed, then normalise the formatting only:
   - strip thousands separators: "1,234,567" -> 1234567
   - parentheses mean negative: "(6,800)" -> -6800
   - a dash, "-", "nil" or a blank cell means the line is absent -> omit the key
   - do NOT rescale. If the column header says RM'000, leave the number as printed and report "unit": "thousands".
3. Report the CURRENT financial year in "line_items" and the immediately preceding comparative year in "prior_period.line_items". Statements print them side by side; the current year is almost always the left-hand numeric column. If there is no comparative column, omit "prior_period".
4. "page" is the page number I gave you with the image, not the number printed on the paper.
5. "label_as_printed" is the row caption copied verbatim from the document, in its original wording.
6. Set "bbox" to null and "trust" to "UNVERIFIED" on every item. Both are filled in downstream. Never guess coordinates.
7. If a key appears more than once across the pages, report the consolidated Group figure, not the Company-only figure.

Sign conventions:
  - cogs, opex, interest_expense, dividends: report as POSITIVE magnitudes even where the statement prints them in parentheses.
  - pat and ebit: keep the true sign. A loss is negative.

Output format - a single JSON object, nothing else. No markdown fences, no commentary, no explanation before or after:

{{
  "entity": "<registered name as printed>",
  "period": "<e.g. FY2024>",
  "currency": "<e.g. MYR>",
  "unit": "<one of: units | thousands | millions>",
  "ticker": "<Bursa code with .KL suffix, or null>",
  "line_items": [
    {{"canonical_key": "total_assets", "label_as_printed": "TOTAL ASSETS", "value": 1429800, "page": 96, "bbox": null, "trust": "UNVERIFIED"}}
  ],
  "prior_period": {{
    "period": "<e.g. FY2023>",
    "line_items": [ ...same shape... ]
  }}
}}
"""


# --------------------------------------------------------------------------
# Prompt 2 - narrative claims from the MD&A / chairman's statement
# --------------------------------------------------------------------------

_METRIC_LIST = "\n".join(f"  {m}" for m in sorted(VALID_CLAIM_METRICS))

NARRATIVE_PROMPT = f"""You are reading the management commentary of a Malaysian annual report - the chairman's statement, MD&A or operating review. Find sentences where management asserts something about financial performance that a number could later prove or disprove.

For each such sentence, map it to exactly one metric and one direction.

Valid metrics:
{_METRIC_LIST}

Valid directions:
  strong      - asserts the metric is at a healthy absolute level
  weak        - asserts the metric is at a poor absolute level
  improving   - asserts the metric moved favourably versus last year
  declining   - asserts the metric moved unfavourably versus last year
  stable      - asserts the metric was held roughly flat

Rules:

1. Copy "sentence" VERBATIM from the document, including punctuation. It is quoted back to the user next to the contradicting number, so a paraphrase is a fabrication.
2. If a sentence does not map cleanly onto one of the metrics above, skip it. Do not stretch. A short accurate list beats a long speculative one.
3. Skip forward-looking statements ("we expect", "we aim to", "in the coming year"). We test what management claimed HAPPENED, not what they hope will happen.
4. Skip anything already stated as a bare number ("revenue rose 4%"). We are looking for the qualitative claim, which is where the gap between narrative and arithmetic lives.
5. Return at most 8 claims, the most substantive first.
6. "page" is the page number I gave you with the image.

Guide to mapping the usual phrasings:
  "strong liquidity", "healthy cash position", "ample headroom"  -> current_ratio
  "deleveraging", "strengthened balance sheet", "reduced gearing" -> gearing
  "comfortably covered finance costs"                            -> interest_cover
  "margins held up", "pricing discipline"                        -> gross_margin
  "cost discipline", "improved profitability", "bottom line"     -> net_margin
  "returns to shareholders", "return on equity"                  -> roe
  "share price performance", "shareholder value"                 -> share_price_1y

Output format - a single JSON object, nothing else. No markdown fences, no commentary:

{{
  "narrative_claims": [
    {{"sentence": "The Group maintained a strong liquidity position throughout the financial year.", "page": 26, "metric": "current_ratio", "direction": "strong"}}
  ]
}}
"""


# --------------------------------------------------------------------------
# Prompt 3 - query router (4.6). Maps a question to a key. Never to a number.
# --------------------------------------------------------------------------

QUERY_ROUTER_PROMPT = f"""Map the user's question to ONE lookup target. You do not answer the question and you never state a figure - a later step does a dictionary lookup. Emitting a number here would defeat the entire design.

Valid line_item targets:
{_KEY_LIST}

Valid ratio targets:
{_METRIC_LIST}

Rules:
1. Pick the single closest target. If nothing is a clear match, return {{"target": null}}. Returning null is a correct and expected answer - the system tells the user the documents do not contain it, which is better than a confident wrong lookup.
2. "period" is "current" unless the question clearly asks about last year, in which case "prior".
3. Never invent a target that is not on the lists above.

Output format - a single JSON object, nothing else:

{{"target": "gearing", "kind": "ratio", "period": "current"}}
or
{{"target": "cash", "kind": "line_item", "period": "prior"}}
or
{{"target": null}}
"""


# --------------------------------------------------------------------------
# Parsing and validation - the gate between the LLM and the pipeline
# --------------------------------------------------------------------------

_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.MULTILINE)


def parse_llm_json(raw: str) -> dict:
    """Best-effort strict-JSON recovery from a model that has no JSON mode.

    Raises ValueError, which is Backend's cue to burn its one retry.
    """
    if not raw or not raw.strip():
        raise ValueError("empty response")

    text = _FENCE.sub("", raw).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Fall back to the outermost brace pair, which survives a stray preamble.
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("no JSON object found in response")
    try:
        return json.loads(text[start:end + 1])
    except json.JSONDecodeError as exc:
        raise ValueError(f"malformed JSON: {exc}") from exc


_PAREN = re.compile(r"^\((.*)\)$")


def _coerce_number(value: Any) -> float | None:
    """Accept the shapes a model actually emits. Reject everything else."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if not isinstance(value, str):
        return None

    text = value.strip().replace(",", "").replace("RM", "").strip()
    negative = False
    match = _PAREN.match(text)
    if match:
        negative, text = True, match.group(1).strip()
    if text.startswith("-"):
        negative, text = True, text[1:]
    if not text or not re.fullmatch(r"\d+(\.\d+)?", text):
        return None
    number = float(text)
    return -number if negative else number


def validate_extraction(doc: dict) -> tuple[dict, list[str]]:
    """Scrub an LLM extraction into something the pipeline can trust.

    Drops rather than repairs: an unrecognised key, a non-numeric value or a
    claim pointing at a metric we cannot compute is discarded and recorded in
    the warning list. Nothing here invents a value.

    Returns (clean_doc, warnings). Backend should log the warnings and keep
    going - a partial extraction is still a useful dashboard, and every gap
    shows up as a missing ratio rather than a wrong one.
    """
    warnings: list[str] = []
    doc = dict(doc or {})

    def clean_items(items: Any, where: str) -> list[dict]:
        out: list[dict] = []
        seen: set[str] = set()
        for raw in items or []:
            if not isinstance(raw, dict):
                warnings.append(f"{where}: dropped a non-object line item")
                continue
            key = raw.get("canonical_key")
            if key not in CANONICAL_KEY_SET:
                warnings.append(f"{where}: dropped unknown canonical_key {key!r}")
                continue
            if key in seen:
                warnings.append(f"{where}: dropped duplicate {key!r}, kept the first")
                continue
            value = _coerce_number(raw.get("value"))
            if value is None:
                warnings.append(f"{where}: dropped {key!r}, value {raw.get('value')!r} is not a number")
                continue
            page = raw.get("page")
            seen.add(key)
            out.append({
                "canonical_key": key,
                "label_as_printed": raw.get("label_as_printed"),
                "value": value,
                "page": page if isinstance(page, int) else None,
                "bbox": raw.get("bbox") if isinstance(raw.get("bbox"), list) else None,
                # Contract 2.2: Backend always writes UNVERIFIED. Only the
                # reconciliation engine is allowed to promote a figure.
                "trust": "UNVERIFIED",
            })
        return out

    doc["line_items"] = clean_items(doc.get("line_items"), "line_items")

    prior = doc.get("prior_period")
    if isinstance(prior, dict):
        prior = dict(prior)
        prior["line_items"] = clean_items(prior.get("line_items"), "prior_period")
        doc["prior_period"] = prior if prior["line_items"] else None
    else:
        doc["prior_period"] = None

    claims: list[dict] = []
    for raw in doc.get("narrative_claims") or []:
        if not isinstance(raw, dict):
            continue
        sentence = raw.get("sentence")
        metric = raw.get("metric")
        direction = raw.get("direction")
        if not isinstance(sentence, str) or not sentence.strip():
            warnings.append("narrative_claims: dropped a claim with no sentence")
            continue
        if metric not in VALID_CLAIM_METRICS:
            warnings.append(f"narrative_claims: dropped claim on unknown metric {metric!r}")
            continue
        if direction not in DIRECTIONS:
            warnings.append(f"narrative_claims: dropped claim with bad direction {direction!r}")
            continue
        page = raw.get("page")
        claims.append({
            "sentence": sentence.strip(),
            "page": page if isinstance(page, int) else None,
            "metric": metric,
            "direction": direction,
        })
    doc["narrative_claims"] = claims

    if not doc["line_items"]:
        warnings.append("no usable line items survived validation")

    return doc, warnings
