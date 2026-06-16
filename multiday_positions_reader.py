"""MultidayPositionsReader — the live multi-day book (open + pending), VM-local.

The swing historic page shows SETTLED PnL (pooled decay_tripwire ledgers), which
stays empty for a setup until its first exit. This reader surfaces the LIVE book
so positions are visible across their whole lifecycle:

    AMO placed (pending_fill) --next open--> filled/held (2-3 days) --close--> settled

Source: the engine's per-setup position snapshots under the multi_day deployment
root (~/multiday_cnc):

    state/<x>_slots_positions/positions_snapshot.json
        -> {"timestamp", "positions": {symbol: {qty, avg_price, plan.setup,
              state{pending_entry_fill, signal_close, ...}, entry_date, exit_on_date,
              product}}}

get_book() splits positions into `open` (held: pending_entry_fill False, real
avg_price) and `pending` (awaiting next-open fill). Pure file read — live
mark-to-market PnL is layered on by multiday_live_prices (needs current prices).
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Optional

try:
    from swing_reader import MULTIDAY_ENGINE_ROOT as _DEFAULT_ROOT
except Exception:  # pragma: no cover
    _DEFAULT_ROOT = Path.home() / "multiday_cnc" / "intraday-trade-assistant"


class MultidayPositionsReader:
    def __init__(self, base_path: Optional[Path] = None):
        self.base_path: Path = Path(base_path) if base_path else _DEFAULT_ROOT
        self.state_dir: Path = self.base_path / "state"

    def get_book(self) -> Dict:
        """Live multi-day book split into open (held) and pending (awaiting fill).

        Returns:
            {
              "open":    [ {setup, symbol, qty, product, leverage, entry_price,
                            capital, current_price, live_pnl, live_pnl_pct,
                            entry_date, exit_on_date, signal_date} ],  # current/pnl None
              "pending": [ {setup, symbol, qty, product, leverage, ref_price,
                            capital, fills_on, exit_on_date, signal_date} ],
              "summary": {open_count, pending_count, open_capital, pending_capital,
                          total_live_pnl (None), by_setup:[{setup, open, pending, capital}]},
            capital = actual money deployed (value / leverage), NOT leveraged notional.
              "as_of": <latest snapshot timestamp or None>,
            }
        """
        open_pos: List[Dict] = []
        pending: List[Dict] = []
        as_of: Optional[str] = None

        for snap in sorted(self.state_dir.glob("*_slots_positions/positions_snapshot.json")):
            try:
                data = json.loads(snap.read_text(encoding="utf-8"))
            except Exception:
                continue
            ts = data.get("timestamp")
            if ts and (as_of is None or str(ts) > as_of):
                as_of = str(ts)
            for sym, p in (data.get("positions") or {}).items():
                st = p.get("state") or {}
                setup = (p.get("plan") or {}).get("setup", "unknown")
                symbol = p.get("symbol") or sym
                qty = int(p.get("qty") or st.get("qty") or 0)
                product = p.get("product")
                leverage = st.get("leverage")
                # Capital = ACTUAL money deployed = position value / leverage. For
                # MTF (leverage>1) this is the margin put up, NOT the leveraged
                # notional exposure; for CNC (leverage 1) it's the full cash.
                lev = float(leverage) if leverage else 1.0
                lev = lev if lev > 0 else 1.0
                if st.get("pending_entry_fill"):
                    ref = float(st.get("signal_close") or 0.0)
                    pending.append({
                        "setup": setup, "symbol": symbol, "qty": qty,
                        "product": product, "leverage": leverage,
                        "ref_price": ref, "capital": round(qty * ref / lev, 2),
                        "fills_on": p.get("entry_date"),
                        "exit_on_date": p.get("exit_on_date"),
                        "signal_date": st.get("signal_date"),
                    })
                else:
                    entry = float(p.get("avg_price") or st.get("entry_fill_price") or 0.0)
                    open_pos.append({
                        "setup": setup, "symbol": symbol, "qty": qty,
                        "product": product, "leverage": leverage,
                        "entry_price": entry, "capital": round(qty * entry / lev, 2),
                        "current_price": None, "live_pnl": None, "live_pnl_pct": None,
                        "entry_date": p.get("entry_date"),
                        "exit_on_date": p.get("exit_on_date"),
                        "signal_date": st.get("signal_date"),
                    })

        open_pos.sort(key=lambda r: (r["setup"], -r["capital"]))
        pending.sort(key=lambda r: (r["setup"], -r["capital"]))

        bs: Dict[str, Dict] = defaultdict(lambda: {"open": 0, "pending": 0, "capital": 0.0})
        for r in open_pos:
            bs[r["setup"]]["open"] += 1
            bs[r["setup"]]["capital"] += r["capital"]
        for r in pending:
            bs[r["setup"]]["pending"] += 1
            bs[r["setup"]]["capital"] += r["capital"]
        by_setup = [{"setup": s, "open": b["open"], "pending": b["pending"],
                     "capital": round(b["capital"], 2)} for s, b in bs.items()]
        by_setup.sort(key=lambda x: x["capital"], reverse=True)

        return {
            "open": open_pos,
            "pending": pending,
            "summary": {
                "open_count": len(open_pos),
                "pending_count": len(pending),
                "open_capital": round(sum(r["capital"] for r in open_pos), 2),
                "pending_capital": round(sum(r["capital"] for r in pending), 2),
                "total_live_pnl": None,  # set by price augmentation
                "by_setup": by_setup,
            },
            "as_of": as_of,
        }
