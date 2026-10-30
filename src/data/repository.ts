/**
 * Read side of the usage data. Implementations aggregate in SQL; callers never
 * see raw rows, and the interface stays free of any SQLite detail.
 */

import type { UsageTotals, WindowRange } from "../core/types.ts";

export interface UsageRepository {
  /**
   * Usage summed over the window's sessions.
   * Cost: O(rows in range) inside one SQL scan + SUM pass; O(1) for the caller.
   */
  usageInRange(range: WindowRange): UsageTotals;

  /**
   * Human-readable EXPLAIN QUERY PLAN lines for the window query, so the plan
   * can be inspected without attaching a debugger.
   */
  explainUsageInRange(): string[];
}
