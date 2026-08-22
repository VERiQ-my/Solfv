"""SOLFV backend.

Environment is loaded here, in the package __init__, because several submodules
read their configuration at import time. Loading it any later would mean
`store` and `extract` binding empty strings before the file is read.
"""

from __future__ import annotations

import os
import pathlib

# .env lives at the repository root, one level above engine/.
_ROOT = pathlib.Path(__file__).resolve().parents[2]


def load_env(path: pathlib.Path | None = None) -> dict[str, str]:
    """Read a .env file into os.environ without adding a dependency.

    Tolerates both `KEY=value` and the `KEY: 'value'` shape people paste out of
    a YAML snippet, because a config file that silently fails to parse is worse
    than one that accepts two spellings. Existing environment variables always
    win, so a real shell export overrides the file.
    """
    target = path or (_ROOT / ".env")
    loaded: dict[str, str] = {}
    try:
        text = target.read_text("utf-8")
    except (OSError, UnicodeDecodeError):
        return loaded

    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue

        if "=" in line and (":" not in line.split("=", 1)[0]):
            key, _, value = line.partition("=")
        elif ":" in line:
            key, _, value = line.partition(":")
        else:
            continue

        key = key.strip()
        value = value.strip().strip("'\"").strip()
        if not key or not value:
            continue

        loaded[key] = value
        os.environ.setdefault(key, value)

    return loaded


ENV = load_env()
