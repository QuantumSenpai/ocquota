import { describe, expect, test } from "bun:test";
import { COLORS } from "../src/app.ts";
import { RingBuffer } from "../src/core/ring-buffer.ts";
import { MS_PER_HOUR, MS_PER_MINUTE } from "../src/core/time.ts";
import { createTimeZone } from "../src/core/timezone.ts";
import { TtlCache } from "../src/core/ttl-cache.ts";
import { SqliteUsageRepository } from "../src/data/sqlite-usage-repository.ts";
import { BurnRateProjector } from "../src/domain/burn-rate.ts";
import { IncrementalUsageTracker } from "../src/domain/incremental-tracker.ts";
import { QuotaService } from "../src/domain/quota-service.ts";
import { createWindow } from "../src/domain/window.ts";
import { FullRenderer } from "../src/render/full-renderer.ts";
import { JsonRenderer } from "../src/render/json-renderer.ts";
import { ProgressBar } from "../src/render/progress-bar.ts";
import { WatchLoop } from "../src/render/watch-loop.ts";
import { assistantData, withFixture } from "./helpers/fixture-db.ts";

const T0 = Date.parse("2026-03-05T18:30:00.000Z");

describe("TtlCache", () => {
  test("returns cached entries before expiry and lazily evicts on expiry", () => {
    let now = 1_000;
    let computes = 0;
    const cache = new TtlCache<string, number>(500, () => now);

    expect(cache.getOrCompute("k", () => ++computes)).toBe(1);
    now = 1_499;
    expect(cache.has("k")).toBe(true);
    expect(cache.get("k")).toBe(1);
    expect(cache.getOrCompute("k", () => ++computes)).toBe(1);

    now = 1_500;
    expect(cache.has("k")).toBe(false);
    expect(cache.get("k")).toBeUndefined();
    expect(cache.getOrCompute("k", () => ++computes)).toBe(2);

    cache.set("zero", 99, 0);
    expect(cache.get("zero")).toBeUndefined();
    expect(cache.delete("k")).toBe(true);
    cache.clear();
    expect(cache.get("k")).toBeUndefined();
  });
});

describe("RingBuffer", () => {
  test("wraps around at fixed capacity in O(1) and supports shift/first/last", () => {
    expect(() => new RingBuffer(0)).toThrow(RangeError);
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    expect(buf.toArray()).toEqual([1, 2, 3]);
    expect(buf.first()).toBe(1);
    expect(buf.last()).toBe(3);

    buf.push(4);
    buf.push(5);
    expect(buf.length).toBe(3);
    expect(buf.toArray()).toEqual([3, 4, 5]);
    expect(buf.shift()).toBe(3);
    expect(buf.toArray()).toEqual([4, 5]);
    buf.clear();
    expect(buf.length).toBe(0);
    expect(buf.first()).toBeUndefined();
  });
});

describe("BurnRateProjector & projections", () => {
  test("handles <2 samples, zero rate, negative delta, exhaustion before/after reset, and rollover", () => {
    const projector = new BurnRateProjector(15 * MS_PER_MINUTE, 8);
    const resetAt = T0 + 10 * MS_PER_HOUR;

    // Fewer than 2 samples
    projector.record({ timestamp: T0, used: 100, windowStart: T0 });
    expect(projector.project(1_000, resetAt, T0)).toEqual({ burnRatePerHour: 0, projection: "safe until reset" });

    // Zero rate
    projector.record({ timestamp: T0 + 5 * MS_PER_MINUTE, used: 100, windowStart: T0 });
    expect(projector.project(1_000, resetAt, T0 + 5 * MS_PER_MINUTE)).toEqual({ burnRatePerHour: 0, projection: "safe until reset" });

    // Negative delta
    projector.record({ timestamp: T0 + 10 * MS_PER_MINUTE, used: 80, windowStart: T0 });
    expect(projector.project(1_000, resetAt, T0 + 10 * MS_PER_MINUTE)).toEqual({ burnRatePerHour: 0, projection: "safe until reset" });

    // Positive rate that exhausts before reset: +250 tokens over 15m = 1000/h; 2000 remaining -> ~2 h
    const p2 = new BurnRateProjector(15 * MS_PER_MINUTE, 8);
    p2.record({ timestamp: T0, used: 1_000, windowStart: T0 });
    p2.record({ timestamp: T0 + 15 * MS_PER_MINUTE, used: 1_250, windowStart: T0 });
    const hit = p2.project(3_250, resetAt, T0 + 15 * MS_PER_MINUTE);
    expect(hit.burnRatePerHour).toBeCloseTo(1_000, 6);
    expect(hit.projection).toBe("limit in ~2 h");

    // Positive rate that resets before reaching limit -> safe until reset
    const safe = p2.project(50_000, resetAt, T0 + 15 * MS_PER_MINUTE);
    expect(safe.projection).toBe("safe until reset");

    // Window rollover clears previous samples
    p2.record({ timestamp: resetAt + 1_000, used: 50, windowStart: resetAt });
    expect(p2.project(3_250, resetAt + 24 * MS_PER_HOUR, resetAt + 1_000)).toEqual({ burnRatePerHour: 0, projection: "safe until reset" });
  });

  test("FullRenderer, JsonRenderer, and WatchLoop debug output include new fields cleanly", () => {
    withFixture((fx) => {
      let now = T0 + MS_PER_MINUTE;
      const tz = createTimeZone("Asia/Kolkata");
      const window = createWindow("day", tz);
      const repo = new SqliteUsageRepository(fx.db);
      const tracker = new IncrementalUsageTracker(repo, window, () => now);
      const service = new QuotaService(repo, window, { tokens: 1_100, cost: null }, "tokens", () => now, tracker);

      fx.message({ timeCreated: T0 + 10_000, data: assistantData({ input: 200 }) });
      service.snapshot();
      now = T0 + 16 * MS_PER_MINUTE;
      fx.message({ timeCreated: now - 10_000, data: assistantData({ input: 300 }) });
      const snap = service.snapshot();

      const json = JSON.parse(new JsonRenderer().render(snap)) as Record<string, unknown>;
      expect(json["totalTokens"]).toBe(500);
      expect(json["projection"]).toBe("limit in ~0.5 h");
      expect(typeof json["burnRatePerHour"]).toBe("number");
      expect(service.cachedModels()).toHaveLength(1);
      expect(service.cachedTopSessions(5)).toHaveLength(1);

      const full = new FullRenderer({ bar: new ProgressBar(10), colors: COLORS, timeZone: tz }).render(snap);
      expect(full).toContain("limit in ~0.5 h");

      let written = "";
      const prevWrite = process.stdout.write.bind(process.stdout);
      const prevIsTTY = process.stdout.isTTY;
      process.stdout.isTTY = false;
      process.stdout.write = ((chunk: string | Uint8Array) => {
        written += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
        return true;
      }) as typeof process.stdout.write;
      try {
        new WatchLoop({ render: () => "frame", refreshMs: 250, colors: COLORS, onClose: () => {}, debug: true }).start();
      } finally {
        process.stdout.write = prevWrite;
        process.stdout.isTTY = prevIsTTY;
      }
      expect(written).toMatch(/frame\n.*refresh \d+\.\d{2} ms/);
    });
  });
});
