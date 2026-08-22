"""Apply SOLFV's idempotent audit-history schema using DATABASE_URL."""

from __future__ import annotations

import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

try:
    import psycopg
except ImportError as error:
    raise SystemExit("psycopg is missing. Install engine requirements first.") from error

from backend import load_env

load_env()
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()


def main() -> int:
    if not DATABASE_URL:
        print("DATABASE_URL is not configured; no schema was applied.")
        return 2
    try:
        with psycopg.connect(DATABASE_URL) as connection:
            with connection.cursor() as cursor:
                cursor.execute((ROOT / "schema.sql").read_text("utf-8"))
        print("Database schema is up to date.")
        return 0
    except Exception as error:
        print(f"Database migration failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
