/**
 * Config shape, its zod schema and the built-in defaults. Split out so both
 * the store and the override parsers can share them without an import cycle.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { QUOTA_METRICS, WINDOW_KINDS, type QuotaMetric, type WindowKind } from "../core/types.ts";
import { systemTimeZoneId } from "../core/timezone.ts";

export interface QuotaConfig {
  /** absolute path to OpenCode's SQLite database */
  dbPath: string;
  window: WindowKind;
  limitTokens: number;
  /** USD cap; null means "no cost cap configured" */
  limitCost: number | null;
  metric: QuotaMetric;
  /** watch-mode refresh interval */
  refreshMs: number;
  barWidth: number;
  /** IANA zone ("Asia/Kolkata") or fixed offset ("+05:30") for window boundaries */
  timezone: string;
}

/** Every setting optional: this is exactly what the file on disk may contain. */
export const fileSchema = z
  .object({
    dbPath: z.string().min(1).optional(),
    window: z.enum(WINDOW_KINDS as [WindowKind, ...WindowKind[]]).optional(),
    limitTokens: z.number().int().positive().optional(),
    limitCost: z.number().nonnegative().nullable().optional(),
    metric: z.enum(QUOTA_METRICS as [QuotaMetric, ...QuotaMetric[]]).optional(),
    refreshMs: z.number().int().min(250).optional(),
    barWidth: z.number().int().min(8).max(200).optional(),
    timezone: z.string().min(1).optional(),
    /**
     * Deprecated since the DST fix: a fixed offset cannot track a DST change.
     * Still accepted so existing config files keep working.
     */
    timezoneOffsetMinutes: z.number().int().min(-840).max(840).optional(),
  })
  .strict();

export type FileConfig = z.infer<typeof fileSchema>;

/** Built-in defaults; the first-run file is written from this. */
export const DEFAULT_CONFIG: QuotaConfig = {
  dbPath: join(homedir(), ".local", "share", "opencode", "opencode.db"),
  window: "day",
  limitTokens: 5_000_000,
  limitCost: null,
  metric: "tokens",
  refreshMs: 2_000,
  barWidth: 28,
  timezone: systemTimeZoneId(),
};
