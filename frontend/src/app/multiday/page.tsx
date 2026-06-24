"use client";

import { useState, useEffect, useCallback } from "react";
import { MetricCard } from "@/components/MetricCard";
import { cn, formatINR } from "@/lib/utils";
import {
  MultidayBook,
  MultidayOpenPosition,
  MultidayPendingPosition,
  fetchMultidayBook,
} from "@/lib/api";
import { Layers, RefreshCw, Radio } from "lucide-react";

const REFRESH_INTERVAL_MS = 30000; // 30s — marks open positions to the latest price

const SETUP_LABELS: Record<string, string> = {
  mtf_capitulation_revert_long: "mtf",
  low52_capitulation_revert_long: "low52",
  zscore_oversold_revert_long: "zscore",
  crash2d_revert_long: "crash2d",
};
const lbl = (s: string) => SETUP_LABELS[s] ?? s;

// Group positions by their exit_on_date, sorted soonest-exit first ("—"/unknown
// sorts last). Each exit date becomes its own standalone table — positions
// settle on different days, so a single pooled/cumulative view is misleading.
function groupByExit<T extends { exit_on_date: string | null }>(
  items: T[]
): { date: string; rows: T[] }[] {
  const groups: Record<string, T[]> = {};
  for (const it of items) {
    const d = it.exit_on_date ?? "—";
    (groups[d] ||= []).push(it);
  }
  return Object.keys(groups)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((d) => ({ date: d, rows: groups[d] }));
}

function OpenTable({ rows }: { rows: MultidayOpenPosition[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b">
            <th className="py-2 pr-3">Setup</th>
            <th className="py-2 pr-3">Symbol</th>
            <th className="py-2 pr-3 text-right">Entry</th>
            <th className="py-2 pr-3 text-right">Last</th>
            <th className="py-2 pr-3 text-right">Qty</th>
            <th className="py-2 pr-3">Product</th>
            <th className="py-2 pr-3 text-right">Live PnL</th>
            <th className="py-2 pr-3 text-right">%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p, i) => (
            <tr key={`${p.setup}-${p.symbol}-${i}`} className="border-b last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800">
              <td className="py-2 pr-3 text-xs text-gray-600 dark:text-gray-400">{lbl(p.setup)}</td>
              <td className="py-2 pr-3 font-medium">{p.symbol}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{p.entry_price ? `₹${p.entry_price.toFixed(2)}` : "—"}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{p.current_price != null ? `₹${p.current_price.toFixed(2)}` : "—"}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-gray-600">{p.qty.toLocaleString()}</td>
              <td className="py-2 pr-3 text-xs text-gray-600 dark:text-gray-400">{p.product ?? "—"}{p.leverage && p.leverage > 1 ? ` ${p.leverage}×` : ""}</td>
              <td className={cn("py-2 pr-3 text-right tabular-nums font-medium",
                p.live_pnl == null ? "text-gray-400" : p.live_pnl >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
                {p.live_pnl != null ? formatINR(p.live_pnl) : "—"}
              </td>
              <td className={cn("py-2 pr-3 text-right tabular-nums text-xs",
                p.live_pnl_pct == null ? "text-gray-400" : p.live_pnl_pct >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
                {p.live_pnl_pct != null ? `${p.live_pnl_pct >= 0 ? "+" : ""}${p.live_pnl_pct.toFixed(2)}%` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PendingTable({ rows }: { rows: MultidayPendingPosition[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b">
            <th className="py-2 pr-3">Setup</th>
            <th className="py-2 pr-3">Symbol</th>
            <th className="py-2 pr-3 text-right">Ref Px</th>
            <th className="py-2 pr-3 text-right">Qty</th>
            <th className="py-2 pr-3">Product</th>
            <th className="py-2 pr-3 text-right">Capital</th>
            <th className="py-2 pr-3">Fills on</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p, i) => (
            <tr key={`${p.setup}-${p.symbol}-${i}`} className="border-b last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800">
              <td className="py-2 pr-3 text-xs text-gray-600 dark:text-gray-400">{lbl(p.setup)}</td>
              <td className="py-2 pr-3 font-medium">{p.symbol}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{p.ref_price ? `₹${p.ref_price.toFixed(2)}` : "—"}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-gray-600">{p.qty.toLocaleString()}</td>
              <td className="py-2 pr-3 text-xs text-gray-600 dark:text-gray-400">{p.product ?? "—"}{p.leverage && p.leverage > 1 ? ` ${p.leverage}×` : ""}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-gray-600">{formatINR(p.capital)}</td>
              <td className="py-2 pr-3 text-xs text-gray-500">{p.fills_on ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MultidayPage() {
  const [book, setBook] = useState<MultidayBook | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastLoaded, setLastLoaded] = useState<string>("");

  const load = useCallback(async () => {
    try {
      const b = await fetchMultidayBook();
      setBook(b);
      setError(null);
      setLastLoaded(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(load, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

  if (loading && !book) {
    return <div className="flex items-center justify-center h-64 text-gray-400">Loading multi-day book...</div>;
  }
  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-900 p-4 text-sm text-red-700 dark:text-red-300">
        <div className="font-medium mb-1">Failed to load multi-day book</div>
        <div>{error}</div>
        <button onClick={load} className="mt-2 px-3 py-1 rounded bg-red-100 hover:bg-red-200 dark:bg-red-800 text-xs">Retry</button>
      </div>
    );
  }

  const s = book?.summary;
  const pnl = s?.total_live_pnl ?? null;

  const openGroups = groupByExit(book?.open ?? []);
  const pendingGroups = groupByExit(book?.pending ?? []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Layers className="w-6 h-6" />
            Multi-Day Book
            <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 flex items-center gap-1 font-normal">
              <Radio className="w-3 h-3" /> Live
            </span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            CNC/MTF capitulation setups (2-3 day holds) — grouped by exit date, open positions marked to latest price
            {lastLoaded && <span className="ml-2">· Last loaded {lastLoaded}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} className="rounded" />
            Auto-refresh (30s)
          </label>
          <button onClick={load} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border hover:bg-gray-50 dark:hover:bg-gray-800">
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /> Refresh
          </button>
        </div>
      </div>

      {/* Summary */}
      {s && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <MetricCard
            label="Live PnL (open)"
            value={pnl == null ? "—" : formatINR(pnl)}
            delta={pnl == null ? undefined : pnl >= 0 ? "up" : "down"}
            help="Mark-to-market on held positions (latest price − entry) × qty. '—' if prices unavailable."
          />
          <MetricCard label="Open positions" value={String(s.open_count)} subValue={`${formatINR(s.open_capital)} capital`} />
          <MetricCard label="Pending entries" value={String(s.pending_count)} subValue={`${formatINR(s.pending_capital)} capital`} />
        </div>
      )}

      {/* Open positions — one table per exit date, each with that day's live PnL */}
      <div className="rounded-lg border bg-white dark:bg-gray-900 p-4 space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500"></span>
          Open Positions
          <span className="text-xs font-normal text-gray-500">({book?.open.length ?? 0} held · by exit date)</span>
        </h2>
        {openGroups.length === 0 ? (
          <div className="text-sm text-gray-500 py-6 text-center">
            No open positions. Pending entries below become open here once they fill at the next open.
          </div>
        ) : (
          openGroups.map((g) => {
            const pnls = g.rows.map((r) => r.live_pnl).filter((v): v is number => v != null);
            const groupPnl = pnls.reduce((a, b) => a + b, 0);
            const groupCapital = g.rows.reduce((a, b) => a + (b.capital ?? 0), 0);
            const allPriced = pnls.length === g.rows.length;
            return (
              <div key={g.date} className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-700 dark:text-gray-300">
                    Exit {g.date} · {g.rows.length} position{g.rows.length === 1 ? "" : "s"}
                    <span className="ml-2 text-xs font-normal text-gray-500">{formatINR(groupCapital)} capital</span>
                  </span>
                  <span className={cn("tabular-nums font-medium",
                    pnls.length === 0 ? "text-gray-400" : groupPnl >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
                    {pnls.length === 0 ? "—" : `${formatINR(groupPnl)}${allPriced ? "" : " *"}`}
                  </span>
                </div>
                <OpenTable rows={g.rows} />
              </div>
            );
          })
        )}
        {openGroups.some((g) => g.rows.some((r) => r.live_pnl == null)) && (
          <p className="text-xs text-gray-400">* some positions unpriced; day PnL excludes them.</p>
        )}
      </div>

      {/* Pending entries — one table per exit date */}
      <div className="rounded-lg border bg-white dark:bg-gray-900 p-4 space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-500"></span>
          Pending Entries
          <span className="text-xs font-normal text-gray-500">({book?.pending.length ?? 0} · AMO awaiting next open · by exit date)</span>
        </h2>
        {pendingGroups.length === 0 ? (
          <div className="text-sm text-gray-500 py-6 text-center">No pending entries.</div>
        ) : (
          pendingGroups.map((g) => {
            const groupCapital = g.rows.reduce((a, b) => a + (b.capital ?? 0), 0);
            return (
              <div key={g.date} className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-700 dark:text-gray-300">
                    Exit {g.date} · {g.rows.length} entr{g.rows.length === 1 ? "y" : "ies"}
                  </span>
                  <span className="tabular-nums text-xs text-gray-500">{formatINR(groupCapital)} capital</span>
                </div>
                <PendingTable rows={g.rows} />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
