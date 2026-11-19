import { z } from "zod";
import { ConfigStore } from "../config/config-store.ts";
import { ConfigError } from "../core/errors.ts";
import { createTimeZone } from "../core/timezone.ts";
import { SqliteDatabase } from "../data/database.ts";
import { SqliteUsageRepository } from "../data/sqlite-usage-repository.ts";
import { IncrementalUsageTracker } from "../domain/incremental-tracker.ts";
import { QuotaService } from "../domain/quota-service.ts";
import { createWindow } from "../domain/window.ts";

const schema = z.object({
  dbPath: z.string().min(1).optional(),
  limitTokens: z.number().int().positive().optional(),
  limitCost: z.number().nonnegative().nullable().optional(),
  metric: z.enum(["tokens", "cost"]).optional(),
  window: z.enum(["day", "week", "month"]).optional(),
  timezone: z.string().min(1).optional(),
  refreshMs: z.number().int().min(1000).optional(),
  motion: z.boolean().optional(),
});

export function openNativeUsage(options: Readonly<Record<string, unknown>>) {
  const parsed = schema.safeParse(options);
  if (!parsed.success) throw new ConfigError(`Invalid ocquota plugin options: ${parsed.error.message}`);
  const input = parsed.data;
  const config = new ConfigStore().load({
    source: "opencode", dbPath: input.dbPath, window: input.window, timezone: input.timezone,
    metric: input.metric, limitTokens: input.limitTokens?.toString(), refreshMs: input.refreshMs?.toString(),
    limitCost: input.limitCost === null ? "none" : input.limitCost?.toString(),
  });
  const timeZone = createTimeZone(config.timezone);
  const window = createWindow(config.window, timeZone);
  const db = new SqliteDatabase(config.dbPath, { busyTimeoutMs: 0, retryBusy: false });
  const repository = new SqliteUsageRepository(db);
  const tracker = new IncrementalUsageTracker(repository, window);
  const service = new QuotaService(repository, window, { tokens: config.limitTokens, cost: config.limitCost }, config.metric, Date.now, tracker);
  return { config, motion: input.motion !== false && process.env["OCQUOTA_REDUCED_MOTION"] !== "1",
    refresh: () => service.snapshot(), close: () => db.close() };
}
