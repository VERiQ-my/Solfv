"""Section 5.1 (11:30-12:45) - page images to Contract 1.

The prompts are the Data lane's and are imported, never retyped. This module
owns only the transport: call the extraction model, parse strictly, retry once,
and validate. Provider failures are returned for the uploaded document; they
never become a hand-transcribed fixture.

DeepSeek's current API accepts the native text extracted from a PDF. The
provider call therefore receives only the locally redacted text of the pages
targeted by ``pages.py``; it never receives a fixture in place of an upload.

Fixtures remain available only through the explicit demo endpoints. They are
never an insurance policy for a user's uploaded document.
"""

from __future__ import annotations

import json
import os
import pathlib
import urllib.error
import urllib.request

from analysis.prompts import (
    EXTRACTION_PROMPT,
    NARRATIVE_PROMPT,
    QUERY_ROUTER_PROMPT,
    parse_llm_json,
    validate_extraction,
)

ROOT = pathlib.Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "fixtures"

API_URL = os.getenv("DEEPSEEK_API_URL", "https://api.deepseek.com/chat/completions")
API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
EXTRACTION_MODEL = os.getenv("DEEPSEEK_EXTRACTION_MODEL", "deepseek-v4-flash")
TEXT_MODEL = os.getenv("DEEPSEEK_TEXT_MODEL", "deepseek-v4-flash")
TIMEOUT = int(os.getenv("DEEPSEEK_TIMEOUT", "90"))


def available() -> bool:
    return bool(API_KEY)


class ExtractionError(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# Transport
# ---------------------------------------------------------------------------

def _post(payload: dict) -> str:
    request = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:400]
        raise ExtractionError(f"DeepSeek returned {error.code}: {detail}") from error
    except Exception as error:  # noqa: BLE001 - network, DNS, timeout, all fatal here
        raise ExtractionError(f"DeepSeek call failed: {error}") from error

    try:
        return body["choices"][0]["message"]["content"]
    except (KeyError, IndexError) as error:
        raise ExtractionError("DeepSeek response had no message content") from error


def _call_extraction(prompt: str, document_text: str) -> str:
    """Extract from the attached document's native text, never a demo fixture."""
    return _post({
        "model": EXTRACTION_MODEL,
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": document_text},
        ],
        "temperature": 0,
    })


def _call_text(prompt: str, question: str) -> str:
    return _post({
        "model": TEXT_MODEL,
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": question},
        ],
        "temperature": 0,
    })


def _parse_with_retry(call, prompt, argument) -> dict:
    """One retry, as the spec allows - no more. A second failure is a real
    signal that the page is not what we think it is."""
    raw = call(prompt, argument)
    try:
        return parse_llm_json(raw)
    except ValueError:
        raw = call(prompt + "\n\nReturn STRICT JSON only. No prose, no code fence.",
                   argument)
        return parse_llm_json(raw)


# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------

def extract_text(statement_text: str, narrative_text: str = "") -> tuple[dict, list[str]]:
    """Run both passes over the attached PDF's locally redacted native text."""
    if not available():
        raise ExtractionError("DEEPSEEK_API_KEY is not set")

    if not statement_text.strip():
        raise ExtractionError("No financial-statement text was found in the targeted pages")

    doc = _parse_with_retry(_call_extraction, EXTRACTION_PROMPT, statement_text)

    warnings: list[str] = []
    if narrative_text.strip():
        try:
            narrative = _parse_with_retry(_call_extraction, NARRATIVE_PROMPT, narrative_text)
            doc["narrative_claims"] = narrative.get("narrative_claims") or []
        except (ExtractionError, ValueError) as error:
            # A missing narrative costs us the Say-Do Gap, not the dashboard.
            warnings.append(f"Narrative pass failed, Say-Do Gap will be empty: {error}")
            doc.setdefault("narrative_claims", [])

    doc, validation_warnings = validate_extraction(doc)
    return doc, warnings + list(validation_warnings)


def llm_router(question: str) -> dict:
    """Map a question to a lookup target. Returns {} so `resolve_query` falls
    back to its keyword router if the provider is down mid-demo."""
    if not available():
        return {}
    try:
        route = _parse_with_retry(
            lambda p, q: _call_text(p, q), QUERY_ROUTER_PROMPT, question
        )
    except (ExtractionError, ValueError):
        return {}
    return route if isinstance(route, dict) else {}


# ---------------------------------------------------------------------------
# Fixture fallback
# ---------------------------------------------------------------------------

FIXTURE_FILES: dict[str, str] = {
    "clean": "mock_extraction.json",
    "doctored": "mock_extraction_doctored.json",
}


def load_fixture(variant: str = "clean") -> dict:
    """The hand-transcribed extraction. Real figures, real pages, real bboxes."""
    name = FIXTURE_FILES.get(variant)
    if name is None:
        raise ExtractionError(f"Unknown fixture variant: {variant}")
    return json.loads((FIXTURES / name).read_text("utf-8"))


def load_peers() -> dict:
    """`analysis/` does no file I/O, so the caller loads this and passes it in."""
    try:
        return json.loads((FIXTURES / "sector_peers.json").read_text("utf-8"))
    except (OSError, ValueError):
        return {}


def load_demo_documents() -> dict:
    try:
        return json.loads((FIXTURES / "demo_documents.json").read_text("utf-8"))
    except (OSError, ValueError):
        return {}
