import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parents[1]))

from app import payment_api  # noqa: E402
from app.main import app  # noqa: E402
from app.payment_ledger import PaymentLedger  # noqa: E402
from app.verify_hash import payment_memo_for_verify_result  # noqa: E402


def test_simulated_x402_challenge_and_unlock(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(payment_api.settings, "payment_mode", "simulated")
    payment_api.active_ledger = PaymentLedger(str(tmp_path / "payments.sqlite3"))
    verify_result = {"revenue": {"value": 100, "currency": "MYR"}}
    client = TestClient(app)

    challenge = client.post(
        "/v1/reports/report-1/analysis",
        json={"verify_result": verify_result},
    )

    assert challenge.status_code == 402
    requirements = challenge.json()["detail"]["paymentRequirements"]
    assert requirements["network"] == "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"
    assert challenge.headers["payment-required"]

    unlocked = client.post(
        "/v1/reports/report-1/analysis",
        json={
            "verify_result": verify_result,
            "payment": {
                "transaction_signature": "sim_test_payment_1",
                "payer_wallet": "ACVHZEXtMH1L3YT8RWymgyheKMshbn7AtcE2RT4Qe4W1",
                "amount_base_units": payment_api.settings.payment_amount_base_units,
                "mint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
                "recipient": "GG8RDLrDoBfvdqZuJrRT2xFsVAE7R2MKsGzCrpMHSzwP",
                "memo": payment_memo_for_verify_result(verify_result),
            },
        },
    )

    assert unlocked.status_code == 200
    assert unlocked.json()["status"] == "unlocked"
    assert unlocked.json()["payment_mode"] == "simulated"


def test_simulated_payment_rejects_wrong_memo(monkeypatch) -> None:
    monkeypatch.setattr(payment_api.settings, "payment_mode", "simulated")
    client = TestClient(app)
    response = client.post(
        "/v1/reports/report-2/analysis",
        json={
            "verify_result": {"revenue": 100},
            "payment": {
                "transaction_signature": "sim_test_payment_2",
                "payer_wallet": "ACVHZEXtMH1L3YT8RWymgyheKMshbn7AtcE2RT4Qe4W1",
                "amount_base_units": payment_api.settings.payment_amount_base_units,
                "mint": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
                "recipient": "GG8RDLrDoBfvdqZuJrRT2xFsVAE7R2MKsGzCrpMHSzwP",
                "memo": "solfv:v1:" + "0" * 64,
            },
        },
    )

    assert response.status_code == 402
