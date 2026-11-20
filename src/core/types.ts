export type WindowKind = "day" | "week" | "month";

export type QuotaMetric = "tokens" | "cost";
export const USAGE_SOURCES = ["opencode", "codex"] as const;
export type UsageSource = (typeof USAGE_SOURCES)[number];

import { WORKSPACE_THEMES } from "./themes.ts";
export const THEME_NAMES = [...WORKSPACE_THEMES, "raw"] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

export const WINDOW_KINDS: readonly WindowKind[] = ["day", "week", "month"];
export const QUOTA_METRICS: readonly QuotaMetric[] = ["tokens", "cost"];

export interface TokenUsage {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface UsageTotals {
  messages: number;
  sessions: number;
  cost: number;
  tokens: TokenUsage;
  totalTokens: number;
  lastActivityAt: number | null;
}

export interface Totals extends UsageTotals {
  from: number;
}

export interface ModelTotals {
  providerId: string;
  modelId: string;
  messages: number;
  cost: number;
  tokens: TokenUsage;
  totalTokens: number;
}

export interface DailyBucket {
  dayStart: number;
  messages: number;
  cost: number;
  tokens: TokenUsage;
  totalTokens: number;
}

export interface SessionTotals {
  sessionId: string;
  title: string | null;
  messages: number;
  cost: number;
  tokens: TokenUsage;
  totalTokens: number;
  lastActivityAt: number;
}

/** Half-open time interval [start, end) in UTC ms. */
export interface WindowRange {
  start: number;
  end: number;
}

export interface QuotaSnapshot {
  source?: UsageSource;
  costAvailable?: boolean;
  windowKind: WindowKind;
  range: WindowRange;
  resetAt: number;
  metric: QuotaMetric;
  used: number;
  limit: number;
  percent: number;
  tokens: TokenUsage;
  totalTokens: number;
  cost: number;
  messages: number;
  sessions: number;
  lastActivityAt: number | null;
  takenAt: number;
  burnRatePerHour: number;
  projection: string;
}
