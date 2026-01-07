"use client";

import { useState, useEffect, useMemo } from "react";
import { MetricCard } from "@/components/MetricCard";
import { ClosedPositionsTable } from "@/components/PositionsTable";
import { formatINR, formatPct } from "@/lib/utils";
import { useConfig } from "@/lib/ConfigContext";
import {
  AggregateData,
  DailyData,
  SetupStats,
  ClosedPosition,
  fetchAggregate,
} from "@/lib/api";
import { History, RefreshCw, TrendingUp, Target, Calendar, BarChart3 } from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  Legend,
} from "recharts";

type TabType = "overview" | "setups" | "daily" | "trades";

export default function HistoricalPage() {
  const { configType } = useConfig();
  const [data, setData] = useState<AggregateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("overview");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const loadData = async () => {
    try {
      setLoading(true);
      const result = await fetchAggregate(
        configType,
        dateFrom || undefined,
        dateTo || undefined
      );
      setData(result);
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

  // Compute date range from data
  const dateRange = useMemo(() => {
    if (!data?.daily_data?.length) return { min: "", max: "" };
    const dates = data.daily_data.map((d) => d.date.slice(0, 10)).sort();
    return { min: dates[0], max: dates[dates.length - 1] };
  }, [data]);

  const handleDateFilter = () => {
    loadData();
  };

  const tabs = [
    { id: "overview" as TabType, label: "Overview", icon: TrendingUp },
    { id: "setups" as TabType, label: "Setups", icon: Target },
    { id: "daily" as TabType, label: "Daily", icon: Calendar },
    { id: "trades" as TabType, label: "Trades", icon: BarChart3 },
  ];

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
            {data ? `${data.days} trading days` : "Loading..."}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
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
            onClick={handleDateFilter}
            className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Filter
          </button>
          <button
            onClick={() => {
              setDateFrom("");
              setDateTo("");
              loadData();
            }}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b">
        <div className="flex gap-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? "border-blue-600 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="text-center py-6">
          <p className="text-red-500">{error}</p>
          <button
            onClick={loadData}
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
          {activeTab === "trades" && <TradesTab data={data} />}
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
        <h2 className="text-lg font-semibold mb-3">Summary</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <MetricCard
            label="Gross PnL"
            value={formatINR(data.gross_pnl)}
            delta={data.gross_pnl >= 0 ? "up" : "down"}
            help="Total profit before fees"
          />
          <MetricCard
            label="Net PnL"
            value={formatINR(data.net_pnl)}
            delta={data.net_pnl >= 0 ? "up" : "down"}
            help="Profit after fees"
          />
          <MetricCard label="Total Trades" value={data.total_trades} />
          <MetricCard label="Win Rate" value={`${data.win_rate.toFixed(1)}%`} />
          <MetricCard label="Trading Days" value={data.days} />
          <MetricCard label="Avg PnL/Day" value={formatINR(data.avg_pnl_per_day)} />
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
          <h2 className="text-lg font-semibold mb-3">Equity Curve</h2>
          <div className="bg-white dark:bg-gray-800 rounded-lg border p-4 h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v) => v.slice(5, 10)}
                  fontSize={12}
                />
                <YAxis
                  tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`}
                  fontSize={12}
                />
                <Tooltip
                  formatter={(v: number) => [formatINR(v), "Cumulative PnL"]}
                  labelFormatter={(l) => `Date: ${l}`}
                />
                <Line
                  type="monotone"
                  dataKey="cumulative_pnl"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* Daily PnL Bar Chart */}
      {dailyData.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Daily PnL</h2>
          <div className="bg-white dark:bg-gray-800 rounded-lg border p-4 h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v) => v.slice(5, 10)}
                  fontSize={12}
                />
                <YAxis
                  tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`}
                  fontSize={12}
                />
                <Tooltip
                  formatter={(v: number) => [formatINR(v), "PnL"]}
                  labelFormatter={(l) => `Date: ${l}`}
                />
                <Bar dataKey="pnl">
                  {dailyData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.pnl >= 0 ? "#22c55e" : "#ef4444"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}
    </div>
  );
}

// ============ Setups Tab ============
function SetupsTab({ data }: { data: AggregateData }) {
  const setups = data.by_setup || [];

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
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={setups} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`} />
                <YAxis type="category" dataKey="setup" width={100} fontSize={12} />
                <Tooltip formatter={(v: number) => [formatINR(v), "PnL"]} />
                <Bar dataKey="pnl">
                  {setups.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.pnl >= 0 ? "#22c55e" : "#ef4444"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div>
          <h3 className="text-md font-semibold mb-3">Trade Distribution</h3>
          <div className="bg-white dark:bg-gray-800 rounded-lg border p-4 h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={setups}
                  dataKey="trades"
                  nameKey="setup"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={(e) => e.setup}
                >
                  {setups.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* Win Rate by Setup */}
      <section>
        <h3 className="text-md font-semibold mb-3">Win Rate by Setup</h3>
        <div className="bg-white dark:bg-gray-800 rounded-lg border p-4 h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={setups}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="setup" fontSize={12} />
              <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, "Win Rate"]} />
              <Bar dataKey="win_rate">
                {setups.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.win_rate >= 50 ? "#22c55e" : "#ef4444"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Setup Table */}
      <section>
        <h3 className="text-md font-semibold mb-3">Setup Performance</h3>
        <div className="bg-white dark:bg-gray-800 rounded-lg border shadow-sm overflow-hidden">
          <table className="w-full text-sm">
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
function TradesTab({ data }: { data: AggregateData }) {
  const trades = data.trades || [];

  if (trades.length === 0) {
    return <div className="text-center py-12 text-gray-500">No trades data available</div>;
  }

  // Calculate stats
  const pnlValues = trades.map((t) => t.pnl);
  const maxWin = Math.max(...pnlValues);
  const maxLoss = Math.min(...pnlValues);
  const winners = trades.filter((t) => t.pnl > 0);
  const losers = trades.filter((t) => t.pnl <= 0);
  const avgWin = winners.length > 0 ? winners.reduce((a, b) => a + b.pnl, 0) / winners.length : 0;
  const avgLoss = losers.length > 0 ? losers.reduce((a, b) => a + b.pnl, 0) / losers.length : 0;

  // PnL distribution histogram
  const histogramData = useMemo(() => {
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
  }, [trades]);

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
      <section>
        <h3 className="text-md font-semibold mb-3">PnL Distribution</h3>
        <div className="bg-white dark:bg-gray-800 rounded-lg border p-4 h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={histogramData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="range" fontSize={10} angle={-45} textAnchor="end" height={60} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count" fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Trades Table */}
      <section>
        <h3 className="text-md font-semibold mb-3">All Trades ({trades.length})</h3>
        <div className="bg-white dark:bg-gray-800 rounded-lg border shadow-sm">
          <ClosedPositionsTable positions={trades} />
        </div>
      </section>
    </div>
  );
}
