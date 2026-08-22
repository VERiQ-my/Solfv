import json
from datetime import datetime, timezone
from urllib.request import Request, urlopen

from fastapi import APIRouter, HTTPException

from .config import get_settings


router = APIRouter(prefix="/v1/market", tags=["market"])


def _get_json(url: str, use_coingecko_key: bool = False) -> dict:
    headers = {"accept": "application/json", "user-agent": "Solfv/0.1"}
    if use_coingecko_key and get_settings().coingecko_demo_api_key:
        headers["x-cg-demo-api-key"] = get_settings().coingecko_demo_api_key
    request = Request(url, headers=headers)
    try:
        with urlopen(request, timeout=10) as response:
            return json.load(response)
    except Exception as error:
        raise HTTPException(status_code=502, detail="Live market data provider unavailable") from error


@router.get("/solana")
def solana_market() -> dict:
    price = _get_json(
        "https://api.coingecko.com/api/v3/simple/price"
        "?ids=solana&vs_currencies=usd&include_market_cap=true"
        "&include_24hr_vol=true&include_24hr_change=true"
    , use_coingecko_key=True).get("solana")
    pools = _get_json("https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?page=1").get("data", [])
    if not price:
        raise HTTPException(status_code=502, detail="SOL market data was empty")

    pool_summary = []
    for pool in pools[:5]:
        attributes = pool.get("attributes", {})
        pool_summary.append({
            "name": attributes.get("name"),
            "address": attributes.get("address"),
            "price_change_24h": attributes.get("price_change_percentage", {}).get("h24"),
            "volume_24h_usd": attributes.get("volume_usd", {}).get("h24"),
            "liquidity_usd": attributes.get("reserve_in_usd"),
        })

    return {
        "asset": "SOL",
        "price_usd": price.get("usd"),
        "market_cap_usd": price.get("usd_market_cap"),
        "volume_24h_usd": price.get("usd_24h_vol"),
        "change_24h_percent": price.get("usd_24h_change"),
        "trending_pools": pool_summary,
        "source": [
            "CoinGecko public market API",
            "GeckoTerminal public Solana pools API",
        ],
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "disclaimer": "Market intelligence only; not investment advice or trade execution.",
    }


@router.get("/crypto")
def crypto_market() -> dict:
    coins = _get_json(
        "https://api.coingecko.com/api/v3/coins/markets"
        "?vs_currency=usd&order=market_cap_desc&per_page=50&page=1"
        "&sparkline=false&price_change_percentage=24h,7d",
        use_coingecko_key=True,
    )
    return {
        "assets": [
            {
                "id": coin.get("id"),
                "symbol": coin.get("symbol"),
                "name": coin.get("name"),
                "image": coin.get("image"),
                "rank": coin.get("market_cap_rank"),
                "price_usd": coin.get("current_price"),
                "market_cap_usd": coin.get("market_cap"),
                "volume_24h_usd": coin.get("total_volume"),
                "change_24h_percent": coin.get("price_change_percentage_24h"),
                "change_7d_percent": coin.get("price_change_percentage_7d_in_currency"),
            }
            for coin in coins
        ],
        "universe": "Top 50 crypto assets by market capitalization",
        "source": "CoinGecko market API",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "disclaimer": "Market intelligence only; not investment advice or trade execution.",
    }
