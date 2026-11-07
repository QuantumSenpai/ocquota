import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { MS_PER_DAY, MS_PER_MINUTE, nextDayStart, startOfDayOffset } from "../src/core/time.ts";
import { createTimeZone } from "../src/core/timezone.ts";
import type { ModelTotals, WindowRange } from "../src/core/types.ts";
import { SqliteDatabase } from "../src/data/database.ts";
import { SqliteUsageRepository } from "../src/data/sqlite-usage-repository.ts";
import { IncrementalUsageTracker } from "../src/domain/incremental-tracker.ts";
import { createWindow, type WindowStrategy } from "../src/domain/window.ts";
import { assistantData, withFixture } from "./helpers/fixture-db.ts";

const T0 = Date.parse("2026-03-05T18:30:00.000Z"); // 2026-03-06 00:00 IST

function toModelMap(rows: readonly ModelTotals[]): Map<string, ModelTotals> {
  return new Map(rows.map((row) => [`${row.providerId}/${row.modelId}`, row]));
}

function assertMatchesFullRecompute(
  tracker: IncrementalUsageTracker,
  repo: SqliteUsageRepository,
  window: WindowStrategy,
  nowMs: number,
): void {
  const range = window.range(nowMs);
  const fullTotals = repo.usageInRange(range);
  const fullModels = toModelMap(repo.totalsByModelInRange(range));
  const snap = tracker.snapshot(nowMs);

  expect(snap.totals).toEqual(fullTotals);
  expect(tracker.totals(nowMs)).toEqual(fullTotals);
  expect(snap.models).toEqual(fullModels);
  expect(tracker.models(nowMs)).toEqual(fullModels);
}

describe("IncrementalUsageTracker · fixture with fake clock", () => {
  test("insert, UPDATE streaming message tokens, settle past grace, and roll window", () => {
    withFixture((fx) => {
      const repo = new SqliteUsageRepository(fx.db);
      const tz = createTimeZone("Asia/Kolkata");
      const window = createWindow("day", tz);
      let now = T0 + 2 * MS_PER_MINUTE;
      const tracker = new IncrementalUsageTracker(repo, window, () => now, 10 * MS_PER_MINUTE);

      // Step 1: initial messages inside the hot tail across 2 sessions and 2 models.
      fx.message({
        sessionId: "ses_1",
        timeCreated: T0 + 30_000,
        data: assistantData({ input: 100, output: 40, cost: 0.05, providerId: "anthropic", modelId: "claude-sonnet" }),
      });
      fx.message({
        sessionId: "ses_2",
        timeCreated: T0 + 60_000,
        data: assistantData({ input: 200, reasoning: 50, cacheWrite: 10, cost: 0.25, providerId: "openai", modelId: "gpt-5" }),
      });
      assertMatchesFullRecompute(tracker, repo, window, now);

      // Step 2: advance clock to +20m so initial messages settle into base; insert streaming message in ses_1.
      now = T0 + 20 * MS_PER_MINUTE;
      const streamingId = fx.message({
        sessionId: "ses_1",
        timeCreated: now - 2 * MS_PER_MINUTE,
        timeUpdated: now - 2 * MS_PER_MINUTE,
        data: assistantData({ input: 50, output: 10, cost: 0.01, providerId: "anthropic", modelId: "claude-sonnet" }),
      });
      assertMatchesFullRecompute(tracker, repo, window, now);

      // Step 3: UPDATE token values of the recent streaming message before grace expires.
      now = T0 + 23 * MS_PER_MINUTE;
      fx.updateMessage(
        streamingId,
        assistantData({ input: 500, output: 220, reasoning: 30, cacheRead: 900, cacheWrite: 15, cost: 0.42, providerId: "anthropic", modelId: "claude-sonnet" }),
        now,
      );
      assertMatchesFullRecompute(tracker, repo, window, now);

      // Step 4: advance clock past grace (+35m) so updated message folds into settled base; add ses_3 in tail.
      now = T0 + 35 * MS_PER_MINUTE;
      fx.message({
        sessionId: "ses_3",
        timeCreated: now - MS_PER_MINUTE,
        data: assistantData({ input: 80, output: 20, cost: 0.03, providerId: "google", modelId: "gemini-pro" }),
      });
      assertMatchesFullRecompute(tracker, repo, window, now);

      // Step 5: roll over local midnight into the next day window.
      now = T0 + MS_PER_DAY + 5 * MS_PER_MINUTE;
      assertMatchesFullRecompute(tracker, repo, window, now);
      expect(tracker.totals(now).messages).toBe(0);

      fx.message({
        sessionId: "ses_1",
        timeCreated: now - MS_PER_MINUTE,
        data: assistantData({ input: 300, output: 100, cost: 0.15, providerId: "anthropic", modelId: "claude-sonnet" }),
      });
      assertMatchesFullRecompute(tracker, repo, window, now);
    });
  });
});

describe("IncrementalUsageTracker · real DB snapshot comparison", () => {
  test("matches full recompute across busiest day and last 30 days on snapshot", () => {
    const candidate = process.env["OCQUOTA_DB"] ?? (existsSync("/tmp/frozen.db") ? "/tmp/frozen.db" : join(homedir(), ".local", "share", "opencode", "opencode.db"));
    if (!existsSync(candidate)) return;

    const db = new SqliteDatabase(candidate);
    try {
      const repo = new SqliteUsageRepository(db);
      const tz = createTimeZone("Asia/Kolkata");
      const allTime = repo.totalsSince(0);
      if (allTime.messages === 0 || allTime.lastActivityAt === null) return;

      const anchor = allTime.lastActivityAt;
      const buckets = repo.dailyBuckets(startOfDayOffset(tz, anchor, 365), nextDayStart(tz, anchor), tz);
      const busiest = buckets.reduce((best, b) => (b.messages > best.messages ? b : best), buckets[0]!);
      const busiestRange: WindowRange = { start: busiest.dayStart, end: nextDayStart(tz, busiest.dayStart) };
      const busiestLast = repo.usageInRange(busiestRange).lastActivityAt ?? busiestRange.end - 1;

      const dayWindow = createWindow("day", tz);
      let now = busiestRange.start + 60 * MS_PER_MINUTE;
      const dayTracker = new IncrementalUsageTracker(repo, dayWindow, () => now);
      for (const tick of [
        busiestRange.start + 60 * MS_PER_MINUTE,
        busiestRange.start + 6 * 60 * MS_PER_MINUTE,
        busiestLast - 5 * MS_PER_MINUTE,
        busiestLast + 1,
        busiestRange.end - 1,
      ]) {
        now = tick;
        assertMatchesFullRecompute(dayTracker, repo, dayWindow, now);
      }

      const last30Range: WindowRange = { start: anchor - 30 * MS_PER_DAY, end: anchor + 1 };
      const fixed30Window: WindowStrategy = { kind: "month", label: "30d", range: () => last30Range };
      const monthTracker = new IncrementalUsageTracker(repo, fixed30Window, () => anchor + 1);
      assertMatchesFullRecompute(monthTracker, repo, fixed30Window, anchor + 1);
    } finally {
      db.close();
    }
  });
});
