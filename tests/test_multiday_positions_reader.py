"""Unit tests for MultidayPositionsReader.get_book() — the live multi-day book.

Splits the per-setup position snapshots into:
  - open    (held/filled: state.pending_entry_fill == False, real avg_price)
  - pending (AMO placed, awaiting next-open fill: pending_entry_fill == True)

Pure file read — live mark-to-market PnL is layered on separately (needs prices).
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from multiday_positions_reader import MultidayPositionsReader


def _snapshot(base: Path, dirname: str, positions: dict, ts="2026-06-17T16:07:00"):
    d = base / "state" / dirname
    d.mkdir(parents=True, exist_ok=True)
    (d / "positions_snapshot.json").write_text(
        json.dumps({"timestamp": ts, "positions": positions}), encoding="utf-8"
    )


def _pos(setup, qty, *, pending, avg_price=0.0, signal_close=100.0,
         entry_date="2026-06-17", exit_on="2026-06-19", product="MTF", leverage=2.0,
         signal_date="2026-06-16"):
    return {
        "symbol": "", "side": "BUY", "qty": qty, "avg_price": avg_price,
        "plan": {"setup": setup},
        "state": {"pending_entry_fill": pending, "qty": qty, "leverage": leverage,
                  "signal_close": signal_close, "signal_date": signal_date,
                  "entry_fill_price": (avg_price if not pending else None)},
        "entry_date": entry_date, "exit_on_date": exit_on, "product": product,
    }


def test_splits_open_and_pending(tmp_path):
    _snapshot(tmp_path, "mtf_capitulation_slots_positions", {
        # filled/held — has a real avg_price
        "NSE:SANATHAN": {**_pos("mtf_capitulation_revert_long", 100, pending=False,
                                 avg_price=400.0, signal_close=403.25), "symbol": "NSE:SANATHAN"},
    })
    _snapshot(tmp_path, "crash2d_slots_positions", {
        # pending — not yet filled
        "NSE:RAMASTEEL": {**_pos("crash2d_revert_long", 50, pending=True,
                                 signal_close=200.0), "symbol": "NSE:RAMASTEEL"},
    })
    b = MultidayPositionsReader(tmp_path).get_book()
    assert len(b["open"]) == 1 and len(b["pending"]) == 1
    o = b["open"][0]
    assert o["symbol"] == "NSE:SANATHAN" and o["entry_price"] == 400.0
    # capital = actual money = value / leverage (2x MTF), NOT leveraged notional
    assert o["capital"] == round(400.0 * 100 / 2.0, 2)   # 20000
    assert o["current_price"] is None and o["live_pnl"] is None  # not augmented yet
    p = b["pending"][0]
    assert p["symbol"] == "NSE:RAMASTEEL" and p["ref_price"] == 200.0
    assert p["capital"] == round(200.0 * 50 / 2.0, 2)    # 5000
    assert p["fills_on"] == "2026-06-17"


def test_summary_counts_and_notional(tmp_path):
    _snapshot(tmp_path, "crash2d_slots_positions", {
        "NSE:A": {**_pos("crash2d_revert_long", 10, pending=False, avg_price=100.0), "symbol": "NSE:A"},
        "NSE:B": {**_pos("crash2d_revert_long", 20, pending=True, signal_close=50.0), "symbol": "NSE:B"},
    })
    s = MultidayPositionsReader(tmp_path).get_book()["summary"]
    assert s["open_count"] == 1 and s["pending_count"] == 1
    # capital = value/leverage (2x): open 100*10/2=500, pending 50*20/2=500
    assert s["open_capital"] == 500.0 and s["pending_capital"] == 500.0
    assert s["total_live_pnl"] is None  # populated only after price augmentation
    by = {x["setup"]: x for x in s["by_setup"]}
    assert by["crash2d_revert_long"]["open"] == 1 and by["crash2d_revert_long"]["pending"] == 1


def test_empty_when_no_snapshots(tmp_path):
    b = MultidayPositionsReader(tmp_path).get_book()
    assert b["open"] == [] and b["pending"] == [] and b["summary"]["open_count"] == 0
