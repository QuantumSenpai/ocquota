/**
 * Failure modes the CLI must survive with a friendly error, plus the read-only
 * guarantee: ocquota must never modify OpenCode's database file.
 *
 *   bun test
 */

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseError } from "../src/core/errors.ts";
import { SqliteDatabase } from "../src/data/database.ts";
import { SqliteUsageRepository } from "../src/data/sqlite-usage-repository.ts";
import { assistantData, withFixture } from "./helpers/fixture-db.ts";

const code = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return error instanceof DatabaseError ? error.code : `unexpected: ${String(error)}`;
  }
  return "no error thrown";
};

describe("database open failures", () => {
  test("a missing file fails with DB_OPEN_FAILED and a fix, not a stack trace", () => {
    const dir = mkdtempSync(join(tmpdir(), "ocquota-missing-"));
    try {
      const error = code(() => new SqliteDatabase(join(dir, "nope.db")));
      expect(error).toBe("DB_OPEN_FAILED");
      expect(() => new SqliteDatabase(join(dir, "nope.db"))).toThrow(/Is OpenCode installed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a database from another schema version fails with DB_SCHEMA_MISSING", () => {
    // Same file shape, none of ocquota's tables: what a future OpenCode
    // migration would look like from our side.
    withFixture((fixture) => {
      const repository = new SqliteUsageRepository(fixture.db);
      expect(code(() => repository.usageInRange({ start: 0, end: 1 }))).toBe("DB_SCHEMA_MISSING");
      expect(() => repository.totalsSince(0)).toThrow(/different OpenCode version/);
    }, "CREATE TABLE unrelated (id TEXT PRIMARY KEY, payload TEXT)");
  });
});

describe("read-only guarantee", () => {
  test("every query leaves the database file byte-identical and creates no journal", () => {
    withFixture((fixture) => {
      fixture.session("ses_1", "Session");
      fixture.message({ data: assistantData({ input: 5, output: 1 }), timeCreated: Date.parse("2026-03-06T18:30:00Z") });
      const repository = new SqliteUsageRepository(fixture.db);
      const before = createHash("sha256").update(readFileSync(fixture.path)).digest("hex");

      repository.usageInRange({ start: 0, end: 4e12 });
      repository.totalsSince(0);
      repository.totalsByModel(0);
      repository.topSessions(0, 5);
      repository.explainAll();

      const after = createHash("sha256").update(readFileSync(fixture.path)).digest("hex");
      expect(after).toBe(before);
      const siblings = readdirSync(join(fixture.path, ".."));
      expect(siblings.filter((name) => name.endsWith("-wal") || name.endsWith("-journal"))).toEqual([]);
    });
  });
});
