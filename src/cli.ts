#!/usr/bin/env bun
import { cac } from "cac";
import pkg from "../package.json";
import { COLORS, buildApp, fullRenderer, oneLineRenderer, withApp, writeLine, type App, type RawOptions } from "./app.ts";
import { ConfigError, OcquotaError } from "./core/errors.ts";
import { nextDayStart, startOfDayOffset } from "./core/time.ts";
import { JsonRenderer } from "./render/json-renderer.ts";
import { renderDaily, renderModels, renderSessions, renderTotals } from "./render/report-renderer.ts";
import { WatchLoop } from "./render/watch-loop.ts";
import { ThemeRenderer, DEMO_SNAPSHOT } from "./render/theme-renderer.ts";
import { ConfigStore } from "./config/config-store.ts";
import { createTimeZone } from "./core/timezone.ts";
import { THEME_NAMES, type QuotaSnapshot } from "./core/types.ts";
import { DEFAULT_CONFIG } from "./config/schema.ts";
import { FullRenderer } from "./render/full-renderer.ts";
import { ProgressBar } from "./render/progress-bar.ts";
import { installOpenCode } from "./opencode/install.ts";
import { installCodex } from "./codex/install.ts";

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
  cli.option("--source <name>", "Usage source: opencode | codex (default opencode)");
  cli.option("--codex-home <path>", "Codex home directory (default CODEX_HOME or ~/.codex)");
  cli.option("--window <kind>", "Reset cadence: day | week | month");
  cli.option("--limit <tokens>", "Token limit for the window");
  cli.option("--limit-cost <usd>", 'Cost limit in USD, or "none" to clear it');
  cli.option("--metric <metric>", "What the limit counts: tokens | cost");
  cli.option("--refresh <ms>", "Watch-mode refresh interval in ms");
  cli.option("--tz <zone>", 'IANA zone or offset, e.g. "Asia/Kolkata" or "+05:30"');
  cli.option("--days <n>", "daily: how many local days to show (default 7)");
  cli.option("--n <rows>", "top: how many sessions to show (default 5)");
  cli.option("--theme <name>", "Workspace style: aurora | ember | mono | raw (default aurora)");
  cli.option("--no-motion", "Disable watch-mode animation");

  cli.command("opencode-install", "Install native themes and quota stats inside OpenCode 2.3+").action((options: RawOptions) => {
    const theme = options.theme ?? "aurora";
    if (theme !== "aurora" && theme !== "ember" && theme !== "mono") throw new ConfigError("Native OpenCode theme must be aurora, ember or mono.");
    const result = installOpenCode({ theme, ...(options.motion === false ? { motion: false } : {}) });
    writeLine(`Native OpenCode integration installed.\nConfig: ${result.configPath}\nRestart OpenCode, then use /ocquota or /themes.\nPrevious settings were backed up alongside cli.json.`);
  });

  cli.command("codex-install", "Install native themes and live status-line stats inside Codex CLI").action((options: RawOptions) => {
    const theme = options.theme ?? "aurora";
    if (theme !== "aurora" && theme !== "ember" && theme !== "mono") throw new ConfigError("Native Codex theme must be aurora, ember or mono.");
    const result = installCodex({ theme, ...(options.codexHome ? { codexHome: options.codexHome } : {}), ...(options.motion === false ? { motion: false } : {}) });
    writeLine(`Native Codex themes and status-line stats installed.\nConfig: ${result.configPath}\nRestart Codex, then use /theme, /statusline or /status.${result.backupPath ? `\nBackup: ${result.backupPath}` : ""}\nThemes style syntax, diffs and the native footer. Stats use Codex's live session data.`);
  });

  cli.command("themes", "List available workspace themes").action(() => {
    writeLine("aurora  Cyan and violet · spacious usage overview\nember   Amber and coral · budget and focus\nmono    Neutral ink · compact and quiet\nraw     Original quota bar\n\nPreview: ocquota preview --theme aurora");
  });
  cli.command("preview", "Preview a theme using sample data; no database required").action((options: RawOptions) => {
    const { theme, source } = new ConfigStore().load({ theme: options.theme, source: options.source });
    const sample = { ...DEMO_SNAPSHOT, source, costAvailable: source !== "codex" };
    writeLine(COLORS.dim("SAMPLE DATA · theme preview\n"));
    if (theme === "raw") {
      writeLine(new FullRenderer({ bar: new ProgressBar(DEFAULT_CONFIG.barWidth), colors: COLORS, timeZone: createTimeZone("UTC") }).render(sample));
    } else {
      writeLine(new ThemeRenderer({ theme, timeZone: createTimeZone("UTC"), color: COLORS.isColorSupported }).render(sample));
    }
    writeLine(COLORS.dim(`\nThemes: ${THEME_NAMES.join(" · ")}\nUse: ocquota watch --source ${source} --theme ${theme}`));
  });

  cli.command("", "Show the quota bar (default)").action(withApp((app) => writeLine(fullRenderer(app).render(app.service.snapshot()))));
  cli.command("bar", "Show the quota bar (alias of the default command)").action(withApp((app) => writeLine(fullRenderer(app).render(app.service.snapshot()))));

  cli.command("watch", "Refresh the quota bar until Ctrl-C").action((options: RawOptions) => {
    const app = buildApp(options, true);
    const renderer = fullRenderer(app, true);
    let snapshot: QuotaSnapshot;
    let frame = 0;
    const motion = process.stdout.isTTY && app.config.theme !== "raw" && options.motion !== false && process.env["OCQUOTA_REDUCED_MOTION"] !== "1" && process.env["TERM"] !== "dumb";
    const loop = new WatchLoop({
      render: () => {
        snapshot = app.service.snapshot();
        return renderer.render(snapshot, motion ? frame : undefined);
      },
      ...(motion ? { animate: () => renderer.render(snapshot, ++frame) } : {}),
      refreshMs: app.config.refreshMs,
      colors: COLORS,
      onClose: () => app.close(),
    });
    loop.start();
  });

  cli.command("oneline", "Print a single status line").action(report((app) => oneLineRenderer(app).render(app.service.snapshot())));
  cli.command("json", "Print the snapshot as JSON").action(report((app) => new JsonRenderer().render(app.service.snapshot())));

  cli.command("totals", "Exact per-message totals for the current window").action(
    report((app) => renderTotals(app.repository.totalsSince(app.service.range().start), COLORS, app.timeZone, app.config.source)),
  );

  cli.command("models", "Per-model totals for the current window, heaviest first").action(
    report((app) => renderModels(app.repository.totalsByModel(app.service.range().start), COLORS, app.config.source)),
  );

  cli.command("daily", "One bucket per local day").action((options: RawOptions) => {
    const days = intOption(options.days, "--days", 7, 366);
    withApp((app) => {
      const range = dailyRange(app, days);
      writeLine(renderDaily(app.repository.dailyBuckets(range.from, range.to, app.timeZone), COLORS, app.timeZone, app.config.source));
    })(options);
  });

  cli.command("top", "Heaviest sessions in the current window").action((options: RawOptions) => {
    const n = intOption(options.n, "--n", 5, 1_000);
    withApp((app) => writeLine(renderSessions(app.repository.topSessions(app.service.range().start, n), COLORS, app.timeZone, app.config.source)))(options);
  });

  cli.command("explain", "Show SQL query plans or the source's read strategy").action(
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
