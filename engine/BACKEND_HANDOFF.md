# Backend handoff — from the Data lane

Everything below was verified against the real demo document, `Seacera-Annual-Report-2024.pdf` (179 pages). Code in here is tested, not sketched — paste it.

**Setup:** `python -m venv .venv && .venv/Scripts/pip install -r requirements.txt`

---

## 1. The only thing you import from `analysis/`

```python
import json, pathlib
from analysis.pipeline import analyse

PEERS  = json.loads(pathlib.Path("fixtures/sector_peers.json").read_text("utf-8"))
MARKET = {"market_cap": 133_760_000, "share_price_1y": 0.1944}  # printed on p.19

result = analyse(extraction, MARKET, PEERS)   # returns Contract 2 verbatim
```

`analysis/` does no file I/O, so **you** load the peers JSON and pass it. `analyse()` returns everything `GET /analysis/{sid}` promises plus `prior_line_items`, `quarantined`, `prior_ratios` and `summary`. Return it verbatim — do not reshape it.

Omit `peers` and `benchmark` comes back `[]`. That is the intended degradation; it must never break the dashboard.

**Do not reimplement anything in `analysis/`.** It is done and has 13 passing tests.

---

> **`backend/pages.py` and `backend/bbox.py` are already written and verified — don't rewrite them.** Sections 2 and 3 explain what they do and why, so you can review rather than re-derive. Everything else in `backend/` is yours (section 7).
>
> ```
> .venv/Scripts/python backend/pages.py     # 4/4 sections, 8 of 179 pages
> .venv/Scripts/python backend/bbox.py      # 38/38, reproduces the fixture
> ```

## 2. `pages.py` — written, verified

The spec's version has one bug that matters: it filters false positives by requiring an `RM'000` header. **Seacera prints in full ringgit**, so that filter rejects every real statement page. Require a currency token *plus a year pair* instead — works for both conventions.

```python
import re, pdfplumber

SECTION_PATTERNS = {
    "balance_sheet": ["statements of financial position", "statement of financial position",
                      "balance sheet"],
    "income":        ["statements of profit or loss", "statement of profit or loss",
                      "statements of comprehensive income", "statement of comprehensive income"],
    "cashflow":      ["statements of cash flows", "statement of cash flows"],
    "narrative":     ["chairman's statement", "chairman’s statement", "management discussion",
                      "md&a", "chief executive", "management's discussion"],
}
CURRENCY  = re.compile(r"\brm\s*[’']?\s*(000)?\b", re.I)
YEAR_PAIR = re.compile(r"\b(19|20)\d{2}\b.{0,40}\b(19|20)\d{2}\b", re.S)
TOC_MATCH_LIMIT = 3          # a contents page matches every pattern at once

def find_pages(pdf_path) -> dict[str, list[int]]:
    """Returns 1-BASED page numbers."""
    hits = {k: [] for k in SECTION_PATTERNS}
    with pdfplumber.open(pdf_path) as pdf:
        texts = [(p.extract_text() or "") for p in pdf.pages]

    for n, text in enumerate(texts):
        head = text.lower()[:1500]
        matched = [s for s, pats in SECTION_PATTERNS.items() if any(p in head for p in pats)]
        if len(matched) >= TOC_MATCH_LIMIT:
            continue
        for section in matched:
            if section == "narrative":
                hits[section].append(n + 1)
            elif CURRENCY.search(text) and YEAR_PAIR.search(text):
                hits[section].append(n + 1)

    for section, pages in hits.items():        # statements run across a spread
        if section != "narrative":
            hits[section] = sorted({p for n in pages for p in (n, n + 1)})
    return hits
```

Verified: **4/4 sections on both reports**, 25 of Seacera's 179 pages matched. Runs in ~2s.

**Call `resolve_pages(pdf_path)`, not `find_pages()` directly.** It ships the fallback §5.1 asks for: when the upload is a known demo document it uses the hand-verified page list from `fixtures/demo_documents.json`; anything else falls through to the matcher. Both paths are capped, and a truncated list logs a warning rather than silently looking like a clean extraction.

```python
from backend.pages import resolve_pages

pages = resolve_pages(pdf_path)
# {"extraction": [78, 80, 81, 82, 85], "narrative": [12, 15, 17],
#  "source": "verified", "sections": {...}, "pages_total": 179}
```

Measured: **Seacera 8 pages of 179 (4%)** on the verified path, **Khee San 12 of 140 (9%)** falling through to the matcher. Cost and latency stop depending on report length, exactly as §5.1 wants.

---

## 3. `bbox.py` — the spec's version silently loses a figure

Two fixes, both required.

**(a) Rotated text.** Seacera's statement of changes in equity (pp.82–83) is printed sideways. pdfplumber returns those words with `upright=False` and **the characters reversed** — `"081,617,63"` for `36,716,180`. The spec's `find_bbox()` compares only the forward string, so it misses every figure on that page and `retained_earnings` goes null → UNVERIFIED → drags Altman X2 down with it.

**(b) Four numeric columns.** These statements print Group 2024 | Group 2023 | Company 2024 | Company 2023. `return` on the first match can hand you the Company column. Take the leftmost.

```python
def find_bbox(page, value) -> list[float] | None:
    """Leftmost match = the Group current-year column. Handles rotated pages."""
    plain = str(int(abs(value)))
    hits = []
    for w in page.extract_words():
        text = w["text"].strip().strip("()").replace(",", "")
        if text.endswith(".00"):
            text = text[:-3]
        if text == plain or text[::-1] == plain:      # [::-1] handles rotation
            hits.append([w["x0"], w["top"], w["x1"], w["bottom"]])
    if not hits:
        return None            # a miss is a real signal -> trust = UNVERIFIED
    return min(hits, key=lambda b: b[0])
```

That `[::-1]` took bbox resolution from **36/38 to 38/38** on the real document.

For the extraction path, call the batch helper rather than looping yourself:

```python
from backend.bbox import resolve_bboxes

line_items, report = resolve_bboxes(pdf_path, line_items)
# report = {"resolved": 19, "missed": 0, "page_corrected": 0, "misses": []}
```

It searches the stated page first, then ±1 — statements run across spreads and the model sometimes names the first page of the spread for a figure printed on the second. When a neighbour wins it **corrects `page`**, because jumping to the right document and boxing the wrong sheet is worse than drawing no box.

`python backend/bbox.py` re-derives every coordinate from the PDF and diffs against the committed fixture. Currently **38/38, zero corrections needed**. If that ever fails, the fixture and the PDF have drifted apart.

**Pages are 1-based everywhere** — in the fixture, in `find_pages()`, and in whatever `GET /page/{sid}/{n}` renders. Keep it consistent or every highlight lands on the wrong page.

---

## 4. `privacy.py` — read this before you build the ledger

I scanned both reports with the spec's patterns. **The demo script's "17 personal data entities" is not true of this document.**

Seacera, whole document: **4 unique emails + 1 mobile = 6 entities.** Zero NRIC, zero passport.

Worse for the pitch as written: on the **8 pages we actually transmit, there is no PII at all — zero of every category.**

Do not fake the number. Reframe it, because the honest version is a stronger claim:

> "We detect and mask personal data locally before anything leaves the machine. In this document that's 6 entities. And because we target only the 8 pages that carry the financial statements, out of 179, the personal data in this report is on pages we never transmit at all. Zero transmitted isn't a policy — it's a property of the architecture."

That converts a weak count into a real architectural privacy win, and it survives a judge checking it.

If you want a larger, still-honest count, add a director-name detector — names *are* personal data under PDPA, and there are 22 honorific-prefixed names in Seacera:

```python
"person_name": r"\b(?:Dato'|Dato’|Datuk|Tan Sri|Puan Sri|Encik|Puan)\s+[A-Z][\w'’-]+(?:\s+[A-Z][\w'’-]+)*"
```

**Two traps I hit while testing — avoid both:**

1. A loose landline/digit-run regex produced **42 hits, most of them fragments of financial figures** (`76887517` came out of a balance sheet number). This is exactly what §5.1 warns about with bank accounts. Keep the context-keyword requirement (`account no`, `a/c`, `acct` within ~30 chars) and do not add a bare digit-run pattern. The context-keyword version returns **0 hits** here — correctly.
2. The company registration number `198701005080 (163751-H)` appears **121 times** and looks NRIC-adjacent. It is a company identifier, not personal data. Do not mask it, and make sure your NRIC pattern's `\b\d{6}-\d{2}-\d{4}\b` doesn't drift into matching it.

Ledger entry stays `{entity_type, count, page}`. **Never log the raw match** — that would recreate the exposure you just removed.

---

## 5. `extract.py` — prompts are already written

Import them, don't retype:

```python
from analysis.prompts import (
    EXTRACTION_PROMPT, NARRATIVE_PROMPT, QUERY_ROUTER_PROMPT,
    parse_llm_json, validate_extraction,
)

raw = call_deepseek(EXTRACTION_PROMPT, page_images)   # your job
doc = parse_llm_json(raw)                              # raises ValueError -> retry once
doc, warnings = validate_extraction(doc)               # drops junk, never repairs
```

`validate_extraction()` discards unknown keys, non-numeric values, duplicate keys and claims pointing at metrics we cannot compute — and returns a warning list. Log the warnings and keep going; a partial extraction is still a useful dashboard, and every gap shows as a *missing* ratio rather than a wrong one.

**DeepSeek specifics** (checked against their docs, they matter):
- Vision is **`deepseek-v4-flash-vision-exp` only**. `deepseek-chat` and plain V4 are text-only and return **400** on image input.
- **No JSON mode** on that model — strict JSON is prompt-enforced plus `parse_llm_json` plus the one retry. Don't reach for `response_format`.
- Images in **user messages only** (400 otherwise).
- Each image is squeezed to ~**384 tokens regardless of pixel size**. So **send a crop of the statement table, not a full A4 page** — same token cost, several times the effective resolution on small figures. Up to 600 images per request, so tiling a dense page is free.
- It's experimental and was released 21 Aug 2026. Keep the hand-transcribed fixture as the live fallback (§5.1's 10:45 block) — that is now insurance you actually need.

---

## 6. Sixty-second smoke test

Before wiring anything, confirm the Data lane works in your process:

```bash
.venv/Scripts/python tests/test_analysis.py     # expect: all green (0 failing)
.venv/Scripts/python scripts/check_find_pages.py
```

Then, once `/analysis/{sid}` is up, the demo passes only if the clean document gives you **2 checks PASS / 1 UNVERIFIABLE, 19/19 VERIFIED**, and the doctored one gives **1 FAIL, 3 keys quarantined, gearing/ROE/Z-score withheld**.

Regenerate fixtures any time with:

```bash
.venv/Scripts/python scripts/build_fixture.py   # expect: bboxes resolved 38/38
.venv/Scripts/python scripts/make_doctored.py
```

---

## 7. Not mine, still yours

`main.py`, `ingest.py`, `privacy.py`, `extract.py`, `session.py`, `payment.py`.

`pages.py` and `bbox.py` are done, which removes the 09:50–10:15 block and most of the bbox half of 11:30–12:45 from your critical path. Spend it on **the stub server first** so Frontend is never blocked, then `ingest.py`.

`ingest.py` only needs to render the pages `resolve_pages()` hands you — five images for the demo document, not 179:

```python
import fitz
from backend.pages import resolve_pages

pages = resolve_pages(pdf_path)
with fitz.open(pdf_path) as doc:
    for n in pages["extraction"] + pages["narrative"]:
        doc[n - 1].get_pixmap(dpi=150).save(f"tmp/{sid}/p{n}.png")   # n is 1-based
```

One thing worth saying out loud at standup: the reconciliation engine and the Say-Do Gap are pure stdlib on purpose. I ran the test suite on a bare interpreter with no packages installed and it passes. If pdfplumber, PyMuPDF or DeepSeek fall over at 15:00, the two features that win the judging still run.
