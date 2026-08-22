"""CoinGecko crypto market feed.

Sibling of `market.py`: same shape, same rules. The stock feed is Twelve Data
for company shares; this one is CoinGecko for a curated universe of crypto
assets, and it exists for one purpose — giving the advisor a *live* snapshot
of what candidates exist to research alongside a reconciled financial report.

Fails soft, exactly like every other feed in this backend. An unconfigured key
(the demo key is fine, but rate limits are strict), a network timeout, or a
provider error all return a `(None, reason)` tuple, and the advisor then either
degrades to the deterministic fallback or refuses candidates outright. There is
deliberately no hardcoded price fallback — inventing a market number on a page
whose entire point is trustworthy data would be self-defeating.

Stdlib only, matching the rest of engine/backend/.
"""

from __future__ import annotations

import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = os.getenv("COINGECKO_BASE_URL", "https://api.coingecko.com/api/v3").rstrip("/")
KEY = (
    os.getenv("COINGECKO_DEMO_API_KEY")
    or os.getenv("COINGECKO_API_KEY")
    or ""
).strip()
# Pro keys go on a different header than demo keys. The value of the env var
# does not carry the plan on it, so let the user tell us via COINGECKO_PLAN.
PLAN = os.getenv("COINGECKO_PLAN", "demo").strip().lower()
TIMEOUT = int(os.getenv("COINGECKO_TIMEOUT", "15"))
CACHE_TTL = int(os.getenv("COINGECKO_CACHE_TTL", "60"))

# The advisor needs a small, well-behaved universe: too many rows and DeepSeek
# is drowned in noise, too few and every report gets the same three answers.
DEFAULT_TOP_N = int(os.getenv("COINGECKO_TOP_N", "25"))
VS_CURRENCY = os.getenv("COINGECKO_VS_CURRENCY", "usd").lower()

_cache: dict[str, tuple[float, object]] = {}
_lock = threading.Lock()


class CryptoError(RuntimeError):
    """The feed refused or could not be reached. Always caught by callers."""


def configured() -> bool:
    # CoinGecko's public endpoint works without a key at a lower rate limit.
    # `configured() -> True` when we can identify ourselves; the module still
    # attempts calls when False, and lets the provider decide.
    return True


def status() -> dict:
    return {
        "configured": bool(KEY),
        "provider": "CoinGecko",
        "plan": PLAN if KEY else "public",
        "vs_currency": VS_CURRENCY,
        "top_n": DEFAULT_TOP_N,
        "cache_ttl": CACHE_TTL,
        "reason": None if KEY else (
            "No COINGECKO_DEMO_API_KEY is set — falling back to the public "
            "endpoint, which is rate-limited to a handful of requests a minute."
        ),
    }


# ---------------------------------------------------------------------------
# Transport
# ---------------------------------------------------------------------------

def _headers() -> dict[str, str]:
    """Header set for a call. The demo key rides on x-cg-demo-api-key; the pro
    key on x-cg-pro-api-key. Sending the wrong one silently downgrades to
    unauthenticated, which will start 429-ing under any real load."""
    h = {"Accept": "application/json", "User-Agent": "SOLFV/1.0"}
    if KEY:
        if PLAN == "pro":
            h["x-cg-pro-api-key"] = KEY
        else:
            h["x-cg-demo-api-key"] = KEY
    return h


def _get(path: str, params: dict[str, str]) -> object:
    query = urllib.parse.urlencode(params)
    cache_key = f"{path}?{query}"

    with _lock:
        hit = _cache.get(cache_key)
        if hit and time.time() - hit[0] < CACHE_TTL:
            return hit[1]

    url = f"{BASE}/{path.lstrip('/')}?{query}"
    request = urllib.request.Request(url, headers=_headers())
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = ""
        try:
            body = json.loads(error.read().decode("utf-8"))
            detail = str(
                (body.get("error") if isinstance(body, dict) else "")
                or (body.get("status", {}).get("error_message") if isinstance(body, dict) else "")
                or ""
            )
        except Exception:  # noqa: BLE001
            pass
        raise CryptoError(
            detail or f"CoinGecko returned HTTP {error.code}."
        ) from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise CryptoError(f"Could not reach CoinGecko: {error}.") from error
    except json.JSONDecodeError as error:
        raise CryptoError("CoinGecko returned a response that was not JSON.") from error

    with _lock:
        _cache[cache_key] = (time.time(), payload)
    return payload


def _number(value) -> float | None:
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

def top_markets(limit: int = DEFAULT_TOP_N, vs: str = VS_CURRENCY) -> list[dict]:
    """Top `limit` assets by market cap. The shape returned here is the exact
    row the advisor and the frontend both consume — one source of truth for
    what "a crypto asset" looks like in this app."""
    limit = max(1, min(limit, 100))
    raw = _get("coins/markets", {
        "vs_currency": vs,
        "order": "market_cap_desc",
        "per_page": str(limit),
        "page": "1",
        "sparkline": "false",
        "price_change_percentage": "24h,7d",
    })
    if not isinstance(raw, list):
        raise CryptoError("CoinGecko markets response was not a list.")

    rows: list[dict] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        rows.append({
            "asset_id": row.get("id"),
            "symbol": (row.get("symbol") or "").upper() or None,
            "name": row.get("name"),
            "image": row.get("image"),
            "price": _number(row.get("current_price")),
            "market_cap": _number(row.get("market_cap")),
            "market_cap_rank": row.get("market_cap_rank"),
            "volume_24h": _number(row.get("total_volume")),
            "change_24h_pct": _number(row.get("price_change_percentage_24h_in_currency")),
            "change_7d_pct": _number(row.get("price_change_percentage_7d_in_currency")),
            "high_24h": _number(row.get("high_24h")),
            "low_24h": _number(row.get("low_24h")),
            "ath": _number(row.get("ath")),
            "ath_change_pct": _number(row.get("ath_change_percentage")),
            "circulating_supply": _number(row.get("circulating_supply")),
            "vs_currency": vs,
            "last_updated": row.get("last_updated"),
        })
    return rows


def price(asset_ids: list[str], vs: str = VS_CURRENCY) -> dict:
    """Simple spot prices for a list of asset ids. Used by the paper-order path
    when it needs a single reference number without pulling the full row."""
    ids = ",".join(sorted({(a or "").strip().lower() for a in asset_ids if a}))
    if not ids:
        return {}
    raw = _get("simple/price", {
        "ids": ids,
        "vs_currencies": vs,
        "include_market_cap": "true",
        "include_24hr_vol": "true",
        "include_24hr_change": "true",
        "include_last_updated_at": "true",
    })
    if not isinstance(raw, dict):
        raise CryptoError("CoinGecko price response was not an object.")
    return raw


# ---------------------------------------------------------------------------
# Snapshot for the advisor
# ---------------------------------------------------------------------------

def snapshot(limit: int = DEFAULT_TOP_N) -> tuple[dict | None, str | None]:
    """Build the compact snapshot the DeepSeek prompt takes.

    Returns `(snapshot, reason)`. A None snapshot means the advisor falls back
    to a rules-only shortlist over an empty universe (which will refuse to
    return any candidates), and `reason` explains why on the response.
    """
    try:
        rows = top_markets(limit=limit)
    except CryptoError as error:
        return None, str(error)

    if not rows:
        return None, "CoinGecko returned no rows."

    return {
        "provider": "CoinGecko",
        "vs_currency": VS_CURRENCY,
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "assets": rows,
    }, None
