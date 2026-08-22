# SEMAK - Build Spec

**DevLeague 2026 | Lab 1: AI-Powered Financial Report Analysis (Experian)**
**Hard deadline: 16:30. Code freeze: 15:15. 3 developers.**

---

## 0. READ THIS FIRST (for the coding agent)

You are building a hackathon prototype with roughly 5 hours of real build
time. Optimise for a working demo, not for production quality.

**Rules you must not break:**

1. **No database.** In-memory dict keyed by `session_id`. This is a
   deliberate PDPA design decision, not laziness.
2. **No vector DB, no embeddings, no RAG.** The query feature is a
   structured lookup over already-extracted JSON. This is a design
   decision we defend in the pitch, not a shortcut. See section 13.
   The single narrow exception is in section 13.3 and it is P3 only.
3. **No OCR, no scanned PDFs, no merged-cell spreadsheet handling.**
   Native-text PDFs only. Fail loudly and gracefully on anything else.
4. **No real agent routing.** It is a linear pipeline. We call it
   "agents" in the pitch; we write sequential function calls.
5. **Never invent a number.** Every figure must trace to a page and a
   bounding box, or be marked UNVERIFIED.
6. **The schema in section 2 is frozen.** Do not change it. All three
   lanes build against it in parallel.

**If you are running out of time, cut in this order:** Bursa benchmark →
query bar → XLSX ingestion → ratio breadth. **Never cut** the
reconciliation engine or the Say-Do Gap. Those two are the entire
competitive differentiation.

---

## 1. What we are building and why it wins

A credit analyst spends hours turning PDF financial statements into a
lending decision. Most of that time is retyping numbers.

Every other team will build "upload PDF, RAG chatbot, some charts."
That approach hallucinates numbers, and industry judges will test it.

**SEMAK's thesis: the LLM extracts, deterministic math verifies.** A
figure that fails an accounting identity check is quarantined and never
reaches the dashboard.

Five differentiators, in priority order:

| # | Feature | Why it scores |
|---|---------|---------------|
| 1 | **Reconciliation engine** - deterministic accounting-identity checks over LLM output | Technical Execution (25%). Nobody else will guard the extraction layer |
| 2 | **Click-to-source provenance** - every number links to page + bbox in the original PDF | UX (15%) + the brief's explicit explainability requirement |
| 3 | **Say-Do Gap** - test management's narrative claims against the actual numbers | Innovation (20%). Genuinely novel. This is the demo moment |
| 4 | **Bursa peer benchmark** - ratios vs sector median | Alignment + Impact (40% combined). Benchmarking against a population IS Experian's business model |
| 5 | **Privacy gate + visible ledger** - local PII masking before any external call | PDPA is a named success criterion most teams will treat as a slide |

Judging weights: Problem/Lab Alignment 20%, Innovation 20%, **Technical
Execution 25%**, UX 15%, Impact 20%.

---

## 2. FROZEN CONTRACTS

Everything parallelises off these two. Do not renegotiate them.

### 2.1 Canonical chart of accounts

Exactly these 20 keys. Nothing else is a valid `canonical_key`.

```python
CANONICAL_KEYS = [
    "total_assets", "total_liabilities", "total_equity",
    "current_assets", "current_liabilities",
    "cash", "receivables", "inventory",
    "st_debt", "lt_debt", "retained_earnings",
    "revenue", "cogs", "gross_profit", "opex",
    "ebit", "interest_expense", "pat",
    "operating_cf", "dividends",
]
```

### 2.2 Contract 1: extraction JSON

Produced by Backend. Consumed by Data. Rendered by Frontend.

```json
{
  "entity": "Example Berhad",
  "period": "FY2024",
  "currency": "MYR",
  "unit": "thousands",
  "ticker": "1234.KL",
  "line_items": [
    {
      "canonical_key": "total_assets",
      "label_as_printed": "Total assets",
      "value": 1234567,
      "page": 42,
      "bbox": [72.5, 310.2, 140.8, 322.6],
      "trust": "VERIFIED"
    }
  ],
  "narrative_claims": [
    {
      "sentence": "The Group maintained a strong liquidity position throughout the year.",
      "page": 12,
      "metric": "current_ratio",
      "direction": "strong"
    }
  ]
}
```

- `bbox` is `[x0, top, x1, bottom]` in pdfplumber page coordinates, or
  `null` if the reverse lookup failed.
- `trust` is one of `VERIFIED | DERIVED | UNVERIFIED`. Backend writes
  `UNVERIFIED` by default; Data overwrites it after running checks.
- `direction` is one of `strong | weak | improving | declining | stable`.
- `metric` must be a key returned by `compute_ratios()` (section 4.3).

### 2.3 Contract 2: API surface

Produced by Backend. Consumed by Frontend. Frontend hardcodes a mock of
these responses at 09:20 and does not wait for Backend.

```
POST   /upload              multipart file(s)
       -> {session_id, privacy_ledger, expires_at}

GET    /analysis/{sid}
       -> {entity, period, line_items, checks, ratios, risk,
           benchmark, say_do_gap}

GET    /page/{sid}/{n}      -> PNG image of page n

POST   /query/{sid}         {question: str}
       -> {answer, value, source: {page, bbox}, trust} | {not_found: true}

DELETE /session/{sid}       -> {purged: true}
```

CORS wide open. No auth.

---

## 3. FILE TREE

```
semak/
├── backend/
│   ├── main.py              # FastAPI app, 5 endpoints
│   ├── pages.py             # keyword page targeting - 150pg report -> 5 pages
│   ├── ingest.py            # PDF -> page images, XLSX -> line_items
│   ├── privacy.py           # PII detection + masking + ledger
│   ├── extract.py           # vision LLM call + JSON parse + retry
│   ├── bbox.py              # reverse lookup value -> coordinates
│   ├── session.py           # in-memory store + TTL purge
│   └── payment.py           # Solana gate, BYPASSABLE
├── analysis/                # DATA LANE - pure functions, zero I/O
│   ├── schema.py            # CANONICAL_KEYS, dataclasses
│   ├── checks.py            # reconciliation engine
│   ├── ratios.py            # ratio pack + Altman Z
│   ├── benchmark.py         # Bursa peer comparison
│   ├── saydo.py             # Say-Do Gap engine
│   ├── query.py             # structured query resolver
│   └── pipeline.py          # analyse() - the single public entry point
├── frontend/                # Vite + React + Tailwind
│   └── src/
│       ├── App.jsx
│       ├── components/
│       │   ├── SplitScreen.jsx
│       │   ├── PdfPane.jsx           # react-pdf + bbox overlay
│       │   ├── LineItemTable.jsx     # trust badges, click-to-source
│       │   ├── ChecksPanel.jsx
│       │   ├── SayDoTable.jsx
│       │   ├── RiskCard.jsx
│       │   ├── BenchmarkChart.jsx
│       │   ├── PrivacyLedger.jsx
│       │   └── QueryBar.jsx
│       └── mock.js                   # mirrors Contract 2 exactly
├── fixtures/
│   ├── mock_extraction.json          # HAND-TYPED from the real PDF
│   ├── sector_peers.json             # cached yfinance pull
│   └── docs/                         # demo PDFs + the doctored one
├── scripts/
│   └── fetch_peers.py
└── README.md
```

---

## 4. DATA LANE (`analysis/`)

Pure functions. No network, no file I/O, no framework imports. Every
module here must be unit-testable with a dict literal.

### 4.1 `pipeline.py` - the only public interface

```python
def analyse(extraction: dict, market_data: dict | None = None) -> dict:
    """
    The single coupling point between Data and the rest of the system.
    Backend calls this once and returns the result verbatim.

    Returns:
    {
      "entity": str, "period": str,
      "line_items": [...],       # with trust reassigned
      "checks": [...],
      "ratios": {...},
      "risk": {...},
      "benchmark": [...],
      "say_do_gap": [...]
    }
    """
```

### 4.2 `checks.py` - the reconciliation engine (THE MOAT)

Three checks. Deterministic. No AI anywhere in this file.

```python
TOLERANCE = 0.01   # 1% relative, absorbs rounding in published accounts

Check = {
    "name": str,
    "expected": float,
    "actual": float,
    "delta": float,
    "passed": bool,
    "affected_keys": list[str],
}

def run_checks(line_items: list[dict]) -> list[Check]:
    ...
```

The three checks:

1. **Balance sheet identity**
   `total_assets == total_liabilities + total_equity`
2. **Current assets composition**
   `current_assets == cash + receivables + inventory`
   (may under-sum in real reports; use a 5% tolerance here and label it
   "composition check" rather than an identity)
3. **Retained earnings roll-forward**
   `retained_earnings_close == retained_earnings_open + pat - dividends`
   (skip and mark UNVERIFIABLE if prior-period RE is unavailable)

```python
def assign_trust(line_items: list[dict], checks: list[Check]) -> list[dict]:
    """
    VERIFIED   -> appears only in passing checks AND bbox is not None
    DERIVED    -> computed, not extracted from the document
    UNVERIFIED -> appears in a failing check, OR bbox is None
    """
```

A failing check must never be swallowed. It surfaces in the UI in red
with expected vs actual. This is a feature, and we demo it on purpose.

### 4.3 `ratios.py`

Six ratios only. Nobody counts ratios in a demo.

```python
def compute_ratios(li: dict) -> dict:
    return {
        "current_ratio":   current_assets / current_liabilities,
        "gearing":         (st_debt + lt_debt) / total_equity,
        "interest_cover":  ebit / interest_expense,
        "gross_margin":    gross_profit / revenue,
        "net_margin":      pat / revenue,
        "roe":             pat / total_equity,
    }
```

Return `None` for any ratio whose inputs are missing. Never substitute
zero. A missing ratio renders as "insufficient data", not as 0.0.

**Altman Z-Score**, both variants:

```python
def altman(li: dict, market_cap: float | None = None) -> dict:
    """
    Without market_cap -> Z'' (private / non-manufacturer):
        Z'' = 6.56*X1 + 3.26*X2 + 6.72*X3 + 1.05*X4
        X1 = (current_assets - current_liabilities) / total_assets
        X2 = retained_earnings / total_assets
        X3 = ebit / total_assets
        X4 = total_equity / total_liabilities
        Zones: >2.60 SAFE | 1.10-2.60 GREY | <1.10 DISTRESS

    With market_cap -> original Z (listed):
        Z = 1.2*X1 + 1.4*X2 + 3.3*X3 + 0.6*X4 + 1.0*X5
        X4 = market_cap / total_liabilities
        X5 = revenue / total_assets
        Zones: >2.99 SAFE | 1.81-2.99 GREY | <1.81 DISTRESS

    Returns {score, zone, variant, drivers: [{name, value, contribution}]}
    """
```

`drivers` matters: the UI shows which components pushed the score down.
That is the explainability requirement satisfied without an LLM.

### 4.4 `benchmark.py` - Bursa peer comparison

```python
def benchmark(ratios: dict, peers: dict) -> list[dict]:
    """
    peers: loaded from fixtures/sector_peers.json (cached, committed).

    Returns [{metric, company, sector_median, percentile, verdict}]
    verdict in {"BETTER", "IN_LINE", "WORSE"}
    IN_LINE = within 20% of the sector median.
    """
```

`scripts/fetch_peers.py` runs **once** during the build, writes the JSON,
and the output is committed. The app reads the file. Live yfinance calls
are a fallback only, never the default path. Bursa tickers use a `.KL`
suffix (Maybank `1155.KL`, Tenaga `5347.KL`).

Pitch line this unlocks: *"Gearing 2.4x against a sector median of 0.87x.
A single set of statements can never tell you that. Comparative
positioning against a population is exactly what a credit bureau does."*

### 4.5 `saydo.py` - the Say-Do Gap (THE DIFFERENTIATOR)

```python
Gap = {
    "sentence": str, "page": int,
    "metric": str,
    "claimed": str,      # the direction management asserted
    "actual": str,       # e.g. "1.82 -> 0.91"
    "verdict": str,      # SUPPORTED | CONTRADICTED | UNVERIFIABLE
}

def say_do_gap(claims: list[dict], ratios: dict,
               prior_ratios: dict | None = None,
               market_data: dict | None = None) -> list[Gap]:
```

Logic is deterministic. The LLM's only job (done upstream during
extraction) was turning a sentence into `{metric, direction}`. This
function tests the assertion against computed values:

- `direction="strong"` + `current_ratio < 1.0` -> CONTRADICTED
- `direction="improving"` + metric fell YoY -> CONTRADICTED
- metric missing from `ratios` -> UNVERIFIABLE (never guess)

**Market-vs-narrative rows** when `market_data` is present: management
claims growth while share price fell 38% over the same period. Same Gap
shape, `metric="share_price_1y"`.

Target output for the demo:

| Management said | The numbers say | Verdict |
|---|---|---|
| "maintained a strong liquidity position" | Current ratio 1.82 → 0.91 | CONTRADICTED |
| "disciplined cost management" | Opex +31%, revenue +4% | CONTRADICTED |
| "reduced reliance on short-term borrowings" | ST debt −12% | SUPPORTED |

### 4.6 `query.py` - grounded lookup, not a chatbot

```python
def resolve_query(question: str, line_items: list[dict],
                  ratios: dict) -> dict:
    """
    An LLM maps the question to (canonical_key | ratio_name, period).
    This function then does a DICT LOOKUP.

    It physically cannot hallucinate a number because it never
    generates one. It only retrieves.

    -> {answer, value, source: {page, bbox}, trust}
    -> {not_found: true, message: "Not present in these documents."}
    """
```

The guaranteed refusal is the point. When a judge asks a spontaneous
question the system cannot answer, it says so. That reads as more
trustworthy than a system that always has an answer.

### 4.7 Data lane task order

| Time | Task |
|------|------|
| 09:20-09:40 | `schema.py` committed. **Then `fixtures/mock_extraction.json`, hand-typed from the real PDF with real page numbers.** This unblocks both other lanes for the entire day. Highest-leverage 20 minutes available |
| 09:40-11:00 | `checks.py` - the three checks + `assign_trust` |
| 11:10-12:00 | `ratios.py` + `altman()`. Draft the extraction prompt for Backend |
| 12:00-12:45 | `scripts/fetch_peers.py`, commit `sector_peers.json`, write `benchmark.py` |
| 13:15-14:00 | `saydo.py`. **Protect this block** |
| 14:00-14:45 | `query.py`. Validate the full chain against the real PDF by eye. **Build the doctored document** for the 14:30 demo beat |

---

## 5. BACKEND LANE (`backend/`)

Highest blowup risk. Start with the stub server so Frontend is never
blocked.

### 5.1 Order of work

**09:20-09:50 - stub server first.** All 5 endpoints returning
`fixtures/mock_extraction.json` piped through `analyse()`. Frontend
points at a real server from 10:00 even though nothing is real yet.

**09:50-10:15 - `pages.py`. Do this BEFORE ingest.**

Real annual reports are 140-170 pages. You do not process them. You
locate 4-6 pages and send only those to the vision model. Cost and
latency become independent of report length.

```python
SECTION_PATTERNS = {
    "balance_sheet": ["statements of financial position", "balance sheet"],
    "income":        ["statements of profit or loss",
                      "statements of comprehensive income"],
    "cashflow":      ["statements of cash flows"],
    "narrative":     ["chairman's statement", "management discussion",
                      "md&a", "chief executive"],
}

def find_pages(pdf_path) -> dict[str, list[int]]:
    hits = {k: [] for k in SECTION_PATTERNS}
    with pdfplumber.open(pdf_path) as pdf:
        for n, page in enumerate(pdf.pages):
            text = (page.extract_text() or "").lower()[:1500]  # top of page
            for section, pats in SECTION_PATTERNS.items():
                if any(p in text for p in pats):
                    hits[section].append(n)
    return hits
```

Rules:
- Take the matched page **plus the next one**. Statements almost always
  run across a two-page spread.
- **Filter false positives:** a table of contents or index page matches
  every pattern. Require the page to also contain a currency header
  (`RM'000`, `RM '000`). If a section returns >3 candidates, you are
  matching the TOC.
- **Fallback to hardcoded page numbers** noted during document selection
  (section 12). Ship the fallback, do not rely on the matcher.
- Full-text scan of 170 pages takes ~2 seconds. Run it on upload.

Test this on the real report first thing. It de-risks the entire
extraction path in five minutes.

**10:15-10:45 - `ingest.py`.**

```python
import fitz  # PyMuPDF
page.get_pixmap(dpi=150).save(f"/tmp/{sid}/p{n}.png")
```

XLSX path: `pd.read_excel`, map columns to `CANONICAL_KEYS`, emit
Contract 1 directly with `page=null, bbox=null`. Skips the LLM entirely.
Thirty minutes for a Key Requirements tick ("PDFs and spreadsheets").

**10:45-11:00 - hand-transcribe a real extraction.** If the LLM path is
not working by 12:45, Data still needs real data. Fifteen minutes of
insurance.

**11:00-11:30 - `privacy.py`.** Runs **before** any external API call.

```python
PATTERNS = {
    "nric":     r"\b\d{6}-\d{2}-\d{4}\b",
    "passport": r"\b[AHK]\d{8}\b",
    "phone":    r"(?:\+?60|0)[\s-]?1\d[\s-]?\d{3,4}[\s-]?\d{4}\b",
    "email":    r"\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b",
}
```

**Bank account numbers: do not use a bare digit-run regex.** A financial
statement is wall-to-wall long numbers and you will mask the balance
sheet. Only match when preceded by a context keyword (`account no`,
`a/c`, `acct`) within ~30 characters.

Ledger entry: `{entity_type, count, page}`. **Never log the raw match.**

**11:30-12:45 - `extract.py`.** Takes **only** the pages returned by
`find_pages()`. Page images + Data's prompt -> vision LLM -> strict JSON.
Retry once on parse failure. Budget ~20-30s and a few cents per report
regardless of whether it is 40 pages or 170. Then `bbox.py`:

```python
import pdfplumber

def find_bbox(page, value) -> list[float] | None:
    words = page.extract_words()
    target = str(int(value)).replace(",", "")
    for w in words:
        if w["text"].replace(",", "").replace(".00", "") == target:
            return [w["x0"], w["top"], w["x1"], w["bottom"]]
    return None   # -> trust = UNVERIFIED. A miss is a real signal
```

Thirty lines, gives pixel-accurate highlights, no layout model needed.

**13:15-14:00 - `session.py`** (dict + TTL purge, see section 7) and wire
`from analysis.pipeline import analyse`.

**Do not reimplement anything in `analysis/`.** Import and call it.

---

## 6. FRONTEND LANE (`frontend/`)

Vite + React + Tailwind. No component library. Never blocked: build
against `src/mock.js` all morning.

**The split-screen IS the product concept.** Insights left, source
document right, live highlight.

| Time | Task |
|------|------|
| 09:20-10:00 | Shell + `PdfPane` with react-pdf rendering a **hardcoded bbox highlight**. Prove the overlay maths before any real data exists |
| 10:00-11:00 | Click-to-source working end to end against mocks. Clicking a figure jumps the right pane to the page and draws the box |
| 11:10-12:45 | Trust badges (green VERIFIED / blue DERIVED / amber UNVERIFIED), `ChecksPanel` with the failing check loud and red showing expected vs actual |
| 13:15-14:00 | `SayDoTable` (give it room to breathe, it is the money shot), `RiskCard`, `BenchmarkChart`, `PrivacyLedger` with live session countdown |
| 14:00-14:45 | `QueryBar`. Polish, loading states, empty states. Do not leave a blank screen during a 20-second LLM call |

Bbox overlay: scale pdfplumber coordinates by the react-pdf render ratio,
absolutely-positioned div.

**If you finish early, do not add features.** Take demo prep: run the
flow twenty times, find the crash, write the README.

---

## 7. SESSION STORE (no database)

```python
SESSIONS: dict[str, dict] = {}
# {sid: {"created": ts, "extraction": {...}, "analysis": {...},
#        "privacy_ledger": [...], "pdf_path": "/tmp/{sid}/", "paid": bool}}

TTL_MINUTES = 60
```

PDFs and page images on disk at `/tmp/{sid}/`, purged with the session.

This is a **pitch asset**, say it out loud in the demo:

> "There is no database. Documents are processed in memory and purged on
> a timer. There is nothing to breach because nothing is stored."

Show the countdown timer in the UI so ephemerality is visible, not just
claimed.

---

## 8. SOLANA PAYMENT GATE (`payment.py`)

Owned by the third team member. **Must be off the critical path.**

```python
PAYMENT_REQUIRED = os.getenv("PAYMENT_REQUIRED", "false") == "true"
```

Default **false**. The demo runs with the gate bypassed.

If devnet is congested at 15:50, or the wallet extension will not connect
on the demo laptop, or the RPC rate-limits, the entire demo dies at step
one and the judges never see the reconciliation engine. Do not let an
external network dependency sit upstream of the differentiation.

- Pre-sign a transaction before the demo
- Record a 10-second clip of a successful payment as fallback
- Demo the core pipeline first, then show payment as a separate 15-second beat

**Framing in the pitch:** per-document metering for an API product.
Experian sells per-query decisioning, so "pay-per-report, settled
on-chain, no subscription" is a coherent business story. Do not pitch it
as "we integrated Solana."

**Timebox: 90 minutes, hard stop.** If the third member is also on
backend, extraction is the higher priority and the Data lane absorbs
`ingest.py` and `bbox.py`.

---

## 9. SCHEDULE

| Time | |
|------|---|
| 09:00-09:20 | Repo, freeze both contracts, cut branches. No discussion after 09:20 |
| 09:20-11:00 | Build block 1 |
| 11:00-11:10 | Standup. Ten minutes, standing up, what is blocked |
| 11:10-12:45 | Build block 2 |
| 12:45-13:15 | Lunch. Actually take it |
| 13:15-14:45 | Build block 3. First real integration around 14:00 |
| 14:45-15:15 | Integration only. **No new features** |
| **15:15** | **CODE FREEZE. Non-negotiable** |
| 15:15-15:45 | Lock demo docs, run the demo twice end to end, fix only demo-breaking bugs |
| 15:45-16:10 | Record the pitch video |
| 16:10-16:30 | README, project description, submit |

**Commit continuously from 09:00.** A repo with one commit at 16:25 looks
bad regardless of what is in it.

If you are behind at 14:45, ship what works. Three features demoed
cleanly beats six features with one crash.

---

## 10. DEMO SCRIPT (3 minutes)

```
0:00  A credit analyst spends four hours turning one set of financial
      statements into a decision. Most of that is retyping numbers.

0:15  Every team here can build a tool that reads a financial report.
      The problem is language models make up numbers, and in credit risk
      a made-up number is a bad loan. We built one that audits itself.

0:35  [UPLOAD] Privacy ledger populates: 17 personal data entities
      detected and masked locally, zero transmitted. Nothing leaves this
      machine unredacted. And there is no database - processed in
      memory, purged on a timer.

1:00  [DASHBOARD] Every figure carries a trust badge. [CLICK] Source page
      opens, exact cell highlighted. [CLICK AGAIN] Nothing here is
      unsourced.

1:25  [CHECKS] These are not LLM outputs. Assets equal liabilities plus
      equity. Line items sum to their subtotals. Deterministic, no AI.
      A figure that fails is quarantined and never reaches this screen.

1:50  [SAY-DO GAP] The part we are proudest of. Management said they
      maintained a strong liquidity position. Current ratio went 1.82 to
      0.91. We read the narrative and test it against the numbers. This
      is what a forensic accountant does and nobody automates it.

2:15  [BENCHMARK] Gearing 2.4x, sector median 0.87x. A single set of
      statements can never tell you that.

2:30  [BREAK IT] Doctored figure. Check fails, quarantined, system says
      it cannot verify. Most tools hide their failure modes. We show
      ours, because that is the difference between a demo and something
      a bank can use.

2:50  Altman Z: distress zone. Here is the API endpoint. Roadmap:
      ensemble extraction, scanned documents, decisioning integration.
```

Demo from **localhost**, never a deploy. Record the video even if you
also demo live.

The deliberate break at 2:30 is worth more than any feature you could add
with the same time. Keep it.

---

## 11. README (a judged deliverable)

Must contain:

- One-paragraph problem statement and the thesis
- Architecture diagram
- **The reconciliation checks listed explicitly with their formulas**
- Setup instructions that actually work from a clean clone
- **Known Limitations**, blunt: native-text PDFs only, tuned to one
  report format, no OCR, 20-key chart of accounts, single-session
  in-memory store

Industry judges respect a team that knows exactly what it did not build.
It reads as engineering maturity, not weakness.

---

## 12. DEMO DOCUMENT SELECTION

The fixtures depend on this. Spend max 30 minutes, then commit.

### 12.1 Hard exclusions

**Never use a bank, insurer, or REIT.** Banks use a liquidity-ordered
balance sheet with no current assets / current liabilities split. Current
ratio, working capital and Altman X1 are all undefined. Half the ratio
pack returns null. Maybank looks like the obvious "big Malaysian company"
pick and it would break the entire schema.

Also avoid: plantations (biological assets), REITs (fair-value
revaluation dominates), airlines (lease liabilities distort gearing).

**Want:** manufacturer, retailer, construction, or trading company.
Classic balance sheet with inventory and receivables.

### 12.2 Which company

Use Bursa's PN17/GN3 list as a pre-filter. It is a curated set of
companies whose numbers are bad while their chairman's statement is
still optimistic, which is exactly what the Say-Do Gap eats.

Candidates that fit the schema: Khee San (confectionery), Seacera
(tiles), Industronics (electronics), Ho Hup or Ireka (construction).

Smaller and ACE Market is **better**, not worse. Fewer consolidation
layers, shorter report.

### 12.3 Which year

**Call the PN17 classification year T. Use the FY T-1 annual report.
If equity is already negative or near zero there, drop back to T-2.**

Why T-1:
- Numbers visibly deteriorating, so Altman Z lands GREY or DISTRESS
- Equity still positive, so gearing and ROE do not blow up on a
  negative denominator
- Narrative still confident. Nobody writes "we expect to be classified
  as financially distressed next year"
- Prior-year comparatives printed in the same tables, so YoY is free
  without parsing a second PDF

**Avoid FY2020 and FY2021.** COVID ruins the Say-Do Gap. Every claim is
hedged with "unprecedented operating environment", so a contradiction
reads as bad luck rather than a red flag. FY2022 or later.

**Avoid FY T itself.** Negative equity, disclaimer of opinion,
restructuring notes everywhere. Ratios break and the auditor already
did our job.

### 12.4 Verification checklist (10 minutes, then commit)

Download from the company's own investor relations page, faster than
Bursa's announcement search.

1. **Text layer.** `pdftotext -f 40 -l 40 report.pdf -` on a statements
   page. Empty or garbage means scanned. Discard immediately
2. **Balance sheet has "Total current assets" and "Total current
   liabilities" as printed subtotals.** Non-negotiable
3. **Total equity positive** and comfortably above zero
4. **Current ratio below ~1.2** from the printed subtotals, computed in
   your head. If it is 2.5 you went back too far, move forward a year
5. **Real Chairman's Statement or MD&A** with qualitative claims, not a
   two-paragraph note
6. **Prior-year comparatives printed** in the same table
7. **`yf.Ticker("XXXX.KL").info` returns data.** Without it you lose the
   benchmark and the market-narrative Say-Do rows
8. **`find_pages()` locates all four sections**

Fails 1, 2 or 3 -> next candidate. Do not try to fix it.

### 12.5 Immediately after selecting

- Record page numbers for balance sheet, P&L, cash flow, chairman's
  statement -> hardcoded fallback list in `pages.py`
- Hand-type `fixtures/mock_extraction.json` from those pages
- **Copy the PDF and edit one figure so the balance sheet identity
  fails.** This is the 14:30 demo beat
- Grab a healthy company in the same sector as a **fallback document**.
  If the distressed one parses badly you still have a demo, it just
  runs SUPPORTED instead of CONTRADICTED

---

## 13. WHY NO VECTOR SEARCH (pitch answer + escape hatch)

### 13.1 The reasoning

RAG solves one problem: *I do not know where in the corpus the answer
is.* We eliminated that problem upstream with `find_pages()` plus
structured extraction. Once we have `{canonical_key, value, page, bbox}`,
retrieval is a dict lookup.

The dict is not a cheap substitute. It is strictly better here:

| | Vector search | Structured lookup |
|---|---|---|
| Precision | Top-k nearest chunks | Exact |
| Citation granularity | Chunk (~500 tokens) | Cell (page + bbox) |
| **Can prove absence** | **No** | **Yes** |
| Latency | ~200ms + embed | ~0 |

That third row wins us points. **Vector search cannot prove absence.** It
returns k chunks whether or not anything relevant exists, so a not-found
guardrail in RAG means asking an LLM to judge relevance, which is exactly
the judgment that fails under pressure. With a dict, `key not in ratios`
is a fact. The refusal is guaranteed by the data structure, not prompted.

Cell-level provenance is also our UX score. Chunk-level citations would
make the demo weaker, not stronger.

### 13.2 Say this when a judge asks

> "We deliberately did not use vector retrieval. RAG returns the nearest
> chunks whether or not the answer exists, so it cannot reliably tell you
> when it does not know. We extract into a structured schema first, so a
> lookup either hits an exact figure with its page and cell coordinates,
> or returns not-found as a fact. In credit risk, a system that can prove
> absence is worth more than one that always has an answer."

Then demo the refusal.

Be honest about the tradeoff if pushed: open-ended narrative questions
("what did they say about supply chain risk") and multi-document corpora
are genuine RAG use cases. Both are roadmap, not gaps we are hiding.

### 13.3 The escape hatch (P3 ONLY)

If and only if every item in the Definition of Done is green:

```python
from qdrant_client import QdrantClient
client = QdrantClient(":memory:")           # no Docker, no server
client.set_model("BAAI/bge-small-en-v1.5")  # fastembed, ~130MB one-time
```

Index **only the narrative pages** already located by `find_pages()`,
one chunk per paragraph, `payload={"page": n}`. ~30 lines, ~45 minutes.

Three conditions, all mandatory:

1. **P3 only.** After the Definition of Done is fully green
2. **Never touches the numbers path.** Narrative questions only. Numeric
   queries stay on the dict lookup so the refusal guarantee survives
3. **Nobody starts this after 14:00.** New dependencies after 14:00 are
   how demos die. Pre-download the embedding model if anyone is serious;
   a 130MB download on venue wifi at 14:30 is its own disaster

Realistically you will not get here, and that is the correct outcome.

---

## 14. DEFINITION OF DONE

- [ ] Upload a real annual report PDF, get a dashboard in under 60s
- [ ] Every displayed figure clicks through to a highlighted source cell
- [ ] At least one reconciliation check visibly passes; the doctored doc
      makes one visibly fail
- [ ] Say-Do Gap table shows at least 2 CONTRADICTED and 1 SUPPORTED
- [ ] Privacy ledger shows a non-zero masked count and "0 transmitted"
- [ ] Altman Z with zone and drivers
- [ ] Benchmark chart against sector median
- [ ] Query bar answers one real question and refuses one impossible one
- [ ] XLSX upload produces line items
- [ ] `find_pages()` locates all four sections in the real 150pg report
- [ ] `DELETE /session` works and the countdown is visible
- [ ] README complete with Known Limitations
- [ ] 3-minute video recorded
