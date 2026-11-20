import { expect, test } from "bun:test";
import { parseOpenAI, parseOpenRouter, parseRateHeaders, fetchAccount } from "../src/account/providers.ts";

test("OpenAI account windows stay percentages, never invented token allowances", () => {
  const result = parseOpenAI({ plan_type: "plus", rate_limit: { primary_window: { used_percent: 23, limit_window_seconds: 18000, reset_at: 2000000000 }, secondary_window: { used_percent: 51, limit_window_seconds: 604800, reset_at: 2000001000 } } }, 1000);
  expect(result.plan).toBe("plus");
  expect(result.meters[0]).toMatchObject({ used: 23, remaining: 77, limit: 100, unit: "percent", resetsAt: 2000000000000 });
  expect(result.meters[0]!.scope).toContain("account");
  expect(JSON.stringify(result)).not.toContain("5000000");
  expect(parseOpenAI({ plan_type: "plus", rate_limit: null }, 1000).status).toBe("unavailable");
  expect(() => parseOpenAI({ rate_limit: { primary_window: { used_percent: -1, limit_window_seconds: 18000 } } }, 1000)).toThrow();
});
test("OpenRouter distinguishes free requests, dollars and missing limits", () => {
  const result = parseOpenRouter({ data: { is_free_tier: true, free_model_daily_requests: { used: 7, limit: 50, remaining: 43 }, limit: null, limit_remaining: null, usage_daily: 0 } }, 1000);
  expect(result.meters).toHaveLength(1);
  expect(result.meters[0]).toMatchObject({ unit: "requests", used: 7, limit: 50, remaining: 43 });
  expect(parseOpenRouter({ data: { usage: 0, limit: null } }, 1000).meters).toHaveLength(0);
  expect(parseOpenRouter({ data: { limit: 10, limit_remaining: 4 } }, 1000).meters[0]).toMatchObject({ unit: "USD", limit: 10, remaining: 4 });
});
test("Groq headers mean daily requests and minute tokens, scoped to the actual response model", () => {
  const headers = new Headers({ "x-ratelimit-limit-requests": "1000", "x-ratelimit-remaining-requests": "990", "x-ratelimit-limit-tokens": "8000", "x-ratelimit-remaining-tokens": "7000", "x-ratelimit-reset-tokens": "7.66s" });
  const result = parseRateHeaders("groq", "model-a", headers, 1000);
  expect(result.meters[0]).toMatchObject({ label: "Requests / day", unit: "requests", limit: 1000, remaining: 990 });
  expect(result.meters[1]).toMatchObject({ label: "Tokens / minute", unit: "tokens", resetsAt: 8660 });
  expect(result.meters.every((item) => item.scope.includes("model-a"))).toBe(true);
  expect(parseRateHeaders("nvidia", "model-a", new Headers(), 1000).meters).toHaveLength(0);
});
test("quota reads use only fixed HTTPS hosts, reject redirects, and never return secrets or raw errors", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), ...(init ? { init } : {}) });
    return new Response(JSON.stringify({ plan_type: "plus", rate_limit: null }));
  };
  const result = await fetchAccount("openai", { type: "oauth", access: "secret-token", accountId: "private-account" }, fetcher as typeof fetch);
  expect(calls[0]!.url).toBe("https://chatgpt.com/backend-api/wham/usage");
  expect(calls[0]!.init!.redirect).toBe("error");
  expect(JSON.stringify(result)).not.toMatch(/secret-token|private-account/);
  const failed = await fetchAccount("openai", { type: "oauth", access: "secret-token" }, (async () => { throw new Error("secret-token"); }) as unknown as typeof fetch);
  expect(JSON.stringify(failed)).not.toContain("secret-token");
  const rejected = await fetchAccount("nvidia", { type: "key", key: "secret" }, fetcher as typeof fetch);
  expect(rejected.status).toBe("unavailable");
  expect(calls).toHaveLength(1);
});

test("account cache deduplicates concurrent reads, marks stale data and isolates account identities", async () => {
  const { AccountCache } = await import("../src/account/cache.ts");
  let now = 1000, calls = 0;
  const cache = new AccountCache(() => now, 100);
  const load = async () => { calls++; return parseOpenRouter({ data: { limit: 10, limit_remaining: 4 } }, now); };
  const [a, b] = await Promise.all([cache.read("account-a", load), cache.read("account-a", load)]);
  expect(calls).toBe(1); expect(a).toEqual(b);
  now += 101;
  const stale = await cache.read("account-a", async () => ({ ...a, status: "unavailable", meters: [], note: "offline" }));
  expect(stale.status).toBe("stale"); expect(stale.fetchedAt).toBe(1000);
  await cache.read("account-b", load); expect(calls).toBe(2);
  cache.clear(); await cache.read("account-a", load); expect(calls).toBe(3);
});

test("OpenCode Console budgets are selected-model scoped and missing free-tier totals remain unavailable", async () => {
  const { parseConsoleUsage } = await import("../src/account/providers.ts");
  expect(parseConsoleUsage(null, "opencode", "free-model").status).toBe("unavailable");
  expect(parseConsoleUsage({ budgets: [] }, "opencode", "free-model").meters).toHaveLength(0);
  const result = parseConsoleUsage({ budgets: [{ limit: 20, spent: 19, resetsAt: 1000, per: "model", scope: "each", coverage: "models", models: [{ providerID: "opencode", modelID: "selected", spent: 3 }] }] }, "opencode", "selected");
  expect(result.meters[0]).toMatchObject({ used: 3, remaining: 17, unit: "USD" });
  expect(parseConsoleUsage({ budgets: [{ limit: 20, spent: 19, resetsAt: 1000, per: "model", scope: "each", coverage: "models", models: [{ providerID: "opencode", modelID: "other", spent: 3 }] }] }, "opencode", "selected").meters).toHaveLength(0);
});
