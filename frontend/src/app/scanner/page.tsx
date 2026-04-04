"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchScannerSnapshot, fetchScannerStats } from "@/lib/scanner-api";
import { useScannerWebSocket } from "@/lib/useScannerWebSocket";
import { MarketPulse } from "@/components/scanner/MarketPulse";
import { SectorHeatmap } from "@/components/scanner/SectorHeatmap";
import { SetupsTable } from "@/components/scanner/SetupsTable";
import { EnergyLeaderboard } from "@/components/scanner/EnergyLeaderboard";
import type { ScannerSnapshot, SetupStats } from "@/lib/scanner-api";

const SCANNER_INSTANCE = process.env.NEXT_PUBLIC_SCANNER_INSTANCE || "fixed";

const WS_PORT_MAP: Record<string, number> = {
  fixed: 8091,
  relative: 8092,
  live: 8094,
};

function getWsUrl(): string {
  const hostname = typeof window !== "undefined" ? window.location.hostname : "localhost";
  const port = WS_PORT_MAP[SCANNER_INSTANCE] || 8091;
  return `ws://${hostname}:${port}`;
}

export default function ScannerPage() {
  const [wsUrl, setWsUrl] = useState<string | null>(null);

  useEffect(() => {
    setWsUrl(getWsUrl());
  }, []);

  const { data: initialSnapshot } = useQuery({
    queryKey: ["scanner-snapshot", SCANNER_INSTANCE],
    queryFn: () => fetchScannerSnapshot(SCANNER_INSTANCE),
    refetchInterval: 60000,
    retry: 2,
  });

  const { data: stats } = useQuery({
    queryKey: ["scanner-stats", SCANNER_INSTANCE],
    queryFn: () => fetchScannerStats(SCANNER_INSTANCE),
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1,
  });

  const { snapshot: wsSnapshot, connected, lastUpdate } = useScannerWebSocket({
    wsUrl,
    enabled: true,
  });

  const snapshot: ScannerSnapshot | null = wsSnapshot || (initialSnapshot as ScannerSnapshot) || null;
  const safeStats: SetupStats = (stats as SetupStats) || {};

  return (
    <div className="space-y-4 py-4">
      <MarketPulse snapshot={snapshot} connected={connected} lastUpdate={lastUpdate} />
      <SectorHeatmap sectors={snapshot?.sector_performance || []} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SetupsTable
          setups={snapshot?.setups || []}
          stats={safeStats}
          timestamp={snapshot?.timestamp || null}
        />
        <EnergyLeaderboard
          stocks={snapshot?.energy_leaderboard || []}
          setups={snapshot?.setups || []}
          stats={safeStats}
        />
      </div>
    </div>
  );
}
