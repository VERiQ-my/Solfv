"""Solana devnet x402 paper-order flow.

The whole point of the Solana track submission lives here. A reviewer has an
analysed report on their session; they click "Simulate purchase" on one of the
AI advisor's candidates; the backend answers HTTP 402 with x402 payment
requirements; Phantom signs a real devnet USDC TransferChecked with a memo
bound to a SHA-256 of the analysis; the backend verifies the transaction
against the Solana RPC and stores it in the `public.payments` ledger; only
then does it create the simulated paper-order receipt.

The whole module is:

  - the *verifier* — RPC round-trip and instruction-parsing that refuses
    anything except a devnet SPL USDC TransferChecked to the exact recipient,
    with the exact amount, mint and memo we asked for;

  - the *ledger* — idempotent inserts into `public.payments`, with SQLite as
    the fallback so the demo runs even with no DATABASE_URL set;

  - the *paper-order creator* — takes a verified payment record and a live
    CoinGecko price and returns a receipt.

Every line here treats real cryptocurrency as *not being purchased*. The word
"buy" does not appear because no buy happens. This is research support with a
verified on-chain settlement layer, not a brokerage.
"""

from __future__ import annotations

import hashlib
import json
import os
import pathlib
import sqlite3
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Any

from . import crypto as crypto_market

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # pragma: no cover - psycopg is in requirements
    psycopg = None
    dict_row = None


# ---------------------------------------------------------------------------
# Configuration — everything from env, everything with a demo-safe default
# ---------------------------------------------------------------------------

NETWORK       = os.getenv("SOLANA_NETWORK", "devnet").strip()
RPC_URL       = os.getenv("SOLANA_RPC_URL", "https://api.devnet.solana.com").strip()
COMMITMENT    = os.getenv("SOLANA_COMMITMENT", "confirmed").strip()
USDC_MINT     = os.getenv("USDC_MINT", "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU").strip()
USDC_DECIMALS = int(os.getenv("USDC_DECIMALS", "6"))
RECIPIENT     = os.getenv("PAYMENT_RECIPIENT",
                          "GG8RDLrDoBfvdqZuJrRT2xFsVAE7R2MKsGzCrpMHSzwP").strip()
AMOUNT_BASE_UNITS = int(os.getenv("PAYMENT_AMOUNT_BASE_UNITS", "1000"))
TIMEOUT_SECONDS   = int(os.getenv("PAYMENT_TIMEOUT_SECONDS", "300"))
RPC_TIMEOUT       = int(os.getenv("SOLANA_RPC_TIMEOUT", "12"))
DATABASE_URL      = os.getenv("DATABASE_URL", "").strip()
SQLITE_PATH       = os.getenv("PAYMENT_SQLITE_PATH", str(
    pathlib.Path(__file__).resolve().parents[2] / "data" / "payments.sqlite"))

MEMO_PREFIX = "solfv:v1:"

# The two memo program ids Solana has ever shipped — the newer SPL memo and
# the legacy variant. Either is accepted.
_MEMO_PROGRAM_IDS = {
    "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
    "Memo1UhkJBfCR6MNLbGqB5MZxqC2Y1u1kV1hC8HqH6H6",
}

# CAIP-2 network id for the Solana devnet, as required by the x402 spec.
SOLANA_CAIP = os.getenv("SOLANA_CAIP",
                        "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1").strip()


class PaymentError(RuntimeError):
    """Verifier or ledger refused. Always caught by the API layer."""


# ---------------------------------------------------------------------------
# Hashing — the memo binds a payment to a specific reconciled analysis
# ---------------------------------------------------------------------------

def canonical_bytes(value: Any) -> bytes:
    """Deterministic serialisation for hashing. The exact bytes matter: any
    two payloads that produce the same hash must produce the same memo."""
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def verify_hash(analysis: dict) -> str:
    # We hash the *shaped* subset of the analysis that survives across
    # renders — line items, ratios, risk — not the session envelope (which
    # carries timestamps that would break memo reproducibility).
    payload = {
        "entity": analysis.get("entity"),
        "period": analysis.get("period"),
        "ticker": analysis.get("ticker"),
        "line_items": analysis.get("line_items") or [],
        "ratios": analysis.get("ratios") or {},
        "risk": analysis.get("risk") or {},
        "summary": analysis.get("summary") or {},
    }
    return hashlib.sha256(canonical_bytes(payload)).hexdigest()


def memo_for(analysis: dict) -> str:
    return f"{MEMO_PREFIX}{verify_hash(analysis)}"


# ---------------------------------------------------------------------------
# x402 payment requirements — the 402 challenge body
# ---------------------------------------------------------------------------

def requirements(resource_key: str, memo: str) -> dict:
    return {
        "x402Version": 2,
        "scheme": "exact",
        "network": SOLANA_CAIP,
        "amount": str(AMOUNT_BASE_UNITS),
        "asset": USDC_MINT,
        "assetDecimals": USDC_DECIMALS,
        "payTo": RECIPIENT,
        "maxTimeoutSeconds": TIMEOUT_SECONDS,
        "extra": {"memo": memo, "network": NETWORK, "rpcUrl": RPC_URL},
        "resource": resource_key,
    }


def payment_required_body(resource_key: str, memo: str, extra: dict | None = None) -> dict:
    body: dict[str, Any] = {
        "error": "payment_required",
        "paymentRequirements": requirements(resource_key, memo),
        "message": "This paper order requires a devnet USDC settlement first.",
        "network": NETWORK,
    }
    if extra:
        body.update(extra)
    return body


# ---------------------------------------------------------------------------
# Solana RPC + verifier
# ---------------------------------------------------------------------------

_BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def _b58decode(value: str) -> bytes:
    number = 0
    for ch in value:
        if ch not in _BASE58:
            raise PaymentError("Invalid base58 value.")
        number = number * 58 + _BASE58.index(ch)
    raw = number.to_bytes((number.bit_length() + 7) // 8, "big")
    leading = len(value) - len(value.lstrip("1"))
    return b"\x00" * leading + raw


def _rpc(method: str, params: list) -> dict:
    body = json.dumps({"jsonrpc": "2.0", "id": 1,
                       "method": method, "params": params}).encode("utf-8")
    request = urllib.request.Request(
        RPC_URL, data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=RPC_TIMEOUT) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.URLError as error:
        raise PaymentError(f"Could not reach Solana RPC: {error}") from error
    except (OSError, TimeoutError) as error:
        raise PaymentError(f"Solana RPC timed out: {error}") from error
    except json.JSONDecodeError as error:
        raise PaymentError("Solana RPC returned non-JSON.") from error


def rpc_status() -> dict:
    """Cluster reachability — used by /health and the Solana settings page."""
    out: dict[str, Any] = {"network": NETWORK, "rpc_url": RPC_URL,
                            "recipient": RECIPIENT, "usdc_mint": USDC_MINT,
                            "amount_base_units": AMOUNT_BASE_UNITS,
                            "reachable": False, "slot": None, "version": None,
                            "reason": None}
    try:
        version = _rpc("getVersion", []).get("result") or {}
        out["version"] = version.get("solana-core")
        slot = _rpc("getSlot", []).get("result")
        out["slot"] = slot
        out["reachable"] = slot is not None
    except PaymentError as error:
        out["reason"] = str(error)
    return out


def _key_value(key: Any) -> str:
    return key.get("pubkey", "") if isinstance(key, dict) else str(key)


def _destination_owners(message: dict, meta: dict) -> dict[str, str]:
    keys = [_key_value(k) for k in message.get("accountKeys") or []]
    owners: dict[str, str] = {}
    for balance in meta.get("postTokenBalances") or []:
        index = balance.get("accountIndex")
        if isinstance(index, int) and 0 <= index < len(keys) and balance.get("owner"):
            owners[keys[index]] = balance["owner"]
    return owners


def verify_signature(signature: str, expected_memo: str) -> dict:
    """Verify a devnet transaction meets every constraint. Raises PaymentError
    with a specific reason on any failure — the reason is safe to show a user."""

    if len(_b58decode(signature)) != 64:
        raise PaymentError("Transaction signature is not 64 bytes.")

    body = _rpc("getTransaction", [signature, {
        "encoding": "jsonParsed",
        "commitment": COMMITMENT,
        "maxSupportedTransactionVersion": 0,
    }])
    if body.get("error"):
        raise PaymentError(f"RPC error: {body['error'].get('message') or body['error']}")

    transaction = body.get("result")
    if transaction is None:
        raise PaymentError("Transaction not found or not confirmed yet.")

    meta = transaction.get("meta") or {}
    if meta.get("err") is not None:
        raise PaymentError(f"On-chain execution failed: {meta['err']}")

    message = (transaction.get("transaction") or {}).get("message") or {}
    account_keys = message.get("accountKeys") or []
    if not account_keys:
        raise PaymentError("Transaction had no account keys.")
    payer = _key_value(account_keys[0])
    if payer == RECIPIENT:
        raise PaymentError("Payer and recipient wallets must differ.")

    destination_owners = _destination_owners(message, meta)
    instructions = list(message.get("instructions") or [])
    for group in meta.get("innerInstructions") or []:
        instructions.extend(group.get("instructions") or [])

    transfers: list[tuple[str, int, str, str | None]] = []
    memos: list[str] = []

    for instruction in instructions:
        parsed = instruction.get("parsed") or {}
        info = parsed.get("info") if isinstance(parsed, dict) else {}
        info = info or {}
        program_id = instruction.get("programId") or ""
        instruction_type = parsed.get("type") if isinstance(parsed, dict) else None

        if instruction_type in {"transfer", "transferChecked"} and info.get("destination"):
            amount = (info.get("tokenAmount") or {}).get("amount", info.get("amount"))
            mint = info.get("mint")
            if mint and amount is not None:
                try:
                    transfers.append((str(mint), int(amount), info["destination"],
                                      destination_owners.get(info["destination"])))
                except (TypeError, ValueError):
                    continue

        if program_id in _MEMO_PROGRAM_IDS:
            raw_memo = parsed if isinstance(parsed, str) else instruction.get("data")
            if raw_memo:
                try:
                    memos.append(_b58decode(str(raw_memo)).decode("utf-8"))
                except Exception:  # noqa: BLE001 - memo may be plain utf-8 already
                    memos.append(str(raw_memo))

    matches = [t for t in transfers
               if t[0] == USDC_MINT and t[1] == AMOUNT_BASE_UNITS and t[3] == RECIPIENT]
    if len(matches) != 1:
        raise PaymentError(
            f"Expected exactly one USDC transfer of {AMOUNT_BASE_UNITS} base units "
            f"({AMOUNT_BASE_UNITS / (10 ** USDC_DECIMALS)} USDC) to the merchant wallet, "
            f"found {len(matches)}."
        )
    if memos.count(expected_memo) != 1:
        raise PaymentError(
            "The required memo binding this payment to the analysis was not found. "
            "The memo must match the SHA-256 of the reconciled analysis exactly."
        )

    return {
        "transaction_signature": signature,
        "payer_wallet": payer,
        "commitment": COMMITMENT,
        "slot": transaction.get("slot"),
        "block_time": transaction.get("blockTime"),
    }


# ---------------------------------------------------------------------------
# Ledger — Postgres primary, SQLite fallback
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class VerifiedPayment:
    resource_key: str
    verify_hash: str
    expected_memo: str
    expected_amount_base_units: int
    expected_mint: str
    expected_recipient: str
    network: str
    transaction_signature: str
    payer_wallet: str
    commitment: str
    slot: int | None = None
    block_time: int | None = None
    caller_id: str | None = None


_ledger_ready = False
_ledger_backend: str | None = None


def _ensure_sqlite_schema() -> None:
    path = pathlib.Path(SQLITE_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(SQLITE_PATH, timeout=10) as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                resource_key TEXT NOT NULL,
                caller_id TEXT,
                verify_hash TEXT NOT NULL,
                expected_memo TEXT NOT NULL,
                expected_amount_base_units INTEGER NOT NULL,
                expected_mint TEXT NOT NULL,
                expected_recipient TEXT NOT NULL,
                network TEXT NOT NULL,
                transaction_signature TEXT NOT NULL UNIQUE,
                payer_wallet TEXT NOT NULL,
                commitment TEXT NOT NULL,
                slot INTEGER,
                block_time INTEGER,
                status TEXT NOT NULL DEFAULT 'verified',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (resource_key, verify_hash)
            );
        """)


def _ensure_postgres_schema() -> None:
    # Idempotent — matches backend/migrations/001_payment_ledger.sql exactly.
    with psycopg.connect(DATABASE_URL, connect_timeout=10, autocommit=True) as conn:
        conn.execute("""
            create table if not exists public.payments (
                id bigint generated by default as identity primary key,
                resource_key text not null,
                caller_id text,
                verify_hash char(64) not null,
                expected_memo varchar(256) not null,
                expected_amount_base_units bigint not null check (expected_amount_base_units > 0),
                expected_mint text not null,
                expected_recipient text not null,
                network text not null check (network = 'devnet'),
                transaction_signature text not null unique,
                payer_wallet text not null,
                commitment text not null,
                slot bigint,
                block_time bigint,
                status text not null default 'verified' check (status = 'verified'),
                created_at timestamptz not null default timezone('utc', now()),
                verified_at timestamptz not null default timezone('utc', now()),
                unique (resource_key, verify_hash),
                constraint payments_verify_hash_hex check (verify_hash ~ '^[0-9a-f]{64}$')
            );
        """)
        conn.execute("""
            create index if not exists payments_resource_idx
                on public.payments (resource_key, verify_hash)
                where status = 'verified';
        """)


def _init_ledger() -> None:
    global _ledger_ready, _ledger_backend
    if _ledger_ready:
        return
    if DATABASE_URL and psycopg is not None:
        try:
            _ensure_postgres_schema()
            _ledger_backend = "postgres"
            _ledger_ready = True
            return
        except Exception as error:  # noqa: BLE001 - fall through to sqlite
            print(f"[paper_order] Postgres init failed, falling back to SQLite: {error}")
    _ensure_sqlite_schema()
    _ledger_backend = "sqlite"
    _ledger_ready = True


def ledger_status() -> dict:
    try:
        _init_ledger()
    except Exception as error:  # noqa: BLE001
        return {"backend": None, "reason": str(error)}
    return {"backend": _ledger_backend, "sqlite_path": SQLITE_PATH,
            "reason": None if _ledger_backend else "ledger not initialised"}


def _row_to_dict(row: Any) -> dict:
    if isinstance(row, dict):
        return {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in row.items()}
    if isinstance(row, sqlite3.Row):
        return {k: row[k] for k in row.keys()}
    return dict(row) if row else {}


def get_verified(resource_key: str, verify_hash_hex: str) -> dict | None:
    _init_ledger()
    if _ledger_backend == "postgres":
        with psycopg.connect(DATABASE_URL, connect_timeout=10) as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute(
                    "select * from public.payments where resource_key = %s "
                    "and verify_hash = %s and status = 'verified'",
                    (resource_key, verify_hash_hex),
                )
                row = cur.fetchone()
                return _row_to_dict(row) if row else None
    with sqlite3.connect(SQLITE_PATH, timeout=10) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT * FROM payments WHERE resource_key = ? AND verify_hash = ? "
            "AND status = 'verified'",
            (resource_key, verify_hash_hex),
        ).fetchone()
        return _row_to_dict(row) if row else None


def record_verified(payment: VerifiedPayment) -> dict:
    """Idempotent — the same tx signature on the same resource returns the
    existing row rather than raising. A conflict on the signature or resource
    with different bindings raises PaymentError."""
    _init_ledger()

    if _ledger_backend == "postgres":
        with psycopg.connect(DATABASE_URL, connect_timeout=10, autocommit=False) as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute("""
                    insert into public.payments (
                        resource_key, caller_id, verify_hash, expected_memo,
                        expected_amount_base_units, expected_mint,
                        expected_recipient, network, transaction_signature,
                        payer_wallet, commitment, slot, block_time
                    ) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    on conflict do nothing returning *
                """, (
                    payment.resource_key, payment.caller_id, payment.verify_hash,
                    payment.expected_memo, payment.expected_amount_base_units,
                    payment.expected_mint, payment.expected_recipient,
                    payment.network, payment.transaction_signature,
                    payment.payer_wallet, payment.commitment,
                    payment.slot, payment.block_time,
                ))
                inserted = cur.fetchone()
                if inserted is not None:
                    conn.commit()
                    return _row_to_dict(inserted)

                cur.execute("""
                    select * from public.payments
                    where transaction_signature = %s
                       or (resource_key = %s and verify_hash = %s)
                """, (payment.transaction_signature, payment.resource_key,
                      payment.verify_hash))
                existing = cur.fetchone()
                conn.commit()
                if existing is None:
                    raise PaymentError("Ledger insert conflict could not be resolved.")
                existing_dict = _row_to_dict(existing)
                same = (existing_dict.get("resource_key") == payment.resource_key
                        and existing_dict.get("verify_hash") == payment.verify_hash
                        and existing_dict.get("transaction_signature") == payment.transaction_signature)
                if not same:
                    raise PaymentError(
                        "This transaction signature or resource is already bound "
                        "to a different verified payment. Reuse is not allowed.")
                return existing_dict

    # SQLite fallback path
    with sqlite3.connect(SQLITE_PATH, timeout=10) as conn:
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("BEGIN IMMEDIATE")
            by_sig = conn.execute(
                "SELECT * FROM payments WHERE transaction_signature = ?",
                (payment.transaction_signature,),
            ).fetchone()
            if by_sig:
                if (by_sig["resource_key"] != payment.resource_key
                        or by_sig["verify_hash"] != payment.verify_hash):
                    raise PaymentError("Transaction signature is already bound to another payment.")
                conn.commit()
                return _row_to_dict(by_sig)

            by_res = conn.execute(
                "SELECT * FROM payments WHERE resource_key = ? AND verify_hash = ?",
                (payment.resource_key, payment.verify_hash),
            ).fetchone()
            if by_res:
                if by_res["transaction_signature"] != payment.transaction_signature:
                    raise PaymentError("This resource already has a different verified payment.")
                conn.commit()
                return _row_to_dict(by_res)

            cur = conn.execute("""
                INSERT INTO payments (
                    resource_key, caller_id, verify_hash, expected_memo,
                    expected_amount_base_units, expected_mint, expected_recipient,
                    network, transaction_signature, payer_wallet, commitment,
                    slot, block_time, status
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'verified')
            """, (
                payment.resource_key, payment.caller_id, payment.verify_hash,
                payment.expected_memo, payment.expected_amount_base_units,
                payment.expected_mint, payment.expected_recipient,
                payment.network, payment.transaction_signature,
                payment.payer_wallet, payment.commitment,
                payment.slot, payment.block_time,
            ))
            conn.commit()
            row = conn.execute("SELECT * FROM payments WHERE id = ?",
                               (cur.lastrowid,)).fetchone()
            return _row_to_dict(row)
        except sqlite3.Error as error:
            conn.rollback()
            raise PaymentError(f"Ledger write failed: {error}") from error


def recent_payments(limit: int = 50) -> list[dict]:
    _init_ledger()
    limit = max(1, min(limit, 200))
    if _ledger_backend == "postgres":
        with psycopg.connect(DATABASE_URL, connect_timeout=10) as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute("select * from public.payments order by created_at desc limit %s", (limit,))
                return [_row_to_dict(r) for r in cur.fetchall()]
    with sqlite3.connect(SQLITE_PATH, timeout=10) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute("SELECT * FROM payments ORDER BY created_at DESC LIMIT ?",
                            (limit,)).fetchall()
        return [_row_to_dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Paper-order creation — the final step, after payment verified
# ---------------------------------------------------------------------------

def resource_key_for(sid: str, asset_id: str, notional_usd: float) -> str:
    """Deterministic per (session, asset, amount). Reusing the same triple
    returns the same paper order, so a double-click never charges twice."""
    return f"session:{sid}:asset:{asset_id.lower()}:usd:{notional_usd:.2f}"


def create_paper_order(analysis: dict, asset_id: str, notional_usd: float,
                       payment_record: dict) -> dict:
    """Turn a verified payment + a candidate + a live price into a receipt.
    No trade is executed. No cryptocurrency is purchased or transferred."""

    asset_id = asset_id.lower().strip()
    if not asset_id:
        raise PaymentError("asset_id is required.")

    try:
        prices = crypto_market.price([asset_id])
    except crypto_market.CryptoError as error:
        raise PaymentError(
            f"Could not fetch live reference price for {asset_id}: {error}") from error

    price_row = prices.get(asset_id) or {}
    reference_price = price_row.get("usd")
    if not reference_price:
        raise PaymentError(f"CoinGecko has no live price for asset id '{asset_id}'.")

    quantity = float(notional_usd) / float(reference_price)
    now = datetime.now(timezone.utc).isoformat()

    return {
        "status": "paper_order_created",
        "execution_mode": "simulated",
        "order_id": f"paper_{uuid.uuid4().hex[:16]}",
        "created_at": now,
        "asset_id": asset_id,
        "notional_usd": float(notional_usd),
        "reference_price_usd": float(reference_price),
        "reference_price_source": "coingecko",
        "reference_price_at": now,
        "simulated_quantity": quantity,
        "verify_hash": payment_record.get("verify_hash"),
        "payment_transaction_signature": payment_record.get("transaction_signature"),
        "payment_slot": payment_record.get("slot"),
        "payment_block_time": payment_record.get("block_time"),
        "payment_network": payment_record.get("network"),
        "explorer_url": (
            f"https://explorer.solana.com/tx/{payment_record.get('transaction_signature')}?cluster={NETWORK}"
            if payment_record.get("transaction_signature") else None
        ),
        "disclaimer": (
            "No cryptocurrency was purchased, sold, held, or transferred. "
            "This is a simulated paper order. This is not investment advice "
            "under Malaysian securities regulation."
        ),
    }
