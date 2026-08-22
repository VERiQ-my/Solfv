# Local Demo Runbook

## Requirements

- Python 3.11+
- Node.js 20+
- Phantom browser wallet configured for Solana Devnet
- Devnet SOL for transaction fees
- Devnet USDC for the payment demonstration

## Start the financial-analysis engine

```powershell
cd engine
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

## Start the frontend

In a second terminal:

```powershell
npm install
npm run dev
```

Open the Vite URL printed in the terminal.

The frontend expects the engine at `http://127.0.0.1:8000`. Set `VITE_API_BASE` if the backend uses another address.

## Payment environment

The Solana payment implementation uses backend environment variables. Never commit `.env` or private keys.

```text
PAYMENT_MODE=devnet
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
PAYMENT_RECIPIENT=<public merchant wallet>
PAYMENT_AMOUNT_BASE_UNITS=<small devnet amount>
DATABASE_URL=<Supabase PostgreSQL connection string>
COINGECKO_DEMO_API_KEY=<backend-only key, optional for low-volume public access>
DEEPSEEK_API_KEY=<backend-only key, optional for live extraction>
```

## Suggested judge path

1. Run the verified extraction fixture.
2. Run the doctored-document fixture.
3. Show the failed reconciliation and quarantined values.
4. Open the provenance view and click a figure to show its source cell.
5. Open Market Intelligence and load live crypto data.
6. Open the Solana paper-investment flow.
7. Select an asset and create the paper-order request.
8. Confirm the HTTP 402 challenge.
9. Connect Phantom on Devnet and approve the small USDC payment.
10. Show Solana verification, Supabase ledger storage, and the paper receipt.

## Verification commands

```powershell
cd engine
.venv\Scripts\python tests\test_analysis.py

cd ..
npm run build
```

## Failure fallback

If external APIs are unavailable, show the deterministic fixture demo and state that the live market/payment integration is network-dependent. Do not invent live values or claim that a simulated payment settled on-chain.
