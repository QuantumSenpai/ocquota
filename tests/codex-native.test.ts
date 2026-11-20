import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CODEX_THEMES } from "../src/codex/themes.ts";
import { installCodex } from "../src/codex/install.ts";

test("Codex installation preserves settings, backs up TOML and installs native themes and live stats", () => {
  const home = mkdtempSync(join(tmpdir(), "ocquota-codex-native-"));
  try {
    const path = join(home, "config.toml");
    const original = '# personal settings\nmodel = "test-model"\n[tui]\nanimations = false\nstatus_line = ["git-branch"]\n[projects."/tmp/project"]\ntrust_level = "trusted"\n';
    writeFileSync(path, original, { mode: 0o600 });
    const result = installCodex({ codexHome: home, theme: "aurora" });
    const config = Bun.TOML.parse(readFileSync(path, "utf8")) as any;
    expect(result.configPath).toBe(path);
    expect(config.model).toBe("test-model");
    expect(config.projects["/tmp/project"].trust_level).toBe("trusted");
    expect(config.tui.animations).toBe(false);
    expect(config.tui.theme).toBe("ocquota-aurora");
    expect(config.tui.status_line).toContain("git-branch");
    expect(config.tui.status_line).toContain("used-tokens");
    expect(config.tui.status_line).toContain("context-remaining");
    expect(config.tui.status_line).toContain("five-hour-limit");
    expect(config.tui.status_line).toContain("weekly-limit");
    for (const name of CODEX_THEMES) {
      const theme = readFileSync(join(home, "themes", `ocquota-${name}.tmTheme`), "utf8");
      expect(theme).toContain("<plist version=\"1.0\">");
      expect(theme).toContain("<key>settings</key>");
      expect(theme).toContain("<key>scope</key>");
    }
    const backup = readdirSync(home).find((file) => file.endsWith(".bak"))!;
    expect(readFileSync(join(home, backup), "utf8")).toBe(original);
    if (process.platform !== "win32") expect(statSync(join(home, backup)).mode & 0o777).toBe(0o600);
    installCodex({ codexHome: home, theme: "ember", motion: false });
    const updated = Bun.TOML.parse(readFileSync(path, "utf8")) as any;
    expect(updated.tui.theme).toBe("ocquota-ember");
    expect(updated.tui.status_line.filter((item: string) => item === "git-branch")).toHaveLength(1);
    expect(updated.tui.status_line).toContain("total-output-tokens");
    expect(updated.tui.animations).toBe(false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("Codex installer refuses malformed config, invalid TUI settings and theme names", () => {
  const home = mkdtempSync(join(tmpdir(), "ocquota-codex-invalid-"));
  try {
    const path = join(home, "config.toml");
    for (const original of ['[tui', 'tui = "invalid"', '[tui]\nstatus_line = [1]']) {
      writeFileSync(path, original);
      expect(() => installCodex({ codexHome: home, theme: "mono" })).toThrow();
      expect(readFileSync(path, "utf8")).toBe(original);
    }
    expect(() => installCodex({ codexHome: home, theme: "../invalid" as any })).toThrow(/theme/i);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("Codex installer supports symlinked configuration without replacing the symlink", () => {
  const home = mkdtempSync(join(tmpdir(), "ocquota-codex-link-"));
  try {
    const target = join(home, "shared.toml");
    writeFileSync(target, 'model = "keep-me"\n', { mode: 0o600 });
    symlinkSync(target, join(home, "config.toml"));
    installCodex({ codexHome: home, theme: "mono" });
    expect((Bun.TOML.parse(readFileSync(target, "utf8")) as any).tui.theme).toBe("ocquota-mono");
    if (process.platform !== "win32") expect(statSync(target).mode & 0o777).toBe(0o600);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
