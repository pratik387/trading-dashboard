"use client";

import { cn } from "@/lib/utils";
import { Info } from "lucide-react";

interface MetricCardProps {
  label: string;
  value: string | number;
  subValue?: string;
  delta?: "up" | "down";
  help?: string;
  className?: string;
}

export function MetricCard({ label, value, subValue, delta, help, className }: MetricCardProps) {
  return (
    <div className={cn("bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border", className)}>
      <div className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 mb-1">
        {label}
        {help && (
          <span className="group relative">
            <Info className="w-3 h-3 cursor-help" />
            <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs bg-gray-900 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
              {help}
            </span>
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xl font-semibold">{value}</span>
        {subValue && (
          <span className="text-sm text-gray-500 dark:text-gray-400">({subValue})</span>
        )}
        {delta && (
          <span className={delta === "up" ? "text-profit" : "text-loss"}>
            {delta === "up" ? "↑" : "↓"}
          </span>
        )}
      </div>
    </div>
  );
}
