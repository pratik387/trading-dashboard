"use client";

import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { MetricCard } from "@/components/MetricCard";
import { Tabs } from "@/components/Tabs";
import { BookChip } from "@/components/BookChip";
import { formatINR } from "@/lib/utils";
import { AggregateData, HistoricalTrade } from "@/lib/api";
import { RefreshCw, TrendingUp, Target, Calendar, BarChart3 } from "lucide-react";

// Dynamic imports with SSR disabled - recharts needs the browser.
const EquityCurveChart = dynamic(
  () => import("@/components/Charts").then((mod) => mod.EquityCurveChart),
  { ssr: false, loading: () => <div className="flex items-center justify-center h-full text-gray-400">Loading chart...</div> }
);

const DailyPnLChart = dynamic(
  () => import("@/components/Charts").then((mod) => mod.DailyPnLChart),
  { ssr: false, loading: () => <div className="flex items-center justify-center h-full text-gray-400">Loading chart...</div> }
);

const SetupPnLChart = dynamic(
  () => import("@/components/Charts").then((mod) => mod.SetupPnLChart),
  { ssr: false, loading: () => <div className="flex items-center justify-center h-full text-gray-400">Loading chart...</div> }
);

const TradeDistributionChart = dynamic(
  () => import("@/components/Charts").then((mod) => mod.TradeDistributionChart),
  { ssr: false, loading: () => <div className="flex items-center justify-center h-full text-gray-400">Loading chart...</div> }
);

const WinRateChart = dynamic(
  () => import("@/components/Charts").then((mod) => mod.WinRateChart),
  { ssr: false, loading: () => <div className="flex items-center justify-center h-full text-gray-400">Loading chart...</div> }
);

const PnLHistogramChart = dynamic(
  () => import("@/components/Charts").then((mod) => mod.PnLHistogramChart),
  { ssr: false, loading: () => <div className="flex items-center justify-center h-full text-gray-400">Loading chart...</div> }
);

export type HistoryFamily = "intraday" | "overnight" | "multiday";
export type HistoryBook = "live" | "paper";

/**
 * Data loader for one family's history. Must be referentially stable
 * (wrap in useCallback in the page) — HistoryView refetches when it changes.
 */
export type HistoryFetcher = (
  dateFrom: string | undefined,
  dateTo: string | undefined,
  book: HistoryBook
) => Promise<AggregateData>;

type SubTab = "overview" | "setups" | "daily" | "trades";

/**
 * Shared history panel: date-range filter, summary metric cards, setup
 * breakdown, daily breakdown, and trades table. Each book page (Intraday /
 * Overnight / Multiday) parameterizes it with its own fetcher.
 *
 * showBookToggle: overnight only — switch between the real-money live
 * ledger and the Rs1L idealized paper mirror.
 */
export function HistoryView({
  family,
  fetcher,
  showBookToggle = false,
  headerExtra,
}: {
  family: HistoryFamily;
  fetcher: HistoryFetcher;
  showBookToggle?: boolean;
  headerExtra?: ReactNode;
}) {
  const [data, setData] = useState<AggregateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SubTab>(
    "overview"  // all families land on Overview; Trades is one click away
  );
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  // Overnight only: real-money live ledger vs Rs1L idealized paper.
  const [book, setBook] = useState<HistoryBook>(showBookToggle ? "live" : "paper");

  const loadData = useCallback(
    async (resetFilters = false) => {
      try {
        setLoading(true);
        const from = resetFilters ? undefined : dateFrom || undefined;
        const to = resetFilters ? undefined : dateTo || undefined;
        const result = await fetcher(from, to, book);
        setData(result);
        setError(null);

        // Set date inputs to actual data range if not filtered
        if (resetFilters || (!dateFrom && !dateTo)) {
          if (result.date_from) setDateFrom(result.date_from);
          if (result.date_to) setDateTo(result.date_to);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fetcher, book, dateFrom, dateTo]
  );

  useEffect(() => {
    loadData(true);
    // Reload from scratch when the data source changes (fetcher identity / book).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher, book]);

  const tabs = [
    { id: "overview" as SubTab, label: "Overview", icon: TrendingUp },
    // Setups tab is only meaningful for multi-setup families (intraday / multiday).
    // Overnight has a single setup, so the breakdown is redundant — hide it.
    ...(family !== "overnight"
      ? [{ id: "setups" as SubTab, label: "Setups", icon: Target }]
      : []),
    { id: "daily" as SubTab, label: "Daily", icon: Calendar },
    { id: "trades" as SubTab, label: "Trades", icon: BarChart3 },
  ];

  return (
    <div className="space-y-6">
      {/* Header: data range + controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <p className="text-sm text-gray-500">
          {data ? (
            <>
              {data.days} trading days
              {data.date_from && data.date_to && (
                <span className="ml-2">
                  ({data.date_from} to {data.date_to})
                </span>
              )}
            </>
          ) : "Loading..."}
        </p>

        <div className="flex items-center gap-3 flex-wrap">
          {showBookToggle && (
            <div className="inline-flex rounded-lg border overflow-hidden text-sm font-medium">
              <button
                onClick={() => setBook("live")}
                className={`px-3 py-2 ${
                  book === "live"
                    ? "bg-green-600 text-white"
                    : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300"
                }`}
              >
                Live (real ₹)
              </button>
              <button
                onClick={() => setBook("paper")}
                className={`px-3 py-2 border-l ${
                  book === "paper"
                    ? "bg-blue-600 text-white"
                    : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300"
                }`}
              >
                Paper (₹1L idealized)
              </button>
            </div>
          )}
          {headerExtra}
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="text-sm border rounded-lg px-3 py-2 bg-white dark:bg-gray-800"
            placeholder="From"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="text-sm border rounded-lg px-3 py-2 bg-white dark:bg-gray-800"
            placeholder="To"
          />
          <button
            onClick={() => loadData()}
            className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Filter
          </button>
          <button
            onClick={() => {
              setDateFrom("");
              setDateTo("");
              loadData(true);
            }}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
            title="Reset filters and reload"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {showBookToggle && (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>Showing</span>
          <BookChip book={book} />
        </div>
      )}

      {/* Sub-tabs */}
      <Tabs tabs={tabs} active={activeTab} onChange={setActiveTab} />

      {error && (
        <div className="text-center py-6">
          <p className="text-red-500">{error}</p>
          <button
            onClick={() => loadData()}
            className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg"
          >
            Retry
          </button>
        </div>
      )}

      {loading && !data ? (
        <div className="text-center py-12">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto text-gray-400" />
          <p className="mt-2 text-gray-500">Loading...</p>
        </div>
      ) : data ? (
        <>
          {activeTab === "overview" && <OverviewTab data={data} />}
          {activeTab === "setups" && <SetupsTab data={data} />}
          {activeTab === "daily" && <DailyTab data={data} />}
          {activeTab === "trades" && <TradesTab data={data} family={family} />}
        </>
      ) : null}
    </div>
  );
}

// ============ Overview Tab ============
function OverviewTab({ data }: { data: AggregateData }) {
  const dailyData = data.daily_data || [];

  return (
    <div className="space-y-6">
      {/* Main Metrics */}
      <section>
        <h2 className="text-lg font-semibold mb-3">
          Summary
          {data.capital && (
            <span className="ml-2 text-sm font-normal text-gray-500">
              (Capital: ₹{(data.capital / 1000).toFixed(0)}K)
            </span>
          )}
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <MetricCard
            label="Gross PnL"
            value={formatINR(data.gross_pnl)}
            subValue={data.gross_return_pct != null ? `${data.gross_return_pct.toFixed(2)}%` : undefined}
            delta={data.gross_pnl >= 0 ? "up" : "down"}
            help="Total profit before fees"
          />
          <MetricCard
            label="Net PnL"
            value={formatINR(data.net_pnl)}
            subValue={data.net_return_pct != null ? `${data.net_return_pct.toFixed(2)}%` : undefined}
            delta={data.net_pnl >= 0 ? "up" : "down"}
            help="Profit after fees"
          />
          <MetricCard label="Total Trades" value={data.total_trades} />
          <MetricCard label="Win Rate" value={`${data.win_rate.toFixed(1)}%`} />
          <MetricCard label="Trading Days" value={data.days} />
          <MetricCard
            label="Avg PnL/Day"
            value={formatINR(data.avg_pnl_per_day)}
            subValue={data.avg_daily_return_pct != null ? `${data.avg_daily_return_pct.toFixed(2)}%` : undefined}
          />
        </div>
      </section>

      {/* Secondary Metrics */}
      <section>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="Winners" value={data.winners} />
          <MetricCard label="Losers" value={data.losers} />
          <MetricCard
            label="Total Fees"
            value={formatINR(data.total_fees)}
            help="Brokerage, STT, etc."
          />
          <MetricCard label="Avg PnL/Trade" value={formatINR(data.avg_pnl_per_trade)} />
        </div>
      </section>

      {/* Equity Curve */}
      {dailyData.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Equity Curve ({dailyData.length} days)</h2>
          <div className="bg-white dark:bg-gray-800 rounded-lg border p-4 h-[300px]">
            <EquityCurveChart data={dailyData} />
          </div>
        </section>
      )}

      {/* Daily PnL Bar Chart */}
      {dailyData.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Daily PnL</h2>
          <div className="bg-white dark:bg-gray-800 rounded-lg border p-4 h-[300px]">
            <DailyPnLChart data={dailyData} />
          </div>
        </section>
      )}
    </div>
  );
}

// ============ Setups Tab ============
function SetupsTab({ data }: { data: AggregateData }) {
  // Retired setups (switched off in the engine config) keep their trades in
  // every aggregate — history must reconcile with the ledger — but sort below
  // active ones and carry a badge so they aren't read as live edge.
  const setups = [...(data.by_setup || [])].sort(
    (a, b) => Number(b.active ?? true) - Number(a.active ?? true)
  );

  if (setups.length === 0) {
    return <div className="text-center py-12 text-gray-500">No setup data available</div>;
  }

  const COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

  return (
    <div className="space-y-6">
      {/* PnL by Setup Chart */}
      <section className="grid md:grid-cols-2 gap-6">
        <div>
          <h3 className="text-md font-semibold mb-3">PnL by Setup</h3>
          <div className="bg-white dark:bg-gray-800 rounded-lg border p-4 h-[300px]">
            <SetupPnLChart data={setups} />
          </div>
        </div>

        <div>
          <h3 className="text-md font-semibold mb-3">Trade Distribution</h3>
          <div className="bg-white dark:bg-gray-800 rounded-lg border p-4 h-[300px]">
            <TradeDistributionChart data={setups} colors={COLORS} />
          </div>
        </div>
      </section>

      {/* Win Rate by Setup */}
      <section>
        <h3 className="text-md font-semibold mb-3">Win Rate by Setup</h3>
        <div className="bg-white dark:bg-gray-800 rounded-lg border p-4 h-[250px]">
          <WinRateChart data={setups} />
        </div>
      </section>

      {/* Setup Table */}
      <section>
        <h3 className="text-md font-semibold mb-3">Setup Performance</h3>
        <div className="bg-white dark:bg-gray-800 rounded-lg border shadow-sm overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Setup</th>
                <th className="px-4 py-3 text-right font-medium">Trades</th>
                <th className="px-4 py-3 text-right font-medium">PnL</th>
                <th className="px-4 py-3 text-right font-medium">Wins</th>
                <th className="px-4 py-3 text-right font-medium">Win Rate</th>
                <th className="px-4 py-3 text-right font-medium">Avg PnL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {setups.map((s) => (
                <tr
                  key={s.setup}
                  className={`hover:bg-gray-50 dark:hover:bg-gray-900 ${
                    s.active === false ? "opacity-60" : ""
                  }`}
                >
                  <td className="px-4 py-3 font-medium">
                    {s.setup}
                    {s.active === false && (
                      <span className="ml-2 align-middle text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                        retired
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">{s.trades}</td>
                  <td
                    className={`px-4 py-3 text-right font-medium ${
                      s.pnl >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {formatINR(s.pnl)}
                  </td>
                  <td className="px-4 py-3 text-right">{s.wins}</td>
                  <td className="px-4 py-3 text-right">{s.win_rate.toFixed(1)}%</td>
                  <td
                    className={`px-4 py-3 text-right ${
                      s.avg_pnl >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {formatINR(s.avg_pnl)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ============ Daily Tab ============
function DailyTab({ data }: { data: AggregateData }) {
  const dailyData = [...(data.daily_data || [])].reverse(); // Most recent first

  if (dailyData.length === 0) {
    return <div className="text-center py-12 text-gray-500">No daily data available</div>;
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold mb-3">Daily Breakdown</h2>
        <div className="bg-white dark:bg-gray-800 rounded-lg border shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Date</th>
                <th className="px-4 py-3 text-right font-medium">PnL</th>
                <th className="px-4 py-3 text-right font-medium">Trades</th>
                <th className="px-4 py-3 text-right font-medium">W/L</th>
                <th className="px-4 py-3 text-right font-medium">Win Rate</th>
                <th className="px-4 py-3 text-right font-medium">Cumulative</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {dailyData.map((d) => (
                <tr key={d.run_id} className="hover:bg-gray-50 dark:hover:bg-gray-900">
                  <td className="px-4 py-3 font-medium">{d.date.slice(0, 10)}</td>
                  <td
                    className={`px-4 py-3 text-right font-medium ${
                      d.pnl >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {formatINR(d.pnl)}
                  </td>
                  <td className="px-4 py-3 text-right">{d.trades}</td>
                  <td className="px-4 py-3 text-right">
                    {d.winners}/{d.losers}
                  </td>
                  <td className="px-4 py-3 text-right">{d.win_rate.toFixed(1)}%</td>
                  <td
                    className={`px-4 py-3 text-right ${
                      d.cumulative_pnl >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {formatINR(d.cumulative_pnl)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ============ Trades Tab ============

// Shared per-trade table (used by the single-table view and each per-exit-date
// group in the multiday view).
//
// Columns: Symbol | Setup* | Date | Qty | Entry | Exit | PnL
// (* Setup column hidden for overnight — single-setup family, redundant.)
// Entry/Exit/Qty render "—" when absent or zero (intraday rows may omit them).
// A small "mirror" badge appears when attributed===true (composite book rows).
function TradeTable({ trades, family }: { trades: HistoricalTrade[]; family: HistoryFamily }) {
  const showSetup = family !== "overnight";
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border shadow-sm overflow-x-auto">
      <table className="w-full text-sm min-w-[640px]">
        <thead className="bg-gray-50 dark:bg-gray-900">
          <tr>
            <th className="px-4 py-3 text-left font-medium">Symbol</th>
            {showSetup && <th className="px-4 py-3 text-left font-medium">Setup</th>}
            <th className="px-4 py-3 text-left font-medium">Date</th>
            <th className="px-4 py-3 text-right font-medium">Qty</th>
            <th className="px-4 py-3 text-right font-medium">Entry</th>
            <th className="px-4 py-3 text-right font-medium">Exit</th>
            <th className="px-4 py-3 text-right font-medium">PnL</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {trades.map((t, idx) => {
            // Treat entry/exit as absent when 0 or null — intraday rows may omit them.
            const entryStr = t.entry != null && t.entry > 0 ? t.entry.toFixed(2) : "—";
            const exitStr  = t.exit  != null && t.exit  > 0 ? t.exit.toFixed(2)  : "—";
            const qtyStr   = t.qty   != null               ? String(t.qty)       : "—";
            const dateStr  = t.date  ? t.date.slice(0, 10)                        : "—";
            return (
              <tr key={`${t.symbol}-${idx}`} className="hover:bg-gray-50 dark:hover:bg-gray-900">
                <td className="px-4 py-3 font-medium">
                  {t.symbol}
                  {t.attributed && (
                    <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                      mirror
                    </span>
                  )}
                </td>
                {showSetup && <td className="px-4 py-3">{t.setup}</td>}
                <td className="px-4 py-3">{dateStr}</td>
                <td className="px-4 py-3 text-right">{qtyStr}</td>
                <td className="px-4 py-3 text-right">{entryStr}</td>
                <td className="px-4 py-3 text-right">{exitStr}</td>
                <td
                  className={`px-4 py-3 text-right font-medium ${
                    t.pnl >= 0 ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {formatINR(t.pnl)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TradesTab({ data, family }: { data: AggregateData; family: HistoryFamily }) {
  const trades = data.trades || [];

  // Group multiday trades by exit date with a standalone per-day PnL (no running
  // cumulative — positions settle on different days, so cumulative is misleading).
  const byExitDate = useMemo(() => {
    const groups: Record<string, HistoricalTrade[]> = {};
    for (const t of trades) {
      const d = t.date || "—";
      (groups[d] ||= []).push(t);
    }
    // Most recent exit date first.
    return Object.keys(groups)
      .sort((a, b) => (a < b ? 1 : -1))
      .map((d) => ({
        date: d,
        rows: groups[d],
        pnl: groups[d].reduce((acc, t) => acc + t.pnl, 0),
      }));
  }, [trades]);

  const pnlValues = trades.map((t) => t.pnl);

  // PnL distribution histogram (over all trades, both views).
  const histogramData = useMemo(() => {
    if (pnlValues.length === 0) return [];
    const bins: { range: string; count: number }[] = [];
    const min = Math.min(...pnlValues);
    const max = Math.max(...pnlValues);
    const binSize = (max - min) / 15 || 1;

    for (let i = 0; i < 15; i++) {
      const low = min + i * binSize;
      const high = low + binSize;
      const count = trades.filter((t) => t.pnl >= low && t.pnl < high).length;
      bins.push({
        range: `${formatINR(low).replace("₹", "")}`,
        count,
      });
    }
    return bins;
  }, [trades, pnlValues]);

  if (trades.length === 0) {
    return <div className="text-center py-12 text-gray-500">No trades data available</div>;
  }

  const maxWin = Math.max(...pnlValues);
  const maxLoss = Math.min(...pnlValues);
  const winners = trades.filter((t) => t.pnl > 0);
  const losers = trades.filter((t) => t.pnl <= 0);
  const avgWin = winners.length > 0 ? winners.reduce((a, b) => a + b.pnl, 0) / winners.length : 0;
  const avgLoss = losers.length > 0 ? losers.reduce((a, b) => a + b.pnl, 0) / losers.length : 0;

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold mb-3">Trade Statistics</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="Max Win" value={formatINR(maxWin)} />
          <MetricCard label="Max Loss" value={formatINR(maxLoss)} />
          <MetricCard label="Avg Win" value={formatINR(avgWin)} />
          <MetricCard label="Avg Loss" value={formatINR(avgLoss)} />
        </div>
      </section>

      {/* PnL Distribution */}
      {histogramData.length > 0 && (
        <section>
          <h3 className="text-md font-semibold mb-3">PnL Distribution</h3>
          <div className="bg-white dark:bg-gray-800 rounded-lg border p-4 h-[250px]">
            <PnLHistogramChart data={histogramData} />
          </div>
        </section>
      )}

      {/* Trades — multiday: one table per exit date with that day's PnL.
          intraday/overnight: a single all-trades table. */}
      {family === "multiday" ? (
        byExitDate.map((g) => (
          <section key={g.date}>
            <h3 className="text-md font-semibold mb-3 flex items-center justify-between">
              <span>
                Exit {g.date} · {g.rows.length} trade{g.rows.length === 1 ? "" : "s"}
              </span>
              <span className={g.pnl >= 0 ? "text-green-600" : "text-red-600"}>
                {formatINR(g.pnl)}
              </span>
            </h3>
            <TradeTable trades={g.rows} family={family} />
          </section>
        ))
      ) : (
        <section>
          <h3 className="text-md font-semibold mb-3">All Trades ({trades.length})</h3>
          <TradeTable trades={trades} family={family} />
        </section>
      )}
    </div>
  );
}
