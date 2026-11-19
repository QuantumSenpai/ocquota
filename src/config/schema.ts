import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { QUOTA_METRICS, WINDOW_KINDS, THEME_NAMES, USAGE_SOURCES, type UsageSource, type ThemeName, type QuotaMetric, type WindowKind } from "../core/types.ts";
import { systemTimeZoneId } from "../core/timezone.ts";

export interface QuotaConfig {
  dbPath: string;
  source: UsageSource;
  codexHome: string;
  window: WindowKind;
  limitTokens: number;
  limitCost: number | null;
  metric: QuotaMetric;
  refreshMs: number;
  barWidth: number;
  timezone: string;
  theme: ThemeName;
}

export const fileSchema = z
  .object({
    dbPath: z.string().trim().min(1).optional(),
    source: z.enum(USAGE_SOURCES).optional(),
    codexHome: z.string().trim().min(1).optional(),
    window: z.enum(WINDOW_KINDS as [WindowKind, ...WindowKind[]]).optional(),
    limitTokens: z.number().int().positive().optional(),
    limitCost: z.number().nonnegative().nullable().optional(),
    metric: z.enum(QUOTA_METRICS as [QuotaMetric, ...QuotaMetric[]]).optional(),
    refreshMs: z.number().int().min(250).optional(),
    barWidth: z.number().int().min(8).max(200).optional(),
    timezone: z.string().trim().min(1).optional(),
    theme: z.enum(THEME_NAMES).optional(),
    /** Legacy fixed-offset config key; kept for backwards compatibility. */
    timezoneOffsetMinutes: z.number().int().min(-840).max(840).optional(),
  })
  .strict();

export type FileConfig = z.infer<typeof fileSchema>;

export const DEFAULT_CONFIG: QuotaConfig = {
  dbPath: join(homedir(), ".local", "share", "opencode", "opencode.db"),
  source: "opencode",
  codexHome: join(homedir(), ".codex"),
  window: "day",
  limitTokens: 5_000_000,
  limitCost: null,
  metric: "tokens",
  refreshMs: 2_000,
  barWidth: 28,
  timezone: systemTimeZoneId(),
  theme: "aurora",
};
