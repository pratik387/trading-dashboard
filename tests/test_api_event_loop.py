"""The API must not block its event loop on file / object-storage reads.

2026-09-22: opening the intraday dashboard cold took 5-6 s. Cause: 38 of 56
endpoints were `async def` but did plain blocking reads (OCI listings, log
files) with no await, so one slow endpoint (the regimes lookup the page fires
on mount, ~5 s against OCI) froze the loop and every Live-tab call queued
behind it. Measured: status alone 0.14 s, status while regimes in flight 4.8 s.

FastAPI runs a plain `def` endpoint in its threadpool, which is the fix. Two
guards here:

  1. concurrency: a slow sync read in one endpoint must not delay another
  2. lint: no `async def` endpoint in api.py may lack an `await`
"""
from __future__ import annotations

import ast
import re
import sys
import threading
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture(autouse=True)
def mock_readers():
    with patch("api.OCIDataReader") as mock_oci, patch("api.LocalDataReader") as mock_local:
        mock_oci.return_value = MagicMock()
        mock_local.return_value = MagicMock()
        yield


def test_slow_read_in_one_endpoint_does_not_stall_another():
    import api

    slow = MagicMock()

    def _slow_list_runs(*a, **k):
        time.sleep(1.0)
        return []

    slow.list_runs.side_effect = _slow_list_runs

    # `with TestClient(...)` is essential: it holds ONE event loop for all
    # requests, like uvicorn. A bare TestClient spins a fresh loop per request
    # and can never reproduce loop blocking.
    with patch.object(api, "get_reader", return_value=slow), \
         patch.object(api, "get_intraday_size_boundary", return_value="2026-08-14"), \
         TestClient(api.app) as client:
        timings = {}

        def hit(name, path):
            t0 = time.perf_counter()
            client.get(path)
            timings[name] = time.perf_counter() - t0

        t_slow = threading.Thread(target=hit, args=("regimes", "/api/runs/fixed/regimes"))
        t_fast = threading.Thread(target=hit, args=("config_types", "/api/config-types"))
        t_slow.start()
        time.sleep(0.15)            # make sure the slow one is inside its read
        t_fast.start()
        t_slow.join()
        t_fast.join()

    assert timings["regimes"] >= 1.0
    assert timings["config_types"] < 0.6, (
        "a 1 s blocking read in /regimes delayed /config-types by %.2f s: the "
        "endpoint is blocking the event loop" % timings["config_types"])


def test_no_async_endpoint_without_await():
    src = (ROOT / "api.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    offenders = []
    for node in tree.body:
        if not isinstance(node, ast.AsyncFunctionDef):
            continue
        is_route = any(
            isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute)
            and d.func.attr in ("get", "post", "put", "delete", "websocket")
            for d in node.decorator_list)
        if not is_route:
            continue
        has_await = any(isinstance(n, (ast.Await, ast.AsyncFor, ast.AsyncWith)) for n in ast.walk(node))
        if not has_await:
            offenders.append(node.name)
    assert not offenders, (
        "async endpoints with no await (they block the loop; make them `def`): %s" % offenders)
