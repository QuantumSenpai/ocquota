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
import { WORKSPACE_THEMES, palettes } from "./core/themes.ts";
import { motionOptions, renderMotion, MotionControls } from "./render/motion.ts";
import { fetchAccount } from "./account/providers.ts";
import { codexCredential } from "./account/codex.ts";
import { type AccountSnapshot } from "./account/types.ts";
import { AccountCache } from "./account/cache.ts";
import { PanelRenderer } from "./render/panel-renderer.ts";
import { CodexUsageRepository } from "./data/codex-usage-repository.ts";
import { createHash } from "node:crypto";
import { openCompanion } from "./render/companion.ts";
import { installCodex } from "./codex/install.ts";

function isWorkspaceTheme(name: string): name is (typeof WORKSPACE_THEMES)[number] { return (WORKSPACE_THEMES as readonly string[]).includes(name); }
function sceneOptions(options: RawOptions, theme: string) {
  const animation = options.animation ?? process.env["OCQUOTA_ANIMATION"] ?? (isWorkspaceTheme(theme) ? palettes[theme].motion : "sakura");
  const rawSpeed = String(options.speed ?? process.env["OCQUOTA_SPEED"] ?? "1");
  const parsed = motionOptions.safeParse({ animation, speed: rawSpeed.trim() ? Number(rawSpeed) : NaN });
  if (!parsed.success) throw new ConfigError("Animation expects a listed scene and --speed between 0.25 and 3.");
  return parsed.data;
}

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
  cli.option("--theme <name>", "Workspace theme (run ocquota themes; default aurora)");
  cli.option("--link-codex-account", "Use your explicitly linked same-account Codex login for shared OpenAI allowance");
  cli.option("--animation <name>", "Scene: sakura | rain | leaves | wind | snow | fireflies | stars | bubbles | embers | waves");
  cli.option("--speed <number>", "Animation speed, 0.25 to 3 (default 1)");
  cli.option("--no-motion", "Disable watch-mode animation");

  cli.command("opencode-install", "Install native themes and quota stats inside OpenCode 2.3+").action((options: RawOptions) => {
    const theme = options.theme ?? "aurora";
    if (!isWorkspaceTheme(theme)) throw new ConfigError("Unknown workspace theme. Run ocquota themes.");
    const result = installOpenCode({ theme, ...sceneOptions(options, theme), ...(options.linkCodexAccount === undefined ? {} : { linkCodexAccount: options.linkCodexAccount }), ...(options.codexHome ? { codexHome: options.codexHome } : {}), ...(options.motion === false ? { motion: false } : {}) });
    writeLine(`Native OpenCode integration installed.\nConfig: ${result.configPath}\nRestart OpenCode, then use /ocquota or /themes.\nPrevious settings were backed up alongside cli.json.`);
  });

  cli.command("codex-install", "Install native themes and live status-line stats inside Codex CLI").action((options: RawOptions) => {
    const theme = options.theme ?? "aurora";
    if (!isWorkspaceTheme(theme)) throw new ConfigError("Unknown workspace theme. Run ocquota themes.");
    const scene = sceneOptions(options, theme);
    const result = installCodex({ theme, ...(options.codexHome ? { codexHome: options.codexHome } : {}), ...(options.motion === false ? { motion: false } : {}) });
    writeLine(`Native Codex themes and status-line stats installed.\nConfig: ${result.configPath}\nRestart Codex, then use /theme, /statusline or /status.${result.backupPath ? `\nBackup: ${result.backupPath}` : ""}\nThemes style syntax, diffs and the native footer. Stats use Codex's live session data.\nCustom scenes run in a separate companion pane: ocquota watch --source codex --theme ${theme} --animation ${scene.animation}`);
  });

  cli.command("themes", "List available workspace themes").action(() => {
    writeLine(WORKSPACE_THEMES.map((name) => `${name.padEnd(10)}${palettes[name].description}`).join("\n") + "\nraw       Original quota bar\n\nPreview: ocquota preview --theme sakura\nMotions: sakura, rain, leaves, wind, snow, fireflies, stars, bubbles, embers, waves");
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
    const scene = sceneOptions(options, theme);
    if (options.motion !== false && process.env["OCQUOTA_REDUCED_MOTION"] !== "1") writeLine(renderMotion(scene.animation, 1200 * scene.speed, 48, 4));
    writeLine(COLORS.dim(`\nThemes: ${THEME_NAMES.join(" · ")}\nUse: ocquota watch --source ${source} --theme ${theme}`));
  });

  cli.command("", "Show the quota bar (default)").action(withApp((app) => writeLine(fullRenderer(app).render(app.service.snapshot()))));
  cli.command("bar", "Show the quota bar (alias of the default command)").action(withApp((app) => writeLine(fullRenderer(app).render(app.service.snapshot()))));

  cli.command("pane", "Open a right-side Codex companion in Windows Terminal or tmux").action((options: RawOptions) => {
    const theme = options.theme ?? "sakura";
    if (!isWorkspaceTheme(theme)) throw new ConfigError("Choose a workspace theme for the companion pane.");
    const scene = sceneOptions(options, theme);
    writeLine(openCompanion(["panel", "--source", "codex", "--theme", theme, "--animation", scene.animation, "--speed", String(scene.speed),
      ...(options.codexHome ? ["--codex-home", options.codexHome] : []), ...(options.motion === false ? ["--no-motion"] : [])]));
  });
  cli.command("panel", "Compact account allowance and local usage for a Codex companion pane").action((options: RawOptions) => {
    if (options.source && options.source !== "codex") throw new ConfigError("Use OpenCode's native sidebar for provider-aware account statistics. This companion follows Codex.");
    const theme = options.theme ?? "sakura";
    if (!isWorkspaceTheme(theme)) throw new ConfigError("Choose a workspace theme for the companion panel.");
    const scene = sceneOptions(options, theme);
    const app = buildApp({ ...options, source: "codex", metric: "tokens", theme });
    const cache = new AccountCache();
    const shutdown = new AbortController();
    let account: AccountSnapshot | undefined;
    let currentKey = "";
    let generation = 0;
    const updateAccount = () => {
      const credential = codexCredential(app.config.codexHome);
      const key = createHash("sha256").update(credential?.type === "oauth" ? `${credential.accountId ?? ""}:${credential.access}` : "missing").digest("hex");
      if (key !== currentKey) { currentKey = key; generation++; account = undefined; cache.clear(); }
      const request = generation;
      return cache.read(key, () => fetchAccount("openai", credential, fetch, shutdown.signal)).then((result) => { if (!shutdown.signal.aborted && request === generation) account = result; });
    };
    const initialAccount = updateAccount();
    const accountTimer = setInterval(updateAccount, 30000);
    const controls = new MotionControls(scene.animation, scene.speed);
    const motion = Boolean(process.stdout.isTTY && options.motion !== false && process.env["OCQUOTA_REDUCED_MOTION"] !== "1" && process.env["TERM"] !== "dumb");
    const renderer = new PanelRenderer({ theme, color: COLORS.isColorSupported, account: () => account,
      model: () => app.repository instanceof CodexUsageRepository ? app.repository.latestModel() : undefined, controls, motion });
    let snapshot: QuotaSnapshot;
    const loop = new WatchLoop({ render: () => { snapshot = app.service.snapshot(); return renderer.render(snapshot); },
      ...(motion ? { animate: () => renderer.render(snapshot) } : {}), onKey: (key) => { controls.handle(key); }, refreshMs: app.config.refreshMs,
      colors: COLORS, onClose: () => { shutdown.abort(); clearInterval(accountTimer); cache.clear(); app.close(); },
    });
    if (process.stdout.isTTY && process.env["TERM"] !== "dumb") loop.start();
    else void initialAccount.then(() => loop.start()).catch(() => { shutdown.abort(); clearInterval(accountTimer); app.close(); process.stderr.write("ocquota: Could not render the local account panel.\n"); process.exitCode = 1; });
  });

  cli.command("watch", "Refresh the quota bar until Ctrl-C").action((options: RawOptions) => {
    const scene = sceneOptions(options, options.theme ?? process.env["OCQUOTA_THEME"] ?? "aurora");
    const app = buildApp(options, true);
    const renderer = fullRenderer(app, true);
    let snapshot: QuotaSnapshot;
    let frame = 0;
    const motion = process.stdout.isTTY && app.config.theme !== "raw" && options.motion !== false && process.env["OCQUOTA_REDUCED_MOTION"] !== "1" && process.env["TERM"] !== "dumb";
    if (!options.animation && !process.env["OCQUOTA_ANIMATION"] && app.config.theme !== "raw") scene.animation = palettes[app.config.theme].motion as typeof scene.animation;
    const controls = new MotionControls(scene.animation, scene.speed);
    let elapsed = 0;
    let lastFrame = performance.now();
    const decorate = (output: string) => {
      if (!motion) return output;
      const now = performance.now();
      if (!controls.paused) elapsed += (now - lastFrame) * controls.speed;
      lastFrame = now;
      const width = Math.max(1, Math.min(76, (process.stdout.columns || 80) - 2));
      const scene = renderMotion(controls.style, elapsed, width, 4);
      const label = `${controls.style} · ${controls.speed}x${controls.paused ? " · paused" : ""}`.slice(0, width);
      const help = "Space pause · n scene · +/- speed · q quit".slice(0, width);
      return `${scene}\n ${label}\n${output}\n ${help}`;
    };
    const loop = new WatchLoop({
      render: () => {
        snapshot = app.service.snapshot();
        return decorate(renderer.render(snapshot, motion ? frame : undefined));
      },
      ...(motion ? { animate: () => decorate(renderer.render(snapshot, controls.paused ? frame : ++frame)) } : {}),
      ...(motion ? { onKey: (key: string) => { controls.handle(key); } } : {}),
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
