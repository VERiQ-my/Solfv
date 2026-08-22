# Demo document selection (spec V2 §12)

**Selected: Seacera Group Berhad, FY2024 (FYE 30 June 2024), Bursa code 7073.**
Rejected: Khee San Berhad FY2024.

Machine-readable page map and market data: [`fixtures/demo_documents.json`](fixtures/demo_documents.json).

---

## Why Khee San was rejected

It fails §12.4 check 3, which is one of the three non-negotiables.

| | Khee San FY2024 |
|---|---|
| Total equity | **−RM76,629,109** |
| Accumulated losses | −RM204,030,959 against RM112.2m share capital |
| Current ratio | 0.13 |
| Auditor's opinion | Qualified, with material uncertainty on going concern |
| Status | Unapproved Regularisation Plan |

§12.3 warns about exactly this: negative equity puts a negative denominator under gearing and ROE, and drives Altman X4 negative. The qualified opinion and Regularisation Plan are the FY *T* profile §12.3 says to avoid — "the auditor already did our job". §12.4 is explicit that a check-3 failure means next candidate, do not try to fix it.

Worth noting the balance sheet subtotals **are** printed; an early grep missed them because the caption wraps as `Total Current` / `Assets` across two lines. The disqualifier is the negative equity, not the labels.

Keep it as a contrast document only — useful if there is spare time to show the schema failing loudly on a company it was not built for. Never as the primary demo.

## Seacera against the §12.4 checklist

| # | Check | Result |
|---|---|---|
| 1 | Text layer | **PASS** — 452,897 chars over 179 pages, native |
| 2 | Printed current subtotals | **PASS** — p.80 and p.81 |
| 3 | Total equity positive | **PASS** — RM718,222,123 |
| 4 | Current ratio below ~1.2 | **MARGINAL FAIL** — 1.29, and it *improved* from 1.17 |
| 5 | Real chairman's statement / MD&A | **PASS** — p.12, pp.15–18 |
| 6 | Prior-year comparatives printed | **PASS** — in every statement |
| 7 | `yf.Ticker("7073.KL")` resolves | **PASS** — "Seacera Group Berhad", Industrials / Building Products & Equipment |
| 8 | `find_pages()` locates all four sections | **PASS** — 4/4, 25 of 179 pages targeted (14%) |

Checks 1, 2 and 3 all pass, so it is a valid candidate. Only check 4 fails, and it fails in the harmless direction.

---

## What this changes about the demo

The V1 spec assumed a distressed borrower: gearing 2.4x, current ratio collapsing, Altman in distress. Seacera is not that company on the face of its balance sheet. **The real story is better, and it is genuinely in the document.**

### Altman flips zone depending on which equity you believe

| Variant | Equity used | Score | Zone |
|---|---|---|---|
| Z″ (private) | Book equity RM718.2m | **5.84** | SAFE |
| Z (listed) | Market cap RM133.8m | **0.75** | **DISTRESS** |

Book equity is dominated by an investment property carried at RM786.4m — property, plant and equipment of RM788.3m was reclassified to investment properties during the year. The market prices the whole company at **19% of book**. Both numbers are printed in Seacera's own annual report; the market capitalisation is in the Financial Highlights on page 19, so this needs no network call.

That single slide replaces the "gearing 2.4x" beat, and it is a stronger one: it shows the model is only as good as the equity figure you feed it, and shows the tool surfacing that instead of hiding it.

### The Say-Do Gap, from real quoted sentences

3 CONTRADICTED, 2 SUPPORTED — past the DoD bar.

| Management said (verbatim) | The numbers say | Verdict |
|---|---|---|
| "generating strong momentum … towards a more sustainable performance" (p.12) | Net margin 14.53% → 6.72% (PAT −53.1%, revenue +1.4%) | CONTRADICTED |
| "continued to deliver a profitable performance" (p.15) | ROE 1.06% → 0.49% | CONTRADICTED |
| "consistent commitment in maintaining a robust liquidity position" (p.17) | Current ratio 1.29, against a 1.50 threshold | CONTRADICTED |
| "the financial position of the Group remained strong" (p.12) | Gearing 0.0001 — effectively no debt | SUPPORTED |
| "Current ratio of the Group improved from 1.17 to 1.29" (p.17) | Recomputed independently: 1.17 → 1.29 | SUPPORTED |

That last row is the one to lean on. Management stated a ratio; we recomputed it from the balance sheet and agree exactly. **A tool that contradicts everything is just a pessimist** — agreeing where management is right is what makes the three contradictions worth believing.

Deliberately **not** included: "The Group ventured into woodworks business which *aims to* … increase product margin" (p.15). Gross margin did fall 17.64% → 12.26%, so it would have scored a fourth CONTRADICTED — but that is an aspiration, not a claim about the year, and testing it would be a cheap shot a judge would spot. Management was candid about the margin decline in the MD&A. There is no gap on gross margin and we do not manufacture one.

### The reconciliation engine on a real document

| Check | Result |
|---|---|
| Balance sheet identity | **PASS**, delta exactly 0 — 853,283,605 = 135,061,482 + 718,222,123 |
| Current assets composition | **PASS** at 4.57% |
| Retained earnings roll-forward | **UNVERIFIABLE** |

Two details worth saying out loud:

- The composition check under-sums by exactly **RM2,385,386**, which is tax recoverable RM1,157,517 plus assets held for sale RM1,227,869. Neither has a canonical key. This is precisely why §4.2 sets that check at 5% and calls it a composition check, not an identity — and we can name the residual to the ringgit.
- Seacera paid no dividends and prints no dividends line, so the roll-forward genuinely cannot be run. It reports UNVERIFIABLE and quarantines nothing. A missing line in the document is our gap, not evidence against the figure.

Separately: retained earnings rose RM4.42m → RM36.72m while the company earned RM3.55m. The RM28.7m difference is a revaluation reserve reclassification. Our 20-key schema cannot see reserve transfers, so we do not claim to have caught it — flagging it here so nobody is surprised if a judge asks.

### The doctored document

`scripts/make_doctored.py` changes one digit: total assets 8**5**3,283,605 → 9**5**3,283,605. The identity fails by RM100m, three keys are quarantined, and gearing, ROE and the entire Z-score are withheld rather than printed on top of a bad figure. Current ratio and the margins survive untouched — a failure is contained, not contagious.

Say this in the demo rather than letting a judge find it: the identity runs at a 1% tolerance, so a *small* tamper (853.3m → 858.3m, 0.59%) passes by design. Rounding in published accounts has to be absorbed somewhere. Owning that is stronger than implying the engine catches every possible edit.

---

## Findings the Backend lane needs

1. **Seacera prints in full ringgit, not RM'000.** §5.1 suggests filtering `find_pages()` false positives by requiring an `RM'000` header — that would reject every real statement page in this document. `scripts/check_find_pages.py` requires a currency token plus a year pair instead, which works for both conventions.

2. **The statement of changes in equity is printed sideways (pp.82–83).** pdfplumber returns those words with `upright=False` and the characters **reversed** — `081,617,63` for 36,716,180. `find_bbox()` as sketched in §5.1 compares only the forward string, so it silently misses every figure on that page and `retained_earnings` lands amber. Compare the reversed string too. `scripts/build_fixture.py::find_bboxes` has the working version; that fix took bbox resolution from 36/38 to **38/38**.

3. **`find_bbox()` returning the first match is not safe.** These statements print four numeric columns — Group 2024, Group 2023, Company 2024, Company 2023. Take the leftmost match for the Group current year, and be aware three values are genuinely ambiguous on the page.

4. **Use `scripts/check_find_pages.py` and the verified page list**, not the matcher alone. It finds all four sections but also returns notes-section pages that mention "statements of financial position". `extraction_pages` in `fixtures/demo_documents.json` is the five-page shortlist: **78, 80, 81, 82, 85**.

5. **Pages are 1-based PDF pages** throughout the fixture. Render page images on the same convention.

---

## Peer benchmark (§4.4) — real data

`scripts/fetch_peers.py` has been run. `fixtures/sector_peers.json` now carries **real yfinance data for 7 Bursa building-materials companies**, each verified by name before inclusion, with Seacera itself excluded so it does not help set the median it is measured against.

Kim Hin Industry (5371), White Horse (5009), YB Ventures (5048), Chin Hin Group (5273), Malayan Cement (3794), Hume Cement Industries (5000), Cahya Mata Sarawak (2852).

| Metric | Seacera | Sector median | Percentile | Verdict |
|---|---|---|---|---|
| Current ratio | 1.29 | 2.08 | 0 | WORSE |
| Gearing | 0.0001 | 0.10 | 86 | BETTER |
| Interest cover | 35.85 | 4.19 | 86 | BETTER |
| Gross margin | 12.26% | 27.90% | 14 | WORSE |
| Net margin | 6.72% | 2.63% | 71 | BETTER |
| Return on equity | 0.49% | 1.93% | 43 | WORSE |

Three better, three worse — a more credible chart than a clean sweep, and it yields a real pitch line: **Seacera carries almost no debt and covers its finance costs 36 times over, but converts less than half the sector's gross margin and earns a quarter of its return on equity.** A single set of statements cannot tell you that.

Two caveats to state if asked. Peer year-ends are not aligned — each ratio uses that peer's most recent reported year. And size dispersion is wide, RM17m to RM9bn market cap; we compare ratios rather than absolutes, and use medians rather than means precisely because some peers are loss-making outliers.

## Still open

Nothing blocking. One thing to keep straight:

**Two different market-cap periods.** The FY2024 Altman Z uses the **RM133.76m** printed in the report, contemporaneous with the statements — and during FY2024 the market cap actually *rose* 19.4% from RM111.99m, so the market agreed with management at the time. Since then the stock has gone MYR 0.200 → 0.060, **−70% over two years**, and the market cap is now RM37.3m. That is a striking epilogue, but it is *not* an input to the FY2024 score. Conflating the two periods would be exactly the sloppiness this tool exists to catch.
