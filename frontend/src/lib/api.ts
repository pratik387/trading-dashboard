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

export interface Position {
  trade_id: string;
  symbol: string;
  entry_price: number;
  current_price?: number;
  qty: number;
  remaining_qty?: number;
  side: string;
  setup: string;
  entry_time: string;
  unrealized_pnl?: number;
  price_change_pct?: number;
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
