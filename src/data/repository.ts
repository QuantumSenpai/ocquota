/** Each method executes 1 cached prepared statement using session_message_time_created_idx. */

import type { DailyBucket, ModelTotals, SessionTotals, Totals, UsageTotals, WindowRange } from "../core/types.ts";
import type { TimeZone } from "../core/time.ts";

export interface QueryPlan {
  name: string;
  lines: string[];
}

export interface UsageRepository {
  /** O(rows in range) in SQL, one row returned. */
  usageInRange(range: WindowRange): UsageTotals;

  totalsSince(from: number): Totals;

  totalsByModel(from: number): ModelTotals[];

  totalsByModelInRange(range: WindowRange): ModelTotals[];

  sessionIdsInRange(range: WindowRange): string[];

  dailyBuckets(from: number, to: number, timeZone: TimeZone): DailyBucket[];

  topSessions(from: number, n: number): SessionTotals[];

  explainAll(): QueryPlan[];
}
