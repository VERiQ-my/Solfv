"""Section 2.3 - Contract 2. Five endpoints, plus the demo entry points.

The one rule this file exists to honour: `analyse()` is called once and its
result is returned **verbatim**. Nothing here reshapes, rounds, or re-badges a
figure. Every judgement about trust was already made deterministically in
`analysis/`, and re-deriving any of it at the transport layer would put an
unchecked number back on the dashboard.

CORS is restricted to the deployed frontend. Every user-facing request carries
the browser's private guest-session identifier.
"""

from __future__ import annotations

import os
import pathlib
import shutil
import time

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from analysis.pipeline import analyse
from analysis.query import resolve_query

# The advisor and market modules read their settings at import time.
_ENV_ROOT = pathlib.Path(__file__).resolve().parents[1].parent
load_dotenv(_ENV_ROOT / '.env', override=False)

from . import (advisor, auth, crypto, extract, ingest, market, paper_order,
                payment, privacy, session, store)
from .bbox import resolve_bboxes
from .pages import resolve_pages

ROOT = pathlib.Path(__file__).resolve().parents[1]
# Load the repository-root .env when the engine is started from any directory.
# Environment variables already supplied by the shell remain authoritative.
load_dotenv(ROOT.parent / '.env', override=False)

# Printed on p.19 of the demo document's financial highlights. Used only as the
# fallback for the fixture path — a live feed supersedes it when one is
# configured and the ticker resolves.
DEMO_MARKET = {"market_cap": 133_760_000, "share_price_1y": 0.1944}

app = FastAPI(title="SOLFV", version="1.0",
              description="LLM extracts, deterministic math verifies.")

_cors_origins = [origin.strip() for origin in os.getenv(
    "SOLFV_CORS_ORIGINS",
    "http://127.0.0.1:3000,http://localhost:3000,http://127.0.0.1:3001,http://localhost:3001,http://127.0.0.1:5173,http://localhost:5173",
).split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins, allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-Solfv-Dev-User", "X-Solfv-Guest-User"],
)


@app.middleware("http")
async def authenticated_api(request: Request, call_next):
    """Require an authenticated principal before any user-facing endpoint."""
    if request.method == "OPTIONS" or request.url.path == "/health":
        return await call_next(request)
    try:
        request.state.user = auth.require_user(
            request.headers.get("authorization"),
            request.headers.get("x-solfv-dev-user"),
            request.headers.get("x-solfv-guest-user"),
        )
    except HTTPException as error:
        return JSONResponse({"detail": error.detail}, status_code=error.status_code)
    return await call_next(request)

PEERS = extract.load_peers()
DEMO_DOCS = extract.load_demo_documents()


@app.on_event("startup")
def _startup() -> None:
    session.start_sweeper()


# ---------------------------------------------------------------------------
# Shaping - the only place a response is assembled
# ---------------------------------------------------------------------------

def _envelope(record: dict) -> dict:
    """Session chrome that rides alongside every analysis response."""
    return {
        "session_id": record["session_id"],
        "expires_at": record["expires_at"],
        "expires_in": session.remaining(record),
        "ttl_minutes": session.TTL_MINUTES,
        "source": record.get("source"),
        "document": record.get("document"),
        "pages_total": record.get("pages_total"),
        "pages_rendered": sorted(record.get("page_images") or {}),
        "page_dimensions": record.get("page_dimensions") or {},
        "warnings": record.get("warnings") or [],
        "paid": record.get("paid", False),
    }


def _require(sid: str, owner_id: str) -> dict:
    record = session.get(sid)
    if record is None or record.get("owner_id") != owner_id:
        raise HTTPException(
            status_code=404,
            detail="Session not found. It expired and was purged, or never existed.",
        )
    return record


def _market_for(record: dict, extraction: dict, fallback: dict | None) -> dict | None:
    """Live market data for the extracted ticker, falling back on demand.

    The feed is enrichment, never a dependency: an unconfigured key, a rate
    limit, a plan that does not cover the exchange, or an unknown ticker all
    land on `fallback`, and `fallback` of None is itself a valid answer — the
    pipeline then keeps Altman on Z'' and marks market-vs-narrative claims
    UNVERIFIABLE rather than inventing a price.

    A refusal is recorded as a session warning. Silently falling back would
    leave the Z variant looking like a modelling choice rather than the
    consequence of a missing feed.
    """
    ticker = (extraction or {}).get("ticker")
    if not ticker or not market.configured():
        return fallback

    try:
        data, reason = market.for_ticker(ticker)
    except Exception as error:  # noqa: BLE001 - never fail a reconciliation
        data, reason = None, str(error)

    if data:
        return data

    if reason:
        warnings = list(record.get("warnings") or [])
        warnings.append(
            f"Live market data for {ticker} was unavailable, so "
            f"{'the demo figures were used' if fallback else 'the Z-score stays on the private-company variant'}"
            f": {reason}"
        )
        session.update(record["session_id"], warnings=warnings)
    return fallback


def _run(record: dict, extraction: dict, market_data: dict | None) -> dict:
    """The single call into the Data lane. Result returned verbatim.

    The audit row is written after the analysis is already in the session, and
    a persistence failure is recorded as a warning rather than raised. Supabase
    being down must never cost the user their reconciliation.
    """
    result = analyse(extraction, market_data, PEERS)
    session.update(record["session_id"], extraction=extraction, analysis=result,
                   market=market_data)

    if store.configured():
        outcome = store.save(
            result, record, record.get("privacy_ledger"), record.get("owner_id") or "",
        )
        if outcome.get("saved"):
            session.update(record["session_id"], audit_id=outcome.get("id"))
        else:
            warnings = list(record.get("warnings") or [])
            warnings.append(f"Not written to the audit history: {outcome.get('reason')}")
            session.update(record["session_id"], warnings=warnings)
    return result


# ---------------------------------------------------------------------------
# POST /upload
# ---------------------------------------------------------------------------

@app.post("/upload")
async def upload(request: Request, file: UploadFile = File(...)) -> JSONResponse:
    """Ingest one document. PDFs go through page targeting, privacy masking and
    the vision model; spreadsheets skip straight to Contract 1."""
    name = pathlib.Path(file.filename or "upload").name
    suffix = pathlib.Path(name).suffix.lower()
    if suffix not in (".pdf", ".xlsx", ".xls"):
        raise HTTPException(400, "Upload a native-text PDF or an XLSX spreadsheet.")

    record = session.new_session(document=name, source="upload", owner_id=request.state.user.id)
    target = pathlib.Path(record["dir"]) / name
    with target.open("wb") as handle:
        shutil.copyfileobj(file.file, handle)

    try:
        if suffix == ".pdf":
            payload = _ingest_pdf(record, target)
        else:
            payload = _ingest_xlsx(record, target)
    except ingest.IngestError as error:
        session.purge(record["session_id"])
        raise HTTPException(422, str(error)) from error
    except Exception as error:  # noqa: BLE001
        session.purge(record["session_id"])
        raise HTTPException(500, f"Ingestion failed: {error}") from error

    return JSONResponse(payload)


def _ingest_pdf(record: dict, path: pathlib.Path) -> dict:
    warnings: list[str] = []

    texts = ingest.page_texts(path)
    ingest.assert_native_text(texts)

    targeted = resolve_pages(path)
    statement_pages = targeted.get("extraction") or []
    narrative_pages = targeted.get("narrative") or []

    # The privacy gate runs over the WHOLE document, before anything leaves the
    # machine - that is the only way the "zero transmitted" claim is checkable.
    ledger = privacy.ledger(texts, statement_pages + narrative_pages)

    images = ingest.render_pages(path, statement_pages + narrative_pages, record["dir"])

    extraction: dict
    if extract.available():
        try:
            extraction, extraction_warnings = extract.extract(
                [images[p] for p in statement_pages if p in images],
                [images[p] for p in narrative_pages if p in images],
            )
            warnings.extend(extraction_warnings)
        except extract.ExtractionError as error:
            warnings.append(
                f"Vision extraction failed ({error}); fell back to the "
                f"hand-verified fixture."
            )
            extraction = extract.load_fixture("clean")
    else:
        warnings.append(
            "DEEPSEEK_API_KEY is not set; using the hand-verified fixture "
            "extraction for this document."
        )
        extraction = extract.load_fixture("clean")

    # Reverse-lookup every figure to a source cell. A miss stays a miss: it
    # becomes UNVERIFIED downstream rather than being quietly filled in.
    try:
        extraction["line_items"], report = resolve_bboxes(path, extraction["line_items"])
        if report.get("missed"):
            warnings.append(
                f"{report['missed']} figure(s) could not be traced to a source "
                f"cell and are marked UNVERIFIED."
            )
    except Exception as error:  # noqa: BLE001 - never fatal, only less provenance
        warnings.append(f"Bounding-box resolution failed: {error}")

    dimensions = {}
    for number in images:
        size = ingest.page_dimensions(path, number)
        if size:
            dimensions[str(number)] = {"width": size[0], "height": size[1]}

    session.update(
        record["session_id"], pdf_path=str(path), privacy_ledger=ledger,
        page_images={str(k): v for k, v in images.items()},
        page_dimensions=dimensions, pages_total=len(texts),
        targeted_pages=targeted, warnings=warnings,
    )
    record = session.get(record["session_id"]) or record
    # An uploaded report has no fixture behind it, so there is no fallback:
    # either the feed resolves the ticker or the pipeline runs without market data.
    _run(record, extraction, _market_for(record, extraction, None))

    return {
        **_envelope(record),
        "privacy_ledger": ledger,
        "targeted_pages": targeted,
    }


def _ingest_xlsx(record: dict, path: pathlib.Path) -> dict:
    extraction = ingest.from_xlsx(path)
    ledger = privacy.empty_ledger()
    session.update(
        record["session_id"], privacy_ledger=ledger, pages_total=0,
        warnings=["Spreadsheet ingestion: figures have no source cell in a "
                  "published document, so every item is UNVERIFIED."],
    )
    record = session.get(record["session_id"]) or record
    _run(record, extraction, None)
    return {**_envelope(record), "privacy_ledger": ledger, "targeted_pages": {}}


# ---------------------------------------------------------------------------
# POST /demo/{variant} - the fixture path
# ---------------------------------------------------------------------------

@app.post("/demo/{variant}")
def demo(request: Request, variant: str = "clean") -> JSONResponse:
    """Load a hand-verified extraction without a PDF.

    `clean` gives 2 PASS / 1 UNVERIFIABLE and 19/19 VERIFIED. `doctored` is the
    same document with one figure edited so the balance sheet identity fails -
    the deliberate break in the demo script, and the whole point of the moat.
    """
    if variant not in extract.FIXTURE_FILES:
        raise HTTPException(404, f"Unknown demo variant {variant!r}.")

    document = (DEMO_DOCS.get("documents") or {}).get(DEMO_DOCS.get("selected") or "", {})
    extraction = extract.load_fixture(variant)

    record = session.new_session(
        document=document.get("file") or f"{variant} fixture",
        source=f"demo:{variant}",
        owner_id=request.state.user.id,
        pages_total=document.get("pages_total"),
        targeted_pages={
            "extraction": document.get("extraction_pages") or [],
            "narrative": document.get("narrative_pages") or [],
        },
        warnings=(
            ["Doctored document: one balance-sheet figure was edited on purpose."]
            if variant == "doctored" else []
        ),
    )

    # No PDF on disk in demo mode, so there is no document text to scan. The
    # ledger reports the verified counts from document selection rather than
    # inventing a number - see handoff section 4.
    ledger = _demo_ledger(document)
    session.update(record["session_id"], privacy_ledger=ledger)
    record = session.get(record["session_id"]) or record

    _run(record, extraction, _market_for(record, extraction, DEMO_MARKET))
    return JSONResponse({**_envelope(record), "privacy_ledger": ledger,
                         "targeted_pages": record.get("targeted_pages")})


def _demo_ledger(document: dict) -> dict:
    """The measured counts for the demo document.

    These are the real numbers from scanning the report - 4 emails and 1 mobile,
    all of them on pages outside the extraction set. The pitch line is not the
    count, it is that zero were transmitted, and that is a property of page
    targeting rather than a policy.
    """
    found = document.get("pii") or [
        {"entity_type": "email", "label": "Email address", "count": 4,
         "transmitted": 0, "pages": [4, 5]},
        {"entity_type": "phone", "label": "Mobile number", "count": 1,
         "transmitted": 0, "pages": [4]},
    ]
    detected = sum(entry["count"] for entry in found)
    return {
        "entries": [], "summary": found,
        "detected": detected, "masked": detected, "transmitted": 0,
        "pages_scanned": document.get("pages_total") or 0,
        "pages_transmitted": len(document.get("extraction_pages") or [])
                             + len(document.get("narrative_pages") or []),
    }


# ---------------------------------------------------------------------------
# GET /analysis/{sid}
# ---------------------------------------------------------------------------

@app.get("/analysis/{sid}")
def analysis(sid: str, request: Request) -> JSONResponse:
    record = _require(sid, request.state.user.id)
    blocked = payment.gate(record)
    if blocked:
        return JSONResponse(blocked, status_code=402)

    result = record.get("analysis")
    if result is None:
        raise HTTPException(409, "This session has no completed analysis.")
    return JSONResponse({**_envelope(record), **result})


# ---------------------------------------------------------------------------
# GET /page/{sid}/{n}
# ---------------------------------------------------------------------------

@app.get("/page/{sid}/{number}")
def page(sid: str, number: int, request: Request):
    """The rendered source page. 1-BASED, like every page number in the system."""
    record = _require(sid, request.state.user.id)
    path = (record.get("page_images") or {}).get(str(number))
    if not path or not pathlib.Path(path).is_file():
        raise HTTPException(
            404,
            f"Page {number} was not rendered for this session. Only the "
            f"targeted statement pages are rasterised.",
        )
    return FileResponse(path, media_type="image/png")


# ---------------------------------------------------------------------------
# POST /query/{sid}
# ---------------------------------------------------------------------------

class Question(BaseModel):
    question: str


@app.post("/query/{sid}")
def query(sid: str, body: Question, request: Request) -> JSONResponse:
    """Retrieval, not generation. The refusal is guaranteed by the data
    structure: `key not in ratios` is a fact, not a judgement call."""
    record = _require(sid, request.state.user.id)
    blocked = payment.gate(record)
    if blocked:
        return JSONResponse(blocked, status_code=402)

    result = record.get("analysis")
    if result is None:
        raise HTTPException(409, "This session has no completed analysis.")

    answer = resolve_query(
        body.question,
        result.get("line_items") or [],
        result.get("ratios") or {},
        router=extract.llm_router if extract.available() else None,
        prior_line_items=result.get("prior_line_items") or [],
        prior_ratios=result.get("prior_ratios") or {},
        context={
            "period": result.get("period"),
            "prior_period": result.get("prior_period"),
            "unit": result.get("unit"),
            "currency": result.get("currency"),
        },
    )
    return JSONResponse(answer)


# ---------------------------------------------------------------------------
# Payment
# ---------------------------------------------------------------------------

class Settlement(BaseModel):
    signature: str = ""


@app.get("/payment/quote")
def payment_quote() -> dict:
    return payment.quote()


@app.get("/payment/network")
def payment_network() -> dict:
    """Live cluster state and treasury balance. Never raises — an unreachable
    RPC comes back as `reachable: false` with the reason attached."""
    return payment.network()


@app.post("/payment/{sid}")
def settle(sid: str, body: Settlement, request: Request) -> JSONResponse:
    record = _require(sid, request.state.user.id)
    result = payment.verify(body.signature)
    if result.get("paid"):
        session.update(sid, paid=True, payment=result)
    return JSONResponse(result, status_code=200 if result.get("paid") else 402)


# ---------------------------------------------------------------------------
# DELETE /session/{sid}
# ---------------------------------------------------------------------------

@app.delete("/session/{sid}")
def purge(sid: str, request: Request) -> dict:
    """Destroy the record and its files. The countdown in the UI is the same
    clock; this is the manual version of it reaching zero."""
    _require(sid, request.state.user.id)
    return {"purged": session.purge(sid), "session_id": sid}


@app.get("/session/{sid}")
def describe(sid: str, request: Request) -> dict:
    return _envelope(_require(sid, request.state.user.id))


# ---------------------------------------------------------------------------
# Market data (Twelve Data)
#
# Proxied rather than called from the browser on purpose: the key is billable,
# and anything the frontend can read is a key that has already leaked.
# ---------------------------------------------------------------------------

@app.get("/market/status")
def market_status() -> dict:
    return market.status()


@app.get("/market/search")
def market_search(q: str, limit: int = 12) -> JSONResponse:
    try:
        return JSONResponse({"results": market.search(q, min(max(limit, 1), 30))})
    except market.MarketError as error:
        raise HTTPException(503, str(error)) from error


@app.get("/market/quote")
def market_quote(symbol: str, exchange: str | None = None) -> JSONResponse:
    try:
        return JSONResponse(market.quote(symbol, exchange))
    except market.MarketError as error:
        raise HTTPException(503, str(error)) from error


@app.get("/market/timeseries")
def market_timeseries(
    symbol: str, interval: str = "1day", outputsize: int = 260,
    exchange: str | None = None,
) -> JSONResponse:
    try:
        return JSONResponse(
            market.time_series(symbol, interval, outputsize, exchange))
    except market.MarketError as error:
        raise HTTPException(503, str(error)) from error


# ---------------------------------------------------------------------------
# Crypto market data (CoinGecko) + AI research advisor (DeepSeek)
#
# The market feed is proxied through the engine so the CoinGecko key never
# reaches the browser. The advisor is a companion to the reconciliation
# pipeline: it takes the analysis that already exists on the session and
# shortlists crypto assets from the CoinGecko snapshot for a human to review.
# It is deliberately framed as *research candidates*, not investment advice.
# ---------------------------------------------------------------------------

@app.get("/crypto/status")
def crypto_status() -> dict:
    return {"market": crypto.status(), "advisor": advisor.status()}


@app.get("/crypto/market")
def crypto_market(limit: int = crypto.DEFAULT_TOP_N) -> JSONResponse:
    try:
        rows = crypto.top_markets(limit=min(max(limit, 1), 100))
    except crypto.CryptoError as error:
        raise HTTPException(503, str(error)) from error
    return JSONResponse({
        "provider": "CoinGecko",
        "vs_currency": crypto.VS_CURRENCY,
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "assets": rows,
    })


class AdvisorRequest(BaseModel):
    limit: int | None = None


@app.post("/advisor/{sid}")
def advisor_recommend(sid: str, body: AdvisorRequest, request: Request) -> JSONResponse:
    """Research candidates for the selected reconciled document. Free — the
    payment gate is reserved for paper-order execution, not analysis."""
    record = _require(sid, request.state.user.id)
    analysis_result = record.get("analysis")
    if analysis_result is None:
        raise HTTPException(409, "This session has no completed analysis.")

    limit = body.limit or crypto.DEFAULT_TOP_N
    snapshot, snapshot_reason = crypto.snapshot(limit=min(max(limit, 1), 100))
    report = advisor.recommend(analysis_result, snapshot, snapshot_reason)
    return JSONResponse(report)


# ---------------------------------------------------------------------------
# Solana devnet x402 paper-order flow (SOLANA TRACK)
#
# The full flow lives here: HTTP 402 challenge → Phantom signs USDC + memo →
# backend verifies on-chain against RPC → Supabase ledger writes the payment
# → paper-order receipt returned. Financial analysis stays free; only the
# simulated purchase is metered.
# ---------------------------------------------------------------------------

@app.get("/paper/status")
def paper_status() -> dict:
    return {
        "network": paper_order.NETWORK,
        "rpc_url": paper_order.RPC_URL,
        "usdc_mint": paper_order.USDC_MINT,
        "usdc_decimals": paper_order.USDC_DECIMALS,
        "recipient": paper_order.RECIPIENT,
        "amount_base_units": paper_order.AMOUNT_BASE_UNITS,
        "amount_usdc": paper_order.AMOUNT_BASE_UNITS / (10 ** paper_order.USDC_DECIMALS),
        "caip_network": paper_order.SOLANA_CAIP,
        "memo_prefix": paper_order.MEMO_PREFIX,
        "rpc": paper_order.rpc_status(),
        "ledger": paper_order.ledger_status(),
    }


@app.get("/paper/{sid}/quote")
def paper_quote(sid: str, asset_id: str, notional_usd: float,
                request: Request) -> JSONResponse:
    """Return the x402 payment requirements for a paper order without
    actually issuing a 402 — used by the UI to show the payment card before
    the user clicks 'connect Phantom'."""
    record = _require(sid, request.state.user.id)
    analysis_result = record.get("analysis")
    if analysis_result is None:
        raise HTTPException(409, "This session has no completed analysis.")

    resource_key = paper_order.resource_key_for(sid, asset_id, notional_usd)
    memo = paper_order.memo_for(analysis_result)
    return JSONResponse({
        "resource_key": resource_key,
        "verify_hash": paper_order.verify_hash(analysis_result),
        "requirements": paper_order.requirements(resource_key, memo),
        "already_paid": paper_order.get_verified(
            resource_key, paper_order.verify_hash(analysis_result)) is not None,
    })


class VerifyPaymentBody(BaseModel):
    asset_id: str
    notional_usd: float
    transaction_signature: str


@app.post("/paper/{sid}/verify-payment")
def paper_verify_payment(sid: str, body: VerifyPaymentBody,
                          request: Request) -> JSONResponse:
    """Verify the tx that Phantom just landed. On success the ledger row is
    persisted; on failure we return the specific reason."""
    record = _require(sid, request.state.user.id)
    analysis_result = record.get("analysis")
    if analysis_result is None:
        raise HTTPException(409, "This session has no completed analysis.")

    resource_key = paper_order.resource_key_for(sid, body.asset_id, body.notional_usd)
    memo = paper_order.memo_for(analysis_result)
    vhash = paper_order.verify_hash(analysis_result)

    try:
        verification = paper_order.verify_signature(body.transaction_signature, memo)
    except paper_order.PaymentError as error:
        raise HTTPException(402, str(error)) from error

    try:
        row = paper_order.record_verified(paper_order.VerifiedPayment(
            resource_key=resource_key,
            verify_hash=vhash,
            expected_memo=memo,
            expected_amount_base_units=paper_order.AMOUNT_BASE_UNITS,
            expected_mint=paper_order.USDC_MINT,
            expected_recipient=paper_order.RECIPIENT,
            network=paper_order.NETWORK,
            transaction_signature=verification["transaction_signature"],
            payer_wallet=verification["payer_wallet"],
            commitment=verification["commitment"],
            slot=verification.get("slot"),
            block_time=verification.get("block_time"),
            caller_id=request.state.user.id,
        ))
    except paper_order.PaymentError as error:
        raise HTTPException(409, str(error)) from error

    return JSONResponse({"status": "verified", "verify_hash": vhash,
                          "payment": row})


class PaperOrderBody(BaseModel):
    asset_id: str
    notional_usd: float
    transaction_signature: str | None = None


@app.post("/paper/{sid}/order")
def paper_order_create(sid: str, body: PaperOrderBody,
                        request: Request) -> JSONResponse:
    """Create the simulated paper-order receipt.

    Returns HTTP 402 with x402 payment requirements when there is no verified
    payment for this (session, asset, amount) triple — the standard x402
    challenge shape. Once a payment is on the ledger, returns the receipt.
    """
    record = _require(sid, request.state.user.id)
    analysis_result = record.get("analysis")
    if analysis_result is None:
        raise HTTPException(409, "This session has no completed analysis.")
    if body.notional_usd <= 0 or body.notional_usd > 100_000:
        raise HTTPException(422, "notional_usd must be between 0 and 100,000.")

    resource_key = paper_order.resource_key_for(sid, body.asset_id, body.notional_usd)
    memo = paper_order.memo_for(analysis_result)
    vhash = paper_order.verify_hash(analysis_result)

    payment_row = paper_order.get_verified(resource_key, vhash)

    # If the client already handed us a signature, verify it now (covers the
    # single-round-trip path used by the frontend after Phantom signs).
    if payment_row is None and body.transaction_signature:
        try:
            verification = paper_order.verify_signature(body.transaction_signature, memo)
            payment_row = paper_order.record_verified(paper_order.VerifiedPayment(
                resource_key=resource_key,
                verify_hash=vhash,
                expected_memo=memo,
                expected_amount_base_units=paper_order.AMOUNT_BASE_UNITS,
                expected_mint=paper_order.USDC_MINT,
                expected_recipient=paper_order.RECIPIENT,
                network=paper_order.NETWORK,
                transaction_signature=verification["transaction_signature"],
                payer_wallet=verification["payer_wallet"],
                commitment=verification["commitment"],
                slot=verification.get("slot"),
                block_time=verification.get("block_time"),
                caller_id=request.state.user.id,
            ))
        except paper_order.PaymentError as error:
            raise HTTPException(402, str(error)) from error

    if payment_row is None:
        return JSONResponse(
            paper_order.payment_required_body(resource_key, memo, extra={
                "verify_hash": vhash, "resource_key": resource_key,
            }),
            status_code=402,
        )

    try:
        receipt = paper_order.create_paper_order(analysis_result, body.asset_id,
                                                  body.notional_usd, payment_row)
    except paper_order.PaymentError as error:
        raise HTTPException(422, str(error)) from error

    return JSONResponse({"status": "paper_order_created",
                          "resource_key": resource_key,
                          "receipt": receipt, "payment": payment_row})


@app.get("/paper/history")
def paper_history(request: Request, limit: int = 50) -> JSONResponse:
    """Recent paper-order payments. Used by the Solana Investments page."""
    _ = request  # auth already applied at middleware
    return JSONResponse({"rows": paper_order.recent_payments(limit)})


# ---------------------------------------------------------------------------
# Audit history (Supabase)
# ---------------------------------------------------------------------------

@app.get("/history")
def history(request: Request, limit: int = 50) -> JSONResponse:
    """Past reconciled analyses.

    This is the only part of the system that outlives a session, and it holds
    results rather than documents - see backend/store.py.
    """
    return JSONResponse(store.history(min(max(limit, 1), 200), request.state.user.id))


@app.get("/history/{row_id}")
def history_row(row_id: str, request: Request) -> JSONResponse:
    row = store.get(row_id, request.state.user.id)
    if row is None:
        raise HTTPException(404, "No such entry in the audit history.")
    return JSONResponse(row)


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "vision_configured": extract.available(),
        "market_configured": market.configured(),
        "crypto_market": crypto.status(),
        "advisor": advisor.status(),
        "paper_order": {
            "network": paper_order.NETWORK,
            "amount_usdc": paper_order.AMOUNT_BASE_UNITS / (10 ** paper_order.USDC_DECIMALS),
            "recipient": paper_order.RECIPIENT,
            "ledger": paper_order.ledger_status(),
        },
        "peers_loaded": bool(PEERS),
        "payment_required": payment.PAYMENT_REQUIRED,
        "auth": auth.status(),
        "demo_variants": sorted(extract.FIXTURE_FILES),
        "storage": {**store.status(), **store.ping()},
        **session.stats(),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("PORT", "8000")))
