import { TtlCache } from "../core/ttl-cache.ts";
import type { ModelTotals, QuotaMetric, QuotaSnapshot, SessionTotals, WindowRange } from "../core/types.ts";
import type { UsageRepository } from "../data/repository.ts";
import { BurnRateProjector } from "./burn-rate.ts";
import type { IncrementalUsageTracker } from "./incremental-tracker.ts";
import type { WindowStrategy } from "./window.ts";

interface QuotaLimits {
  tokens: number;
  cost: number | null;
}

export class QuotaService {
  private readonly modelsCache: TtlCache<number, ModelTotals[]>;
  private readonly topSessionsCache: TtlCache<string, SessionTotals[]>;

  constructor(
    private readonly repository: UsageRepository,
    private readonly window: WindowStrategy,
    private readonly limits: QuotaLimits,
    private readonly metric: QuotaMetric,
    private readonly clock: () => number = Date.now,
    private readonly tracker?: IncrementalUsageTracker,
    private readonly projector: BurnRateProjector = new BurnRateProjector(),
    reportTtlMs = 10_000,
  ) {
    this.modelsCache = new TtlCache<number, ModelTotals[]>(reportTtlMs, this.clock);
    this.topSessionsCache = new TtlCache<string, SessionTotals[]>(reportTtlMs, this.clock);
  }

  range(): WindowRange {
    return this.window.range(this.clock());
  }

  /** One SQL aggregate (or incremental hot-tail query in watch mode), then O(1) arithmetic. */
  snapshot(): QuotaSnapshot {
    const takenAt = this.clock();
    const range = this.window.range(takenAt);
    const totals = this.tracker ? this.tracker.totals(takenAt) : this.repository.usageInRange(range);
    const totalTokens = totals.totalTokens;
    const used = this.metric === "cost" ? totals.cost : totalTokens;
    const limit = this.metric === "cost" ? (this.limits.cost ?? 0) : this.limits.tokens;
    this.projector.record({ timestamp: takenAt, used, windowStart: range.start });
    const { burnRatePerHour, projection } = this.projector.project(limit, range.end, takenAt);

    return {
      source: this.repository.source ?? "opencode",
      costAvailable: this.repository.source !== "codex",
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
      burnRatePerHour,
      projection,
    };
  }

  /** Watch-mode report queries cached by TTL so repeated ticks avoid full-window scans. */
  cachedModels(): ModelTotals[] {
    const { start } = this.range();
    return this.modelsCache.getOrCompute(start, () => this.repository.totalsByModel(start));
  }

  cachedTopSessions(n: number): SessionTotals[] {
    const { start } = this.range();
    return this.topSessionsCache.getOrCompute(`${start}:${n}`, () => this.repository.topSessions(start, n));
  }
}
