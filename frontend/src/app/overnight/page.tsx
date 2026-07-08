"use client";

import { useState, useEffect, useCallback } from "react";
import { Tabs } from "@/components/Tabs";
import { HistoryView, HistoryBook } from "@/components/HistoryView";
import { BookChip } from "@/components/BookChip";
import { cn, formatINR, formatTime } from "@/lib/utils";
import {
  OvernightPool,
  OvernightCronHealth,
  OvernightPaperOpen,
  fetchOvernightPool,
  fetchOvernightCronHealth,
  fetchOvernightPaperOpen,
  fetchSwingAggregate,
} from "@/lib/api";
import {
  Moon,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Radio,
} from "lucide-react";

export default function OvernightPage() {
  // Page-level tabs: Book = today's lifecycle (slot pool, cron health,
  // paper-open); History = ledger/daily/date-range aggregate with a
  // live-vs-paper book switch (absorbs the old archive-date dropdown and
  // the /historical page's overnight family).
  const [activeTab, setActiveTab] = useState<"book" | "history">("book");
  // Book tab source: real-money slot pool vs the Rs1L idealized paper mirror.
  const [book, setBook] = useState<"live" | "paper">("live");
  const [pool, setPool] = useState<OvernightPool | null>(null);
  const [cron, setCron] = useState<OvernightCronHealth | null>(null);
  const [paperOpen, setPaperOpen] = useState<OvernightPaperOpen | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastLoaded, setLastLoaded] = useState<string>("");

  const loadAll = useCallback(async () => {
    try {
      const [p, ch] = await Promise.all([
        fetchOvernightPool(),
        fetchOvernightCronHealth(),
      ]);
      setPool(p);
      setCron(ch);
      // Paper-open is best-effort — the file only exists after a paper entry.
      try {
        setPaperOpen(await fetchOvernightPaperOpen());
      } catch {
        setPaperOpen(null);
      }
      setError(null);
      setLastLoaded(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // History tab data source: pooled overnight ledger aggregate, per book.
  const historyFetcher = useCallback(
    (dateFrom: string | undefined, dateTo: string | undefined, b: HistoryBook) =>
      fetchSwingAggregate("overnight", dateFrom, dateTo, b),
    []
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Moon className="w-6 h-6" />
            Overnight
            <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 flex items-center gap-1 font-normal">
              <Radio className="w-3 h-3" />
              Live
            </span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            close_dn_overnight_long — cron-driven (15:27 entry, 09:30 verify-exit)
            {activeTab === "book" && lastLoaded && (
              <span className="ml-2">· Last loaded {lastLoaded}</span>
            )}
          </p>
        </div>

        {activeTab === "book" && (
          <div className="flex items-center gap-2 flex-wrap">
            {/* Book toggle — live: real-money slot pool; paper: Rs1L mirror */}
            <div
              className="flex rounded-lg border overflow-hidden text-sm font-medium"
              role="group"
              aria-label="Book selector"
            >
              <button
                onClick={() => setBook("live")}
                className={cn(
                  "px-3 py-2",
                  book === "live"
                    ? "bg-green-600 text-white"
                    : "bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
                )}
              >
                Live (real ₹)
              </button>
              <button
                onClick={() => setBook("paper")}
                className={cn(
                  "px-3 py-2 border-l",
                  book === "paper"
                    ? "bg-blue-600 text-white"
                    : "bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
                )}
              >
                Paper (₹1L idealized)
              </button>
            </div>

            <button
              onClick={loadAll}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>
        )}
      </div>

      {/* Page tabs */}
      <Tabs
        tabs={[
          { id: "book" as const, label: "Book" },
          { id: "history" as const, label: "History" },
        ]}
        active={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === "history" && (
        <HistoryView family="overnight" fetcher={historyFetcher} showBookToggle />
      )}

      {activeTab === "book" && (
        <BookTab
          book={book}
          pool={pool}
          cron={cron}
          paperOpen={paperOpen}
          loading={loading}
          error={error}
          onRetry={loadAll}
        />
      )}
    </div>
  );
}

// ─── Book tab: today's lifecycle ───────────────────────────────────────

function BookTab({
  book,
  pool,
  cron,
  paperOpen,
  loading,
  error,
  onRetry,
}: {
  book: "live" | "paper";
  pool: OvernightPool | null;
  cron: OvernightCronHealth | null;
  paperOpen: OvernightPaperOpen | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
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
          onClick={onRetry}
          className="mt-2 px-3 py-1 rounded bg-red-100 hover:bg-red-200 dark:bg-red-800 dark:hover:bg-red-700 text-xs"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Cron health banner — same crons drive both books */}
      {cron && <CronHealthBanner cron={cron} />}

      {/* Stale slot warning (live slot pool) */}
      {book === "live" && pool && pool.stale_slots.length > 0 && (
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

      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span>Today&apos;s book</span>
        <BookChip book={book} />
      </div>

      {/* Live book: slot pool — open positions + closed-today. The paper book
          has no slots (it's the Rs1L reconstructed ledger), so these panels
          are live-only. */}
      {book === "live" && pool && <OpenPositionsPanel pool={pool} />}
      {book === "live" && pool && <ClosedTodayPanel pool={pool} />}

      {/* Paper book: open fires at Rs1L idealized (settle at next 09:45 reconstruction) */}
      {book === "paper" &&
        (paperOpen && paperOpen.fires.length > 0 ? (
          <div className="rounded-lg border bg-white dark:bg-gray-900 p-4">
            <div className="text-sm font-semibold mb-1">
              Paper Open Positions
              <span className="ml-2 text-xs font-normal text-gray-500">
                entered {paperOpen.session_date} · ₹1L idealized/fire · settles at next 09:45 reconstruction
              </span>
            </div>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr><th className="py-1">Symbol</th><th>Product</th><th>Lev</th><th>Entry (15:25)</th><th>Qty</th><th>Notional</th></tr>
              </thead>
              <tbody>
                {paperOpen.fires.map((f) => (
                  <tr key={f.symbol} className="border-t">
                    <td className="py-1 font-medium">{f.symbol}</td>
                    <td>{f.product}</td>
                    <td>{f.leverage.toFixed(2)}x</td>
                    <td>{f.entry_price.toFixed(2)}</td>
                    <td>{f.paper_qty}</td>
                    <td>{formatINR(f.paper_notional)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-lg border bg-white dark:bg-gray-900 text-sm text-gray-500 py-10 text-center">
            No open paper positions today.
          </div>
        ))}
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
