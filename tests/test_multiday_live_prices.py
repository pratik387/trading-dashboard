"""Unit tests for the pure parts of multiday_live_prices (no network)."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from multiday_live_prices import build_symbol_key_map, augment_book_with_pnl


def test_build_symbol_key_map_from_instrument_cache(tmp_path):
    cache = tmp_path / "instruments.json"
    cache.write_text(json.dumps([
        {"segment": "NSE_EQ", "trading_symbol": "RAMASTEEL", "instrument_key": "NSE_EQ|INE001"},
        {"segment": "NSE_EQ", "trading_symbol": "SANATHAN", "instrument_key": "NSE_EQ|INE002"},
        {"segment": "NSE_INDEX", "trading_symbol": "NIFTY", "instrument_key": "NSE_INDEX|Nifty 50"},
    ]), encoding="utf-8")
    m = build_symbol_key_map(cache)
    assert m["NSE:RAMASTEEL"] == "NSE_EQ|INE001"
    assert m["NSE:SANATHAN"] == "NSE_EQ|INE002"


def test_augment_book_fills_live_pnl_for_open_positions():
    book = {
        "open": [
            {"symbol": "NSE:SANATHAN", "qty": 100, "entry_price": 400.0,
             "current_price": None, "live_pnl": None, "live_pnl_pct": None},
            {"symbol": "NSE:RAMASTEEL", "qty": 50, "entry_price": 200.0,
             "current_price": None, "live_pnl": None, "live_pnl_pct": None},
        ],
        "pending": [],
        "summary": {"total_live_pnl": None},
    }
    out = augment_book_with_pnl(book, {"NSE:SANATHAN": 410.0, "NSE:RAMASTEEL": 190.0})
    o0 = out["open"][0]
    assert o0["current_price"] == 410.0
    assert o0["live_pnl"] == round((410.0 - 400.0) * 100, 2)        # +1000
    assert o0["live_pnl_pct"] == round((410.0 / 400.0 - 1) * 100, 2)  # +2.5
    o1 = out["open"][1]
    assert o1["live_pnl"] == round((190.0 - 200.0) * 50, 2)          # -500
    # total = +1000 - 500 = +500
    assert out["summary"]["total_live_pnl"] == 500.0


def test_augment_leaves_pnl_none_when_price_missing():
    book = {
        "open": [{"symbol": "NSE:X", "qty": 10, "entry_price": 100.0,
                  "current_price": None, "live_pnl": None, "live_pnl_pct": None}],
        "pending": [], "summary": {"total_live_pnl": None},
    }
    out = augment_book_with_pnl(book, {})  # no price for NSE:X
    assert out["open"][0]["current_price"] is None
    assert out["open"][0]["live_pnl"] is None
    # total_live_pnl stays None when NOTHING could be priced
    assert out["summary"]["total_live_pnl"] is None


def test_augment_partial_prices_sums_only_available():
    book = {
        "open": [
            {"symbol": "NSE:A", "qty": 10, "entry_price": 100.0,
             "current_price": None, "live_pnl": None, "live_pnl_pct": None},
            {"symbol": "NSE:B", "qty": 10, "entry_price": 100.0,
             "current_price": None, "live_pnl": None, "live_pnl_pct": None},
        ],
        "pending": [], "summary": {"total_live_pnl": None},
    }
    out = augment_book_with_pnl(book, {"NSE:A": 110.0})  # only A priced
    assert out["open"][0]["live_pnl"] == 100.0
    assert out["open"][1]["live_pnl"] is None
    assert out["summary"]["total_live_pnl"] == 100.0  # sum of what's priced
