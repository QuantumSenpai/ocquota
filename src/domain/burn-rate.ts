import { RingBuffer } from "../core/ring-buffer.ts";
import { MS_PER_HOUR, MS_PER_MINUTE } from "../core/time.ts";

export interface BurnSample {
  readonly timestamp: number;
  readonly used: number;
  readonly windowStart: number;
}

export interface BurnProjection {
  readonly burnRatePerHour: number;
  readonly projection: string;
}

const SAFE_PROJECTION: BurnProjection = {
  burnRatePerHour: 0,
  projection: "safe until reset",
};

/** Sliding-window burn rate and exhaustion projection with O(1) push and rate. */
export class BurnRateProjector {
  private readonly samples: RingBuffer<BurnSample>;

  constructor(
    private readonly slidingWindowMs: number = 15 * MS_PER_MINUTE,
    capacity = 256,
  ) {
    this.samples = new RingBuffer<BurnSample>(capacity);
  }

  record(sample: BurnSample): void {
    const last = this.samples.last();
    if (last !== undefined && (sample.windowStart !== last.windowStart || sample.timestamp < last.timestamp)) {
      this.samples.clear();
    }
    this.evictOlderThan(sample.timestamp - this.slidingWindowMs);
    this.samples.push(sample);
  }

  ratePerHour(nowMs?: number): number {
    if (nowMs !== undefined) this.evictOlderThan(nowMs - this.slidingWindowMs);
    if (this.samples.length < 2) return 0;
    const first = this.samples.first();
    const last = this.samples.last();
    if (first === undefined || last === undefined) return 0;
    const elapsedMs = last.timestamp - first.timestamp;
    const delta = last.used - first.used;
    if (elapsedMs <= 0 || delta <= 0) return 0;
    return (delta / elapsedMs) * MS_PER_HOUR;
  }

  project(limit: number, resetAt: number, nowMs?: number): BurnProjection {
    const burnRatePerHour = this.ratePerHour(nowMs);
    const last = this.samples.last();
    if (burnRatePerHour <= 0 || limit <= 0 || last === undefined) return SAFE_PROJECTION;

    const remaining = Math.max(0, limit - last.used);
    const hoursToLimit = remaining / burnRatePerHour;
    const msToLimit = hoursToLimit * MS_PER_HOUR;
    const now = nowMs ?? last.timestamp;
    if (msToLimit > Math.max(0, resetAt - now)) {
      return { burnRatePerHour, projection: "safe until reset" };
    }
    return {
      burnRatePerHour,
      projection: `limit in ~${formatHours(hoursToLimit)} h`,
    };
  }

  private evictOlderThan(cutoffMs: number): void {
    while (this.samples.length > 0) {
      const oldest = this.samples.first();
      if (oldest === undefined || oldest.timestamp >= cutoffMs) break;
      this.samples.shift();
    }
  }
}

function formatHours(hours: number): string {
  if (hours <= 0) return "0";
  if (hours < 0.1) return "0.1";
  return hours.toFixed(1).replace(/\.0$/, "");
}
