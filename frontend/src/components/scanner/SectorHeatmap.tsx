"use client";

import { cn } from "@/lib/utils";
import type { SectorPerf } from "@/lib/scanner-api";

interface SectorHeatmapProps {
  sectors: SectorPerf[];
}

function getHeatColor(changePct: number): string {
  if (changePct <= -2) return "bg-red-700 text-white";
  if (changePct <= -1) return "bg-red-500 text-white";
  if (changePct <= -0.3) return "bg-red-300 text-red-900 dark:bg-red-800 dark:text-red-200";
  if (changePct >= 2) return "bg-green-700 text-white";
  if (changePct >= 1) return "bg-green-500 text-white";
  if (changePct >= 0.3) return "bg-green-300 text-green-900 dark:bg-green-800 dark:text-green-200";
  return "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300";
}

export function SectorHeatmap({ sectors }: SectorHeatmapProps) {
  if (!sectors || sectors.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg border shadow-sm p-4">
        <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">Sector Heatmap</h3>
        <div className="text-sm text-gray-400">No sector data available</div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border shadow-sm p-4">
      <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">Sector Heatmap</h3>
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
        {sectors.map((sector) => (
          <div
            key={sector.sector}
            className={cn(
              "rounded-lg p-3 text-center transition-all hover:scale-105 cursor-default",
              getHeatColor(sector.change_pct)
            )}
          >
            <div className="font-semibold text-sm truncate">{sector.sector}</div>
            <div className="text-lg font-bold">
              {sector.change_pct >= 0 ? "+" : ""}
              {sector.change_pct.toFixed(1)}%
            </div>
            {sector.top_setup && (
              <div className="text-xs mt-1 opacity-80 truncate">{sector.top_setup}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
