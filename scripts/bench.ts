#!/usr/bin/env bun
import { homedir } from "node:os";
import { join } from "node:path";
import { formatLocalDate } from "../src/core/format.ts";
import { MS_PER_DAY, nextDayStart, startOfDayOffset } from "../src/core/time.ts";
import { createTimeZone, systemTimeZoneId } from "../src/core/timezone.ts";
import type { UsageTotals } from "../src/core/types.ts";
import { SqliteDatabase } from "../src/data/database.ts";
import { SqliteUsageRepository } from "../src/data/sqlite-usage-repository.ts";

const RUNS = 100;
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

const scenarios: ReadonlyArray<{ label: string; run: () => UsageTotals }> = [
  { label: "all-time totalsSince(0)", run: () => repository.totalsSince(0) },
  { label: `busiest local day (${formatLocalDate(busiestRange.start, timeZone)})`, run: () => repository.usageInRange(busiestRange) },
  { label: "last 30 days", run: () => repository.usageInRange(last30Range) },
];

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
db.close();

process.stdout.write(lines.join("\n"));
process.exit(failed ? 1 : 0);
