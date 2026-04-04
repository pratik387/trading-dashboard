"use client";

import { Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ScannerSnapshot } from "@/lib/scanner-api";

interface MarketPulseProps {
  snapshot: ScannerSnapshot | null;
  connected: boolean;
  lastUpdate: Date | null;
}

const REGIME_COLORS: Record<string, string> = {
  trend: "bg-green-500",
  squeeze: "bg-yellow-500",
  chop: "bg-red-500",
  unknown: "bg-gray-400",
};

const REGIME_LABELS: Record<string, string> = {
  trend: "Trending",
  squeeze: "Squeeze",
  chop: "Choppy",
  unknown: "\u2014",
};

function formatTimeSince(date: Date | null): string {
  if (!date) return "\u2014";
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export function MarketPulse({ snapshot, connected, lastUpdate }: MarketPulseProps) {
  const regime = snapshot?.regime?.label || "unknown";
  const index = snapshot?.index;
  const stats = snapshot?.stats;
  const marketOpen = snapshot?.market_open ?? false;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border shadow-sm p-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <div>
            <span className="text-sm text-gray-500 dark:text-gray-400">Nifty 50</span>
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold">
                {index?.ltp ? index.ltp.toLocaleString("en-IN") : "\u2014"}
              </span>
              {index?.change_pct != null && (
                <span
                  className={cn(
                    "text-sm font-medium px-1.5 py-0.5 rounded",
                    index.change_pct >= 0
                      ? "text-green-700 bg-green-100 dark:text-green-400 dark:bg-green-900/30"
                      : "text-red-700 bg-red-100 dark:text-red-400 dark:bg-red-900/30"
                  )}
                >
                  {index.change_pct >= 0 ? "+" : ""}
                  {index.change_pct.toFixed(2)}%
                </span>
              )}
            </div>
          </div>
          <div className="h-10 w-px bg-gray-200 dark:bg-gray-700" />
          <div>
            <span className="text-sm text-gray-500 dark:text-gray-400">Regime</span>
            <div className="flex items-center gap-2">
              <span className={cn("w-2.5 h-2.5 rounded-full", REGIME_COLORS[regime] || REGIME_COLORS.unknown)} />
              <span className="text-sm font-medium">{REGIME_LABELS[regime] || regime}</span>
            </div>
          </div>
          <div className="h-10 w-px bg-gray-200 dark:bg-gray-700 hidden sm:block" />
          <div className="hidden sm:block">
            <span className="text-sm text-gray-500 dark:text-gray-400">Scanned</span>
            <div className="text-sm font-medium">{stats?.scanned?.toLocaleString() || "\u2014"} stocks</div>
          </div>
          <div className="hidden sm:block">
            <span className="text-sm text-gray-500 dark:text-gray-400">Active Setups</span>
            <div className="text-sm font-medium">{stats?.active_setups ?? "\u2014"}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!marketOpen && snapshot && (
            <span className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-2 py-1 rounded-full">
              Market Closed
            </span>
          )}
          <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            {connected ? (
              <Wifi className="w-3.5 h-3.5 text-green-500" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-red-400" />
            )}
            <span>Updated {formatTimeSince(lastUpdate)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
