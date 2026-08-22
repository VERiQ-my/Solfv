from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import payment_api
from .config import get_settings
from .market_api import router as market_router
from .paper_order_api import router as paper_order_router
from .payment_api import router as payment_router

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    ledger = payment_api.active_ledger
    if ledger is not None and hasattr(ledger, "close"):
        ledger.close()


app = FastAPI(title="Solfv Payment Gateway", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
    expose_headers=["PAYMENT-REQUIRED"],
)
app.include_router(payment_router)
app.include_router(market_router)
app.include_router(paper_order_router)


@app.get("/healthz", tags=["operations"])
def healthz() -> dict[str, str]:
    return {
        "status": "ok",
        "network": settings.solana_network,
        "commitment": settings.solana_commitment,
    }
