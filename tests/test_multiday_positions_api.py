"""Endpoint test for the open multi_day positions API."""
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


def test_swing_positions_endpoint(tmp_path):
    d = tmp_path / "state" / "crash2d_slots_positions"
    d.mkdir(parents=True)
    (d / "positions_snapshot.json").write_text(json.dumps({
        "timestamp": "2026-06-16T16:07:00",
        "positions": {"NSE:RAMASTEEL": {
            "symbol": "NSE:RAMASTEEL", "qty": 100, "product": "MTF",
            "plan": {"setup": "crash2d_revert_long"},
            "state": {"pending_entry_fill": True, "qty": 100, "leverage": 2.0,
                      "signal_close": 200.0, "signal_date": "2026-06-16"},
            "entry_date": "2026-06-17", "exit_on_date": "2026-06-19",
        }},
    }), encoding="utf-8")

    import api
    with patch.object(api, "multiday_positions_reader", MultidayPositionsReader(tmp_path)):
        r = TestClient(api.app).get("/api/swing/positions")
    assert r.status_code == 200
    d = r.json()
    assert d["total_positions"] == 1
    assert d["positions"][0]["symbol"] == "NSE:RAMASTEEL"
    assert d["positions"][0]["status"] == "pending_fill"
    assert d["total_notional"] == 20000.0
