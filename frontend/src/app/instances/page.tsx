"use client";

import { useState, useEffect } from "react";
import { MetricCard } from "@/components/MetricCard";
import { AdminPanel, ExitButton } from "@/components/AdminPanel";
import { cn, formatINR, formatPct, formatTime } from "@/lib/utils";
import {
  Instance,
  InstanceStatus,
  InstancePosition,
  BrokerFunds,
  ClosedTrade,
  ClosedTradesResponse,
  fetchInstances,
  fetchInstanceStatus,
  fetchInstancePositions,
  fetchInstanceFunds,
  fetchInstanceClosedTrades,
} from "@/lib/api";
import { useAdmin } from "@/lib/AdminContext";
import { RefreshCw, Circle, Server, Activity, AlertCircle } from "lucide-react";

export default function InstancesPage() {
  const { isAdmin } = useAdmin();
  const [instances, setInstances] = useState<Instance[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<string | null>(null);
  const [status, setStatus] = useState<InstanceStatus | null>(null);
  const [positions, setPositions] = useState<InstancePosition[]>([]);
  const [closedTrades, setClosedTrades] = useState<ClosedTradesResponse | null>(null);
  const [brokerFunds, setBrokerFunds] = useState<BrokerFunds | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  // Load instances list
  const loadInstances = async () => {
    try {
      const data = await fetchInstances();
      setInstances(data.instances);
      // Auto-select first online instance if none selected
      if (!selectedInstance) {
        const firstOnline = data.instances.find((i) => i.status === "ok");
        if (firstOnline) setSelectedInstance(firstOnline.name);
      }
    } catch (err) {
      console.error("Failed to load instances:", err);
    }
  };

  // Load selected instance details
  const loadInstanceDetails = async () => {
    if (!selectedInstance) return;

    try {
      setLoading(true);
      const [statusData, positionsData, fundsData, closedData] = await Promise.all([
        fetchInstanceStatus(selectedInstance),
        fetchInstancePositions(selectedInstance),
        fetchInstanceFunds(selectedInstance).catch(() => ({ status: "error", funds: null })),
        fetchInstanceClosedTrades(selectedInstance).catch(() => ({ trades: [], count: 0, total_pnl: 0, winners: 0, losers: 0, win_rate: 0 })),
      ]);
      setStatus(statusData);
      setPositions(positionsData.positions || []);
      setBrokerFunds(fundsData.funds);
      setClosedTrades(closedData);
      setLastUpdated(new Date().toLocaleTimeString());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load instance details");
      setStatus(null);
      setPositions([]);
      setBrokerFunds(null);
      setClosedTrades(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInstances();
  }, []);

  useEffect(() => {
    if (selectedInstance) {
      loadInstanceDetails();
    }
  }, [selectedInstance]);

  useEffect(() => {
    if (!autoRefresh || !selectedInstance) return;
    const interval = setInterval(() => {
      loadInstances();
      loadInstanceDetails();
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, selectedInstance]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "ok":
        return "text-green-500";
      case "unhealthy":
        return "text-yellow-500";
      case "offline":
        return "text-red-500";
      default:
        return "text-gray-400";
    }
  };

  const selectedInstanceData = instances.find((i) => i.name === selectedInstance);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Server className="w-6 h-6" />
            Engine Instances
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Real-time monitoring from engine health servers
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            Auto-refresh (5s)
          </label>

          <button
            onClick={() => {
              loadInstances();
              loadInstanceDetails();
            }}
            disabled={loading}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Instance Selector */}
      <div className="flex flex-wrap gap-2">
        {instances.map((instance) => (
          <button
            key={instance.name}
            onClick={() => setSelectedInstance(instance.name)}
            className={`px-4 py-2 rounded-lg border flex items-center gap-2 transition-colors ${
              selectedInstance === instance.name
                ? "bg-blue-50 border-blue-300 dark:bg-blue-900/30 dark:border-blue-700"
                : "hover:bg-gray-50 dark:hover:bg-gray-800"
            }`}
          >
            <Circle className={`w-2 h-2 fill-current ${getStatusColor(instance.status)}`} />
            <span className="font-medium">{instance.name}</span>
            <span className="text-xs text-gray-500">
              {instance.type === "live" ? "🔴 LIVE" : "📝 Paper"}
            </span>
          </button>
        ))}
        {instances.length === 0 && (
          <div className="text-gray-500 text-sm">No instances found. Start engines with --health-port flag.</div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500" />
          <div>
            <p className="text-red-700 font-medium">Connection Error</p>
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        </div>
      )}

      {selectedInstance && status && (
        <>
          {/* Admin Panel (for live instances) */}
          {selectedInstanceData?.type === "live" && (
            <AdminPanel
              instance={selectedInstance}
              status={status}
              positions={positions}
              brokerFunds={brokerFunds}
              onRefresh={loadInstanceDetails}
            />
          )}

          {/* Status Overview */}
          <section>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Activity className="w-5 h-5" />
              Status: {selectedInstance}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard
                label="State"
                value={status.state}
                delta={status.state === "trading" ? "up" : undefined}
              />
              <MetricCard
                label="Uptime"
                value={`${Math.floor(status.uptime_seconds / 60)}m`}
              />
              <MetricCard
                label="Positions"
                value={status.positions_count}
              />
              <MetricCard
                label="Unrealized P&L"
                value={formatINR(status.unrealized_pnl)}
                delta={status.unrealized_pnl >= 0 ? "up" : "down"}
              />
            </div>
          </section>

          {/* Broker DMAT Balance */}
          {brokerFunds && !brokerFunds.error && (
            <section>
              <h2 className="text-lg font-semibold mb-3">🏦 Broker Account (Kite DMAT)</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <MetricCard label="Available Cash" value={formatINR(brokerFunds.available_cash)} />
                <MetricCard label="Available Margin" value={formatINR(brokerFunds.available_margin)} />
                <MetricCard label="Used Margin" value={formatINR(brokerFunds.used_margin)} />
                <MetricCard label="Net Balance" value={formatINR(brokerFunds.net)} />
              </div>
            </section>
          )}

          {/* Engine Capital (allocation for this session) */}
          {status.capital && (
            <section>
              <h2 className="text-lg font-semibold mb-3">💰 Engine Capital</h2>
              {/* Warning if allocated capital exceeds total DMAT capacity (available + already used margin) */}
              {brokerFunds && !brokerFunds.error && status.capital.total > (brokerFunds.available_margin + brokerFunds.used_margin) && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-3 flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-orange-500 flex-shrink-0" />
                  <div className="text-sm text-orange-700">
                    <span className="font-medium">Warning:</span> Allocated capital ({formatINR(status.capital.total)}) exceeds total DMAT capacity ({formatINR(brokerFunds.available_margin + brokerFunds.used_margin)}). Orders may be rejected by broker.
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <MetricCard label="Allocated" value={formatINR(status.capital.total)} />
                <MetricCard label="Available" value={formatINR(status.capital.available)} />
                <MetricCard label="Margin Used" value={formatINR(status.capital.margin_used)} />
                <MetricCard
                  label="MIS Mode"
                  value={status.capital.mis_enabled ? "ON (5x)" : "OFF"}
                />
              </div>
            </section>
          )}

          {/* Metrics */}
          <section>
            <h2 className="text-lg font-semibold mb-3">📊 Session Metrics</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard label="Trades Entered" value={status.metrics.trades_entered} />
              <MetricCard label="Trades Exited" value={status.metrics.trades_exited} />
              <MetricCard label="Errors" value={status.metrics.errors} />
              <MetricCard label="Admin Actions" value={status.metrics.admin_actions} />
            </div>
          </section>

          {/* Positions Table - matches PositionsTable.tsx format */}
          <section>
            <h2 className="text-lg font-semibold mb-3">
              📈 Open Positions ({positions.length})
            </h2>
            <div className="bg-white dark:bg-gray-800 rounded-lg border shadow-sm overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="py-3 px-2">Symbol</th>
                    <th className="py-3 px-2">Side</th>
                    <th className="py-3 px-2">Entry</th>
                    <th className="py-3 px-2">Current</th>
                    <th className="py-3 px-2">Qty</th>
                    <th className="py-3 px-2">Booked</th>
                    <th className="py-3 px-2">Unrealized</th>
                    <th className="py-3 px-2">Total PnL</th>
                    <th className="py-3 px-2 hidden md:table-cell">Entry Time</th>
                    <th className="py-3 px-2 hidden lg:table-cell">T1 Exit</th>
                    {isAdmin && selectedInstanceData?.type === "live" && (
                      <th className="py-3 px-2">Action</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {positions.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="py-8 text-center text-gray-500">
                        No open positions
                      </td>
                    </tr>
                  ) : (
                    positions.map((pos) => {
                      const unrealizedPnl = pos.pnl || 0;
                      const bookedPnl = pos.booked_pnl || 0;
                      const totalPnl = unrealizedPnl + bookedPnl;
                      const hasPartialExit = pos.t1_done || false;

                      return (
                        <tr key={pos.symbol} className="border-b hover:bg-gray-50 dark:hover:bg-gray-800">
                          <td className="py-3 px-2 font-medium">
                            {pos.symbol}
                            {hasPartialExit && (
                              <span className="ml-1 px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">
                                T1
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-2">
                            <span className={cn(
                              "px-2 py-1 rounded text-xs font-medium",
                              pos.side === "SELL" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
                            )}>
                              {pos.side === "SELL" ? "SHORT" : "LONG"}
                            </span>
                          </td>
                          <td className="py-3 px-2">{formatINR(pos.entry)}</td>
                          <td className="py-3 px-2">{formatINR(pos.ltp || pos.entry)}</td>
                          <td className="py-3 px-2">{pos.qty}</td>
                          <td className={cn("py-3 px-2", bookedPnl !== 0 ? (bookedPnl >= 0 ? "text-green-600" : "text-red-600") : "text-gray-400")}>
                            {bookedPnl !== 0 ? formatINR(bookedPnl) : "-"}
                          </td>
                          <td className={cn("py-3 px-2", unrealizedPnl >= 0 ? "text-green-600" : "text-red-600")}>
                            {formatINR(unrealizedPnl)}
                          </td>
                          <td className={cn("py-3 px-2 font-medium", totalPnl >= 0 ? "text-green-600" : "text-red-600")}>
                            {formatINR(totalPnl)}
                          </td>
                          <td className="py-3 px-2 hidden md:table-cell">{pos.entry_time ? formatTime(pos.entry_time) : "-"}</td>
                          <td className="py-3 px-2 hidden lg:table-cell">
                            {hasPartialExit && pos.t1_exit_time ? formatTime(pos.t1_exit_time) : "-"}
                          </td>
                          {isAdmin && selectedInstanceData?.type === "live" && (
                            <td className="py-3 px-2">
                              <ExitButton
                                instance={selectedInstance}
                                symbol={pos.symbol}
                                qty={pos.qty}
                                t1Done={pos.t1_done}
                                onSuccess={loadInstanceDetails}
                              />
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Closed Trades Table - matches ClosedPositionsTable format */}
          <section>
            <h2 className="text-lg font-semibold mb-3">
              ✅ Closed Positions ({closedTrades?.count || 0})
              {closedTrades && closedTrades.count > 0 && (
                <span className={`ml-2 text-sm font-normal ${closedTrades.total_pnl >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {formatINR(closedTrades.total_pnl)} • {closedTrades.win_rate}% WR
                </span>
              )}
            </h2>
            <div className="bg-white dark:bg-gray-800 rounded-lg border shadow-sm overflow-x-auto">
              <table className="w-full text-sm min-w-[600px]">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="py-3 px-2">Symbol</th>
                    <th className="py-3 px-2">Side</th>
                    <th className="py-3 px-2">Entry</th>
                    <th className="py-3 px-2">Exit</th>
                    <th className="py-3 px-2">Qty</th>
                    <th className="py-3 px-2">PnL</th>
                    <th className="py-3 px-2">PnL %</th>
                    <th className="py-3 px-2">Reason</th>
                    <th className="py-3 px-2 hidden md:table-cell">Entry Time</th>
                    <th className="py-3 px-2 hidden lg:table-cell">Exit Time</th>
                  </tr>
                </thead>
                <tbody>
                  {(!closedTrades || closedTrades.trades.length === 0) ? (
                    <tr>
                      <td colSpan={10} className="py-8 text-center text-gray-500">
                        No closed positions this session
                      </td>
                    </tr>
                  ) : (
                    closedTrades.trades.map((trade, idx) => {
                      const positionCost = trade.entry_price * trade.qty;
                      const pnlPct = positionCost > 0 ? (trade.pnl / positionCost) * 100 : 0;

                      return (
                        <tr key={`${trade.symbol}-${idx}`} className="border-b hover:bg-gray-50 dark:hover:bg-gray-800">
                          <td className="py-3 px-2 font-medium">{trade.symbol}</td>
                          <td className="py-3 px-2">
                            <span className={cn(
                              "px-2 py-1 rounded text-xs font-medium",
                              trade.side === "SELL" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
                            )}>
                              {trade.side === "SELL" ? "SHORT" : "LONG"}
                            </span>
                          </td>
                          <td className="py-3 px-2">{formatINR(trade.entry_price)}</td>
                          <td className="py-3 px-2">{formatINR(trade.exit_price)}</td>
                          <td className="py-3 px-2">{trade.qty}</td>
                          <td className={cn("py-3 px-2 font-medium", trade.pnl >= 0 ? "text-green-600" : "text-red-600")}>
                            {formatINR(trade.pnl)}
                          </td>
                          <td className={cn("py-3 px-2", pnlPct >= 0 ? "text-green-600" : "text-red-600")}>
                            {formatPct(pnlPct)}
                          </td>
                          <td className="py-3 px-2">{trade.exit_reason}</td>
                          <td className="py-3 px-2 hidden md:table-cell">{trade.entry_time ? formatTime(trade.entry_time) : "-"}</td>
                          <td className="py-3 px-2 hidden lg:table-cell">{trade.exit_time ? formatTime(trade.exit_time) : "-"}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Last Updated */}
          <p className="text-sm text-gray-500 text-center">
            Last updated: {lastUpdated}
          </p>
        </>
      )}
    </div>
  );
}
