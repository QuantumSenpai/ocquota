import { expect, test } from "bun:test";
import { PanelRenderer } from "../src/render/panel-renderer.ts";
import { MotionControls } from "../src/render/motion.ts";
import { DEMO_SNAPSHOT } from "../src/render/theme-renderer.ts";
import { parseOpenAI } from "../src/account/providers.ts";
import { companionCommand } from "../src/render/companion.ts";

test("companion panel keeps provider allowance separate from true local counts within a narrow pane", () => {
  const account = parseOpenAI({ plan_type: "plus", rate_limit: { primary_window: { used_percent: 41, limit_window_seconds: 18000 }, secondary_window: { used_percent: 53, limit_window_seconds: 604800 } } });
  const renderer = new PanelRenderer({ theme: "sakura", color: false, columns: 42, account: () => account, model: () => "gpt-6.2-sol", controls: new MotionControls("sakura", 0.75), motion: true });
  const text = renderer.render({ ...DEMO_SNAPSHOT, source: "codex" });
  expect(text).toContain("59% left"); expect(text).toContain("47% left");
  expect(text).toContain("LOCAL LOGS"); expect(text).toContain("1.9M tokens");
  expect(text).not.toContain("5M");
  expect(text.split("\n").every((line) => line.length <= 42)).toBe(true);
  expect(text.split("\n").length).toBeLessThanOrEqual(23);
});
test("pane launchers preserve argument boundaries and safely quote tmux paths", () => {
  const windows = companionCommand("win32", { WT_SESSION: "yes" }, "C:\\Program Files\\bun.exe", ["C:\\My Folder\\cli.js", "panel"]);
  expect(windows.command).toContain("C:\\My Folder\\cli.js");
  const mac = companionCommand("darwin", { TMUX: "yes" }, "/path with spaces/bun", ["a'b", "panel"]);
  expect(mac.command.at(-1)).toContain("'a'\\''b'");
  expect(companionCommand("darwin", {}, "bun", ["panel"]).instruction).toContain("Split");
});
