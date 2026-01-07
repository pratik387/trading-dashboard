"use client";

import { useState, useEffect } from "react";
import { MetricCard } from "@/components/MetricCard";
import { OpenPositionsTable, ClosedPositionsTable } from "@/components/PositionsTable";
import { formatINR, formatPct } from "@/lib/utils";
import { useConfig } from "@/lib/ConfigContext";
import { LiveSummary, ClosedPosition, fetchLiveSummary, fetchClosedPositions } from "@/lib/api";
import { RefreshCw, Circle } from "lucide-react";

export default function LiveTradingPage() {
  const { configType } = useConfig();
  const [summary, setSummary] = useState<LiveSummary | null>(null);
  const [closedPositions, setClosedPositions] = useState<ClosedPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  const loadData = async () => {
    try {
      setLoading(true);
      const [summaryData, closedData] = await Promise.all([
        fetchLiveSummary(configType),
        fetchClosedPositions(configType),
      ]);
      setSummary(summaryData);
      setClosedPositions(closedData.positions || []);
      setLastUpdated(new Date().toLocaleTimeString());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [configType]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(loadData, 15000);
    return () => clearInterval(interval);
  }, [autoRefresh, configType]);

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500 mb-4">{error}</p>
        <button
          onClick={loadData}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Retry
        </button>
      </div>
    );
  }

  const MIS_LEVERAGE = 5;
  const notionalValue = summary?.capital_in_positions || 0;
  const marginUsed = notionalValue / MIS_LEVERAGE;
  const initialCapital = summary?.initial_capital || 0;
  const availableCapital = initialCapital - marginUsed;
  const utilizationPct = initialCapital > 0 ? (marginUsed / initialCapital) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Circle className="w-3 h-3 fill-red-500 text-red-500 animate-pulse" />
            Live Trading
          </h1>
          {summary?.run_id && (
            <p className="text-sm text-gray-500 mt-1">
              Session: {summary.run_id}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            Auto-refresh
          </label>

          <button
            onClick={loadData}
            disabled={loading}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {loading && !summary ? (
        <div className="text-center py-12">Loading...</div>
      ) : summary ? (
        <>
          {/* PnL Summary */}
          <section>
            <h2 className="text-lg font-semibold mb-3">💰 PnL Summary</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard
                label="Total PnL"
                value={formatINR(summary.total_pnl)}
                delta={summary.total_pnl >= 0 ? "up" : "down"}
                help="Realized + Unrealized PnL"
              />
              <MetricCard
                label="Realized"
                value={formatINR(summary.realized_pnl)}
                help="Booked profit/loss from closed positions"
              />
              <MetricCard
                label="Unrealized"
                value={formatINR(summary.unrealized_pnl)}
                help="Paper profit/loss from open positions"
              />
              <MetricCard
                label="Open Positions"
                value={summary.open_position_count}
              />
            </div>
          </section>

          {/* Trade Stats */}
          <section>
            <h2 className="text-lg font-semibold mb-3">📊 Trade Stats</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard label="Closed Trades" value={summary.closed_trades} />
              <MetricCard label="Winners" value={summary.winners} />
              <MetricCard label="Losers" value={summary.losers} />
              <MetricCard label="Win Rate" value={formatPct(summary.win_rate).replace("+", "")} />
            </div>
          </section>

          {/* Capital Usage */}
          <section>
            <h2 className="text-lg font-semibold mb-3">💵 Capital Usage (MIS 5x)</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard label="Initial Capital" value={formatINR(initialCapital)} />
              <MetricCard
                label="Margin Used"
                value={formatINR(marginUsed)}
                help={`Notional: ${formatINR(notionalValue)}`}
              />
              <MetricCard label="Available" value={formatINR(availableCapital)} />
              <MetricCard label="Utilization" value={`${utilizationPct.toFixed(1)}%`} />
            </div>
          </section>

          {/* Open Positions */}
          <section>
            <h2 className="text-lg font-semibold mb-3">
              📈 Open Positions ({summary.open_position_count})
            </h2>
            <div className="bg-white dark:bg-gray-800 rounded-lg border shadow-sm">
              <OpenPositionsTable positions={summary.open_positions} />
            </div>
          </section>

          {/* Closed Positions */}
          <section>
            <h2 className="text-lg font-semibold mb-3">
              ✅ Closed Positions ({closedPositions.length})
            </h2>
            <div className="bg-white dark:bg-gray-800 rounded-lg border shadow-sm">
              <ClosedPositionsTable positions={closedPositions} />
            </div>
          </section>

          {/* Last Updated */}
          <p className="text-sm text-gray-500 text-center">
            Last updated: {lastUpdated}
          </p>
        </>
      ) : null}
    </div>
  );
}
