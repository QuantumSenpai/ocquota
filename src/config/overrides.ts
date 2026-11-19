import { ConfigError } from "../core/errors.ts";
import { QUOTA_METRICS, WINDOW_KINDS, THEME_NAMES, USAGE_SOURCES } from "../core/types.ts";
import type { QuotaConfig } from "./schema.ts";

export interface CliOverrides {
  dbPath?: string | undefined;
  source?: string | undefined;
  codexHome?: string | undefined;
  window?: string | undefined;
  limitTokens?: string | undefined;
  limitCost?: string | undefined;
  metric?: string | undefined;
  refreshMs?: string | undefined;
  timezone?: string | undefined;
  theme?: string | undefined;
}

type PartialConfig = Partial<QuotaConfig>;

export function parseCliOverrides(cli: CliOverrides): PartialConfig {
  const out: PartialConfig = {};
  take(out, "dbPath", cli.dbPath, "--db", parseNonEmpty);
  take(out, "source", cli.source, "--source", parseEnumOf(USAGE_SOURCES));
  take(out, "codexHome", cli.codexHome, "--codex-home", parseNonEmpty);
  take(out, "window", cli.window, "--window", parseEnumOf(WINDOW_KINDS));
  take(out, "metric", cli.metric, "--metric", parseEnumOf(QUOTA_METRICS));
  take(out, "limitTokens", cli.limitTokens, "--limit", parsePositiveInt);
  take(out, "limitCost", cli.limitCost, "--limit-cost", parseCost);
  take(out, "refreshMs", cli.refreshMs, "--refresh", parseRefreshMs);
  take(out, "timezone", cli.timezone, "--tz", parseNonEmpty);
  take(out, "theme", cli.theme, "--theme", parseEnumOf(THEME_NAMES));
  return out;
}

export function parseEnvOverrides(env: Readonly<Record<string, string | undefined>>): PartialConfig {
  const out: PartialConfig = {};
  take(out, "dbPath", env["OCQUOTA_DB"], "--db / OCQUOTA_DB", parseNonEmpty);
  take(out, "source", env["OCQUOTA_SOURCE"], "--source / OCQUOTA_SOURCE", parseEnumOf(USAGE_SOURCES));
  take(out, "codexHome", env["OCQUOTA_CODEX_HOME"] || env["CODEX_HOME"], "--codex-home / OCQUOTA_CODEX_HOME / CODEX_HOME", parseNonEmpty);
  take(out, "window", env["OCQUOTA_WINDOW"], "--window / OCQUOTA_WINDOW", parseEnumOf(WINDOW_KINDS));
  take(out, "metric", env["OCQUOTA_METRIC"], "--metric / OCQUOTA_METRIC", parseEnumOf(QUOTA_METRICS));
  take(out, "limitTokens", env["OCQUOTA_LIMIT"], "--limit / OCQUOTA_LIMIT", parsePositiveInt);
  take(out, "limitCost", env["OCQUOTA_LIMIT_COST"], "--limit-cost / OCQUOTA_LIMIT_COST", parseCost);
  take(out, "refreshMs", env["OCQUOTA_REFRESH_MS"], "--refresh / OCQUOTA_REFRESH_MS", parseRefreshMs);
  take(out, "barWidth", env["OCQUOTA_BAR_WIDTH"], "OCQUOTA_BAR_WIDTH", parseBarWidth);
  take(out, "timezone", env["OCQUOTA_TZ"], "--tz / OCQUOTA_TZ", parseNonEmpty);
  take(out, "theme", env["OCQUOTA_THEME"], "--theme / OCQUOTA_THEME", parseEnumOf(THEME_NAMES));
  return out;
}

function take<K extends keyof QuotaConfig>(
  target: PartialConfig,
  key: K,
  raw: string | undefined,
  setting: string,
  parse: (raw: string, setting: string) => QuotaConfig[K],
): void {
  if (raw === undefined || raw === "") return;
  target[key] = parse(String(raw), setting);
}

function parseNonEmpty(raw: string, setting: string): string {
  if (raw.trim() === "") throw new ConfigError(`${setting} must not be empty.`);
  return raw;
}

function parsePositiveInt(raw: string, setting: string): number {
  return parseInteger(raw, setting, (n) => n > 0);
}

function parseRefreshMs(raw: string, setting: string): number {
  return parseInteger(raw, setting, (n) => n >= 250);
}

function parseBarWidth(raw: string, setting: string): number {
  return parseInteger(raw, setting, (n) => n >= 8 && n <= 200);
}

function parseInteger(raw: string, setting: string, accept: (n: number) => boolean): number {
  const value = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(value) || !Number.isInteger(value) || !accept(value)) {
    throw new ConfigError(`${setting} expects a whole number in range, got "${raw}".`);
  }
  return value;
}

function parseEnumOf<T extends string>(allowed: readonly T[]) {
  return (raw: string, setting: string): T => {
    if ((allowed as readonly string[]).includes(raw)) return raw as T;
    throw new ConfigError(`${setting} expects one of ${allowed.join(", ")}, got "${raw}".`);
  };
}

function parseCost(raw: string, setting: string): number | null {
  if (raw === "none") return null;
  const value = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(value) || value < 0) {
    throw new ConfigError(`${setting} expects a non-negative number or "none", got "${raw}".`);
  }
  return value;
}
