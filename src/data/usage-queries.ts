/**
 * The five statements SqliteUsageRepository runs, plus their representative
 * params for `ocquota explain`. Split out so the repository file stays about
 * row -> domain mapping instead of SQL text.
 *
 * All five filter on time_created and are answered by
 * session_message_time_created_idx (EXPLAIN verified; see the repository doc).
 */

import {
  EXPR_COUNTABLE,
  EXPR_MODEL_ID,
  EXPR_PROVIDER_ID,
  TOTALS_COLUMNS,
  USAGE_ROW_FILTER,
} from "./message-paths.ts";
import type { SqlParams } from "./database.ts";

/** Row shape produced by TOTALS_COLUMNS (identical for every query). */
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

export interface ModelRow extends TotalsRow {
  provider_id: string;
  model_id: string;
}

export interface BucketRow extends TotalsRow {
  day_index: number;
}

export interface TopRow extends TotalsRow {
  session_id: string;
  title: string | null;
}

export const USAGE_IN_RANGE_SQL = `
  SELECT
    ${TOTALS_COLUMNS}
  FROM session_message
  WHERE time_created >= $from AND time_created < $to
    AND ${USAGE_ROW_FILTER}
`;

export const TOTALS_SINCE_SQL = `
  SELECT
    ${TOTALS_COLUMNS}
  FROM session_message
  WHERE time_created >= $from
    AND ${USAGE_ROW_FILTER}
`;

export const TOTALS_BY_MODEL_SQL = `
  SELECT
    ${EXPR_PROVIDER_ID} AS provider_id,
    ${EXPR_MODEL_ID} AS model_id,
    ${TOTALS_COLUMNS}
  FROM session_message
  WHERE time_created >= $from
    AND ${USAGE_ROW_FILTER}
  GROUP BY provider_id, model_id
  ORDER BY SUM(${EXPR_COUNTABLE}) DESC
`;

/** `$dayOffset` = local offset in ms, so each bucket is one local calendar day. */
export const DAILY_BUCKETS_SQL = `
  SELECT
    (time_created + $dayOffset) / 86400000 AS day_index,
    ${TOTALS_COLUMNS}
  FROM session_message
  WHERE time_created >= $from AND time_created < $to
    AND ${USAGE_ROW_FILTER}
  GROUP BY day_index
  ORDER BY day_index
`;

/**
 * Aggregate per session first (indexed range), then attach titles by PK.
 * The unary `+` on session_id stops SQLite from streaming groups off the
 * (session_id, seq) index — without it the planner scans every message ever
 * written; with it the time range is answered by session_message_time_created_idx.
 */
export const TOP_SESSIONS_SQL = `
  SELECT
    t.*,
    s.title
  FROM (
    SELECT
      session_id,
      ${TOTALS_COLUMNS}
    FROM session_message
    WHERE time_created >= $from
      AND ${USAGE_ROW_FILTER}
    GROUP BY +session_id
  ) AS t
  LEFT JOIN session_v2 AS s ON s.id = t.session_id
  ORDER BY t.total_tokens DESC
  LIMIT $n
`;

/** Every statement, with representative params, for `ocquota explain`. */
export const QUERIES: ReadonlyArray<{ name: string; sql: string; params: SqlParams }> = [
  { name: "usageInRange", sql: USAGE_IN_RANGE_SQL, params: { from: 0, to: 1 } },
  { name: "totalsSince", sql: TOTALS_SINCE_SQL, params: { from: 0 } },
  { name: "totalsByModel", sql: TOTALS_BY_MODEL_SQL, params: { from: 0 } },
  { name: "dailyBuckets", sql: DAILY_BUCKETS_SQL, params: { from: 0, to: 1, dayOffset: 0 } },
  { name: "topSessions", sql: TOP_SESSIONS_SQL, params: { from: 0, n: 5 } },
];
