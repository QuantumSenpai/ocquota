/**
 * Shared vocabulary for every layer: pure types and constant unions only.
 */

/** Quota reset cadence. A new cadence = one WindowStrategy class + one registry entry. */
export type WindowKind = "day" | "week" | "month";

/** What the user's own limit counts. */
export type QuotaMetric = "tokens" | "cost";

export const WINDOW_KINDS: readonly WindowKind[] = ["day", "week", "month"];
export const QUOTA_METRICS: readonly QuotaMetric[] = ["tokens", "cost"];

/** Raw token counters, one per column of session_v2. */
export interface TokenUsage {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Usage for a whole window. Always produced by SQL aggregation, never by JS loops. */
export interface UsageTotals {
  /** assistant messages inside the window */
  messages: number;
  sessions: number;
  cost: number;
  tokens: TokenUsage;
  /** what the quota counts; see withTotalTokens in data/message-paths.ts */
  totalTokens: number;
  /** newest session_message.time_created inside the window, or null when empty */
  lastActivityAt: number | null;
}

/** Aggregate over everything since a timestamp (open-ended upper bound). */
export interface Totals extends UsageTotals {
  from: number;
}

/** Per-model rollup for `totalsByModel`. */
export interface ModelTotals {
  providerId: string;
  modelId: string;
  messages: number;
  cost: number;
  tokens: TokenUsage;
  /** what the quota counts (see countableTokens) */
  totalTokens: number;
}

/** One local-day rollup for `dailyBuckets`. */
export interface DailyBucket {
  /** epoch ms of local midnight starting this bucket */
  dayStart: number;
  messages: number;
  cost: number;
  tokens: TokenUsage;
  totalTokens: number;
}

/** One session row for `topSessions`. */
export interface SessionTotals {
  sessionId: string;
  title: string | null;
  messages: number;
  cost: number;
  tokens: TokenUsage;
  totalTokens: number;
  /** newest message in the window */
  lastActivityAt: number;
}

/** Half-open time interval [start, end) in epoch milliseconds (UTC). */
export interface WindowRange {
  /** inclusive */
  start: number;
  /** exclusive */
  end: number;
}

/** Everything a renderer needs. QuotaService is the only producer. */
export interface QuotaSnapshot {
  windowKind: WindowKind;
  range: WindowRange;
  /** epoch ms at which the window rolls over (== range.end) */
  resetAt: number;
  metric: QuotaMetric;
  /** usage counted against the limit, expressed in `metric` units */
  used: number;
  limit: number;
  /** used/limit, unclamped so an over-quota window is visible */
  percent: number;
  tokens: TokenUsage;
  /** tokens the quota counts (see countableTokens) */
  totalTokens: number;
  cost: number;
  /** assistant messages inside the window */
  messages: number;
  sessions: number;
  lastActivityAt: number | null;
  /** epoch ms the snapshot was taken */
  takenAt: number;
}
