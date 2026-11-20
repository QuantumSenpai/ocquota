import { z } from "zod";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { codexCredential } from "../account/codex.ts";
import { Plugin } from "@opencode/plugin";
import { AccountCache } from "../account/cache.ts";
import { fetchAccount, parseRateHeaders } from "../account/providers.ts";
import { unavailable, type AccountCredential, type AccountSnapshot } from "../account/types.ts";
import { accountRpc } from "./rpc.ts";

export function canonicalProvider(id: string): string {
  if (["openai", "openai-codex", "chatgpt"].includes(id)) return "openai";
  if (["nvidia", "nvidia-nim", "nim"].includes(id)) return "nvidia";
  return id;
}

export default Plugin.define({
  id: "ocquota.native",
  async setup(context) {
    const options = z.object({ linkCodexAccount: z.boolean().default(false), codexHome: z.string().min(1).optional() }).parse(context.options ?? {});
    const cache = new AccountCache();
    const observed = new Map<string, AccountSnapshot>();
    const shutdown = new AbortController();
    const connectionFor = async (providerID: string) => {
      const provider = (await context.provider.get({ providerID })).data;
      const integrationID = provider.integrationID ?? provider.canonical ?? providerID;
      const connection = await context.integration.connection.active(integrationID);
      return { provider, connection, integrationID, key: `${providerID}:${connection?.type === "credential" ? connection.id : connection?.type === "env" ? connection.name : "none"}` };
    };
    const registration = await context.rpc.register(accountRpc, {
      read: async ({ providerID, modelID }): Promise<AccountSnapshot> => {
        try {
          const state = await connectionFor(providerID);
          const provider = canonicalProvider(state.provider.canonical ?? state.integrationID);
          const linked = options.linkCodexAccount && provider === "openai" && state.connection?.type === "credential" && state.connection.method === "oauth";
          const linkedCredential = linked ? codexCredential(options.codexHome ?? process.env["OCQUOTA_CODEX_HOME"] ?? process.env["CODEX_HOME"] ?? join(homedir(), ".codex")) : undefined;
          const linkedIdentity = linkedCredential?.type === "oauth" ? createHash("sha256").update(`${linkedCredential.accountId ?? ""}:${linkedCredential.access}`).digest("hex") : "missing";
          const key = `${state.key}:${linked ? linkedIdentity : "provider"}`;
          if (provider === "groq" || provider === "nvidia") {
            const snapshot = observed.get(`${state.key}:${modelID}`);
            if (!snapshot) return unavailable(provider, "Waiting for real response headers from this model/account. No fixed free token allowance is assumed.");
            return Date.now() - snapshot.fetchedAt > 60_000 ? { ...snapshot, status: "stale", note: "Last observed response is over a minute old. Quota may have changed." } : snapshot;
          }
          if (provider !== "openai" && provider !== "openrouter") return unavailable(provider, "This provider does not expose a supported quota endpoint. No fixed allowance is assumed.");
          return cache.read(key, async () => {
            if (linked) {
              const result = await fetchAccount("openai", linkedCredential, fetch, shutdown.signal);
              return { ...result, source: `${result.source} · linked Codex login`, note: "Shared plan via linked Codex. OpenCode app-specific token-sharing cap is not exposed. " + result.note };
            }
            const value = state.connection ? await context.integration.connection.resolve(state.connection) : undefined;
            let credential: AccountCredential | undefined;
            if (value?.type === "oauth") {
              const accountId = value.metadata?.["accountID"] ?? value.metadata?.["accountId"] ?? value.metadata?.["account_id"];
              credential = { type: "oauth", access: value.access, accountId: typeof accountId === "string" ? accountId : undefined };
            } else if (value?.type === "key") credential = { type: "key", key: value.key };
            return fetchAccount(provider, credential, fetch, shutdown.signal);
          });
        } catch { return unavailable(providerID, "Account connection or quota service unavailable. No inferred allowance."); }
      },
    });
    const inFlight = new WeakMap<Request, { key: string; provider: string; modelID: string }>();
    const requestHook = await context.session.hook("http.request", async (input) => {
      try {
        const state = await connectionFor(input.model.providerID);
        const provider = canonicalProvider(state.provider.canonical ?? state.integrationID);
        if (provider !== "groq" && provider !== "nvidia") return;
        const url = new URL(input.request.url);
        const allowed = provider === "groq" ? url.hostname === "api.groq.com" : url.hostname === "integrate.api.nvidia.com";
        if (!allowed || url.protocol !== "https:" || !state.connection) return;
        const credential = await context.integration.connection.resolve(state.connection);
        if (credential?.type !== "key") return;
        const matches = input.request.headers.get("authorization") === `Bearer ${credential.key}` || input.request.headers.get("x-api-key") === credential.key;
        if (matches) inFlight.set(input.request, { key: `${state.key}:${input.model.id}`, provider, modelID: input.model.id });
      } catch { /* Read-only observation must never interrupt a model request. */ }
    });
    const responseHook = await context.session.hook("http.response", (input) => {
      const request = inFlight.get(input.request);
      if (!request || shutdown.signal.aborted) return;
      inFlight.delete(input.request);
      if (observed.size >= 64) observed.delete(observed.keys().next().value!);
      observed.set(request.key, parseRateHeaders(request.provider, request.modelID, input.response.headers));
    });
    return async () => { shutdown.abort(); cache.clear(); observed.clear(); await responseHook.dispose(); await requestHook.dispose(); await registration.dispose(); };
  },
});
