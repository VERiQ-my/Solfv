import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[1]))

from app.payment_ledger import (
    PaymentConflictError,
    PaymentLedger,
    VerifiedPayment,
)


def payment(signature: str = "sig-1", resource: str = "report-1") -> VerifiedPayment:
    return VerifiedPayment(
        resource_key=resource,
        verify_hash="a" * 64,
        expected_memo="solfv:v1:" + "a" * 64,
        expected_amount_base_units=10_000,
        expected_mint="mint",
        expected_recipient="recipient",
        network="devnet",
        transaction_signature=signature,
        payer_wallet="payer",
        commitment="confirmed",
        slot=123,
        block_time=456,
    )


def test_verified_payment_survives_new_ledger_instance(tmp_path: Path) -> None:
    database = tmp_path / "payments.sqlite3"
    ledger = PaymentLedger(str(database))
    created = ledger.record_verified(payment())

    reloaded = PaymentLedger(str(database))
    found = reloaded.get_verified("report-1", "a" * 64)

    assert created["transaction_signature"] == "sig-1"
    assert found is not None
    assert found["payer_wallet"] == "payer"


def test_repeating_same_payment_is_idempotent(tmp_path: Path) -> None:
    ledger = PaymentLedger(str(tmp_path / "payments.sqlite3"))

    first = ledger.record_verified(payment())
    second = ledger.record_verified(payment())

    assert first["id"] == second["id"]


def test_signature_cannot_be_reused_for_another_resource(tmp_path: Path) -> None:
    ledger = PaymentLedger(str(tmp_path / "payments.sqlite3"))
    ledger.record_verified(payment())

    with pytest.raises(PaymentConflictError, match="another resource"):
        ledger.record_verified(payment(resource="report-2"))


def test_resource_cannot_receive_two_payments(tmp_path: Path) -> None:
    ledger = PaymentLedger(str(tmp_path / "payments.sqlite3"))
    ledger.record_verified(payment())

    with pytest.raises(PaymentConflictError, match="different verified payment"):
        ledger.record_verified(payment(signature="sig-2"))
