"use client";

import { useState } from "react";
import { useAdmin } from "@/lib/AdminContext";
import {
  InstanceStatus,
  InstancePosition,
  adminSetCapital,
  adminToggleMIS,
  adminExitPosition,
  adminExitAll,
} from "@/lib/api";
import { formatINR } from "@/lib/utils";
import { Key, LogOut, DollarSign, ToggleLeft, ToggleRight, X, AlertTriangle } from "lucide-react";

interface AdminPanelProps {
  instance: string;
  status: InstanceStatus | null;
  positions: InstancePosition[];
  onRefresh: () => void;
}

export function AdminPanel({ instance, status, positions, onRefresh }: AdminPanelProps) {
  const { adminToken, setAdminToken, isAdmin, clearToken } = useAdmin();
  const [tokenInput, setTokenInput] = useState("");
  const [capitalInput, setCapitalInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmExitAll, setConfirmExitAll] = useState(false);

  const showMessage = (msg: string, isError: boolean = false) => {
    if (isError) {
      setError(msg);
      setSuccess(null);
    } else {
      setSuccess(msg);
      setError(null);
    }
    setTimeout(() => {
      setError(null);
      setSuccess(null);
    }, 3000);
  };

  const handleSetToken = () => {
    if (tokenInput.trim()) {
      setAdminToken(tokenInput.trim());
      setTokenInput("");
    }
  };

  const handleSetCapital = async () => {
    if (!adminToken || !capitalInput) return;
    const capital = parseFloat(capitalInput);
    if (isNaN(capital) || capital <= 0) {
      showMessage("Invalid capital amount", true);
      return;
    }

    setLoading(true);
    try {
      const result = await adminSetCapital(instance, capital, adminToken);
      showMessage(`Capital set to ${formatINR(capital)}`);
      setCapitalInput("");
      onRefresh();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Failed to set capital", true);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleMIS = async () => {
    if (!adminToken || !status) return;
    const newValue = !status.capital.mis_enabled;

    setLoading(true);
    try {
      await adminToggleMIS(instance, newValue, adminToken);
      showMessage(`MIS ${newValue ? "enabled" : "disabled"}`);
      onRefresh();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Failed to toggle MIS", true);
    } finally {
      setLoading(false);
    }
  };

  const handleExitPosition = async (symbol: string, qty: number | null = null) => {
    if (!adminToken) return;

    setLoading(true);
    try {
      await adminExitPosition(instance, symbol, qty, adminToken);
      showMessage(`Exit order placed for ${symbol}`);
      onRefresh();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : `Failed to exit ${symbol}`, true);
    } finally {
      setLoading(false);
    }
  };

  const handleExitAll = async () => {
    if (!adminToken) return;

    setLoading(true);
    try {
      const result = await adminExitAll(instance, "manual_exit_all", adminToken);
      showMessage(`Exit all: ${result.exits?.length || 0} positions`);
      setConfirmExitAll(false);
      onRefresh();
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Failed to exit all", true);
    } finally {
      setLoading(false);
    }
  };

  // Not logged in - show token input
  if (!isAdmin) {
    return (
      <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Key className="w-5 h-5 text-yellow-600" />
          <h3 className="font-semibold text-yellow-800 dark:text-yellow-200">Admin Access Required</h3>
        </div>
        <p className="text-sm text-yellow-700 dark:text-yellow-300 mb-3">
          Enter admin token to enable controls for {instance} instance.
        </p>
        <div className="flex gap-2">
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSetToken()}
            placeholder="Admin token"
            className="flex-1 px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700"
          />
          <button
            onClick={handleSetToken}
            className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 text-sm"
          >
            Unlock
          </button>
        </div>
      </div>
    );
  }

  // Admin enabled but instance doesn't support it
  if (status && !status.auth_enabled) {
    return (
      <div className="bg-gray-50 dark:bg-gray-800 border rounded-lg p-4">
        <p className="text-sm text-gray-500">
          Admin controls not enabled for this instance. Start engine with --admin-token flag.
        </p>
        <button
          onClick={clearToken}
          className="mt-2 text-sm text-red-600 hover:underline flex items-center gap-1"
        >
          <LogOut className="w-4 h-4" /> Clear token
        </button>
      </div>
    );
  }

  return (
    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-blue-800 dark:text-blue-200 flex items-center gap-2">
          <Key className="w-5 h-5" /> Admin Controls
        </h3>
        <button
          onClick={clearToken}
          className="text-sm text-gray-500 hover:text-red-600 flex items-center gap-1"
        >
          <LogOut className="w-4 h-4" /> Logout
        </button>
      </div>

      {/* Messages */}
      {error && (
        <div className="bg-red-100 text-red-700 px-3 py-2 rounded text-sm">{error}</div>
      )}
      {success && (
        <div className="bg-green-100 text-green-700 px-3 py-2 rounded text-sm">{success}</div>
      )}

      {/* Capital Control */}
      <div className="flex items-center gap-2">
        <DollarSign className="w-4 h-4 text-blue-600" />
        <input
          type="number"
          value={capitalInput}
          onChange={(e) => setCapitalInput(e.target.value)}
          placeholder="New capital"
          className="w-32 px-2 py-1 border rounded text-sm dark:bg-gray-800 dark:border-gray-700"
        />
        <button
          onClick={handleSetCapital}
          disabled={loading || !capitalInput}
          className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          Set Capital
        </button>
        {status && (
          <span className="text-sm text-gray-500">
            Current: {formatINR(status.capital.total)}
          </span>
        )}
      </div>

      {/* MIS Toggle */}
      <div className="flex items-center gap-2">
        {status?.capital.mis_enabled ? (
          <ToggleRight className="w-5 h-5 text-green-600" />
        ) : (
          <ToggleLeft className="w-5 h-5 text-gray-400" />
        )}
        <button
          onClick={handleToggleMIS}
          disabled={loading}
          className={`px-3 py-1 rounded text-sm ${
            status?.capital.mis_enabled
              ? "bg-green-100 text-green-700 hover:bg-green-200"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          } disabled:opacity-50`}
        >
          MIS: {status?.capital.mis_enabled ? "ON" : "OFF"}
        </button>
        <span className="text-sm text-gray-500">
          {status?.capital.mis_enabled ? "5x leverage active" : "CNC mode"}
        </span>
      </div>

      {/* Exit All */}
      {positions.length > 0 && (
        <div className="pt-2 border-t border-blue-200 dark:border-blue-800">
          {confirmExitAll ? (
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              <span className="text-sm text-red-600">Exit all {positions.length} positions?</span>
              <button
                onClick={handleExitAll}
                disabled={loading}
                className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700 disabled:opacity-50"
              >
                Confirm
              </button>
              <button
                onClick={() => setConfirmExitAll(false)}
                className="px-3 py-1 bg-gray-200 text-gray-700 rounded text-sm hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmExitAll(true)}
              disabled={loading}
              className="px-3 py-1 bg-red-100 text-red-700 rounded text-sm hover:bg-red-200 flex items-center gap-1 disabled:opacity-50"
            >
              <X className="w-4 h-4" /> Exit All Positions
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Separate component for exit button in positions table
export function ExitButton({
  instance,
  symbol,
  qty,
  onSuccess,
}: {
  instance: string;
  symbol: string;
  qty: number;
  onSuccess: () => void;
}) {
  const { adminToken, isAdmin } = useAdmin();
  const [loading, setLoading] = useState(false);
  const [showPartial, setShowPartial] = useState(false);

  if (!isAdmin) return null;

  const handleExit = async (exitQty: number | null) => {
    if (!adminToken) return;
    setLoading(true);
    try {
      await adminExitPosition(instance, symbol, exitQty, adminToken);
      onSuccess();
    } catch (err) {
      console.error("Exit failed:", err);
    } finally {
      setLoading(false);
      setShowPartial(false);
    }
  };

  return (
    <div className="relative">
      {showPartial ? (
        <div className="flex gap-1">
          <button
            onClick={() => handleExit(Math.floor(qty / 2))}
            disabled={loading}
            className="px-2 py-1 text-xs bg-orange-100 text-orange-700 rounded hover:bg-orange-200 disabled:opacity-50"
          >
            50%
          </button>
          <button
            onClick={() => handleExit(null)}
            disabled={loading}
            className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-50"
          >
            Full
          </button>
          <button
            onClick={() => setShowPartial(false)}
            className="px-1 py-1 text-xs text-gray-500 hover:text-gray-700"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowPartial(true)}
          disabled={loading}
          className="px-2 py-1 text-xs bg-red-50 text-red-600 rounded hover:bg-red-100 disabled:opacity-50"
        >
          {loading ? "..." : "Exit"}
        </button>
      )}
    </div>
  );
}
