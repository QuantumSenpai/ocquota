import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigStore } from "../src/config/config-store.ts";
import { parseCliOverrides, parseEnvOverrides } from "../src/config/overrides.ts";
import { ThemeRenderer, DEMO_SNAPSHOT } from "../src/render/theme-renderer.ts";
import { createTimeZone } from "../src/core/timezone.ts";
import { assistantData, withFixture } from "./helpers/fixture-db.ts";

describe("themes", () => {
  test("validates themes and resolves CLI > environment > file", () => {
    expect(parseCliOverrides({ theme: "ember" }).theme).toBe("ember");
    expect(parseEnvOverrides({ OCQUOTA_THEME: "mono" }).theme).toBe("mono");
    expect(() => parseCliOverrides({ theme: "missing" })).toThrow(/aurora.*ember.*mono.*raw/);
    const dir = mkdtempSync(join(tmpdir(), "ocquota-theme-"));
    try {
      const configPath = join(dir, "config.json");
      writeFileSync(configPath, JSON.stringify({ theme: "raw" }));
      expect(new ConfigStore({ configPath, env: {} }).load().theme).toBe("raw");
      const store = new ConfigStore({ configPath, env: { OCQUOTA_THEME: "mono" } });
      expect(store.load().theme).toBe("mono");
      expect(store.load({ theme: "ember" }).theme).toBe("ember");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("themes present the same real totals in distinct layouts without ANSI when disabled", () => {
    const views = ["aurora", "ember", "mono"].map((theme) => new ThemeRenderer({
      theme: theme as "aurora" | "ember" | "mono", timeZone: createTimeZone("UTC"), color: false, columns: 80,
    }).render(DEMO_SNAPSHOT));
    expect(new Set(views).size).toBe(3);
    for (const view of views) {
      expect(view).toContain("37.2%");
      expect(view).toContain("$4.82");
      expect(view).toContain("OpenCode");
      expect(view).not.toContain("\x1b");
      expect(Math.max(...view.split("\n").map((line) => line.length))).toBeLessThanOrEqual(80);
    }
  });

  test("narrow terminals wrap cleanly and over-budget/cost views stay explicit", () => {
    const renderer = new ThemeRenderer({ theme: "aurora", timeZone: createTimeZone("UTC"), color: false, columns: 32 });
    const view = renderer.render({ ...DEMO_SNAPSHOT, metric: "cost", used: 12, cost: 12, limit: 10, percent: 1.2 });
    expect(view).toContain("120.0%");
    expect(view).toContain("OVER BUDGET");
    expect(view).toContain("$12.00 / $10.00");
    expect(Math.max(...view.split("\n").map((line) => line.length))).toBeLessThanOrEqual(32);
    const unlimited = renderer.render({ ...DEMO_SNAPSHOT, limit: 0 });
    expect(unlimited).toContain("NO LIMIT");
    expect(unlimited).not.toContain("NaN");
  });

  test("short panes use compact layouts and Mono follows the terminal foreground", () => {
    const short = new ThemeRenderer({ theme: "aurora", timeZone: createTimeZone("UTC"), color: false, columns: 80, rows: 16, watch: true });
    const output = short.render(DEMO_SNAPSHOT);
    expect(output.split("\n").length).toBeLessThan(16);
    expect(output).toContain("Ctrl-C to leave");
    expect(output).toContain("37.2%");
    const mono = new ThemeRenderer({ theme: "mono", timeZone: createTimeZone("UTC"), color: true }).render(DEMO_SNAPSHOT);
    expect(mono).not.toContain("\x1b[38;2;");
  });

  test("empty windows give a useful next step and exhausted budgets show the overage", () => {
    const renderer = new ThemeRenderer({ theme: "ember", timeZone: createTimeZone("UTC"), color: false });
    const empty = renderer.render({ ...DEMO_SNAPSHOT, used: 0, percent: 0, totalTokens: 0, messages: 0, sessions: 0, cost: 0, lastActivityAt: null, burnRatePerHour: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    });
    expect(empty).toContain("No usage in this window");
    expect(empty).toContain("Start an OpenCode session");
    const over = renderer.render({ ...DEMO_SNAPSHOT, used: 6_000_000, percent: 1.2 });
    expect(over).toContain("1M over budget");
    expect(over).not.toContain("safe until reset");
  });

  test("a configured zero-dollar budget is shown as a budget, not unlimited", () => {
    const renderer = new ThemeRenderer({ theme: "ember", timeZone: createTimeZone("UTC"), color: false, limitConfigured: true });
    const output = renderer.render({ ...DEMO_SNAPSHOT, metric: "cost", used: 0.12, cost: 0.12, limit: 0, percent: 0 });
    expect(output).toContain("OVER BUDGET");
    expect(output).toContain("$0.12 over budget");
    expect(output).toContain("$0.12 / $0.00");
    expect(output).not.toContain("NO LIMIT");
  });

  test("preview command works without opening a database and labels sample data", () => {
    const result = Bun.spawnSync(["bun", "src/cli.ts", "preview", "--theme", "ember", "--db", "/missing.db"], {
      env: { ...process.env, NO_COLOR: "1" }, stdout: "pipe", stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    const output = new TextDecoder().decode(result.stdout);
    expect(output).toContain("SAMPLE DATA");
    expect(output).toContain("EMBER");
    expect(output).not.toContain("\x1b");
  });

  test("watch animates cached frames between polls and restores the terminal on exit", () => {
    const result = Bun.spawnSync(["bun", "-e", `
      import { WatchLoop } from './src/render/watch-loop.ts';
      import { COLORS } from './src/app.ts';
      process.stdout.isTTY = true;
      let polls = 0;
      const loop = new WatchLoop({
        render: () => 'POLL ' + ++polls,
        animate: () => 'ANIMATE', refreshMs: 300, colors: COLORS, debug: true,
        onClose: () => process.stdout.write('CLOSED ' + polls),
      });
      loop.start();
      setTimeout(() => loop.stop(), 450);
    `], { env: { ...process.env, TERM: "xterm-256color" }, stdout: "pipe", stderr: "pipe" });
    const output = new TextDecoder().decode(result.stdout);
    expect(result.exitCode).toBe(0);
    expect(output).toContain("ANIMATE");
    expect(output).toContain("CLOSED 2");
    expect(output).toContain("\x1b[?1049h\x1b[?25l");
    expect(output).toContain("\x1b[?25h\x1b[?1049l");
    expect(output).not.toContain("\x1b[2J");
    expect(output).toMatch(/ANIMATE\n.*refresh/);
  });

  test("color changes no content, and animated headers retain width", () => {
    const options = { theme: "aurora" as const, timeZone: createTimeZone("UTC"), columns: 32 };
    const plain = new ThemeRenderer({ ...options, color: false }).render(DEMO_SNAPSHOT, 2);
    const colored = new ThemeRenderer({ ...options, color: true }).render(DEMO_SNAPSHOT, 2);
    expect(colored).toContain("\x1b[38;2;");
    expect(Bun.stripANSI(colored)).toBe(plain);
    expect(Math.max(...plain.split("\n").map((line) => line.length))).toBeLessThanOrEqual(32);
  });

  test("watch clips short screens and handles animation errors until the next poll", () => {
    const result = Bun.spawnSync(["bun", "-e", `
      import { WatchLoop } from './src/render/watch-loop.ts';
      import { COLORS } from './src/app.ts';
      process.stdout.isTTY = true;
      process.stdout.rows = 5;
      process.stdout.columns = 40;
      const loop = new WatchLoop({
        render: () => 'BUDGET\\n2\\n3\\n4\\n5\\n6',
        animate: () => { throw new Error('animation interrupted'); },
        refreshMs: 500, colors: COLORS, onClose: () => {},
      });
      loop.start();
      setTimeout(() => loop.stop(), 300);
    `], { env: { ...process.env, TERM: "xterm-256color", NO_COLOR: "1" }, stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode).toBe(0);
    const output = new TextDecoder().decode(result.stdout);
    expect(output).toContain("Enlarge terminal for more stats");
    expect(output).not.toContain("4\n5\n6");
    expect(output).toContain("animation interrupted");
    expect(output).toContain("\x1b[?25h\x1b[?1049l");
  });

  test("CLI reduced-motion preference disables the live pulse in a terminal", () => {
    withFixture((fixture) => {
      const source = `
        process.stdout.isTTY = true;
        process.argv = ['bun', 'src/cli.ts', 'watch', '--db', process.env.OCQUOTA_TEST_DB, '--theme', 'ember', '--no-motion'];
        setTimeout(() => process.kill(process.pid, 'SIGINT'), 300);
        await import('./src/cli.ts');
      `;
      const result = Bun.spawnSync(["bun", "-e", source], {
        env: { ...process.env, TERM: "xterm-256color", NO_COLOR: "1", OCQUOTA_TEST_DB: fixture.path }, stdout: "pipe", stderr: "pipe",
      });
      expect(result.exitCode).toBe(0);
      const output = new TextDecoder().decode(result.stdout);
      expect(output).toContain("EMBER");
      expect(output).toContain("Ctrl-C to leave");
      expect(output).not.toContain("LIVE");
      expect(output).toContain("\x1b[?25h\x1b[?1049l");
    });
  });

  test("CLI themes render database totals, raw stays available, and JSON stays machine-readable", () => {
    withFixture((fixture) => {
      fixture.message({ timeCreated: Date.now(), data: assistantData({ input: 200, output: 50, cost: 0.12 }) });
      const run = (command: string, theme: string): string => {
        const result = Bun.spawnSync(["bun", "src/cli.ts", command, "--theme", theme, "--db", fixture.path,
          "--limit", "1000", "--metric", "tokens", "--tz", "UTC", "--window", "day"], {
          env: { ...process.env, NO_COLOR: "1" }, stdout: "pipe", stderr: "pipe",
        });
        expect(result.exitCode).toBe(0);
        return new TextDecoder().decode(result.stdout);
      };
      expect(run("bar", "ember")).toContain("25.0%");
      expect(run("bar", "mono")).toContain("$0.12");
      expect(run("bar", "raw").trim().split("\n")).toHaveLength(4);
      expect(JSON.parse(run("json", "aurora")).totalTokens).toBe(250);
      const piped = run("watch", "aurora");
      expect(piped).toContain("25.0%");
      expect(piped).not.toContain("\x1b");
      expect(piped).not.toContain("LIVE");
    });
  });
});
