"use client";

import { cn } from "@/lib/utils";
import type { EnergyStock, SetupDetection, SetupStats } from "@/lib/scanner-api";

interface EnergyLeaderboardProps {
  stocks: EnergyStock[];
  setups: SetupDetection[];
  stats: SetupStats;
}

function formatVolZ(volZ: number): string {
  const mult = Math.max(1, 1 + volZ);
  return mult.toFixed(1) + "x";
}

function formatSetupName(setupType: string): string {
  return setupType
    .replace(/_long$|_short$/, "")
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function EnergyLeaderboard({ stocks, setups, stats }: EnergyLeaderboardProps) {
  const setupMap = new Map<string, SetupDetection>();
  for (const s of setups) {
    if (!setupMap.has(s.symbol)) setupMap.set(s.symbol, s);
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border shadow-sm">
      <div className="p-4 border-b dark:border-gray-700">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold">Energy Leaderboard</h3>
          <span className="text-sm text-gray-500 dark:text-gray-400">(Top 15)</span>
        </div>
      </div>

      {stocks.length === 0 ? (
        <div className="p-8 text-center text-sm text-gray-400">No energy data available</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                <th className="px-4 py-2 font-medium w-8">#</th>
                <th className="px-4 py-2 font-medium">Symbol</th>
                <th className="px-4 py-2 font-medium text-right">Energy</th>
                <th className="px-4 py-2 font-medium">Setup</th>
                <th className="px-4 py-2 font-medium text-right">LTP</th>
                <th className="px-4 py-2 font-medium text-right">Chg%</th>
                <th className="px-4 py-2 font-medium text-right hidden sm:table-cell">VolX</th>
              </tr>
            </thead>
            <tbody>
              {stocks.map((stock, i) => {
                const setup = setupMap.get(stock.symbol);
                const setupName = setup ? formatSetupName(setup.setup_type) : null;
                const stat = setup ? stats?.[setup.setup_type] : null;

                return (
                  <tr
                    key={stock.symbol}
                    className="border-b dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
                  >
                    <td className="px-4 py-2.5 text-gray-400 font-mono text-xs">{i + 1}</td>
                    <td className="px-4 py-2.5 font-medium">{stock.symbol.replace(".NS", "")}</td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <div className="w-16 bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                          <div
                            className="bg-blue-500 h-1.5 rounded-full"
                            style={{
                              width: `${Math.min(100, (stock.energy / (stocks[0]?.energy || 1)) * 100)}%`,
                            }}
                          />
                        </div>
                        <span className="text-xs font-mono w-10 text-right">
                          {stock.energy.toFixed(0)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      {setup ? (
                        <div className="flex items-center gap-1 group relative">
                          <span
                            className={cn(
                              "text-xs font-bold",
                              setup.direction === "long" ? "text-green-600" : "text-red-500"
                            )}
                          >
                            {setup.direction === "long" ? "\u25B2" : "\u25BC"}
                          </span>
                          <span className="text-xs">{setupName}</span>
                          {stat && (
                            <div className="absolute bottom-full left-0 mb-1 hidden group-hover:block z-10">
                              <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg whitespace-nowrap">
                                <div className="font-semibold mb-1">{setupName}</div>
                                <div>{stat.win_rate.toFixed(0)}% win | {stat.avg_r.toFixed(1)} avg R | {stat.count} trades ({stat.period})</div>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">{"\u2014"}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">
                      {stock.close.toLocaleString("en-IN")}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-2.5 text-right font-mono text-xs font-medium",
                        stock.change_pct >= 0 ? "text-green-600" : "text-red-500"
                      )}
                    >
                      {stock.change_pct >= 0 ? "+" : ""}
                      {stock.change_pct.toFixed(2)}%
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs hidden sm:table-cell">
                      {formatVolZ(stock.vol_z)}
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
