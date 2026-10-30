#!/usr/bin/env bun
/**
 * ocquota CLI — thin wiring only: parse flags, build the object graph with
 * constructor injection, hand it to a renderer, run. No business logic here.
 */

import { cac } from "cac";
import pc from "picocolors";
import pkg from "../package.json";
import { ConfigStore, type CliOverrides, type QuotaConfig } from "./config/config-store.ts";
import { OcquotaError } from "./core/errors.ts";
import { createTimeZone } from "./core/timezone.ts";
import type { TimeZone } from "./core/time.ts";
import { SqliteDatabase } from "./data/database.ts";
import { SqliteUsageRepository } from "./data/sqlite-usage-repository.ts";
import { QuotaService } from "./domain/quota-service.ts";
import { createWindow } from "./domain/window.ts";
import { FullRenderer } from "./render/full-renderer.ts";
import { JsonRenderer } from "./render/json-renderer.ts";
import { OneLineRenderer } from "./render/one-line-renderer.ts";
import { ProgressBar } from "./render/progress-bar.ts";
import type { Renderer, RendererColors } from "./render/renderer.ts";
import { WatchLoop } from "./render/watch-loop.ts";

/** picocolors satisfies RendererColors structurally. */
const COLORS: RendererColors = pc;

interface App {
  config: QuotaConfig;
  db: SqliteDatabase;
  repository: SqliteUsageRepository;
  service: QuotaService;
  timeZone: TimeZone;
}

interface RawOptions {
  db?: string | undefined;
  window?: string | undefined;
  limit?: string | undefined;
  limitCost?: string | undefined;
  metric?: string | undefined;
  refresh?: string | undefined;
  tz?: string | undefined;
}

/** Config -> connection -> repository -> service; the only place objects are built. */
function buildApp(options: RawOptions): App {
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
  const repository = new SqliteUsageRepository(db);
  const service = new QuotaService(
    repository,
    createWindow(config.window, timeZone),
    { tokens: config.limitTokens, cost: config.limitCost },
    config.metric,
  );
  return { config, db, repository, service, timeZone };
}

/** Build an action that always closes the connection, success or failure. */
function withApp(run: (app: App) => void): (options: RawOptions) => void {
  return (options) => {
    const app = buildApp(options);
    try {
      run(app);
    } finally {
      app.db.close();
    }
  };
}

function fullRenderer(app: App): Renderer {
  return new FullRenderer({
    bar: new ProgressBar(app.config.barWidth),
    colors: COLORS,
    timeZone: app.timeZone,
  });
}

function oneLineRenderer(app: App): Renderer {
  return new OneLineRenderer({ bar: new ProgressBar(app.config.barWidth), colors: COLORS });
}

function printFull(app: App): void {
  process.stdout.write(`${fullRenderer(app).render(app.service.snapshot())}\n`);
}

function main(): void {
  const cli = cac("ocquota");

  cli.option("--db <path>", "Path to OpenCode's SQLite database (default: OCQUOTA_DB or ~/.local/share/opencode/opencode.db)");
  cli.option("--window <kind>", "Reset cadence: day | week | month");
  cli.option("--limit <tokens>", "Token limit for the window");
  cli.option("--limit-cost <usd>", 'Cost limit in USD, or "none" to clear it');
  cli.option("--metric <metric>", "What the limit counts: tokens | cost");
  cli.option("--refresh <ms>", "Watch-mode refresh interval in ms");
  cli.option("--tz <zone>", 'IANA zone or offset, e.g. "Asia/Kolkata" or "+05:30"');

  cli.command("", "Show the quota bar (default)").action(withApp(printFull));
  cli.command("bar", "Show the quota bar (alias of the default command)").action(withApp(printFull));

  cli.command("watch", "Refresh the quota bar until Ctrl-C").action((options: RawOptions) => {
    const app = buildApp(options);
    new WatchLoop({
      render: () => fullRenderer(app).render(app.service.snapshot()),
      refreshMs: app.config.refreshMs,
      colors: COLORS,
      onClose: () => app.db.close(),
    }).start();
  });

  cli.command("oneline", "Print a single status line").action(
    withApp((app) => {
      process.stdout.write(`${oneLineRenderer(app).render(app.service.snapshot())}\n`);
    }),
  );

  cli.command("json", "Print the snapshot as JSON").action(
    withApp((app) => {
      process.stdout.write(`${new JsonRenderer().render(app.service.snapshot())}\n`);
    }),
  );

  cli.command("explain", "Print the query plan for the window aggregation").action(
    withApp((app) => {
      process.stdout.write(`${pc.bold("EXPLAIN QUERY PLAN (window usage query)")}\n`);
      for (const line of app.repository.explainUsageInRange()) process.stdout.write(`  ${line}\n`);
    }),
  );

  cli.help();
  cli.version(pkg.version);
  cli.parse();
}

try {
  main();
} catch (error) {
  if (error instanceof OcquotaError) {
    process.stderr.write(`ocquota: ${error.message}\n`);
    process.exit(1);
  }
  throw error;
}
