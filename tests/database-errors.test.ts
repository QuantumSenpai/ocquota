import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COLORS } from "../src/app.ts";
import { ConfigStore } from "../src/config/config-store.ts";
import { parseCliOverrides, parseEnvOverrides } from "../src/config/overrides.ts";
import { ConfigError, DatabaseError } from "../src/core/errors.ts";
import { SqliteDatabase } from "../src/data/database.ts";
import { SqliteUsageRepository } from "../src/data/sqlite-usage-repository.ts";
import { WatchLoop } from "../src/render/watch-loop.ts";
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

describe("config & watch cleanup edge cases", () => {
  test("numeric-coerced CLI flags and whitespace-only values fail with ConfigError", () => {
    const dir = mkdtempSync(join(tmpdir(), "ocquota-cfg-"));
    try {
      const configPath = join(dir, "config.json");
      const store = new ConfigStore({ configPath, env: {} });
      expect(() => store.load({ timezone: 500 as unknown as string })).toThrow(ConfigError);
      expect(() => parseCliOverrides({ limitCost: "   " })).toThrow(ConfigError);
      expect(() => parseEnvOverrides({ OCQUOTA_LIMIT_COST: "   " })).toThrow(ConfigError);
      writeFileSync(configPath, JSON.stringify({ dbPath: "   " }));
      expect(() => store.load()).toThrow(ConfigError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("WatchLoop closes the resource in non-TTY mode even when render throws", () => {
    const prevIsTTY = process.stdout.isTTY;
    process.stdout.isTTY = false;
    let closed = false;
    try {
      const loop = new WatchLoop({
        render: () => {
          throw new Error("boom");
        },
        refreshMs: 1_000,
        colors: COLORS,
        onClose: () => {
          closed = true;
        },
      });
      expect(() => loop.start()).toThrow("boom");
      expect(closed).toBe(true);
    } finally {
      process.stdout.isTTY = prevIsTTY;
    }
  });

  test("CLI catches CACError with a friendly one-line message and Run ocquota --help", () => {
    for (const args of [["unknown-cmd"], ["--unknown-flag"], ["--limit"]]) {
      const proc = Bun.spawnSync(["bun", "src/cli.ts", ...args], {
        env: { ...process.env, OCQUOTA_DEBUG: "" },
        stderr: "pipe",
      });
      const stderr = new TextDecoder().decode(proc.stderr).trim();
      expect(proc.exitCode).toBe(1);
      expect(stderr.split("\n")).toHaveLength(1);
      expect(stderr).toMatch(/^ocquota: .+ Run ocquota --help$/);
    }
  });
});
