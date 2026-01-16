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
}

export interface AggregateData {
  config_type: string;
  days: number;
  gross_pnl: number;
  net_pnl: number;
  total_pnl: number;
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
  exit_options?: string[];  // ["partial", "full"] or ["full"] after T1 taken
  booked_pnl?: number;      // PnL from partial exits (T1)
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
  if (!res.ok) {
    // 401 = invalid/stale token - throw AuthError so UI can clear the token
    if (res.status === 401) {
      throw new AuthError("Invalid or expired admin token");
    }
    throw new Error(data.detail || data.error || `Admin request failed: ${res.status}`);
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
