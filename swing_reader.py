"""SwingReader — delivery/swing performance reader (VM-local filesystem).

Generalizes the overnight integration across the whole SWING family — the
1-night `close_dn_overnight_long` plus the 2-3 day multi_day capitulation batch
(`mtf_capitulation_revert_long`, `low52_…`, `zscore_…`, `crash2d_…`). They share
an identical per-setup PnL ledger:

    state/decay_tripwire_<setup>.json  ->  {"trades": [{net_pnl_inr, ts_iso}, ...]}

`get_aggregate()` pools those ledgers (optionally filtered to one setup / a date
range) into the SAME `AggregateData` shape the historic page already renders for
intraday (`/api/runs/<type>/aggregate`), so the page reuses its existing tabs +
charts for the swing family.

Read-only. Per-trade symbol/entry/exit are NOT in the tripwire ledger, so the
`trades` rows carry PnL+setup+date only (symbol = "—"); full per-trade detail
needs engine-side events.jsonl wiring for the swing setups (a separate phase).

Sibling of overnight_reader.py (which stays for the live slot-pool / cron view).
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Optional

# Engine repo roots on the VM. Overnight and the multi_day batch run as TWO
# independent deployments out of DIFFERENT folders (separate crons / venvs), so
# each setup's state/ledger lives under its own engine root — not one shared path.
OVERNIGHT_ENGINE_ROOT = Path.home() / "intraday_fixed" / "intraday-trade-assistant"
MULTIDAY_ENGINE_ROOT = Path.home() / "multiday_cnc" / "intraday-trade-assistant"

# The swing/delivery family: 1-night overnight + the 2-3 day multi_day batch.
SWING_SETUPS: List[str] = [
    "close_dn_overnight_long",
    "mtf_capitulation_revert_long",
    "low52_capitulation_revert_long",
    "zscore_oversold_revert_long",
    "crash2d_revert_long",
]

# Which deployment each setup runs out of.
OVERNIGHT_SETUPS = {"close_dn_overnight_long"}


def _default_root_for(setup: str) -> Path:
    return OVERNIGHT_ENGINE_ROOT if setup in OVERNIGHT_SETUPS else MULTIDAY_ENGINE_ROOT


class SwingReader:
    def __init__(self, base_path: Optional[Path] = None,
                 roots: Optional[Dict[str, Path]] = None):
        """base_path: single override applied to EVERY setup (tests / a one-folder
        deploy). roots: per-setup {setup -> engine_root} override. With neither, each
        setup resolves to its real VM root (overnight -> intraday_fixed, multi_day
        batch -> multiday_cnc)."""
        self.base_path: Optional[Path] = Path(base_path) if base_path else None
        self.roots: Dict[str, Path] = {s: Path(p) for s, p in (roots or {}).items()}

    def _root_for(self, setup: str) -> Path:
        if self.base_path is not None:
            return self.base_path
        if setup in self.roots:
            return self.roots[setup]
        return _default_root_for(setup)

    def _ledger_trades(self, setup: str) -> List[Dict]:
        path = self._root_for(setup) / "state" / f"decay_tripwire_{setup}.json"
        if not path.exists():
            return []
        try:
            return json.loads(path.read_text(encoding="utf-8")).get("trades", []) or []
        except Exception:
            return []

    def get_aggregate(self, setup: str = "all", date_from: Optional[str] = None,
                      date_to: Optional[str] = None) -> Dict:
        """Pool the swing PnL ledgers into the historic page's AggregateData shape.

        setup: "all" pools every SWING_SETUPS member; otherwise a single setup.
        date_from/date_to: inclusive YYYY-MM-DD bounds on the settle date.
        """
        setups = SWING_SETUPS if setup == "all" else [setup]

        rows: List[Dict] = []  # {setup, pnl, date}
        for s in setups:
            for t in self._ledger_trades(s):
                ts = str(t.get("ts_iso", ""))
                if len(ts) < 10:
                    continue
                d = ts[:10]
                if date_from and d < date_from:
                    continue
                if date_to and d > date_to:
                    continue
                rows.append({"setup": s, "pnl": float(t.get("net_pnl_inr", 0.0)), "date": d})

        total_pnl = sum(r["pnl"] for r in rows)
        total_trades = len(rows)
        winners = sum(1 for r in rows if r["pnl"] > 0)
        losers = total_trades - winners

        # Per-setup breakdown (the "setups" tab).
        bs: Dict[str, Dict] = defaultdict(lambda: {"pnl": 0.0, "count": 0, "wins": 0})
        for r in rows:
            b = bs[r["setup"]]
            b["pnl"] += r["pnl"]; b["count"] += 1
            if r["pnl"] > 0:
                b["wins"] += 1
        by_setup = [{
            "setup": s, "trades": b["count"], "pnl": round(b["pnl"], 2), "wins": b["wins"],
            "win_rate": round(b["wins"] / b["count"] * 100, 1) if b["count"] else 0.0,
            "avg_pnl": round(b["pnl"] / b["count"], 2) if b["count"] else 0.0,
        } for s, b in bs.items()]
        by_setup.sort(key=lambda x: x["pnl"], reverse=True)

        # Daily breakdown + cumulative (the "daily" tab + equity curve).
        dd: Dict[str, Dict] = defaultdict(lambda: {"pnl": 0.0, "trades": 0, "winners": 0})
        for r in rows:
            day = dd[r["date"]]
            day["pnl"] += r["pnl"]; day["trades"] += 1
            if r["pnl"] > 0:
                day["winners"] += 1
        daily_data: List[Dict] = []
        cum = 0.0
        for d in sorted(dd.keys()):
            row = dd[d]; cum += row["pnl"]
            tr, w = row["trades"], row["winners"]
            daily_data.append({
                "date": d, "run_id": "", "pnl": round(row["pnl"], 2),
                "trades": tr, "winners": w, "losers": tr - w,
                "win_rate": round(w / tr * 100, 1) if tr else 0.0,
                "cumulative_pnl": round(cum, 2),
            })

        days = len(daily_data)
        trades = [{
            "symbol": "—", "setup": r["setup"], "pnl": round(r["pnl"], 2),
            "exit_reason": "settled", "entry": 0, "exit": 0, "date": r["date"],
        } for r in rows]

        return {
            "config_type": "swing",
            "capital": None,
            "days": days,
            "gross_pnl": round(total_pnl, 2),
            "net_pnl": round(total_pnl, 2),   # tripwire ledger is already net of fees+interest
            "total_pnl": round(total_pnl, 2),
            "total_trades": total_trades,
            "winners": winners,
            "losers": losers,
            "win_rate": round(winners / total_trades * 100, 1) if total_trades else 0.0,
            "total_fees": 0,
            "avg_pnl_per_day": round(total_pnl / days, 2) if days else 0.0,
            "avg_pnl_per_trade": round(total_pnl / total_trades, 2) if total_trades else 0.0,
            "by_setup": by_setup,
            "daily_data": daily_data,
            "trades": trades,
            "date_from": daily_data[0]["date"] if daily_data else None,
            "date_to": daily_data[-1]["date"] if daily_data else None,
        }
