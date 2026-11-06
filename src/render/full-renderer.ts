import { formatAgo, formatCount, formatDuration, formatLocalDateTime, formatMoney, formatPercent } from "../core/format.ts";
import type { TimeZone } from "../core/time.ts";
import type { QuotaSnapshot } from "../core/types.ts";
import type { ProgressBar } from "./progress-bar.ts";
import { quotaColor, type Renderer, type RendererColors } from "./renderer.ts";

interface FullRendererOptions {
  bar: ProgressBar;
  colors: RendererColors;
  timeZone: TimeZone;
}

export class FullRenderer implements Renderer {
  private readonly bar: ProgressBar;
  private readonly colors: RendererColors;
  private readonly timeZone: TimeZone;

  constructor(options: FullRendererOptions) {
    this.bar = options.bar;
    this.colors = options.colors;
    this.timeZone = options.timeZone;
  }

  render(snapshot: QuotaSnapshot): string {
    const c = this.colors;
    const accent = quotaColor(snapshot.percent, c);
    const from = formatLocalDateTime(snapshot.range.start, this.timeZone);
    const to = formatLocalDateTime(snapshot.range.end, this.timeZone);
    const limitLabel = snapshot.metric === "cost" ? formatMoney(snapshot.limit) : `${formatCount(snapshot.limit)} tokens`;
    const usedLabel = snapshot.metric === "cost" ? formatMoney(snapshot.used) : formatCount(snapshot.used);

    return [
      `${c.bold("ocquota")} ${c.dim(`· window ${snapshot.windowKind} · ${from} → ${to}`)}`,
      `${accent(this.bar.render(snapshot.percent))} ${accent(formatPercent(snapshot.percent))}  ${usedLabel} / ${limitLabel}`,
      `${c.dim("sessions")} ${snapshot.sessions} ${c.dim("· tokens")} ${formatCount(snapshot.totalTokens)} ${c.dim("· cost")} ${formatMoney(snapshot.cost)}`,
      `${c.dim("last activity")} ${formatAgo(snapshot.lastActivityAt, snapshot.takenAt)} ${c.dim("· resets in")} ${formatDuration(snapshot.resetAt - snapshot.takenAt)} ${c.dim(`(${to})`)}`,
    ].join("\n");
  }
}
