# Project context — AI financial report analysis + Solana payment gateway

## What this is

Entry for DevLeague x TalentLabs 2026, combining two lab tracks in one project:

- **Lab 1 — AI-Powered Financial Report Analysis** (sponsored by Experian): build an AI tool that extracts, analyses, and explains financial reports (PDF/spreadsheet), with PDPA-compliant data handling.
- **Solana Lab — AI and Agentic Commerce (x402 theme)**: use Solana to let AI agents transact — pay-per-API-call, usage-metered access, machine-to-machine micropayments.

The two tracks are combined into one submission (ticking the Solana box on the DevLeague form). Solana is not a bolted-on wallet connect — it is the access-control layer for the paid part of the pipeline, and it doubles as the compliance audit anchor. Removing it removes both the monetization and the audit proof at once, which is the direct answer to the Solana judging criterion "could this have been a database."

## Full pipeline (for context — this task builds one stage of it)

```
INGEST      PDF (native + scanned), XLSX, CSV
            pdfplumber / Docling for layout + tables
            PaddleOCR / Tesseract fallback for scans
   |
PRIVACY GATE
            Presidio + Malaysian PII recognisers -> mask -> local Privacy Ledger
            Deterministic, local, runs BEFORE any external/LLM call
   |
EXTRACT     Ensemble: layout parser + vision LLM, structured JSON output
            Mapped to a canonical chart of accounts
            Every field: {value, unit, currency, period, page, bbox, method, confidence}
   |
VERIFY      Reconciliation engine (pure Python, no AI)
            Pass -> Verified | Fail -> Quarantine -> review queue
            Trust tiers: VERIFIED / DERIVED / UNVERIFIED
   |
=====================================================
>>> SOLANA PAYMENT GATE  <-- THIS TASK BUILDS THIS STAGE
=====================================================
   |
ANALYSE     Ratio pack, common-size, trend, YoY
            Altman Z'' , Beneish M, Piotroski F, Benford's Law, DuPont
            Covenant simulator, Say-Do Gap engine
   |
PRESENT     Split-screen dashboard with click-to-source
            Grounded chat (refuses when no cited figure exists)
            Auto-generated credit memo (PDF/DOCX export)
            REST API endpoint
```

Ingest, Privacy gate, Extract, and Verify run free — that's the trust signal ("we checked your data before charging you"). Analyse and Present are the paid product, unlocked only after payment clears.

## This task: the Solana payment gateway

### Where it sits

Gate sits between VERIFY and ANALYSE. Two consumers need to pass through it:

1. **Human via UI** — uploads a report, sees free-tier verification results, pays via a connected wallet to unlock full analysis.
2. **AI agent via REST API** — calls the API endpoint programmatically and pays per call, no account, no subscription. This is the primary "agentic commerce" story for the Solana Lab judges — prioritize this path being genuinely functional, not just the wallet-button demo.

### Core requirements

- Solana **devnet only** (never mainnet — hackathon submission constraint).
- x402-style flow: server returns HTTP 402 with payment requirements (amount, recipient address, SPL-USDC-devnet mint) when paid tier is requested without proof of payment.
- Payment must be **verified server-side** against Solana RPC before releasing paid output — never trust a client-submitted "I paid" flag alone. Check: transaction exists, is confirmed, transferred the correct amount to the correct recipient.
- The payment transaction must carry a **memo**: a SHA-256 hash of the Verify-stage result JSON for that report. This is the audit anchor — one transaction does two jobs (payment + tamper-evident proof of what was verified and when). Use Solana's built-in Memo program for this, not a custom on-chain program.
- **Never write raw PII on-chain.** Only hash commitments go in the memo. The Privacy Ledger with actual PII stays fully off-chain/local — this is a hard PDPA constraint, not a style preference.

### Tech stack constraints

- **Backend: FastAPI (Python).** Implement payment verification in Python — `solders` or `solana-py` for RPC calls (`getTransaction`, checking instructions/amount/recipient/memo) — rather than pulling in a Node/TypeScript middleware. Keep the whole backend in one language.
- **Frontend: Next.js.** Wallet-connect UI (`@solana/wallet-adapter-react` + `@solana/wallet-adapter-wallets`) for the human-facing payment flow. Construct the devnet USDC transfer + memo instruction client-side, send it, then submit the resulting transaction signature to the backend for verification.
- Reference material: Solana's official x402 templates and the `x402-solana` npm package are real, maintained implementations of this pattern (TypeScript-first) — useful as a reference for the client-side flow even if the backend verification is reimplemented in Python.

### Build tasks, in order

1. FastAPI dependency/middleware: given a report/session ID, check whether a valid payment has been recorded; if not, return 402 with `{amount, recipient, mint, memo_required: <hash>}`.
2. Endpoint `POST /verify-payment`: accepts a transaction signature, checks it on devnet (amount, recipient, memo match), and on success marks that report/session as paid and unlocked.
3. Once unlocked, allow the Analyse and Present stages to run for that report/session (previously gated).
4. Compute the SHA-256 hash of the Verify-stage JSON result as soon as Verify completes, and expose it to the client so the wallet transaction can include it as the memo.
5. Next.js wallet-connect component: connect wallet -> show price -> build and send the devnet USDC transfer with memo -> submit signature to `/verify-payment` -> on success, fetch and render Analyse/Present.
6. Same gate applied to the REST API endpoint, keyed by API caller instead of a browser session, so an external agent can call it and pay per request without any UI.

### Explicit non-goals for this task

- No investment or trading functionality — this is pay-for-a-service only, never advice to buy/sell/invest.
- No CTOS integration (dropped — direct competitor to the lab sponsor, Experian).
- No mainnet code paths.

## Judging criteria this feature is scored against

**Lab 1**: Technical Execution 25%, Impact & Potential 20%, Problem & Lab Alignment 20%, Innovation & Creativity 20%, UX & Design 15%.

**Solana Lab**: Functionality (live demo preferred over slides), Solana Integration (must be doing critical work, not a bolted-on wallet connect), User Value (would a real person use this), Progress (especially generous for first-time builders).

## Note on timing

## Research findings and implementation plan

### Decisions locked for the MVP

- Network: Solana devnet only. Mainnet values must be rejected at startup.
- Asset: Circle Solana devnet USDC, mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, 6 decimals.
- Protocol: x402 v2 `exact` scheme for the agent API, with a browser-compatible payment confirmation endpoint.
- Amount: fixed integer micro-USDC amount, exact equality required by this application.
- Transfer: standard SPL Token `TransferChecked` in the MVP; Token-2022 and smart wallets are later work.
- Memo: `solfv:v1:<sha256>` from canonical Verify-stage JSON. Never put report contents or PII on-chain.
- Confirmation: configurable, `confirmed` for the demo and `finalized` for stronger settlement assurance.
- Demo fallback: `PAYMENT_MODE=simulated` preserves the x402 HTTP challenge and memo/ledger checks without claiming on-chain settlement; `devnet` remains the live adapter.
- Payment state: persisted and idempotent; a transaction signature can be consumed only once for its bound report/session and Verify hash.
- Persistence: shared Supabase PostgreSQL database used by the backend; the local SQLite adapter is test-only.
- Merchant wallet: public address is client-visible; private keys never enter the frontend.

### Principal risks and controls

- Fake signatures: fetch and validate the transaction server-side; never trust a client paid flag.
- Wrong asset or recipient: compare the actual mint and derived destination ATA to server configuration.
- Amount errors: use integer base units, never floating point.
- Memo tampering: require exactly one matching Memo instruction and calculate the expected hash on the server.
- Replay and races: unique transaction signatures, resource binding, atomic state transitions, and idempotent analysis.
- Forks/RPC lag: use commitment-aware retries and fail closed when the RPC cannot establish payment state.
- Wallet differences: support Phantom and Solflare first, then add versioned transactions, Token-2022, and smart-wallet paths deliberately.
- Privacy: only a commitment hash goes on-chain; keep the Privacy Ledger and report data off-chain.
- Abuse: rate-limit signature verification, bound request sizes, protect expensive analysis, and avoid logging raw report data.
- Payment followed by analysis failure: persist verified payment separately and allow paid retries.

### Phased task checklist

#### Phase 0 - payment contract

- [x] Lock devnet network, RPC, USDC mint, decimals, amount, timeout, and commitment defaults.
- [x] Define the versioned memo format and canonical Verify JSON contract.
- [x] Set the real merchant recipient wallet: `GG8RDLrDoBfvdqZuJrRT2xFsVAE7R2MKsGzCrpMHSzwP`.
- [ ] Define report/session binding and API caller identity rules.
- [ ] Define payment state transitions and idempotency rules.
- [ ] Define the x402 v2 request/402/retry/receipt contract.

#### Phase 1 - foundation

- [x] Create FastAPI backend and Next.js frontend structure.
- [x] Add dependency manifests and environment templates.
- [x] Validate payment configuration at startup and reject mainnet configuration.
- [ ] Add structured, privacy-safe logging and health checks beyond the initial `/healthz` endpoint.

#### Phase 2 - Verify hash

- [x] Implement deterministic JSON canonicalization and SHA-256 hashing.
- [ ] Persist hash, canonicalization version, memo, and report/session binding.
- [ ] Expose payment requirements to the client.
- [x] Add hash regression tests.

#### Phase 3 - payment ledger

- [x] Create the Supabase PostgreSQL payment schema, indexes, RLS, unique constraints, and verified state transition.
- [x] Implement idempotent PostgreSQL payment lookup and recording.

#### Phase 4 - HTTP 402 and verification

- [x] Return x402 v2 payment requirements for unpaid analysis requests in simulated mode.
- [x] Verify simulated amount, mint, recipient, payer, memo, and signature binding.
- [x] Implement simulated retry handling, clear rejection reasons, idempotency, and unlock recording.
- [x] Implement live devnet transaction verification for existence, status, commitment, mint, destination-token-account owner, amount, payer, and memo.
- [ ] Connect the frontend wallet transaction builder to the live `/verify-payment` endpoint.

#### Phase 5 - browser wallet

- [x] Build the simulated x402 browser flow with a visible 402 challenge and unlock state.
- [ ] Connect Phantom and Solflare on devnet.
- [ ] Build `TransferChecked` plus Memo transaction.
- [ ] Submit the payment payload/signature and unlock paid analysis.
- [ ] Handle pending, rejected, expired, and RPC-lag states.

#### Phase 6 - agent API

- [x] Add a runnable simulated Python agent showing the 402 challenge and retry flow.
- [ ] Protect the REST analysis route with x402 v2.
- [ ] Accept serialized Solana payment payloads and return a payment receipt.
- [ ] Bind each payment to the requested resource and Verify hash.
- [ ] Add Python and JavaScript client examples.

#### Phase 7 - analysis integration

- [ ] Gate Analyse and Present on verified payment.
- [ ] Make analysis jobs retryable and idempotent.
- [ ] Preserve paid access when analysis fails after payment.

#### Phase 8 - security and operations

- [ ] Add rate limits, request limits, RPC circuit breakers, metrics, and audit logs.
- [ ] Add devnet wallet/faucet setup and merchant ATA readiness checks.
- [ ] Add deployment configuration with devnet-only safeguards.

#### Phase 9 - verification and demo

- [ ] Test valid, wrong-mint, wrong-recipient, wrong-amount, failed, missing-memo, wrong-memo, duplicate, replay, race, and RPC-lag cases.
- [ ] Test Phantom and Solflare end to end.
- [ ] Test an external x402 agent client end to end.
- [ ] Demonstrate the memo hash matches the Verify result and that tampering fails.

### Scope deliberately deferred

- Mainnet support, Token-2022, smart wallets, sponsored gas, dynamic recipients, usage-based billing, multi-chain payments, refunds, subscriptions, and custom Solana programs.

### Research sources

- [x402 v2 specification](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md)
- [x402 exact Solana scheme](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_svm.md)
- [x402 FastAPI seller quickstart](https://docs.x402.org/getting-started/quickstart-for-sellers)
- [Solana getTransaction RPC](https://solana.com/docs/rpc/http/gettransaction)
- [Solana transaction confirmation](https://solana.com/developers/cookbook/transactions/confirmation)
- [Solana payment address verification](https://solana.com/docs/payments/send-payments/verify-address)
- [Solana SPL token basics](https://solana.com/docs/tokens/basics)
- [Circle USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)
- [Supabase PostgreSQL connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)

The Solana Lab's content-award track (X/Twitter post tagging @SuperteamMY and @talentlabsinc) has its submission deadline today, August 22, 5PM. That's separate from the core project submission — confirm the main deadline on the DevLeague form if it isn't already locked in.
