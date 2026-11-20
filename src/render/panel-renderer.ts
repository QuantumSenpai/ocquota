import { formatCompact, formatDuration } from "../core/format.ts";
import { ansiRgb, palettes, type WorkspaceTheme } from "../core/themes.ts";
import { cleanLabel, type AccountSnapshot } from "../account/types.ts";
import { meterValue } from "../account/format.ts";
import type { QuotaSnapshot } from "../core/types.ts";
import { renderMotion, type MotionControls } from "./motion.ts";

export class PanelRenderer {
  private elapsed = 0;
  private last = performance.now();
  constructor(private readonly options: { theme: WorkspaceTheme; color: boolean; account: () => AccountSnapshot | undefined; model: () => string | undefined; controls: MotionControls; motion: boolean; columns?: number }) {}
  render(snapshot: QuotaSnapshot): string {
    const width = Math.max(8, Math.min(56, (this.options.columns ?? process.stdout.columns ?? 40) - 2));
    const lines: string[] = [];
    const line = (value = "") => {
      const text = cleanLabel(value);
      if (!text.length) { lines.push(""); return; }
      for (let i = 0; i < text.length; i += width) lines.push(text.slice(i, i + width));
    };
    const account = this.options.account();
    line(`OCQUOTA · ${snapshot.source === "opencode" ? "OpenCode" : "Codex"}`);
    line(`Recorded: ${this.options.model() ?? "waiting for model"}`);
    line("─".repeat(width));
    line(`ACCOUNT${account?.plan ? ` · ${account.plan}` : ""} · ${account?.blocked ? "blocked" : account?.status ?? "checking"}`);
    if (account?.meters.length) {
      for (const meter of account.meters) {
        line(`${meter.label} · ${meterValue(meter)}`);
        if (meter.resetsAt !== undefined) line(meter.resetsAt <= snapshot.takenAt ? "Reset passed · awaiting refresh" : `Resets in ${formatDuration(meter.resetsAt - snapshot.takenAt)}`);
      }
      line("Provider-reported account allowance");
    } else line(account ? "Allowance unavailable · no estimate" : "Fetching account allowance…");
    if (account) line(`Checked ${formatDuration(Math.max(0, snapshot.takenAt - account.fetchedAt))} ago`);
    line(`LOCAL LOGS · ${snapshot.windowKind}`);
    line(`${formatCompact(snapshot.totalTokens)} tokens · ${snapshot.sessions} sessions`);
    line(`${formatCompact(snapshot.tokens.input)} in · ${formatCompact(snapshot.tokens.output)} out`);
    line(`${formatCompact(snapshot.tokens.reasoning)} reasoning · ${snapshot.messages} responses`);
    line(`${formatCompact(snapshot.tokens.cacheRead)} cache read (excluded)`);
    line(`${formatCompact(snapshot.tokens.cacheWrite)} cache write`);
    if (this.options.motion) {
      const now = performance.now();
      if (!this.options.controls.paused) this.elapsed += (now - this.last) * this.options.controls.speed;
      this.last = now;
      lines.push(...renderMotion(this.options.controls.style, this.elapsed, width, 2).split("\n"));
      line(`${this.options.controls.style} · ${this.options.controls.speed}x${this.options.controls.paused ? " · paused" : ""}`);
      line("Space pause · n scene · +/- speed");
    }
    line("q / Ctrl-C exit · read-only");
    const output = lines.map((text) => ` ${text}`).join("\n");
    return this.options.color ? `\x1b[38;2;${ansiRgb(palettes[this.options.theme].accent)}m${output}\x1b[39m` : output;
  }
}
