const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ============ Types ============

export interface ScannerSnapshot {
  timestamp: string;
  market_open: boolean;
  regime: {
    label: string;
    confidence: number;
  };
  index: {
    ltp: number | null;
    prev_close: number | null;
    change_pct: number | null;
  };
  stats: {
    scanned: number;
    active_setups: number;
  };
  energy_leaderboard: EnergyStock[];
  setups: SetupDetection[];
  sector_performance: SectorPerf[];
}

export interface EnergyStock {
  symbol: string;
  energy: number;
  score_long: number;
  score_short: number;
  close: number;
  change_pct: number;
  vol_z: number;
  sector: string;
}

export interface SetupDetection {
  symbol: string;
  setup_type: string;
  direction: "long" | "short";
  strength: number;
  reasons: string[];
  sector: string;
}

export interface SectorPerf {
  sector: string;
  change_pct: number;
  avg_vol_z: number;
  stock_count: number;
  top_setup: string | null;
}

export interface SetupStats {
  [setupType: string]: {
    win_rate: number;
    avg_r: number;
    count: number;
    period: string;
  };
}

// ============ API Functions ============

export async function fetchScannerSnapshot(instance: string): Promise<ScannerSnapshot> {
  const res = await fetch(`${API_BASE}/api/instances/${instance}/scanner`);
  if (!res.ok) throw new Error("Failed to fetch scanner snapshot");
  return res.json();
}

export async function fetchScannerStats(instance: string): Promise<SetupStats> {
  const res = await fetch(`${API_BASE}/api/instances/${instance}/scanner/stats`);
  if (!res.ok) throw new Error("Failed to fetch scanner stats");
  return res.json();
}
