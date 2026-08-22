# Agent demo

Start the FastAPI server from `backend/`, then run:

```powershell
python examples\simulated_agent.py
```

The client demonstrates the x402 sequence:

1. Request the paid analysis endpoint.
2. Receive HTTP `402` and payment requirements.
3. Construct a simulated payment payload using the required memo.
4. Retry the request and receive the unlocked response.

This example is intentionally marked simulated. It does not transfer funds on Solana.
