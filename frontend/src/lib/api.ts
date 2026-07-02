const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface LiveSummary {
  run_id: string;
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
  open_positions: Position[];
  open_position_count: number;
  closed_trades: number;
  winners: number;
  losers: number;
  win_rate: number;
  initial_capital: number;
  capital_in_positions: number;
  available_capital: number;
  capital_utilization_pct: number;
  last_updated: string;
}

export interface PartialExit {
  qty: number;
  price: number;
  pnl: number;
  reason: string;
  time: string;
}

export interface Position {
  trade_id: string;
  symbol: string;
  entry_price: number;
  current_price?: number;
  qty: number;
  remaining_qty?: number;
  exited_qty?: number;
  side: string;
  setup: string;
  entry_time: string;
  unrealized_pnl?: number;
  price_change_pct?: number;
  booked_pnl?: number;
  partial_exits?: PartialExit[];
}

export interface ClosedPosition {
  trade_id: string;
  symbol: string;
  entry_price: number;
  exit_price: number;
  qty: number;
  side: string;
  setup: string;
  entry_time: string;
  exit_time: string;
  exit_reason: string;
  pnl: number;
}

export interface ConfigType {
  name: string;
  description: string;
}

export interface Run {
  run_id: string;
  config_type: string;
  timestamp: string;
  path: string;
}

// API Functions

// Live Trading APIs (uses LocalDataReader on VM)
export async function fetchLiveSummary(configType: string = "fixed"): Promise<LiveSummary> {
  const res = await fetch(`${API_BASE}/api/live/summary?config_type=${configType}`);
  if (!res.ok) throw new Error("Failed to fetch live summary");
  return res.json();
}

export async function fetchOpenPositions(configType: string = "fixed"): Promise<{ positions: Position[] }> {
  const res = await fetch(`${API_BASE}/api/live/positions?config_type=${configType}`);
  if (!res.ok) throw new Error("Failed to fetch open positions");
  return res.json();
}

export async function fetchClosedPositions(configType: string = "fixed"): Promise<{ positions: ClosedPosition[] }> {
  const res = await fetch(`${API_BASE}/api/live/closed?config_type=${configType}`);
  if (!res.ok) throw new Error("Failed to fetch closed positions");
  return res.json();
}

export async function fetchLiveConfigTypes(): Promise<{ config_types: string[] }> {
  const res = await fetch(`${API_BASE}/api/live/config-types`);
  if (!res.ok) throw new Error("Failed to fetch config types");
  return res.json();
}

// Historical APIs (uses OCIDataReader)
export async function fetchConfigTypes(): Promise<{ config_types: string[] }> {
  const res = await fetch(`${API_BASE}/api/config-types`);
  if (!res.ok) throw new Error("Failed to fetch config types");
  return res.json();
}

export async function fetchRuns(configType: string, limit: number = 50): Promise<{ runs: Run[] }> {
  const res = await fetch(`${API_BASE}/api/runs/${configType}?limit=${limit}`);
  if (!res.ok) throw new Error("Failed to fetch runs");
  return res.json();
}

export async function fetchRunSummary(configType: string, runId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/api/runs/${configType}/${runId}/summary`);
  if (!res.ok) throw new Error("Failed to fetch run summary");
  return res.json();
}

export async function fetchRunAnalytics(configType: string, runId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/api/runs/${configType}/${runId}/analytics`);
  if (!res.ok) throw new Error("Failed to fetch analytics");
  return res.json();
}

export async function fetchRunTrades(configType: string, runId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/api/runs/${configType}/${runId}/trades`);
  if (!res.ok) throw new Error("Failed to fetch trades");
  return res.json();
}

// Aggregate data across all runs
export interface DailyData {
  date: string;
  run_id: string;
  pnl: number;
  trades: number;
  winners: number;
  losers: number;
  win_rate: number;
  cumulative_pnl: number;
  return_pct?: number;
  cumulative_return_pct?: number;
}

export interface SetupStats {
  setup: string;
  trades: number;
  pnl: number;
  wins: number;
  win_rate: number;
  avg_pnl: number;
}

// Trade data from performance.json (historical aggregate)
export interface HistoricalTrade {
  symbol: string;
  setup: string;
  pnl: number;
  exit_reason: string;
  entry: number;
  exit: number;
  qty?: number;
  date?: string; // exit/settle date (YYYY-MM-DD) — present for swing/overnight/multiday
}

export interface AggregateData {
  config_type: string;
  capital?: number;
  days: number;
  gross_pnl: number;
  net_pnl: number;
  total_pnl: number;
  gross_return_pct?: number;
  net_return_pct?: number;
  avg_daily_return_pct?: number;
  total_trades: number;
  winners: number;
  losers: number;
  win_rate: number;
  total_fees: number;
  avg_pnl_per_day: number;
  avg_pnl_per_trade: number;
  by_setup: SetupStats[];
  daily_data: DailyData[];
  trades: HistoricalTrade[];
  date_from?: string;
  date_to?: string;
}

export async function fetchAggregate(
  configType: string,
  dateFrom?: string,
  dateTo?: string
): Promise<AggregateData> {
  let url = `${API_BASE}/api/runs/${configType}/aggregate`;
  const params = new URLSearchParams();
  if (dateFrom) params.append("date_from", dateFrom);
  if (dateTo) params.append("date_to", dateTo);
  if (params.toString()) url += `?${params.toString()}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch aggregate data");
  return res.json();
}

// Swing / delivery family (close_dn_overnight_long + the multi-day capitulation
// batch). Pooled per-setup PnL ledgers in the same AggregateData shape as intraday.
export const SWING_SETUPS = [
  "close_dn_overnight_long",
  "mtf_capitulation_revert_long",
  "low52_capitulation_revert_long",
  "zscore_oversold_revert_long",
  "crash2d_revert_long",
] as const;

export async function fetchSwingAggregate(
  setup: string = "all",
  dateFrom?: string,
  dateTo?: string
): Promise<AggregateData> {
  const params = new URLSearchParams();
  params.append("setup", setup);
  if (dateFrom) params.append("date_from", dateFrom);
  if (dateTo) params.append("date_to", dateTo);
  const res = await fetch(`${API_BASE}/api/swing/aggregate?${params.toString()}`);
  if (!res.ok) throw new Error("Failed to fetch swing aggregate data");
  return res.json();
}

// The live multi-day book: open (held, marked-to-market) + pending entries.
export interface MultidayOpenPosition {
  setup: string;
  symbol: string;
  qty: number;
  product: string | null;
  leverage: number | null;
  entry_price: number;
  capital: number; // actual money deployed (value / leverage), not leveraged notional
  current_price: number | null;
  live_pnl: number | null;
  live_pnl_pct: number | null;
  entry_date: string | null;
  exit_on_date: string | null;
  signal_date: string | null;
}

export interface MultidayPendingPosition {
  setup: string;
  symbol: string;
  qty: number;
  product: string | null;
  leverage: number | null;
  ref_price: number;
  capital: number; // actual money deployed (value / leverage)
  fills_on: string | null;
  exit_on_date: string | null;
  signal_date: string | null;
}

export interface MultidayBook {
  open: MultidayOpenPosition[];
  pending: MultidayPendingPosition[];
  summary: {
    open_count: number;
    pending_count: number;
    open_capital: number;
    pending_capital: number;
    total_live_pnl: number | null;
    by_setup: { setup: string; open: number; pending: number; capital: number }[];
  };
  as_of: string | null;
}

export async function fetchMultidayBook(): Promise<MultidayBook> {
  const res = await fetch(`${API_BASE}/api/multiday/book`);
  if (!res.ok) throw new Error("Failed to fetch multiday book");
  return res.json();
}

// ============ Instance APIs (real-time from engine health servers) ============

export interface Instance {
  name: string;
  port: number;
  type: "paper" | "live";
  description: string;
  status: "ok" | "unhealthy" | "offline" | "unknown";
  state?: string;
}

export interface InstanceStatus {
  status: string;
  state: string;
  uptime_seconds: number;
  positions_count: number;
  unrealized_pnl: number;
  booked_pnl?: number;  // T1 partial profits from open positions
  capital: {
    available: number;
    margin_used: number;
    total: number;
    positions: number;
    mis_enabled: boolean;
  };
  metrics: {
    trades_entered: number;
    trades_exited: number;
    errors: number;
    admin_actions: number;
  };
  auth_enabled: boolean;  // True when engine started with --admin-token flag
  timestamp: string;
}

export interface InstancePosition {
  symbol: string;
  side: string;
  qty: number;
  entry: number;
  ltp?: number;
  pnl?: number;
  sl?: number;
  t1?: number;
  t2?: number;
  t1_done?: boolean;
  eod_partial_done?: boolean;
  manual_partial_done?: boolean;
  exit_options?: string[];  // ["partial", "full"] or ["full"] after T1 taken
  booked_pnl?: number;      // PnL from partial exits (T1, EOD, manual)
  entry_time?: string;      // Entry timestamp
  t1_exit_time?: string;    // T1 exit timestamp
}

export async function fetchInstances(): Promise<{ instances: Instance[] }> {
  const res = await fetch(`${API_BASE}/api/instances`);
  if (!res.ok) throw new Error("Failed to fetch instances");
  return res.json();
}

export async function fetchInstanceStatus(instance: string): Promise<InstanceStatus> {
  const res = await fetch(`${API_BASE}/api/instances/${instance}/status`);
  if (!res.ok) throw new Error(`Failed to fetch status for ${instance}`);
  return res.json();
}

export async function fetchInstancePositions(instance: string): Promise<{ positions: InstancePosition[]; count: number; unrealized_pnl: number }> {
  const res = await fetch(`${API_BASE}/api/instances/${instance}/positions`);
  if (!res.ok) throw new Error(`Failed to fetch positions for ${instance}`);
  return res.json();
}

export interface BrokerFunds {
  available_cash: number;
  available_margin: number;
  used_margin: number;
  net: number;
  error?: string;
}

export async function fetchInstanceFunds(instance: string): Promise<{ status: string; funds: BrokerFunds | null; error?: string }> {
  const res = await fetch(`${API_BASE}/api/instances/${instance}/funds`);
  if (!res.ok) throw new Error(`Failed to fetch funds for ${instance}`);
  return res.json();
}

export interface ClosedTrade {
  symbol: string;
  side: string;
  qty: number;
  entry_price: number;
  exit_price: number;
  pnl: number;
  exit_reason: string;
  setup: string;
  exit_time?: string;
  entry_time?: string;
}

export interface ClosedTradesResponse {
  trades: ClosedTrade[];
  count: number;
  total_pnl: number;
  winners: number;
  losers: number;
  win_rate: number;
}

export async function fetchInstanceClosedTrades(instance: string): Promise<ClosedTradesResponse> {
  const res = await fetch(`${API_BASE}/api/instances/${instance}/closed`);
  if (!res.ok) throw new Error(`Failed to fetch closed trades for ${instance}`);
  return res.json();
}

// ============ Admin APIs (require X-Admin-Token header) ============

// Custom error class to identify auth failures
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

async function adminRequest(instance: string, endpoint: string, body: object, token: string): Promise<any> {
  const res = await fetch(`${API_BASE}/api/instances/${instance}/admin/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Token": token,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (data.error) {
    if (data.error.toLowerCase().includes("unauthorized")) {
      throw new AuthError("Invalid or expired admin token");
    }
    throw new Error(data.error);
  }

  return data;
}

export async function adminSetCapital(instance: string, capital: number, token: string): Promise<any> {
  return adminRequest(instance, "capital", { capital }, token);
}

export async function adminToggleMIS(instance: string, enabled: boolean, token: string): Promise<any> {
  return adminRequest(instance, "mis", { enabled }, token);
}

export async function adminExitPosition(instance: string, symbol: string, qty: number | null, token: string): Promise<any> {
  const body: any = { symbol };
  if (qty !== null) body.qty = qty;
  return adminRequest(instance, "exit", body, token);
}

export async function adminExitAll(instance: string, reason: string, token: string): Promise<any> {
  return adminRequest(instance, "exit-all", { reason }, token);
}

export async function adminPause(instance: string, reason: string, token: string): Promise<any> {
  return adminRequest(instance, "pause", { reason }, token);
}

export async function adminResume(instance: string, token: string): Promise<any> {
  return adminRequest(instance, "resume", {}, token);
}

// ============ Overnight Setup APIs (close_dn_overnight_long) ============
// These read VM-local JSON files via overnight_reader.py on the backend.
// No HTTP server on the engine side -- the setup is cron-driven.

export interface OvernightSlot {
  slot_id: number;
  status: "t0_open" | "t1_settling" | "free";
  symbol: string | null;
  buy_fill_price: number | null;
  sell_fill_price: number | null;
  product: "CNC" | "MTF" | null;
  qty?: number;
  margin_inr: number | null;
  notional_inr: number | null;
  fees_inr: number | null;
  interest_inr: number | null;
  realized_pnl_inr: number | null;
  reserved_today: string | null;
  expected_exit_date: string | null;
}

export interface OvernightPool {
  max_slots: number;
  free_count: number;
  t0_open_count: number;
  t1_settling_count: number;
  new_today_count: number;
  active_slots: OvernightSlot[];
  stale_slots: OvernightSlot[];
  loaded_from: string;
  loaded_at: string | null;
}

export interface OvernightLedgerEntry {
  net_pnl_inr: number;
  ts_iso: string;
}

export interface OvernightLedger {
  setup_name: string;
  book?: string; // "paper" | "live" — which tripwire ledger this came from
  window_trades: number | null;
  pf_floor: number | null;
  trades: OvernightLedgerEntry[];
  first_below_floor_ts: string | null;
  paused_since: string | null;
  loaded_from: string | null;
  loaded_at: string | null;
}

export interface OvernightDailyRow {
  date: string;
  fires: number;
  net_pnl: number;
  wr_pct: number;
}

export interface OvernightSummary {
  setup_name: string;
  book?: string; // "paper" | "live" — which tripwire ledger this came from
  total_trades: number;
  cumulative_pnl: number;
  wins: number;
  losses: number;
  win_rate_pct: number;
  current_open_positions: number;
  max_slots: number;
  stale_slot_count: number;
  daily_breakdown: OvernightDailyRow[];
}

export interface OvernightCandidate {
  symbol: string;
  prior_close: number;
  prev_prior_close: number;
  prior_day_return_pct: number;
}

export interface OvernightCandidates {
  session_date: string | null;
  cell_min_prior_ret_pct: number | null;
  computed_at: string | null;
  n_candidates: number;
  candidates: OvernightCandidate[];
  loaded_from: string | null;
  loaded_at: string | null;
}

export interface OvernightCronStatus {
  log_path: string | null;
  exists: boolean;
  mtime_iso: string | null;
  tail: string | null;
}

export interface OvernightCronHealth {
  today: string;
  verify_exit: OvernightCronStatus;
  entry: OvernightCronStatus;
}

export async function fetchOvernightPool(): Promise<OvernightPool> {
  const res = await fetch(`${API_BASE}/api/overnight/pool`);
  if (!res.ok) throw new Error("Failed to fetch overnight pool");
  return res.json();
}

export async function fetchOvernightLedger(limit?: number, book: "live" | "paper" = "paper"): Promise<OvernightLedger> {
  const url = limit
    ? `${API_BASE}/api/overnight/ledger?limit=${limit}&book=${book}`
    : `${API_BASE}/api/overnight/ledger?book=${book}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch overnight ledger");
  return res.json();
}

export async function fetchOvernightSummary(book: "live" | "paper" = "paper"): Promise<OvernightSummary> {
  const res = await fetch(`${API_BASE}/api/overnight/summary?book=${book}`);
  if (!res.ok) throw new Error("Failed to fetch overnight summary");
  return res.json();
}

export async function fetchOvernightCandidates(sessionDate?: string): Promise<OvernightCandidates> {
  const url = sessionDate
    ? `${API_BASE}/api/overnight/candidates?session_date=${sessionDate}`
    : `${API_BASE}/api/overnight/candidates`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch overnight candidates");
  return res.json();
}

export async function fetchOvernightCronHealth(): Promise<OvernightCronHealth> {
  const res = await fetch(`${API_BASE}/api/overnight/cron-health`);
  if (!res.ok) throw new Error("Failed to fetch cron health");
  return res.json();
}

// Historical (OCI archive) variants. Same response shapes as the live
// variants -- the page picks based on selected date.

export async function fetchOvernightHistoryDates(): Promise<{ dates: string[] }> {
  const res = await fetch(`${API_BASE}/api/overnight/history/dates`);
  if (!res.ok) throw new Error("Failed to fetch archived dates");
  return res.json();
}

export async function fetchOvernightHistoryPool(date: string): Promise<OvernightPool> {
  const res = await fetch(`${API_BASE}/api/overnight/history/${date}/pool`);
  if (!res.ok) throw new Error("Failed to fetch archived pool");
  return res.json();
}

export async function fetchOvernightHistoryLedger(date: string, limit?: number): Promise<OvernightLedger> {
  const url = limit
    ? `${API_BASE}/api/overnight/history/${date}/ledger?limit=${limit}`
    : `${API_BASE}/api/overnight/history/${date}/ledger`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch archived ledger");
  return res.json();
}

export async function fetchOvernightHistorySummary(date: string): Promise<OvernightSummary> {
  const res = await fetch(`${API_BASE}/api/overnight/history/${date}/summary`);
  if (!res.ok) throw new Error("Failed to fetch archived summary");
  return res.json();
}

export async function fetchOvernightHistoryCandidates(date: string): Promise<OvernightCandidates> {
  const res = await fetch(`${API_BASE}/api/overnight/history/${date}/candidates`);
  if (!res.ok) throw new Error("Failed to fetch archived candidates");
  return res.json();
}
