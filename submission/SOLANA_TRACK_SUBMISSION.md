# Solana Lab Submission

## Why Solana

SOLFV uses Solana as a machine-native payment rail for an optional paper-investment workflow. The user or an AI agent can request an action, receive an HTTP 402 payment requirement, settle a low-value devnet USDC payment, and receive a verified receipt.

Solana is not a decorative wallet connection. The backend verifies the payment on-chain and records the verified transaction in the Supabase payment ledger before the paper order is created.

## Solana flow

```text
Paper-order request
        -> HTTP 402 payment requirements
        -> Phantom signs devnet USDC + memo
        -> Solana RPC verification
        -> Supabase payment ledger
        -> Simulated paper-order receipt
```

## What is demonstrated

- Solana devnet transaction settlement.
- SPL USDC TransferChecked verification.
- Exact amount, mint, recipient, payer, status, and memo checks.
- SHA-256 report binding through the memo.
- Idempotent payment recording.
- A payment receipt linked to a paper-order resource.

## What is not claimed

The prototype does not execute a real cryptocurrency investment. No target asset is purchased, transferred, or held. The devnet payment demonstrates the x402 payment and verification layer; the resulting order is a paper transaction.

## Evidence for judges

- Public code branch: `solana-payment-gateway`.
- Backend health endpoint: `/healthz`.
- Crypto market endpoint: `/v1/market/crypto`.
- Solana market endpoint: `/v1/market/solana`.
- Payment verification endpoint: `/v1/reports/{resource_key}/verify-payment`.
- Paper-order endpoint: `/v1/reports/{resource_key}/paper-orders`.
- Supabase table: `public.payments`.
- Automated backend tests include transaction verification and rejection cases.

## Solana Lab focus

This project targets AI and agentic commerce. The same payment contract can support a human wallet flow or an external agent client that requests a paid paper-order action and retries after receiving HTTP 402.
