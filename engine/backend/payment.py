"""Section 8 - the Solana payment gate. BYPASSABLE, and bypassed by default.

Per-document metering for an API product: Experian sells per-query
decisioning, so "pay-per-report, settled on-chain, no subscription" is a
coherent business story. That is the pitch - not "we integrated Solana".

The gate defaults **off**. If devnet is congested, or the RPC rate-limits, or
the wallet extension will not connect on the demo laptop, the demo must not die
at step one with the reconciliation engine still unseen. An external network
dependency never sits upstream of the differentiation.
"""

from __future__ import annotations

import os
import time
import urllib.error
import urllib.request
import json

PAYMENT_REQUIRED = os.getenv("PAYMENT_REQUIRED", "false").lower() == "true"

RPC_URL = os.getenv("SOLANA_RPC_URL", "https://api.devnet.solana.com")
TREASURY = os.getenv("SOLANA_TREASURY", "")
CLUSTER = os.getenv("SOLANA_CLUSTER", "devnet")

PRICE_SOL = float(os.getenv("SEMAK_PRICE_SOL", "0.05"))
LAMPORTS_PER_SOL = 1_000_000_000

VERIFY_TIMEOUT = 10


def quote() -> dict:
    """What a report costs and where it settles. Safe to call with no wallet."""
    return {
        "required": PAYMENT_REQUIRED,
        "price_sol": PRICE_SOL,
        "price_lamports": int(PRICE_SOL * LAMPORTS_PER_SOL),
        "treasury": TREASURY or None,
        "cluster": CLUSTER,
        "rpc_url": RPC_URL,
        "model": "Per-document metering. No subscription, settled on-chain.",
    }


def _rpc(method: str, params: list) -> dict:
    request = urllib.request.Request(
        RPC_URL,
        data=json.dumps({"jsonrpc": "2.0", "id": 1,
                         "method": method, "params": params}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=VERIFY_TIMEOUT) as response:
        return json.loads(response.read().decode("utf-8"))


def verify(signature: str) -> dict:
    """Confirm a transaction landed. Never raises - a verification failure
    returns `paid: False` with a reason the UI can show."""
    if not PAYMENT_REQUIRED:
        return {"paid": True, "bypassed": True,
                "reason": "Payment gate is disabled (PAYMENT_REQUIRED=false)."}

    if not signature:
        return {"paid": False, "reason": "No transaction signature supplied."}

    try:
        body = _rpc("getSignatureStatuses", [[signature], {"searchTransactionHistory": True}])
    except (urllib.error.URLError, OSError, ValueError) as error:
        return {"paid": False, "reason": f"Could not reach the Solana RPC: {error}"}

    statuses = ((body.get("result") or {}).get("value") or [None])
    status = statuses[0] if statuses else None
    if status is None:
        return {"paid": False, "reason": "Transaction not found on chain yet."}
    if status.get("err"):
        return {"paid": False, "reason": f"Transaction failed on chain: {status['err']}"}

    confirmation = status.get("confirmationStatus")
    if confirmation not in ("confirmed", "finalized"):
        return {"paid": False, "reason": f"Transaction is only {confirmation!r}."}

    return {
        "paid": True,
        "bypassed": False,
        "signature": signature,
        "cluster": CLUSTER,
        "confirmation": confirmation,
        "verified_at": time.time(),
        "explorer": f"https://explorer.solana.com/tx/{signature}?cluster={CLUSTER}",
    }


def network() -> dict:
    """Live cluster state and treasury balance, read straight off the RPC.

    Everything here is either a real on-chain reading or an explicit null with
    the reason attached. There is deliberately no fallback figure: an invented
    treasury balance on a page about settlement would be the one number on this
    dashboard that nobody could trace.
    """
    result: dict = {
        "cluster": CLUSTER,
        "rpc_url": RPC_URL,
        "treasury": TREASURY or None,
        "reachable": False,
        "version": None,
        "slot": None,
        "balance_sol": None,
        "reason": None,
    }

    if not TREASURY:
        result["reason"] = (
            "SOLANA_TREASURY is not set, so there is no account to read a balance from."
        )

    try:
        version = _rpc("getVersion", [])
        result["version"] = (version.get("result") or {}).get("solana-core")

        slot = _rpc("getSlot", [])
        result["slot"] = slot.get("result")
        result["reachable"] = result["slot"] is not None

        if TREASURY:
            balance = _rpc("getBalance", [TREASURY])
            lamports = (balance.get("result") or {}).get("value")
            if isinstance(lamports, int):
                result["balance_sol"] = lamports / LAMPORTS_PER_SOL
            elif balance.get("error"):
                result["reason"] = str(balance["error"].get("message") or balance["error"])
    except (urllib.error.URLError, OSError, ValueError) as error:
        result["reason"] = f"Could not reach the Solana RPC: {error}"

    return result


def gate(session: dict) -> dict | None:
    """Return an error payload when a session may not be read, else None."""
    if not PAYMENT_REQUIRED or session.get("paid"):
        return None
    return {
        "payment_required": True,
        "quote": quote(),
        "message": "This report is metered. Settle the fee to unlock the analysis.",
    }
