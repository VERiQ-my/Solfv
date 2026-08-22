"""Smoke tests for the Data lane, pinned to the real demo document.

Fixtures are built from Seacera-Annual-Report-2024.pdf (FYE 30 June 2024) by
scripts/build_fixture.py. Not exhaustive - this locks the numbers the demo
quotes out loud so a change at 14:30 cannot silently move them.

Run with `pytest -q`, or `python tests/test_analysis.py` without pytest.
"""

from __future__ import annotations

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from analysis.checks import assign_trust, run_checks  # noqa: E402
from analysis.pipeline import analyse  # noqa: E402
from analysis.query import resolve_query  # noqa: E402
from analysis.ratios import altman, compute_ratios  # noqa: E402

CLEAN = json.loads((ROOT / "fixtures" / "mock_extraction.json").read_text(encoding="utf-8"))
DOCTORED = json.loads((ROOT / "fixtures" / "mock_extraction_doctored.json").read_text(encoding="utf-8"))
PEERS = json.loads((ROOT / "fixtures" / "sector_peers.json").read_text(encoding="utf-8"))

# Both figures are printed in the report's own Financial Highlights, p.19.
MARKET = {"market_cap": 133_760_000, "share_price_1y": 133_760_000 / 111_990_000 - 1}


def test_clean_report_reconciles():
    out = analyse(CLEAN, MARKET, PEERS)
    assert out["entity"] == "Seacera Group Berhad"
    assert out["summary"]["checks_failed"] == 0
    assert out["summary"]["checks_passed"] == 2
    assert out["summary"]["trust"]["UNVERIFIED"] == 0
    assert out["quarantined"] == []


def test_balance_sheet_identity_is_exact():
    """853,283,605 == 135,061,482 + 718,222,123, to the ringgit."""
    identity = [c for c in analyse(CLEAN, MARKET, PEERS)["checks"]
                if c["name"] == "Balance sheet identity"][0]
    assert identity["status"] == "PASS"
    assert identity["delta"] == 0


def test_roll_forward_is_unverifiable_not_failed():
    """Seacera paid no dividends and prints no dividends line, so the
    roll-forward cannot be run. That is our gap, not evidence of a bad figure,
    and it must not quarantine retained_earnings."""
    out = analyse(CLEAN, MARKET, PEERS)
    roll = [c for c in out["checks"] if c["name"].startswith("Retained")][0]
    assert roll["status"] == "UNVERIFIABLE"
    assert "dividends" in roll["detail"]
    by_key = {i["canonical_key"]: i for i in out["line_items"]}
    assert by_key["retained_earnings"]["trust"] == "VERIFIED"


def test_demo_numbers_are_stable():
    out = analyse(CLEAN, MARKET, PEERS)
    assert round(out["ratios"]["current_ratio"], 2) == 1.29
    assert round(out["prior_ratios"]["current_ratio"], 2) == 1.17
    assert round(out["ratios"]["gross_margin"], 4) == 0.1226
    assert round(out["prior_ratios"]["gross_margin"], 4) == 0.1764
    assert round(out["ratios"]["net_margin"], 4) == 0.0672
    assert round(out["prior_ratios"]["net_margin"], 4) == 0.1453


def test_book_equity_says_safe_but_market_equity_says_distress():
    """The headline finding, and the reason this document was worth using.

    Book equity of RM718m is dominated by a revalued investment property, so
    Z'' reads SAFE. Swap in the RM134m market capitalisation the company prints
    on its own page 19 and the same model reads DISTRESS. Both numbers come out
    of the same annual report.
    """
    items = analyse(CLEAN, None, PEERS)["line_items"]

    book = altman(items)
    assert book["variant"] == "Z''"
    assert book["zone"] == "SAFE"
    assert round(book["score"], 2) == 5.84

    market = altman(items, market_cap=MARKET["market_cap"])
    assert market["variant"] == "Z"
    assert market["zone"] == "DISTRESS"
    assert round(market["score"], 2) == 0.75


def test_say_do_gap_meets_definition_of_done():
    gaps = analyse(CLEAN, MARKET, PEERS)["say_do_gap"]
    verdicts = [g["verdict"] for g in gaps]
    assert verdicts.count("CONTRADICTED") >= 2
    assert verdicts.count("SUPPORTED") >= 1
    # Contradictions lead - the demo opens on the gap, not the agreement.
    assert verdicts[0] == "CONTRADICTED"
    # Every claim quotes the document verbatim and carries its page.
    assert all(g["sentence"] and g["page"] for g in gaps)


def test_say_do_verdicts_are_defensible():
    """Management's one checkable arithmetic claim must come back SUPPORTED.

    They stated the current ratio improved from 1.17 to 1.29. We recompute it
    from the balance sheet and agree. A tool that contradicts everything is
    just a pessimist; agreeing where management is right is what makes the
    contradictions worth believing.
    """
    gaps = analyse(CLEAN, MARKET, PEERS)["say_do_gap"]
    stated = [g for g in gaps if "improved from 1.17 to 1.29" in g["sentence"]][0]
    assert stated["verdict"] == "SUPPORTED"


def test_doctored_report_quarantines_and_withholds():
    out = analyse(DOCTORED, MARKET, PEERS)
    assert out["summary"]["checks_failed"] == 1
    assert set(out["quarantined"]) == {"total_assets", "total_liabilities", "total_equity"}
    # The whole point: no confident number is printed on top of a bad figure.
    assert out["ratios"]["gearing"] is None
    assert out["ratios"]["roe"] is None
    assert out["risk"]["score"] is None
    # Untouched figures survive. A failure is contained, not contagious.
    assert round(out["ratios"]["current_ratio"], 2) == 1.29
    assert round(out["ratios"]["gross_margin"], 4) == 0.1226


def test_ratios_never_return_zero_for_missing_inputs():
    ratios = compute_ratios({"revenue": 100.0})
    assert ratios["gearing"] is None
    assert ratios["current_ratio"] is None
    assert all(v is None or isinstance(v, float) for v in ratios.values())


def test_every_figure_traces_to_a_source_cell():
    """Click-to-source is only real if the coordinates are real."""
    out = analyse(CLEAN, MARKET, PEERS)
    for item in out["line_items"]:
        assert item["page"], f"{item['canonical_key']} has no page"
        assert item["bbox"], f"{item['canonical_key']} has no bbox"
        assert len(item["bbox"]) == 4


def test_rotated_page_bbox_was_resolved():
    """Retained earnings sits on a sideways-printed page. If the reverse lookup
    ever stops handling rotation this silently goes null and amber."""
    out = analyse(CLEAN, MARKET, PEERS)
    re_item = [i for i in out["line_items"] if i["canonical_key"] == "retained_earnings"][0]
    assert re_item["page"] == 82
    assert re_item["bbox"] is not None
    x0, top, x1, bottom = re_item["bbox"]
    # Rotated text is a tall narrow strip, not a wide short one.
    assert (bottom - top) > (x1 - x0)


def test_query_answers_and_refuses():
    out = analyse(CLEAN, MARKET, PEERS)
    ctx = {"period": out["period"], "prior_period": out["prior_period"],
           "unit": out["unit"], "currency": out["currency"]}

    hit = resolve_query("How much cash?", out["line_items"], out["ratios"], context=ctx)
    assert hit["value"] == 3_686_840
    assert hit["source"]["page"] == 80

    prior = resolve_query("What was revenue last year?", out["line_items"], out["ratios"],
                          prior_line_items=out["prior_line_items"],
                          prior_ratios=out["prior_ratios"], context=ctx)
    assert prior["value"] == 52_059_182

    miss = resolve_query("Who is the auditor?", out["line_items"], out["ratios"], context=ctx)
    assert miss["not_found"] is True


def test_bbox_miss_is_unverified():
    """A figure with no traceable source cannot be VERIFIED, checks or not."""
    out = analyse(DOCTORED, MARKET, PEERS)
    inventory = [i for i in out["line_items"] if i["canonical_key"] == "inventory"][0]
    assert inventory["bbox"] is None
    assert inventory["trust"] == "UNVERIFIED"


if __name__ == "__main__":
    failed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  PASS  {name}")
            except AssertionError as exc:
                failed += 1
                print(f"  FAIL  {name}: {exc or '(assertion)'}")
    print(f"\n{'FAILED' if failed else 'all green'} ({failed} failing)")
    sys.exit(1 if failed else 0)
