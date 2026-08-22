import base64
import json
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from .config import get_settings
from .payment_ledger import PaymentLedger, VerifiedPayment
from .postgres_payment_ledger import PostgresPaymentLedger
from .solana_verifier import PaymentVerificationError, SolanaPaymentVerifier, SolanaRpcClient
from .verify_hash import payment_memo_for_verify_result, verify_result_sha256


router = APIRouter(prefix="/v1", tags=["payments"])
settings = get_settings()
active_ledger: PaymentLedger | PostgresPaymentLedger | None = None


def get_payment_ledger() -> PaymentLedger | PostgresPaymentLedger:
    global active_ledger
    if active_ledger is None:
        active_ledger = (
            PostgresPaymentLedger(settings.database_url)
            if settings.database_url
            else PaymentLedger(settings.payment_db_path)
        )
    return active_ledger


class SimulatedPayment(BaseModel):
    mode: str = "simulated"
    transaction_signature: str = Field(min_length=8)
    payer_wallet: str = Field(min_length=32)
    amount_base_units: int = Field(gt=0)
    mint: str
    recipient: str
    memo: str


class AnalysisRequest(BaseModel):
    verify_result: dict[str, Any]
    payment: SimulatedPayment | None = None


class VerifyPaymentRequest(BaseModel):
    verify_result: dict[str, Any]
    transaction_signature: str = Field(min_length=80)


def _requirements(resource_key: str, verify_hash: str, memo: str) -> dict[str, Any]:
    return {
        "x402Version": 2,
        "scheme": "exact",
        "network": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
        "amount": str(settings.payment_amount_base_units),
        "asset": settings.usdc_mint,
        "payTo": settings.payment_recipient,
        "maxTimeoutSeconds": settings.payment_timeout_seconds,
        "extra": {"memo": memo},
        "resource": resource_key,
    }


def _payment_required(requirements: dict[str, Any]) -> HTTPException:
    encoded = base64.b64encode(json.dumps(requirements, separators=(",", ":")).encode()).decode()
    return HTTPException(
        status_code=status.HTTP_402_PAYMENT_REQUIRED,
        detail={
            "error": "payment_required",
            "mode": settings.payment_mode,
            "paymentRequirements": requirements,
            "message": (
                "Payment required before creating this paper order."
                if settings.payment_mode == "devnet"
                else "Demo mode: x402 payment is simulated; no blockchain funds are transferred."
            ),
        },
        headers={"PAYMENT-REQUIRED": encoded},
    )


@router.post("/reports/{resource_key}/verify-payment")
def verify_payment(resource_key: str, payload: VerifyPaymentRequest) -> dict[str, Any]:
    if settings.payment_mode != "devnet":
        raise HTTPException(status_code=409, detail="Live verification requires PAYMENT_MODE=devnet")

    verify_hash = verify_result_sha256(payload.verify_result)
    memo = payment_memo_for_verify_result(payload.verify_result)
    try:
        verification = SolanaPaymentVerifier(
            SolanaRpcClient(settings.solana_rpc_url, settings.solana_commitment)
        ).verify(
            signature=payload.transaction_signature,
            expected_amount=settings.payment_amount_base_units,
            expected_mint=settings.usdc_mint,
            expected_recipient=settings.payment_recipient,
            expected_memo=memo,
        )
    except PaymentVerificationError as error:
        raise HTTPException(status_code=402, detail=str(error)) from error

    record = get_payment_ledger().record_verified(
        VerifiedPayment(
            resource_key=resource_key,
            verify_hash=verify_hash,
            expected_memo=memo,
            expected_amount_base_units=settings.payment_amount_base_units,
            expected_mint=settings.usdc_mint,
            expected_recipient=settings.payment_recipient,
            network="devnet",
            transaction_signature=payload.transaction_signature,
            payer_wallet=verification["payer_wallet"],
            commitment=verification["commitment"],
            slot=verification.get("slot"),
            block_time=verification.get("block_time"),
        )
    )
    return {"status": "verified", "payment": record, "verify_hash": verify_hash}


@router.post("/reports/{resource_key}/analysis")
def paid_analysis(resource_key: str, payload: AnalysisRequest, request: Request) -> dict[str, Any]:
    del request
    verify_hash = verify_result_sha256(payload.verify_result)
    memo = payment_memo_for_verify_result(payload.verify_result)
    requirements = _requirements(resource_key, verify_hash, memo)

    if settings.payment_mode == "devnet":
        return {
            "status": "analysis_ready",
            "payment_mode": "free_analysis",
            "resource_key": resource_key,
            "verify_hash": verify_hash,
            "analysis": payload.verify_result,
            "message": "Financial analysis is available. Payment is required only to create a simulated purchase.",
        }

    if payload.payment is None:
        raise _payment_required(requirements)

    payment = payload.payment
    if (
        payment.mode != "simulated"
        or payment.amount_base_units != settings.payment_amount_base_units
        or payment.mint != settings.usdc_mint
        or payment.recipient != settings.payment_recipient
        or payment.memo != memo
        or not payment.transaction_signature.startswith("sim_")
    ):
        raise HTTPException(status_code=402, detail="Invalid simulated x402 payment")

    record = get_payment_ledger().record_verified(
        VerifiedPayment(
            resource_key=resource_key,
            verify_hash=verify_hash,
            expected_memo=memo,
            expected_amount_base_units=settings.payment_amount_base_units,
            expected_mint=settings.usdc_mint,
            expected_recipient=settings.payment_recipient,
            network="devnet",
            transaction_signature=payment.transaction_signature,
            payer_wallet=payment.payer_wallet,
            commitment="simulated",
        )
    )
    return {
        "status": "unlocked",
        "payment_mode": "simulated",
        "resource_key": resource_key,
        "verify_hash": verify_hash,
        "payment": record,
        "message": "Analysis access unlocked in simulated x402 mode.",
    }
