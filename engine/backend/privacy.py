"""Section 5.1 / handoff section 4 - the privacy gate.

Runs BEFORE any external API call. Personal data is detected and masked on the
machine; the ledger records what was found without ever recording the value.

Two traps the Data lane hit while testing this against the real report, both
guarded here:

1. A bare digit-run regex for bank accounts produced 42 hits, most of them
   fragments of balance-sheet figures (`76887517` came out of a total). Bank
   accounts therefore match only behind a context keyword.
2. Seacera's company registration number `198701005080 (163751-H)` appears 121
   times and looks NRIC-adjacent. It is a company identifier, not personal
   data, and `_COMPANY_REGISTRATION` explicitly clears it.

The honest headline is not the raw count. It is that the pages carrying
personal data are pages we never transmit - see `ledger()`.
"""

from __future__ import annotations

import re

# ---------------------------------------------------------------------------
# Patterns
# ---------------------------------------------------------------------------

PATTERNS: dict[str, re.Pattern] = {
    # 6-2-4 with the separators mandatory: an unseparated 12-digit run is
    # indistinguishable from a financial figure.
    "nric": re.compile(r"\b\d{6}-\d{2}-\d{4}\b"),
    "passport": re.compile(r"\b[AHK]\d{8}\b"),
    "phone": re.compile(r"(?:\+?60|0)[\s-]?1\d[\s-]?\d{3,4}[\s-]?\d{4}\b"),
    "email": re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b"),
    # Names are personal data under PDPA. Honorific-prefixed only - a bare
    # capitalised bigram would swallow half of every annual report.
    "person_name": re.compile(
        r"\b(?:Dato'|Dato’|Datuk|Tan Sri|Puan Sri|Encik|Puan)"
        r"\s+[A-Z][\w'’-]+(?:\s+[A-Z][\w'’-]+)*"
    ),
}

# Bank accounts need a context keyword within ~30 characters. Without this the
# pattern eats the balance sheet.
_BANK_CONTEXT = re.compile(
    r"(?:account\s*(?:no|number)|a/c|acct)\b.{0,30}?(\b\d[\d\s-]{6,}\d\b)",
    re.I | re.S,
)

# Malaysian company registration: 12 digits, optionally followed by the old
# `(163751-H)` form. Cleared before NRIC matching so it can never be masked.
_COMPANY_REGISTRATION = re.compile(r"\b\d{12}\s*(?:\(\s*\d{4,7}-[A-Z]\s*\))?")

ENTITY_TYPES: tuple[str, ...] = (
    "nric", "passport", "phone", "email", "bank_account", "person_name",
)

_LABELS: dict[str, str] = {
    "nric": "NRIC",
    "passport": "Passport number",
    "phone": "Mobile number",
    "email": "Email address",
    "bank_account": "Bank account number",
    "person_name": "Personal name",
}

_MASKS: dict[str, str] = {
    "nric": "[NRIC REDACTED]",
    "passport": "[PASSPORT REDACTED]",
    "phone": "[PHONE REDACTED]",
    "email": "[EMAIL REDACTED]",
    "bank_account": "[ACCOUNT REDACTED]",
    "person_name": "[NAME REDACTED]",
}


def label_for(entity_type: str) -> str:
    return _LABELS.get(entity_type, entity_type)


# ---------------------------------------------------------------------------
# Detection
# ---------------------------------------------------------------------------

def _spans(text: str) -> list[tuple[int, int, str]]:
    """Every PII span in one page of text, as (start, end, entity_type).

    Company registration numbers are blanked to spaces first - same offsets, so
    the spans stay valid against the original string, but nothing downstream
    can match inside them.
    """
    if not text:
        return []

    scannable = _COMPANY_REGISTRATION.sub(lambda m: " " * len(m.group(0)), text)

    found: list[tuple[int, int, str]] = []
    for entity_type, pattern in PATTERNS.items():
        for match in pattern.finditer(scannable):
            found.append((match.start(), match.end(), entity_type))

    for match in _BANK_CONTEXT.finditer(scannable):
        found.append((match.start(1), match.end(1), "bank_account"))

    # Overlaps resolve longest-first so a name inside an email loses.
    found.sort(key=lambda s: (s[0], -(s[1] - s[0])))
    merged: list[tuple[int, int, str]] = []
    cursor = -1
    for start, end, entity_type in found:
        if start >= cursor:
            merged.append((start, end, entity_type))
            cursor = end
    return merged


def scan_page(text: str, page: int) -> list[dict]:
    """Ledger entries for one page. Never carries the matched value."""
    counts: dict[str, int] = {}
    for _, _, entity_type in _spans(text):
        counts[entity_type] = counts.get(entity_type, 0) + 1
    return [
        {"entity_type": entity_type, "label": label_for(entity_type),
         "count": count, "page": page}
        for entity_type, count in sorted(counts.items())
    ]


def mask_text(text: str) -> tuple[str, list[dict]]:
    """Redact every span. Returns the masked text and this page's entries."""
    spans = _spans(text)
    if not spans:
        return text, []

    out = []
    cursor = 0
    counts: dict[str, int] = {}
    for start, end, entity_type in spans:
        out.append(text[cursor:start])
        out.append(_MASKS[entity_type])
        counts[entity_type] = counts.get(entity_type, 0) + 1
        cursor = end
    out.append(text[cursor:])

    entries = [
        {"entity_type": entity_type, "label": label_for(entity_type),
         "count": count, "page": None}
        for entity_type, count in sorted(counts.items())
    ]
    return "".join(out), entries


# ---------------------------------------------------------------------------
# The ledger
# ---------------------------------------------------------------------------

def ledger(page_texts: dict[int, str], transmitted_pages: list[int] | None = None) -> dict:
    """Build the privacy ledger for a whole document.

    `page_texts` is {1-based page number: text}; `transmitted_pages` is the
    handful of pages that will actually be sent to the vision model.

    The architectural claim lives in `transmitted`: we target only the pages
    carrying the financial statements, so personal data sitting on the other
    170 pages is never transmitted at all. Zero transmitted is a property of
    the page-targeting architecture, not a policy we promise to honour.
    """
    transmitted = set(transmitted_pages or [])

    entries: list[dict] = []
    for page in sorted(page_texts):
        entries.extend(scan_page(page_texts[page], page))

    by_type: dict[str, dict] = {}
    for entry in entries:
        bucket = by_type.setdefault(entry["entity_type"], {
            "entity_type": entry["entity_type"],
            "label": entry["label"],
            "count": 0,
            "transmitted": 0,
            "pages": [],
        })
        bucket["count"] += entry["count"]
        bucket["pages"].append(entry["page"])
        if entry["page"] in transmitted:
            bucket["transmitted"] += entry["count"]

    summary = sorted(by_type.values(), key=lambda b: -b["count"])
    detected = sum(b["count"] for b in summary)
    sent = sum(b["transmitted"] for b in summary)

    return {
        "entries": entries,
        "summary": summary,
        "detected": detected,
        "masked": detected,
        "transmitted": sent,
        "pages_scanned": len(page_texts),
        "pages_transmitted": len(transmitted),
    }


def empty_ledger() -> dict:
    """The shape the UI expects when there is no document text to scan."""
    return {
        "entries": [], "summary": [], "detected": 0, "masked": 0,
        "transmitted": 0, "pages_scanned": 0, "pages_transmitted": 0,
    }
