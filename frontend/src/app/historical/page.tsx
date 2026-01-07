"use client";

import { useState, useEffect } from "react";
import { MetricCard } from "@/components/MetricCard";
import { ClosedPositionsTable } from "@/components/PositionsTable";
import { formatINR, formatPct } from "@/lib/utils";
import {
  Run,
  ClosedPosition,
  fetchConfigTypes,
  fetchRuns,
  fetchRunSummary,
  fetchRunTrades,
} from "@/lib/api";
import { History, RefreshCw, ChevronDown } from "lucide-react";

interface RunSummary {
  total_pnl: number;
  gross_pnl: number;
  net_pnl: number;
  total_fees: number;
  total_trades: number;
  winners: number;
  losers: number;
  win_rate: number;
  by_setup?: Record<string, { count: number; pnl: number; wins: number }>;
  by_regime?: Record<string, { count: number; pnl: number }>;
}

export default function HistoricalPage() {
  const [configType, setConfigType] = useState("fixed");
  const [configTypes, setConfigTypes] = useState<string[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRun, setSelectedRun] = useState<string>("");
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [trades, setTrades] = useState<ClosedPosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load config types on mount
  useEffect(() => {
    fetchConfigTypes()
      .then((data) => setConfigTypes(data.config_types || []))
      .catch(console.error);
  }, []);

  // Load runs when config type changes
  useEffect(() => {
    setLoading(true);
    fetchRuns(configType)
      .then((data) => {
        const runList = data.runs || [];
        setRuns(runList);
        if (runList.length > 0) {
          setSelectedRun(runList[0].run_id);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [configType]);

  // Load run details when selected run changes
  useEffect(() => {
    if (!selectedRun) return;

    setLoading(true);
    Promise.all([
      fetchRunSummary(configType, selectedRun),
      fetchRunTrades(configType, selectedRun),
    ])
      .then(([summaryData, tradesData]) => {
        setSummary(summaryData);
        // Transform trades to match ClosedPosition format
        const tradeList = (tradesData.trades || []).map((t: any) => ({
          trade_id: t.trade_id || "",
          symbol: t.symbol || "",
          entry_price: t.entry_price || 0,
          exit_price: t.exit_price || 0,
          qty: t.qty || t.total_qty || 0,
          side: t.side || "long",
          setup: t.setup || "",
          entry_time: t.entry_time || "",
          exit_time: t.exit_time || "",
          exit_reason: t.exit_reason || "",
          pnl: t.pnl || t.total_trade_pnl || 0,
        }));
        setTrades(tradeList);
        setError(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [selectedRun, configType]);

  // Calculate setup stats for display
  const setupStats = summary?.by_setup
    ? Object.entries(summary.by_setup)
        .map(([setup, data]) => ({
          setup,
          trades: data.count,
          pnl: data.pnl,
          wins: data.wins,
          winRate: data.count > 0 ? (data.wins / data.count) * 100 : 0,
          avgPnl: data.count > 0 ? data.pnl / data.count : 0,
        }))
        .sort((a, b) => b.pnl - a.pnl)
    : [];

  const formatRunLabel = (run: Run) => {
    const date = run.run_id.match(/paper_(\d{8})_/)?.[1];
    if (date) {
      const formatted = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
      return formatted;
    }
    return run.run_id;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <History className="w-6 h-6" />
            Historical Analysis
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {selectedRun ? `Session: ${selectedRun}` : "Select a run to view"}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={configType}
            onChange={(e) => setConfigType(e.target.value)}
            className="text-sm border rounded-lg px-3 py-2 bg-white dark:bg-gray-800"
          >
            <option value="fixed">Fixed (₹1K risk)</option>
            <option value="relative">Relative (1% risk)</option>
            <option value="1year">1 Year</option>
          </select>

          <select
            value={selectedRun}
            onChange={(e) => setSelectedRun(e.target.value)}
            className="text-sm border rounded-lg px-3 py-2 bg-white dark:bg-gray-800 min-w-[140px]"
          >
            {runs.map((run) => (
              <option key={run.run_id} value={run.run_id}>
                {formatRunLabel(run)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="text-center py-6">
          <p className="text-red-500">{error}</p>
        </div>
      )}

      {loading && !summary ? (
        <div className="text-center py-12">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto text-gray-400" />
          <p className="mt-2 text-gray-500">Loading...</p>
        </div>
      ) : summary ? (
        <>
          {/* Overview */}
          <section>
            <h2 className="text-lg font-semibold mb-3">📊 Overview</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <MetricCard
                label="Gross PnL"
                value={formatINR(summary.gross_pnl || summary.total_pnl || 0)}
                delta={(summary.gross_pnl || summary.total_pnl || 0) >= 0 ? "up" : "down"}
                help="Total profit before fees"
              />
              <MetricCard
                label="Net PnL"
                value={formatINR(summary.net_pnl || summary.total_pnl || 0)}
                delta={(summary.net_pnl || summary.total_pnl || 0) >= 0 ? "up" : "down"}
                help="Profit after fees"
              />
              <MetricCard label="Total Trades" value={summary.total_trades || 0} />
              <MetricCard label="Win Rate" value={`${(summary.win_rate || 0).toFixed(1)}%`} />
              <MetricCard label="Winners" value={summary.winners || 0} />
              <MetricCard label="Losers" value={summary.losers || 0} />
            </div>
          </section>

          {/* Secondary Stats */}
          <section>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard
                label="Total Fees"
                value={formatINR(summary.total_fees || 0)}
                help="Brokerage, STT, etc."
              />
              <MetricCard
                label="Avg PnL/Trade"
                value={formatINR(
                  summary.total_trades > 0
                    ? (summary.net_pnl || summary.total_pnl || 0) / summary.total_trades
                    : 0
                )}
              />
              <MetricCard
                label="Avg Winner"
                value={formatINR(
                  summary.winners > 0
                    ? (summary.gross_pnl || summary.total_pnl || 0) / summary.winners
                    : 0
                )}
              />
              <MetricCard
                label="Profit Factor"
                value={
                  summary.losers > 0 && summary.winners > 0
                    ? ((summary.winners / summary.losers) * ((summary.win_rate || 50) / (100 - (summary.win_rate || 50)))).toFixed(2)
                    : "N/A"
                }
              />
            </div>
          </section>

          {/* Setup Performance */}
          {setupStats.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold mb-3">🎯 Setup Performance</h2>
              <div className="bg-white dark:bg-gray-800 rounded-lg border shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-900">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Setup</th>
                      <th className="px-4 py-3 text-right font-medium">Trades</th>
                      <th className="px-4 py-3 text-right font-medium">PnL</th>
                      <th className="px-4 py-3 text-right font-medium">Win Rate</th>
                      <th className="px-4 py-3 text-right font-medium">Avg PnL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {setupStats.map((s) => (
                      <tr key={s.setup} className="hover:bg-gray-50 dark:hover:bg-gray-900">
                        <td className="px-4 py-3 font-medium">{s.setup}</td>
                        <td className="px-4 py-3 text-right">{s.trades}</td>
                        <td
                          className={`px-4 py-3 text-right font-medium ${
                            s.pnl >= 0 ? "text-green-600" : "text-red-600"
                          }`}
                        >
                          {formatINR(s.pnl)}
                        </td>
                        <td className="px-4 py-3 text-right">{s.winRate.toFixed(1)}%</td>
                        <td
                          className={`px-4 py-3 text-right ${
                            s.avgPnl >= 0 ? "text-green-600" : "text-red-600"
                          }`}
                        >
                          {formatINR(s.avgPnl)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Trades */}
          <section>
            <h2 className="text-lg font-semibold mb-3">📋 Trades ({trades.length})</h2>
            <div className="bg-white dark:bg-gray-800 rounded-lg border shadow-sm">
              <ClosedPositionsTable positions={trades} />
            </div>
          </section>
        </>
      ) : (
        <div className="text-center py-12 text-gray-500">
          Select a config type and run to view historical data
        </div>
      )}
    </div>
  );
}
