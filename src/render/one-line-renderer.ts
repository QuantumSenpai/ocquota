import type { QuotaSnapshot } from "../core/types.ts";
import { formatCompact, formatDuration, formatMoney, formatPercent } from "../core/format.ts";
import { quotaColor, type Renderer, type RendererColors } from "./renderer.ts";
import type { ProgressBar } from "./progress-bar.ts";

interface OneLineRendererOptions {
  bar: ProgressBar;
  colors: RendererColors;
}

export class OneLineRenderer implements Renderer {
  private readonly bar: ProgressBar;
  private readonly colors: RendererColors;

  constructor(options: OneLineRendererOptions) {
    this.bar = options.bar;
    this.colors = options.colors;
  }

  render(snapshot: QuotaSnapshot): string {
    const accent = quotaColor(snapshot.percent, this.colors);
    const used = snapshot.metric === "cost" ? formatMoney(snapshot.used) : formatCompact(snapshot.used);
    const limit = snapshot.metric === "cost" ? formatMoney(snapshot.limit) : formatCompact(snapshot.limit);
    return [
      this.colors.bold(snapshot.source === "codex" ? "ocquota · Codex" : "ocquota"),
      accent(formatPercent(snapshot.percent)),
      accent(this.bar.render(snapshot.percent)),
      `${used}/${limit}`,
      snapshot.costAvailable === false ? "cost N/A" : formatMoney(snapshot.cost),
      `${this.colors.dim("resets")} ${formatDuration(snapshot.resetAt - snapshot.takenAt)}`,
    ].join(" ");
  }
}
