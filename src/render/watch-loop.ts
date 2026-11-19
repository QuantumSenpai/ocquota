import { friendlyMessage } from "../core/errors.ts";
import type { RendererColors } from "./renderer.ts";

interface WatchLoopOptions {
  render: () => string;
  refreshMs: number;
  colors: RendererColors;
  onClose: () => void;
  debug?: boolean | undefined;
  animate?: (() => string) | undefined;
}

export class WatchLoop {
  private readonly options: WatchLoopOptions;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private animationTimer: ReturnType<typeof setInterval> | undefined;
  private healthy = false;
  private debugSuffix = "";

  constructor(options: WatchLoopOptions) {
    this.options = options;
  }

  start(): void {
    // Piped output: one shot, no ANSI spam.
    if (!process.stdout.isTTY || process.env["TERM"] === "dumb") {
      try {
        process.stdout.write(`${this.renderFrame()}\n`);
      } finally {
        this.options.onClose();
      }
      return;
    }
    this.running = true;
    process.stdout.write("\x1B[?1049h\x1B[?25l");
    process.on("SIGINT", () => this.stop());
    process.on("SIGTERM", () => this.stop());
    this.tick();
    const animate = this.options.animate;
    if (animate) {
      this.animationTimer = setInterval(() => {
        if (!this.running || !this.healthy) return;
        try {
          this.draw(animate() + this.debugSuffix);
        } catch (error) {
          this.healthy = false;
          this.draw(this.options.colors.red(friendlyMessage(error)));
        }
      }, 180);
    }
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer !== undefined) clearTimeout(this.timer);
    if (this.animationTimer !== undefined) clearInterval(this.animationTimer);
    process.stdout.write("\x1B[?25h\x1B[?1049l");
    this.options.onClose();
    process.exit(0);
  }

  private tick(): void {
    if (!this.running) return;
    try {
      this.draw(this.renderFrame());
      this.healthy = true;
    } catch (error) {
      this.healthy = false;
      this.draw(this.options.colors.red(friendlyMessage(error)));
    }
    this.timer = setTimeout(() => this.tick(), this.options.refreshMs);
  }

  private draw(output: string): void {
    const rows = process.stdout.rows;
    if (rows && rows > 2) {
      const lines = output.split("\n");
      if (lines.length >= rows) {
        const columns = process.stdout.columns || 80;
        const hint = "… Enlarge terminal for more stats".slice(0, Math.max(1, columns - 1));
        output = [...lines.slice(0, rows - 2), this.options.colors.dim(hint)].join("\n");
      }
    }
    process.stdout.write(`\x1B[H${output}\n\x1B[J`);
  }

  private renderFrame(): string {
    const started = performance.now();
    const output = this.options.render();
    const debug = this.options.debug ?? process.env["OCQUOTA_DEBUG"] === "1";
    this.debugSuffix = "";
    if (!debug) return output;
    const elapsedMs = performance.now() - started;
    this.debugSuffix = `\n${this.options.colors.dim(`refresh ${elapsedMs.toFixed(2)} ms`)}`;
    return output + this.debugSuffix;
  }
}
