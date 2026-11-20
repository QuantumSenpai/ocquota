import { clamp, formatAgo, formatCompact, formatCount, formatDuration, formatLocalDateTime, formatMoney, formatPercent } from "../core/format.ts";
import type { TimeZone } from "../core/time.ts";
import type { QuotaSnapshot, ThemeName } from "../core/types.ts";
import { palettes, ansiRgb } from "../core/themes.ts";
import type { Renderer } from "./renderer.ts";

interface ThemeOptions {
  theme: Exclude<ThemeName, "raw">;
  timeZone: TimeZone;
  color: boolean;
  columns?: number;
  rows?: number;
  watch?: boolean;
  limitConfigured?: boolean;
}

export class ThemeRenderer implements Renderer {
  constructor(private readonly options: ThemeOptions) {}

  render(snapshot: QuotaSnapshot, frame?: number): string {
    const { theme, timeZone, color } = this.options;
    const width = Math.max(1, Math.min(76, (this.options.columns ?? process.stdout.columns ?? 80) - 2));
    const compact = theme === "mono" || width < 46 || (this.options.rows ?? process.stdout.rows ?? 24) < 24;
    const palette = { accent: ansiRgb(palettes[theme].accent), secondary: ansiRgb(palettes[theme].secondary), muted: "142;155;174" };
    const source = snapshot.source === "codex" ? "Codex" : "OpenCode";
    const countLabel = snapshot.source === "codex" ? "responses" : "messages";
    const spend = snapshot.costAvailable === false ? "N/A" : formatMoney(snapshot.cost);
    const hasLimit = this.options.limitConfigured ?? snapshot.limit > 0;
    const reached = hasLimit && snapshot.used >= snapshot.limit;
    const tint = (text: string, rgb: string): string => color && theme !== "mono" ? `\x1b[38;2;${rgb}m${text}\x1b[39m` : text;
    const bold = (text: string): string => color ? `\x1b[1m${text}\x1b[22m` : text;
    const accent = reached ? "248;113;113"
      : snapshot.limit > 0 && snapshot.percent >= 0.8 ? "250;204;115" : palette.accent;
    const value = (n: number): string => snapshot.metric === "cost" ? formatMoney(n) : formatCompact(n);
    const status = !hasLimit ? "NO LIMIT" : snapshot.used > snapshot.limit ? "OVER BUDGET" : reached ? "LIMIT REACHED"
      : snapshot.percent >= 0.8 ? "NEAR LIMIT" : "WITHIN BUDGET";
    const remaining = !hasLimit ? "No limit configured"
      : snapshot.used > snapshot.limit ? `${value(snapshot.used - snapshot.limit)} over budget`
      : `${value(snapshot.limit - snapshot.used)} remaining`;
    const heading = snapshot.limit > 0 ? formatPercent(snapshot.percent) : "—";
    const usage = `${value(snapshot.used)} / ${hasLimit ? value(snapshot.limit) : "unlimited"}${snapshot.metric === "tokens" ? " tokens" : ""}`;
    const reset = `Resets in ${formatDuration(snapshot.resetAt - snapshot.takenAt)}`;
    const activity = `Last activity ${formatAgo(snapshot.lastActivityAt, snapshot.takenAt)}`;
    const projection = reached ? "budget reached" : !hasLimit ? "no limit configured" : snapshot.projection;
    const rate = snapshot.burnRatePerHour > 0 ? `${value(snapshot.burnRatePerHour)}/h · ${projection}` : "Collecting pace · waiting for usage changes";
    const pulse = frame === undefined ? "" : `${["·", "•", "●", "•"][frame % 4]} LIVE  ·  `;
    const lines: string[] = [];
    const line = (text: string, tone = palette.muted, strong = false): void => {
      // Wrap before adding ANSI escapes, so styling never changes terminal geometry.
      for (let rest = text; ; ) {
        if (rest.length <= width) { lines.push(` ${tint(strong ? bold(rest) : rest, tone)}`); break; }
        const space = rest.lastIndexOf(" ", width);
        const split = space > 0 ? space : width;
        const part = rest.slice(0, split);
        lines.push(` ${tint(strong ? bold(part) : part, tone)}`);
        rest = rest.slice(split).trimStart();
      }
    };
    const bar = (): void => {
      const count = Math.round(clamp(reached ? 1 : hasLimit ? snapshot.percent : 0, 0, 1) * width);
      const fill = theme === "ember" ? "━" : "▰";
      lines.push(` ${tint(fill.repeat(count), accent)}${tint((theme === "ember" ? "─" : "▱").repeat(width - count), palette.muted)}`);
    };

    line(`${pulse}OCQUOTA  /  ${theme.toUpperCase()}`, palette.secondary, true);
    line(`${source}  ·  ${snapshot.windowKind} window  ·  ${timeZone.id}`);
    if (compact) {
      line("");
      line(`${heading}  ${status}`, accent, true);
      bar();
      line(usage, palette.accent);
      line(`${formatCount(snapshot.messages)} ${countLabel} · ${snapshot.sessions} sessions · ${spend}`);
      line(`${remaining} · ${reset}`);
    } else if (theme === "ember") {
      line("");
      line("BUDGET / FOCUS", palette.secondary);
      line(`${remaining}  ·  ${heading} used`, accent, true);
      bar();
      line(`${status}  ·  ${usage}`, accent);
      line("");
      line(`SPEND ${spend}  /  TOKENS ${formatCompact(snapshot.totalTokens)}`, palette.secondary, true);
      line(`${snapshot.sessions} sessions  ·  ${formatCount(snapshot.messages)} ${countLabel}`);
      line(reset, palette.accent);
    } else {
      line("─".repeat(width));
      line("");
      line("YOUR CODING WINDOW", palette.secondary);
      line(`${heading}  ${status}`, accent, true);
      line(usage, palette.accent);
      line("");
      bar();
      line(remaining, accent);
      line("");
      line(`TOKENS ${formatCompact(snapshot.totalTokens)}   SPEND ${spend}`, palette.secondary, true);
      line(`SESSIONS ${snapshot.sessions}   ${countLabel.toUpperCase()} ${formatCount(snapshot.messages)}`);
      line("");
      line(reset, palette.accent);
    }
    if (!compact) {
      line(`${formatCompact(snapshot.tokens.input)} in · ${formatCompact(snapshot.tokens.output)} out · ${formatCompact(snapshot.tokens.reasoning)} reasoning`);
      line(`${formatCompact(snapshot.tokens.cacheWrite)} cache write · ${formatCompact(snapshot.tokens.cacheRead)} cache read (excluded)`);
    }
    if (snapshot.messages === 0) {
      line("No usage in this window", palette.secondary);
      line(`Start ${source === "Codex" ? "a Codex" : "an OpenCode"} session to see activity here.`);
    } else {
      line(rate);
      line(activity);
    }
    if (theme === "aurora" && !compact) {
      line(`Reset ${formatLocalDateTime(snapshot.resetAt, timeZone)}`);
      line("─".repeat(width));
    }
    if (this.options.watch) {
      line("");
      line("Ctrl-C to leave · Local budget, read-only usage");
    }
    return lines.join("\n");
  }
}

/** Explicit sample data for the database-free theme preview. */
export const DEMO_SNAPSHOT: QuotaSnapshot = {
  windowKind: "day", range: { start: Date.UTC(2026, 10, 19), end: Date.UTC(2026, 10, 20) },
  resetAt: Date.UTC(2026, 10, 20), takenAt: Date.UTC(2026, 10, 19, 16, 24),
  metric: "tokens", used: 1_860_000, limit: 5_000_000, percent: 0.372,
  totalTokens: 1_860_000, cost: 4.82, messages: 248, sessions: 12,
  tokens: { input: 1_200_000, output: 420_000, reasoning: 180_000, cacheWrite: 60_000, cacheRead: 8_400_000 },
  lastActivityAt: Date.UTC(2026, 10, 19, 16, 23, 42), burnRatePerHour: 124_000, projection: "safe until reset",
};
