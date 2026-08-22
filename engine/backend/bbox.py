"""
5.1 - reverse lookup, value -> coordinates.

Thirty lines of word matching gives pixel-accurate highlights with no layout
model. It is also the single mechanism behind differentiator #2, so the three
edge cases below are worth the extra twenty.

A miss returns None, which becomes trust = UNVERIFIED downstream. That is a
real signal and must never be papered over: a figure we cannot point at in the
source is a figure we cannot vouch for.

    python backend/bbox.py            # verify against the committed fixture

Coordinates are pdfplumber page coordinates, [x0, top, x1, bottom], and pages
are 1-BASED.
"""

from __future__ import annotations

import json
import pathlib
import sys

import pdfplumber

ROOT = pathlib.Path(__file__).resolve().parents[1]

# How far either side of the stated page to look if a value is not where the
# model said it was. Statements run across spreads and the model sometimes
# reports the first page of the spread for a figure printed on the second.
# The stated page is always searched FIRST, so a neighbour only wins when the
# stated page has no match at all.
SEARCH_RADIUS = 1


def _normalise(text: str) -> str:
    text = text.strip().strip("()").replace(",", "").replace(" ", "")
    if text.endswith(".00"):
        text = text[:-3]
    return text


def find_bbox(page, value: float) -> list[float] | None:
    """Coordinates of `value` on `page`, or None.

    Three things the naive version gets wrong on a real annual report:

    1. ROTATED TEXT. A statement of changes in equity is often printed
       sideways. pdfplumber returns those words with upright=False and the
       characters REVERSED - "081,617,63" for 36,716,180 - so a forward-only
       comparison misses every figure on the page. Hence the [::-1] test.

    2. FOUR NUMERIC COLUMNS. These statements print Group 2024 | Group 2023 |
       Company 2024 | Company 2023. Returning the first match can hand back the
       Company column. The Group current year is leftmost, so take min(x0).

    3. SIGNS AND BRACKETS. Costs print as "(46,323,659)". Match on magnitude
       and let the extraction carry the sign.
    """
    target = str(int(abs(value)))
    hits: list[list[float]] = []

    for word in page.extract_words():
        text = _normalise(word["text"])
        if text == target or text[::-1] == target:
            hits.append([round(word["x0"], 2), round(word["top"], 2),
                         round(word["x1"], 2), round(word["bottom"], 2)])

    if not hits:
        return None
    return min(hits, key=lambda box: box[0])


def resolve_bboxes(pdf_path: str | pathlib.Path,
                   line_items: list[dict]) -> tuple[list[dict], dict]:
    """Fill in `bbox` for every line item that carries a page number.

    Returns (line_items, report). Items are copied, not mutated in place.

    When a value is found on a neighbouring page rather than the stated one,
    `page` is CORRECTED to where it was actually found - otherwise the UI jumps
    to the right document and draws a box on the wrong sheet, which is worse
    than drawing no box at all.
    """
    out: list[dict] = []
    report = {"resolved": 0, "missed": 0, "page_corrected": 0, "misses": []}

    with pdfplumber.open(pdf_path) as pdf:
        total = len(pdf.pages)

        for item in line_items or []:
            item = dict(item)
            value, page_no = item.get("value"), item.get("page")

            if not isinstance(value, (int, float)) or not isinstance(page_no, int):
                item["bbox"] = None
                report["missed"] += 1
                report["misses"].append(item.get("canonical_key"))
                out.append(item)
                continue

            # Stated page first, then outward.
            candidates = [page_no]
            for offset in range(1, SEARCH_RADIUS + 1):
                candidates += [page_no + offset, page_no - offset]

            bbox = None
            for candidate in candidates:
                if not 1 <= candidate <= total:
                    continue
                bbox = find_bbox(pdf.pages[candidate - 1], value)
                if bbox:
                    if candidate != page_no:
                        item["page"] = candidate
                        report["page_corrected"] += 1
                    break

            item["bbox"] = bbox
            if bbox:
                report["resolved"] += 1
            else:
                report["missed"] += 1
                report["misses"].append(item.get("canonical_key"))
            out.append(item)

    return out, report


def main() -> None:
    """Verify the lookup reproduces the committed fixture exactly."""
    fixture_path = ROOT / "fixtures" / "mock_extraction.json"
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    pdf_path = ROOT / fixture.get("source_pdf", "")

    if not pdf_path.exists():
        sys.exit(f"source PDF not found: {pdf_path.name}. "
                 "It is gitignored - copy it into the repo root to run this.")

    print(f"{pdf_path.name}")
    failures = 0

    for label, items in (("current", fixture["line_items"]),
                         ("prior", fixture["prior_period"]["line_items"])):
        stripped = [{**i, "bbox": None} for i in items]
        resolved, report = resolve_bboxes(pdf_path, stripped)

        mismatched = [
            r["canonical_key"] for r, original in zip(resolved, items)
            if r["bbox"] != original["bbox"]
        ]
        failures += len(mismatched) + report["missed"]

        print(f"  {label:<8} resolved {report['resolved']}/{len(items)}"
              f"  corrected={report['page_corrected']}"
              f"  missed={report['misses'] or 'none'}")
        if mismatched:
            print(f"           MISMATCH vs fixture: {mismatched}")

    print("\n" + ("all bboxes reproduce the fixture"
                  if not failures else f"FAILED ({failures} problems)"))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
