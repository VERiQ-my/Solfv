"""Minimal agent client for the Solfv simulated x402 demo."""

import json
import sys
import urllib.error
import urllib.request
import uuid

API_URL = "http://127.0.0.1:8000/v1/reports/demo-report/analysis"
PAYER_WALLET = "ACVHZEXtMH1L3YT8RWymgyheKMshbn7AtcE2RT4Qe4W1"


def post(payload: dict) -> tuple[int, dict]:
    request = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def main() -> int:
    verify_result = {
        "revenue": {"value": 1_000_000, "currency": "MYR", "period": "FY2025"},
        "source": {"page": 4, "method": "table-extraction", "confidence": 0.98},
    }
    payload = {"verify_result": verify_result}
    status, challenge = post(payload)
    if status != 402:
        print(json.dumps(challenge, indent=2))
        return 1

    requirements = challenge["detail"]["paymentRequirements"]
    print(f"402 received: pay {int(requirements['amount']) / 1_000_000} USDC")

    payload["payment"] = {
        "mode": "simulated",
        "transaction_signature": f"sim_agent_{uuid.uuid4().hex}",
        "payer_wallet": PAYER_WALLET,
        "amount_base_units": int(requirements["amount"]),
        "mint": requirements["asset"],
        "recipient": requirements["payTo"],
        "memo": requirements["extra"]["memo"],
    }
    status, result = post(payload)
    print(f"retry status: {status}")
    print(json.dumps(result, indent=2))
    return 0 if status == 200 else 1


if __name__ == "__main__":
    sys.exit(main())
