#!/usr/bin/env bun
import { cac } from "cac";
import pkg from "../package.json";
import { COLORS, buildApp, fullRenderer, oneLineRenderer, withApp, writeLine, type App, type RawOptions } from "./app.ts";
import { ConfigError, OcquotaError } from "./core/errors.ts";
import { nextDayStart, startOfDayOffset } from "./core/time.ts";
import { JsonRenderer } from "./render/json-renderer.ts";
import { renderDaily, renderModels, renderSessions, renderTotals } from "./render/report-renderer.ts";
import { WatchLoop } from "./render/watch-loop.ts";

function report(render: (app: App) => string): (options: RawOptions) => void {
  return withApp((app) => writeLine(render(app)));
}

function intOption(raw: string | undefined, flag: string, fallback: number, max: number): number {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new ConfigError(`${flag} expects a whole number between 1 and ${max}, got "${raw}".`);
  }
  return value;
}

function dailyRange(app: App, days: number): { from: number; to: number } {
  const now = Date.now();
  return {
    from: startOfDayOffset(app.timeZone, now, days - 1),
    to: nextDayStart(app.timeZone, now),
  };
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
  cli.option("--days <n>", "daily: how many local days to show (default 7)");
  cli.option("--n <rows>", "top: how many sessions to show (default 5)");

  cli.command("", "Show the quota bar (default)").action(withApp((app) => writeLine(fullRenderer(app).render(app.service.snapshot()))));
  cli.command("bar", "Show the quota bar (alias of the default command)").action(withApp((app) => writeLine(fullRenderer(app).render(app.service.snapshot()))));

  cli.command("watch", "Refresh the quota bar until Ctrl-C").action((options: RawOptions) => {
    const app = buildApp(options, true);
    const loop = new WatchLoop({
      render: () => fullRenderer(app).render(app.service.snapshot()),
      refreshMs: app.config.refreshMs,
      colors: COLORS,
      onClose: () => app.db.close(),
    });
    loop.start();
  });

  cli.command("oneline", "Print a single status line").action(report((app) => oneLineRenderer(app).render(app.service.snapshot())));
  cli.command("json", "Print the snapshot as JSON").action(report((app) => new JsonRenderer().render(app.service.snapshot())));

  cli.command("totals", "Exact per-message totals for the current window").action(
    report((app) => renderTotals(app.repository.totalsSince(app.service.range().start), COLORS, app.timeZone)),
  );

  cli.command("models", "Per-model totals for the current window, heaviest first").action(
    report((app) => renderModels(app.repository.totalsByModel(app.service.range().start), COLORS)),
  );

  cli.command("daily", "One bucket per local day").action((options: RawOptions) => {
    const days = intOption(options.days, "--days", 7, 366);
    withApp((app) => {
      const range = dailyRange(app, days);
      writeLine(renderDaily(app.repository.dailyBuckets(range.from, range.to, app.timeZone), COLORS, app.timeZone));
    })(options);
  });

  cli.command("top", "Heaviest sessions in the current window").action((options: RawOptions) => {
    const n = intOption(options.n, "--n", 5, 1_000);
    withApp((app) => writeLine(renderSessions(app.repository.topSessions(app.service.range().start, n), COLORS, app.timeZone)))(options);
  });

  cli.command("explain", "Print EXPLAIN QUERY PLAN for every repository query").action(
    withApp((app) => {
      for (const plan of app.repository.explainAll()) {
        writeLine(COLORS.bold(plan.name));
        for (const line of plan.lines) writeLine(`  ${line}`);
      }
    }),
  );

  cli.help();
  cli.version(pkg.version);
  cli.parse();
}

try {
  main();
} catch (error) {
  if (process.env["OCQUOTA_DEBUG"] === "1") throw error;
  if (error instanceof OcquotaError) {
    process.stderr.write(`ocquota: ${error.message}\n`);
    process.exit(1);
  }
  if (error instanceof Error && error.name === "CACError") {
    process.stderr.write(`ocquota: ${error.message}. Run ocquota --help\n`);
    process.exit(1);
  }
  throw error;
}
