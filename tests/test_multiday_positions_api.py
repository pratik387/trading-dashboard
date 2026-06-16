"""Endpoint test for the live multi_day book API (/api/multiday/book)."""
import json
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


@pytest.fixture(autouse=True)
def mock_readers():
    with patch('api.OCIDataReader') as mock_oci, patch('api.LocalDataReader') as mock_local:
        mock_oci.return_value = MagicMock()
        mock_local.return_value = MagicMock()
        yield


from fastapi.testclient import TestClient
from multiday_positions_reader import MultidayPositionsReader


def test_multiday_book_endpoint_with_live_pnl(tmp_path):
    d = tmp_path / "state" / "crash2d_slots_positions"
    d.mkdir(parents=True)
    (d / "positions_snapshot.json").write_text(json.dumps({
        "timestamp": "2026-06-17T16:07:00",
        "positions": {
            "NSE:RAMASTEEL": {  # held
                "symbol": "NSE:RAMASTEEL", "qty": 100, "product": "MTF", "avg_price": 200.0,
                "plan": {"setup": "crash2d_revert_long"},
                "state": {"pending_entry_fill": False, "qty": 100, "leverage": 2.0,
                          "signal_close": 205.0, "signal_date": "2026-06-16",
                          "entry_fill_price": 200.0},
                "entry_date": "2026-06-17", "exit_on_date": "2026-06-19",
            },
            "NSE:SANATHAN": {  # pending
                "symbol": "NSE:SANATHAN", "qty": 50, "product": "MTF", "avg_price": 0.0,
                "plan": {"setup": "crash2d_revert_long"},
                "state": {"pending_entry_fill": True, "qty": 50, "leverage": 2.0,
                          "signal_close": 400.0, "signal_date": "2026-06-17"},
                "entry_date": "2026-06-18", "exit_on_date": "2026-06-22",
            },
        },
    }), encoding="utf-8")

    import api
    with patch.object(api, "multiday_positions_reader", MultidayPositionsReader(tmp_path)), \
         patch.object(api.multiday_live_prices, "get_ltps", return_value={"NSE:RAMASTEEL": 210.0}):
        r = TestClient(api.app).get("/api/multiday/book")

    assert r.status_code == 200
    b = r.json()
    assert len(b["open"]) == 1 and len(b["pending"]) == 1
    o = b["open"][0]
    assert o["symbol"] == "NSE:RAMASTEEL"
    assert o["current_price"] == 210.0
    assert o["live_pnl"] == round((210.0 - 200.0) * 100, 2)  # +1000
    assert b["summary"]["total_live_pnl"] == 1000.0
    assert b["pending"][0]["symbol"] == "NSE:SANATHAN"
