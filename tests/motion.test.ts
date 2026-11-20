import { expect, test } from "bun:test";
import { renderMotion, MOTION_STYLES, motionOptions, MotionControls } from "../src/render/motion.ts";
import { WORKSPACE_THEMES } from "../src/core/themes.ts";
import { ThemeRenderer, DEMO_SNAPSHOT } from "../src/render/theme-renderer.ts";
import { createTimeZone } from "../src/core/timezone.ts";

test("ten bounded deterministic motion scenes stay inside their strip", () => {
  expect(MOTION_STYLES).toHaveLength(10);
  for (const style of MOTION_STYLES) {
    const a = renderMotion(style, 1234, 32, 4);
    expect(a).toBe(renderMotion(style, 1234, 32, 4));
    expect(a.split("\n")).toHaveLength(4);
    expect(a.split("\n").every((line) => line.length === 32)).toBe(true);
    expect(renderMotion(style, 4234, 32, 4)).not.toBe(a);
    expect(renderMotion(style, 100, 1, 1).length).toBe(1);
  }
  expect(renderMotion("rain", 1, 10000, 10000).length).toBeLessThan(800);
});
test("motion settings reject unknown styles and unbounded speeds", () => {
  expect(motionOptions.parse({ animation: "sakura", speed: 0.25 }).speed).toBe(0.25);
  for (const speed of [0, -1, 4, Infinity, NaN]) expect(() => motionOptions.parse({ speed })).toThrow();
  expect(() => motionOptions.parse({ animation: "invalid" })).toThrow();
});
test("all thirteen workspace themes render the same exact statistics", () => {
  expect(WORKSPACE_THEMES).toHaveLength(13);
  for (const theme of WORKSPACE_THEMES) {
    const output = new ThemeRenderer({ theme, timeZone: createTimeZone("UTC"), color: false, columns: 80, rows: 40 }).render(DEMO_SNAPSHOT);
    expect(output).toContain(theme.toUpperCase());
    expect(output).toContain("1.9M");
    expect(output).toContain("$4.82");
  }
});

test("live controls bound speed, cycle scenes and pause without mutating data", () => {
  const controls = new MotionControls("sakura", 1);
  controls.handle(" "); expect(controls.paused).toBe(true);
  controls.handle("n"); expect(controls.style).toBe("rain");
  for (let i = 0; i < 30; i++) controls.handle("+");
  expect(controls.speed).toBe(3);
  for (let i = 0; i < 30; i++) controls.handle("-");
  expect(controls.speed).toBe(0.25);
  expect(controls.handle("x")).toBe(false);
});

test("invalid animation settings fail before modifying Codex configuration", async () => {
  const { mkdtempSync, existsSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "ocquota-invalid-scene-"));
  try {
    const result = Bun.spawnSync(["bun", "src/cli.ts", "codex-install", "--codex-home", dir, "--animation", "invalid"], { stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode).toBe(1);
    expect(new TextDecoder().decode(result.stderr)).toContain("Animation expects");
    expect(existsSync(join(dir, "config.toml"))).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
