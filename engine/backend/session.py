"""Section 7 - the session store. There is no database, on purpose.

Documents live in a process-local dict and on disk under `tmp/{sid}/`, and both
are destroyed together when the TTL expires or the client calls DELETE. That is
a PDPA design decision we say out loud in the pitch: there is nothing to breach
because nothing is stored.

The countdown the UI renders comes from `expires_at` here, so ephemerality is
visible rather than merely claimed.
"""

from __future__ import annotations

import pathlib
import shutil
import threading
import time
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
TMP = ROOT / "tmp"

TTL_MINUTES = 60
TTL_SECONDS = TTL_MINUTES * 60

# Every mutation goes through this. Uvicorn runs endpoints in a threadpool, so
# a bare dict would be racing the sweeper.
_LOCK = threading.RLock()
SESSIONS: dict[str, dict] = {}


def _now() -> float:
    return time.time()


def new_session(**fields) -> dict:
    """Create a session and its scratch directory."""
    sid = uuid.uuid4().hex[:16]
    created = _now()
    record = {
        "session_id": sid,
        "created": created,
        "expires_at": created + TTL_SECONDS,
        "dir": str(TMP / sid),
        "extraction": None,
        "analysis": None,
        "privacy_ledger": [],
        "pdf_path": None,
        "page_images": {},
        "paid": False,
        **fields,
    }
    pathlib.Path(record["dir"]).mkdir(parents=True, exist_ok=True)
    with _LOCK:
        SESSIONS[sid] = record
    return record


def get(sid: str) -> dict | None:
    """Fetch a live session. An expired one is purged on read and reads as gone."""
    with _LOCK:
        record = SESSIONS.get(sid)
        if record is None:
            return None
        if record["expires_at"] <= _now():
            _purge(sid)
            return None
        return record


def update(sid: str, **fields) -> dict | None:
    with _LOCK:
        record = SESSIONS.get(sid)
        if record is None:
            return None
        record.update(fields)
        return record


def remaining(record: dict) -> int:
    """Whole seconds left before purge - what the UI counts down."""
    return max(0, int(record["expires_at"] - _now()))


def _purge(sid: str) -> bool:
    """Drop the record and delete its files. Caller holds the lock."""
    record = SESSIONS.pop(sid, None)
    if record is None:
        return False
    directory = pathlib.Path(record.get("dir") or "")
    # Never let a failed rmtree strand the record - the in-memory copy is the
    # part that actually holds document content.
    if directory.is_dir():
        shutil.rmtree(directory, ignore_errors=True)
    return True


def purge(sid: str) -> bool:
    with _LOCK:
        return _purge(sid)


def sweep() -> int:
    """Purge everything past its TTL. Returns how many went."""
    now = _now()
    with _LOCK:
        dead = [s for s, r in SESSIONS.items() if r["expires_at"] <= now]
        for sid in dead:
            _purge(sid)
    return len(dead)


def start_sweeper(interval: int = 60) -> threading.Thread:
    """Background TTL sweeper.

    Daemon thread: a stuck sweeper must never keep the process alive at the end
    of a demo. Expiry is also enforced on read in get(), so this is a
    disk-space measure rather than the correctness guarantee.
    """
    def loop() -> None:
        while True:
            time.sleep(interval)
            try:
                sweep()
            except Exception:  # noqa: BLE001 - a sweeper must never die
                pass

    thread = threading.Thread(target=loop, name="session-sweeper", daemon=True)
    thread.start()
    return thread


def stats() -> dict:
    with _LOCK:
        return {"active_sessions": len(SESSIONS), "ttl_minutes": TTL_MINUTES}
