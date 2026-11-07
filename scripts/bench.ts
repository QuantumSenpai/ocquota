#!/usr/bin/env bun
import { homedir } from "node:os";
import { join } from "node:path";
import { formatLocalDate } from "../src/core/format.ts";
import { MS_PER_DAY, nextDayStart, startOfDayOffset } from "../src/core/time.ts";
import { createTimeZone, systemTimeZoneId } from "../src/core/timezone.ts";
import type { UsageTotals, WindowRange } from "../src/core/types.ts";
import { SqliteDatabase } from "../src/data/database.ts";
import { SqliteUsageRepository } from "../src/data/sqlite-usage-repository.ts";
import { IncrementalUsageTracker } from "../src/domain/incremental-tracker.ts";
import type { WindowStrategy } from "../src/domain/window.ts";

const RUNS = 100;
const WATCH_REFRESHES = 50;
/** ~5 ms per 1,000 assistant messages baseline + 50% headroom. */
const LIMIT_MS_PER_1K = 7.5;

const dbPath = process.env["OCQUOTA_DB"] ?? join(homedir(), ".local", "share", "opencode", "opencode.db");
const db = new SqliteDatabase(dbPath);
const repository = new SqliteUsageRepository(db);
const timeZone = createTimeZone(systemTimeZoneId());

const allTime = repository.totalsSince(0);
const anchorMs = allTime.lastActivityAt ?? Date.now();
const buckets = repository.dailyBuckets(startOfDayOffset(timeZone, anchorMs, 365), nextDayStart(timeZone, anchorMs), timeZone);
const busiest = buckets.reduce((best, b) => (b.messages > best.messages ? b : best), buckets[0] ?? { dayStart: startOfDayOffset(timeZone, anchorMs, 0), messages: 0 });
const busiestRange = { start: busiest.dayStart, end: nextDayStart(timeZone, busiest.dayStart) };
const now = Date.now();
const last30Range = { start: now - 30 * MS_PER_DAY, end: now };

const busiestLabel = `busiest local day (${formatLocalDate(busiestRange.start, timeZone)})`;
const scenarios: ReadonlyArray<{ label: string; run: () => UsageTotals }> = [
  { label: "all-time totalsSince(0)", run: () => repository.totalsSince(0) },
  { label: busiestLabel, run: () => repository.usageInRange(busiestRange) },
  { label: "last 30 days", run: () => repository.usageInRange(last30Range) },
];

const fullAvgByLabel = new Map<string, number>();

let failed = false;
const lines: string[] = [
  `database     ${dbPath}`,
  `runs         ${RUNS} each, after 1 warm-up (gate: < ${LIMIT_MS_PER_1K} ms / 1,000 messages, rows > 0)`,
  "",
];

for (const scenario of scenarios) {
  const messages = scenario.run().messages;
  const samples: number[] = [];
  for (let run = 0; run < RUNS; run++) {
    const started = performance.now();
    scenario.run();
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  const average = samples.reduce((sum, ms) => sum + ms, 0) / samples.length;
  fullAvgByLabel.set(scenario.label, average);
  const min = samples[0] ?? 0;
  const max = samples[samples.length - 1] ?? 0;
  const p95 = samples[Math.min(samples.length - 1, Math.ceil(RUNS * 0.95) - 1)] ?? 0;
  const msPer1k = messages > 0 ? (average / messages) * 1_000 : Number.POSITIVE_INFINITY;
  const passed = messages > 0 && msPer1k < LIMIT_MS_PER_1K;
  failed ||= !passed;
  lines.push(
    `${scenario.label} (${messages} assistant messages)`,
    `  rows        ${messages} assistant messages`,
    `  average     ${average.toFixed(3)} ms (min ${min.toFixed(3)} / p95 ${p95.toFixed(3)} / max ${max.toFixed(3)})`,
    `  rate        ${Number.isFinite(msPer1k) ? msPer1k.toFixed(3) : "inf"} ms / 1,000 messages`,
    messages === 0
      ? "  FAIL        window has 0 rows"
      : passed
        ? `  PASS        ${msPer1k.toFixed(3)} ms/1k < ${LIMIT_MS_PER_1K} ms/1k (${messages} messages)`
        : `  FAIL        ${msPer1k.toFixed(3)} ms/1k >= ${LIMIT_MS_PER_1K} ms/1k (${messages} messages)`,
    "",
  );
}

const watchWindows: ReadonlyArray<{ label: string; range: WindowRange }> = [
  { label: busiestLabel, range: busiestRange },
  { label: "last 30 days", range: last30Range },
];

lines.push(`watch refreshes (${WATCH_REFRESHES} incremental refreshes after 1 base-settle warm-up)`, "");

for (const w of watchWindows) {
  const full = repository.usageInRange(w.range);
  const tickNow = (full.lastActivityAt ?? w.range.end - 1) + 1;
  const strategy: WindowStrategy = { kind: "day", label: w.label, range: () => w.range };
  const tracker = new IncrementalUsageTracker(repository, strategy, () => tickNow);
  const warm = tracker.totals(tickNow);
  const samples: number[] = [];
  for (let i = 0; i < WATCH_REFRESHES; i++) {
    const started = performance.now();
    tracker.totals(tickNow);
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  const avgRefreshMs = samples.reduce((sum, ms) => sum + ms, 0) / samples.length;
  const p95RefreshMs = samples[Math.min(samples.length - 1, Math.ceil(WATCH_REFRESHES * 0.95) - 1)] ?? 0;
  const fullMs = fullAvgByLabel.get(w.label) ?? 0;
  const exact = warm.totalTokens === full.totalTokens && warm.messages === full.messages && warm.sessions === full.sessions;
  const passed = full.messages > 0 && exact && avgRefreshMs < fullMs;
  failed ||= !passed;
  lines.push(
    `watch 50x · ${w.label} (${full.messages} assistant messages)`,
    `  full query  ${fullMs.toFixed(3)} ms avg (${full.messages} messages)`,
    `  refresh avg ${avgRefreshMs.toFixed(3)} ms (p95 ${p95RefreshMs.toFixed(3)} ms, ${(fullMs / Math.max(avgRefreshMs, 1e-6)).toFixed(1)}x faster)`,
    passed
      ? `  PASS        incremental ${avgRefreshMs.toFixed(3)} ms < full ${fullMs.toFixed(3)} ms (${full.messages} messages)`
      : `  FAIL        incremental ${avgRefreshMs.toFixed(3)} ms vs full ${fullMs.toFixed(3)} ms (exact=${exact})`,
    "",
  );
}
db.close();

process.stdout.write(lines.join("\n"));
process.exit(failed ? 1 : 0);
