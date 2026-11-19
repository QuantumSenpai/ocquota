import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexUsageRepository } from "../src/data/codex-usage-repository.ts";
import { createTimeZone } from "../src/core/timezone.ts";
import { ConfigStore } from "../src/config/config-store.ts";

const T0 = Date.parse("2026-11-19T00:00:00Z");
const usage = (input = 100, output = 30) => ({ input_tokens: input, cached_input_tokens: 40,
  output_tokens: output, reasoning_output_tokens: 10, total_tokens: input + output });
const row = (type: string, payload: unknown, timestamp = T0) => JSON.stringify({ timestamp: new Date(timestamp).toISOString(), type, payload }) + "\n";
const meta = (id = "session-1") => row("session_meta", { id, model_provider: "openai" });
const context = (model = "test-model") => row("turn_context", { model });
const record = (id: string, timestamp = T0, input = 100, output = 30) => row("token_usage_record", {
  response_id: id, thread_id: "session-1", usage: usage(input, output), thread_token_usage: usage(input, output),
}, timestamp);
const legacy = (timestamp = T0, total = usage(), last = usage()) => row("event_msg", {
  type: "token_count", info: { total_token_usage: total, last_token_usage: last },
}, timestamp);

function fixture(run: (dir: string, sessions: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "ocquota-codex-"));
  const sessions = join(dir, "sessions");
  mkdirSync(sessions);
  try { run(dir, sessions); } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe("Codex usage repository", () => {
  test("counts response records once, excludes cached input, and splits reasoning out of output", () => fixture((dir, sessions) => {
    const path = join(sessions, "rollout-test.jsonl");
    const data = meta() + context() + record("response-1") + legacy() + record("response-1");
    writeFileSync(path, data);
    const repo = new CodexUsageRepository(dir);
    const total = repo.usageInRange({ start: T0, end: T0 + 1 });
    expect(total.messages).toBe(1);
    expect(total.sessions).toBe(1);
    expect(total.tokens).toEqual({ input: 60, output: 20, reasoning: 10, cacheRead: 40, cacheWrite: 0 });
    expect(total.totalTokens).toBe(90);
    expect(readFileSync(path, "utf8")).toBe(data);
  }));

  test("canonical per-response records override divergent legacy accounting in the same file", () => fixture((dir, sessions) => {
    writeFileSync(join(sessions, "rollout-mixed.jsonl"), meta() + context() + legacy(T0 - 1)
      + record("canonical", T0)
      + legacy(T0 + 1, usage(900, 100), usage(120, 40)));
    const total = new CodexUsageRepository(dir).totalsSince(0);
    expect(total.messages).toBe(1);
    expect(total.totalTokens).toBe(90);
  }));

  test("legacy repeated totals and rate-limit-only events do not duplicate usage; window boundaries are exact", () => fixture((dir, sessions) => {
    writeFileSync(join(sessions, "rollout-old.jsonl"), meta() + context() + legacy(T0 - 1) + legacy(T0)
      + row("event_msg", { type: "token_count", info: null }, T0)
      + legacy(T0 + 1, usage(220, 70), usage(120, 40))
      + legacy(T0 + 2, usage(350, 110), usage(130, 40)));
    const repo = new CodexUsageRepository(dir);
    const total = repo.usageInRange({ start: T0, end: T0 + 2 });
    expect(total.messages).toBe(1);
    expect(total.totalTokens).toBe(120);
    expect(total.lastActivityAt).toBe(T0 + 1);
  }));

  test("reads compressed archives, deduplicates copies, and groups models and local days", () => fixture((dir, sessions) => {
    const archived = join(dir, "archived_sessions"); mkdirSync(archived);
    const first = meta() + context() + record("response-1", T0 - 1);
    writeFileSync(join(sessions, "rollout-live.jsonl"), first + context("second-model") + record("response-2", T0));
    writeFileSync(join(archived, "rollout-copy.jsonl.zst"), Bun.zstdCompressSync(Buffer.from(first)));
    const repo = new CodexUsageRepository(dir);
    expect(repo.totalsSince(0).messages).toBe(2);
    expect(repo.totalsByModel(0).map((model) => model.modelId).sort()).toEqual(["second-model", "test-model"]);
    expect(repo.dailyBuckets(T0 - 1, T0 + 1, createTimeZone("UTC")).map((day) => day.messages)).toEqual([1, 1]);
    expect(repo.topSessions(0, 1)[0]?.messages).toBe(2);
    expect(repo.sessionIdsInRange({ start: T0, end: T0 + 1 })).toEqual(["session-1"]);
  }));

  test("watch picks up appended records and split lines, then rebuilds truncated files", () => fixture((dir, sessions) => {
    const path = join(sessions, "rollout-live.jsonl");
    writeFileSync(path, meta() + context() + record("response-1"));
    const repo = new CodexUsageRepository(dir);
    expect(repo.totalsSince(0).messages).toBe(1);
    const next = record("response-2", T0 + 1);
    appendFileSync(path, next.slice(0, 30));
    expect(repo.totalsSince(0).messages).toBe(1);
    appendFileSync(path, next.slice(30));
    expect(repo.totalsSince(0).messages).toBe(2);
    writeFileSync(path, meta() + context() + record("replacement", T0 + 2));
    expect(repo.totalsSince(0).messages).toBe(1);
    expect(repo.totalsSince(0).lastActivityAt).toBe(T0 + 2);
  }));

  test("rejects missing sources and safely ignores malformed events and synthetic compaction totals", () => fixture((dir, sessions) => {
    expect(() => new CodexUsageRepository(join(dir, "missing"))).toThrow(/Codex/);
    writeFileSync(join(sessions, "rollout-invalid.jsonl"), meta() + context() + "bad json\n"
      + row("event_msg", { type: "token_count", info: { total_token_usage: { total_tokens: 1000 }, last_token_usage: { total_tokens: 1000 } } })
      + row("token_usage_record", { response_id: "bad", usage: { input_tokens: -1, output_tokens: "10" } })
      + record("good"));
    expect(new CodexUsageRepository(dir).totalsSince(0).totalTokens).toBe(90);
  }));

  test("handles legacy cumulative-only events and final records without a newline", () => fixture((dir, sessions) => {
    writeFileSync(join(sessions, "rollout-cumulative.jsonl"), meta() + context()
      + row("event_msg", { type: "token_count", info: { total_token_usage: usage() } })
      + row("event_msg", { type: "token_count", info: { total_token_usage: usage(220, 70) } }, T0 + 1).trimEnd());
    const repo = new CodexUsageRepository(dir);
    expect(repo.totalsSince(0).messages).toBe(2);
    expect(repo.totalsSince(0).totalTokens).toBe(250);
  }));

  test("source configuration supports CLI, OCQUOTA overrides, and CODEX_HOME", () => fixture((dir) => {
    const configPath = join(dir, "config.json");
    writeFileSync(configPath, JSON.stringify({ source: "codex", codexHome: "/file" }));
    const store = new ConfigStore({ configPath, env: { CODEX_HOME: "/codex", OCQUOTA_SOURCE: "opencode", OCQUOTA_CODEX_HOME: "/override" } });
    expect(store.load().source).toBe("opencode");
    expect(store.load({ source: "codex", codexHome: "/cli" }).codexHome).toBe("/cli");
    expect(store.load().codexHome).toBe("/override");
    expect(new ConfigStore({ configPath, env: { CODEX_HOME: "/codex" } }).load().codexHome).toBe("/codex");
    expect(() => store.load({ source: "unknown" })).toThrow(/opencode.*codex/);
  }));

  test("every CLI report supports Codex, reports unavailable cost, and leaves source files untouched", () => fixture((dir, sessions) => {
    const path = join(sessions, "rollout-cli.jsonl");
    const data = meta() + context() + record("response-cli", Date.now());
    writeFileSync(path, data);
    const run = (command: string, theme = "ember", metric = "tokens") => Bun.spawnSync(["bun", "src/cli.ts", command,
      "--source", "codex", "--codex-home", dir, "--db", "/missing.db", "--theme", theme,
      "--metric", metric, "--tz", "UTC", "--window", "month"], {
      env: { ...process.env, NO_COLOR: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const json = run("json");
    expect(json.exitCode).toBe(0);
    expect(JSON.parse(new TextDecoder().decode(json.stdout))).toMatchObject({ source: "codex", costAvailable: false, cost: null,
      messages: 1, sessions: 1, totalTokens: 90, tokens: { input: 60, output: 20, reasoning: 10, cacheRead: 40 } });
    for (const command of ["bar", "oneline", "totals", "models", "daily", "top", "watch"]) {
      const result = run(command);
      expect(result.exitCode).toBe(0);
      const output = new TextDecoder().decode(result.stdout);
      expect(output).toContain("N/A");
      expect(output).not.toContain("$0.00");
      expect(output).not.toContain("\x1b");
    }
    expect(new TextDecoder().decode(run("explain").stdout)).toContain("no SQL");
    expect(new TextDecoder().decode(run("bar", "raw").stdout)).toContain("Codex");
    const rejected = run("bar", "ember", "cost");
    expect(rejected.exitCode).toBe(1);
    expect(new TextDecoder().decode(rejected.stderr)).toContain("do not report billed dollar cost");
    expect(readFileSync(path, "utf8")).toBe(data);
    expect(readdirSync(dir)).toEqual(["sessions"]);
  }));
});
