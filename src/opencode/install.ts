import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { ConfigError } from "../core/errors.ts";
import { motionOptions, type MotionStyle } from "../render/motion.ts";
import { nativeThemes, type NativeTheme } from "./themes.ts";

interface InstallOptions { configDir?: string; pluginPath?: string; theme: NativeTheme; motion?: boolean; animation?: MotionStyle; speed?: number; linkCodexAccount?: boolean; codexHome?: string; }
function readConfig(dir: string, name: string) {
  const json = join(dir, `${name}.json`), jsonc = join(dir, `${name}.jsonc`);
  if (existsSync(json) && existsSync(jsonc)) throw new ConfigError(`Both ${name}.json and ${name}.jsonc exist. Merge them before installing ocquota.`);
  const path = existsSync(jsonc) ? jsonc : json;
  const original = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  let config: Record<string, unknown> = {};
  try {
    if (original !== undefined) {
      const parsed: unknown = Bun.JSONC.parse(original);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected an object");
      config = parsed as Record<string, unknown>;
    }
    if (config["plugins"] !== undefined && !Array.isArray(config["plugins"])) throw new Error("Invalid plugins list");
  } catch { throw new ConfigError(`Cannot parse ${path}; existing configuration was left unchanged.`); }
  return { path, original, config };
}
function writeConfig(input: ReturnType<typeof readConfig>): void {
  if (input.original !== undefined) writeFileSync(`${input.path}.ocquota-${Date.now()}-${randomUUID().slice(0, 8)}.bak`, input.original, { flag: "wx", mode: 0o600 });
  const destination = existsSync(input.path) ? realpathSync(input.path) : input.path;
  const temp = `${destination}.ocquota-${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(input.config, null, 2) + "\n", { mode: existsSync(destination) ? statSync(destination).mode & 0o777 : 0o600, flag: "wx" });
  renameSync(temp, destination);
}
export function installOpenCode(options: InstallOptions): { configPath: string; pluginDir: string } {
  const scene = motionOptions.parse({ animation: options.animation, speed: options.speed });
  const configDir = options.configDir ?? join(process.env["XDG_CONFIG_HOME"] || join(homedir(), ".config"), "opencode");
  // Validate both files before copying assets or changing either configuration.
  const cli = readConfig(configDir, "cli"), server = readConfig(configDir, "opencode");
  const executableDir = options.pluginPath ? "" : dirname(realpathSync(Bun.isStandaloneExecutable ? process.execPath : process.argv[1] || ""));
  const sibling = resolve(executableDir, "tui.tsx");
  const source = options.pluginPath ?? (existsSync(sibling) ? sibling : resolve(executableDir, "../dist/tui.tsx"));
  if (!existsSync(source)) throw new ConfigError("Native plugin build missing. Rebuild or reinstall ocquota.");
  const runtime = join(dirname(source), "tui-runtime.js");
  if (readFileSync(source, "utf8").includes("./tui-runtime.js") && !existsSync(runtime)) throw new ConfigError("Native plugin runtime missing. Rebuild or reinstall ocquota.");
  for (const file of ["server.js", "rpc.js"]) if (!existsSync(join(dirname(source), file))) throw new ConfigError(`Native ${file} missing. Rebuild or reinstall ocquota.`);
  const pluginDir = join(configDir, "ocquota-native");
  const matches = (entry: unknown) => entry === pluginDir || (typeof entry === "object" && entry !== null && "package" in entry && entry.package === pluginDir);
  const legacy = cli.config["plugins"] as unknown[] | undefined ?? [];
  const entries = server.config["plugins"] as unknown[] | undefined ?? [];
  const previous = [...entries, ...legacy].find(matches);
  const previousOptions = previous && typeof previous === "object" && "options" in previous && previous.options && typeof previous.options === "object" ? previous.options : {};
  if (options.motion === false) cli.config["animations"] = false;
  server.config["plugins"] = [...entries.filter((entry) => !matches(entry)), { package: pluginDir, options: { ...previousOptions, theme: options.theme,
    ...(options.linkCodexAccount === undefined ? {} : { linkCodexAccount: options.linkCodexAccount }), ...(options.codexHome ? { codexHome: options.codexHome } : {}),
    ...(options.animation === undefined ? {} : { animation: scene.animation }), ...(options.speed === undefined ? {} : { speed: scene.speed }), motion: cli.config["animations"] !== false } }];
  if (cli.config["plugins"] !== undefined) cli.config["plugins"] = legacy.filter((entry) => !matches(entry));
  const theme = cli.config["theme"];
  cli.config["theme"] = { ...(theme && typeof theme === "object" ? theme : {}), name: `ocquota-${options.theme}` };
  mkdirSync(pluginDir, { recursive: true });
  copyFileSync(source, join(pluginDir, "tui.tsx"));
  if (existsSync(runtime)) copyFileSync(runtime, join(pluginDir, "tui-runtime.js"));
  for (const file of ["server.js", "rpc.js"]) copyFileSync(join(dirname(source), file), join(pluginDir, file));
  writeFileSync(join(pluginDir, "package.json"), JSON.stringify({ name: "@kyzenn.raw/ocquota-native", type: "module", exports: { ".": "./server.js", "./tui": "./tui.tsx", "./rpc": "./rpc.js" } }, null, 2) + "\n");
  const themesDir = join(configDir, "themes"); mkdirSync(themesDir, { recursive: true });
  for (const [name, value] of Object.entries(nativeThemes)) writeFileSync(join(themesDir, `ocquota-${name}.json`), JSON.stringify(value, null, 2) + "\n");
  writeConfig(server);
  writeConfig(cli);
  return { configPath: cli.path, pluginDir };
}
