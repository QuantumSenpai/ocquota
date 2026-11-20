import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pkg from "../package.json";

test("release tarball installs offline, runs independently, and sets up the native plugin", async () => {
  const root = resolve(import.meta.dir, "..");
  const temp = mkdtempSync(join(tmpdir(), "ocquota-package-"));
  const run = (args: string[], cwd = root, env: Record<string, string> = {}): string => {
    const result = Bun.spawnSync(args, { cwd, env: { ...process.env, ...env, NO_COLOR: "1" }, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
    return new TextDecoder().decode(result.stdout);
  };
  try {
    run(["bun", "run", "build"]);
    // A parent npm publish --dry-run must not turn this isolated install test into a simulation.
    const packed = JSON.parse(run(["npm", "pack", "--dry-run=false", "--ignore-scripts", "--json", "--pack-destination", temp, "--cache", join(temp, "cache")])) as Array<{ filename: string; files: Array<{ path: string }> }>;
    const archive = packed[0]!;
    expect(archive.files.map((file) => file.path).sort()).toEqual([
      "CHANGELOG.md", "LICENSE", "README.md", "dist/cli.js", "dist/licenses.txt", "dist/tui-runtime.js", "dist/tui.tsx", "package.json",
    ]);
    const prefix = join(temp, "installed");
    run(["npm", "install", "--global", "--prefix", prefix, "--dry-run=false", "--ignore-scripts", "--offline", "--no-audit", "--no-fund", "--cache", join(temp, "cache"), join(temp, archive.filename)], temp);
    const command = process.platform === "win32" ? join(prefix, "ocquota.cmd") : join(prefix, "bin", "ocquota");
    expect(run([command, "--version"], temp).trim().split(" ")[0]).toBe(`ocquota/${pkg.version}`);
    expect(run([command, "preview", "--source", "codex", "--theme", "ember"], temp)).toContain("Codex");
    expect(run([command, "--help"], temp)).toContain("--source");
    const configHome = join(temp, "opencode-settings");
    expect(run([command, "opencode-install", "--theme", "ember"], temp, { XDG_CONFIG_HOME: configHome })).toContain("Native OpenCode integration installed");
    const configDir = join(configHome, "opencode");
    expect(JSON.parse(readFileSync(join(configDir, "cli.json"), "utf8")).theme.name).toBe("ocquota-ember");
    const native = join(configDir, "ocquota-native");
    expect(readFileSync(join(native, "tui.tsx"), "utf8")).toContain('from "./tui-runtime.js"');
    const runtime = await import(pathToFileURL(join(native, "tui-runtime.js")).href);
    expect(typeof runtime.openNativeUsage).toBe("function");
    const codexHome = join(temp, "codex-settings");
    expect(run([command, "codex-install", "--theme", "mono", "--codex-home", codexHome], temp)).toContain("Native Codex themes and status-line stats installed");
    const codexConfig = Bun.TOML.parse(readFileSync(join(codexHome, "config.toml"), "utf8")) as { tui: { theme: string; status_line: string[] } };
    expect(codexConfig.tui.theme).toBe("ocquota-mono");
    expect(codexConfig.tui.status_line).toContain("used-tokens");
    expect(readFileSync(join(codexHome, "themes", "ocquota-mono.tmTheme"), "utf8")).toContain("<plist");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}, 20_000);
