"use client";

import { useState, useEffect, useCallback } from "react";
import { MetricCard } from "@/components/MetricCard";
import { cn, formatINR, formatTime } from "@/lib/utils";
import {
  OvernightPool,
  OvernightLedger,
  OvernightSummary,
  OvernightCronHealth,
  fetchOvernightPool,
  fetchOvernightLedger,
  fetchOvernightSummary,
  fetchOvernightCronHealth,
  fetchOvernightHistoryDates,
  fetchOvernightHistoryPool,
  fetchOvernightHistoryLedger,
  fetchOvernightHistorySummary,
} from "@/lib/api";
import {
  Moon,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Archive,
  Radio,
} from "lucide-react";

const REFRESH_INTERVAL_MS = 30000; // 30s — cron-driven setup, no need for tick speed
const LIVE_MODE = "live"; // sentinel for the dropdown's "today (live)" option

export default function OvernightPage() {
  const [pool, setPool] = useState<OvernightPool | null>(null);
  const [ledger, setLedger] = useState<OvernightLedger | null>(null);
  const [summary, setSummary] = useState<OvernightSummary | null>(null);
  const [cron, setCron] = useState<OvernightCronHealth | null>(null);
  const [archivedDates, setArchivedDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(LIVE_MODE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastLoaded, setLastLoaded] = useState<string>("");

  const isLive = selectedDate === LIVE_MODE;

  const loadAll = useCallback(async () => {
    try {
      if (isLive) {
        const [p, l, s, ch] = await Promise.all([
          fetchOvernightPool(),
          fetchOvernightLedger(),
          fetchOvernightSummary(),
          fetchOvernightCronHealth(),
        ]);
        setPool(p);
        setLedger(l);
        setSummary(s);
        setCron(ch);
      } else {
        const [p, l, s] = await Promise.all([
          fetchOvernightHistoryPool(selectedDate),
          fetchOvernightHistoryLedger(selectedDate),
          fetchOvernightHistorySummary(selectedDate),
        ]);
        setPool(p);
        setLedger(l);
        setSummary(s);
        setCron(null); // cron-health isn't archived; only meaningful live
      }
      setError(null);
      setLastLoaded(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [isLive, selectedDate]);

  // Populate archived-dates list once on mount.
  useEffect(() => {
    fetchOvernightHistoryDates()
      .then((r) => setArchivedDates(r.dates))
      .catch(() => setArchivedDates([])); // non-fatal -- bucket might be empty
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    // Only auto-refresh in live mode -- archived snapshots are immutable.
    if (!autoRefresh || !isLive) return;
    const id = setInterval(loadAll, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [autoRefresh, isLive, loadAll]);

  if (loading && !pool) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        Loading overnight data...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-900 p-4 text-sm text-red-700 dark:text-red-300">
        <div className="font-medium mb-1">Failed to load overnight data</div>
        <div>{error}</div>
        <button
          onClick={loadAll}
          className="mt-2 px-3 py-1 rounded bg-red-100 hover:bg-red-200 dark:bg-red-800 dark:hover:bg-red-700 text-xs"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Moon className="w-6 h-6" />
            Overnight Setup
            {isLive ? (
              <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 flex items-center gap-1 font-normal">
                <Radio className="w-3 h-3" />
                Live
              </span>
            ) : (
              <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 flex items-center gap-1 font-normal">
                <Archive className="w-3 h-3" />
                Archive · {selectedDate}
              </span>
            )}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {summary?.setup_name || "close_dn_overnight_long"} — cron-driven (15:27 entry, 09:30 verify-exit)
            {lastLoaded && <span className="ml-2">· Last loaded {lastLoaded}</span>}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="text-sm border rounded-lg px-3 py-2 bg-white dark:bg-gray-800 font-medium"
            aria-label="Date selector"
          >
            <option value={LIVE_MODE}>Today (live)</option>
            {archivedDates.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>

          <label className={cn(
            "flex items-center gap-1.5 text-sm",
            isLive ? "cursor-pointer" : "cursor-not-allowed opacity-50"
          )}>
            <input
              type="checkbox"
              checked={autoRefresh && isLive}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              disabled={!isLive}
              className="rounded"
            />
            Auto-refresh (30s)
          </label>
          <button
            onClick={loadAll}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Cron health banner -- live only; archived view has no cron-health concept */}
      {isLive && cron && <CronHealthBanner cron={cron} />}

      {/* Stale slot warning */}
      {pool && pool.stale_slots.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-900 p-3 flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5" />
          <div className="text-sm">
            <div className="font-medium text-amber-800 dark:text-amber-200">
              {pool.stale_slots.length} stale slot(s) — orphan pending cleanup
            </div>
            <div className="text-amber-700 dark:text-amber-300 mt-0.5">
              {pool.stale_slots
                .map((s) => `${s.symbol} (exit_d=${s.expected_exit_date})`)
                .join(", ")}
            </div>
          </div>
        </div>
      )}

      {/* Summary metrics */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            label="Cumulative PnL"
            value={formatINR(summary.cumulative_pnl)}
            delta={summary.cumulative_pnl >= 0 ? "up" : "down"}
            help="Sum of all settled-trade net PnLs from the decay tripwire ledger"
          />
          <MetricCard
            label="Trades"
            value={String(summary.total_trades)}
            subValue={`${summary.wins}W / ${summary.losses}L`}
          />
          <MetricCard
            label="Win Rate"
            value={`${summary.win_rate_pct.toFixed(1)}%`}
            help="Backtest 6mo was 56% on n=197 — small samples vary wildly"
          />
          <MetricCard
            label="Open Positions"
            value={String(summary.current_open_positions)}
            subValue={`${summary.max_slots - summary.current_open_positions} free of ${summary.max_slots}`}
          />
        </div>
      )}

      {/* Panel 1a: Open positions (t0_open only) */}
      {pool && <OpenPositionsPanel pool={pool} />}

      {/* Panel 1b: Closed today (t1_settling — sold today, awaiting T+1 settle) */}
      {pool && <ClosedTodayPanel pool={pool} />}

      {/* Panel 2: Trade ledger */}
      {ledger && summary && <LedgerPanel ledger={ledger} dailyBreakdown={summary.daily_breakdown} />}
    </div>
  );
}

// ─── Cron health banner ────────────────────────────────────────────────

function CronHealthBanner({ cron }: { cron: OvernightCronHealth }) {
  const verifyOk = cron.verify_exit.exists;
  const entryOk = cron.entry.exists;
  const allOk = verifyOk && entryOk;
  // entry cron runs at 15:27 — if it's earlier than that, expecting it to be missing
  const nowIst = new Date();
  const istHr = (nowIst.getUTCHours() + 5) % 24; // rough IST hour
  const istMin = (nowIst.getUTCMinutes() + 30) % 60;
  const entryExpectedYet = istHr > 15 || (istHr === 15 && istMin >= 30);
  const issueWithEntry = entryExpectedYet && !entryOk;
  const issueWithVerify = istHr >= 10 && !verifyOk;
  const hasIssue = issueWithEntry || issueWithVerify;

  return (
    <div
      className={cn(
        "rounded-lg border p-3 text-sm flex items-center gap-3",
        hasIssue
          ? "border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-900"
          : allOk
            ? "border-green-200 bg-green-50 dark:bg-green-900/20 dark:border-green-900"
            : "border-gray-200 bg-gray-50 dark:bg-gray-900 dark:border-gray-800"
      )}
    >
      <Clock className="w-5 h-5 flex-shrink-0" />
      <div className="flex-1 grid grid-cols-2 gap-4">
        <CronCell
          label="09:30 Verify-exit"
          exists={verifyOk}
          mtime={cron.verify_exit.mtime_iso}
          missing={issueWithVerify}
        />
        <CronCell
          label="15:27 Entry"
          exists={entryOk}
          mtime={cron.entry.mtime_iso}
          missing={issueWithEntry}
          notYetExpected={!entryExpectedYet}
        />
      </div>
    </div>
  );
}

function CronCell({
  label,
  exists,
  mtime,
  missing,
  notYetExpected,
}: {
  label: string;
  exists: boolean;
  mtime: string | null;
  missing?: boolean;
  notYetExpected?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      {exists ? (
        <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
      ) : missing ? (
        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
      ) : (
        <Clock className="w-4 h-4 text-gray-400" />
      )}
      <div className="text-xs">
        <div className="font-medium">{label}</div>
        <div className="text-gray-500 dark:text-gray-400">
          {exists && mtime
            ? `Last run: ${formatTime(mtime)}`
            : notYetExpected
              ? "Not yet expected today"
              : "No log today"}
        </div>
      </div>
    </div>
  );
}

// ─── Panel 1a: Open positions (t0_open) ────────────────────────────────

function OpenPositionsPanel({ pool }: { pool: OvernightPool }) {
  const open = pool.active_slots.filter((s) => s.status === "t0_open");

  return (
    <div className="rounded-lg border bg-white dark:bg-gray-900 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-500"></span>
          Open Positions
          <span className="text-xs font-normal text-gray-500">
            ({open.length}/{pool.max_slots})
          </span>
        </h2>
        <span className="text-xs text-gray-500">
          {pool.new_today_count} new today
        </span>
      </div>

      {open.length === 0 ? (
        <div className="text-sm text-gray-500 py-6 text-center">
          No open positions
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b">
                <th className="py-2 pr-3">Slot</th>
                <th className="py-2 pr-3">Symbol</th>
                <th className="py-2 pr-3 text-right">Buy</th>
                <th className="py-2 pr-3 text-right">Qty</th>
                <th className="py-2 pr-3">Product</th>
                <th className="py-2 pr-3 text-right">Notional</th>
                <th className="py-2 pr-3">Expected Exit</th>
              </tr>
            </thead>
            <tbody>
              {open.map((s) => (
                <tr key={s.slot_id} className="border-b last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="py-2 pr-3 text-gray-500">{s.slot_id}</td>
                  <td className="py-2 pr-3 font-medium">{s.symbol}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {s.buy_fill_price != null ? `₹${s.buy_fill_price.toFixed(2)}` : "—"}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-gray-600">
                    {s.qty?.toLocaleString() ?? "—"}
                  </td>
                  <td className="py-2 pr-3 text-xs text-gray-600 dark:text-gray-400">{s.product ?? "—"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-gray-600">
                    {s.notional_inr != null ? formatINR(s.notional_inr) : "—"}
                  </td>
                  <td className="py-2 pr-3 text-xs text-gray-500">{s.expected_exit_date ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Panel 1b: Closed today (t1_settling) ──────────────────────────────

function ClosedTodayPanel({ pool }: { pool: OvernightPool }) {
  const closed = pool.active_slots.filter((s) => s.status === "t1_settling");

  if (closed.length === 0) return null;

  return (
    <div className="rounded-lg border bg-white dark:bg-gray-900 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-purple-500"></span>
          Closed Today
          <span className="text-xs font-normal text-gray-500">
            ({closed.length} sold today · awaiting T+1 settle)
          </span>
        </h2>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b">
              <th className="py-2 pr-3">Symbol</th>
              <th className="py-2 pr-3">Side</th>
              <th className="py-2 pr-3 text-right">Entry</th>
              <th className="py-2 pr-3 text-right">Exit</th>
              <th className="py-2 pr-3 text-right">Qty</th>
              <th className="py-2 pr-3 text-right">PnL</th>
              <th className="py-2 pr-3 text-right">PnL %</th>
              <th className="py-2 pr-3">Product</th>
            </tr>
          </thead>
          <tbody>
            {closed.map((s) => {
              const cost = (s.buy_fill_price ?? 0) * (s.qty ?? 0);
              const pnlPct = cost > 0 && s.realized_pnl_inr != null
                ? (s.realized_pnl_inr / cost) * 100
                : null;
              return (
                <tr key={s.slot_id} className="border-b last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="py-2 pr-3 font-medium">{s.symbol}</td>
                  <td className="py-2 pr-3">
                    <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 font-medium">
                      LONG
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {s.buy_fill_price != null ? `₹${s.buy_fill_price.toFixed(2)}` : "—"}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {s.sell_fill_price != null ? `₹${s.sell_fill_price.toFixed(2)}` : "—"}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-gray-600">
                    {s.qty?.toLocaleString() ?? "—"}
                  </td>
                  <td className={cn(
                    "py-2 pr-3 text-right tabular-nums font-medium",
                    s.realized_pnl_inr == null
                      ? "text-gray-400"
                      : s.realized_pnl_inr >= 0
                        ? "text-green-600 dark:text-green-400"
                        : "text-red-600 dark:text-red-400"
                  )}>
                    {s.realized_pnl_inr != null ? formatINR(s.realized_pnl_inr) : "pending"}
                  </td>
                  <td className={cn(
                    "py-2 pr-3 text-right tabular-nums",
                    pnlPct == null
                      ? "text-gray-400"
                      : pnlPct >= 0
                        ? "text-green-600 dark:text-green-400"
                        : "text-red-600 dark:text-red-400"
                  )}>
                    {pnlPct != null ? `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%` : "—"}
                  </td>
                  <td className="py-2 pr-3 text-xs text-gray-600 dark:text-gray-400">{s.product ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Panel 2: Trade ledger ─────────────────────────────────────────────

function LedgerPanel({
  ledger,
  dailyBreakdown,
}: {
  ledger: OvernightLedger;
  dailyBreakdown: OvernightSummary["daily_breakdown"];
}) {
  // Build cumulative-PnL trajectory
  const cumTrades = ledger.trades.reduce<{ idx: number; cum: number; pnl: number }[]>((acc, t, i) => {
    const prev = acc[acc.length - 1]?.cum ?? 0;
    acc.push({ idx: i + 1, cum: prev + t.net_pnl_inr, pnl: t.net_pnl_inr });
    return acc;
  }, []);

  return (
    <div className="rounded-lg border bg-white dark:bg-gray-900 p-4 space-y-4">
      <h2 className="font-semibold flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-purple-500"></span>
        Trade Ledger
        <span className="text-xs font-normal text-gray-500">
          ({ledger.trades.length} settled)
        </span>
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Cumulative chart */}
        <div className="border rounded-lg p-3">
          <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
            Cumulative PnL (running sum vs trade #)
          </div>
          <CumulativeChart data={cumTrades} />
        </div>

        {/* Daily breakdown */}
        <div className="border rounded-lg p-3">
          <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
            Per-day breakdown
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b">
                  <th className="py-1 pr-2">Date</th>
                  <th className="py-1 pr-2 text-right">Fires</th>
                  <th className="py-1 pr-2 text-right">WR</th>
                  <th className="py-1 pr-2 text-right">Net PnL</th>
                </tr>
              </thead>
              <tbody>
                {dailyBreakdown.map((d) => (
                  <tr key={d.date} className="border-b last:border-0">
                    <td className="py-1 pr-2 text-xs">{d.date}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{d.fires}</td>
                    <td className="py-1 pr-2 text-right tabular-nums text-xs">{d.wr_pct.toFixed(0)}%</td>
                    <td
                      className={cn(
                        "py-1 pr-2 text-right tabular-nums font-medium",
                        d.net_pnl >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                      )}
                    >
                      {formatINR(d.net_pnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Recent trades */}
      <details className="text-sm">
        <summary className="cursor-pointer text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100">
          Recent 20 trades (raw ledger)
        </summary>
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b">
                <th className="py-1 pr-2">#</th>
                <th className="py-1 pr-2">Timestamp</th>
                <th className="py-1 pr-2 text-right">Net PnL</th>
              </tr>
            </thead>
            <tbody>
              {ledger.trades.slice(-20).reverse().map((t, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-1 pr-2 text-gray-500">{ledger.trades.length - i}</td>
                  <td className="py-1 pr-2 text-xs text-gray-600 dark:text-gray-400">{t.ts_iso.replace("T", " ").slice(0, 19)}</td>
                  <td
                    className={cn(
                      "py-1 pr-2 text-right tabular-nums font-medium",
                      t.net_pnl_inr >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                    )}
                  >
                    {formatINR(t.net_pnl_inr)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

// Minimal SVG cumulative line chart — self-contained, no chart library
function CumulativeChart({ data }: { data: { idx: number; cum: number; pnl: number }[] }) {
  if (data.length === 0) {
    return <div className="h-32 flex items-center justify-center text-xs text-gray-400">No trades yet</div>;
  }
  const width = 400;
  const height = 140;
  const margin = { top: 8, right: 8, bottom: 20, left: 50 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const ys = data.map((d) => d.cum);
  const minY = Math.min(0, ...ys);
  const maxY = Math.max(0, ...ys);
  const padY = (maxY - minY) * 0.1 || 1000;
  const yMin = minY - padY;
  const yMax = maxY + padY;

  const xScale = (i: number) => margin.left + (i / Math.max(1, data.length - 1)) * innerW;
  const yScale = (v: number) => margin.top + innerH - ((v - yMin) / (yMax - yMin)) * innerH;
  const zeroY = yScale(0);

  const path = data.map((d, i) => `${i === 0 ? "M" : "L"} ${xScale(i)} ${yScale(d.cum)}`).join(" ");

  const finalCum = data[data.length - 1].cum;
  const isPositive = finalCum >= 0;

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
      {/* Zero line */}
      <line
        x1={margin.left}
        x2={width - margin.right}
        y1={zeroY}
        y2={zeroY}
        stroke="#9ca3af"
        strokeDasharray="3 3"
      />
      <text x={margin.left - 6} y={zeroY} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="#6b7280">
        ₹0
      </text>
      <text x={margin.left - 6} y={yScale(yMax)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="#6b7280">
        ₹{(yMax / 1000).toFixed(0)}K
      </text>
      <text x={margin.left - 6} y={yScale(yMin)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="#6b7280">
        ₹{(yMin / 1000).toFixed(0)}K
      </text>

      {/* Line */}
      <path d={path} fill="none" stroke={isPositive ? "#16a34a" : "#dc2626"} strokeWidth={2} />

      {/* Dots */}
      {data.map((d, i) => (
        <circle key={i} cx={xScale(i)} cy={yScale(d.cum)} r={2.5} fill={d.pnl >= 0 ? "#16a34a" : "#dc2626"}>
          <title>
            Trade #{d.idx}: {formatINR(d.pnl)} (cum: {formatINR(d.cum)})
          </title>
        </circle>
      ))}

      {/* X-axis label */}
      <text x={width / 2} y={height - 4} textAnchor="middle" fontSize={10} fill="#6b7280">
        Trade #
      </text>
    </svg>
  );
}

