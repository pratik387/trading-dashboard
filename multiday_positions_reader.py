"""MultidayPositionsReader — the OPEN multi-day book (pre-settle), VM-local.

The swing historic page shows SETTLED PnL (pooled decay_tripwire ledgers). That
view stays empty for a setup until its first trade exits. This reader surfaces the
live, not-yet-settled positions so the multi_day book is visible from entry — the
AMO-pending and held positions, with notional, leverage, and the exit date.

Source: the engine's per-setup position snapshots under the multi_day deployment
root (the 4 capitulation setups run out of ~/multiday_cnc):

    state/<x>_slots_positions/positions_snapshot.json
        -> {"timestamp": ..., "positions": {symbol: {qty, plan.setup, state{...},
                                                      entry_date, exit_on_date, product}}}

Read-only. Grouped by plan.setup (the full setup name lives on each position), so
no fragile directory-name mapping. Sibling of SwingReader (settled PnL) and
OvernightReader (the overnight slot pool).
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Optional

# The multi_day capitulation batch runs out of this engine root on the VM
# (same convention as SwingReader's MULTIDAY_ENGINE_ROOT).
try:
    from swing_reader import MULTIDAY_ENGINE_ROOT as _DEFAULT_ROOT
except Exception:  # pragma: no cover - standalone fallback
    _DEFAULT_ROOT = Path.home() / "multiday_cnc" / "intraday-trade-assistant"


class MultidayPositionsReader:
    def __init__(self, base_path: Optional[Path] = None):
        self.base_path: Path = Path(base_path) if base_path else _DEFAULT_ROOT
        self.state_dir: Path = self.base_path / "state"

    def get_open_positions(self) -> Dict:
        """Return the open multi_day positions grouped by setup.

        Output:
            {
              "positions": [ {setup, symbol, qty, product, leverage, signal_close,
                              notional, signal_date, entry_date, exit_on_date,
                              status}, ... ],   # status: "pending_fill" | "held"
              "by_setup": [ {setup, count, notional}, ... ],  # desc by notional
              "total_positions": int,
              "total_notional": float,
              "as_of": <latest snapshot timestamp or None>,
            }
        """
        rows: List[Dict] = []
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
                qty = int(p.get("qty") or st.get("qty") or 0)
                signal_close = float(st.get("signal_close") or 0.0)
                rows.append({
                    "setup": (p.get("plan") or {}).get("setup", "unknown"),
                    "symbol": p.get("symbol") or sym,
                    "qty": qty,
                    "product": p.get("product"),
                    "leverage": st.get("leverage"),
                    "signal_close": signal_close,
                    "notional": round(qty * signal_close, 2),
                    "signal_date": st.get("signal_date"),
                    "entry_date": p.get("entry_date"),
                    "exit_on_date": p.get("exit_on_date"),
                    "status": "pending_fill" if st.get("pending_entry_fill") else "held",
                })

        rows.sort(key=lambda r: (r["setup"], -r["notional"]))

        bs: Dict[str, Dict] = defaultdict(lambda: {"count": 0, "notional": 0.0})
        for r in rows:
            b = bs[r["setup"]]
            b["count"] += 1
            b["notional"] += r["notional"]
        by_setup = [{"setup": s, "count": b["count"], "notional": round(b["notional"], 2)}
                    for s, b in bs.items()]
        by_setup.sort(key=lambda x: x["notional"], reverse=True)

        return {
            "positions": rows,
            "by_setup": by_setup,
            "total_positions": len(rows),
            "total_notional": round(sum(r["notional"] for r in rows), 2),
            "as_of": as_of,
        }
