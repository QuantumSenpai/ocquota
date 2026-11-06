import { friendlyMessage } from "../core/errors.ts";
import type { RendererColors } from "./renderer.ts";

interface WatchLoopOptions {
  render: () => string;
  refreshMs: number;
  colors: RendererColors;
  onClose: () => void;
}

export class WatchLoop {
  private readonly options: WatchLoopOptions;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;

  constructor(options: WatchLoopOptions) {
    this.options = options;
  }

  start(): void {
    // Piped output: one shot, no ANSI spam.
    if (!process.stdout.isTTY) {
      try {
        process.stdout.write(`${this.options.render()}\n`);
      } finally {
        this.options.onClose();
      }
      return;
    }
    this.running = true;
    process.on("SIGINT", () => this.stop());
    process.on("SIGTERM", () => this.stop());
    this.tick();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer !== undefined) clearTimeout(this.timer);
    process.stdout.write("\n");
    this.options.onClose();
    process.exit(0);
  }

  private tick(): void {
    if (!this.running) return;
    process.stdout.write("\x1B[2J\x1B[H");
    try {
      process.stdout.write(`${this.options.render()}\n`);
    } catch (error) {
      process.stdout.write(`${this.options.colors.red(friendlyMessage(error))}\n`);
    }
    this.timer = setTimeout(() => this.tick(), this.options.refreshMs);
  }
}
