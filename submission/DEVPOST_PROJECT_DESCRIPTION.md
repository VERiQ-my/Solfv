# SOLFV

## One-line description

SOLFV turns long company financial reports into verified, explainable financial intelligence, then adds live crypto-market research and an optional Solana-powered paper-investment workflow.

## Labs tackled

- AI and agentic commerce
- Solana Lab: payments and x402
- Financial intelligence and customer experience

## Problem

Credit and financial analysts spend hours extracting figures from long annual reports. An LLM can make this faster, but a plausible number can still be wrong. Without reconciliation and provenance, downstream ratios and risk scores can be built on data nobody can verify.

## Solution

SOLFV uses AI for structured extraction, then applies deterministic accounting checks before any ratio or risk conclusion is produced. Each figure carries a trust status and source location. Failed figures are quarantined, dependent ratios are withheld, and users can click from a number to its source cell in the report.

The platform also provides live cryptocurrency market intelligence. DeepSeek is used as a research assistant to explain crypto candidates and risks from validated financial data and current market data. The output is research support for human review, not guaranteed investment advice.

## How it works

1. A user uploads a financial report.
2. Relevant pages are targeted and sensitive data is masked locally.
3. A vision model extracts structured figures and source coordinates.
4. Deterministic reconciliation checks validate the extraction.
5. Failed values are quarantined before ratios and risk calculations.
6. The user reviews financial analysis and live crypto-market intelligence.
7. For the optional paper-investment workflow, the user selects an asset and amount.
8. Solana x402 returns an HTTP 402 payment challenge.
9. Phantom signs a low-value devnet USDC payment.
10. The backend verifies the transaction and records it in Supabase.
11. SOLFV creates a paper-order receipt using a live reference price.

No real cryptocurrency is purchased or transferred in the prototype.

## Technology

- Python and FastAPI
- Pure Python deterministic analysis modules
- React, TypeScript, Vite, and Tailwind
- DeepSeek vision extraction and analyst integration where configured
- Solana devnet
- Phantom wallet
- SPL USDC and memo verification
- x402-style HTTP 402 payment flow
- Supabase PostgreSQL
- CoinGecko and GeckoTerminal live crypto data
- PDF text extraction, rendering, and bounding-box provenance

## Target users

- Credit analysts
- Financial analysts
- Enterprise risk teams
- Compliance and audit teams
- AI agents accessing paid analysis APIs

The product is designed as an Experian-aligned enterprise prototype. It is not presented as an official Experian product unless separately authorized.

## What makes SOLFV different

The key idea is: **The model extracts. The arithmetic decides.**

The system does not rely on an LLM claiming that an answer is correct. It checks whether the extracted figures close mathematically, traces them to the source document, and refuses to calculate dependent conclusions when the evidence is insufficient.

## Prototype boundaries

- Analysis is free in the current flow.
- Solana payment is used for the optional simulated paper-order action.
- The payment uses Solana devnet USDC only.
- No real crypto trade, custody, exchange execution, or investment transfer is performed.
- Crypto output is research support for human review.
- Production deployment would require security, legal, licensing, data-licensing, and exchange-partner review.
