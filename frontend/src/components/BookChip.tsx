"use client";

/**
 * Small chip labelling which overnight tripwire ledger a panel is showing:
 * the real-money live book vs the Rs1L idealized paper mirror.
 */
export function BookChip({ book }: { book: "live" | "paper" }) {
  return book === "live" ? (
    <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 font-medium">
      Live book (real ₹)
    </span>
  ) : (
    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 font-medium">
      Paper book (₹1L idealized)
    </span>
  );
}
