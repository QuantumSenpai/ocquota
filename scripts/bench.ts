#!/usr/bin/env bun
/**
 * Benchmark of SqliteUsageRepository.totalsSince against the real OpenCode
 * database, 100 runs after one warm-up, worst case: `from = 0` (every message
 * ever written). Target: average under 10 ms.
 *
 *   bun scripts/bench.ts            (OCQUOTA_DB overrides the database path)
 *
 * Exits 0 on PASS, 1 on FAIL, so it can gate a release.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { SqliteDatabase } from "../src/data/database.ts";
import { SqliteUsageRepository } from "../src/data/sqlite-usage-repository.ts";

const RUNS = 100;
const TARGET_MS = 10;

const dbPath = process.env["OCQUOTA_DB"] ?? join(homedir(), ".local", "share", "opencode", "opencode.db");
const db = new SqliteDatabase(dbPath);
const repository = new SqliteUsageRepository(db);

// Warm-up: compiles the statement and pulls the first pages in.
repository.totalsSince(0);

const samples: number[] = [];
let messages = 0;
for (let run = 0; run < RUNS; run++) {
  const started = performance.now();
  const totals = repository.totalsSince(0);
  samples.push(performance.now() - started);
  messages = totals.messages;
}
db.close();

samples.sort((a, b) => a - b);
const average = samples.reduce((sum, ms) => sum + ms, 0) / samples.length;
const min = samples[0] ?? 0;
const max = samples[samples.length - 1] ?? 0;
const p95 = samples[Math.min(samples.length - 1, Math.ceil(RUNS * 0.95) - 1)] ?? 0;
const passed = average < TARGET_MS;

process.stdout.write(
  [
    `database     ${dbPath}`,
    `scanned      ${messages} assistant messages (totalsSince(0) = all time)`,
    `runs         ${RUNS} after 1 warm-up`,
    `average      ${average.toFixed(3)} ms`,
    `min / p95 / max  ${min.toFixed(3)} / ${p95.toFixed(3)} / ${max.toFixed(3)} ms`,
    passed
      ? `PASS         ${average.toFixed(3)} ms average is under the ${TARGET_MS} ms target`
      : `FAIL         ${average.toFixed(3)} ms average is over the ${TARGET_MS} ms target`,
    "",
  ].join("\n"),
);
process.exit(passed ? 0 : 1);
