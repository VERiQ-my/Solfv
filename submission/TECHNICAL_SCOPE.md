# Technical Scope and Status

## Implemented

- Deterministic accounting reconciliation.
- Trust labels: VERIFIED, DERIVED, UNVERIFIED.
- Quarantine before ratio calculation.
- PDF page targeting and bounding-box provenance.
- Say-Do analysis, ratios, risk, and benchmark modules.
- Privacy detection and session purge behavior.
- Supabase audit-history integration in the engine.
- Solana devnet payment verification service.
- SPL USDC amount, mint, recipient, payer, status, and memo checks.
- SHA-256 report binding.
- Supabase `public.payments` payment ledger.
- Phantom browser transaction flow in the payment frontend.
- Live CoinGecko and GeckoTerminal crypto-market endpoints.
- Simulated paper-order receipt after verified payment.

## Optional or configuration-dependent

- DeepSeek live extraction requires `DEEPSEEK_API_KEY`.
- Supabase Auth requires the frontend Supabase variables.
- Live market data requires provider availability and may use a backend-only API key.
- Solana payment requires Devnet SOL, Devnet USDC, and a configured merchant public wallet.

## Deliberately out of scope

- Mainnet payments.
- Real crypto purchase execution.
- Custody or private-key handling.
- Exchange integration.
- Automated portfolio management.
- Guaranteed investment recommendations.
- Full coverage of every crypto asset.
- Production licensing and compliance readiness.
