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
            <th className="py-3 px-2 hidden md:table-cell">Setup</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((pos) => {
            const unrealizedPnl = pos.unrealized_pnl || 0;
            const bookedPnl = pos.booked_pnl || 0;
            const totalPnl = unrealizedPnl + bookedPnl;
            const hasPartialExit = (pos.exited_qty || 0) > 0;
            const remainingQty = pos.remaining_qty || pos.qty;
            const originalQty = pos.qty;

            return (
              <tr key={pos.trade_id} className="border-b hover:bg-gray-50 dark:hover:bg-gray-800">
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
                <td className="py-3 px-2">{formatINR(pos.entry_price)}</td>
                <td className="py-3 px-2">{formatINR(pos.current_price || pos.entry_price)}</td>
                <td className="py-3 px-2">
                  {hasPartialExit ? (
                    <span title={`${remainingQty} remaining of ${originalQty} original`}>
                      <span className="font-medium">{remainingQty}</span>
                      <span className="text-gray-400">/{originalQty}</span>
                    </span>
                  ) : (
                    remainingQty
                  )}
                </td>
                <td className={cn("py-3 px-2", bookedPnl !== 0 ? (bookedPnl >= 0 ? "text-profit" : "text-loss") : "text-gray-400")}>
                  {bookedPnl !== 0 ? formatINR(bookedPnl) : "-"}
                </td>
                <td className={cn("py-3 px-2", unrealizedPnl >= 0 ? "text-profit" : "text-loss")}>
                  {formatINR(unrealizedPnl)}
                </td>
                <td className={cn("py-3 px-2 font-medium", totalPnl >= 0 ? "text-profit" : "text-loss")}>
                  {formatINR(totalPnl)}
                </td>
                <td className="py-3 px-2 hidden md:table-cell">{pos.setup}</td>
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
