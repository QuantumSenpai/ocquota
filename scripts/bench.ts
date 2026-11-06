#!/usr/bin/env bun
/**
 * Benchmark of the two shapes of query ocquota runs, against the real OpenCode
 * database, 100 runs each after one warm-up:
 *
 *   all-time  totalsSince(0)             worst case: every message ever written
 *   window    totalsSince(window start)  what bar / watch / totals actually run
 *
 * Gates leave room for a busy machine but still catch a planner regression:
 * all-time < 30 ms, window < 5 ms.
 *
 *   bun scripts/bench.ts            (OCQUOTA_DB overrides the database path)
 *
 * Exits 0 on PASS, 1 on FAIL, so it can gate a release.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { SqliteDatabase } from "../src/data/database.ts";
import { SqliteUsageRepository } from "../src/data/sqlite-usage-repository.ts";
import { createWindow } from "../src/domain/window.ts";
import { createTimeZone, systemTimeZoneId } from "../src/core/timezone.ts";

const RUNS = 100;

const dbPath = process.env["OCQUOTA_DB"] ?? join(homedir(), ".local", "share", "opencode", "opencode.db");
const db = new SqliteDatabase(dbPath);
const repository = new SqliteUsageRepository(db);

const scenarios = [
  { label: "all-time totalsSince(0)", from: 0, limitMs: 30 },
  { label: "window totalsSince(today)", from: createWindow("day", createTimeZone(systemTimeZoneId())).range(Date.now()).start, limitMs: 5 },
];

let failed = false;
const lines: string[] = [`database     ${dbPath}`, `runs         ${RUNS} each, after 1 warm-up`, ""];

for (const scenario of scenarios) {
  const before = repository.totalsSince(scenario.from).messages;
  const samples: number[] = [];
  for (let run = 0; run < RUNS; run++) {
    const started = performance.now();
    repository.totalsSince(scenario.from);
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  const average = samples.reduce((sum, ms) => sum + ms, 0) / samples.length;
  const min = samples[0] ?? 0;
  const max = samples[samples.length - 1] ?? 0;
  const p95 = samples[Math.min(samples.length - 1, Math.ceil(RUNS * 0.95) - 1)] ?? 0;
  const passed = average < scenario.limitMs;
  failed ||= !passed;
  lines.push(
    `${scenario.label}`,
    `  scanned     ${before} assistant messages`,
    `  average     ${average.toFixed(3)} ms (min ${min.toFixed(3)} / p95 ${p95.toFixed(3)} / max ${max.toFixed(3)})`,
    passed
      ? `  PASS        ${average.toFixed(3)} ms < ${scenario.limitMs} ms target`
      : `  FAIL        ${average.toFixed(3)} ms >= ${scenario.limitMs} ms target`,
    "",
  );
}
db.close();

process.stdout.write(lines.join("\n"));
process.exit(failed ? 1 : 0);
