import hashlib
import json
from typing import Any

CANONICALIZATION_VERSION = "json-sorted-compact-utf8-v1"
MEMO_PREFIX = "solfv:v1:"


def canonicalize_verify_result(result: Any) -> bytes:
    """Serialize a Verify result into stable UTF-8 bytes for hashing."""
    serialized = json.dumps(
        result,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )
    return serialized.encode("utf-8")


def verify_result_sha256(result: Any) -> str:
    return hashlib.sha256(canonicalize_verify_result(result)).hexdigest()


def payment_memo_for_verify_result(result: Any) -> str:
    return f"{MEMO_PREFIX}{verify_result_sha256(result)}"
