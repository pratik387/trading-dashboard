"""SwingReader must show ARCHIVED regimes alongside the live ledger.

Context: on 2026-08-12 the multi-day book's capital management changed (flat Rs1L
margin + take-all caps + composite ordering -> vol-targeted sizing on a Rs10L
risk budget + cluster caps + unbiased-hash ordering, crash2d disabled). The
engine's ledgers were RESET at that boundary so DecayTripwire's rolling PF is
computed on one regime.

That reset made the dashboard's history go to zero, because the reader read the
same files the tripwire does. The reader now merges state/archive/*.pre-*.json
with the live ledger and tags each row with `regime`, so:

  tripwire  -> live ledger only  (correct PF, one regime)
  dashboard -> archive + live    (history preserved, segmented)
"""
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from swing_reader import SwingReader  # noqa: E402

SETUP = "zscore_oversold_revert_long"


def _live(base: Path, setup: str, trades, regime="post_sizing_2026_08_12"):
    d = base / "state"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"decay_tripwire_{setup}.json").write_text(
        json.dumps({"setup_name": setup, "_regime": regime, "trades": trades}), encoding="utf-8")


def _archive(base: Path, setup: str, trades, stamp="2026-08-12", regime="pre_sizing"):
    d = base / "state" / "archive"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"decay_tripwire_{setup}.pre-sizing-{stamp}.json").write_text(
        json.dumps({"setup_name": setup, "_regime": regime, "trades": trades}), encoding="utf-8")


def test_history_page_is_FRESH_after_a_reset(tmp_path):
    """Default regime='current': the History page must NOT show the old era."""
    _archive(tmp_path, SETUP, [
        {"net_pnl_inr": 500.0, "ts_iso": "2026-07-10T09:30:00"},
        {"net_pnl_inr": -200.0, "ts_iso": "2026-07-11T09:30:00"},
    ])
    _live(tmp_path, SETUP, [])                      # reset at the boundary
    agg = SwingReader(tmp_path).get_aggregate(setup=SETUP)
    assert agg["total_trades"] == 0, "History page leaked pre-boundary trades"


def test_archive_tab_shows_the_old_era(tmp_path):
    _archive(tmp_path, SETUP, [
        {"net_pnl_inr": 500.0, "ts_iso": "2026-07-10T09:30:00"},
        {"net_pnl_inr": -200.0, "ts_iso": "2026-07-11T09:30:00"},
    ])
    _live(tmp_path, SETUP, [])
    agg = SwingReader(tmp_path).get_aggregate(setup=SETUP, regime="archived")
    assert agg["total_trades"] == 2


def test_history_and_archive_do_not_overlap(tmp_path):
    _archive(tmp_path, SETUP, [{"net_pnl_inr": 500.0, "ts_iso": "2026-07-10T09:30:00"}])
    _live(tmp_path, SETUP, [{"net_pnl_inr": 300.0, "ts_iso": "2026-08-13T09:30:00"}])
    r = SwingReader(tmp_path)
    assert r.get_aggregate(setup=SETUP)["total_trades"] == 1                      # current
    assert r.get_aggregate(setup=SETUP, regime="archived")["total_trades"] == 1   # archived
    assert r.get_aggregate(setup=SETUP, regime="all")["total_trades"] == 2        # research only


def test_unknown_regime_is_rejected(tmp_path):
    _live(tmp_path, SETUP, [])
    with pytest.raises(ValueError):
        SwingReader(tmp_path)._ledger_trades(SETUP, regime="yesterday")


def test_list_regimes_labels_the_archive_tab(tmp_path):
    _archive(tmp_path, SETUP, [{"net_pnl_inr": 1.0, "ts_iso": "2026-07-10T09:30:00"}])
    regs = SwingReader(tmp_path).list_regimes(setup=SETUP)
    assert [r["regime"] for r in regs] == ["pre_sizing"]
    assert regs[0]["trades"] == 1


def test_list_regimes_empty_when_nothing_archived(tmp_path):
    _live(tmp_path, SETUP, [])
    assert SwingReader(tmp_path).list_regimes(setup=SETUP) == []


def test_rows_are_tagged_with_their_regime(tmp_path):
    """Segmentation is what makes pooling avoidable downstream."""
    _archive(tmp_path, SETUP, [{"net_pnl_inr": 1.0, "ts_iso": "2026-07-10T09:30:00"}])
    _live(tmp_path, SETUP, [{"net_pnl_inr": 2.0, "ts_iso": "2026-08-13T09:30:00"}])
    rows = SwingReader(tmp_path)._ledger_trades(SETUP, regime="all")
    regimes = {r["regime"] for r in rows}
    assert regimes == {"pre_sizing", "post_sizing_2026_08_12"}
    assert [r["archived"] for r in rows] == [True, False]


def test_archive_rows_come_before_live_rows(tmp_path):
    _archive(tmp_path, SETUP, [{"net_pnl_inr": 1.0, "ts_iso": "2026-07-10T09:30:00"}])
    _live(tmp_path, SETUP, [{"net_pnl_inr": 2.0, "ts_iso": "2026-08-13T09:30:00"}])
    rows = SwingReader(tmp_path)._ledger_trades(SETUP, regime="all")
    assert [r["net_pnl_inr"] for r in rows] == [1.0, 2.0]


def test_multiple_archived_regimes_are_all_included(tmp_path):
    """A second boundary later must not drop the first archive."""
    _archive(tmp_path, SETUP, [{"net_pnl_inr": 1.0, "ts_iso": "2026-05-01T09:30:00"}],
             stamp="2026-06-01", regime="pre_a")
    _archive(tmp_path, SETUP, [{"net_pnl_inr": 2.0, "ts_iso": "2026-07-01T09:30:00"}],
             stamp="2026-08-12", regime="pre_b")
    _live(tmp_path, SETUP, [{"net_pnl_inr": 3.0, "ts_iso": "2026-08-13T09:30:00"}])
    rows = SwingReader(tmp_path)._ledger_trades(SETUP, regime="all")
    assert [r["net_pnl_inr"] for r in rows] == [1.0, 2.0, 3.0]


def test_no_archive_directory_is_harmless(tmp_path):
    _live(tmp_path, SETUP, [{"net_pnl_inr": 7.0, "ts_iso": "2026-08-13T09:30:00"}])
    assert SwingReader(tmp_path).get_aggregate(setup=SETUP)["total_trades"] == 1


def test_corrupt_archive_file_does_not_break_the_page(tmp_path):
    d = tmp_path / "state" / "archive"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"decay_tripwire_{SETUP}.pre-sizing-2026-08-12.json").write_text("{not json", encoding="utf-8")
    _live(tmp_path, SETUP, [{"net_pnl_inr": 5.0, "ts_iso": "2026-08-13T09:30:00"}])
    assert SwingReader(tmp_path).get_aggregate(setup=SETUP, regime="all")["total_trades"] == 1


def test_live_book_ignores_the_paper_archive(tmp_path):
    """book='live' is the real-money ledger — a paper archive must not leak in."""
    _archive(tmp_path, SETUP, [{"net_pnl_inr": 999.0, "ts_iso": "2026-07-10T09:30:00"}])
    _live(tmp_path, SETUP, [])
    rows = SwingReader(tmp_path)._ledger_trades(SETUP, book="live", regime="all")
    assert rows == []


def test_list_regimes_accepts_family_selectors(tmp_path):
    """Regression: 'multiday' was treated as a literal setup name, so
    list_regimes found nothing and the Archive tab stayed hidden despite
    archived trades existing."""
    _archive(tmp_path, "zscore_oversold_revert_long",
             [{"net_pnl_inr": 1.0, "ts_iso": "2026-07-10T09:30:00"}])
    _archive(tmp_path, "crash2d_revert_long",
             [{"net_pnl_inr": 2.0, "ts_iso": "2026-07-11T09:30:00"}])
    r = SwingReader(tmp_path)
    for sel in ("all", "multiday"):
        regs = r.list_regimes(setup=sel)
        assert regs, f"{sel!r} found no archived regimes"
        assert regs[0]["trades"] == 2, f"{sel!r} miscounted archived trades"


def test_list_regimes_overnight_excludes_multiday_archives(tmp_path):
    _archive(tmp_path, "zscore_oversold_revert_long",
             [{"net_pnl_inr": 1.0, "ts_iso": "2026-07-10T09:30:00"}])
    assert SwingReader(tmp_path).list_regimes(setup="overnight") == []
