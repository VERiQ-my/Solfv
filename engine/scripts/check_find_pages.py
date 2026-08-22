"""Validate the spec 5.1 find_pages() keyword targeting on the real reports.

DoD (spec 14): "find_pages() locates all four sections in the real 150pg
report". This script is that check, and it exists in scripts/ rather than
backend/ so the Data lane can hand Backend a verified matcher plus a known-good
fallback list instead of a code sketch.

    python scripts/check_find_pages.py

Reports 1-BASED PDF pages, matching fixtures/mock_extraction.json.
"""

from __future__ import annotations

import pathlib
import re
import sys

import pdfplumber

ROOT = pathlib.Path(__file__).resolve().parents[1]

SECTION_PATTERNS = {
    "balance_sheet": ["statements of financial position", "statement of financial position",
                      "balance sheet"],
    "income":        ["statements of profit or loss", "statement of profit or loss",
                      "statements of comprehensive income", "statement of comprehensive income"],
    "cashflow":      ["statements of cash flows", "statement of cash flows"],
    "narrative":     ["chairman's statement", "chairman’s statement", "management discussion",
                      "md&a", "chief executive", "management's discussion"],
}

# The spec suggests requiring an RM'000 header to filter table-of-contents
# false positives. Seacera prints in full ringgit, so that filter would reject
# every real statement page. Require a MONEY COLUMN HEADER instead - a currency
# unit next to a pair of year headings - which holds for both conventions.
CURRENCY = re.compile(r"\brm\s*[’']?\s*(000)?\b", re.I)
YEAR_PAIR = re.compile(r"\b(19|20)\d{2}\b.{0,40}\b(19|20)\d{2}\b", re.S)

# Table-of-contents pages match every pattern at once. A real statement page
# matches one or two.
TOC_MATCH_LIMIT = 3


def find_pages(pdf_path: pathlib.Path, head_chars: int = 1500) -> dict[str, list[int]]:
    hits: dict[str, list[int]] = {k: [] for k in SECTION_PATTERNS}
    with pdfplumber.open(pdf_path) as pdf:
        page_texts = [(p.extract_text() or "") for p in pdf.pages]

    for n, text in enumerate(page_texts):
        head = text.lower()[:head_chars]
        matched = [s for s, pats in SECTION_PATTERNS.items() if any(p in head for p in pats)]
        if len(matched) >= TOC_MATCH_LIMIT:
            continue  # contents / index page
        for section in matched:
            if section == "narrative":
                hits[section].append(n + 1)
                continue
            # Statement pages must actually carry a money column.
            if CURRENCY.search(text) and YEAR_PAIR.search(text):
                hits[section].append(n + 1)

    # Statements run across a two-page spread; take the next page too.
    for section, pages in hits.items():
        if section == "narrative":
            continue
        widened = sorted({p for n in pages for p in (n, n + 1)})
        hits[section] = widened
    return hits


def main() -> None:
    pdfs = sorted(ROOT.glob("*.pdf"))
    if not pdfs:
        sys.exit("no PDFs found in the repo root")

    for pdf_path in pdfs:
        print("=" * 74)
        print(pdf_path.name)
        with pdfplumber.open(pdf_path) as pdf:
            total = len(pdf.pages)
        hits = find_pages(pdf_path)
        for section, pages in hits.items():
            status = "OK  " if pages else "MISS"
            print(f"  [{status}] {section:14} {pages[:12]}"
                  + (" ..." if len(pages) > 12 else ""))
        found = sum(1 for p in hits.values() if p)
        targeted = len({p for pages in hits.values() for p in pages})
        print(f"  -> {found}/4 sections located; {targeted} of {total} pages "
              f"targeted ({targeted / total:.0%} of the document)")


if __name__ == "__main__":
    main()
