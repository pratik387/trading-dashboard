"""Unit tests for SwingReader — the generalized delivery/swing performance reader.

Pools the per-setup decay-tripwire PnL ledgers (state/decay_tripwire_<setup>.json,
identical shape across close_dn_overnight_long + the multi_day capitulation batch)
into the AggregateData shape the historic page already consumes.
"""
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from swing_reader import SwingReader, SWING_SETUPS


def _write_ledger(base: Path, setup: str, trades):
    d = base / "state"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"decay_tripwire_{setup}.json").write_text(
        json.dumps({"setup_name": setup, "trades": trades}), encoding="utf-8"
    )


@pytest.fixture
def base(tmp_path):
    _write_ledger(tmp_path, "close_dn_overnight_long", [
        {"net_pnl_inr": 100.0, "ts_iso": "2026-06-15T09:30:00"},
        {"net_pnl_inr": -50.0, "ts_iso": "2026-06-15T09:30:01"},
        {"net_pnl_inr": 200.0, "ts_iso": "2026-06-16T09:30:00"},
    ])
    _write_ledger(tmp_path, "mtf_capitulation_revert_long", [
        {"net_pnl_inr": 300.0, "ts_iso": "2026-06-16T15:30:00"},
    ])
    return tmp_path


def test_swing_setups_includes_overnight_and_multiday():
    assert "close_dn_overnight_long" in SWING_SETUPS
    for s in ("mtf_capitulation_revert_long", "low52_capitulation_revert_long",
              "zscore_oversold_revert_long", "crash2d_revert_long"):
        assert s in SWING_SETUPS


def test_aggregate_all_pools_every_setup(base):
    agg = SwingReader(base).get_aggregate(setup="all")
    assert agg["config_type"] == "swing"
    assert agg["total_trades"] == 4
    assert agg["total_pnl"] == 550.0
    assert agg["net_pnl"] == 550.0 and agg["gross_pnl"] == 550.0  # ledger is net
    assert agg["total_fees"] == 0
    assert agg["winners"] == 3 and agg["losers"] == 1
    assert agg["win_rate"] == 75.0                                # 0-100 scale
    assert agg["days"] == 2
    assert agg["avg_pnl_per_trade"] == pytest.approx(137.5)


def test_aggregate_by_setup_breakdown(base):
    agg = SwingReader(base).get_aggregate(setup="all")
    by = {s["setup"]: s for s in agg["by_setup"]}
    assert by["close_dn_overnight_long"]["trades"] == 3
    assert by["close_dn_overnight_long"]["pnl"] == 250.0
    assert by["close_dn_overnight_long"]["wins"] == 2
    assert by["mtf_capitulation_revert_long"]["pnl"] == 300.0
    assert by["mtf_capitulation_revert_long"]["win_rate"] == 100.0


def test_aggregate_daily_data_cumulative(base):
    agg = SwingReader(base).get_aggregate(setup="all")
    days = {d["date"][:10]: d for d in agg["daily_data"]}
    assert days["2026-06-15"]["pnl"] == 50.0 and days["2026-06-15"]["trades"] == 2
    assert days["2026-06-16"]["pnl"] == 500.0
    # cumulative runs in date order
    ordered = sorted(agg["daily_data"], key=lambda d: d["date"])
    assert ordered[0]["cumulative_pnl"] == 50.0
    assert ordered[-1]["cumulative_pnl"] == 550.0


def test_aggregate_single_setup_filter(base):
    agg = SwingReader(base).get_aggregate(setup="close_dn_overnight_long")
    assert agg["total_trades"] == 3 and agg["total_pnl"] == 250.0
    assert {s["setup"] for s in agg["by_setup"]} == {"close_dn_overnight_long"}


def test_aggregate_date_filter(base):
    agg = SwingReader(base).get_aggregate(setup="all", date_from="2026-06-16")
    assert agg["total_trades"] == 2 and agg["total_pnl"] == 500.0


def test_aggregate_trades_tagged_with_setup(base):
    agg = SwingReader(base).get_aggregate(setup="all")
    assert len(agg["trades"]) == 4
    t = agg["trades"][0]
    assert set(t.keys()) >= {"symbol", "setup", "pnl", "exit_reason", "entry", "exit"}
    assert all(tr["setup"] in SWING_SETUPS for tr in agg["trades"])


def test_aggregate_empty_when_no_ledgers(tmp_path):
    agg = SwingReader(tmp_path).get_aggregate(setup="all")
    assert agg["total_trades"] == 0 and agg["total_pnl"] == 0
    assert agg["by_setup"] == [] and agg["daily_data"] == []


def test_aggregate_surfaces_real_fees_when_present(tmp_path):
    """When the ledger carries fees_inr/gross_pnl_inr, the aggregate reports real
    total_fees and gross = net + fees (not the net==gross / fees==0 fallback)."""
    _write_ledger(tmp_path, "close_dn_overnight_long", [
        {"net_pnl_inr": 850.0, "ts_iso": "2026-06-15T09:30:00",
         "fees_inr": 120.0, "gross_pnl_inr": 970.0},
        {"net_pnl_inr": -50.0, "ts_iso": "2026-06-15T09:30:01",
         "fees_inr": 30.0, "gross_pnl_inr": -20.0},
    ])
    agg = SwingReader(tmp_path).get_aggregate(setup="close_dn_overnight_long")
    assert agg["net_pnl"] == 800.0
    assert agg["total_fees"] == 150.0
    assert agg["gross_pnl"] == 950.0   # net + fees


def test_trades_carry_per_symbol_detail_when_present(tmp_path):
    """When the ledger carries symbol/entry/exit/reason, the trades rows surface
    them instead of the '—'/0/'settled' placeholder."""
    _write_ledger(tmp_path, "mtf_capitulation_revert_long", [
        {"net_pnl_inr": 300.0, "ts_iso": "2026-06-16T15:30:00",
         "symbol": "TATAMOTORS", "entry_price": 650.5, "exit_price": 660.0,
         "exit_reason": "kday_close_moc", "qty": 100},
    ])
    agg = SwingReader(tmp_path).get_aggregate(setup="mtf_capitulation_revert_long")
    t = agg["trades"][0]
    assert t["symbol"] == "TATAMOTORS"
    assert t["entry"] == 650.5
    assert t["exit"] == 660.0
    assert t["exit_reason"] == "kday_close_moc"
    assert t["qty"] == 100


def test_trades_fall_back_to_placeholder_when_detail_absent(tmp_path):
    """Legacy net-only rows keep the placeholder so the tab still renders."""
    _write_ledger(tmp_path, "close_dn_overnight_long", [
        {"net_pnl_inr": 100.0, "ts_iso": "2026-06-15T09:30:00"},
    ])
    t = SwingReader(tmp_path).get_aggregate(setup="close_dn_overnight_long")["trades"][0]
    assert t["symbol"] == "—"
    assert t["entry"] == 0 and t["exit"] == 0
    assert t["exit_reason"] == "settled"


def test_aggregate_fee_fallback_when_absent(tmp_path):
    """Legacy net-only records: total_fees=0, gross==net (unchanged behavior)."""
    _write_ledger(tmp_path, "close_dn_overnight_long", [
        {"net_pnl_inr": 100.0, "ts_iso": "2026-06-15T09:30:00"},
    ])
    agg = SwingReader(tmp_path).get_aggregate(setup="close_dn_overnight_long")
    assert agg["total_fees"] == 0
    assert agg["gross_pnl"] == 100.0 and agg["net_pnl"] == 100.0


def test_per_setup_roots_resolve_each_setups_own_folder(tmp_path):
    """Overnight and the multi_day batch run from DIFFERENT engine folders on the
    VM (intraday_fixed vs multiday_cnc). Each setup's ledger must be read from its
    own root, not a single shared base_path."""
    overnight_root = tmp_path / "intraday_fixed" / "intraday-trade-assistant"
    multiday_root = tmp_path / "multiday_cnc" / "intraday-trade-assistant"
    _write_ledger(overnight_root, "close_dn_overnight_long", [
        {"net_pnl_inr": 100.0, "ts_iso": "2026-06-15T09:30:00"},
    ])
    _write_ledger(multiday_root, "mtf_capitulation_revert_long", [
        {"net_pnl_inr": 300.0, "ts_iso": "2026-06-16T15:30:00"},
    ])
    reader = SwingReader(roots={
        "close_dn_overnight_long": overnight_root,
        "mtf_capitulation_revert_long": multiday_root,
    })
    agg = reader.get_aggregate(setup="all")
    assert agg["total_trades"] == 2
    assert agg["total_pnl"] == 400.0
    by = {s["setup"]: s for s in agg["by_setup"]}
    assert by["close_dn_overnight_long"]["pnl"] == 100.0
    assert by["mtf_capitulation_revert_long"]["pnl"] == 300.0


def test_default_roots_split_overnight_from_multiday():
    """No-arg construction maps overnight -> intraday_fixed, the multi_day batch
    -> multiday_cnc (the real VM layout)."""
    r = SwingReader()
    assert r._root_for("close_dn_overnight_long").parts[-2:] == (
        "intraday_fixed", "intraday-trade-assistant")
    for s in ("mtf_capitulation_revert_long", "low52_capitulation_revert_long",
              "zscore_oversold_revert_long", "crash2d_revert_long"):
        assert r._root_for(s).parts[-2:] == ("multiday_cnc", "intraday-trade-assistant")


def test_attributed_mirror_rows_excluded_from_pooled_views(tmp_path):
    """One composite book position mirrored into a contributor's ledger
    (attributed=True) must count ONCE in pooled views ('all'/'multiday') but
    stay visible in the contributing setup's own single-setup edge view."""
    # Owner ledger: the real book trade (untagged / attributed False).
    _write_ledger(tmp_path, "zscore_oversold_revert_long", [
        {"net_pnl_inr": 500.0, "ts_iso": "2026-07-03T15:28:00",
         "symbol": "NSE:EMUDHRA", "attributed": False},
    ])
    # Contributor ledger: the MIRROR of the same position.
    _write_ledger(tmp_path, "crash2d_revert_long", [
        {"net_pnl_inr": 500.0, "ts_iso": "2026-07-03T15:28:00",
         "symbol": "NSE:EMUDHRA", "attributed": True},
    ])
    r = SwingReader(base_path=tmp_path)

    pooled = r.get_aggregate("multiday")
    assert pooled["total_trades"] == 1          # one position, once
    assert pooled["total_pnl"] == 500.0

    own = r.get_aggregate("crash2d_revert_long")
    assert own["total_trades"] == 1             # edge view keeps the mirror
    assert own["trades"][0]["attributed"] is True
