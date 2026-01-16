"use client";

import { useState, useEffect, useCallback } from "react";
import { MetricCard } from "@/components/MetricCard";
import { ExitButton } from "@/components/AdminPanel";
import { cn, formatINR, formatPct, formatTime } from "@/lib/utils";
import {
  Instance,
  InstanceStatus,
  InstancePosition,
  BrokerFunds,
  ClosedTradesResponse,
  ClosedTrade,
  fetchInstances,
  fetchInstanceStatus,
  fetchInstancePositions,
  fetchInstanceFunds,
  fetchInstanceClosedTrades,
  adminSetCapital,
  adminToggleMIS,
  adminExitAll,
  adminPause,
  adminResume,
} from "@/lib/api";
import { useAdmin } from "@/lib/AdminContext";
import { useInstanceWebSocket } from "@/lib/useInstanceWebSocket";
import {
  RefreshCw,
  Circle,
  ChevronDown,
  ChevronUp,
  Key,
  LogOut,
  X,
  AlertTriangle,
  Pause,
  Play,
  Wifi,
  WifiOff,
} from "lucide-react";

/**
 * Get HTTP URL for an instance's API server.
 * The useInstanceWebSocket hook converts this to WebSocket URL (port + 1).
 */
function getInstanceWsUrl(instance: Instance | undefined): string | null {
  if (!instance) return null;
  // Use the dashboard's hostname (or localhost for dev) with the instance's HTTP port
  const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
  return `http://${host}:${instance.port}`;
}

export default function HomePage() {
  const { adminToken, setAdminToken, isAdmin, clearToken } = useAdmin();
  const [instances, setInstances] = useState<Instance[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<string | null>(null);
  const [status, setStatus] = useState<InstanceStatus | null>(null);
  const [positions, setPositions] = useState<InstancePosition[]>([]);
  const [closedTrades, setClosedTrades] = useState<ClosedTradesResponse | null>(null);
  const [brokerFunds, setBrokerFunds] = useState<BrokerFunds | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);  // Instance not running
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  // Track if we're using WebSocket (true) or HTTP polling fallback (false)
  const [useWebSocket, setUseWebSocket] = useState(true);

  // Admin-related state
  const [tokenInput, setTokenInput] = useState("");
  const [capitalInput, setCapitalInput] = useState("");
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminMessage, setAdminMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [confirmExitAll, setConfirmExitAll] = useState(false);

  // Collapsible sections
  const [showEngineHealth, setShowEngineHealth] = useState(false);
  const [showBrokerDetails, setShowBrokerDetails] = useState(false);

  // Get selected instance data for WebSocket URL construction
  const selectedInstanceData = instances.find((i) => i.name === selectedInstance);
  const instanceWsUrl = getInstanceWsUrl(selectedInstanceData);

  // WebSocket callbacks - use useCallback to maintain stable references
  const handleWsStatus = useCallback((data: { state: string }) => {
    setStatus((prev) => (prev ? { ...prev, state: data.state } : prev));
    setLastUpdated(new Date().toLocaleTimeString());
  }, []);

  const handleWsPositions = useCallback((newPositions: InstancePosition[]) => {
    setPositions(newPositions);
    setLastUpdated(new Date().toLocaleTimeString());
  }, []);

  const handleWsClosedTrade = useCallback((trade: ClosedTrade) => {
    setClosedTrades((prev) => {
      if (!prev) return prev;
      const isWin = trade.pnl > 0;
      const newCount = prev.count + 1;
      const newWinners = prev.winners + (isWin ? 1 : 0);
      const newLosers = prev.losers + (isWin ? 0 : 1);
      return {
        ...prev,
        trades: [...prev.trades, trade],
        count: newCount,
        total_pnl: prev.total_pnl + trade.pnl,
        winners: newWinners,
        losers: newLosers,
        win_rate: newCount > 0 ? (newWinners / newCount) * 100 : 0,
      };
    });
    setLastUpdated(new Date().toLocaleTimeString());
  }, []);

  const handleWsLTPBatch = useCallback(
    (prices: Record<string, { price: number; timestamp: string }>) => {
      // Update LTP in positions
      setPositions((prev) =>
        prev.map((pos) => {
          const priceData = prices[pos.symbol];
          if (priceData) {
            const ltp = priceData.price;
            // Recalculate unrealized PnL
            const priceDiff = pos.side === "SELL" ? pos.entry - ltp : ltp - pos.entry;
            const pnl = priceDiff * pos.qty;
            return { ...pos, ltp, pnl };
          }
          return pos;
        })
      );
      // Update total unrealized PnL in status
      setStatus((prev) => {
        if (!prev) return prev;
        const totalUnrealized = positions.reduce((sum, pos) => {
          const priceData = prices[pos.symbol];
          if (priceData) {
            const ltp = priceData.price;
            const priceDiff = pos.side === "SELL" ? pos.entry - ltp : ltp - pos.entry;
            return sum + priceDiff * pos.qty;
          }
          return sum + (pos.pnl || 0);
        }, 0);
        return { ...prev, unrealized_pnl: totalUnrealized };
      });
    },
    [positions]
  );

  // WebSocket connection
  const { connected: wsConnected, connectionState, error: wsError } = useInstanceWebSocket({
    instanceUrl: instanceWsUrl,
    enabled: autoRefresh && useWebSocket,
    onStatus: handleWsStatus,
    onPositions: handleWsPositions,
    onClosedTrade: handleWsClosedTrade,
    onLTPBatch: handleWsLTPBatch,
  });

  const showAdminMessage = (text: string, isError = false) => {
    setAdminMessage({ text, isError });
    setTimeout(() => setAdminMessage(null), 3000);
  };

  // Load instances list
  const loadInstances = async () => {
    try {
      const data = await fetchInstances();
      setInstances(data.instances);
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
        fetchInstanceClosedTrades(selectedInstance).catch(() => ({
          trades: [],
          count: 0,
          total_pnl: 0,
          winners: 0,
          losers: 0,
          win_rate: 0,
        })),
      ]);
      setStatus(statusData);
      setPositions(positionsData.positions || []);
      setBrokerFunds(fundsData.funds);
      setClosedTrades(closedData);
      setLastUpdated(new Date().toLocaleTimeString());
      setError(null);
      setIsOffline(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load instance details";
      // Detect connection errors (instance not running)
      const isConnectionError = message.includes("fetch") || message.includes("ECONNREFUSED") || message.includes("Failed to load");
      setIsOffline(isConnectionError);
      setError(isConnectionError ? null : message);  // Don't show error for offline instances
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

  // HTTP polling fallback - only used when WebSocket is disabled or not connected
  useEffect(() => {
    // Skip polling if using WebSocket and it's connected
    if (useWebSocket && wsConnected) return;
    if (!autoRefresh || !selectedInstance) return;

    const interval = setInterval(() => {
      loadInstances();
      loadInstanceDetails();
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, selectedInstance, useWebSocket, wsConnected]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "ok":
        return "bg-green-500";
      case "unhealthy":
        return "bg-yellow-500";
      case "offline":
        return "bg-red-500";
      default:
        return "bg-gray-400";
    }
  };

  const isLiveInstance = selectedInstanceData?.type === "live";
  const isPaused = status?.state === "paused";

  // Admin handlers
  const handleSetToken = () => {
    if (tokenInput.trim()) {
      setAdminToken(tokenInput.trim());
      setTokenInput("");
    }
  };

  const handleSetCapital = async () => {
    if (!adminToken || !capitalInput || !selectedInstance) return;
    const capital = parseFloat(capitalInput);
    if (isNaN(capital) || capital <= 0) {
      showAdminMessage("Invalid capital amount", true);
      return;
    }
    setAdminLoading(true);
    try {
      await adminSetCapital(selectedInstance, capital, adminToken);
      showAdminMessage(`Capital set to ${formatINR(capital)}`);
      setCapitalInput("");
      loadInstanceDetails();
    } catch (err) {
      showAdminMessage(err instanceof Error ? err.message : "Failed", true);
    } finally {
      setAdminLoading(false);
    }
  };

  const handleToggleMIS = async () => {
    if (!adminToken || !status || !selectedInstance) return;
    setAdminLoading(true);
    try {
      await adminToggleMIS(selectedInstance, !status.capital.mis_enabled, adminToken);
      showAdminMessage(`MIS ${!status.capital.mis_enabled ? "enabled" : "disabled"}`);
      loadInstanceDetails();
    } catch (err) {
      showAdminMessage(err instanceof Error ? err.message : "Failed", true);
    } finally {
      setAdminLoading(false);
    }
  };

  const handleExitAll = async () => {
    if (!adminToken || !selectedInstance) return;
    setAdminLoading(true);
    try {
      const result = await adminExitAll(selectedInstance, "manual_exit_all", adminToken);
      showAdminMessage(`Exited ${result.exits?.length || 0} positions`);
      setConfirmExitAll(false);
      loadInstanceDetails();
    } catch (err) {
      showAdminMessage(err instanceof Error ? err.message : "Failed", true);
    } finally {
      setAdminLoading(false);
    }
  };

  const handlePauseResume = async () => {
    if (!adminToken || !selectedInstance) return;
    setAdminLoading(true);
    try {
      if (isPaused) {
        await adminResume(selectedInstance, adminToken);
        showAdminMessage("Trading resumed");
      } else {
        await adminPause(selectedInstance, "manual_pause", adminToken);
        showAdminMessage("Trading paused");
      }
      loadInstanceDetails();
    } catch (err) {
      showAdminMessage(err instanceof Error ? err.message : "Failed", true);
    } finally {
      setAdminLoading(false);
    }
  };

  // Calculate PnL values
  // Realized = closed trades PnL + booked T1 partial profits from open positions
  const closedPnl = closedTrades?.total_pnl || 0;
  const bookedPnl = status?.booked_pnl || 0;  // T1 partials from open positions
  const realizedPnl = closedPnl + bookedPnl;
  const unrealizedPnl = status?.unrealized_pnl || 0;
  const totalPnl = realizedPnl + unrealizedPnl;

  return (
    <div className="space-y-4">
      {/* Header Row */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Circle className="w-3 h-3 fill-red-500 text-red-500 animate-pulse" />
          Live Trading
        </h1>

        {/* Refresh controls */}
        <div className="flex items-center gap-3">
          {/* WebSocket status indicator */}
          {autoRefresh && useWebSocket && (
            <div
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium",
                wsConnected
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : connectionState === "connecting"
                  ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                  : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
              )}
              title={wsConnected ? "Real-time updates via WebSocket" : connectionState === "connecting" ? "Connecting to WebSocket..." : "WebSocket disconnected - using HTTP polling"}
            >
              {wsConnected ? (
                <Wifi className="w-3 h-3" />
              ) : (
                <WifiOff className="w-3 h-3" />
              )}
              {wsConnected ? "Live" : connectionState === "connecting" ? "Connecting" : "Polling"}
            </div>
          )}

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
            onClick={() => {
              loadInstances();
              loadInstanceDetails();
            }}
            disabled={loading}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
            title="Manual refresh"
          >
            <RefreshCw className={cn("w-5 h-5", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Instance Selector */}
      <div className="flex flex-wrap gap-2">
        {instances.map((instance) => (
          <button
            key={instance.name}
            onClick={() => setSelectedInstance(instance.name)}
            className={cn(
              "px-3 py-1.5 rounded-lg border text-sm flex items-center gap-2 transition-colors",
              selectedInstance === instance.name
                ? "bg-blue-50 border-blue-300 dark:bg-blue-900/30 dark:border-blue-700"
                : "hover:bg-gray-50 dark:hover:bg-gray-800"
            )}
          >
            <span className={cn("w-2 h-2 rounded-full", getStatusColor(instance.status))} />
            <span className="font-medium">{instance.name}</span>
            {instance.type === "live" && (
              <span className="text-xs text-red-600">LIVE</span>
            )}
          </button>
        ))}
        {instances.length === 0 && (
          <span className="text-gray-500 text-sm">No instances found</span>
        )}
      </div>

      {/* Horizontal Admin Bar - only for live instance */}
      {isLiveInstance && selectedInstance && (
        <div className="bg-white dark:bg-gray-800 border rounded-lg py-2.5 px-4 shadow-sm">
          {!isAdmin ? (
            // Token input - inline
            <div className="flex items-center gap-3">
              <Key className="w-4 h-4 text-amber-500" />
              <input
                type="password"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSetToken()}
                placeholder="Enter admin token..."
                className="px-2 py-1 border rounded text-sm w-44 dark:bg-gray-700 dark:border-gray-600"
              />
              <button
                onClick={handleSetToken}
                className="px-3 py-1.5 bg-amber-500 text-white rounded text-sm font-medium hover:bg-amber-600"
              >
                Unlock
              </button>
            </div>
          ) : (
            // Admin controls - horizontal layout
            <div className="flex items-center gap-3 flex-wrap">
              {/* Admin message - inline */}
              {adminMessage && (
                <span
                  className={cn(
                    "px-2 py-1 rounded text-xs",
                    adminMessage.isError ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
                  )}
                >
                  {adminMessage.text}
                </span>
              )}

              {/* Pause/Resume */}
              <button
                onClick={handlePauseResume}
                disabled={adminLoading}
                title={isPaused ? "Resume trading - allow new entries" : "Pause trading - stop new entries, keep existing positions"}
                className={cn(
                  "px-3 py-1.5 rounded text-sm font-medium flex items-center gap-1.5 disabled:opacity-50",
                  isPaused
                    ? "bg-green-600 text-white hover:bg-green-700"
                    : "bg-orange-500 text-white hover:bg-orange-600"
                )}
              >
                {isPaused ? (
                  <>
                    <Play className="w-4 h-4" /> Resume
                  </>
                ) : (
                  <>
                    <Pause className="w-4 h-4" /> Pause
                  </>
                )}
              </button>

              {/* Divider */}
              <div className="w-px h-6 bg-gray-200 dark:bg-gray-700" />

              {/* MIS Toggle */}
              <button
                onClick={handleToggleMIS}
                disabled={adminLoading}
                title={status?.capital.mis_enabled ? "Switch to CNC mode (no leverage)" : "Enable MIS mode (5x leverage)"}
                className={cn(
                  "px-3 py-1.5 rounded text-sm font-medium disabled:opacity-50",
                  status?.capital.mis_enabled
                    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
                )}
              >
                MIS: {status?.capital.mis_enabled ? "ON" : "OFF"}
              </button>

              {/* Divider */}
              <div className="w-px h-6 bg-gray-200 dark:bg-gray-700" />

              {/* Capital Display + Input */}
              <div className="flex items-center gap-2" title="Set trading capital for position sizing">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  Capital: <span className="font-medium text-gray-900 dark:text-white">{status ? formatINR(status.capital.total) : "—"}</span>
                </span>
                <input
                  type="number"
                  value={capitalInput}
                  onChange={(e) => setCapitalInput(e.target.value)}
                  placeholder="New value"
                  className="w-24 px-2 py-1 border rounded text-sm dark:bg-gray-700 dark:border-gray-600"
                />
                <button
                  onClick={handleSetCapital}
                  disabled={adminLoading || !capitalInput}
                  className="px-2.5 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  Set
                </button>
              </div>

              {/* Spacer */}
              <div className="flex-1" />

              {/* Logout */}
              <button
                onClick={clearToken}
                title="Clear admin token and lock controls"
                className="px-2 py-1 text-sm text-gray-500 hover:text-red-600 rounded hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-1"
              >
                <LogOut className="w-4 h-4" />
                Logout
              </button>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-500" />
          <span className="text-red-700 text-sm">{error}</span>
        </div>
      )}

      {/* No Active Session */}
      {selectedInstance && isOffline && !loading && (
        <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-8 text-center">
          <WifiOff className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">No Active Session</h3>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            The trading engine for <span className="font-medium">{selectedInstance}</span> is not running.
          </p>
        </div>
      )}

      {selectedInstance && status && (
        <>
          {/* PnL Summary */}
          <section>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard
                label="Total PnL"
                value={formatINR(totalPnl)}
                delta={totalPnl >= 0 ? "up" : "down"}
              />
              <MetricCard
                label="Realized"
                value={formatINR(realizedPnl)}
                help="Booked P&L from closed trades"
              />
              <MetricCard
                label="Unrealized"
                value={formatINR(unrealizedPnl)}
                help="Paper P&L from open positions"
              />
              <MetricCard label="Open Positions" value={positions.length} />
            </div>
          </section>

          {/* Trade Stats */}
          <section>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard label="Closed Trades" value={closedTrades?.count || 0} />
              <MetricCard label="Winners" value={closedTrades?.winners || 0} />
              <MetricCard label="Losers" value={closedTrades?.losers || 0} />
              <MetricCard
                label="Win Rate"
                value={`${(closedTrades?.win_rate || 0).toFixed(1)}%`}
              />
            </div>
          </section>

          {/* Capital Usage */}
          <section>
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              💰 Capital Usage {status?.capital.mis_enabled && <span className="text-xs font-normal px-2 py-0.5 bg-green-100 text-green-700 rounded">MIS 5x</span>}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard
                label="Engine Capital"
                value={formatINR(status?.capital.total || 0)}
                help="Total capital allocated to trading engine"
              />
              <MetricCard
                label="Margin Used"
                value={formatINR(status?.capital.margin_used || 0)}
                help="Capital deployed in open positions"
              />
              <MetricCard
                label="Available"
                value={formatINR(status?.capital.available || 0)}
                help="Capital available for new positions"
              />
              <MetricCard
                label="Utilization"
                value={`${status?.capital.total ? ((status.capital.margin_used / status.capital.total) * 100).toFixed(1) : 0}%`}
                help="Percentage of capital currently in use"
              />
            </div>
          </section>

          {/* Open Positions Table */}
          <section>
            <h2 className="text-lg font-semibold mb-3">
              Open Positions ({positions.length})
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
                    {isAdmin && isLiveInstance && <th className="py-3 px-2">Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {positions.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-8 text-center text-gray-500">
                        No open positions
                      </td>
                    </tr>
                  ) : (
                    positions.map((pos) => {
                      const posUnrealized = pos.pnl || 0;
                      const posBooked = pos.booked_pnl || 0;
                      const posTotal = posUnrealized + posBooked;
                      const hasT1 = pos.t1_done || false;

                      return (
                        <tr
                          key={pos.symbol}
                          className="border-b hover:bg-gray-50 dark:hover:bg-gray-800"
                        >
                          <td className="py-3 px-2 font-medium">
                            {pos.symbol}
                            {hasT1 && (
                              <span className="ml-1 px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">
                                T1
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-2">
                            <span
                              className={cn(
                                "px-2 py-1 rounded text-xs font-medium",
                                pos.side === "SELL"
                                  ? "bg-red-100 text-red-700"
                                  : "bg-green-100 text-green-700"
                              )}
                            >
                              {pos.side === "SELL" ? "SHORT" : "LONG"}
                            </span>
                          </td>
                          <td className="py-3 px-2">{formatINR(pos.entry)}</td>
                          <td className="py-3 px-2">{formatINR(pos.ltp || pos.entry)}</td>
                          <td className="py-3 px-2">{pos.qty}</td>
                          <td
                            className={cn(
                              "py-3 px-2",
                              posBooked !== 0
                                ? posBooked >= 0
                                  ? "text-green-600"
                                  : "text-red-600"
                                : "text-gray-400"
                            )}
                          >
                            {posBooked !== 0 ? formatINR(posBooked) : "-"}
                          </td>
                          <td
                            className={cn(
                              "py-3 px-2",
                              posUnrealized >= 0 ? "text-green-600" : "text-red-600"
                            )}
                          >
                            {formatINR(posUnrealized)}
                          </td>
                          <td
                            className={cn(
                              "py-3 px-2 font-medium",
                              posTotal >= 0 ? "text-green-600" : "text-red-600"
                            )}
                          >
                            {formatINR(posTotal)}
                          </td>
                          <td className="py-3 px-2 hidden md:table-cell">
                            {pos.entry_time ? formatTime(pos.entry_time) : "-"}
                          </td>
                          {isAdmin && isLiveInstance && (
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

            {/* Exit All - positioned after positions table, right aligned */}
            {isAdmin && isLiveInstance && positions.length > 0 && (
              <div className="mt-3 flex justify-end">
                {confirmExitAll ? (
                  <div className="flex items-center gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-500" />
                    <span className="text-sm text-red-600">Exit all {positions.length} positions?</span>
                    <button
                      onClick={handleExitAll}
                      disabled={adminLoading}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                    >
                      Confirm Exit All
                    </button>
                    <button
                      onClick={() => setConfirmExitAll(false)}
                      className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-300"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmExitAll(true)}
                    disabled={adminLoading}
                    className="px-4 py-2 bg-red-100 text-red-700 rounded-lg text-sm font-medium hover:bg-red-200 flex items-center gap-2 disabled:opacity-50"
                  >
                    <X className="w-4 h-4" /> Exit All Positions
                  </button>
                )}
              </div>
            )}
          </section>

          {/* Closed Positions Table */}
          <section>
            <h2 className="text-lg font-semibold mb-3">
              Closed Positions ({closedTrades?.count || 0})
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
                  {!closedTrades || closedTrades.trades.length === 0 ? (
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
                        <tr
                          key={`${trade.symbol}-${idx}`}
                          className="border-b hover:bg-gray-50 dark:hover:bg-gray-800"
                        >
                          <td className="py-3 px-2 font-medium">{trade.symbol}</td>
                          <td className="py-3 px-2">
                            <span
                              className={cn(
                                "px-2 py-1 rounded text-xs font-medium",
                                trade.side === "SELL"
                                  ? "bg-red-100 text-red-700"
                                  : "bg-green-100 text-green-700"
                              )}
                            >
                              {trade.side === "SELL" ? "SHORT" : "LONG"}
                            </span>
                          </td>
                          <td className="py-3 px-2">{formatINR(trade.entry_price)}</td>
                          <td className="py-3 px-2">{formatINR(trade.exit_price)}</td>
                          <td className="py-3 px-2">{trade.qty}</td>
                          <td
                            className={cn(
                              "py-3 px-2 font-medium",
                              trade.pnl >= 0 ? "text-green-600" : "text-red-600"
                            )}
                          >
                            {formatINR(trade.pnl)}
                          </td>
                          <td
                            className={cn(
                              "py-3 px-2",
                              pnlPct >= 0 ? "text-green-600" : "text-red-600"
                            )}
                          >
                            {formatPct(pnlPct)}
                          </td>
                          <td className="py-3 px-2">{trade.exit_reason}</td>
                          <td className="py-3 px-2 hidden md:table-cell">
                            {trade.entry_time ? formatTime(trade.entry_time) : "-"}
                          </td>
                          <td className="py-3 px-2 hidden lg:table-cell">
                            {trade.exit_time ? formatTime(trade.exit_time) : "-"}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Collapsible Sections */}
          <section className="space-y-2">
            {/* Engine Health - collapsible */}
            <div>
              <button
                onClick={() => setShowEngineHealth(!showEngineHealth)}
                className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              >
                {showEngineHealth ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                Engine Health
              </button>

              {showEngineHealth && (
                <div className="mt-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">State</span>
                      <p className={cn(
                        "font-medium",
                        status.state === "running" ? "text-green-600" : status.state === "paused" ? "text-orange-600" : "text-gray-600"
                      )}>
                        {status.state.toUpperCase()}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500">Uptime</span>
                      <p className="font-medium">{Math.floor(status.uptime_seconds / 60)}m</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Errors</span>
                      <p className={cn("font-medium", status.metrics.errors > 0 ? "text-red-600" : "")}>
                        {status.metrics.errors}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500">Admin Actions</span>
                      <p className="font-medium">{status.metrics.admin_actions}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Broker Details - collapsible, collapsed by default, only for live instances */}
            {isLiveInstance && brokerFunds && !brokerFunds.error && (
              <div>
                <button
                  onClick={() => setShowBrokerDetails(!showBrokerDetails)}
                  className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                >
                  {showBrokerDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  Broker Details (DMAT)
                </button>

                {showBrokerDetails && (
                  <div className="mt-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-gray-500">DMAT Available</span>
                        <p className="font-medium">{formatINR(brokerFunds.available_margin)}</p>
                      </div>
                      <div>
                        <span className="text-gray-500">DMAT Used</span>
                        <p className="font-medium">{formatINR(brokerFunds.used_margin)}</p>
                      </div>
                      <div>
                        <span className="text-gray-500">Net</span>
                        <p className="font-medium">{formatINR(brokerFunds.net)}</p>
                      </div>
                      <div>
                        <span className="text-gray-500">Available Cash</span>
                        <p className="font-medium">{formatINR(brokerFunds.available_cash)}</p>
                      </div>
                    </div>

                    {/* Capital warning - only shown when broker details expanded */}
                    {status.capital &&
                      status.capital.total > brokerFunds.available_margin + brokerFunds.used_margin && (
                        <div className="mt-3 p-2 bg-orange-50 border border-orange-200 rounded text-sm text-orange-700 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4" />
                          Engine capital exceeds DMAT capacity. Orders may be rejected.
                        </div>
                      )}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Last Updated */}
          <p className="text-sm text-gray-500 text-center">
            Last updated: {lastUpdated}
            {autoRefresh && useWebSocket && wsConnected && (
              <span className="ml-2 text-green-600">(real-time)</span>
            )}
          </p>
        </>
      )}
    </div>
  );
}
