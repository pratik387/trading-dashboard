"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { SetupDetection, SetupStats } from "@/lib/scanner-api";

interface SetupsTableProps {
  setups: SetupDetection[];
  stats: SetupStats;
  timestamp: string | null;
}

type Filter = "all" | "long" | "short";

function formatSetupName(setupType: string): string {
  return setupType
    .replace(/_long$|_short$/, "")
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function strengthBars(strength: number): string {
  if (strength >= 0.7) return "\u2588\u2588\u2588";
  if (strength >= 0.4) return "\u2588\u2588\u2591";
  return "\u2588\u2591\u2591";
}

export function SetupsTable({ setups, stats, timestamp }: SetupsTableProps) {
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = filter === "all" ? setups : setups.filter((s) => s.direction === filter);
  const sorted = [...filtered].sort((a, b) => b.strength - a.strength);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border shadow-sm">
      <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold">Live Setups</h3>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            ({filtered.length} active)
          </span>
        </div>
        <div className="flex gap-1">
          {(["all", "long", "short"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-md transition-colors",
                filter === f
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                  : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
              )}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="p-8 text-center text-sm text-gray-400">
          No active setups detected
          {timestamp && (
            <div className="text-xs mt-1">Last scan: {new Date(timestamp).toLocaleTimeString()}</div>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                <th className="px-4 py-2 font-medium">Symbol</th>
                <th className="px-4 py-2 font-medium">Setup</th>
                <th className="px-4 py-2 font-medium text-right">Strength</th>
                <th className="px-4 py-2 font-medium hidden sm:table-cell">Sector</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((setup, i) => {
                const setupName = formatSetupName(setup.setup_type);
                const stat = stats?.[setup.setup_type];

                return (
                  <tr
                    key={`${setup.symbol}-${setup.setup_type}-${i}`}
                    className="border-b dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
                  >
                    <td className="px-4 py-2.5 font-medium">{setup.symbol.replace(".NS", "")}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5 group relative">
                        <span
                          className={cn(
                            "text-xs font-bold",
                            setup.direction === "long" ? "text-green-600" : "text-red-500"
                          )}
                        >
                          {setup.direction === "long" ? "\u25B2" : "\u25BC"}
                        </span>
                        <span>{setupName}</span>
                        {stat && (
                          <div className="absolute bottom-full left-0 mb-1 hidden group-hover:block z-10">
                            <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg whitespace-nowrap">
                              <div className="font-semibold mb-1">{setupName}</div>
                              <div>{stat.win_rate.toFixed(0)}% win | {stat.avg_r.toFixed(1)} avg R | {stat.count} trades ({stat.period})</div>
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">
                      <span
                        className={cn(
                          setup.strength >= 0.7
                            ? "text-green-600"
                            : setup.strength >= 0.4
                            ? "text-yellow-600"
                            : "text-gray-500"
                        )}
                      >
                        {strengthBars(setup.strength)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 hidden sm:table-cell text-xs">
                      {setup.sector}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
