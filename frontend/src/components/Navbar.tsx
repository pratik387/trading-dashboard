"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useConfig } from "@/lib/ConfigContext";
import { useAdmin } from "@/lib/AdminContext";
import { TrendingUp, History, Server, Key } from "lucide-react";

const navItems = [
  { href: "/", label: "Live Trading", icon: TrendingUp },
  { href: "/instances", label: "Instances", icon: Server },
  { href: "/historical", label: "Historical", icon: History },
];

export function Navbar() {
  const pathname = usePathname();
  const { configType, setConfigType } = useConfig();
  const { isAdmin } = useAdmin();

  return (
    <nav className="bg-white dark:bg-gray-900 border-b sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-6">
            <Link href="/" className="font-bold text-lg flex items-center gap-2">
              <span className="text-2xl">📊</span>
              <span className="hidden sm:inline">Trading Dashboard</span>
            </Link>

            <div className="flex items-center gap-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                      isActive
                        ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                        : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="hidden sm:inline">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {isAdmin && (
              <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full dark:bg-green-900/30 dark:text-green-400">
                <Key className="w-3 h-3" />
                Admin
              </span>
            )}
            <select
              value={configType}
              onChange={(e) => setConfigType(e.target.value as "fixed" | "relative" | "1year")}
              className="text-sm border rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800"
            >
              <option value="fixed">Fixed (₹1K)</option>
              <option value="relative">Relative (1%)</option>
              <option value="1year">1 Year</option>
            </select>
          </div>
        </div>
      </div>
    </nav>
  );
}
