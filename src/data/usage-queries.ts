/**
 * The five statements SqliteUsageRepository runs, their params, and the
 * representative params `ocquota explain` uses. Split out so the repository
 * file stays about row -> domain mapping instead of SQL text.
 *
 * All five filter on time_created and are answered by
 * session_message_time_created_idx (EXPLAIN verified; see the repository doc).
 * Every statement that needs `total_tokens` selects the shared aggregates in
 * a subquery and derives the total outside it — see withTotalTokens() in
 * message-paths.ts for why (4 fewer JSON parses per row).
 */

import {
  EXPR_MODEL_ID,
  EXPR_PROVIDER_ID,
  TOTALS_COLUMNS,
  USAGE_ROW_FILTER,
  withTotalTokens,
} from "./message-paths.ts";
import type { SqlParams } from "./database.ts";
import { MS_PER_MINUTE, type OffsetSegment } from "../core/time.ts";

/** Row shape produced by the wrapper (identical for every query). */
export interface TotalsRow {
  messages: number;
  sessions: number;
  cost: number;
  tokens_input: number;
  tokens_output: number;
  tokens_reasoning: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  total_tokens: number;
  last_activity: number | null;
}
export interface ModelRow extends TotalsRow { provider_id: string; model_id: string }
export interface BucketRow extends TotalsRow { day_index: number }
export interface TopRow extends TotalsRow { session_id: string; title: string | null }

/** The shared totals aggregate over `where`; the two ungrouped statements. */
function totalsQuery(where: string): string {
  return withTotalTokens(`
  SELECT
    ${TOTALS_COLUMNS}
  FROM session_message
  WHERE ${where}
    AND ${USAGE_ROW_FILTER}
`);
}

export const USAGE_IN_RANGE_SQL = totalsQuery("time_created >= $from AND time_created < $to");
export const TOTALS_SINCE_SQL = totalsQuery("time_created >= $from");

const MODEL_INNER = `
  SELECT
    ${EXPR_PROVIDER_ID} AS provider_id,
    ${EXPR_MODEL_ID} AS model_id,
    ${TOTALS_COLUMNS}
  FROM session_message
  WHERE time_created >= $from
    AND ${USAGE_ROW_FILTER}
  GROUP BY provider_id, model_id
`;
export const TOTALS_BY_MODEL_SQL = `${withTotalTokens(MODEL_INNER, "provider_id, model_id")}
  ORDER BY total_tokens DESC
`;

/**
 * One bucket per *local* calendar day. `day_index` is the local day number,
 * computed with the offset in force at each row's instant, so the 23-hour
 * spring-forward day and the 25-hour fall-back day bucket correctly. The CASE
 * has one arm per constant-offset segment (see offsetSegments) and collapses
 * to a single expression — the shape ocquota explains — when the range holds
 * no DST change, which is the normal case and all explainAll() ever shows.
 */
export function dailyBucketsSql(segments: readonly OffsetSegment[]): string {
  const arms = segments
    .slice(0, -1)
    .map((_, i) => `    WHEN time_created < $t${i + 1} THEN (time_created + $o${i + 1}) / 86400000`);
  const last = segments.length;
  const dayIndex =
    arms.length === 0
      ? `(time_created + $o${last}) / 86400000`
      : `CASE\n${arms.join("\n")}\n    ELSE (time_created + $o${last}) / 86400000\n  END`;
  const inner = `
  SELECT
    ${dayIndex} AS day_index,
    ${TOTALS_COLUMNS}
  FROM session_message
  WHERE time_created >= $from AND time_created < $to
    AND ${USAGE_ROW_FILTER}
  GROUP BY day_index
`;
  return `${withTotalTokens(inner, "day_index")}
  ORDER BY day_index
`;
}

/**
 * `$o1..$oN` are the per-segment offsets in ms; `$t1..$t(N-1)` are the segment
 * ends. Named parameters only: bun binds positional values by textual
 * placeholder order, and this SQL's placeholders vary with the segment count.
 */
export function dailyParams(from: number, to: number, segments: readonly OffsetSegment[]): SqlParams {
  const params: Record<string, number> = { from, to };
  segments.forEach((segment, index) => {
    params[`o${index + 1}`] = segment.offsetMinutes * MS_PER_MINUTE;
    if (index < segments.length - 1) params[`t${index + 1}`] = segment.end;
  });
  return params;
}

/**
 * Aggregate per session first (indexed range), then attach titles by PK. The
 * unary `+` on session_id stops SQLite from streaming groups off the
 * (session_id, seq) index — without it the planner scans every message ever
 * written; with it the time range is answered by session_message_time_created_idx.
 */
const TOP_SESSIONS_INNER = `
  SELECT
    session_id,
    ${TOTALS_COLUMNS}
  FROM session_message
  WHERE time_created >= $from
    AND ${USAGE_ROW_FILTER}
  GROUP BY +session_id
`;
export const TOP_SESSIONS_SQL = `
  SELECT
    t.*,
    s.title
  FROM (${withTotalTokens(TOP_SESSIONS_INNER, "session_id")}) AS t
  LEFT JOIN session_v2 AS s ON s.id = t.session_id
  ORDER BY t.total_tokens DESC
  LIMIT $n
`;

/** The daily query as ocquota explains it: a range with no DST change. */
const EXPLAIN_SEGMENT: readonly OffsetSegment[] = [{ start: 0, end: 1, offsetMinutes: 0 }];

/** Every statement, with representative params, for `ocquota explain`. */
export const QUERIES: ReadonlyArray<{ name: string; sql: string; params: SqlParams }> = [
  { name: "usageInRange", sql: USAGE_IN_RANGE_SQL, params: { from: 0, to: 1 } },
  { name: "totalsSince", sql: TOTALS_SINCE_SQL, params: { from: 0 } },
  { name: "totalsByModel", sql: TOTALS_BY_MODEL_SQL, params: { from: 0 } },
  { name: "dailyBuckets", sql: dailyBucketsSql(EXPLAIN_SEGMENT), params: { from: 0, to: 1, o1: 0 } },
  { name: "topSessions", sql: TOP_SESSIONS_SQL, params: { from: 0, n: 5 } },
];
