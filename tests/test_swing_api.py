"""Endpoint tests for the swing (delivery / multi-day) historic API."""
import json
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


@pytest.fixture(autouse=True)
def mock_readers():
    """Avoid OCI/filesystem deps at import (mirrors test_api_instances)."""
    with patch('api.OCIDataReader') as mock_oci, patch('api.LocalDataReader') as mock_local:
        mock_oci.return_value = MagicMock()
        mock_local.return_value = MagicMock()
        yield


from fastapi.testclient import TestClient
from swing_reader import SwingReader


def _ledger(base: Path, setup: str, trades):
    d = base / "state"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"decay_tripwire_{setup}.json").write_text(json.dumps({"trades": trades}), encoding="utf-8")


def test_swing_setups_endpoint():
    import api
    r = TestClient(api.app).get("/api/swing/setups")
    assert r.status_code == 200
    assert "close_dn_overnight_long" in r.json()["setups"]
    assert "mtf_capitulation_revert_long" in r.json()["setups"]


def test_swing_aggregate_endpoint(tmp_path):
    _ledger(tmp_path, "close_dn_overnight_long", [
        {"net_pnl_inr": 100.0, "ts_iso": "2026-06-16T09:30:00"},
        {"net_pnl_inr": -40.0, "ts_iso": "2026-06-16T09:30:01"},
    ])
    import api
    with patch.object(api, "swing_reader", SwingReader(tmp_path)):
        r = TestClient(api.app).get("/api/swing/aggregate?setup=all")
    assert r.status_code == 200
    d = r.json()
    assert d["config_type"] == "swing"
    assert d["total_trades"] == 2
    assert d["total_pnl"] == 60.0
    assert d["winners"] == 1 and d["losers"] == 1
    assert len(d["by_setup"]) == 1 and d["by_setup"][0]["setup"] == "close_dn_overnight_long"
