import pc from "picocolors";
import { ConfigStore, type CliOverrides, type QuotaConfig } from "./config/config-store.ts";
import { createTimeZone } from "./core/timezone.ts";
import type { TimeZone } from "./core/time.ts";
import { SqliteDatabase } from "./data/database.ts";
import { SqliteUsageRepository } from "./data/sqlite-usage-repository.ts";
import { CodexUsageRepository } from "./data/codex-usage-repository.ts";
import type { UsageRepository } from "./data/repository.ts";
import { ConfigError } from "./core/errors.ts";
import { IncrementalUsageTracker } from "./domain/incremental-tracker.ts";
import { QuotaService } from "./domain/quota-service.ts";
import { createWindow } from "./domain/window.ts";
import { FullRenderer } from "./render/full-renderer.ts";
import { OneLineRenderer } from "./render/one-line-renderer.ts";
import { ProgressBar } from "./render/progress-bar.ts";
import { ThemeRenderer } from "./render/theme-renderer.ts";
import type { Renderer, RendererColors } from "./render/renderer.ts";

export const COLORS = pc satisfies RendererColors;

export interface App {
  config: QuotaConfig;
  close: () => void;
  repository: UsageRepository;
  tracker: IncrementalUsageTracker;
  service: QuotaService;
  timeZone: TimeZone;
}

export interface RawOptions {
  db?: string | undefined;
  source?: string | undefined;
  codexHome?: string | undefined;
  window?: string | undefined;
  limit?: string | undefined;
  limitCost?: string | undefined;
  metric?: string | undefined;
  refresh?: string | undefined;
  tz?: string | undefined;
  days?: string | undefined;
  n?: string | undefined;
  theme?: string | undefined;
  motion?: boolean | undefined;
  animation?: string | undefined;
  speed?: string | undefined;
}

export function buildApp(options: RawOptions, incremental = false): App {
  const cliOverrides: CliOverrides = {
    dbPath: options.db,
    source: options.source,
    codexHome: options.codexHome,
    window: options.window,
    limitTokens: options.limit,
    limitCost: options.limitCost,
    metric: options.metric,
    refreshMs: options.refresh,
    timezone: options.tz,
    theme: options.theme,
  };
  const config = new ConfigStore().load(cliOverrides);
  if (config.source === "codex" && config.metric === "cost") {
    throw new ConfigError("Codex session logs do not report billed dollar cost. Use --metric tokens with --source codex.");
  }
  const timeZone = createTimeZone(config.timezone);
  const window = createWindow(config.window, timeZone);
  const db = config.source === "opencode" ? new SqliteDatabase(config.dbPath) : undefined;
  const repository: UsageRepository = db ? new SqliteUsageRepository(db) : new CodexUsageRepository(config.codexHome);
  const tracker = new IncrementalUsageTracker(repository, window);
  const service = new QuotaService(
    repository,
    window,
    { tokens: config.limitTokens, cost: config.limitCost },
    config.metric,
    Date.now,
    incremental && config.source === "opencode" ? tracker : undefined,
  );
  return { config, close: () => db?.close(), repository, tracker, service, timeZone };
}

export function withApp(run: (app: App) => void): (options: RawOptions) => void {
  return (options) => {
    const app = buildApp(options);
    try {
      run(app);
    } finally {
      app.close();
    }
  };
}

export function fullRenderer(app: App, watch = false): Renderer {
  if (app.config.theme !== "raw") {
    return new ThemeRenderer({
      theme: app.config.theme, timeZone: app.timeZone, color: COLORS.isColorSupported, watch,
      limitConfigured: app.config.metric !== "cost" || app.config.limitCost !== null,
    });
  }
  return new FullRenderer({
    bar: new ProgressBar(app.config.barWidth),
    colors: COLORS,
    timeZone: app.timeZone,
  });
}

export function oneLineRenderer(app: App): Renderer {
  return new OneLineRenderer({ bar: new ProgressBar(app.config.barWidth), colors: COLORS });
}

export function writeLine(text: string): void {
  process.stdout.write(`${text}\n`);
}
