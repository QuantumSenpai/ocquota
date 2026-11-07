/**
 * Reads per-message usage from `session_message` (never `session_v2`, which
 * rolls up entire sessions across window boundaries). All queries use
 * `session_message_time_created_idx` range scans.
 */

import {
  QUERIES,
  SESSION_IDS_IN_RANGE_SQL,
  TOTALS_BY_MODEL_IN_RANGE_SQL,
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
    const row = this.db.get<TotalsRow>(USAGE_IN_RANGE_SQL, { from: range.start, to: range.end });
    return toTotals(row ?? EMPTY_ROW);
  }

  totalsSince(from: number): Totals {
    const row = this.db.get<TotalsRow>(TOTALS_SINCE_SQL, { from });
    return { ...toTotals(row ?? EMPTY_ROW), from };
  }

  totalsByModel(from: number): ModelTotals[] {
    return this.db.all<ModelRow>(TOTALS_BY_MODEL_SQL, { from }).map(toModelTotals);
  }

  totalsByModelInRange(range: WindowRange): ModelTotals[] {
    return this.db.all<ModelRow>(TOTALS_BY_MODEL_IN_RANGE_SQL, { from: range.start, to: range.end }).map(toModelTotals);
  }

  sessionIdsInRange(range: WindowRange): string[] {
    const rows = this.db.all<{ session_id: string }>(SESSION_IDS_IN_RANGE_SQL, { from: range.start, to: range.end });
    return rows.map((row) => row.session_id);
  }

  dailyBuckets(from: number, to: number, timeZone: TimeZone): DailyBucket[] {
    const segments = offsetSegments(timeZone, from, to);
    if (segments.length === 0) return [];
    const rows = this.db.all<BucketRow>(dailyBucketsSql(segments), dailyParams(from, to, segments));
    // earliestInstantAt resolves local midnight safely even if 00:00 falls in a DST gap.
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

function toModelTotals(row: ModelRow): ModelTotals {
  return {
    providerId: row.provider_id,
    modelId: row.model_id,
    messages: row.messages,
    cost: row.cost,
    tokens: toTokenUsage(row),
    totalTokens: row.total_tokens,
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
