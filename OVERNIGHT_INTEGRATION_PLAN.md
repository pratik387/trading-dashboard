# Overnight Setup Integration Plan

**Setup**: `close_dn_overnight_long` (production-truth PF 1.45 over 197 trades, paper-validating since 2026-05-29)
**Status**: Plan — not yet implemented
**Date drafted**: 2026-06-05

## Why this is structurally different from existing instances

The existing `fixed` / `live` instances are LONG-RUNNING processes:

```
Tmux session ── python main.py --paper-trading ── health server :8081
                                                      │
                                                      ├── per-tick websocket
                                                      ├── per-bar 5m scans
                                                      └── /admin endpoints
```

The overnight setup is **two short-lived crons**:

```
crontab:
  27 15 * * 1-5  ./scripts/cron-entry.sh        (~13s)
  30 09 * * 1-5  ./scripts/cron-verify-exit.sh  (~4 min, mostly baseline build)
```

Each cron boots a fresh Python process, does its work, persists state, exits. No
long-running HTTP server, no websocket, no per-tick stream. State lives in
JSON files that any process can read.

## Data sources

| File | Purpose | Schema |
|---|---|---|
| `state/overnight_slots.json` | Live slot pool (current positions) | Array of `{slot_id, status, symbol, buy_fill_price, sell_fill_price, qty, product, margin_inr, notional_inr, fees_inr, interest_inr, realized_pnl_inr, reserved_today, expected_exit_date}` |
| `state/decay_tripwire_close_dn_overnight_long.json` | Sequential settled-trade ledger | Array of `{net_pnl_inr, ts_iso}` |
| `logs/overnight_verify_<date>.log` | Per-day verify-exit log | Plain text |
| `logs/overnight_entry_<date>.log` | Per-day entry log | Plain text |
| `data/close_dn_baseline/candidates_<date>.json` | Per-day pre-filtered candidates | `{session_date, n_candidates, candidates: [{symbol, prior_day_return_pct, ...}]}` |
| `data/close_dn_baseline/baseline_<date>.json` | Per-day vol baseline snapshot | `{session_date, n_symbols_with_baseline, symbols: {sym: {vol_mean, vol_std, n_sessions}}}` |

All on the VM at `~/intraday_fixed/intraday-trade-assistant/`.

## Recommended architecture

**New config type `"overnight"`** — registered alongside `fixed` and `live`. Lives
in the dashboard as a first-class instance, but its data shape is different
from the long-running paper instances.

```python
# api.py
DEFAULT_INSTANCES = {
    "fixed": {"port": 8081, "type": "paper", "description": "Fixed risk paper trading"},
    "overnight": {"port": None, "type": "cron", "description": "close_dn_overnight_long (cron-driven)"},
    "live": {"port": 8090, "type": "live", "description": "Live trading"},
}
```

`port: None` + `type: "cron"` signals: no health server, no websocket, no
`/admin` controls. Backend reads JSON files directly.

## Backend changes

### New file: `overnight_reader.py`

Reads from local filesystem (same VM as the engine):

```python
class OvernightReader:
    """Read overnight setup state + history from JSON files.

    No HTTP server involved. Reads from:
      - state/overnight_slots.json   (live slot pool)
      - state/decay_tripwire_*.json  (trade ledger)
      - data/close_dn_baseline/candidates_*.json (per-day candidates)
      - logs/overnight_*.log         (per-day cron logs)
    """

    def __init__(self, base_path: Path):
        self.base_path = base_path

    def get_slot_pool(self) -> Dict:
        """Current slot states + capacity stats."""

    def get_ledger(self, limit: int = 100) -> List[Dict]:
        """Recent settled-trade PnLs."""

    def get_summary(self) -> Dict:
        """Cumulative PnL, WR, fire count, slot utilization."""

    def get_candidates(self, session_date: str) -> List[Dict]:
        """Pre-filtered candidates for a given session."""

    def get_cron_logs(self, log_type: str, session_date: str) -> str:
        """Raw text of verify-exit or entry log for a session."""
```

### New endpoints in `api.py`

| Endpoint | Returns |
|---|---|
| `GET /api/overnight/pool` | Current slot pool — non-free slots + capacity |
| `GET /api/overnight/ledger?limit=50` | Recent N settled PnLs |
| `GET /api/overnight/summary` | Cumulative PnL, WR, day-by-day breakdown |
| `GET /api/overnight/candidates/{date}` | Candidates file for a date (default: today) |
| `GET /api/overnight/logs/{cron}/{date}` | `cron ∈ {verify, entry}`, returns log text |
| `GET /api/overnight/fires?date=YYYY-MM-DD` | Per-day fire details (symbol, buy, sell, PnL) |

No write endpoints. The overnight setup has no in-band controls — config is
in `config/configuration.json` and modified via git pull on the VM.

## Frontend changes

### New page: `frontend/src/app/overnight/page.tsx`

Three panels:

1. **Slot pool snapshot** (top)
   - Donut: free / t0_open / t1_settling slot counts
   - Active positions table: symbol / product / buy / sell / PnL / expected_exit
   - Capacity stats: used / max / new-positions-today / day cap

2. **Trade ledger** (middle)
   - Cumulative PnL line chart (running sum vs trade #)
   - Per-day summary table: date / fires / WR / day net / cumulative
   - Recent 20 trades table

3. **Today's candidates** (bottom)
   - Top-N candidates by prior_day_return_pct
   - Visual: which got fired vs which were skipped (slot cap / vol_z reject / etc)
   - Cron status: was today's verify-exit cron successful? entry cron?

### Routing

Add to `Navbar.tsx`:
```tsx
<Link href="/overnight">Overnight</Link>
```

### Type definition

```ts
// frontend/src/lib/api.ts
export interface OvernightSlot {
  slot_id: number;
  status: 'free' | 't0_open' | 't1_settling';
  symbol: string | null;
  buy_fill_price: number | null;
  sell_fill_price: number | null;
  product: 'CNC' | 'MTF' | null;
  realized_pnl_inr: number | null;
  expected_exit_date: string | null;
}

export interface OvernightLedgerEntry {
  net_pnl_inr: number;
  ts_iso: string;
}

export interface OvernightSummary {
  total_trades: number;
  cumulative_pnl: number;
  win_rate_pct: number;
  current_open_positions: number;
  max_slots: number;
  daily_breakdown: Array<{
    date: string;
    fires: number;
    net_pnl: number;
    wr_pct: number;
  }>;
}
```

## Implementation phases

### Phase 1 (1 day): Read-only backend
- Write `overnight_reader.py`
- Add 6 GET endpoints to `api.py`
- Register `overnight` instance (port=None, type=cron) in `DEFAULT_INSTANCES`
- Add a `/api/instances/overnight/health` proxy that just checks JSON file freshness instead of HTTP-pinging a port
- Tests for the reader against a sample fixture

### Phase 2 (1 day): Frontend page
- `frontend/src/app/overnight/page.tsx` with the three panels
- Lib client functions in `api.ts`
- Navbar entry
- Use existing chart components (PnLHistogramChart from `Charts.tsx`)

### Phase 3 (0.5 day): Polish + monitoring
- "Cron health" indicator: did today's verify-exit cron run? entry cron?
  Read log file mtime + tail for status. If verify-exit log doesn't exist by
  10:00 IST, flag as missing.
- Stale-slot warning: any slot with `expected_exit_date < today AND status != free`
  flagged in the UI as orphan-pending-cleanup.

### Phase 4 (deferred): Live-style controls
Once live trading on close_dn starts, add admin endpoints to release stuck slots
manually (currently done via `python3` one-liner on the VM). Out of scope for
initial integration.

## Open questions to resolve before Phase 1

1. **Where does the dashboard run?** If it's on the same VM as the engine, the
   reader can use direct file access. If it's on a separate machine, you need
   to either:
   - Sync the state files via rsync/scp on a schedule
   - Or expose a tiny HTTP endpoint on the VM that serves the JSON files
2. **OCI bucket integration for historical view?** Currently `oci_reader.py`
   reads paper-trading session dirs from OCI. Overnight state isn't currently
   uploaded anywhere. Decide:
   - Upload `state/*.json` + `data/close_dn_baseline/*` to OCI nightly
   - Or keep overnight purely VM-local for now (Phase 1 scope)
3. **Multiple overnight setups in future?** The architecture assumes one
   overnight setup. If/when another overnight setup is added (e.g. a SHORT
   variant), the data structure needs a setup_name discriminator. For now
   `close_dn_overnight_long` is hard-coded.

## What this gives you

After Phase 1 + 2:
- One place to see today's overnight fires + their PnL trajectory
- Cumulative paper-validation progress at a glance
- Per-day candidate breakdown (which signals fired, which were missed)
- Cron health status (last successful run of each cron)

Without:
- Having to SSH into the VM and run `python3 -c "import json; ..."` every morning
- Risk of forgetting to check stuck slots
- Wondering why a particular high-conviction candidate didn't fire
