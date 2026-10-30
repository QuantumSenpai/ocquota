/**
 * ConfigStore — loads ~/.config/ocquota/config.json, validates it with zod,
 * layers environment (OCQUOTA_*) and CLI overrides on top, and writes a
 * defaults file on first run so there is always something to edit.
 *
 * Precedence: CLI > env > config file > built-in defaults.
 * The file is validated by zod; env/CLI strings go through the typed parsers in
 * overrides.ts, so every layer rejects bad input naming the knob at fault.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ConfigError } from "../core/errors.ts";
import { createTimeZone } from "../core/timezone.ts";
import { parseCliOverrides, parseEnvOverrides, type CliOverrides } from "./overrides.ts";
import { DEFAULT_CONFIG, fileSchema, type FileConfig, type QuotaConfig } from "./schema.ts";

export type { CliOverrides } from "./overrides.ts";
export type { QuotaConfig } from "./schema.ts";

interface ConfigStoreOptions {
  /** path to the JSON config file (default: ~/.config/ocquota/config.json) */
  configPath?: string | undefined;
  env?: Readonly<Record<string, string | undefined>> | undefined;
  homeDir?: string | undefined;
}

export class ConfigStore {
  constructor(private readonly options: ConfigStoreOptions = {}) {}

  load(cli: CliOverrides = {}): QuotaConfig {
    const configPath = this.options.configPath ?? defaultConfigPath(this.options.homeDir ?? homedir());
    const file = this.readFileConfig(configPath);

    const config: QuotaConfig = {
      ...DEFAULT_CONFIG,
      ...fromFile(file),
      ...parseEnvOverrides(this.options.env ?? process.env),
      ...parseCliOverrides(cli),
    };
    validateTimeZone(config.timezone);

    if (!existsSync(configPath)) writeDefaultsFile(configPath);
    return config;
  }

  private readFileConfig(configPath: string): FileConfig {
    if (!existsSync(configPath)) return {};
    let raw: string;
    try {
      raw = readFileSync(configPath, "utf8");
    } catch (cause) {
      throw new ConfigError(`Cannot read the config file at ${configPath}.`, { cause });
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (cause) {
      throw new ConfigError(`The config file at ${configPath} is not valid JSON (${String(cause)}).`, { cause });
    }
    const result = fileSchema.safeParse(json);
    if (!result.success) {
      throw new ConfigError(`Invalid config file ${configPath}:\n${formatIssues(result.error.issues)}`);
    }
    return result.data;
  }
}

function defaultConfigPath(homeDir: string): string {
  return join(homeDir, ".config", "ocquota", "config.json");
}

/** FileConfig -> overrides, translating the deprecated fixed-offset key. */
function fromFile(file: FileConfig): Partial<QuotaConfig> {
  const out: Partial<QuotaConfig> = {};
  if (file.dbPath !== undefined) out.dbPath = file.dbPath;
  if (file.window !== undefined) out.window = file.window;
  if (file.metric !== undefined) out.metric = file.metric;
  if (file.limitTokens !== undefined) out.limitTokens = file.limitTokens;
  if (file.limitCost !== undefined) out.limitCost = file.limitCost;
  if (file.refreshMs !== undefined) out.refreshMs = file.refreshMs;
  if (file.barWidth !== undefined) out.barWidth = file.barWidth;
  if (file.timezone !== undefined) out.timezone = file.timezone;
  else if (file.timezoneOffsetMinutes !== undefined) out.timezone = formatOffset(file.timezoneOffsetMinutes);
  return out;
}

/** Fail fast with a friendly message instead of a crash inside Intl. */
function validateTimeZone(timezone: string): void {
  try {
    createTimeZone(timezone);
  } catch (cause) {
    throw new ConfigError(cause instanceof Error ? cause.message : String(cause), { cause });
  }
}

function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

function formatIssues(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string {
  return issues
    .map((issue) => {
      const key = issue.path.map(String).join(".");
      return key === "" ? `  - ${issue.message}` : `  - ${key}: ${issue.message}`;
    })
    .join("\n");
}

/** First run: persist defaults so the user has an editable file. Never fatal. */
function writeDefaultsFile(configPath: string): void {
  try {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, { flag: "wx" });
  } catch {
    /* convenience only: a read-only HOME must not break the CLI */
  }
}
