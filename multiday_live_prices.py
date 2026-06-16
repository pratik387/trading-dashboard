"""Live mark-to-market prices for the multi-day book.

Multi-day is cron-based — there's no running tick server to read PnL from (unlike
the intraday daemon). So the dashboard marks held positions to the latest price by
fetching candles directly from Upstox's UNAUTHENTICATED V3 endpoint (the same one
the engine uses): the last intraday candle close during market hours, the last
daily close otherwise. Symbol -> instrument_key comes from the engine's on-disk
instrument cache (cache/upstox_nse_instruments.json).

Pure helpers (build_symbol_key_map, augment_book_with_pnl) are unit-tested; the
network fetch (get_ltps) degrades gracefully — a missing price leaves that
position's PnL as None rather than failing the page.
"""
from __future__ import annotations

import json
import time
from datetime import date, timedelta
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import quote

import requests

# Same engine root + cache path the UpstoxDataClient writes
# (broker/upstox/upstox_data_client.py: INSTRUMENTS_CACHE_PATH).
try:
    from swing_reader import OVERNIGHT_ENGINE_ROOT as _ENGINE_ROOT  # has the cache on the live daemon box
except Exception:  # pragma: no cover
    _ENGINE_ROOT = Path.home() / "intraday_fixed" / "intraday-trade-assistant"
DEFAULT_INSTRUMENT_CACHE = _ENGINE_ROOT / "cache" / "upstox_nse_instruments.json"

UPSTOX_HIST_BASE = "https://api.upstox.com/v3/historical-candle"
UPSTOX_HEADERS = {"Accept": "application/json"}

# Short in-process TTL so the 30s page refresh doesn't hammer the endpoint.
_LTP_TTL_SEC = 45.0
_ltp_cache: Dict[str, tuple] = {}  # instrument_key -> (ts, ltp)


# ─── Pure helpers (unit-tested) ────────────────────────────────────────────


def build_symbol_key_map(cache_path: Path) -> Dict[str, str]:
    """{"NSE:RAMASTEEL": "NSE_EQ|INE..."} from the engine instrument cache."""
    try:
        items = json.loads(Path(cache_path).read_text(encoding="utf-8"))
    except Exception:
        return {}
    out: Dict[str, str] = {}
    for it in items:
        if it.get("segment") != "NSE_EQ":
            continue
        tsym = (it.get("trading_symbol") or "").strip().upper()
        ikey = it.get("instrument_key")
        if tsym and ikey:
            out[f"NSE:{tsym}"] = ikey
    return out


def augment_book_with_pnl(book: Dict, ltps: Dict[str, float]) -> Dict:
    """Fill current_price / live_pnl / live_pnl_pct on each open position from
    `ltps` (symbol -> last price), and set summary.total_live_pnl to the sum of
    what could be priced (None if nothing priced). Missing prices -> None."""
    any_priced = False
    total = 0.0
    for p in book.get("open", []):
        ltp = ltps.get(p["symbol"])
        if ltp is None:
            continue
        entry = float(p["entry_price"])
        qty = int(p["qty"])
        pnl = (float(ltp) - entry) * qty
        p["current_price"] = round(float(ltp), 2)
        p["live_pnl"] = round(pnl, 2)
        p["live_pnl_pct"] = round((float(ltp) / entry - 1) * 100, 2) if entry else None
        total += pnl
        any_priced = True
    book.setdefault("summary", {})["total_live_pnl"] = round(total, 2) if any_priced else None
    return book


# ─── Network fetch (graceful) ──────────────────────────────────────────────


def _fetch_last_close(instrument_key: str) -> Optional[float]:
    enc = quote(instrument_key, safe="|")
    # 1) intraday (today, live during market). 2) fall back to recent daily close.
    urls = [
        f"{UPSTOX_HIST_BASE}/intraday/{enc}/minutes/5",
        f"{UPSTOX_HIST_BASE}/{enc}/days/1/{date.today().isoformat()}/"
        f"{(date.today() - timedelta(days=7)).isoformat()}",
    ]
    for url in urls:
        try:
            r = requests.get(url, headers=UPSTOX_HEADERS, timeout=8)
            if r.status_code != 200:
                continue
            candles = (r.json().get("data") or {}).get("candles") or []
            if candles:
                # candles are [ts, o, h, l, c, v, ...]; newest first on this API.
                return float(candles[0][4])
        except Exception:
            continue
    return None


def get_ltps(symbols: List[str], cache_path: Optional[Path] = None) -> Dict[str, float]:
    """symbol -> last price for the given symbols (best effort, partial OK)."""
    if not symbols:
        return {}
    keymap = build_symbol_key_map(Path(cache_path) if cache_path else DEFAULT_INSTRUMENT_CACHE)
    now = time.time()
    out: Dict[str, float] = {}
    for sym in symbols:
        ikey = keymap.get(sym)
        if not ikey:
            continue
        cached = _ltp_cache.get(ikey)
        if cached and (now - cached[0]) < _LTP_TTL_SEC and cached[1] is not None:
            out[sym] = cached[1]
            continue
        ltp = _fetch_last_close(ikey)
        _ltp_cache[ikey] = (now, ltp)
        if ltp is not None:
            out[sym] = ltp
    return out
