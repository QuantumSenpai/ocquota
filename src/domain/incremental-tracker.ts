import { clamp } from "../core/format.ts";
import { MS_PER_MINUTE } from "../core/time.ts";
import type { ModelTotals, TokenUsage, UsageTotals, WindowRange } from "../core/types.ts";
import type { UsageRepository } from "../data/repository.ts";
import type { WindowStrategy } from "./window.ts";

export interface IncrementalSnapshot {
  range: WindowRange;
  totals: UsageTotals;
  models: Map<string, ModelTotals>;
  takenAt: number;
}

/**
 * Exact incremental aggregator: caches rows older than `now - graceMs` in a
 * settled base and re-queries only the `[settledUntil, window.end)` hot tail
 * on each refresh, so streaming token updates inside the grace period are never missed.
 */
export class IncrementalUsageTracker {
  private windowRange: WindowRange | null = null;
  private settledUntil = 0;
  private baseTotals: UsageTotals = emptyUsageTotals();
  private readonly baseSessions = new Set<string>();
  private readonly baseModels = new Map<string, ModelTotals>();

  constructor(
    private readonly repository: UsageRepository,
    private readonly window: WindowStrategy,
    private readonly clock: () => number = Date.now,
    private readonly graceMs: number = 10 * MS_PER_MINUTE,
  ) {}

  /** O(rows in hot tail) once the base has settled. */
  totals(nowMs: number = this.clock()): UsageTotals {
    const { tailRange } = this.advanceBase(nowMs);
    if (tailRange.end <= tailRange.start) return this.baseTotals;
    const tailTotals = this.repository.usageInRange(tailRange);
    return this.combineTotals(tailRange, tailTotals);
  }

  models(nowMs: number = this.clock()): Map<string, ModelTotals> {
    const { tailRange } = this.advanceBase(nowMs);
    const merged = cloneModelsMap(this.baseModels);
    if (tailRange.end > tailRange.start) {
      mergeModelsInto(merged, this.repository.totalsByModelInRange(tailRange));
    }
    return merged;
  }

  snapshot(nowMs: number = this.clock()): IncrementalSnapshot {
    const { range, tailRange } = this.advanceBase(nowMs);
    if (tailRange.end <= tailRange.start) {
      return { range, totals: this.baseTotals, models: cloneModelsMap(this.baseModels), takenAt: nowMs };
    }
    const tailTotals = this.repository.usageInRange(tailRange);
    const totals = this.combineTotals(tailRange, tailTotals);
    const models = cloneModelsMap(this.baseModels);
    if (tailTotals.messages > 0) {
      mergeModelsInto(models, this.repository.totalsByModelInRange(tailRange));
    }
    return { range, totals, models, takenAt: nowMs };
  }

  private advanceBase(nowMs: number): { range: WindowRange; tailRange: WindowRange } {
    const range = this.window.range(nowMs);
    const cutoff = clamp(nowMs - this.graceMs, range.start, range.end);
    if (!this.windowRange || this.windowRange.start !== range.start || this.windowRange.end !== range.end || cutoff < this.settledUntil) {
      this.windowRange = range;
      this.settledUntil = range.start;
      this.baseTotals = emptyUsageTotals();
      this.baseSessions.clear();
      this.baseModels.clear();
    }
    if (cutoff > this.settledUntil) {
      const sliceRange: WindowRange = { start: this.settledUntil, end: cutoff };
      const sliceTotals = this.repository.usageInRange(sliceRange);
      if (sliceTotals.messages > 0) {
        for (const id of this.repository.sessionIdsInRange(sliceRange)) this.baseSessions.add(id);
        mergeModelsInto(this.baseModels, this.repository.totalsByModelInRange(sliceRange));
        this.baseTotals = mergeUsageTotals(this.baseTotals, sliceTotals, this.baseSessions.size);
      }
      this.settledUntil = cutoff;
    }
    return { range, tailRange: { start: this.settledUntil, end: range.end } };
  }

  private combineTotals(tailRange: WindowRange, tailTotals: UsageTotals): UsageTotals {
    if (tailTotals.messages === 0) return this.baseTotals;
    if (this.baseTotals.messages === 0) return tailTotals;
    let sessions = this.baseSessions.size;
    for (const id of this.repository.sessionIdsInRange(tailRange)) {
      if (!this.baseSessions.has(id)) sessions += 1;
    }
    return mergeUsageTotals(this.baseTotals, tailTotals, sessions);
  }
}

function emptyUsageTotals(): UsageTotals {
  return { messages: 0, sessions: 0, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, totalTokens: 0, lastActivityAt: null };
}

function addTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}

function mergeUsageTotals(base: UsageTotals, delta: UsageTotals, sessions: number): UsageTotals {
  const lastActivityAt =
    base.lastActivityAt === null ? delta.lastActivityAt : delta.lastActivityAt === null ? base.lastActivityAt : Math.max(base.lastActivityAt, delta.lastActivityAt);
  return {
    messages: base.messages + delta.messages,
    sessions,
    cost: base.cost + delta.cost,
    tokens: addTokens(base.tokens, delta.tokens),
    totalTokens: base.totalTokens + delta.totalTokens,
    lastActivityAt,
  };
}

function cloneModelsMap(source: ReadonlyMap<string, ModelTotals>): Map<string, ModelTotals> {
  const out = new Map<string, ModelTotals>();
  for (const [key, model] of source) out.set(key, { ...model, tokens: { ...model.tokens } });
  return out;
}

function mergeModelsInto(target: Map<string, ModelTotals>, rows: readonly ModelTotals[]): void {
  for (const row of rows) {
    const key = `${row.providerId}/${row.modelId}`;
    const existing = target.get(key);
    if (existing === undefined) {
      target.set(key, { ...row, tokens: { ...row.tokens } });
    } else {
      target.set(key, {
        providerId: row.providerId,
        modelId: row.modelId,
        messages: existing.messages + row.messages,
        cost: existing.cost + row.cost,
        tokens: addTokens(existing.tokens, row.tokens),
        totalTokens: existing.totalTokens + row.totalTokens,
      });
    }
  }
}
