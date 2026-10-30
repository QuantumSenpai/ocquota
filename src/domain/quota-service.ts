/**
 * QuotaService — the single producer of QuotaSnapshot. One snapshot costs one
 * aggregated SQL query over session_message plus O(1) arithmetic; it never
 * iterates rows and knows nothing about SQL.
 */
import type { QuotaMetric, QuotaSnapshot, WindowRange } from "../core/types.ts";
import type { UsageRepository } from "../data/repository.ts";
import type { WindowStrategy } from "./window.ts";

interface QuotaLimits {
  /** tokens allowed per window; the primary limit when metric === "tokens" */
  tokens: number;
  /** USD allowed per window; the primary limit when metric === "cost" */
  cost: number | null;
}

export class QuotaService {
  constructor(
    private readonly repository: UsageRepository,
    private readonly window: WindowStrategy,
    private readonly limits: QuotaLimits,
    private readonly metric: QuotaMetric,
    private readonly clock: () => number = Date.now,
  ) {}

  /** The quota window right now (`[start, end)`); what a snapshot would cover. */
  range(): WindowRange {
    return this.window.range(this.clock());
  }

  /** O(1) caller-side work: one SQL aggregate for the window, then arithmetic. */
  snapshot(): QuotaSnapshot {
    const takenAt = this.clock();
    const range = this.range();
    const totals = this.repository.usageInRange(range);
    const totalTokens = totals.totalTokens;
    const used = this.metric === "cost" ? totals.cost : totalTokens;
    const limit = this.metric === "cost" ? (this.limits.cost ?? 0) : this.limits.tokens;

    return {
      windowKind: this.window.kind,
      range,
      resetAt: range.end,
      metric: this.metric,
      used,
      limit,
      percent: limit > 0 ? used / limit : 0,
      tokens: totals.tokens,
      totalTokens,
      cost: totals.cost,
      messages: totals.messages,
      sessions: totals.sessions,
      lastActivityAt: totals.lastActivityAt,
      takenAt,
    };
  }
}
