/** Read-only usage queries, independent of source storage format. */

import type { DailyBucket, ModelTotals, SessionTotals, Totals, UsageSource, UsageTotals, WindowRange } from "../core/types.ts";
import type { TimeZone } from "../core/time.ts";

export interface QueryPlan {
  name: string;
  lines: string[];
}

export interface UsageRepository {
  readonly source?: UsageSource;

  /** Count usage events in a half-open time range. */
  usageInRange(range: WindowRange): UsageTotals;

  totalsSince(from: number): Totals;

  totalsByModel(from: number): ModelTotals[];

  totalsByModelInRange(range: WindowRange): ModelTotals[];

  sessionIdsInRange(range: WindowRange): string[];

  dailyBuckets(from: number, to: number, timeZone: TimeZone): DailyBucket[];

  topSessions(from: number, n: number): SessionTotals[];

  explainAll(): QueryPlan[];
}
