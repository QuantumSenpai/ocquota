import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseThemeDocument, resolveThemeDocument } from "@opencode/theme/tui";
import { nativeThemes } from "../src/opencode/themes.ts";
import { installOpenCode } from "../src/opencode/install.ts";

test("all native themes resolve through OpenCode's own schema in both modes", () => {
  expect(Object.keys(nativeThemes)).toEqual(["aurora", "ember", "mono"]);
  for (const [name, theme] of Object.entries(nativeThemes)) {
    parseThemeDocument(theme, name);
    for (const mode of ["dark", "light"] as const) {
      const resolved = resolveThemeDocument(theme, mode);
      expect(resolved.text.base).toBeDefined();
      expect(resolved.background.base).toBeDefined();
    }
  }
});

test("native installation preserves other plugins and settings, backs up config and is repeatable", () => {
  const dir = mkdtempSync(join(tmpdir(), "ocquota-opencode-"));
  try {
    const configDir = join(dir, "config"); mkdirSync(configDir);
    const configPath = join(configDir, "cli.json");
    const original = JSON.stringify({ theme: { name: "tokyonight", mode: "dark" }, animations: false, plugins: ["existing-plugin"] });
    writeFileSync(configPath, original);
    const plugin = join(dir, "tui.js"); writeFileSync(plugin, "export default { id: 'ocquota' }");
    installOpenCode({ configDir, pluginPath: plugin, theme: "ember" });
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    expect(config.animations).toBe(false);
    expect(config.theme).toEqual({ name: "ocquota-ember", mode: "dark" });
    expect(config.plugins[0]).toBe("existing-plugin");
    expect(config.plugins[1].package).toContain("ocquota-native");
    expect(config.plugins[1].options.motion).toBe(false);
    const backup = readdirSync(configDir).find((name) => name.endsWith(".bak"))!;
    expect(readFileSync(join(configDir, backup), "utf8")).toBe(original);
    config.plugins[1].options.limitTokens = 1000;
    writeFileSync(configPath, JSON.stringify(config));
    installOpenCode({ configDir, pluginPath: plugin, theme: "ember" });
    expect(JSON.parse(readFileSync(configPath, "utf8")).plugins).toHaveLength(2);
    expect(JSON.parse(readFileSync(configPath, "utf8")).plugins[1].options.limitTokens).toBe(1000);
    expect(readdirSync(join(configDir, "themes"))).toContain("ocquota-aurora.json");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("JSONC installation keeps settings and a verbatim backup of comments", () => {
  const dir = mkdtempSync(join(tmpdir(), "ocquota-opencode-"));
  try {
    const original = '{\n// user settings\n"animations":false,\n}';
    writeFileSync(join(dir, "cli.jsonc"), original);
    const plugin = join(dir, "plugin.tsx"); writeFileSync(plugin, "export default {};");
    installOpenCode({ configDir: dir, pluginPath: plugin, theme: "mono" });
    expect(JSON.parse(readFileSync(join(dir, "cli.jsonc"), "utf8")).animations).toBe(false);
    const backup = readdirSync(dir).find((file) => file.endsWith(".bak"))!;
    expect(readFileSync(join(dir, backup), "utf8")).toBe(original);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("native text and accent contrast stays readable in all theme modes", () => {
  const luminance = (color: { toInts(): [number, number, number, number] }) => {
    const channels = color.toInts().slice(0, 3).map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  };
  for (const theme of Object.values(nativeThemes)) for (const mode of ["dark", "light"] as const) {
    const resolved = resolveThemeDocument(theme, mode);
    const background = luminance(resolved.background.base);
    for (const color of [resolved.text.base, resolved.text.muted, resolved.hue.accent[300]]) {
      const foreground = luminance(color);
      expect((Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test("installer refuses malformed config without overwriting it", () => {
  const dir = mkdtempSync(join(tmpdir(), "ocquota-opencode-"));
  try {
    const path = join(dir, "cli.json"); writeFileSync(path, "invalid config");
    expect(() => installOpenCode({ configDir: dir, pluginPath: "/unused", theme: "aurora" })).toThrow(/cli.json/);
    expect(readFileSync(path, "utf8")).toBe("invalid config");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
