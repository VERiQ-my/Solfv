from typing import Any

from .payment_ledger import PaymentConflictError, VerifiedPayment


class PostgresPaymentLedger:
    """PostgreSQL-backed payment ledger for the FastAPI service."""

    def __init__(self, database_url: str) -> None:
        if not database_url:
            raise ValueError("DATABASE_URL is required for the payment ledger")

        from psycopg_pool import ConnectionPool
        from psycopg.rows import dict_row

        self.pool = ConnectionPool(
            conninfo=database_url,
            min_size=0,
            max_size=5,
            timeout=10,
            open=False,
            kwargs={"prepare_threshold": None, "row_factory": dict_row, "connect_timeout": 5},
        )
        self.pool.open(wait=False)

    def get_verified(self, resource_key: str, verify_hash: str) -> dict[str, Any] | None:
        with self.pool.connection() as connection:
            row = connection.execute(
                """
                select * from public.payments
                where resource_key = %s and verify_hash = %s and status = 'verified'
                """,
                (resource_key, verify_hash),
            ).fetchone()
            if row is None:
                return None
            return self._row_to_dict(connection, row)

    def record_verified(self, payment: VerifiedPayment) -> dict[str, Any]:
        with self.pool.connection() as connection:
            with connection.transaction():
                row = connection.execute(
                    """
                    insert into public.payments (
                        resource_key, caller_id, verify_hash, expected_memo,
                        expected_amount_base_units, expected_mint, expected_recipient,
                        network, transaction_signature, payer_wallet, commitment,
                        slot, block_time
                    ) values (
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                    )
                    on conflict do nothing
                    returning *
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
                ).fetchone()
                if row is not None:
                    return self._row_to_dict(connection, row)

                existing = connection.execute(
                    """
                    select * from public.payments
                    where transaction_signature = %s
                       or (resource_key = %s and verify_hash = %s)
                    for update
                    """,
                    (payment.transaction_signature, payment.resource_key, payment.verify_hash),
                ).fetchone()
                if existing is None:
                    raise RuntimeError("payment insert conflict could not be resolved")

                existing_dict = self._row_to_dict(connection, existing)
                same_payment = (
                    existing_dict["resource_key"] == payment.resource_key
                    and existing_dict["verify_hash"] == payment.verify_hash
                    and existing_dict["transaction_signature"] == payment.transaction_signature
                )
                if not same_payment:
                    raise PaymentConflictError(
                        "transaction signature or resource is already bound to another payment"
                    )
                return existing_dict

    @staticmethod
    def _row_to_dict(connection: Any, row: Any) -> dict[str, Any]:
        return dict(row)

    def close(self) -> None:
        self.pool.close()
