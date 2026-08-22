import base64
import json
import urllib.request
from typing import Any


TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
MEMO_PROGRAM_IDS = {
    "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
    "Memo1UhkJBfCR6MNLbGqB5MZxqC2Y1u1kV1hC8HqH6H6",
}


class PaymentVerificationError(ValueError):
    pass


def _base58_decode(value: str) -> bytes:
    alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    number = 0
    for character in value:
        if character not in alphabet:
            raise PaymentVerificationError("invalid base58 value")
        number = number * 58 + alphabet.index(character)
    raw = number.to_bytes((number.bit_length() + 7) // 8, "big")
    return b"\x00" * (len(value) - len(value.lstrip("1"))) + raw


class SolanaRpcClient:
    def __init__(self, rpc_url: str, commitment: str = "confirmed") -> None:
        self.rpc_url = rpc_url
        self.commitment = commitment

    def get_transaction(self, signature: str) -> dict[str, Any] | None:
        body = json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "getTransaction",
                "params": [
                    signature,
                    {
                        "encoding": "jsonParsed",
                        "commitment": self.commitment,
                        "maxSupportedTransactionVersion": 0,
                    },
                ],
            }
        ).encode()
        request = urllib.request.Request(
            self.rpc_url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                payload = json.loads(response.read())
        except Exception as error:
            raise PaymentVerificationError("Solana RPC unavailable") from error
        if payload.get("error"):
            raise PaymentVerificationError("Solana RPC returned an error")
        return payload.get("result")


class SolanaPaymentVerifier:
    def __init__(self, rpc: SolanaRpcClient) -> None:
        self.rpc = rpc

    def verify(
        self,
        signature: str,
        expected_amount: int,
        expected_mint: str,
        expected_recipient: str,
        expected_memo: str,
    ) -> dict[str, Any]:
        if len(_base58_decode(signature)) != 64:
            raise PaymentVerificationError("invalid transaction signature")

        transaction = self.rpc.get_transaction(signature)
        if transaction is None:
            raise PaymentVerificationError("transaction not found or not confirmed")
        meta = transaction.get("meta") or {}
        if meta.get("err") is not None:
            raise PaymentVerificationError("transaction failed")

        message = (transaction.get("transaction") or {}).get("message") or {}
        account_keys = message.get("accountKeys") or []
        payer = self._key_value(account_keys[0]) if account_keys else ""
        if payer == expected_recipient:
            raise PaymentVerificationError("payer and recipient must differ")

        destination_owners = self._destination_owners(message, meta)
        instructions = list(message.get("instructions") or [])
        for group in meta.get("innerInstructions") or []:
            instructions.extend(group.get("instructions") or [])

        transfers = []
        memos = []
        for instruction in instructions:
            parsed = instruction.get("parsed") or {}
            info = parsed.get("info") if isinstance(parsed, dict) else {}
            info = info or {}
            program_id = instruction.get("programId") or ""
            instruction_type = parsed.get("type") if isinstance(parsed, dict) else None
            if instruction_type in {"transfer", "transferChecked"} and info.get("destination"):
                amount = info.get("tokenAmount", {}).get("amount", info.get("amount"))
                mint = info.get("mint")
                if mint and amount is not None:
                    transfers.append(
                        (str(mint), int(amount), info["destination"], destination_owners.get(info["destination"]))
                    )
            if program_id in MEMO_PROGRAM_IDS:
                memo = parsed if isinstance(parsed, str) else instruction.get("data")
                if memo:
                    try:
                        memos.append(_base58_decode(str(memo)).decode("utf-8"))
                    except Exception:
                        memos.append(str(memo))

        matches = [
            transfer
            for transfer in transfers
            if transfer[0] == expected_mint
            and transfer[1] == expected_amount
            and transfer[3] == expected_recipient
        ]
        if len(matches) != 1:
            raise PaymentVerificationError("expected exactly one matching USDC transfer")
        if memos.count(expected_memo) != 1:
            raise PaymentVerificationError("required memo does not match")

        return {
            "transaction_signature": signature,
            "payer_wallet": payer,
            "slot": transaction.get("slot"),
            "block_time": transaction.get("blockTime"),
            "commitment": self.rpc.commitment,
        }

    @staticmethod
    def _key_value(key: Any) -> str:
        return key.get("pubkey", "") if isinstance(key, dict) else str(key)

    def _destination_owners(self, message: dict[str, Any], meta: dict[str, Any]) -> dict[str, str]:
        keys = [self._key_value(key) for key in message.get("accountKeys") or []]
        owners = {}
        for balance in meta.get("postTokenBalances") or []:
            index = balance.get("accountIndex")
            if index is not None and index < len(keys) and balance.get("owner"):
                owners[keys[index]] = balance["owner"]
        return owners
