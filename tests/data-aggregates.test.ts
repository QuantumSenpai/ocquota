/**
 * Data-layer tests against real SQLite fixtures: the SQL, the row mapping and
 * the aggregate semantics, exercised through the production SqliteDatabase.
 *
 *   bun test
 */

import { describe, expect, test } from "bun:test";
import { SqliteUsageRepository } from "../src/data/sqlite-usage-repository.ts";
import { assistantData, withFixture, type UsageFixture } from "./helpers/fixture-db.ts";

const T0 = Date.parse("2026-03-05T18:30:00.000Z"); // 2026-03-06 00:00 IST
const NO_MODEL = JSON.stringify({
  tokens: { input: 3, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  cost: 0,
});
const usage = (input: number, extra: UsageFixture = {}) => assistantData({ input, ...extra });

describe("totalsSince", () => {
  test("sums countable tokens exactly; cache reads stay excluded", () => {
    withFixture((fx) => {
      fx.message({ data: assistantData({ input: 100, output: 20, reasoning: 5, cacheRead: 999, cacheWrite: 7, cost: 0.5 }), timeCreated: T0 });
      fx.message({ data: assistantData({ input: 1, output: 2, reasoning: 3, cacheRead: 4, cacheWrite: 5, cost: 0.25 }), timeCreated: T0 + 1_000 });
      fx.message({ data: assistantData({}), timeCreated: T0 + 2_000 }); // error turn: no tokens
      fx.message({ data: '{"role":"user"}', type: "user", timeCreated: T0 + 3_000 });

      const totals = new SqliteUsageRepository(fx.db).totalsSince(0);
      expect(totals.messages).toBe(3);
      expect(totals.sessions).toBe(1);
      expect(totals.cost).toBeCloseTo(0.75, 10);
      expect(totals.tokens).toEqual({ input: 101, output: 22, reasoning: 8, cacheRead: 1003, cacheWrite: 12 });
      expect(totals.totalTokens).toBe(101 + 22 + 8 + 12);
      expect(totals.lastActivityAt).toBe(T0 + 2_000);
    });
  });

  test("rows before `from` are excluded", () => {
    withFixture((fx) => {
      fx.message({ data: usage(10), timeCreated: T0 });
      fx.message({ data: usage(5), timeCreated: T0 + 60_000 });
      const totals = new SqliteUsageRepository(fx.db).totalsSince(T0 + 60_000);
      expect(totals.messages).toBe(1);
      expect(totals.totalTokens).toBe(5);
    });
  });

  test("empty window: zeros everywhere, totalTokens is 0 and never null", () => {
    withFixture((fx) => {
      const repo = new SqliteUsageRepository(fx.db);
      fx.message({ data: usage(10), timeCreated: T0 });
      const totals = repo.totalsSince(T0 + 86_400_000);
      expect(totals.messages).toBe(0);
      expect(totals.sessions).toBe(0);
      expect(totals.cost).toBe(0);
      expect(totals.totalTokens).toBe(0);
      expect(totals.tokens).toEqual({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 });
      expect(totals.lastActivityAt).toBeNull();
      expect(Number.isNaN(totals.totalTokens)).toBe(false);
      expect(repo.usageInRange({ start: T0 + 86_400_000, end: T0 + 172_800_000 }).totalTokens).toBe(0);
      expect(repo.totalsByModel(T0 + 86_400_000)).toEqual([]);
      expect(repo.topSessions(T0 + 86_400_000, 5)).toEqual([]);
    });
  });

  test("malformed JSON rows are excluded from every aggregate", () => {
    withFixture((fx) => {
      fx.message({ data: usage(10), timeCreated: T0 });
      fx.message({ data: '{"tokens": {bad json', timeCreated: T0 + 1_000 });
      fx.message({ data: usage(5), timeCreated: T0 + 2_000 });
      const totals = new SqliteUsageRepository(fx.db).totalsSince(0);
      expect(totals.messages).toBe(2);
      expect(totals.totalTokens).toBe(15);
      expect(totals.lastActivityAt).toBe(T0 + 2_000); // the malformed row never wins
    });
  });
});

describe("totalsByModel", () => {
  test("groups by provider and model, heaviest first", () => {
    withFixture((fx) => {
      fx.message({ data: assistantData({ input: 10, modelId: "model-x", providerId: "provA" }), timeCreated: T0 });
      fx.message({ data: assistantData({ input: 5, output: 5, reasoning: 5, cacheWrite: 5, cost: 0.1, modelId: "model-y", providerId: "provB" }), timeCreated: T0 + 1_000 });
      const models = new SqliteUsageRepository(fx.db).totalsByModel(0);
      expect(models.map((m) => `${m.providerId}/${m.modelId}`)).toEqual(["provB/model-y", "provA/model-x"]);
      expect(models[0]?.totalTokens).toBe(20);
      expect(models[0]?.messages).toBe(1);
      expect(models[0]?.cost).toBeCloseTo(0.1, 10);
      expect(models[1]?.totalTokens).toBe(10);
    });
  });

  test("a message with no model falls back to unknown/unknown", () => {
    withFixture((fx) => {
      fx.message({ data: NO_MODEL, timeCreated: T0 });
      fx.message({ data: usage(7, { modelId: "model-x", providerId: "provA" }), timeCreated: T0 + 1_000 });
      const models = new SqliteUsageRepository(fx.db).totalsByModel(0);
      expect(models.map((m) => `${m.providerId}/${m.modelId}`)).toEqual(["provA/model-x", "unknown/unknown"]);
      expect(models[1]?.totalTokens).toBe(3);
    });
  });
});

describe("topSessions", () => {
  test("orders by countable tokens, respects the limit, and survives a malformed row", () => {
    withFixture((fx) => {
      fx.session("ses_light", "Light session");
      fx.session("ses_heavy", "Heavy session");
      fx.session("ses_titled", null);
      fx.message({ data: usage(10), sessionId: "ses_light", timeCreated: T0 });
      fx.message({ data: assistantData({ input: 40, output: 20 }), sessionId: "ses_heavy", timeCreated: T0 + 1_000 });
      fx.message({ data: '{"oops', sessionId: "ses_heavy", timeCreated: T0 + 2_000 });
      fx.message({ data: usage(30), sessionId: "ses_titled", timeCreated: T0 + 3_000 });

      const top = new SqliteUsageRepository(fx.db).topSessions(0, 2);
      expect(top.map((s) => s.sessionId)).toEqual(["ses_heavy", "ses_titled"]);
      expect(top[0]?.totalTokens).toBe(60);
      expect(top[0]?.messages).toBe(1); // malformed row excluded here too
      expect(top[0]?.title).toBe("Heavy session");
      expect(top[0]?.lastActivityAt).toBe(T0 + 1_000);
      expect(top[1]?.title).toBeNull(); // no session_v2 row -> LEFT JOIN null
    });
  });
});
