import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { ConfigError } from "../core/errors.ts";
import { CODEX_THEMES, codexStatusLines, codexTheme, type CodexTheme } from "./themes.ts";

export function installCodex(options: { codexHome?: string; theme: CodexTheme; motion?: boolean }): { configPath: string; backupPath?: string } {
  if (!CODEX_THEMES.includes(options.theme)) throw new ConfigError("Unknown native Codex theme. Run ocquota themes.");
  const home = resolve(options.codexHome ?? (process.env["OCQUOTA_CODEX_HOME"] || process.env["CODEX_HOME"] || join(homedir(), ".codex")));
  const configPath = join(home, "config.toml");
  const original = existsSync(configPath) ? readFileSync(configPath, "utf8") : undefined;
  let config: Record<string, unknown>;
  try { config = original === undefined ? {} : Bun.TOML.parse(original) as Record<string, unknown>; }
  catch (cause) { throw new ConfigError(`Cannot parse ${configPath}; existing config was left unchanged.`, { cause }); }
  const existing = config["tui"];
  if (existing !== undefined && (!existing || typeof existing !== "object" || Array.isArray(existing))) throw new ConfigError(`Invalid tui settings in ${configPath}.`);
  const tui = (existing ?? {}) as Record<string, unknown>;
  const previous = tui["status_line"];
  if (previous !== undefined && (!Array.isArray(previous) || previous.some((item) => typeof item !== "string"))) throw new ConfigError(`Invalid tui.status_line in ${configPath}.`);
  config["tui"] = { ...tui, theme: `ocquota-${options.theme}`,
    status_line: [...new Set([...codexStatusLines[options.theme], ...(previous as string[] | undefined ?? [])])],
    status_line_use_colors: true,
    ...(options.motion === false ? { animations: false } : {}),
  };
  const serialized = Bun.TOML.stringify(config);
  // Refuse a lossy serialization before touching a user's config.
  if (!isDeepStrictEqual(Bun.TOML.parse(serialized), config)) throw new ConfigError("Codex config cannot be safely serialized; existing settings were left unchanged.");
  mkdirSync(home, { recursive: true });
  let backupPath: string | undefined;
  if (original !== undefined) {
    backupPath = `${configPath}.ocquota-${Date.now()}-${randomUUID().slice(0, 8)}.bak`;
    writeFileSync(backupPath, original, { mode: 0o600, flag: "wx" });
  }
  const themesDir = join(home, "themes");
  mkdirSync(themesDir, { recursive: true });
  for (const name of CODEX_THEMES) writeFileSync(join(themesDir, `ocquota-${name}.tmTheme`), codexTheme(name));
  const destination = existsSync(configPath) ? realpathSync(configPath) : configPath;
  const temp = `${destination}.ocquota-${randomUUID()}.tmp`;
  writeFileSync(temp, serialized, { mode: existsSync(destination) ? statSync(destination).mode & 0o777 : 0o600, flag: "wx" });
  renameSync(temp, destination);
  return { configPath, ...(backupPath ? { backupPath } : {}) };
}
