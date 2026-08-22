import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .market_api import _get_json
from .payment_api import _payment_required, _requirements, get_payment_ledger
from .verify_hash import payment_memo_for_verify_result, verify_result_sha256

router = APIRouter(prefix="/v1", tags=["paper-orders"])


class PaperOrderRequest(BaseModel):
    verify_result: dict
    asset_id: str = Field(pattern=r"^[a-z0-9-]{2,80}$")
    notional_usd: float = Field(gt=0, le=10000)


@router.post("/reports/{resource_key}/paper-orders")
def create_paper_order(resource_key: str, payload: PaperOrderRequest) -> dict:
    verify_hash = verify_result_sha256(payload.verify_result)
    payment = get_payment_ledger().get_verified(resource_key, verify_hash)
    if payment is None:
        raise _payment_required(
            _requirements(resource_key, verify_hash, payment_memo_for_verify_result(payload.verify_result))
        )

    market = _get_json(
        "https://api.coingecko.com/api/v3/simple/price"
        f"?ids={payload.asset_id}&vs_currencies=usd&include_24hr_change=true",
        use_coingecko_key=True,
    ).get(payload.asset_id)
    if not market or not market.get("usd"):
        raise HTTPException(status_code=404, detail="Asset is not available in the live market feed")

    price = float(market["usd"])
    return {
        "status": "paper_order_created",
        "execution_mode": "simulated",
        "order_id": f"paper_{uuid.uuid4().hex[:16]}",
        "asset_id": payload.asset_id,
        "notional_usd": payload.notional_usd,
        "reference_price_usd": price,
        "simulated_quantity": payload.notional_usd / price,
        "payment_transaction_signature": payment["transaction_signature"],
        "created_at": datetime.now(UTC).isoformat(),
        "disclaimer": "No cryptocurrency was purchased or transferred.",
    }
