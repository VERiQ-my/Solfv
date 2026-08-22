"""Section 5.1 (10:15-10:45) - getting a document into the pipeline.

Two paths in:

* **PDF** - render only the pages `resolve_pages()` targeted. Five images for
  the demo document, not 179. Cost and latency stop depending on report length.
* **XLSX** - map columns onto CANONICAL_KEYS and emit Contract 1 directly with
  `page=null, bbox=null`. Skips the vision model entirely.

Native-text PDFs only (spec rule 3). A scanned document fails loudly here
rather than silently producing an empty extraction downstream.
"""

from __future__ import annotations

import pathlib

from analysis.schema import CANONICAL_KEY_SET, CANONICAL_LABELS

RENDER_DPI = 150


class IngestError(RuntimeError):
    """Raised for documents we deliberately do not handle."""


# ---------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------

def page_texts(pdf_path: str | pathlib.Path) -> dict[int, str]:
    """{1-based page: text} for the whole document.

    Feeds the privacy scan, which must see every page - the architectural
    claim is precisely that PII lives on pages we never transmit, and we can
    only say that after looking at all of them.
    """
    import pdfplumber

    out: dict[int, str] = {}
    with pdfplumber.open(str(pdf_path)) as pdf:
        for index, page in enumerate(pdf.pages):
            out[index + 1] = page.extract_text() or ""
    return out


def assert_native_text(texts: dict[int, str]) -> None:
    """Reject scanned PDFs. No OCR, by design - fail loudly and gracefully."""
    characters = sum(len(t.strip()) for t in texts.values())
    if characters < 200:
        raise IngestError(
            "This PDF has no text layer - it looks scanned. SEMAK reads "
            "native-text PDFs only; OCR is explicitly out of scope."
        )


def render_pages(pdf_path: str | pathlib.Path, pages: list[int],
                 out_dir: str | pathlib.Path, dpi: int = RENDER_DPI) -> dict[int, str]:
    """Rasterise the targeted pages. `pages` is 1-BASED, as everywhere else."""
    import fitz  # PyMuPDF

    out_dir = pathlib.Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    written: dict[int, str] = {}
    with fitz.open(str(pdf_path)) as doc:
        for number in sorted(set(pages)):
            if not 1 <= number <= doc.page_count:
                continue
            target = out_dir / f"p{number}.png"
            doc[number - 1].get_pixmap(dpi=dpi).save(str(target))
            written[number] = str(target)
    return written


def page_dimensions(pdf_path: str | pathlib.Path, page: int) -> tuple[float, float] | None:
    """(width, height) in pdfplumber points - what bbox coordinates are in.

    The frontend needs this to scale a bbox onto a rendered image of any size.
    """
    import pdfplumber

    with pdfplumber.open(str(pdf_path)) as pdf:
        if not 1 <= page <= len(pdf.pages):
            return None
        target = pdf.pages[page - 1]
        return float(target.width), float(target.height)


# ---------------------------------------------------------------------------
# XLSX
# ---------------------------------------------------------------------------

# Spreadsheet headers vary; the canonical key is what matters. Longest phrases
# first so "current assets" never resolves through "assets".
_COLUMN_ALIASES: list[tuple[tuple[str, ...], str]] = [
    (("total current assets", "current assets"), "current_assets"),
    (("total current liabilities", "current liabilities"), "current_liabilities"),
    (("total assets",), "total_assets"),
    (("total liabilities",), "total_liabilities"),
    (("total equity", "shareholders equity", "shareholders' equity"), "total_equity"),
    (("cash and cash equivalents", "cash and bank balances", "cash"), "cash"),
    (("trade and other receivables", "trade receivables", "receivables"), "receivables"),
    (("inventories", "inventory", "stocks"), "inventory"),
    (("short term borrowings", "short-term borrowings", "current borrowings"), "st_debt"),
    (("long term borrowings", "long-term borrowings", "non-current borrowings"), "lt_debt"),
    (("retained earnings", "accumulated profits"), "retained_earnings"),
    (("revenue", "turnover", "sales"), "revenue"),
    (("cost of sales", "cost of goods sold", "cogs"), "cogs"),
    (("gross profit",), "gross_profit"),
    (("operating expenses", "opex", "administrative expenses"), "opex"),
    (("operating profit", "ebit", "profit from operations"), "ebit"),
    (("finance costs", "interest expense", "finance cost"), "interest_expense"),
    (("profit after tax", "net profit", "profit for the year", "pat"), "pat"),
    (("net cash from operating activities", "operating cash flow"), "operating_cf"),
    (("dividends paid", "dividends"), "dividends"),
]


def _canonical_for(label: str) -> str | None:
    text = " ".join(str(label).lower().replace("_", " ").split())
    if text in CANONICAL_KEY_SET:
        return text
    for aliases, key in _COLUMN_ALIASES:
        if any(alias in text for alias in aliases):
            return key
    return None


def _to_number(raw) -> float | None:
    """Parse a spreadsheet cell into a number. `(1,234)` is negative."""
    if raw is None:
        return None
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        return float(raw)

    text = str(raw).strip()
    if not text:
        return None
    negative = text.startswith("(") and text.endswith(")")
    for junk in "(),$ ":
        text = text.replace(junk, "")
    text = text.replace("RM", "").replace("rm", "").strip()
    if not text:
        return None
    try:
        value = float(text)
    except ValueError:
        return None
    return -value if negative else value


def from_xlsx(path: str | pathlib.Path, entity: str | None = None) -> dict:
    """Read a two-column label/value sheet into Contract 1.

    Every item lands `page=None, bbox=None`, so `assign_trust` will badge them
    UNVERIFIED - correct, and honest: a spreadsheet has no source cell in a
    published document to point at.
    """
    import pandas as pd

    frame = pd.read_excel(path, header=None)
    if frame.shape[1] < 2:
        raise IngestError(
            "Expected a spreadsheet with a label column and a value column."
        )

    line_items: list[dict] = []
    seen: set[str] = set()
    for _, row in frame.iterrows():
        label = row.iloc[0]
        if label is None or str(label).strip() == "":
            continue
        key = _canonical_for(label)
        if key is None or key in seen:
            continue
        value = next(
            (v for v in (_to_number(row.iloc[c]) for c in range(1, frame.shape[1]))
             if v is not None),
            None,
        )
        if value is None:
            continue
        seen.add(key)
        line_items.append({
            "canonical_key": key,
            "label_as_printed": str(label).strip(),
            "value": value,
            "page": None,
            "bbox": None,
            "trust": "UNVERIFIED",
        })

    if not line_items:
        raise IngestError(
            "No recognisable financial line items in that spreadsheet. Expected "
            "labels such as 'Total assets' or 'Revenue' in the first column."
        )

    return {
        "entity": entity or pathlib.Path(path).stem,
        "period": None,
        "currency": "MYR",
        "unit": "units",
        "ticker": None,
        "line_items": line_items,
        "narrative_claims": [],
        "source": "xlsx",
    }


def label_for(key: str) -> str:
    return CANONICAL_LABELS.get(key, key)
