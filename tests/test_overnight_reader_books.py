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


def test_get_ledger_as_of_filters_by_settle_date(tmp_path):
    """as_of gives an exact as-of-EOD view of the append-only live ledger —
    the live book's historical/archive path."""
    state = tmp_path / "state"
    state.mkdir(parents=True, exist_ok=True)
    (state / "decay_tripwire_close_dn_overnight_long_live.json").write_text(
        json.dumps({"trades": [
            {"net_pnl_inr": 100.0, "ts_iso": "2026-07-01T09:30:00"},
            {"net_pnl_inr": 200.0, "ts_iso": "2026-07-02T09:30:00"},
            {"net_pnl_inr": 300.0, "ts_iso": "2026-07-03T09:30:00"},
        ]}), encoding="utf-8")
    from overnight_reader import OvernightReader
    r = OvernightReader(base_path=tmp_path)
    led = r.get_ledger(book="live", as_of="2026-07-02")
    assert [t["net_pnl_inr"] for t in led["trades"]] == [100.0, 200.0]
    s = r.get_summary(book="live", as_of="2026-07-01")
    assert s["total_trades"] == 1 and s["cumulative_pnl"] == 100.0


def test_paper_open_cleared_once_reconstruction_settled(tmp_path):
    """Fires stop showing as open once the 09:45 reconstruction report exists
    for the snapshot's session date (they are in the paper ledger by then)."""
    state = tmp_path / "state"
    state.mkdir(parents=True, exist_ok=True)
    snap = {"session_date": "2026-07-09", "written_at": "2026-07-09T15:27:00",
            "fires": [{"symbol": "NSE:X", "product": "MTF", "leverage": 2.5,
                       "entry_price": 100.0}]}
    (state / "overnight_paper_open.json").write_text(json.dumps(snap), encoding="utf-8")
    from overnight_reader import OvernightReader
    r = OvernightReader(base_path=tmp_path)
    assert len(r.get_paper_open()["fires"]) == 1        # not yet reconstructed
    (tmp_path / "reports").mkdir()
    (tmp_path / "reports" / "overnight_slippage_2026-07-09.json").write_text("{}", encoding="utf-8")
    out = r.get_paper_open()
    assert out["settled"] is True and out["fires"] == []  # settled -> cleared
