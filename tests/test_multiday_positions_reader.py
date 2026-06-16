"""Unit tests for MultidayPositionsReader — the OPEN multiday book (pre-settle).

The swing historic page shows SETTLED PnL (from decay_tripwire ledgers). This
reader surfaces the live, not-yet-settled positions for the 4 multi_day setups,
read from the engine's per-setup position snapshots:

    state/<x>_slots_positions/positions_snapshot.json -> {"positions": {sym: {...}}}

Positions are grouped by their plan.setup (the full setup name), with pending-fill
vs held status and notional, so the dashboard can watch the book before exits land.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from multiday_positions_reader import MultidayPositionsReader


def _snapshot(base: Path, dirname: str, positions: dict, ts: str = "2026-06-16T16:07:00"):
    d = base / "state" / dirname
    d.mkdir(parents=True, exist_ok=True)
    (d / "positions_snapshot.json").write_text(
        json.dumps({"timestamp": ts, "positions": positions}), encoding="utf-8"
    )


def _pos(setup, qty, signal_close, *, pending=True, signal_date="2026-06-16",
         entry_date="2026-06-17", exit_on="2026-06-19", product="MTF", leverage=2.0):
    return {
        "symbol": "", "side": "BUY", "qty": qty, "avg_price": 0.0,
        "plan": {"setup": setup, "trail_ret": -0.04, "tshock": 5.9},
        "state": {"pending_entry_fill": pending, "qty": qty, "leverage": leverage,
                  "signal_close": signal_close, "signal_date": signal_date},
        "entry_date": entry_date, "exit_on_date": exit_on, "product": product,
    }


def test_reads_and_groups_open_positions(tmp_path):
    _snapshot(tmp_path, "mtf_capitulation_slots_positions", {
        "NSE:SANATHAN": {**_pos("mtf_capitulation_revert_long", 495, 403.25), "symbol": "NSE:SANATHAN"},
    })
    _snapshot(tmp_path, "crash2d_slots_positions", {
        "NSE:RAMASTEEL": {**_pos("crash2d_revert_long", 100, 200.0), "symbol": "NSE:RAMASTEEL"},
        "NSE:AMRUTANJAN": {**_pos("crash2d_revert_long", 50, 600.0, pending=False), "symbol": "NSE:AMRUTANJAN"},
    })
    out = MultidayPositionsReader(tmp_path).get_open_positions()
    assert out["total_positions"] == 3
    by = {b["setup"]: b for b in out["by_setup"]}
    assert by["crash2d_revert_long"]["count"] == 2
    assert by["mtf_capitulation_revert_long"]["count"] == 1
    # notional = qty * signal_close
    sanathan = next(p for p in out["positions"] if p["symbol"] == "NSE:SANATHAN")
    assert sanathan["notional"] == round(495 * 403.25, 2)
    assert sanathan["product"] == "MTF" and sanathan["leverage"] == 2.0
    assert sanathan["status"] == "pending_fill"
    assert sanathan["entry_date"] == "2026-06-17" and sanathan["exit_on_date"] == "2026-06-19"
    held = next(p for p in out["positions"] if p["symbol"] == "NSE:AMRUTANJAN")
    assert held["status"] == "held"


def test_total_notional_and_setup_breakdown(tmp_path):
    _snapshot(tmp_path, "crash2d_slots_positions", {
        "NSE:A": {**_pos("crash2d_revert_long", 10, 100.0), "symbol": "NSE:A"},
        "NSE:B": {**_pos("crash2d_revert_long", 20, 50.0), "symbol": "NSE:B"},
    })
    out = MultidayPositionsReader(tmp_path).get_open_positions()
    assert out["total_notional"] == round(10 * 100 + 20 * 50, 2)  # 2000
    assert out["by_setup"][0]["notional"] == 2000.0


def test_empty_when_no_snapshots(tmp_path):
    out = MultidayPositionsReader(tmp_path).get_open_positions()
    assert out["total_positions"] == 0
    assert out["positions"] == [] and out["by_setup"] == []
    assert out["total_notional"] == 0


def test_ignores_empty_positions_dict(tmp_path):
    _snapshot(tmp_path, "mtf_capitulation_slots_positions", {})
    out = MultidayPositionsReader(tmp_path).get_open_positions()
    assert out["total_positions"] == 0
