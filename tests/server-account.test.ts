import { expect, test } from "bun:test";
import server from "../src/opencode/server.ts";
import type { AccountSnapshot } from "../src/account/types.ts";

test("server observes real HTTP headers without consuming responses and isolates account/model changes", async () => {
  let account = "a", disposed = 0;
  let read!: (input: { providerID: string; modelID: string }) => Promise<AccountSnapshot>;
  const hooks: Record<string, (input: { model: { providerID: string; id: string }; request: Request; response: Response }) => Promise<void> | void> = {};
  const context = {
    provider: { get: async () => ({ data: { integrationID: "groq" } }) },
    integration: { connection: { active: async () => ({ type: "credential", id: account }), resolve: async () => ({ type: "key", key: `key-${account}` }) } },
    rpc: { register: async (_definition: unknown, handlers: { read: typeof read }) => { read = handlers.read; return { dispose: async () => { disposed++; } }; } },
    session: { hook: async (name: string, handler: typeof hooks[string]) => { hooks[name] = handler; return { dispose: async () => { disposed++; } }; } },
  } as unknown as Parameters<typeof server.setup>[0];
  const cleanup = await server.setup(context);
  try {
    expect((await read({ providerID: "groq", modelID: "model-a" })).status).toBe("unavailable");
    const response = new Response("unconsumed inference body", { headers: { "x-ratelimit-limit-requests": "1000", "x-ratelimit-remaining-requests": "998" } });
    const input = { model: { providerID: "groq", id: "model-a" }, request: new Request("https://api.groq.com/openai/v1/chat/completions", { headers: { Authorization: "Bearer key-a" } }), response };
    await hooks["http.request"]!(input);
    account = "b"; // The response belongs to A even if the active connection changes while it is in flight.
    await hooks["http.response"]!(input);
    expect(input.response).toBe(response); expect(response.bodyUsed).toBe(false);
    expect((await read({ providerID: "groq", modelID: "model-a" })).meters).toHaveLength(0);
    account = "a";
    expect((await read({ providerID: "groq", modelID: "model-a" })).meters[0]?.remaining).toBe(998);
    expect((await read({ providerID: "groq", modelID: "model-b" })).meters).toHaveLength(0);
  } finally { if (cleanup) await cleanup(); }
  expect(disposed).toBe(3);
});

test("explicit same-account linking reads Codex OAuth and labels shared quota without resolving OpenCode secrets", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spyOn } = await import("bun:test");
  const dir = mkdtempSync(join(tmpdir(), "ocquota-linked-"));
  writeFileSync(join(dir, "auth.json"), JSON.stringify({ tokens: { access_token: "test-codex-token", account_id: "test-account" } }), { mode: 0o600 });
  const network = spyOn(globalThis, "fetch").mockImplementation((async () => new Response(JSON.stringify({ plan_type: "plus", rate_limit: { primary_window: { used_percent: 20, limit_window_seconds: 18000 } } }))) as unknown as typeof fetch);
  let read!: (input: { providerID: string; modelID: string }) => Promise<AccountSnapshot>;
  const context = {
    options: { linkCodexAccount: true, codexHome: dir },
    provider: { get: async () => ({ data: { integrationID: "openai" } }) },
    integration: { connection: { active: async () => ({ type: "credential", id: "openai-connection", method: "oauth" }), resolve: async () => { throw new Error("Must not read the denied token-sharing secret"); } } },
    rpc: { register: async (_definition: unknown, handlers: { read: typeof read }) => { read = handlers.read; return { dispose: async () => {} }; } },
    session: { hook: async () => ({ dispose: async () => {} }) },
  } as unknown as Parameters<typeof server.setup>[0];
  const cleanup = await server.setup(context);
  try {
    const result = await read({ providerID: "openai", modelID: "model-a" });
    expect(result.status).toBe("live"); expect(result.meters[0]?.remaining).toBe(80);
    expect(result.source).toContain("linked Codex"); expect(result.note).toContain("app-specific");
    await read({ providerID: "openai", modelID: "model-b" });
    expect(network).toHaveBeenCalledTimes(1); // Shared account pool, not one network poll per model.
    expect(JSON.stringify(result)).not.toContain("test-codex-token");
  } finally { if (cleanup) await cleanup(); network.mockRestore(); rmSync(dir, { recursive: true, force: true }); }
});
