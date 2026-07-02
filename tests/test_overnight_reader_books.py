"""Unit tests for OvernightReader live/paper book split.

Since real-money activation the engine keeps TWO tripwire ledgers:
    state/decay_tripwire_close_dn_overnight_long.json        (paper — Rs1L idealized)
    state/decay_tripwire_close_dn_overnight_long_live.json   (live — real fills)

The reader must select the right file via `book=` and tag its output.
"""
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from overnight_reader import OvernightReader, LEDGER_FILES, SETUP_NAME


PAPER_TRADES = [
    {"net_pnl_inr": 100.0, "ts_iso": "2026-06-30T09:30:00"},
    {"net_pnl_inr": -40.0, "ts_iso": "2026-07-01T09:30:00"},
]
LIVE_TRADES = [
    {"net_pnl_inr": 250.0, "ts_iso": "2026-07-01T09:30:00"},
]


def _write_ledger(base: Path, filename: str, trades):
    d = base / "state"
    d.mkdir(parents=True, exist_ok=True)
    (d / filename).write_text(
        json.dumps({"setup_name": SETUP_NAME, "trades": trades}), encoding="utf-8"
    )


@pytest.fixture
def base(tmp_path):
    _write_ledger(tmp_path, LEDGER_FILES["paper"], PAPER_TRADES)
    _write_ledger(tmp_path, LEDGER_FILES["live"], LIVE_TRADES)
    return tmp_path


def test_ledger_files_names():
    assert LEDGER_FILES["paper"] == f"decay_tripwire_{SETUP_NAME}.json"
    assert LEDGER_FILES["live"] == f"decay_tripwire_{SETUP_NAME}_live.json"


def test_get_ledger_defaults_to_paper(base):
    ledger = OvernightReader(base).get_ledger()
    assert ledger["book"] == "paper"
    assert len(ledger["trades"]) == 2
    assert ledger["trades"][0]["net_pnl_inr"] == 100.0


def test_get_ledger_live_reads_live_file(base):
    ledger = OvernightReader(base).get_ledger(book="live")
    assert ledger["book"] == "live"
    assert len(ledger["trades"]) == 1
    assert ledger["trades"][0]["net_pnl_inr"] == 250.0


def test_get_ledger_invalid_book_raises(base):
    with pytest.raises(ValueError):
        OvernightReader(base).get_ledger(book="shadow")


def test_get_summary_per_book(base):
    reader = OvernightReader(base)
    paper = reader.get_summary(book="paper")
    live = reader.get_summary(book="live")
    assert paper["book"] == "paper"
    assert paper["total_trades"] == 2
    assert paper["cumulative_pnl"] == 60.0
    assert live["book"] == "live"
    assert live["total_trades"] == 1
    assert live["cumulative_pnl"] == 250.0


def test_get_summary_invalid_book_raises(base):
    with pytest.raises(ValueError):
        OvernightReader(base).get_summary(book="LIVE")


def test_get_fires_for_date_per_book(base):
    reader = OvernightReader(base)
    paper = reader.get_fires_for_date("2026-07-01", book="paper")
    live = reader.get_fires_for_date("2026-07-01", book="live")
    assert paper["n_fires"] == 1
    assert paper["fires"][0]["net_pnl_inr"] == -40.0
    assert live["n_fires"] == 1
    assert live["fires"][0]["net_pnl_inr"] == 250.0


def test_missing_live_file_returns_empty_ledger(tmp_path):
    """Live file absent (e.g. before first real settle) -> empty, not an error."""
    _write_ledger(tmp_path, LEDGER_FILES["paper"], PAPER_TRADES)
    ledger = OvernightReader(tmp_path).get_ledger(book="live")
    assert ledger["book"] == "live"
    assert ledger["trades"] == []
    assert ledger["loaded_from"] is None
