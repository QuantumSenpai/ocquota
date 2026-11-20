import { expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pkg from "../package.json";

test("standalone binary runs outside the checkout and installs both integrations", () => {
  const dir = mkdtempSync(join(tmpdir(), "ocquota standalone "));
  const command = process.env["OCQUOTA_TEST_EXE"] ?? join(dir, process.platform === "win32" ? "ocquota.exe" : "ocquota");
  const run = (args: string[]) => {
    const result = Bun.spawnSync([command, ...args], { cwd: dir, env: { ...process.env, NO_COLOR: "1", XDG_CONFIG_HOME: join(dir, "OpenCode config") }, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
    return new TextDecoder().decode(result.stdout);
  };
  try {
    if (!process.env["OCQUOTA_TEST_EXE"]) {
      const build = Bun.spawnSync(["bun", "build", "--compile", "--minify", "src/cli.ts", "--outfile", command]);
      expect(build.exitCode).toBe(0);
      for (const file of ["tui.tsx", "tui-runtime.js"]) copyFileSync(resolve("dist", file), join(dir, file));
    }
    expect(run(["--version"])).toContain(`ocquota/${pkg.version}`);
    expect(run(["preview", "--source", "codex", "--theme", "ember"])).toContain("Codex");
    const codexHome = join(dir, "Codex home");
    expect(run(["codex-install", "--codex-home", codexHome, "--theme", "mono"])).toContain("installed");
    expect(Bun.TOML.parse(readFileSync(join(codexHome, "config.toml"), "utf8"))).toMatchObject({ tui: { theme: "ocquota-mono" } });
    const configDir = join(dir, "OpenCode config", "opencode");
    expect(run(["opencode-install", "--theme", "aurora"])).toContain("installed");
    expect(JSON.parse(readFileSync(join(configDir, "cli.json"), "utf8")).plugins[0].package).toBe(join(configDir, "ocquota-native"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 60_000);
