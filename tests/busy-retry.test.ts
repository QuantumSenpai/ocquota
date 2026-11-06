import { describe, expect, test } from "bun:test";
import { DatabaseError } from "../src/core/errors.ts";
import { SqliteUsageRepository } from "../src/data/sqlite-usage-repository.ts";
import { assistantData, withFixture, Fixture } from "./helpers/fixture-db.ts";

const LOCKER = `
  const { Database } = await import("bun:sqlite");
  const db = new Database(process.env.OCQUOTA_LOCK_DB);
  db.exec("PRAGMA busy_timeout = 0");
  db.exec("BEGIN EXCLUSIVE");
  db.prepare("INSERT INTO session_v2 VALUES ('ses_lock', 'locked')").run();
  process.stdout.write("LOCKED\\n");
  await Bun.sleep(Number(process.env.OCQUOTA_LOCK_MS));
  db.exec("ROLLBACK");
  db.close();
`;

describe("SQLITE_BUSY", () => {
  test("a lock that outlives busy_timeout is retried, then the query succeeds", async () => {
    const fixture = new Fixture();
    try {
      fixture.message({ data: assistantData({ input: 7 }), timeCreated: 1_700_000_000_000 });
      const locker = Bun.spawn(["bun", "-e", LOCKER], {
        env: { ...process.env, OCQUOTA_LOCK_DB: fixture.path, OCQUOTA_LOCK_MS: "400" },
        stdout: "pipe",
      });
      const decoder = new TextDecoder();
      let output = "";
      for await (const chunk of locker.stdout) {
        output += decoder.decode(chunk);
        if (output.includes("LOCKED")) break;
      }

      const started = performance.now();
      const totals = new SqliteUsageRepository(fixture.db).totalsSince(0);
      const elapsed = performance.now() - started;
      await locker.exited;

      expect(totals.totalTokens).toBe(7);
      expect(elapsed).toBeGreaterThanOrEqual(250);
      expect(elapsed).toBeLessThan(3_000);
    } finally {
      fixture.close();
    }
  });

  test("a lock held past every retry fails with DB_BUSY, and reads recover afterwards", () => {
    withFixture((fixture) => {
      fixture.message({ data: assistantData({ input: 7 }), timeCreated: 1_700_000_000_000 });
      const locker = fixture.lockConnection();
      locker.exec("BEGIN EXCLUSIVE");
      const repository = new SqliteUsageRepository(fixture.db);

      const started = performance.now();
      let caught: unknown;
      try {
        repository.totalsSince(0);
      } catch (error) {
        caught = error;
      }
      locker.exec("ROLLBACK");
      locker.close();

      expect(caught).toBeInstanceOf(DatabaseError);
      if (!(caught instanceof DatabaseError)) throw new Error("expected a DatabaseError");
      expect(caught.code).toBe("DB_BUSY");
      expect(caught.message).toMatch(/locked by another process/);
      expect(performance.now() - started).toBeLessThan(5_000);

      expect(repository.totalsSince(0).totalTokens).toBe(7);
    });
  });
});
