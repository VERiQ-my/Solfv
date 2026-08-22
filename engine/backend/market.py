"""Twelve Data market feed.

Two jobs, and the second one is the important one.

The obvious job is serving the Market Intelligence screen: a quote and a price
series to draw. The load-bearing job is filling `market_data` for the analysis
pipeline, which until now was a hardcoded constant. `pipeline.analyse()` takes
``{"market_cap": float, "share_price_1y": float}`` and two real things happen
when those values are real:

  * ``market_cap`` switches Altman from Z'' (the private-company variant, which
    substitutes book equity) to the original listed-company Z. Different
    coefficients, different thresholds, a materially different score.
  * ``share_price_1y`` unlocks the market-vs-narrative Say-Do rows. Without it
    every such claim resolves to UNVERIFIABLE, because there is nothing to test
    the sentence against.

Every call fails soft, exactly like `store`. A rate-limited or unconfigured
market feed must degrade the Z variant back to Z'' — never take a
reconciliation down. Reconciliation is the product; this is enrichment.

Stdlib only, matching the rest of the backend.
"""

from __future__ import annotations

import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = os.getenv("TWELVE_DATA_BASE_URL", "https://api.twelvedata.com").rstrip("/")
# Three accepted spellings, because the credential gets pasted out of the Twelve
# Data dashboard under whichever name the person reaches for first.
KEY = (
    os.getenv("TWELVE_DATA_API_KEY")
    or os.getenv("TWELVE_DATA_SECRET")
    or os.getenv("TWELVEDATA_API_KEY")
    or ""
).strip()
TIMEOUT = int(os.getenv("TWELVE_DATA_TIMEOUT", "12"))

# The free tier allows 8 requests/minute. A chart redraw or a second document
# for the same issuer must not spend a call, so responses are cached in-process
# for a few minutes. Nothing here is persisted.
CACHE_TTL = int(os.getenv("TWELVE_DATA_CACHE_TTL", "300"))

# Bursa codes are bare numerics ("1155" is Malayan Banking), and that collides
# with Korean listings on KRX — a symbol search for 1155 returns both. Anything
# resolved from a *filing* is therefore pinned to an exchange; the Market
# Intelligence screen passes its own, so it can still look up AAPL.
FILING_EXCHANGE = os.getenv("TWELVE_DATA_FILING_EXCHANGE", "MYX").strip()

_cache: dict[str, tuple[float, dict]] = {}
_lock = threading.Lock()


class MarketError(RuntimeError):
    """The feed refused or could not be reached. Always caught by callers."""


def configured() -> bool:
    return bool(KEY)


def status() -> dict:
    """What the UI needs to decide between a chart and an explanation."""
    return {
        "configured": configured(),
        "provider": "Twelve Data",
        "reason": None if configured() else (
            "No Twelve Data key is set. Add TWELVE_DATA_API_KEY (or "
            "TWELVE_DATA_SECRET) to the .env at the repository root and restart "
            "the engine."
        ),
        "cache_ttl": CACHE_TTL,
        "filing_exchange": FILING_EXCHANGE or None,
    }


def normalise(symbol: str) -> str:
    clean = (symbol or "").strip().upper()
    if not clean:
        raise MarketError("No symbol given.")
    return clean


def _scope(symbol: str, exchange: str | None) -> dict[str, str]:
    """Query params identifying one instrument. `exchange` is omitted when
    empty so a plain symbol still resolves on its primary listing."""
    params = {"symbol": normalise(symbol)}
    if exchange and exchange.strip():
        params["exchange"] = exchange.strip().upper()
    return params


# ---------------------------------------------------------------------------
# Transport
# ---------------------------------------------------------------------------

def _get(path: str, params: dict[str, str]) -> dict:
    if not configured():
        raise MarketError("The market feed is not configured.")

    query = urllib.parse.urlencode({**params, "apikey": KEY})
    cache_key = f"{path}?{urllib.parse.urlencode(params)}"

    with _lock:
        hit = _cache.get(cache_key)
        if hit and time.time() - hit[0] < CACHE_TTL:
            return hit[1]

    request = urllib.request.Request(
        f"{BASE}/{path.lstrip('/')}?{query}",
        headers={"Accept": "application/json", "User-Agent": "SOLFV/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:  # noqa: PERF203
        # The body carries the actionable half of the message — a plan
        # restriction reads as a bare 404 without it, which sends whoever is
        # debugging looking for a typo in the ticker.
        detail = ""
        try:
            detail = str(json.loads(error.read().decode("utf-8")).get("message") or "")
        except Exception:  # noqa: BLE001
            pass
        raise MarketError(
            detail or f"Twelve Data returned HTTP {error.code}."
        ) from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise MarketError(f"Could not reach Twelve Data: {error}.") from error
    except json.JSONDecodeError as error:
        raise MarketError("Twelve Data returned a response that was not JSON.") from error

    # Errors come back 200 OK with an error body, so the status field is the
    # only reliable signal.
    if isinstance(payload, dict) and payload.get("status") == "error":
        raise MarketError(str(payload.get("message") or "Twelve Data rejected the request."))

    with _lock:
        _cache[cache_key] = (time.time(), payload)
    return payload


def _number(value) -> float | None:
    """Twelve Data returns every figure as a string, and omissions as '' or
    'NA'. None must survive as None — a missing market cap is what keeps the
    Z-score on the private-company variant."""
    if value in (None, "", "NA", "N/A"):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed else None  # reject NaN


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

def quote(symbol: str, exchange: str | None = None) -> dict:
    """Latest quote, flattened to the fields the UI actually renders."""
    raw = _get("quote", _scope(symbol, exchange))

    fifty_two = raw.get("fifty_two_week") or {}
    return {
        "symbol": raw.get("symbol") or normalise(symbol),
        "name": raw.get("name"),
        "exchange": raw.get("exchange"),
        "currency": raw.get("currency"),
        "datetime": raw.get("datetime"),
        "open": _number(raw.get("open")),
        "high": _number(raw.get("high")),
        "low": _number(raw.get("low")),
        "close": _number(raw.get("close")),
        "previous_close": _number(raw.get("previous_close")),
        "change": _number(raw.get("change")),
        "percent_change": _number(raw.get("percent_change")),
        "volume": _number(raw.get("volume")),
        "average_volume": _number(raw.get("average_volume")),
        "fifty_two_week_high": _number(fifty_two.get("high")),
        "fifty_two_week_low": _number(fifty_two.get("low")),
        "is_market_open": raw.get("is_market_open"),
    }


def time_series(
    symbol: str, interval: str = "1day", outputsize: int = 260,
    exchange: str | None = None,
) -> dict:
    """Price history, oldest first so a chart can read it straight through."""
    raw = _get("time_series", {
        **_scope(symbol, exchange),
        "interval": interval,
        "outputsize": str(max(1, min(outputsize, 5000))),
        "order": "ASC",
    })

    values = raw.get("values") or []
    meta = raw.get("meta") or {}
    candles = [
        {
            "datetime": row.get("datetime"),
            "open": _number(row.get("open")),
            "high": _number(row.get("high")),
            "low": _number(row.get("low")),
            "close": _number(row.get("close")),
            "volume": _number(row.get("volume")),
        }
        for row in values
        if _number(row.get("close")) is not None
    ]
    return {
        "symbol": meta.get("symbol") or normalise(symbol),
        "currency": meta.get("currency"),
        "exchange": meta.get("exchange"),
        "interval": meta.get("interval") or interval,
        "values": candles,
    }


def search(query: str, limit: int = 12) -> list[dict]:
    """Resolve a name or code to tradeable symbols.

    Bursa codes are the reason this exists: a filing gives you "1155", and only
    the search endpoint can tell you which suffix Twelve Data indexes it under.
    Guessing the suffix would fail silently on every non-Malaysian issuer.
    """
    raw = _get("symbol_search", {"symbol": (query or "").strip(), "outputsize": str(limit)})
    return [
        {
            "symbol": row.get("symbol"),
            "name": row.get("instrument_name"),
            "exchange": row.get("exchange"),
            "country": row.get("country"),
            "currency": row.get("currency"),
            "type": row.get("instrument_type"),
        }
        for row in (raw.get("data") or [])[:limit]
        if row.get("symbol")
    ]


def market_cap(symbol: str, exchange: str | None = None) -> float | None:
    """Market capitalisation, if this key's plan exposes it.

    `/statistics` is a fundamentals endpoint and is not on every plan. A refusal
    here is expected and must stay non-fatal: without it the pipeline keeps the
    Z'' variant, which is the correct conservative answer rather than a
    degraded one.
    """
    try:
        raw = _get("statistics", _scope(symbol, exchange))
    except MarketError:
        return None

    statistics = raw.get("statistics") or {}
    valuations = statistics.get("valuations_metrics") or {}
    return _number(valuations.get("market_capitalization"))


# ---------------------------------------------------------------------------
# The pipeline's view
# ---------------------------------------------------------------------------

def for_ticker(ticker: str | None) -> tuple[dict | None, str | None]:
    """Build the ``market_data`` dict `analysis.pipeline.analyse()` expects.

    Returns ``(data, reason)``. A None `data` means the pipeline runs exactly as
    if no market data existed — Altman stays on Z'', market-vs-narrative claims
    stay UNVERIFIABLE — and `reason` says why, so the refusal surfaces in the
    session warnings instead of looking like an absent feature.

    Plan coverage is the common reason: a Twelve Data key that resolves US
    equities will still refuse Bursa Malaysia symbols below the Pro tier.
    """
    if not ticker:
        return None, None
    if not configured():
        return None, "No Twelve Data key is configured."

    try:
        series = time_series(ticker, interval="1day", outputsize=400,
                             exchange=FILING_EXCHANGE)
    except MarketError as error:
        return None, str(error)

    values = series.get("values") or []
    if not values:
        return None, f"Twelve Data returned no price history for {ticker}."

    latest = values[-1]["close"]

    # A year back by trading days rather than calendar date: the series is
    # already daily and gap-free, so the count is the reliable index.
    baseline = values[0]["close"]
    if len(values) > 252:
        baseline = values[-253]["close"]

    share_price_1y = None
    if latest is not None and baseline:
        share_price_1y = (latest - baseline) / abs(baseline)

    data: dict = {}
    if share_price_1y is not None:
        data["share_price_1y"] = share_price_1y

    cap = market_cap(ticker, exchange=FILING_EXCHANGE)
    if cap is not None:
        data["market_cap"] = cap

    if not data:
        return None, f"Twelve Data had no usable market figures for {ticker}."

    data["source"] = "twelvedata"
    data["symbol"] = series.get("symbol")
    data["exchange"] = series.get("exchange") or FILING_EXCHANGE
    data["as_of"] = values[-1]["datetime"]
    return data, None
