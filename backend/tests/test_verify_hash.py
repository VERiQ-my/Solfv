import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from app.verify_hash import (  # noqa: E402
    CANONICALIZATION_VERSION,
    canonicalize_verify_result,
    payment_memo_for_verify_result,
    verify_result_sha256,
)


def test_key_order_does_not_change_hash() -> None:
    first = {"period": "2025", "value": 100, "currency": "MYR"}
    second = {"currency": "MYR", "value": 100, "period": "2025"}

    assert verify_result_sha256(first) == verify_result_sha256(second)


def test_hash_fixture_and_memo_format() -> None:
    result = {"value": 123.45, "currency": "MYR", "period": "FY2025"}

    assert canonicalize_verify_result(result) == (
        b'{"currency":"MYR","period":"FY2025","value":123.45}'
    )
    assert verify_result_sha256(result) == (
        "bad6319bdae71b0613bf0f5e2ab89874e7ffcc7f70a7d4eb9da0e64abe4dd7fa"
    )
    assert payment_memo_for_verify_result(result).startswith("solfv:v1:")
    assert len(payment_memo_for_verify_result(result).encode("utf-8")) == 73
    assert CANONICALIZATION_VERSION == "json-sorted-compact-utf8-v1"


def test_nan_is_rejected() -> None:
    try:
        canonicalize_verify_result({"value": float("nan")})
    except ValueError:
        pass
    else:
        raise AssertionError("NaN must not enter an audit hash")
