import { resolve } from "node:path";
export function companionCommand(platform: NodeJS.Platform, env: Record<string, string | undefined>, executable: string, args: string[]): { command: string[]; instruction?: string } {
  const quoted = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
  if (platform === "win32" && env["WT_SESSION"]) return { command: ["wt.exe", "-w", "0", "split-pane", "-V", "--size", "0.3", executable, ...args] };
  if (env["TMUX"]) return { command: ["tmux", "split-window", "-h", "-l", "42", [executable, ...args].map(quoted).join(" ")] };
  return { command: [], instruction: "Split your terminal vertically, then run: ocquota panel --source codex" };
}
export function openCompanion(args: string[]): string {
  const executable = process.execPath;
  const cliArgs = Bun.isStandaloneExecutable ? args : [resolve(process.argv[1]!), ...args];
  const plan = companionCommand(process.platform, process.env, executable, cliArgs);
  if (plan.instruction) return plan.instruction;
  const result = Bun.spawnSync(plan.command, { stdout: "pipe", stderr: "pipe" });
  return result.exitCode === 0 ? "Opened the right-side usage companion pane." : "Could not open a pane. Split your terminal vertically and run: ocquota panel --source codex";
}
