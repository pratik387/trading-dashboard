"use client";

import { useState, useEffect } from "react";
import { MetricCard } from "@/components/MetricCard";
import { AdminPanel, ExitButton } from "@/components/AdminPanel";
import { formatINR } from "@/lib/utils";
import {
  Instance,
  InstanceStatus,
  InstancePosition,
  fetchInstances,
  fetchInstanceStatus,
  fetchInstancePositions,
} from "@/lib/api";
import { useAdmin } from "@/lib/AdminContext";
import { RefreshCw, Circle, Server, Activity, AlertCircle } from "lucide-react";

export default function InstancesPage() {
  const { isAdmin } = useAdmin();
  const [instances, setInstances] = useState<Instance[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<string | null>(null);
  const [status, setStatus] = useState<InstanceStatus | null>(null);
  const [positions, setPositions] = useState<InstancePosition[]>([]);
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
      const [statusData, positionsData] = await Promise.all([
        fetchInstanceStatus(selectedInstance),
        fetchInstancePositions(selectedInstance),
      ]);
      setStatus(statusData);
      setPositions(positionsData.positions || []);
      setLastUpdated(new Date().toLocaleTimeString());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load instance details");
      setStatus(null);
      setPositions([]);
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

          {/* Capital */}
          {status.capital && (
            <section>
              <h2 className="text-lg font-semibold mb-3">💵 Capital</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <MetricCard label="Total" value={formatINR(status.capital.total)} />
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

          {/* Positions Table */}
          <section>
            <h2 className="text-lg font-semibold mb-3">
              📈 Open Positions ({positions.length})
            </h2>
            <div className="bg-white dark:bg-gray-800 rounded-lg border shadow-sm overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left">Symbol</th>
                    <th className="px-4 py-3 text-left">Side</th>
                    <th className="px-4 py-3 text-right">Qty</th>
                    <th className="px-4 py-3 text-right">Entry</th>
                    <th className="px-4 py-3 text-right">LTP</th>
                    <th className="px-4 py-3 text-right">P&L</th>
                    <th className="px-4 py-3 text-right">SL</th>
                    <th className="px-4 py-3 text-right">Target</th>
                    {isAdmin && selectedInstanceData?.type === "live" && (
                      <th className="px-4 py-3 text-center">Action</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-gray-700">
                  {positions.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                        No open positions
                      </td>
                    </tr>
                  ) : (
                    positions.map((pos) => (
                      <tr key={pos.symbol} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-4 py-3 font-medium">{pos.symbol}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-1 rounded text-xs ${
                              pos.side === "BUY"
                                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                            }`}
                          >
                            {pos.side === "BUY" ? "LONG" : "SHORT"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">{pos.qty}</td>
                        <td className="px-4 py-3 text-right">{pos.entry.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right">{pos.ltp?.toFixed(2) || "-"}</td>
                        <td
                          className={`px-4 py-3 text-right font-medium ${
                            (pos.pnl || 0) >= 0 ? "text-green-600" : "text-red-600"
                          }`}
                        >
                          {pos.pnl ? formatINR(pos.pnl) : "-"}
                        </td>
                        <td className="px-4 py-3 text-right text-red-600">
                          {pos.sl?.toFixed(2) || "-"}
                        </td>
                        <td className="px-4 py-3 text-right text-green-600">
                          {pos.t1_done
                            ? pos.t2?.toFixed(2) || "-"
                            : pos.t1?.toFixed(2) || "-"}
                          {pos.t1_done && <span className="text-xs text-gray-400 ml-1">(T2)</span>}
                        </td>
                        {isAdmin && selectedInstanceData?.type === "live" && (
                          <td className="px-4 py-3 text-center">
                            <ExitButton
                              instance={selectedInstance}
                              symbol={pos.symbol}
                              qty={pos.qty}
                              onSuccess={loadInstanceDetails}
                            />
                          </td>
                        )}
                      </tr>
                    ))
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
