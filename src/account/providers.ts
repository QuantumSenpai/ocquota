import { z } from "zod";
import { cleanLabel, unavailable, type AccountCredential, type AccountSnapshot, type QuotaMeter } from "./types.ts";

const amount = z.number().finite().nonnegative();
const windowSchema = z.object({ used_percent: amount.max(100), limit_window_seconds: amount.positive(), reset_at: amount.optional() });
const rateSchema = z.object({ allowed: z.boolean().optional(), limit_reached: z.boolean().optional(), primary_window: windowSchema.nullish(), secondary_window: windowSchema.nullish() });
const openAISchema = z.object({ plan_type: z.string().optional(), rate_limit: rateSchema.nullish(), additional_rate_limits: z.array(z.object({ limit_name: z.string(), metered_feature: z.string(), rate_limit: rateSchema.nullish() })).nullish() });

export function parseOpenAI(value: unknown, now = Date.now()): AccountSnapshot {
  const data = openAISchema.parse(value);
  const meters: QuotaMeter[] = [];
  const append = (rate: z.infer<typeof rateSchema> | null | undefined, scope: string, prefix = "") => {
    for (const window of [rate?.primary_window, rate?.secondary_window]) {
      if (!window) continue;
      const hours = window.limit_window_seconds / 3600;
      meters.push({ label: `${prefix}${hours === 168 ? "Weekly" : `${hours}h window`}`, scope, unit: "percent", used: window.used_percent, remaining: 100 - window.used_percent, limit: 100,
        ...(window.reset_at === undefined ? {} : { resetsAt: window.reset_at * 1000 }) });
    }
  };
  append(data.rate_limit, "OpenAI account shared allowance");
  for (const extra of data.additional_rate_limits ?? []) append(extra.rate_limit, `${cleanLabel(extra.limit_name)} · ${cleanLabel(extra.metered_feature)}`, `${cleanLabel(extra.limit_name)} · `);
  return { provider: "openai", status: meters.length ? "live" : "unavailable", source: "OpenAI account usage endpoint", fetchedAt: now,
    blocked: data.rate_limit?.allowed === false || data.rate_limit?.limit_reached === true,
    note: meters.length ? "Provider percentages; no fixed remaining token total is supplied." : "This login did not expose account allowance windows.",
    ...(data.plan_type ? { plan: cleanLabel(data.plan_type) } : {}), meters };
}

const openRouterSchema = z.object({ data: z.object({ limit: amount.nullish(), limit_remaining: amount.nullish(), is_free_tier: z.boolean().optional(),
  free_model_daily_requests: z.object({ used: amount, limit: amount, remaining: amount }).nullish(),
  effective_budget: z.object({ limit_usd: amount, spend_usd: amount, remaining_usd: z.number().finite(), resets_at: z.string().nullish(), scope: z.string() }).nullish(),
}) });
export function parseOpenRouter(value: unknown, now = Date.now()): AccountSnapshot {
  const data = openRouterSchema.parse(value).data;
  const meters: QuotaMeter[] = [];
  if (data.free_model_daily_requests) meters.push({ label: "Free requests / UTC day", scope: "OpenRouter account; free variants", unit: "requests", ...data.free_model_daily_requests });
  const budget = data.effective_budget;
  if (budget) {
    const reset = budget.resets_at ? Date.parse(budget.resets_at) : NaN;
    meters.push({ label: "Effective spending cap", scope: cleanLabel(budget.scope), unit: "USD", limit: budget.limit_usd, used: budget.spend_usd, remaining: Math.max(0, budget.remaining_usd), ...(Number.isFinite(reset) ? { resetsAt: reset } : {}) });
  } else if (data.limit != null && data.limit_remaining != null) meters.push({ label: "API key spending cap", scope: "OpenRouter API key, not account balance", unit: "USD", limit: data.limit, remaining: data.limit_remaining });
  return { provider: "openrouter", status: meters.length ? "live" : "unavailable", source: "OpenRouter GET /api/v1/key", fetchedAt: now, meters,
    note: meters.length ? "Account/key scope; free requests and dollars are distinct from tokens." : "No quota counters supplied; uncapped key does not mean unlimited account credit." };
}

function durationMs(raw: string | null): number | undefined {
  if (!raw) return undefined;
  let total = 0;
  let matched = "";
  for (const match of raw.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h|d)/g)) {
    matched += match[0];
    total += Number(match[1]) * ({ ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]!] ?? 0);
  }
  return matched === raw && Number.isFinite(total) ? total : undefined;
}
export function parseRateHeaders(provider: string, model: string, headers: Headers, now = Date.now()): AccountSnapshot {
  const meters: QuotaMeter[] = [];
  for (const unit of ["requests", "tokens"] as const) {
    const read = (key: string) => {
      const raw = headers.get(`x-ratelimit-${key}-${unit}`);
      if (raw === null || !raw.trim()) return undefined;
      const n = Number(raw); return Number.isFinite(n) && n >= 0 ? n : undefined;
    };
    const limit = read("limit"), remaining = read("remaining");
    if (limit === undefined || remaining === undefined) continue;
    const reset = durationMs(headers.get(`x-ratelimit-reset-${unit}`));
    meters.push({ label: provider === "groq" ? unit === "requests" ? "Requests / day" : "Tokens / minute" : `${unit} / provider window`,
      scope: `Response for ${cleanLabel(model)}; shared account counters may apply`, unit, limit, remaining,
      ...(remaining <= limit ? { used: limit - remaining } : {}), ...(reset === undefined ? {} : { resetsAt: now + reset }) });
  }
  return { provider, status: meters.length ? "live" : "unavailable", source: "Actual inference response headers", fetchedAt: now, meters,
    note: meters.length ? "Last observed response; counters may change from other clients." : "Provider did not expose remaining quota headers. Free pricing is not unlimited capacity." };
}

export async function fetchAccount(provider: string, credential: AccountCredential | undefined, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<AccountSnapshot> {
  if (!credential) return unavailable(provider, "No usable account connection. Sign in through the provider's own app.");
  let url: string, headers: Record<string, string>;
  if (provider === "openai" && credential.type === "oauth") {
    url = "https://chatgpt.com/backend-api/wham/usage";
    headers = { Authorization: `Bearer ${credential.access}` };
    if (credential.accountId) headers["ChatGPT-Account-Id"] = credential.accountId;
  } else if (provider === "openrouter" && credential.type === "key") {
    url = "https://openrouter.ai/api/v1/key"; headers = { Authorization: `Bearer ${credential.key}` };
  } else return unavailable(provider, "No standalone quota endpoint supported for this connection. Use observed provider response headers.");
  try {
    const timeout = AbortSignal.timeout(8000);
    const response = await fetcher(url, { headers, redirect: "error", signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!response.ok) { await response.body?.cancel(); return unavailable(provider, response.status === 401 || response.status === 403 ? "This login cannot read the quota endpoint. Use a supported account source; no allowance is guessed." : `Provider quota endpoint returned HTTP ${response.status}.`); }
    const reader = response.body?.getReader();
    if (!reader) return unavailable(provider, "Provider returned no quota data.");
    let body = "", size = 0;
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 256000) { await reader.cancel(); return unavailable(provider, "Provider quota response exceeded the safe size limit."); }
        body += decoder.decode(chunk.value, { stream: true });
      }
      body += decoder.decode();
    } finally { reader.releaseLock(); }
    const data: unknown = JSON.parse(body);
    return provider === "openai" ? parseOpenAI(data) : parseOpenRouter(data);
  } catch { return unavailable(provider, "Quota request timed out, failed or returned an unsupported response. No inferred allowance."); }
}

const consoleMeter = z.object({ percent: amount.max(100), resetsAt: amount });
const consoleSchema = z.object({ go: z.object({ rolling: consoleMeter, weekly: consoleMeter, monthly: consoleMeter }).optional(), budgets: z.array(z.object({ limit: amount, spent: amount, resetsAt: amount, per: z.string(), scope: z.string(), coverage: z.string(), models: z.array(z.object({ providerID: z.string(), modelID: z.string(), spent: amount.optional() })) })).default([]) });
export function parseConsoleUsage(value: unknown, provider: string, model: string, now = Date.now()): AccountSnapshot {
  if (value == null) return unavailable(provider, "OpenCode Console did not expose allowance counters for this connection.", now);
  const data = consoleSchema.parse(value);
  const meters: QuotaMeter[] = [];
  if (data.go) for (const [name, window] of Object.entries(data.go)) meters.push({ label: `Go ${name}`, scope: "OpenCode Go subscription", unit: "percent", limit: 100, used: window.percent, remaining: 100 - window.percent, resetsAt: window.resetsAt });
  for (const budget of data.budgets) {
    const member = budget.models.find((item) => item.providerID === provider && item.modelID === model);
    if (budget.coverage !== "all" && !member) continue;
    const spent = budget.per === "model" ? member?.spent : budget.spent;
    if (spent === undefined) continue;
    meters.push({ label: "Console spending cap", scope: budget.per === "model" ? `Model ${cleanLabel(model)}` : `Shared ${cleanLabel(budget.scope)} budget`, unit: "USD", used: spent, limit: budget.limit, remaining: Math.max(0, budget.limit - spent), resetsAt: budget.resetsAt });
  }
  return { provider, status: meters.length ? "live" : "unavailable", source: "OpenCode experimental.usage.limits", fetchedAt: now, meters,
    note: meters.length ? "Console-reported allowance. Context size is not a usage allowance." : "No account allowance exposed for this model. Free pricing is not unlimited usage." };
}
