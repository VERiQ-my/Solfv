"""Section 2.3 - Contract 2. Five endpoints, plus the demo entry points.

The one rule this file exists to honour: `analyse()` is called once and its
result is returned **verbatim**. Nothing here reshapes, rounds, or re-badges a
figure. Every judgement about trust was already made deterministically in
`analysis/`, and re-deriving any of it at the transport layer would put an
unchecked number back on the dashboard.

CORS is wide open and there is no auth. This is a hackathon prototype and says
so out loud.
"""

from __future__ import annotations

import os
import pathlib
import shutil
import time

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from analysis.pipeline import analyse
from analysis.query import resolve_query

from . import extract, ingest, payment, privacy, session, store
from .bbox import resolve_bboxes
from .pages import resolve_pages

ROOT = pathlib.Path(__file__).resolve().parents[1]

# Printed on p.19 of the demo document's financial highlights.
DEMO_MARKET = {"market_cap": 133_760_000, "share_price_1y": 0.1944}

app = FastAPI(title="SOLFV", version="1.0",
              description="LLM extracts, deterministic math verifies.")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=False,
    allow_methods=["*"], allow_headers=["*"],
)

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


def _require(sid: str) -> dict:
    record = session.get(sid)
    if record is None:
        raise HTTPException(
            status_code=404,
            detail="Session not found. It expired and was purged, or never existed.",
        )
    return record


def _run(record: dict, extraction: dict, market: dict | None) -> dict:
    """The single call into the Data lane. Result returned verbatim.

    The audit row is written after the analysis is already in the session, and
    a persistence failure is recorded as a warning rather than raised. Supabase
    being down must never cost the user their reconciliation.
    """
    result = analyse(extraction, market, PEERS)
    session.update(record["session_id"], extraction=extraction, analysis=result,
                   market=market)

    if store.configured():
        outcome = store.save(result, record, record.get("privacy_ledger"))
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
async def upload(file: UploadFile = File(...)) -> JSONResponse:
    """Ingest one document. PDFs go through page targeting, privacy masking and
    the vision model; spreadsheets skip straight to Contract 1."""
    name = pathlib.Path(file.filename or "upload").name
    suffix = pathlib.Path(name).suffix.lower()
    if suffix not in (".pdf", ".xlsx", ".xls"):
        raise HTTPException(400, "Upload a native-text PDF or an XLSX spreadsheet.")

    record = session.new_session(document=name, source="upload")
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
    _run(record, extraction, DEMO_MARKET)

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
def demo(variant: str = "clean") -> JSONResponse:
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

    _run(record, extraction, DEMO_MARKET)
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
def analysis(sid: str) -> JSONResponse:
    record = _require(sid)
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
def page(sid: str, number: int):
    """The rendered source page. 1-BASED, like every page number in the system."""
    record = _require(sid)
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
def query(sid: str, body: Question) -> JSONResponse:
    """Retrieval, not generation. The refusal is guaranteed by the data
    structure: `key not in ratios` is a fact, not a judgement call."""
    record = _require(sid)
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


@app.post("/payment/{sid}")
def settle(sid: str, body: Settlement) -> JSONResponse:
    record = _require(sid)
    result = payment.verify(body.signature)
    if result.get("paid"):
        session.update(sid, paid=True, payment=result)
    return JSONResponse(result, status_code=200 if result.get("paid") else 402)


# ---------------------------------------------------------------------------
# DELETE /session/{sid}
# ---------------------------------------------------------------------------

@app.delete("/session/{sid}")
def purge(sid: str) -> dict:
    """Destroy the record and its files. The countdown in the UI is the same
    clock; this is the manual version of it reaching zero."""
    return {"purged": session.purge(sid), "session_id": sid}


@app.get("/session/{sid}")
def describe(sid: str) -> dict:
    return _envelope(_require(sid))


# ---------------------------------------------------------------------------
# Audit history (Supabase)
# ---------------------------------------------------------------------------

@app.get("/history")
def history(limit: int = 50) -> JSONResponse:
    """Past reconciled analyses.

    This is the only part of the system that outlives a session, and it holds
    results rather than documents - see backend/store.py.
    """
    return JSONResponse(store.history(min(max(limit, 1), 200)))


@app.get("/history/{row_id}")
def history_row(row_id: str) -> JSONResponse:
    row = store.get(row_id)
    if row is None:
        raise HTTPException(404, "No such entry in the audit history.")
    return JSONResponse(row)


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "vision_configured": extract.available(),
        "peers_loaded": bool(PEERS),
        "payment_required": payment.PAYMENT_REQUIRED,
        "demo_variants": sorted(extract.FIXTURE_FILES),
        "storage": {**store.status(), **store.ping()},
        **session.stats(),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("PORT", "8000")))
