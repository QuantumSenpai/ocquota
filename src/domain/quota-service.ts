/**
 * QuotaService — the single producer of QuotaSnapshot. One snapshot costs one
 * aggregated SQL query plus O(1) arithmetic; it never iterates rows.
 */

import type { TokenUsage, QuotaMetric, QuotaSnapshot } from "../core/types.ts";
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

  /** O(1) caller-side work: one SQL aggregate for the window, then arithmetic. */
  snapshot(): QuotaSnapshot {
    const takenAt = this.clock();
    const range = this.window.range(takenAt);
    const totals = this.repository.usageInRange(range);
    const totalTokens = countableTokens(totals.tokens);
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
      sessions: totals.sessions,
      lastActivityAt: totals.lastActivityAt,
      takenAt,
    };
  }
}

/**
 * What the token limit counts: everything the model produces plus cache
 * *writes* (providers bill cache writes at input price). Cache *reads* are
 * excluded — in a real DB they dwarf everything else (288M reads vs ~500K
 * other tokens) at a fraction of the price, so counting them would pin the bar
 * at 100% forever.
 */
function countableTokens(tokens: TokenUsage): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cacheWrite;
}
