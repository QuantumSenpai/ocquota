import { z } from "zod";
export const quotaMeter = z.object({
  label: z.string(), unit: z.enum(["percent", "requests", "tokens", "USD"]), scope: z.string(),
  used: z.number().finite().nonnegative().optional(), limit: z.number().finite().nonnegative().optional(),
  remaining: z.number().finite().nonnegative().optional(), resetsAt: z.number().finite().optional(),
});
export const accountSnapshot = z.object({
  provider: z.string(), status: z.enum(["live", "unavailable", "stale"]), source: z.string(),
  fetchedAt: z.number(), note: z.string(), blocked: z.boolean().optional(), plan: z.string().optional(), meters: z.array(quotaMeter),
});
export type QuotaMeter = z.infer<typeof quotaMeter>;
export type AccountSnapshot = z.infer<typeof accountSnapshot>;
export type AccountCredential = { type: "oauth"; access: string; accountId?: string | undefined } | { type: "key"; key: string };
export const cleanLabel = (value: string) => value.replace(/[\x00-\x1f\x7f-\x9f]/g, "").slice(0, 120);
export function unavailable(provider: string, note: string, now = Date.now()): AccountSnapshot {
  return { provider, status: "unavailable", source: "No provider quota response", fetchedAt: now, note, meters: [] };
}
