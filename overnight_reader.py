"""Overnight setup reader — direct VM-local filesystem access.

Reads state for `close_dn_overnight_long` from the engine's local files.
No HTTP indirection — the dashboard runs on the same VM as the engine,
so direct file access is the simplest and lowest-latency path.

Files read (all under base_path):
    state/overnight_slots.json
    state/decay_tripwire_close_dn_overnight_long.json        (paper book)
    state/decay_tripwire_close_dn_overnight_long_live.json   (live book)
    data/close_dn_baseline/candidates_<date>.json
    data/close_dn_baseline/candidates_latest.json
    data/close_dn_baseline/baseline_<date>.json
    logs/overnight_verify_<date>.log
    logs/overnight_entry_<date>.log

The reader is read-only. Any state mutation (release a stuck slot,
reset tripwire) happens via the engine's own tooling on the VM.

Spec: OVERNIGHT_INTEGRATION_PLAN.md
"""
from __future__ import annotations

import json
import os
from collections import defaultdict
from datetime import datetime, date as _date
from pathlib import Path
from typing import Dict, List, Optional


# Engine repo root on the VM — same convention as local_reader.py.
DEFAULT_ENGINE_ROOT = Path.home() / "intraday_fixed" / "intraday-trade-assistant"

# Setup name. Hard-coded for Phase 1; generalize if/when a second
# overnight setup ships.
SETUP_NAME = "close_dn_overnight_long"

# Two tripwire ledgers on the engine VM since real-money activation:
#   paper — Rs1L idealized reconstruction (research continuity)
#   live  — real fills, real sizing
LEDGER_FILES = {
    "paper": f"decay_tripwire_{SETUP_NAME}.json",
    "live": f"decay_tripwire_{SETUP_NAME}_live.json",
}


class OvernightReader:
    """Read overnight-setup state + history from JSON files on disk.

    Initialize with the engine repo root. Defaults to the standard
    `~/intraday_fixed/intraday-trade-assistant/` layout used by the cron jobs.
    """

    def __init__(self, base_path: Optional[Path] = None):
        self.base_path: Path = Path(base_path) if base_path else DEFAULT_ENGINE_ROOT
        self.state_dir: Path = self.base_path / "state"
        self.baseline_dir: Path = self.base_path / "data" / "close_dn_baseline"
        self.logs_dir: Path = self.base_path / "logs"

    # ─── Slot pool ─────────────────────────────────────────────────────

    def get_slot_pool(self) -> Dict:
        """Return slot pool state + capacity stats.

        Output:
            {
                "max_slots": int,
                "free_count": int,
                "t0_open_count": int,
                "t1_settling_count": int,
                "new_today_count": int,
                "active_slots": [
                    {
                        "slot_id": int,
                        "status": "t0_open" | "t1_settling",
                        "symbol": str | None,
                        "buy_fill_price": float | None,
                        "sell_fill_price": float | None,
                        "product": "CNC" | "MTF" | None,
                        "qty": int | None,
                        "margin_inr": float | None,
                        "notional_inr": float | None,
                        "fees_inr": float | None,
                        "interest_inr": float | None,
                        "realized_pnl_inr": float | None,
                        "reserved_today": str | None,
                        "expected_exit_date": str | None,
                    }, ...
                ],
                "stale_slots": [...same shape, but expected_exit_date < today...],
                "loaded_from": "<path>",
                "loaded_at": "<iso>",
            }
        """
        path = self.state_dir / "overnight_slots.json"
        data = _load_json(path)
        slots = data.get("slots", [])
        max_slots = int(data.get("max_slots", len(slots)))

        free, t0, t1 = 0, 0, 0
        active: List[Dict] = []
        stale: List[Dict] = []
        today = _date.today().isoformat()
        new_today_count = 0

        for s in slots:
            status = s.get("status")
            if status == "free":
                free += 1
                continue
            elif status == "t0_open":
                t0 += 1
            elif status == "t1_settling":
                t1 += 1

            # Count new_today: slots reserved today
            if s.get("reserved_today") == today:
                new_today_count += 1

            entry = {
                "slot_id": s.get("slot_id"),
                "status": status,
                "symbol": s.get("symbol"),
                "buy_fill_price": s.get("buy_fill_price"),
                "sell_fill_price": s.get("sell_fill_price"),
                "product": s.get("product"),
                "margin_inr": s.get("margin_inr"),
                "notional_inr": s.get("notional_inr"),
                "fees_inr": s.get("fees_inr"),
                "interest_inr": s.get("interest_inr"),
                "realized_pnl_inr": s.get("realized_pnl_inr"),
                "reserved_today": s.get("reserved_today"),
                "expected_exit_date": s.get("expected_exit_date"),
            }
            buy = s.get("buy_fill_price")
            notional = s.get("notional_inr")
            if buy and notional:
                entry["qty"] = int(round(notional / buy))

            # Stale = REAL orphan (cron broken / settle never happened), NOT a slot
            # in its normal T+1/T+2 release window.
            #
            # Slot lifecycle for close_dn_overnight_long:
            #   Day T   15:26: BUY fills -> status="t0_open", exit_d=T+1
            #   Day T+1 09:30: AMO fills -> settle() -> status="t1_settling"
            #   Day T+2 09:30: cash credited -> release() -> status="free"
            #
            # Between T+1 09:30 and T+2 09:30, a slot is correctly t1_settling
            # with exit_d=T+1 (already in the past). That is NOT stale — it's
            # awaiting today's release cron. Flagging it alarms unnecessarily.
            #
            # Real orphans we want to surface:
            #   * t0_open with exit_d < today  -> AMO never filled / settle never ran
            #   * t1_settling with exit_d > 3 calendar days ago -> release cron broken
            #     (3 days covers weekends + 1 holiday; the natural window is 1
            #     trading day, so anything beyond that is genuinely stuck)
            exit_d = s.get("expected_exit_date")
            if exit_d and status != "free":
                exit_dt = _date.fromisoformat(exit_d)
                today_dt = _date.fromisoformat(today)
                if status == "t0_open" and exit_dt < today_dt:
                    stale.append(entry)
                elif status == "t1_settling" and (today_dt - exit_dt).days > 3:
                    stale.append(entry)
            active.append(entry)

        return {
            "max_slots": max_slots,
            "free_count": free,
            "t0_open_count": t0,
            "t1_settling_count": t1,
            "new_today_count": new_today_count,
            "active_slots": active,
            "stale_slots": stale,
            "loaded_from": str(path.relative_to(self.base_path)),
            "loaded_at": _file_mtime_iso(path),
        }

    # ─── Trade ledger ──────────────────────────────────────────────────

    def get_ledger(self, limit: Optional[int] = None, book: str = "paper",
                   as_of: Optional[str] = None) -> Dict:
        """Return tripwire ledger entries (all settled trade PnLs in order).

        `book` selects which ledger: "paper" (Rs1L idealized) or "live"
        (real fills, real sizing). Raises ValueError on anything else.
        `as_of` (YYYY-MM-DD) keeps only trades settled ON OR BEFORE that date —
        an exact as-of-EOD historical view while the ledger is append-only
        (the live book's history path; the tripwire only trims past ~150
        trades, and the OCI archive covers the long tail).

        Note: each entry currently only has {net_pnl_inr, ts_iso} — symbol
        and per-trade detail must be reconstructed from the slot pool at
        settle time. For richer per-trade history, sees the engine's
        archival pipeline (Phase 3+) or re-derive from logs.
        """
        if book not in LEDGER_FILES:
            raise ValueError(f"unknown book '{book}' (expected one of {sorted(LEDGER_FILES)})")
        path = self.state_dir / LEDGER_FILES[book]
        data = _load_json(path)
        trades = data.get("trades", [])
        if as_of:
            trades = [t for t in trades if str(t.get("ts_iso", ""))[:10] <= as_of]
        if limit:
            trades = trades[-limit:]
        return {
            "setup_name": SETUP_NAME,
            "book": book,
            "window_trades": data.get("window_trades"),
            "pf_floor": data.get("pf_floor"),
            "trades": trades,
            "first_below_floor_ts": data.get("first_below_floor_ts"),
            "paused_since": data.get("paused_since"),
            "loaded_from": str(path.relative_to(self.base_path)) if path.exists() else None,
            "loaded_at": _file_mtime_iso(path),
        }

    def get_paper_open(self) -> Dict:
        """Fires from the latest entry run with idealized Rs1L entries — the
        paper book's OPEN view (the ledger only materializes them at the next
        09:45 reconstruction). Every fire is included (taken/capped/rejected)."""
        path = self.state_dir / "overnight_paper_open.json"
        data = _load_json(path)
        fires = data.get("fires", [])
        out = []
        for f in fires:
            entry = float(f.get("entry_price") or 0.0)
            lev = float(f.get("leverage") or 1.0)
            qty = int((100000.0 * lev) // entry) if entry > 0 else 0
            out.append({**f, "paper_qty": qty,
                        "paper_notional": round(qty * entry, 2)})
        return {
            "session_date": data.get("session_date"),
            "written_at": data.get("written_at"),
            "fires": out,
            "loaded_from": str(path.relative_to(self.base_path)) if path.exists() else None,
            "loaded_at": _file_mtime_iso(path),
        }

    # ─── Summary ───────────────────────────────────────────────────────

    def get_summary(self, book: str = "paper", as_of: Optional[str] = None) -> Dict:
        """Return cumulative PnL summary + daily breakdown for `book`.

        `book` ∈ {"paper", "live"} — see get_ledger; `as_of` bounds the view to
        trades settled on or before that date. Daily breakdown uses ledger
        timestamps (the day verify-exit recorded the trade), not signal/entry
        day. Close enough for the dashboard's purposes.
        """
        ledger = self.get_ledger(book=book, as_of=as_of)
        trades = ledger["trades"]

        # Daily aggregation
        daily: Dict[str, Dict] = defaultdict(lambda: {"fires": 0, "net_pnl": 0.0, "wins": 0})
        total_pnl = 0.0
        wins = 0
        for t in trades:
            ts = t.get("ts_iso", "")
            if len(ts) < 10:
                continue
            d = ts[:10]
            pnl = float(t.get("net_pnl_inr", 0.0))
            daily[d]["fires"] += 1
            daily[d]["net_pnl"] += pnl
            if pnl > 0:
                daily[d]["wins"] += 1
                wins += 1
            total_pnl += pnl

        daily_breakdown = []
        for d in sorted(daily.keys()):
            row = daily[d]
            fires = row["fires"]
            daily_breakdown.append({
                "date": d,
                "fires": fires,
                "net_pnl": round(row["net_pnl"], 2),
                "wr_pct": round((row["wins"] / fires * 100), 1) if fires else 0.0,
            })

        # Current open positions from slot pool
        pool = self.get_slot_pool()

        return {
            "setup_name": SETUP_NAME,
            "book": book,
            "total_trades": len(trades),
            "cumulative_pnl": round(total_pnl, 2),
            "wins": wins,
            "losses": len(trades) - wins,
            "win_rate_pct": round((wins / len(trades) * 100), 1) if trades else 0.0,
            "current_open_positions": pool["t0_open_count"] + pool["t1_settling_count"],
            "max_slots": pool["max_slots"],
            "stale_slot_count": len(pool["stale_slots"]),
            "daily_breakdown": daily_breakdown,
        }

    # ─── Candidates ────────────────────────────────────────────────────

    def get_candidates(self, session_date: Optional[str] = None) -> Dict:
        """Return pre-filtered candidates for a session date.

        Pass `session_date=None` to read `candidates_latest.json` (whatever
        the last verify-exit cron wrote).
        """
        if session_date:
            path = self.baseline_dir / f"candidates_{session_date}.json"
        else:
            path = self.baseline_dir / "candidates_latest.json"
        data = _load_json(path)
        return {
            "session_date": data.get("session_date"),
            "cell_min_prior_ret_pct": data.get("cell_min_prior_ret_pct"),
            "computed_at": data.get("computed_at"),
            "n_candidates": data.get("n_candidates", 0),
            "candidates": data.get("candidates", []),
            "loaded_from": str(path.relative_to(self.base_path)) if path.exists() else None,
            "loaded_at": _file_mtime_iso(path),
        }

    # ─── Per-day fires (derived) ───────────────────────────────────────

    def get_fires_for_date(self, session_date: str, book: str = "paper") -> Dict:
        """Return all trades that *settled* on `session_date`.

        `book` ∈ {"paper", "live"} — see get_ledger. Cross-references the
        ledger (PnL by ts_iso day) with the current slot pool to enrich
        with symbol/buy/sell where possible. For slots already released,
        only the PnL is available.
        """
        ledger = self.get_ledger(book=book)
        pool = self.get_slot_pool()
        # Symbol map from current pool — only covers t1_settling slots
        # whose expected_exit_date matches the queried date.
        pool_by_sym_date: Dict[str, Dict] = {}
        for s in pool["active_slots"]:
            ed = s.get("expected_exit_date")
            sym = s.get("symbol")
            if ed and sym and ed == session_date:
                pool_by_sym_date[sym] = s

        fires: List[Dict] = []
        for t in ledger["trades"]:
            ts = t.get("ts_iso", "")
            if not ts.startswith(session_date):
                continue
            entry = {
                "net_pnl_inr": t.get("net_pnl_inr"),
                "ts_iso": ts,
            }
            fires.append(entry)

        return {
            "session_date": session_date,
            "n_fires": len(fires),
            "fires": fires,
            "note": (
                "Per-trade symbol/buy/sell only available for slots still in "
                "t1_settling state. Older settled-and-released slots show "
                "PnL only. Phase 3+ archival lets us reconstruct full history."
            ),
        }

    # ─── Cron health ───────────────────────────────────────────────────

    def get_cron_health(self) -> Dict:
        """Return health status of today's verify-exit + entry crons.

        Each cron writes one log per day. Presence + mtime indicate health.
        """
        today = _date.today().isoformat()
        verify_log = self.logs_dir / f"overnight_verify_{today}.log"
        entry_log = self.logs_dir / f"overnight_entry_{today}.log"

        return {
            "today": today,
            "verify_exit": {
                "log_path": str(verify_log.relative_to(self.base_path)) if verify_log.exists() else None,
                "exists": verify_log.exists(),
                "mtime_iso": _file_mtime_iso(verify_log),
                "tail": _file_tail(verify_log, n_lines=10),
            },
            "entry": {
                "log_path": str(entry_log.relative_to(self.base_path)) if entry_log.exists() else None,
                "exists": entry_log.exists(),
                "mtime_iso": _file_mtime_iso(entry_log),
                "tail": _file_tail(entry_log, n_lines=10),
            },
        }

    def get_log(self, cron: str, session_date: str) -> Dict:
        """Return raw log text for a cron run.

        cron ∈ {"verify", "entry"}
        """
        if cron == "verify":
            path = self.logs_dir / f"overnight_verify_{session_date}.log"
        elif cron == "entry":
            path = self.logs_dir / f"overnight_entry_{session_date}.log"
        else:
            return {"error": f"unknown cron '{cron}' (expected 'verify' or 'entry')"}
        if not path.exists():
            return {"error": "log not found", "path": str(path.relative_to(self.base_path))}
        return {
            "cron": cron,
            "session_date": session_date,
            "mtime_iso": _file_mtime_iso(path),
            "size_bytes": path.stat().st_size,
            "content": path.read_text(encoding="utf-8", errors="replace"),
        }


# ─── Helpers (file-private) ────────────────────────────────────────────


def _load_json(path: Path) -> Dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _file_mtime_iso(path: Path) -> Optional[str]:
    if not path.exists():
        return None
    return datetime.fromtimestamp(path.stat().st_mtime).isoformat()


def _file_tail(path: Path, n_lines: int = 10) -> Optional[str]:
    if not path.exists():
        return None
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        return "\n".join(lines[-n_lines:])
    except Exception:
        return None
