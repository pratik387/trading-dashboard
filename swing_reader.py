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

    def _ledger_trades(self, setup: str, book: str = "paper",
                       regime: str = "current") -> List[Dict]:
        """Per-trade rows for one setup.

        `regime` selects which era to read — the two are deliberately NOT pooled:

          "current"  (default) the live ledger only — what the History page shows
          "archived"           previous regimes only — what the Archive tab shows
          "all"                both, oldest first (research use; see warning)

        Why the split exists: on 2026-08-12 the multi-day book's capital
        management changed (flat Rs1L margin + take-all caps + composite ordering
        -> vol-targeted sizing on a Rs10L risk budget + cluster caps +
        unbiased-hash ordering, crash2d disabled). Median notional halved and 40
        of 121 historical positions would have been capped out, so a statistic
        computed ACROSS the boundary is meaningless — pooling regimes had already
        produced a misleading PF in the overnight book.

        The engine reset its ledgers at that boundary so DecayTripwire's rolling
        PF stays on one regime; the archived files moved to state/archive/. This
        reader can see both, but "current" is the default so no page accidentally
        averages across eras. Rows carry `regime` and `archived` either way.

        book="live" selects the real-money ledger and NEVER reads the paper
        archive. Only the overnight setup trades live so far.
        """
        if regime not in ("current", "archived", "all"):
            raise ValueError(f"unknown regime '{regime}' (expected current/archived/all)")
        suffix = "_live" if book == "live" else ""
        state = self._root_for(setup) / "state"
        out: List[Dict] = []

        if regime in ("archived", "all") and book == "paper":
            for arch in sorted((state / "archive").glob(f"decay_tripwire_{setup}.pre-*.json")):
                try:
                    doc = json.loads(arch.read_text(encoding="utf-8"))
                except Exception:
                    continue
                tag = doc.get("_regime") or arch.stem.split(".", 1)[-1]
                for t in (doc.get("trades") or []):
                    out.append({**t, "regime": tag, "archived": True})

        if regime in ("current", "all"):
            path = state / f"decay_tripwire_{setup}{suffix}.json"
            if path.exists():
                try:
                    doc = json.loads(path.read_text(encoding="utf-8"))
                    tag = doc.get("_regime") or "current"
                    for t in (doc.get("trades") or []):
                        out.append({**t, "regime": tag, "archived": False})
                except Exception:
                    pass
        return out

    def _resolve_setups(self, setup: str) -> List[str]:
        """Expand a family selector to concrete setup names.

        Shared by get_aggregate and list_regimes so both accept the SAME
        vocabulary. They diverged once: list_regimes treated "multiday" as a
        literal setup name, found no archives, and the Archive tab stayed hidden
        even though 180 archived trades existed.
        """
        if setup == "all":
            return list(SWING_SETUPS)
        if setup == "overnight":
            return [s for s in SWING_SETUPS if s in OVERNIGHT_SETUPS]
        if setup == "multiday":
            return [s for s in SWING_SETUPS if s not in OVERNIGHT_SETUPS]
        return [setup]

    def list_regimes(self, setup: str = "all") -> List[Dict]:
        """Archived regimes available, for labelling the Archive tab."""
        setups = self._resolve_setups(setup)
        seen: Dict[str, Dict] = {}
        for s in setups:
            for arch in sorted((self._root_for(s) / "state" / "archive")
                               .glob(f"decay_tripwire_{s}.pre-*.json")):
                try:
                    doc = json.loads(arch.read_text(encoding="utf-8"))
                except Exception:
                    continue
                tag = doc.get("_regime") or arch.stem.split(".", 1)[-1]
                e = seen.setdefault(tag, {"regime": tag, "archived_on": doc.get("_archived_on"),
                                          "setups": [], "trades": 0})
                e["setups"].append(s)
                e["trades"] += len(doc.get("trades") or [])
        return sorted(seen.values(), key=lambda e: str(e.get("archived_on") or ""))

    def get_aggregate(self, setup: str = "all", date_from: Optional[str] = None,
                      date_to: Optional[str] = None, book: str = "paper",
                      regime: str = "current") -> Dict:
        """Pool the swing PnL ledgers into the historic page's AggregateData shape.

        setup: family or single-setup selector —
          "all"       -> every SWING_SETUPS member (overnight + multiday)
          "overnight" -> just the 1-night overnight setup(s)
          "multiday"  -> the 2-3 day multi_day batch (every swing setup that is
                         NOT overnight), pooled like intraday pools its setups
          otherwise   -> a single named setup
        date_from/date_to: inclusive YYYY-MM-DD bounds on the settle date.
        book: "paper" (default) or "live" — live only exists for the overnight
        setup so far; multiday ledgers are paper-only and return empty on live.
        """
        if book not in ("paper", "live"):
            raise ValueError(f"unknown book '{book}' (expected 'paper' or 'live')")
        if setup == "all":
            setups = list(SWING_SETUPS)
        elif setup == "overnight":
            setups = [s for s in SWING_SETUPS if s in OVERNIGHT_SETUPS]
        elif setup == "multiday":
            setups = [s for s in SWING_SETUPS if s not in OVERNIGHT_SETUPS]
        else:
            setups = [setup]

        # Multi-day composite attribution: when one book position is flagged by
        # several setups, its PnL is MIRRORED into every contributor's ledger
        # (rows with attributed=True) so each setup's standalone edge stays
        # measurable. In POOLED views (2+ setups) those mirrors would count the
        # same position twice — skip them; the owner's untagged row carries the
        # book PnL. Single-setup views keep mirrors (that's the edge view).
        pooled = len(setups) > 1
        rows: List[Dict] = []  # {setup, pnl, date}
        for s in setups:
            for t in self._ledger_trades(s, book=book, regime=regime):
                if pooled and t.get("attributed"):
                    continue
                ts = str(t.get("ts_iso", ""))
                if len(ts) < 10:
                    continue
                d = ts[:10]
                if date_from and d < date_from:
                    continue
                if date_to and d > date_to:
                    continue
                fee = t.get("fees_inr")
                rows.append({
                    "setup": s, "pnl": float(t.get("net_pnl_inr", 0.0)), "date": d,
                    "fees": float(fee) if fee is not None else 0.0,
                    # Per-trade detail (None on legacy net-only rows).
                    "symbol": t.get("symbol"),
                    "entry_price": t.get("entry_price"),
                    "exit_price": t.get("exit_price"),
                    "exit_reason": t.get("exit_reason"),
                    "qty": t.get("qty"),
                    "attributed": bool(t["attributed"]) if t.get("attributed") is not None else None,
                })

        total_pnl = sum(r["pnl"] for r in rows)
        total_fees = sum(r["fees"] for r in rows)
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
        # Per-trade rows. Detail is populated once the engine persists it at settle
        # (forward-only); legacy net-only rows keep the placeholder so the tab still
        # renders the PnL + date.
        trades = [{
            "symbol": r["symbol"] if r["symbol"] is not None else "—",
            "setup": r["setup"], "pnl": round(r["pnl"], 2),
            "exit_reason": r["exit_reason"] if r["exit_reason"] is not None else "settled",
            "entry": r["entry_price"] if r["entry_price"] is not None else 0,
            "exit": r["exit_price"] if r["exit_price"] is not None else 0,
            "qty": r["qty"] if r["qty"] is not None else 0,
            "date": r["date"],
            # True on mirror rows (single-setup edge view only; pooled views
            # exclude mirrors before this point). Lets the UI badge them.
            "attributed": r.get("attributed"),
        } for r in rows]

        return {
            "config_type": "swing",
            "capital": None,
            "days": days,
            # net_pnl_inr is already net of fees+interest; gross = net + fees when
            # the ledger carries the cost breakdown, else gross falls back to net.
            "gross_pnl": round(total_pnl + total_fees, 2),
            "net_pnl": round(total_pnl, 2),
            "total_pnl": round(total_pnl, 2),
            "total_trades": total_trades,
            "winners": winners,
            "losers": losers,
            "win_rate": round(winners / total_trades * 100, 1) if total_trades else 0.0,
            "total_fees": round(total_fees, 2),
            "avg_pnl_per_day": round(total_pnl / days, 2) if days else 0.0,
            "avg_pnl_per_trade": round(total_pnl / total_trades, 2) if total_trades else 0.0,
            "by_setup": by_setup,
            "daily_data": daily_data,
            "trades": trades,
            "date_from": daily_data[0]["date"] if daily_data else None,
            "date_to": daily_data[-1]["date"] if daily_data else None,
        }
