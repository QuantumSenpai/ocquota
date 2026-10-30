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
  sessions: number;
  cost: number;
  tokens: TokenUsage;
  /** newest session_v2.time_updated inside the window, or null when empty */
  lastActivityAt: number | null;
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
  /** tokens the quota counts (input + output + reasoning + cacheWrite) */
  totalTokens: number;
  cost: number;
  sessions: number;
  lastActivityAt: number | null;
  /** epoch ms the snapshot was taken */
  takenAt: number;
}
