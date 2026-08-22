# SOLFV

**The model extracts. The arithmetic decides.**

A credit analyst spends hours turning PDF financial statements into a lending
decision, and most of that time is retyping numbers. Tools that automate it with
a language model hallucinate figures — and in credit risk, a made-up number is a
bad loan.

SOLFV inverts the trust relationship. The LLM is allowed to *transcribe*, and
nothing else. Every figure it produces is then reconciled against accounting
identities by deterministic code with no model in the loop. A figure that fails
is **quarantined** and never reaches the dashboard, and every ratio built on it
is withheld rather than estimated.

---

## Running it

Two processes: the Python engine and the Vite frontend.

```bash
# 1. Engine  (from engine/)
cd engine
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt      # Linux/macOS: .venv/bin/pip
.venv/Scripts/python -m uvicorn backend.main:app --port 8000

# 2. Frontend  (from the repo root, in a second terminal)
npm install
npm run dev
```

Open the URL Vite prints. The frontend expects the engine on
`http://127.0.0.1:8000`; override with `VITE_API_BASE` if you move it.

Nothing else is required to see the whole system work — the **Verified
extraction** and **Doctored document** buttons on the landing screen run the
full pipeline against hand-verified fixtures, with no API key and no PDF.

### Optional configuration

Read from `.env` at the repository root (both `KEY=value` and `KEY: 'value'`
are accepted), or from the real environment, which always wins.

| Variable | Default | Effect |
|---|---|---|
| `DATABASE_URL` | unset | Preferred server-side PostgreSQL/Supabase connection for the audit history. |
| `SUPABASE_URL` | unset | REST fallback for audit history. Accepts the project URL or the `/rest/v1` endpoint. |
| `SUPABASE_ANON_KEY` | unset | REST fallback key. `SUPABASE_SERVICE_KEY` is used in preference if set. |
| `DEEPSEEK_API_KEY` | unset | Enables live vision extraction. Without it, uploads fall back to the verified fixture and say so in the UI. |
| `DEEPSEEK_VISION_MODEL` | `deepseek-v4-flash-vision-exp` | The only DeepSeek model that accepts images. |
| `PAYMENT_REQUIRED` | `false` | Enforces the Solana metering gate. Deliberately off. |
| `SOLANA_TREASURY` | unset | Settlement address. |
| `VITE_API_BASE` | `http://127.0.0.1:8000` | Where the frontend looks for the engine. |
| `VITE_SUPABASE_URL` | unset | Switches sign-in to Supabase Auth. The project URL, not the `/rest/v1` endpoint. |
| `VITE_SUPABASE_ANON_KEY` | unset | The anon JWT the browser uses for auth. Never the service key. |
| `VITE_AUTH_MODE` | unset | Set to `local` only for development browser-local accounts. |
| `SOLFV_AUTH_MODE` | `supabase` | Engine auth mode; set to `local` only for development. |
| `SOLFV_ENVIRONMENT` | `development` | Must not be `production` when local auth is enabled. |
| `SOLFV_CORS_ORIGINS` | localhost dev URLs | Comma-separated allowed frontend origins for the engine. |

---

## Accounts

The app is behind a login. There are two backends and the frontend picks one at
boot from what is configured:

| | `VITE_SUPABASE_*` set | unset |
|---|---|---|
| Accounts | Supabase Auth, shared across devices | This browser only |
| Password | Held by Supabase | PBKDF2-SHA256, random per-account salt, in `localStorage` |
| Session | JWT, refreshed automatically | A user id in `localStorage` |

The local mode exists for the same reason the demo document does: the whole
system has to be runnable with no keys. The sign-up screen says which mode it
is in rather than implying an account system that is not there.

The engine verifies the Supabase access token on every application endpoint.
Only `/health` is public. In production it rejects local browser accounts, and
audit records are scoped to the authenticated user's id.

Both screens land on the **Command Center**, which aggregates the persisted
audit history and therefore has something to say before a single document is
inserted. The Analysis Lab's own insert panel is the empty state for a library
with nothing in it.

Signing out purges the tab: every in-memory document goes with it, and the
engine sessions behind them expire on their own TTL. Signing in as someone else
starts from an empty library rather than inheriting the last analyst's queue.

Two Supabase details worth knowing:

- If the project requires **email confirmation**, sign-up returns no session.
  The screen says so and sends you to log in, rather than dropping you on a
  dashboard that cannot load.
- Auth is unrelated to the audit history. The browser still never talks to
  Supabase for data — it reads `GET /history` from the engine, which holds the
  server-side key.

---

## Supabase — the audit history

Persistence is deliberately narrow. Supabase stores **reconciled results**, not
documents:

| Stored | Never stored |
|---|---|
| Canonical figures, check outcomes, ratios | The uploaded PDF or spreadsheet |
| Z-score, zone and drivers | Rendered page images |
| Say–Do verdicts, benchmark rows | Any detected personal-data **value** |
| Two PII **counts**: detected, transmitted | — |

That split is what lets the product keep saying documents are processed in
memory and purged on a timer. The count is the compliance claim; the value
would be the exposure. There is no code path in `backend/store.py` that can
write a document, an image, or a PII value, and no column in the schema that
could hold one.

**Setup:** set `DATABASE_URL`, install the engine requirements, and apply the
schema once with `cd engine && .venv/Scripts/python scripts/migrate.py`.
Alternatively, run `engine/schema.sql` in the Supabase SQL editor and use the
`SUPABASE_URL` plus `SUPABASE_ANON_KEY` REST fallback. Check either with:

```bash
curl -s localhost:8000/health | python -m json.tool   # look at "storage"
```

The key stays server-side — the browser never talks to Supabase, it reads
`GET /history` from the engine.

Every write fails soft. If Supabase is unreachable or misconfigured, the
analysis still completes and the failure surfaces as a warning on the session
rather than an error. Persistence is a convenience, never a dependency.

The schema enables row-level security and supplies no anonymous access policy.
The engine connects directly to PostgreSQL and scopes every query by the
authenticated owner id. There are deliberately no `update` or `delete`
policies: an audit history callers can rewrite is not an audit history.

---

## Cloudflare free deployment (`solfv.veriq.my`)

The repository includes a Cloudflare Worker that serves the Vite app and
proxies `/api/*` to a separately hosted Python engine. The static frontend and
proxy run on the Workers Free plan; the custom-domain route is configured for
`solfv.veriq.my`.

Before the first deploy, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
as build-time variables in an uncommitted `.env.production.local` (they are
public browser configuration, never a service-role key). Then run:

```bash
npm run deploy
```

After deployment, add the Worker plain-text variable `ENGINE_ORIGIN`, for
example `https://engine.example.com`. The Worker forwards `/api/*` to that
engine while the browser remains on `solfv.veriq.my`; do not append `/api` to
the value. The engine needs server-side `DATABASE_URL`, `SUPABASE_URL`, and
`SUPABASE_ANON_KEY` configuration.

The free Worker cannot run the included Python/Docker engine. A free external
host can be used but typically sleeps when idle; a Cloudflare Tunnel is also
free but needs a machine that stays online.

### Local engine via Cloudflare Tunnel

This repository is configured for a named tunnel at `api.solfv.veriq.my`.
`solfv-engine` (the FastAPI engine) and `solfv-tunnel` (the connector) run as
Docker containers on the same private Docker network and use
`--restart unless-stopped`. The engine exposes port 8000 only on
`127.0.0.1`; the tunnel is the only public path to it.

For the API to remain available, keep this Windows machine powered on, online,
and ensure Docker Desktop starts after sign-in. Check both services with:

```bash
docker ps --filter name=solfv-engine --filter name=solfv-tunnel
curl https://solfv.veriq.my/api/health
```

The tunnel credentials are kept outside the repository in the user
`.cloudflared` directory. Treat them as secrets and revoke the tunnel from the
Cloudflare dashboard if this computer is no longer trusted.

---

## How it works

```
upload ─┬─ PDF  ─→ page targeting ─→ privacy gate ─→ render ─→ vision LLM ─┐
        │              (8 of 179 pages)   (local, pre-flight)              │
        └─ XLSX ─→ column mapping ────────────────────────────────────────┤
                                                                          ↓
                                              Contract 1 (extraction JSON)
                                                                          ↓
   ┌──────────────────────── analysis/ · pure stdlib ────────────────────────┐
   │  derive → reconcile → quarantine → ratios → risk / benchmark / say-do   │
   └────────────────────────────────────────────────────────────────────────┘
                                                                          ↓
                                                   Contract 2 (API surface)
```

The `analysis/` package does no file I/O, no network, and imports no framework.
It runs on a bare interpreter with nothing installed — so if pdfplumber,
PyMuPDF or the model provider fall over, the reconciliation engine and the
Say–Do Gap still work.

### The reconciliation checks

Three identities, deterministic, no AI:

| Check | Formula | Tolerance |
|---|---|---|
| Balance sheet identity | `total_assets == total_liabilities + total_equity` | 1% |
| Current assets composition | `current_assets == cash + receivables + inventory` | 5% |
| Retained earnings roll-forward | `re_close == re_open + pat - dividends` | 1% |

The composition check is looser and labelled a *composition* check rather than
an identity: prepayments and tax recoverable legitimately sit in current assets
with no canonical key, so it under-sums in real reports.

A check whose inputs are absent reports **UNVERIFIABLE** and quarantines
nothing — a missing prior year is our gap, not evidence against the figure.

### Trust levels

- **VERIFIED** — traced to a source cell and cleared by every check covering it
- **DERIVED** — computed from other figures, never printed in the document
- **UNVERIFIED** — implicated in a failing check, or no source cell was found

---

## What the screens do

Six destinations in the sidebar. Analysis carries the engine's lenses as tabs,
because each is a view of one selected document and means nothing without it.

| Screen | Purpose |
|---|---|
| **Log in / Sign up** | The way in. Both land on the Command Center. See [Accounts](#accounts). |
| **Dashboard** — Command Center | Every reconciliation ever run, aggregated from the persisted audit history. Verdict totals, distress distribution, PII counts. |
| **Analysis** — Analysis Lab | The hub. Every document finance inserted, queued and reconciled, each with its own session and purge timer. |
| ↳ Overview | One document's verdict: reconciliation results with expected vs actual, and the ratio pack. |
| ↳ Provenance | Every figure beside the source cell it was read from, click to box it on the page. |
| ↳ Say–Do Gap | Management's narrative claims tested against the reconciled figures. |
| ↳ Sector Benchmark | Each ratio against its Bursa sector median. |
| ↳ Credit Risk | Altman Z with per-component driver contributions. |
| **Market Intelligence** | The engine's market feed for the sector the document sits in. |
| **Expense Management** | The selected document's cost structure. |
| **Solana Investments** | The payment surface and the settlement gate. |
| **Privacy Settings** | The detection ledger and the live purge countdown. |

---

## Design decisions worth defending

**No vector search.** RAG solves *"I don't know where in the corpus the answer
is"* — a problem eliminated upstream by page targeting plus structured
extraction. Once a figure is `{canonical_key, value, page, bbox}`, retrieval is
a dict lookup: exact rather than top-k, cell-level rather than chunk-level, and
— the row that matters — **able to prove absence**. `key not in ratios` is a
fact. A vector search returns the nearest chunks whether or not anything
relevant exists, so its not-found guardrail means asking a model to judge
relevance, which is exactly the judgement that fails under pressure.

**No database.** Documents are processed in memory and purged on a timer the UI
counts down in front of you. There is nothing to breach because nothing is
stored.

**Privacy is architectural, not a policy.** PII is detected locally before any
external call. In the demo document that is 6 entities — and because extraction
targets only the 8 pages of 179 carrying the financial statements, the pages
holding personal data are pages that are never transmitted at all. Zero
transmitted is a property of the design.

**Payment is off the critical path.** The metering gate defaults to off. An RPC
timeout must never stand between a reviewer and the reconciliation engine.

---

## Known limitations

Blunt, because knowing what you did not build is part of the engineering:

- **Native-text PDFs only.** No OCR. A scanned document is rejected, loudly.
- **Tuned to one report format.** Malaysian annual reports with a classic
  balance sheet. Banks, insurers and REITs use liquidity-ordered balance sheets
  with no current/non-current split, which makes half the ratio pack undefined.
- **A 20-key chart of accounts.** Anything outside `CANONICAL_KEYS` is dropped
  by validation rather than guessed at.
- **Single-process, in-memory sessions.** No horizontal scaling, no persistence,
  no recovery after a restart. This is deliberate, but it is still a limitation.
- **The peer set is a committed fixture,** not a live market data pull.
- **Vision extraction is experimental** and falls back to a hand-verified
  fixture when unavailable — the UI states this rather than hiding it.
- **No merged-cell spreadsheet handling.** XLSX ingestion expects a label
  column and a value column.

---

## Tests

```bash
cd engine
python tests/test_analysis.py     # 13 tests, pure stdlib
python backend/pages.py           # page targeting against the demo document
python backend/bbox.py            # re-derives every bbox and diffs the fixture
```

The frontend typechecks with `npx tsc --noEmit` and builds with `npm run build`.
