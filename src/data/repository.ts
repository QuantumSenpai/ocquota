/**
 * Read side of the usage data. Every method aggregates inside SQL and returns
 * plain domain objects, so QuotaService and the CLI never see SQL, SQL rows or
 * bun:sqlite types.
 *
 * Complexity notes (per call, excluding SQLite's own work):
 *   - every method issues exactly 1 prepared statement, O(1) prepares thanks to
 *     the statement cache in SqliteDatabase;
 *   - SQLite scans the session_message rows inside the time range using
 *     session_message_time_created_idx (verified with EXPLAIN QUERY PLAN) and
 *     folds them into a single row (or a handful of grouped rows), so nothing
 *     crosses the boundary row-by-row.
 */

import type { DailyBucket, ModelTotals, SessionTotals, Totals, UsageTotals, WindowRange } from "../core/types.ts";

/** One query's EXPLAIN QUERY PLAN, by stable name. */
export interface QueryPlan {
  name: string;
  lines: string[];
}

export interface UsageRepository {
  /**
   * Exact per-message usage for sessions active in [range.start, range.end).
   * O(rows in range) in SQL, one row returned.
   */
  usageInRange(range: WindowRange): UsageTotals;

  /** Exact per-message totals for everything with time_created >= from. */
  totalsSince(from: number): Totals;

  /** Exact per-message totals grouped by provider+model since `from`. */
  totalsByModel(from: number): ModelTotals[];

  /**
   * One row per local day between from and to, grouped in SQL.
   * `offsetMinutes` is the caller's zone offset for bucketing local midnights;
   * a zone that changes offset inside this span (DST) buckets by the supplied
   * offset — exact except for messages within the DST delta of a boundary.
   */
  dailyBuckets(from: number, to: number, offsetMinutes: number): DailyBucket[];

  /** The `n` heaviest sessions since `from`, ordered by countable tokens. */
  topSessions(from: number, n: number): SessionTotals[];

  /** EXPLAIN QUERY PLAN for every statement this repository runs. */
  explainAll(): QueryPlan[];
}
