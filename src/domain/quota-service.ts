import type { QuotaMetric, QuotaSnapshot, WindowRange } from "../core/types.ts";
import type { UsageRepository } from "../data/repository.ts";
import type { WindowStrategy } from "./window.ts";

interface QuotaLimits {
  tokens: number;
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

  range(): WindowRange {
    return this.window.range(this.clock());
  }

  /** O(1) caller-side work: one SQL aggregate for the window, then arithmetic. */
  snapshot(): QuotaSnapshot {
    const takenAt = this.clock();
    const range = this.window.range(takenAt);
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
