import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[1]))

from app.solana_verifier import PaymentVerificationError, SolanaPaymentVerifier

ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def base58_encode(value: bytes) -> str:
    number = int.from_bytes(value, "big")
    output = ""
    while number:
        number, remainder = divmod(number, 58)
        output = ALPHABET[remainder] + output
    return "1" * (len(value) - len(value.lstrip(b"\0"))) + (output or "1")


class FakeRpc:
    commitment = "confirmed"

    def __init__(self, transaction: dict):
        self.transaction = transaction

    def get_transaction(self, signature: str) -> dict:
        return self.transaction


def transaction(memo: str) -> dict:
    payer = "payer-wallet"
    destination_ata = "destination-ata"
    recipient = "merchant-wallet"
    mint = "usdc-devnet-mint"
    return {
        "slot": 123,
        "blockTime": 456,
        "transaction": {
            "message": {
                "accountKeys": [
                    {"pubkey": payer, "signer": True},
                    {"pubkey": destination_ata, "signer": False},
                ],
                "instructions": [
                    {
                        "programId": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                        "parsed": {
                            "type": "transferChecked",
                            "info": {
                                "amount": "10000",
                                "destination": destination_ata,
                                "mint": mint,
                            },
                        },
                    },
                    {"programId": "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", "parsed": memo},
                ],
            }
        },
        "meta": {
            "err": None,
            "postTokenBalances": [
                {"accountIndex": 1, "owner": recipient, "mint": mint}
            ],
        },
    }


def test_valid_transfer_and_memo() -> None:
    signature = base58_encode(b"s" * 64)
    result = SolanaPaymentVerifier(FakeRpc(transaction("solfv:v1:hash"))).verify(
        signature, 10000, "usdc-devnet-mint", "merchant-wallet", "solfv:v1:hash"
    )

    assert result["payer_wallet"] == "payer-wallet"
    assert result["slot"] == 123


def test_wrong_memo_is_rejected() -> None:
    signature = base58_encode(b"s" * 64)
    with pytest.raises(PaymentVerificationError, match="memo"):
        SolanaPaymentVerifier(FakeRpc(transaction("solfv:v1:other"))).verify(
            signature, 10000, "usdc-devnet-mint", "merchant-wallet", "solfv:v1:hash"
        )
