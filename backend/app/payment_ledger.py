import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any

PAYMENT_STATUSES = {"verified"}


class PaymentConflictError(Exception):
    """Raised when a payment is already bound to another resource or hash."""


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


class PaymentLedger:
    def __init__(self, database_path: str) -> None:
        self.database_path = database_path
        self._ensure_parent_directory()
        self.initialize()

    def _ensure_parent_directory(self) -> None:
        path = Path(self.database_path)
        if str(path.parent) not in ("", "."):
            path.parent.mkdir(parents=True, exist_ok=True)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS payments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    resource_key TEXT NOT NULL,
                    caller_id TEXT,
                    verify_hash TEXT NOT NULL,
                    expected_memo TEXT NOT NULL,
                    expected_amount_base_units INTEGER NOT NULL CHECK (expected_amount_base_units > 0),
                    expected_mint TEXT NOT NULL,
                    expected_recipient TEXT NOT NULL,
                    network TEXT NOT NULL,
                    transaction_signature TEXT NOT NULL UNIQUE,
                    payer_wallet TEXT NOT NULL,
                    commitment TEXT NOT NULL,
                    slot INTEGER,
                    block_time INTEGER,
                    status TEXT NOT NULL CHECK (status IN ('verified')),
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE (resource_key, verify_hash)
                );
                CREATE INDEX IF NOT EXISTS idx_payments_resource
                    ON payments (resource_key, verify_hash, status);
                """
            )

    def get_verified(self, resource_key: str, verify_hash: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT * FROM payments
                WHERE resource_key = ? AND verify_hash = ? AND status = 'verified'
                """,
                (resource_key, verify_hash),
            ).fetchone()
        return dict(row) if row else None

    def record_verified(self, payment: VerifiedPayment) -> dict[str, Any]:
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            by_signature = connection.execute(
                "SELECT * FROM payments WHERE transaction_signature = ?",
                (payment.transaction_signature,),
            ).fetchone()
            if by_signature:
                if (
                    by_signature["resource_key"] != payment.resource_key
                    or by_signature["verify_hash"] != payment.verify_hash
                ):
                    raise PaymentConflictError("transaction signature is bound to another resource")
                connection.commit()
                return dict(by_signature)

            by_resource = connection.execute(
                """
                SELECT * FROM payments
                WHERE resource_key = ? AND verify_hash = ?
                """,
                (payment.resource_key, payment.verify_hash),
            ).fetchone()
            if by_resource:
                if by_resource["transaction_signature"] != payment.transaction_signature:
                    raise PaymentConflictError("resource already has a different verified payment")
                connection.commit()
                return dict(by_resource)

            cursor = connection.execute(
                """
                INSERT INTO payments (
                    resource_key, caller_id, verify_hash, expected_memo,
                    expected_amount_base_units, expected_mint, expected_recipient,
                    network, transaction_signature, payer_wallet, commitment,
                    slot, block_time, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified')
                """,
                (
                    payment.resource_key,
                    payment.caller_id,
                    payment.verify_hash,
                    payment.expected_memo,
                    payment.expected_amount_base_units,
                    payment.expected_mint,
                    payment.expected_recipient,
                    payment.network,
                    payment.transaction_signature,
                    payment.payer_wallet,
                    payment.commitment,
                    payment.slot,
                    payment.block_time,
                ),
            )
            connection.commit()
            row = connection.execute(
                "SELECT * FROM payments WHERE id = ?", (cursor.lastrowid,)
            ).fetchone()
            return dict(row)
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()
