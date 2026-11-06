/**
 * SqliteUsageRepository — the only place that knows OpenCode's schema, and the
 * only place that turns SQL rows into domain objects (the SQL text itself
 * lives in usage-queries.ts). Per-message usage comes from session_message
 * (json paths documented in message-paths.ts), never from the per-session
 * rollup in session_v2, which counts a whole session's tokens even when the
 * session started days before the window.
 *
 * EXPLAIN QUERY PLAN against the real DB, verified for all five statements
 * (`ocquota explain` prints them live):
 *
 *   usageInRange / totalsSince / totalsByModel / dailyBuckets / topSessions
 *     `-- SEARCH session_message USING INDEX session_message_time_created_idx
 *          (time_created>? [AND time_created<?])
 *     `-- USE TEMP B-TREE FOR GROUP BY        (only for the grouped queries)
 *
 * The time range is an index range-SCAN (SEARCH), not a table SCAN; the temp
 * B-tree sorts at most one row per group (day / model / session), not per row.
 * json_valid(data) in USAGE_ROW_FILTER is the single malformed-JSON guard.
 *
 * Every statement is compiled once and cached by SqliteDatabase, so repeat
 * calls cost only execution (see scripts/bench.ts: totalsSince(0) averages
 * well under the 10 ms target on the real DB).
 */

import {
  QUERIES,
  TOTALS_BY_MODEL_SQL,
  TOTALS_SINCE_SQL,
  TOP_SESSIONS_SQL,
  USAGE_IN_RANGE_SQL,
  dailyBucketsSql,
  dailyParams,
  type BucketRow,
  type ModelRow,
  type TopRow,
  type TotalsRow,
} from "./usage-queries.ts";
import type { DatabaseConnection } from "./database.ts";
import type { QueryPlan, UsageRepository } from "./repository.ts";
import { MS_PER_DAY, offsetSegments, type TimeZone } from "../core/time.ts";
import type {
  DailyBucket,
  ModelTotals,
  SessionTotals,
  TokenUsage,
  Totals,
  UsageTotals,
  WindowRange,
} from "../core/types.ts";

export class SqliteUsageRepository implements UsageRepository {
  constructor(private readonly db: DatabaseConnection) {}

  usageInRange(range: WindowRange): UsageTotals {
    // The aggregate always yields exactly one row, even for an empty window.
    const row = this.db.get<TotalsRow>(USAGE_IN_RANGE_SQL, { from: range.start, to: range.end });
    return toTotals(row ?? EMPTY_ROW);
  }

  totalsSince(from: number): Totals {
    const row = this.db.get<TotalsRow>(TOTALS_SINCE_SQL, { from });
    return { ...toTotals(row ?? EMPTY_ROW), from };
  }

  totalsByModel(from: number): ModelTotals[] {
    const rows = this.db.all<ModelRow>(TOTALS_BY_MODEL_SQL, { from });
    return rows.map((row) => ({
      providerId: row.provider_id,
      modelId: row.model_id,
      messages: row.messages,
      cost: row.cost,
      tokens: toTokenUsage(row),
      totalTokens: row.total_tokens,
    }));
  }

  dailyBuckets(from: number, to: number, timeZone: TimeZone): DailyBucket[] {
    const segments = offsetSegments(timeZone, from, to);
    if (segments.length === 0) return [];
    const rows = this.db.all<BucketRow>(dailyBucketsSql(segments), dailyParams(from, to, segments));
    // day_index counts local calendar days since the epoch; the UTC instant of
    // that local midnight is its first representable instant (DST-gap safe).
    return rows.map((row) => ({
      dayStart: timeZone.earliestInstantAt(row.day_index * MS_PER_DAY),
      messages: row.messages,
      cost: row.cost,
      tokens: toTokenUsage(row),
      totalTokens: row.total_tokens,
    }));
  }

  topSessions(from: number, n: number): SessionTotals[] {
    const rows = this.db.all<TopRow>(TOP_SESSIONS_SQL, { from, n: Math.max(0, Math.trunc(n)) });
    return rows.map((row) => ({
      sessionId: row.session_id,
      title: row.title,
      messages: row.messages,
      cost: row.cost,
      tokens: toTokenUsage(row),
      totalTokens: row.total_tokens,
      lastActivityAt: row.last_activity ?? 0,
    }));
  }

  explainAll(): QueryPlan[] {
    return QUERIES.map((query) => ({ name: query.name, lines: this.db.explain(query.sql, query.params) }));
  }
}

/** Fallback for a driver that returns no row: an all-zero window. */
const EMPTY_ROW: TotalsRow = {
  messages: 0,
  sessions: 0,
  cost: 0,
  tokens_input: 0,
  tokens_output: 0,
  tokens_reasoning: 0,
  tokens_cache_read: 0,
  tokens_cache_write: 0,
  total_tokens: 0,
  last_activity: null,
};

function toTokenUsage(row: TotalsRow): TokenUsage {
  return {
    input: row.tokens_input,
    output: row.tokens_output,
    reasoning: row.tokens_reasoning,
    cacheRead: row.tokens_cache_read,
    cacheWrite: row.tokens_cache_write,
  };
}

function toTotals(row: TotalsRow): UsageTotals {
  return {
    messages: row.messages,
    sessions: row.sessions,
    cost: row.cost,
    tokens: toTokenUsage(row),
    totalTokens: row.total_tokens,
    lastActivityAt: row.last_activity,
  };
}
