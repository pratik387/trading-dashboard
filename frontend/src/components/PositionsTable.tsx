"use client";

import { cn, formatINR, formatPct, formatTime } from "@/lib/utils";
import { Position, ClosedPosition } from "@/lib/api";

interface OpenPositionsTableProps {
  positions: Position[];
}

export function OpenPositionsTable({ positions }: OpenPositionsTableProps) {
  if (positions.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No open positions currently
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="py-3 px-2">Symbol</th>
            <th className="py-3 px-2">Side</th>
            <th className="py-3 px-2">Entry</th>
            <th className="py-3 px-2">Current</th>
            <th className="py-3 px-2">Qty</th>
            <th className="py-3 px-2">Unrealized PnL</th>
            <th className="py-3 px-2">PnL %</th>
            <th className="py-3 px-2 hidden md:table-cell">Setup</th>
            <th className="py-3 px-2 hidden lg:table-cell">Entry Time</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((pos) => {
            const pnl = pos.unrealized_pnl || 0;
            const pnlPct = pos.price_change_pct || 0;
            const adjustedPnlPct = pos.side === "SELL" ? -pnlPct : pnlPct;

            return (
              <tr key={pos.trade_id} className="border-b hover:bg-gray-50 dark:hover:bg-gray-800">
                <td className="py-3 px-2 font-medium">{pos.symbol}</td>
                <td className="py-3 px-2">
                  <span className={cn(
                    "px-2 py-1 rounded text-xs font-medium",
                    pos.side === "SELL" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
                  )}>
                    {pos.side === "SELL" ? "SHORT" : "LONG"}
                  </span>
                </td>
                <td className="py-3 px-2">{formatINR(pos.entry_price)}</td>
                <td className="py-3 px-2">{formatINR(pos.current_price || pos.entry_price)}</td>
                <td className="py-3 px-2">{pos.remaining_qty || pos.qty}</td>
                <td className={cn("py-3 px-2 font-medium", pnl >= 0 ? "text-profit" : "text-loss")}>
                  {formatINR(pnl)}
                </td>
                <td className={cn("py-3 px-2", adjustedPnlPct >= 0 ? "text-profit" : "text-loss")}>
                  {formatPct(adjustedPnlPct)}
                </td>
                <td className="py-3 px-2 hidden md:table-cell">{pos.setup}</td>
                <td className="py-3 px-2 hidden lg:table-cell">{formatTime(pos.entry_time)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface ClosedPositionsTableProps {
  positions: ClosedPosition[];
}

export function ClosedPositionsTable({ positions }: ClosedPositionsTableProps) {
  if (positions.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No closed positions today
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="py-3 px-2">Symbol</th>
            <th className="py-3 px-2">Side</th>
            <th className="py-3 px-2">Entry</th>
            <th className="py-3 px-2">Exit</th>
            <th className="py-3 px-2">Qty</th>
            <th className="py-3 px-2">PnL</th>
            <th className="py-3 px-2">PnL %</th>
            <th className="py-3 px-2 hidden md:table-cell">Reason</th>
            <th className="py-3 px-2 hidden lg:table-cell">Exit Time</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((pos) => {
            const positionCost = pos.entry_price * pos.qty;
            const pnlPct = positionCost > 0 ? (pos.pnl / positionCost) * 100 : 0;

            return (
              <tr key={pos.trade_id} className="border-b hover:bg-gray-50 dark:hover:bg-gray-800">
                <td className="py-3 px-2 font-medium">{pos.symbol}</td>
                <td className="py-3 px-2">
                  <span className={cn(
                    "px-2 py-1 rounded text-xs font-medium",
                    pos.side === "SELL" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
                  )}>
                    {pos.side === "SELL" ? "SHORT" : "LONG"}
                  </span>
                </td>
                <td className="py-3 px-2">{formatINR(pos.entry_price)}</td>
                <td className="py-3 px-2">{formatINR(pos.exit_price)}</td>
                <td className="py-3 px-2">{pos.qty}</td>
                <td className={cn("py-3 px-2 font-medium", pos.pnl >= 0 ? "text-profit" : "text-loss")}>
                  {formatINR(pos.pnl)}
                </td>
                <td className={cn("py-3 px-2", pnlPct >= 0 ? "text-profit" : "text-loss")}>
                  {formatPct(pnlPct)}
                </td>
                <td className="py-3 px-2 hidden md:table-cell">{pos.exit_reason}</td>
                <td className="py-3 px-2 hidden lg:table-cell">{formatTime(pos.exit_time)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
