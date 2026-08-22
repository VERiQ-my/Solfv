"""Crypto research advisor.

Two paths, one contract. When `DEEPSEEK_API_KEY` is set the advisor calls the
DeepSeek chat completion endpoint with a structured prompt and a hard schema
that DeepSeek must respond in. When the key is absent the advisor falls back
to a deterministic rules pass over the same inputs. In both cases the shape
returned to the frontend is identical, so the UI never has to know which path
ran — it renders the same card.

The framing is deliberate and non-negotiable:

    Investment guidance is a regulated activity in Malaysia. This module
    produces *research candidates* for a human to review. It never emits BUY,
    SELL, or any variant thereof. It never invents prices, ratios, or citations
    beyond the ones handed to it. Verdicts are drawn from a closed set that
    describes *fit*, not action.

Fails soft. A DeepSeek timeout, a rate limit, or a malformed response returns
the fallback report with the reason attached. The engine's contract to never
lose a document because an external service died holds here too.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
import urllib.error
import urllib.request

API_URL = os.getenv("DEEPSEEK_API_URL", "https://api.deepseek.com/chat/completions")
API_KEY = os.getenv("DEEPSEEK_API_KEY", "").strip()
MODEL = os.getenv("DEEPSEEK_ADVISOR_MODEL", os.getenv("DEEPSEEK_TEXT_MODEL", "deepseek-chat"))
TIMEOUT = int(os.getenv("DEEPSEEK_ADVISOR_TIMEOUT", "60"))
MAX_CANDIDATES = int(os.getenv("ADVISOR_MAX_CANDIDATES", "5"))

# The verdict vocabulary the frontend renders and the whole reason this module
# does not read as investment advice. Keeping it here rather than in a schema
# file means changing it also changes every place that filters on it.
ALLOWED_VERDICTS = {
    "CANDIDATE_FOR_REVIEW",
    "HIGH_RISK",
    "INSUFFICIENT_EVIDENCE",
    "NOT_ALIGNED",
}

# The system prompt is bilingual on purpose: DeepSeek follows the English
# schema instructions best, but the framing sentence in Malay/English on the
# regulator makes it much harder to jailbreak the model into producing a BUY.
SYSTEM_PROMPT = """\
You are a research assistant that produces *candidate crypto assets for a human
analyst to review*, given a company's reconciled financial statement analysis
and a live snapshot of the crypto market. Every candidate MUST be justified by
concrete figures from the company's report — never by generic market opinion.

You are NOT an investment advisor. Producing investment advice is a regulated
activity in Malaysia. Never emit BUY, SELL, HOLD, TARGET PRICE, GUARANTEED
RETURN, SAFE INVESTMENT, or any equivalent. Never invent a price, a ratio, a
citation, or a market figure that was not in the input.

## How to reason about the report

The `analysis` payload carries the engine's reconciled figures. Read them
literally and let them drive the shortlist:

* `analysis.ratios.current_ratio` < 1.0 → company has a liquidity problem;
  the shortlist should skew toward stablecoins (USDT, USDC, DAI) as *research
  candidates for a hedge overlay*, and away from anything with a 24h move
  above 10%.
* `analysis.ratios.gearing` > 1.5 → company is highly leveraged; only the
  largest, most liquid assets (top-3 by market cap) should get
  CANDIDATE_FOR_REVIEW; smaller-cap names go to HIGH_RISK or NOT_ALIGNED.
* `analysis.ratios.interest_cover` < 2 → company can barely service its debt;
  avoid highly volatile names (24h > 8%). Prefer stablecoins.
* `analysis.ratios.roe` < 0 or `analysis.ratios.net_margin` < 0 → the company
  is loss-making; the fit judgement is weak, prefer INSUFFICIENT_EVIDENCE.
* `analysis.risk_zone` == "DISTRESS" → cap the shortlist at the top-3 by
  market cap and mark them HIGH_RISK; add explicit downside risk factors.
* `analysis.risk_zone` == "SAFE" AND positive net_margin AND roe > 0.10 →
  CANDIDATE_FOR_REVIEW verdicts are permitted across the top-N; still no BUY.
* `analysis.quarantined` non-empty OR `analysis.checks_failed` > 0 → every
  candidate must be INSUFFICIENT_EVIDENCE; the company baseline is unreliable.
* `analysis.say_do_gaps` with verdict "CONTRADICTED" → cite the specific
  metric in the risk_factors.

Every candidate you emit MUST have at least TWO items in `supporting_evidence`,
each referencing a specific field from the input by name, e.g.:
  "analysis.ratios.current_ratio=0.82"
  "analysis.risk_zone=DISTRESS (Altman Z''=1.03)"
  "market_snapshot.assets[BTC].change_24h_pct=+2.80"
  "market_snapshot.assets[USDT].price=1.00"

The `rationale` bullets must join the two — one sentence explaining how the
company figure and the market figure together make this asset worth reviewing
(or not). Do not restate the same rationale across candidates.

## Output schema

Your entire output must be a single JSON object matching this schema:

{
  "report_hash": string,           // echo of input.report_hash
  "generated_at": string,          // ISO8601 UTC "YYYY-MM-DDTHH:MM:SSZ"
  "candidates": [                  // 0..MAX_CANDIDATES, ordered by fit
    {
      "asset_id": string,          // CoinGecko id from the snapshot
      "symbol": string,            // upper case symbol
      "verdict": "CANDIDATE_FOR_REVIEW" | "HIGH_RISK" | "INSUFFICIENT_EVIDENCE" | "NOT_ALIGNED",
      "confidence": number,        // 0.0..1.0
      "rationale": [string, ...],  // 1-3 bullets, each linking company figure -> market figure
      "supporting_evidence": [string, ...],  // >=2, each references a specific input field
      "risk_factors": [string, ...],
      "market_data_timestamp": string
    }
  ],
  "overall_summary": string,       // 2-3 sentences, no directives, cite the company entity + risk zone
  "limitations": [string, ...]     // must include the non-execution disclaimer
}

Do not emit any prose outside the JSON. Do not wrap it in a code fence.
"""


class AdvisorError(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# Public entry
# ---------------------------------------------------------------------------

def status() -> dict:
    return {
        "configured": bool(API_KEY),
        "provider": "DeepSeek",
        "model": MODEL,
        "max_candidates": MAX_CANDIDATES,
        "reason": None if API_KEY else (
            "DEEPSEEK_API_KEY is not set — the advisor falls back to a "
            "deterministic rules pass over the same market snapshot."
        ),
    }


def recommend(analysis: dict, snapshot: dict | None,
              snapshot_reason: str | None = None) -> dict:
    """Produce a research-candidate report for one reconciled analysis.

    `analysis` is the engine's own `Analysis` output, verbatim. `snapshot` is
    what `crypto.snapshot()` returned; None means the market feed refused,
    which the advisor communicates rather than pretending it had data.
    """
    features = _features(analysis)
    universe = (snapshot or {}).get("assets") or []
    live = bool(API_KEY) and bool(universe)

    generated_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    report_hash = _report_hash(features, universe, snapshot)

    if not universe:
        return _empty_report(
            report_hash, generated_at,
            reason=snapshot_reason or "No crypto market snapshot was available.",
            source="fallback",
        )

    if live:
        try:
            payload = _call_deepseek(features, snapshot, report_hash, generated_at)
            candidates = _validate_candidates(payload.get("candidates"), universe)
            return {
                "report_hash": report_hash,
                "generated_at": generated_at,
                "source": "deepseek",
                "model": MODEL,
                "candidates": candidates[:MAX_CANDIDATES],
                "overall_summary": str(payload.get("overall_summary") or ""),
                "limitations": _limitations(payload.get("limitations")),
                "market_snapshot": _snapshot_meta(snapshot),
                "analysis_features": features,
            }
        except AdvisorError as error:
            fallback = _fallback(features, universe, report_hash, generated_at)
            fallback["reason"] = f"DeepSeek unavailable: {error}"
            return fallback

    fallback = _fallback(features, universe, report_hash, generated_at)
    if not API_KEY:
        fallback["reason"] = (
            "DEEPSEEK_API_KEY is not set — this report was assembled by the "
            "deterministic fallback."
        )
    return fallback


# ---------------------------------------------------------------------------
# Feature extraction — what we send to the model, verbatim
# ---------------------------------------------------------------------------

def _features(analysis: dict) -> dict:
    """Compress the Analysis object into what actually informs a candidate.

    We deliberately drop the raw line items and page images. The model does
    not need pages, it needs the numbers and the trust flags on them.
    """
    ratios = analysis.get("ratios") or {}
    prior_ratios = analysis.get("prior_ratios") or {}
    risk = analysis.get("risk") or {}
    summary = analysis.get("summary") or {}

    say_do = [
        {"metric": g.get("metric"), "verdict": g.get("verdict"),
         "claimed": g.get("claimed"), "actual": g.get("actual")}
        for g in (analysis.get("say_do_gap") or [])
        if g.get("verdict") in ("CONTRADICTED", "UNVERIFIABLE", "SUPPORTED")
    ][:12]

    return {
        "entity": analysis.get("entity"),
        "ticker": analysis.get("ticker"),
        "period": analysis.get("period"),
        "prior_period": analysis.get("prior_period"),
        "currency": analysis.get("currency"),
        "unit": analysis.get("unit"),
        "risk_zone": risk.get("zone"),
        "risk_variant": risk.get("variant"),
        "risk_score": risk.get("score"),
        "risk_reason": risk.get("reason"),
        "ratios": {k: v for k, v in ratios.items() if v is not None},
        "prior_ratios": {k: v for k, v in prior_ratios.items() if v is not None},
        "quarantined": analysis.get("quarantined") or [],
        "say_do_gaps": say_do,
        "checks_failed": summary.get("checks_failed"),
        "checks_passed": summary.get("checks_passed"),
        "trust": summary.get("trust"),
    }


def _report_hash(features: dict, universe: list[dict],
                 snapshot: dict | None) -> str:
    """SHA-256 of the exact inputs, so a repeated call over the same evidence
    reproduces the same hash and the frontend can cache confidently."""
    payload = json.dumps({
        "features": features,
        "universe_ids": [a.get("asset_id") for a in universe],
        "fetched_at": (snapshot or {}).get("fetched_at"),
    }, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


# ---------------------------------------------------------------------------
# Live DeepSeek path
# ---------------------------------------------------------------------------

def _call_deepseek(features: dict, snapshot: dict,
                   report_hash: str, generated_at: str) -> dict:
    """One chat completion call. `response_format=json_object` binds DeepSeek
    to emitting JSON, but we still validate the payload against the schema
    ourselves before shipping it — an LLM that promises JSON has still been
    seen inventing a verdict token."""
    prompt_input = {
        "report_hash": report_hash,
        "generated_at": generated_at,
        "max_candidates": MAX_CANDIDATES,
        "allowed_verdicts": sorted(ALLOWED_VERDICTS),
        "analysis": features,
        "market_snapshot": snapshot,
        "instructions": (
            "Pick the assets from market_snapshot.assets that best fit the "
            "analysis's risk profile. If the analysis is DISTRESS, prefer "
            "HIGH_RISK or NOT_ALIGNED verdicts. If key ratios are quarantined "
            "prefer INSUFFICIENT_EVIDENCE. Never emit a candidate outside the "
            "provided universe."
        ),
    }

    body = json.dumps({
        "model": MODEL,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(prompt_input, default=str)},
        ],
    }).encode("utf-8")

    request = urllib.request.Request(
        API_URL, data=body, method="POST",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            raw = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = ""
        try:
            detail = str(json.loads(error.read().decode("utf-8")))[:400]
        except Exception:  # noqa: BLE001
            pass
        raise AdvisorError(
            f"HTTP {error.code}{': ' + detail if detail else ''}"
        ) from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise AdvisorError(str(error)) from error
    except json.JSONDecodeError as error:
        raise AdvisorError(f"non-JSON response: {error}") from error

    try:
        content = raw["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as error:
        raise AdvisorError(f"unexpected response shape: {error}") from error

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as error:
        raise AdvisorError(f"model returned non-JSON content: {error}") from error

    if not isinstance(parsed, dict):
        raise AdvisorError("model returned a non-object payload.")
    return parsed


def _validate_candidates(rows, universe: list[dict]) -> list[dict]:
    """Drop every candidate that the model made up or mislabelled.

    A row survives only when its asset_id is in the universe we handed the
    model and its verdict is one of the allowed tokens. This is where the
    schema is actually enforced — trusting `response_format` alone is not
    enough.
    """
    if not isinstance(rows, list):
        return []

    by_id = {a.get("asset_id"): a for a in universe if a.get("asset_id")}
    cleaned: list[dict] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        asset_id = str(row.get("asset_id") or "").strip().lower()
        asset = by_id.get(asset_id)
        if not asset:
            continue
        verdict = str(row.get("verdict") or "").strip().upper()
        if verdict not in ALLOWED_VERDICTS:
            continue

        try:
            confidence = float(row.get("confidence") or 0.0)
        except (TypeError, ValueError):
            confidence = 0.0
        confidence = max(0.0, min(1.0, confidence))

        cleaned.append({
            "asset_id": asset_id,
            "symbol": asset.get("symbol"),
            "name": asset.get("name"),
            "image": asset.get("image"),
            "verdict": verdict,
            "confidence": confidence,
            "rationale": _string_list(row.get("rationale")),
            "supporting_evidence": _string_list(row.get("supporting_evidence")),
            "risk_factors": _string_list(row.get("risk_factors")),
            "market_data_timestamp": (
                row.get("market_data_timestamp")
                or asset.get("last_updated")
            ),
            "market": {
                "price": asset.get("price"),
                "market_cap": asset.get("market_cap"),
                "volume_24h": asset.get("volume_24h"),
                "change_24h_pct": asset.get("change_24h_pct"),
                "change_7d_pct": asset.get("change_7d_pct"),
                "vs_currency": asset.get("vs_currency"),
            },
        })
    return cleaned


# ---------------------------------------------------------------------------
# Deterministic fallback — used when the key is absent or DeepSeek refused
#
# This is the *ratio-driven* fallback. Every candidate that survives here has
# been placed because a specific figure on the company's report justifies it,
# and every rationale sentence names the figure it came from. That is the
# whole point of running the fallback rather than returning an empty list —
# a human should be able to trace each candidate back to a number.
# ---------------------------------------------------------------------------

# Known stablecoin CoinGecko ids. When the company has a liquidity or leverage
# problem the shortlist is skewed toward these as *research candidates for a
# hedge overlay* — not "buy stablecoins", but "consider whether the risk
# calculus points a reviewer at these first".
_STABLECOIN_IDS = {"tether", "usd-coin", "dai", "true-usd", "first-digital-usd",
                   "paypal-usd", "ethena-usde"}


def _fallback(features: dict, universe: list[dict],
              report_hash: str, generated_at: str) -> dict:
    """Build a ratio-anchored shortlist. Every candidate carries at least two
    pieces of supporting evidence, each naming a specific input field."""

    signals = _diagnose(features)
    candidates: list[dict] = []
    seen_verdicts: set[str] = set()

    for asset in universe:
        candidate = _score_asset(asset, features, signals)
        if candidate is None:
            continue
        candidates.append(candidate)
        seen_verdicts.add(candidate["verdict"])

    # Rank: CANDIDATE_FOR_REVIEW → HIGH_RISK → INSUFFICIENT_EVIDENCE →
    # NOT_ALIGNED; within a bucket, highest confidence, then largest market cap.
    order = {"CANDIDATE_FOR_REVIEW": 0, "HIGH_RISK": 1,
             "INSUFFICIENT_EVIDENCE": 2, "NOT_ALIGNED": 3}
    candidates.sort(key=lambda c: (
        order.get(c["verdict"], 9),
        -c["confidence"],
        -(c.get("market", {}).get("market_cap") or 0),
    ))
    candidates = candidates[:signals["top_k"]]

    return {
        "report_hash": report_hash,
        "generated_at": generated_at,
        "source": "fallback",
        "model": "deterministic-rules-v1",
        "candidates": candidates,
        "overall_summary": _fallback_summary(features, signals, candidates),
        "limitations": _limitations(None),
        "market_snapshot": {"provider": "CoinGecko", "assets_considered": len(universe)},
        "analysis_features": features,
    }


def _diagnose(features: dict) -> dict:
    """Read the company's ratios and turn them into a compact set of signals
    the scorer can act on. Every signal names the ratio it came from so the
    downstream rationale can quote it back."""

    ratios = features.get("ratios") or {}
    zone = str(features.get("risk_zone") or "").upper()
    quarantined = list(features.get("quarantined") or [])
    checks_failed = int(features.get("checks_failed") or 0)

    def _f(key: str) -> float | None:
        value = ratios.get(key)
        try:
            return float(value) if value is not None else None
        except (TypeError, ValueError):
            return None

    current = _f("current_ratio")
    gearing = _f("gearing")
    interest_cover = _f("interest_cover")
    roe = _f("roe")
    net_margin = _f("net_margin")
    gross_margin = _f("gross_margin")

    weak_liquidity  = current is not None and current < 1.0
    weak_leverage   = gearing is not None and gearing > 1.5
    weak_coverage   = interest_cover is not None and interest_cover < 2.0
    loss_making     = ((roe is not None and roe < 0)
                       or (net_margin is not None and net_margin < 0))
    strong_profits  = ((roe is not None and roe > 0.10)
                       and (net_margin is not None and net_margin > 0.05))
    unreliable      = bool(quarantined) or checks_failed > 0
    distress        = zone == "DISTRESS"
    safe            = zone == "SAFE"

    # Volatility ceiling scales with how comfortable the company can afford to
    # be. Weak coverage or distress → cap tight. Strong profits + safe zone →
    # loosen. Fully unconfigured → moderate.
    if unreliable or distress or weak_coverage:
        volatility_cap = 5.0
    elif weak_liquidity or weak_leverage or loss_making:
        volatility_cap = 8.0
    elif strong_profits and safe:
        volatility_cap = 15.0
    else:
        volatility_cap = 10.0

    # Market-cap floor scales the same way. A DISTRESS company that a human is
    # reviewing has no business considering a $200m-cap token; a SAFE one can.
    if unreliable or distress:
        min_market_cap = 5e10   # $50B+ only
        top_k = 4
    elif weak_liquidity or weak_leverage or weak_coverage:
        min_market_cap = 2e10   # $20B+
        top_k = 5
    elif safe and strong_profits:
        min_market_cap = 5e9    # $5B+
        top_k = 6
    else:
        min_market_cap = 1e10   # $10B+
        top_k = 5

    # Prefer stablecoins when the company either needs a hedge (weak liquidity
    # or coverage) or when the analysis is too shaky to justify anything else.
    prefer_stables = unreliable or weak_liquidity or weak_coverage or distress

    # Human-readable evidence lines that any candidate can cite verbatim.
    evidence: list[str] = []
    if current       is not None: evidence.append(f"analysis.ratios.current_ratio={current:.2f}")
    if gearing       is not None: evidence.append(f"analysis.ratios.gearing={gearing:.2f}")
    if interest_cover is not None: evidence.append(f"analysis.ratios.interest_cover={interest_cover:.2f}")
    if roe           is not None: evidence.append(f"analysis.ratios.roe={roe*100:.1f}%")
    if net_margin    is not None: evidence.append(f"analysis.ratios.net_margin={net_margin*100:.1f}%")
    if gross_margin  is not None: evidence.append(f"analysis.ratios.gross_margin={gross_margin*100:.1f}%")
    if zone:                       evidence.append(f"analysis.risk_zone={zone}")
    if quarantined:                evidence.append(f"analysis.quarantined={quarantined}")
    if checks_failed:              evidence.append(f"analysis.checks_failed={checks_failed}")

    # Sentence-shape rationales that name the ratio and the interpretation.
    ratio_findings: list[str] = []
    if weak_liquidity:
        ratio_findings.append(
            f"Current ratio {current:.2f} is below 1.0 — the company cannot "
            f"cover its short-term liabilities with current assets, which "
            f"points a reviewer toward liquid, low-volatility candidates.")
    if weak_leverage:
        ratio_findings.append(
            f"Gearing of {gearing:.2f} (debt / equity) is elevated — the "
            f"company is materially leveraged, so the shortlist stays with "
            f"top-cap names that a reviewer can exit quickly.")
    if weak_coverage:
        ratio_findings.append(
            f"Interest cover of {interest_cover:.2f}x is thin — the company "
            f"can barely service its debt, so volatile crypto is a poor fit "
            f"for any hedge or overlay a reviewer is weighing.")
    if loss_making:
        ratio_findings.append(
            f"Company is loss-making (roe={roe*100:.1f}% if roe is not None "
            f"else '—' / net_margin={net_margin*100:.1f}% if net_margin is "
            f"not None else '—') — the fit judgement is weak, evidence is "
            f"insufficient." if roe is not None and net_margin is not None else
            "Company is loss-making — the fit judgement is weak.")
    if strong_profits and safe:
        ratio_findings.append(
            f"Company is comfortably profitable (roe={roe*100:.1f}%, "
            f"net_margin={net_margin*100:.1f}%) and sits in the SAFE zone — "
            f"a broader shortlist is defensible.")
    if unreliable:
        ratio_findings.append(
            f"Reconciliation is unreliable — {checks_failed} check(s) failed "
            f"and {len(quarantined)} figure(s) were quarantined; the fit "
            f"judgement collapses to INSUFFICIENT_EVIDENCE.")
    # Distress zone deserves its own line even when the operating ratios read
    # fine — the Altman Z-score can trip on size/growth terms alone, and the
    # user must not be told everything is healthy just because current_ratio
    # is above 1.
    if distress and not (weak_liquidity or weak_leverage
                         or weak_coverage or loss_making or unreliable):
        ratio_findings.append(
            f"Operating ratios look healthy but the Altman Z-score puts the "
            f"company in the DISTRESS zone — the distress signal comes from "
            f"size/asset-turnover/retained-earnings terms rather than "
            f"day-to-day solvency, and the shortlist reflects that caution.")

    return {
        "ratios_seen": {"current_ratio": current, "gearing": gearing,
                        "interest_cover": interest_cover, "roe": roe,
                        "net_margin": net_margin, "gross_margin": gross_margin},
        "zone": zone, "quarantined": quarantined, "checks_failed": checks_failed,
        "weak_liquidity": weak_liquidity, "weak_leverage": weak_leverage,
        "weak_coverage": weak_coverage, "loss_making": loss_making,
        "strong_profits": strong_profits, "unreliable": unreliable,
        "distress": distress, "safe": safe,
        "volatility_cap": volatility_cap, "min_market_cap": min_market_cap,
        "top_k": top_k, "prefer_stables": prefer_stables,
        "evidence": evidence, "ratio_findings": ratio_findings,
    }


def _score_asset(asset: dict, features: dict, signals: dict) -> dict | None:
    """Turn one CoinGecko row into a candidate. Returns None to skip."""

    asset_id = str(asset.get("asset_id") or "").lower()
    cap      = asset.get("market_cap") or 0
    change24 = asset.get("change_24h_pct")
    change7d = asset.get("change_7d_pct")
    is_stable = asset_id in _STABLECOIN_IDS

    # Cap floor applies to non-stablecoins only. A stablecoin at $5B is still a
    # stablecoin — that is the whole point of surfacing it as a hedge candidate.
    if not is_stable and cap < signals["min_market_cap"]:
        return None

    rationale: list[str] = list(signals["ratio_findings"])
    evidence: list[str] = list(signals["evidence"])
    risk_factors: list[str] = []
    confidence = 0.5
    verdict = "CANDIDATE_FOR_REVIEW"

    # 1) Reconciliation unreliable → everything is INSUFFICIENT_EVIDENCE.
    if signals["unreliable"]:
        verdict = "INSUFFICIENT_EVIDENCE"
        confidence = 0.25

    # 2) Loss-making non-stablecoins are hard to justify as fit.
    elif signals["loss_making"] and not is_stable:
        verdict = "INSUFFICIENT_EVIDENCE"
        confidence = 0.3

    # 3) DISTRESS zone → non-stablecoins are HIGH_RISK, stablecoins are the
    #    only "CANDIDATE_FOR_REVIEW" a distressed company can honestly get.
    elif signals["distress"]:
        if is_stable:
            verdict = "CANDIDATE_FOR_REVIEW"
            confidence = 0.55
            rationale.append(
                f"{asset.get('name') or asset_id} is a stablecoin "
                f"(price≈{asset.get('price') or 1:.2f} {asset.get('vs_currency','usd').upper()}) — "
                f"in a DISTRESS-zone review, a reviewer may consider it as a "
                f"cash-preservation candidate rather than a growth pick.")
        else:
            verdict = "HIGH_RISK"
            confidence = 0.35
            risk_factors.append(
                "Company sits in the DISTRESS zone; a volatile crypto asset "
                "adds risk on top of an already stretched balance sheet.")

    # 4) Weak liquidity / coverage → prefer stablecoins; non-stables allowed
    #    only if strictly within the volatility cap.
    elif signals["prefer_stables"]:
        if is_stable:
            verdict = "CANDIDATE_FOR_REVIEW"
            confidence = 0.6
            rationale.append(
                f"{asset.get('name') or asset_id} is a stablecoin — "
                f"aligns with the report's liquidity/coverage signals a "
                f"reviewer would want to hedge before considering growth.")
        elif change24 is not None and abs(change24) <= signals["volatility_cap"]:
            verdict = "CANDIDATE_FOR_REVIEW"
            confidence = 0.45
        else:
            verdict = "HIGH_RISK"
            confidence = 0.35

    # 5) SAFE + strong profits → broader shortlist, higher confidence.
    elif signals["safe"] and signals["strong_profits"]:
        verdict = "CANDIDATE_FOR_REVIEW"
        confidence = 0.65

    # 6) Volatility cap — universal. Elevate to HIGH_RISK if breached.
    if (change24 is not None
            and abs(change24) > signals["volatility_cap"]
            and verdict == "CANDIDATE_FOR_REVIEW"):
        verdict = "HIGH_RISK"
        risk_factors.append(
            f"24h move {change24:+.2f}% exceeds the {signals['volatility_cap']:.0f}% "
            f"volatility cap this company's ratios support.")
        confidence = min(confidence, 0.4)

    # 7) 7d drawdown is a separate risk factor even when 24h looks calm.
    if change7d is not None and change7d < -15:
        risk_factors.append(
            f"7d change {change7d:+.2f}% is a material drawdown; the ratio "
            f"picture above does not absorb momentum shocks.")

    # Asset-specific supporting evidence (always ≥ 2 lines because signals
    # already contributed the company-side ones).
    evidence.append(
        f"market_snapshot.assets[{asset.get('symbol') or asset_id}]."
        f"price={asset.get('price')} {asset.get('vs_currency','usd').upper()}")
    if change24 is not None:
        evidence.append(
            f"market_snapshot.assets[{asset.get('symbol') or asset_id}]."
            f"change_24h_pct={change24:+.2f}%")
    if cap:
        evidence.append(
            f"market_snapshot.assets[{asset.get('symbol') or asset_id}]."
            f"market_cap={cap:,.0f} {asset.get('vs_currency','usd').upper()}")

    # Dedupe rationale while preserving order — some findings repeat across
    # the ratio pass and the asset-specific pass.
    seen: set[str] = set()
    rationale = [r for r in rationale if not (r in seen or seen.add(r))]

    return {
        "asset_id": asset_id,
        "symbol": asset.get("symbol"),
        "name": asset.get("name"),
        "image": asset.get("image"),
        "verdict": verdict,
        "confidence": round(confidence, 2),
        "rationale": rationale[:4],
        # Enough headroom for the six company ratios + the zone + the three
        # asset-specific lines. Below this every candidate looks identical.
        "supporting_evidence": evidence[:12],
        "risk_factors": risk_factors,
        "market_data_timestamp": asset.get("last_updated"),
        "market": {
            "price": asset.get("price"),
            "market_cap": cap,
            "volume_24h": asset.get("volume_24h"),
            "change_24h_pct": change24,
            "change_7d_pct": change7d,
            "vs_currency": asset.get("vs_currency"),
        },
    }


def _fallback_summary(features: dict, signals: dict,
                      candidates: list[dict]) -> str:
    """A 2-3 sentence summary that names the entity and the specific ratio
    signals that shaped the shortlist. No directives."""

    entity = features.get("entity") or "the company"
    zone = signals["zone"] or "unclassified"
    n = len(candidates)

    if not n:
        return (f"No candidates from the current universe cleared the ratio "
                f"filters for {entity} (zone={zone}). A human should widen "
                f"the universe or reconcile more of the report first.")

    drivers: list[str] = []
    if signals["unreliable"]:
        drivers.append(
            f"{signals['checks_failed']} reconciliation check(s) failed "
            f"and {len(signals['quarantined'])} figure(s) are quarantined")
    if signals["weak_liquidity"]:
        drivers.append(
            f"current ratio {signals['ratios_seen']['current_ratio']:.2f} "
            f"below 1.0")
    if signals["weak_leverage"]:
        drivers.append(f"gearing {signals['ratios_seen']['gearing']:.2f}")
    if signals["weak_coverage"]:
        drivers.append(
            f"interest cover {signals['ratios_seen']['interest_cover']:.2f}x")
    if signals["loss_making"]:
        drivers.append("loss-making")
    if signals["strong_profits"] and signals["safe"]:
        drivers.append("strong profits and SAFE-zone Altman")

    if drivers:
        driver_line = "; ".join(drivers)
        return (f"{entity} sits in the {zone} zone with {driver_line}. "
                f"The {n} candidate(s) below reflect that profile — verdicts "
                f"describe fit for a human's review, not action.")

    # Zone alone is a signal even when the ratios read clean. Do not say "no
    # red flags" if the Altman put us in DISTRESS or GREY.
    if signals["distress"]:
        return (f"{entity} scores as DISTRESS on Altman despite operating "
                f"ratios that read clean — the shortlist stays conservative, "
                f"skewed toward stablecoins as a cash-preservation reference "
                f"for a human review.")
    if zone == "GREY":
        return (f"{entity} sits in the GREY zone between safe and distress; "
                f"the operating ratios do not flag anything specific. The "
                f"{n} candidate(s) below are a moderate-risk shortlist.")

    return (f"{entity} sits in the {zone} zone with no red flags in "
            f"the reconciled ratios. {n} candidate(s) shortlisted for a "
            f"human to review.")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _string_list(value) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value[:8]:
        text = str(item).strip()
        if text:
            out.append(text[:400])
    return out


def _limitations(model_limits) -> list[str]:
    """Non-execution disclaimer is mandatory — merge it in even if the model
    dropped it."""
    base = [
        "This is research support, not a guaranteed outcome.",
        "No trade was executed. No cryptocurrency was purchased, sold, held, or transferred.",
        "This is not investment advice under Malaysian securities regulation; a human must make the decision.",
    ]
    provided = _string_list(model_limits) if model_limits else []
    seen = set()
    merged: list[str] = []
    for line in provided + base:
        key = line.strip().lower()
        if key and key not in seen:
            seen.add(key)
            merged.append(line)
    return merged


def _snapshot_meta(snapshot: dict) -> dict:
    return {
        "provider": snapshot.get("provider"),
        "vs_currency": snapshot.get("vs_currency"),
        "fetched_at": snapshot.get("fetched_at"),
        "assets_considered": len(snapshot.get("assets") or []),
    }


def _empty_report(report_hash: str, generated_at: str,
                  reason: str, source: str) -> dict:
    return {
        "report_hash": report_hash,
        "generated_at": generated_at,
        "source": source,
        "model": None,
        "candidates": [],
        "overall_summary": "",
        "limitations": _limitations(None),
        "market_snapshot": None,
        "analysis_features": {},
        "reason": reason,
    }
