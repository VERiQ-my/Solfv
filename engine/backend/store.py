"""Supabase persistence — the audit history, and deliberately nothing more.

SOLFV's privacy claim is architectural: documents are processed in memory and
purged on a timer, so there is nothing to breach. Persisting the uploaded PDF,
the rendered page images, or any detected personal data would falsify that
claim, so this module cannot do it — there is no code path here that writes a
document, an image, or a PII value.

What it does write is the *reconciled result*: canonical financial figures from
a published annual report, the check outcomes, and the derived ratios. That is
public filing data plus our own arithmetic. It gives finance a record of what
was analysed and what the engine concluded, which survives the session TTL.

Every call fails soft. If Supabase is unreachable, misconfigured, or rejects a
row, the analysis still returns — persistence is a convenience, never a
dependency of the pipeline.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

try:
    import psycopg
    from psycopg import sql
    from psycopg.rows import dict_row
    from psycopg.types.json import Jsonb
except ImportError:
    psycopg = None
    sql = None
    dict_row = None
    Jsonb = None

# Accept both the plain host and the REST endpoint, since either is a
# reasonable thing to paste out of the Supabase dashboard.
_RAW_URL = (os.getenv("SUPABASE_URL") or os.getenv("SUPABASE_API_URL") or "").strip()
KEY = (os.getenv("SUPABASE_SERVICE_KEY") or os.getenv("SUPABASE_ANON_KEY") or "").strip()
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()

TABLE = os.getenv("SUPABASE_TABLE", "analyses")
TIMEOUT = int(os.getenv("SUPABASE_TIMEOUT", "10"))

if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", TABLE):
    raise ValueError("SUPABASE_TABLE must be a simple PostgreSQL table name.")


def _rest_base(raw: str) -> str:
    if not raw:
        return ""
    base = raw.rstrip("/")
    if not base.endswith("/rest/v1"):
        base += "/rest/v1"
    return base


REST = _rest_base(_RAW_URL)


def configured() -> bool:
    return bool(DATABASE_URL and psycopg) or bool(REST and KEY)


def _mode() -> str | None:
    """Use direct server-side PostgreSQL when DATABASE_URL is configured."""
    if DATABASE_URL and psycopg:
        return "postgresql"
    if REST and KEY:
        return "supabase_rest"
    return None


def status() -> dict:
    return {
        "configured": configured(),
        "connection": _mode(),
        "table": TABLE,
        "stores": "reconciled analysis results only",
        "never_stores": ["uploaded documents", "page images", "personal data"],
    }


def _request(method: str, path: str, body: object | None = None,
             extra_headers: dict | None = None) -> tuple[int, object]:
    headers = {
        "apikey": KEY,
        "Authorization": f"Bearer {KEY}",
        "Content-Type": "application/json",
        **(extra_headers or {}),
    }
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(
        f"{REST}{path}", data=data, headers=headers, method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            raw = response.read().decode("utf-8") or "null"
            return response.status, json.loads(raw)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:500]
        return error.code, detail
    except Exception as error:  # noqa: BLE001 - DNS, TLS, timeout: all non-fatal
        return 0, str(error)


# ---------------------------------------------------------------------------
# Direct PostgreSQL (DATABASE_URL)
# ---------------------------------------------------------------------------

_JSON_COLUMNS = {
    "ratios", "prior_ratios", "checks", "line_items", "say_do_gap", "benchmark",
}


def _db_row(row: dict) -> dict:
    """Wrap structured payloads so PostgreSQL receives JSONB values."""
    if Jsonb is None:
        return row
    return {key: Jsonb(value) if key in _JSON_COLUMNS else value for key, value in row.items()}


def _connection():
    if psycopg is None:
        raise RuntimeError("psycopg is not installed; install engine requirements.")
    return psycopg.connect(DATABASE_URL, connect_timeout=TIMEOUT, autocommit=True)


def _json_safe(value: object) -> object:
    """Convert UUID/timestamp values from psycopg into API-safe JSON values."""
    return json.loads(json.dumps(value, default=str))


def _direct_save(row: dict) -> dict:
    columns = tuple(row)
    statement = sql.SQL("INSERT INTO {} ({}) VALUES ({}) RETURNING id, created_at").format(
        sql.Identifier("public", TABLE),
        sql.SQL(", " ).join(map(sql.Identifier, columns)),
        sql.SQL(", " ).join(sql.Placeholder() for _ in columns),
    )
    try:
        with _connection() as connection, connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(statement, tuple(_db_row(row).values()))
            saved = cursor.fetchone() or {}
        return {"saved": True, "id": str(saved.get("id")) if saved.get("id") else None,
                "created_at": saved.get("created_at").isoformat()
                if saved.get("created_at") else None}
    except Exception as error:  # noqa: BLE001 - persistence must fail soft
        return {"saved": False, "reason": f"PostgreSQL write failed: {error}"}


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------

def _row(result: dict, record: dict, ledger: dict | None, owner_id: str) -> dict:
    """Flatten one analysis into the audit row.

    Note what is absent: no file, no page image path, no ledger entries. The
    ledger contributes two integers — how many entities were detected and how
    many were transmitted — because the counts are the claim and the values are
    the exposure.
    """
    summary = result.get("summary") or {}
    trust = summary.get("trust") or {}
    risk = result.get("risk") or {}
    ledger = ledger or {}

    return {
        "owner_id": owner_id,
        "session_id": record.get("session_id"),
        "document_name": record.get("document"),
        "source": record.get("source"),
        "entity": result.get("entity"),
        "period": result.get("period"),
        "prior_period": result.get("prior_period"),
        "ticker": result.get("ticker"),
        "currency": result.get("currency"),
        "unit": result.get("unit"),
        "pages_total": record.get("pages_total"),

        "checks_passed": summary.get("checks_passed"),
        "checks_failed": summary.get("checks_failed"),
        "checks_unverifiable": summary.get("checks_unverifiable"),
        "line_item_count": summary.get("line_item_count"),
        "trust_verified": trust.get("VERIFIED"),
        "trust_derived": trust.get("DERIVED"),
        "trust_unverified": trust.get("UNVERIFIED"),
        "quarantined": result.get("quarantined") or [],

        "risk_score": risk.get("score"),
        "risk_zone": risk.get("zone"),
        "risk_variant": risk.get("variant"),

        "ratios": result.get("ratios") or {},
        "prior_ratios": result.get("prior_ratios") or {},
        "checks": result.get("checks") or [],
        "line_items": result.get("line_items") or [],
        "say_do_gap": result.get("say_do_gap") or [],
        "benchmark": result.get("benchmark") or [],

        # Counts only. The ledger never holds a raw match, and neither does this.
        "pii_detected": ledger.get("detected"),
        "pii_transmitted": ledger.get("transmitted"),
        "pages_transmitted": ledger.get("pages_transmitted"),
    }


def save(result: dict, record: dict, ledger: dict | None = None, owner_id: str = "") -> dict:
    """Persist one reconciled analysis. Never raises."""
    if not owner_id:
        return {"saved": False, "reason": "Analysis owner is missing."}
    if _mode() == "postgresql":
        return _direct_save(_row(result, record, ledger, owner_id))
    if not configured():
        return {"saved": False, "reason": "Supabase is not configured."}

    code, body = _request(
        "POST", f"/{TABLE}", [_row(result, record, ledger, owner_id)],
        {"Prefer": "return=representation"},
    )
    if code in (200, 201):
        row = body[0] if isinstance(body, list) and body else {}
        return {"saved": True, "id": row.get("id"), "created_at": row.get("created_at")}
    return {"saved": False, "reason": f"Supabase returned {code}: {body}"}


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------

_LIST_COLUMNS = (
    "id,created_at,entity,period,ticker,document_name,source,pages_total,"
    "checks_passed,checks_failed,checks_unverifiable,line_item_count,"
    "trust_verified,trust_derived,trust_unverified,quarantined,"
    "risk_score,risk_zone,risk_variant,ratios,pii_detected,pii_transmitted"
)


def _direct_history(limit: int, owner_id: str) -> dict:
    try:
        with _connection() as connection, connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                sql.SQL("SELECT {} FROM {} WHERE owner_id = %s ORDER BY created_at DESC LIMIT %s").format(
                    sql.SQL(", " ).join(map(sql.Identifier, _LIST_COLUMNS.split(","))),
                    sql.Identifier("public", TABLE),
                ),
                (owner_id, limit),
            )
            rows = cursor.fetchall()
        return {"available": True, "rows": _json_safe(rows)}
    except Exception as error:  # noqa: BLE001 - dashboard remains non-blocking
        return {"available": False, "rows": [], "reason": f"PostgreSQL read failed: {error}"}


def _direct_get(row_id: str, owner_id: str) -> dict | None:
    try:
        with _connection() as connection, connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(sql.SQL("SELECT * FROM {} WHERE id = %s AND owner_id = %s LIMIT 1").format(
                sql.Identifier("public", TABLE)), (row_id, owner_id))
            return _json_safe(cursor.fetchone())
    except Exception:  # noqa: BLE001 - callers treat unavailable as not found
        return None


def _direct_ping() -> dict:
    try:
        with _connection() as connection, connection.cursor() as cursor:
            cursor.execute(sql.SQL("SELECT id FROM {} LIMIT 1").format(
                sql.Identifier("public", TABLE)))
        return {"ok": True}
    except Exception as error:  # noqa: BLE001
        return {"ok": False, "reason": f"PostgreSQL unavailable: {error}"}


def history(limit: int = 50, owner_id: str = "") -> dict:
    """Recent analyses, newest first. Summary columns only — the heavy JSONB
    payloads are fetched per row on demand."""
    if not owner_id:
        return {"available": False, "rows": [], "reason": "Analysis owner is missing."}
    if _mode() == "postgresql":
        return _direct_history(limit, owner_id)
    if not configured():
        return {"available": False, "rows": [],
                "reason": "Supabase is not configured."}

    code, body = _request(
        "GET",
        f"/{TABLE}?select={_LIST_COLUMNS}&owner_id=eq.{urllib.parse.quote(owner_id, safe='')}&order=created_at.desc&limit={int(limit)}",
    )
    if code == 200 and isinstance(body, list):
        return {"available": True, "rows": body}
    return {"available": False, "rows": [],
            "reason": f"Supabase returned {code}: {body}"}


def get(row_id: str, owner_id: str = "") -> dict | None:
    if not owner_id:
        return None
    if _mode() == "postgresql":
        return _direct_get(row_id, owner_id)
    if not configured():
        return None
    code, body = _request("GET", f"/{TABLE}?id=eq.{urllib.parse.quote(row_id, safe='')}&owner_id=eq.{urllib.parse.quote(owner_id, safe='')}&select=*&limit=1")
    if code == 200 and isinstance(body, list) and body:
        return body[0]
    return None


def ping() -> dict:
    if _mode() == "postgresql":
        return _direct_ping()
    """Cheap connectivity probe for /health — confirms the table is reachable."""
    if not configured():
        if DATABASE_URL:
            return {"ok": False, "reason": "PostgreSQL driver is not installed."}
        return {"ok": False, "reason": "Supabase is not configured."}
    code, body = _request("GET", f"/{TABLE}?select=id&limit=1")
    if code == 200:
        return {"ok": True}
    if code == 404:
        return {"ok": False, "reason":
                f"Table {TABLE!r} does not exist. Run engine/schema.sql."}
    if code in (401, 403):
        return {"ok": False, "reason":
                "Supabase rejected the key. Check SUPABASE_ANON_KEY is the "
                "full JWT, and that the table's RLS policies allow it."}
    return {"ok": False, "reason": f"Supabase returned {code}: {body}"}
