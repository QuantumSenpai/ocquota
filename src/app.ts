import pc from "picocolors";
import { ConfigStore, type CliOverrides, type QuotaConfig } from "./config/config-store.ts";
import { createTimeZone } from "./core/timezone.ts";
import type { TimeZone } from "./core/time.ts";
import { SqliteDatabase } from "./data/database.ts";
import { SqliteUsageRepository } from "./data/sqlite-usage-repository.ts";
import { IncrementalUsageTracker } from "./domain/incremental-tracker.ts";
import { QuotaService } from "./domain/quota-service.ts";
import { createWindow } from "./domain/window.ts";
import { FullRenderer } from "./render/full-renderer.ts";
import { OneLineRenderer } from "./render/one-line-renderer.ts";
import { ProgressBar } from "./render/progress-bar.ts";
import type { Renderer, RendererColors } from "./render/renderer.ts";

export const COLORS: RendererColors = pc;

export interface App {
  config: QuotaConfig;
  db: SqliteDatabase;
  repository: SqliteUsageRepository;
  tracker: IncrementalUsageTracker;
  service: QuotaService;
  timeZone: TimeZone;
}

export interface RawOptions {
  db?: string | undefined;
  window?: string | undefined;
  limit?: string | undefined;
  limitCost?: string | undefined;
  metric?: string | undefined;
  refresh?: string | undefined;
  tz?: string | undefined;
  days?: string | undefined;
  n?: string | undefined;
}

export function buildApp(options: RawOptions, incremental = false): App {
  const cliOverrides: CliOverrides = {
    dbPath: options.db,
    window: options.window,
    limitTokens: options.limit,
    limitCost: options.limitCost,
    metric: options.metric,
    refreshMs: options.refresh,
    timezone: options.tz,
  };
  const config = new ConfigStore().load(cliOverrides);
  const db = new SqliteDatabase(config.dbPath);
  const timeZone = createTimeZone(config.timezone);
  const window = createWindow(config.window, timeZone);
  const repository = new SqliteUsageRepository(db);
  const tracker = new IncrementalUsageTracker(repository, window);
  const service = new QuotaService(
    repository,
    window,
    { tokens: config.limitTokens, cost: config.limitCost },
    config.metric,
    Date.now,
    incremental ? tracker : undefined,
  );
  return { config, db, repository, tracker, service, timeZone };
}

export function withApp(run: (app: App) => void): (options: RawOptions) => void {
  return (options) => {
    const app = buildApp(options);
    try {
      run(app);
    } finally {
      app.db.close();
    }
  };
}

export function fullRenderer(app: App): Renderer {
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
