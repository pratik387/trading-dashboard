"use client";

import { useState, useEffect, useCallback } from "react";
import { MetricCard } from "@/components/MetricCard";
import { cn, formatINR } from "@/lib/utils";
import { MultidayBook, fetchMultidayBook } from "@/lib/api";
import { Layers, RefreshCw, Radio } from "lucide-react";

const REFRESH_INTERVAL_MS = 30000; // 30s — marks open positions to the latest price

const SETUP_LABELS: Record<string, string> = {
  mtf_capitulation_revert_long: "mtf",
  low52_capitulation_revert_long: "low52",
  zscore_oversold_revert_long: "zscore",
  crash2d_revert_long: "crash2d",
};
const lbl = (s: string) => SETUP_LABELS[s] ?? s;

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
            CNC/MTF capitulation setups (2-3 day holds) — open positions marked to latest price
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            label="Live PnL (open)"
            value={pnl == null ? "—" : formatINR(pnl)}
            delta={pnl == null ? undefined : pnl >= 0 ? "up" : "down"}
            help="Mark-to-market on held positions (latest price − entry) × qty. '—' if prices unavailable."
          />
          <MetricCard label="Open positions" value={String(s.open_count)} subValue={`${formatINR(s.open_notional)} notional`} />
          <MetricCard label="Pending entries" value={String(s.pending_count)} subValue={`${formatINR(s.pending_notional)} est.`} />
          <MetricCard label="Setups active" value={String(s.by_setup.length)} subValue={s.by_setup.map((x) => lbl(x.setup)).join(", ") || "—"} />
        </div>
      )}

      {/* Open positions (held, marked-to-market) */}
      <div className="rounded-lg border bg-white dark:bg-gray-900 p-4 space-y-3">
        <h2 className="font-semibold flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500"></span>
          Open Positions
          <span className="text-xs font-normal text-gray-500">({book?.open.length ?? 0} held · live PnL)</span>
        </h2>
        {!book || book.open.length === 0 ? (
          <div className="text-sm text-gray-500 py-6 text-center">
            No open positions. Pending entries below become open here once they fill at the next open.
          </div>
        ) : (
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
                  <th className="py-2 pr-3">Exit by</th>
                </tr>
              </thead>
              <tbody>
                {book.open.map((p, i) => (
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
                    <td className="py-2 pr-3 text-xs text-gray-500">{p.exit_on_date ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pending entries (AMO placed, awaiting next-open fill) */}
      <div className="rounded-lg border bg-white dark:bg-gray-900 p-4 space-y-3">
        <h2 className="font-semibold flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-500"></span>
          Pending Entries
          <span className="text-xs font-normal text-gray-500">({book?.pending.length ?? 0} · AMO awaiting next open)</span>
        </h2>
        {!book || book.pending.length === 0 ? (
          <div className="text-sm text-gray-500 py-6 text-center">No pending entries.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b">
                  <th className="py-2 pr-3">Setup</th>
                  <th className="py-2 pr-3">Symbol</th>
                  <th className="py-2 pr-3 text-right">Ref Px</th>
                  <th className="py-2 pr-3 text-right">Qty</th>
                  <th className="py-2 pr-3">Product</th>
                  <th className="py-2 pr-3 text-right">Est. Notional</th>
                  <th className="py-2 pr-3">Fills on</th>
                  <th className="py-2 pr-3">Exit by</th>
                </tr>
              </thead>
              <tbody>
                {book.pending.map((p, i) => (
                  <tr key={`${p.setup}-${p.symbol}-${i}`} className="border-b last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800">
                    <td className="py-2 pr-3 text-xs text-gray-600 dark:text-gray-400">{lbl(p.setup)}</td>
                    <td className="py-2 pr-3 font-medium">{p.symbol}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{p.ref_price ? `₹${p.ref_price.toFixed(2)}` : "—"}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-600">{p.qty.toLocaleString()}</td>
                    <td className="py-2 pr-3 text-xs text-gray-600 dark:text-gray-400">{p.product ?? "—"}{p.leverage && p.leverage > 1 ? ` ${p.leverage}×` : ""}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-600">{formatINR(p.notional)}</td>
                    <td className="py-2 pr-3 text-xs text-gray-500">{p.fills_on ?? "—"}</td>
                    <td className="py-2 pr-3 text-xs text-gray-500">{p.exit_on_date ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
