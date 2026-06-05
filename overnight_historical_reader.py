"""Historical overnight setup reader — reads archived state from OCI.

Paired with the engine-side `oci/tools/upload_overnight_state.py` archival
cron that uploads daily snapshots to:
    paper-trading-logs/overnight/close_dn_overnight_long/<date>/{file}

This reader is the OCI counterpart of `overnight_reader.OvernightReader`
(VM-local, today-only). Same return shapes so the same React components
can render both — the page just switches its data source based on the
selected date.

Files per archived date:
    overnight_slots.json   -- EOD snapshot of slot pool that day
    decay_tripwire.json    -- ledger as-of EOD (cumulative, not delta)
    baseline.json          -- per-day baseline (one-shot at 09:30)
    candidates.json        -- per-day candidate list (one-shot at 09:30)
    verify_exit.log        -- 09:30 cron log
    entry.log              -- 15:27 cron log

Spec: OVERNIGHT_INTEGRATION_PLAN.md (Phase 3)
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, date as _date
from typing import Dict, List, Optional

import oci


_SETUP_NAME = "close_dn_overnight_long"
_DEFAULT_BUCKET = "paper-trading-logs"
_ARCHIVE_PREFIX = f"overnight/{_SETUP_NAME}/"


class OvernightHistoricalReader:
    """Read overnight-setup archived state from OCI Object Storage.

    Mirrors the OvernightReader (VM-local) shape so the frontend can
    swap between live and historical sources without conditional code.
    """

    def __init__(self, bucket_name: str = _DEFAULT_BUCKET):
        self.bucket_name = bucket_name
        self._init_client()

    def _init_client(self):
        try:
            self.config = oci.config.from_file()
            self.os_client = oci.object_storage.ObjectStorageClient(self.config)
        except Exception:
            try:
                signer = oci.auth.signers.InstancePrincipalsSecurityTokenSigner()
                self.os_client = oci.object_storage.ObjectStorageClient(
                    config={}, signer=signer
                )
                self.config = None
            except Exception as e:
                raise RuntimeError(
                    "Could not initialize OCI client for overnight historical "
                    "reader. Ensure ~/.oci/config exists or running on OCI "
                    f"with instance principal. Error: {e}"
                )
        self.namespace = self.os_client.get_namespace().data

    # ─── List available dates ───────────────────────────────────────────

    def list_dates(self) -> List[str]:
        """Return sorted descending list of archived dates (newest first)."""
        response = self.os_client.list_objects(
            namespace_name=self.namespace,
            bucket_name=self.bucket_name,
            prefix=_ARCHIVE_PREFIX,
            delimiter="/",
            limit=1000,
        )
        prefixes = response.data.prefixes or []
        # Each prefix is like "overnight/close_dn_overnight_long/2026-06-05/"
        dates = []
        for p in prefixes:
            stem = p.rstrip("/").split("/")[-1]
            # validate it's a date
            try:
                _date.fromisoformat(stem)
                dates.append(stem)
            except ValueError:
                continue
        return sorted(dates, reverse=True)

    # ─── Internal: object read helpers ──────────────────────────────────

    def _object_name(self, archive_date: str, filename: str) -> str:
        return f"{_ARCHIVE_PREFIX}{archive_date}/{filename}"

    def _get_json(self, archive_date: str, filename: str) -> Dict:
        name = self._object_name(archive_date, filename)
        try:
            response = self.os_client.get_object(
                namespace_name=self.namespace,
                bucket_name=self.bucket_name,
                object_name=name,
            )
            return json.loads(response.data.content)
        except oci.exceptions.ServiceError as e:
            if e.status == 404:
                return {}
            raise
        except Exception:
            return {}

    def _get_text(self, archive_date: str, filename: str) -> Optional[str]:
        name = self._object_name(archive_date, filename)
        try:
            response = self.os_client.get_object(
                namespace_name=self.namespace,
                bucket_name=self.bucket_name,
                object_name=name,
            )
            return response.data.content.decode("utf-8", errors="replace")
        except oci.exceptions.ServiceError as e:
            if e.status == 404:
                return None
            raise
        except Exception:
            return None

    # ─── Endpoints (mirrors OvernightReader) ────────────────────────────

    def get_slot_pool(self, archive_date: str) -> Dict:
        """Return archived slot pool state for `archive_date`.

        Shape matches OvernightReader.get_slot_pool but with `loaded_from`
        pointing at the OCI object name. "Stale" semantics don't apply
        for historical snapshots (every t0/t1 from that day eventually
        settled or got released), so stale_slots is always [].
        """
        data = self._get_json(archive_date, "overnight_slots.json")
        slots = data.get("slots", [])
        max_slots = int(data.get("max_slots", len(slots)))

        free, t0, t1 = 0, 0, 0
        active: List[Dict] = []
        new_count = 0

        for s in slots:
            status = s.get("status")
            if status == "free":
                free += 1
                continue
            elif status == "t0_open":
                t0 += 1
            elif status == "t1_settling":
                t1 += 1

            if s.get("reserved_today") == archive_date:
                new_count += 1

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
            active.append(entry)

        return {
            "max_slots": max_slots,
            "free_count": free,
            "t0_open_count": t0,
            "t1_settling_count": t1,
            "new_today_count": new_count,
            "active_slots": active,
            "stale_slots": [],
            "loaded_from": f"oci://{self.bucket_name}/{self._object_name(archive_date, 'overnight_slots.json')}",
            "loaded_at": None,
            "archive_date": archive_date,
        }

    def get_ledger(self, archive_date: str, limit: Optional[int] = None) -> Dict:
        """Return archived tripwire ledger as-of `archive_date` EOD."""
        data = self._get_json(archive_date, "decay_tripwire.json")
        trades = data.get("trades", [])
        if limit:
            trades = trades[-limit:]
        return {
            "setup_name": _SETUP_NAME,
            "window_trades": data.get("window_trades"),
            "pf_floor": data.get("pf_floor"),
            "trades": trades,
            "first_below_floor_ts": data.get("first_below_floor_ts"),
            "paused_since": data.get("paused_since"),
            "loaded_from": f"oci://{self.bucket_name}/{self._object_name(archive_date, 'decay_tripwire.json')}",
            "loaded_at": None,
            "archive_date": archive_date,
        }

    def get_summary(self, archive_date: str) -> Dict:
        """Cumulative as-of-`archive_date` summary + day-by-day breakdown."""
        ledger = self.get_ledger(archive_date)
        trades = ledger["trades"]

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

        pool = self.get_slot_pool(archive_date)
        return {
            "setup_name": _SETUP_NAME,
            "total_trades": len(trades),
            "cumulative_pnl": round(total_pnl, 2),
            "wins": wins,
            "losses": len(trades) - wins,
            "win_rate_pct": round((wins / len(trades) * 100), 1) if trades else 0.0,
            "current_open_positions": pool["t0_open_count"] + pool["t1_settling_count"],
            "max_slots": pool["max_slots"],
            "stale_slot_count": 0,
            "daily_breakdown": daily_breakdown,
            "archive_date": archive_date,
        }

    def get_candidates(self, archive_date: str) -> Dict:
        """Return archived candidate list for `archive_date`."""
        data = self._get_json(archive_date, "candidates.json")
        return {
            "session_date": data.get("session_date") or archive_date,
            "cell_min_prior_ret_pct": data.get("cell_min_prior_ret_pct"),
            "computed_at": data.get("computed_at"),
            "n_candidates": data.get("n_candidates", 0),
            "candidates": data.get("candidates", []),
            "loaded_from": f"oci://{self.bucket_name}/{self._object_name(archive_date, 'candidates.json')}",
            "loaded_at": None,
            "archive_date": archive_date,
        }

    def get_log(self, archive_date: str, cron: str) -> Dict:
        """Return archived log text. cron ∈ {'verify', 'entry'}."""
        if cron == "verify":
            filename = "verify_exit.log"
        elif cron == "entry":
            filename = "entry.log"
        else:
            return {"error": f"unknown cron '{cron}'"}
        content = self._get_text(archive_date, filename)
        if content is None:
            return {"error": "log not archived", "object": self._object_name(archive_date, filename)}
        return {
            "cron": cron,
            "session_date": archive_date,
            "size_bytes": len(content.encode("utf-8")),
            "content": content,
        }
