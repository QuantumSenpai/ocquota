import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { ConfigError } from "../core/errors.ts";
import { nativeThemes, type NativeTheme } from "./themes.ts";

interface InstallOptions {
  configDir?: string;
  pluginPath?: string;
  theme: NativeTheme;
  motion?: boolean;
}

export function installOpenCode(options: InstallOptions): { configPath: string; pluginDir: string } {
  const configDir = options.configDir ?? join(process.env["XDG_CONFIG_HOME"] || join(homedir(), ".config"), "opencode");
  const json = join(configDir, "cli.json");
  const jsonc = join(configDir, "cli.jsonc");
  if (existsSync(json) && existsSync(jsonc)) throw new ConfigError("Both cli.json and cli.jsonc exist. Merge the settings into one file before installing ocquota.");
  const configPath = existsSync(jsonc) ? jsonc : json;
  let config: Record<string, unknown> = {};
  let original: string | undefined;
  if (existsSync(configPath)) {
    original = readFileSync(configPath, "utf8");
    try {
      const parsed: unknown = Bun.JSONC.parse(original);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected a config object");
      config = parsed as Record<string, unknown>;
    } catch (cause) { throw new ConfigError(`Cannot parse ${configPath}; existing config was left unchanged.`, { cause }); }
  }
  if (config["plugins"] !== undefined && !Array.isArray(config["plugins"])) throw new ConfigError(`Invalid plugins list in ${configPath}.`);
  const executableDir = options.pluginPath ? "" : dirname(realpathSync(Bun.isStandaloneExecutable ? process.execPath : process.argv[1] || ""));
  const sibling = resolve(executableDir, "tui.tsx");
  const source = options.pluginPath ?? (existsSync(sibling) ? sibling : resolve(executableDir, "../dist/tui.tsx"));
  if (!existsSync(source)) throw new ConfigError("Native plugin build is missing. Run bun run build before installing the integration.");
  const runtime = join(dirname(source), "tui-runtime.js");
  if (readFileSync(source, "utf8").includes("./tui-runtime.js") && !existsSync(runtime)) throw new ConfigError("Native plugin runtime is missing. Rebuild or reinstall ocquota before setting up OpenCode.");
  const pluginDir = join(configDir, "ocquota-native");
  mkdirSync(pluginDir, { recursive: true });
  copyFileSync(source, join(pluginDir, "tui.tsx"));
  if (existsSync(runtime)) copyFileSync(runtime, join(pluginDir, "tui-runtime.js"));
  writeFileSync(join(pluginDir, "package.json"), JSON.stringify({ name: "@kyzenn.raw/ocquota-native", type: "module", exports: { "./tui": "./tui.tsx" } }, null, 2) + "\n");
  const themesDir = join(configDir, "themes"); mkdirSync(themesDir, { recursive: true });
  for (const [name, value] of Object.entries(nativeThemes)) writeFileSync(join(themesDir, `ocquota-${name}.json`), JSON.stringify(value, null, 2) + "\n");
  if (options.motion === false) config["animations"] = false;
  const entries = config["plugins"] as unknown[] | undefined ?? [];
  const previous = entries.find((entry) => typeof entry === "object" && entry !== null && "package" in entry && entry.package === pluginDir);
  const previousOptions = previous && typeof previous === "object" && "options" in previous && previous.options && typeof previous.options === "object" ? previous.options : {};
  config["plugins"] = [...entries.filter((entry) => entry !== pluginDir && !(typeof entry === "object" && entry !== null && "package" in entry && entry.package === pluginDir)),
    { package: pluginDir, options: { ...previousOptions, motion: config["animations"] !== false } }];
  const currentTheme = config["theme"];
  config["theme"] = { ...(currentTheme && typeof currentTheme === "object" ? currentTheme : {}), name: `ocquota-${options.theme}` };
  if (original !== undefined) {
    const backup = `${configPath}.ocquota-${Date.now()}-${randomUUID().slice(0, 8)}.bak`;
    writeFileSync(backup, original, { flag: "wx", mode: 0o600 });
  }
  const destination = existsSync(configPath) ? realpathSync(configPath) : configPath;
  const temp = `${destination}.ocquota-${process.pid}.tmp`;
  const permissions = existsSync(destination) ? statSync(destination).mode & 0o777 : 0o600;
  writeFileSync(temp, JSON.stringify(config, null, 2) + "\n", { mode: permissions });
  renameSync(temp, destination);
  return { configPath, pluginDir };
}
