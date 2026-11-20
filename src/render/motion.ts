import { z } from "zod";

export const MOTION_STYLES = ["sakura", "rain", "leaves", "wind", "snow", "fireflies", "stars", "bubbles", "embers", "waves"] as const;
export type MotionStyle = (typeof MOTION_STYLES)[number];
export const motionOptions = z.object({ animation: z.enum(MOTION_STYLES).default("sakura"), speed: z.number().min(0.25).max(3).default(1) });

/** Pure, bounded decoration. One-cell glyphs; no data reads or persistent particles. */
export function renderMotion(style: MotionStyle, elapsedMs: number, columns = 32, rows = 4): string {
  const width = Math.max(1, Math.min(120, Math.trunc(columns) || 1));
  const height = Math.max(1, Math.min(6, Math.trunc(rows) || 1));
  const cells = Array.from({ length: height }, () => Array<string>(width).fill(" "));
  const t = (Number.isFinite(elapsedMs) ? elapsedMs : 0) / 1000;
  const mod = (n: number, size: number) => ((Math.floor(n) % size) + size) % size;
  const glyphs: Record<MotionStyle, string> = { sakura: "❀·", rain: "│╵", leaves: "❧/", wind: "~-", snow: "·*", fireflies: "·+", stars: "·✦", bubbles: "○◦", embers: "·:^", waves: "~" };
  if (style === "waves") {
    for (let x = 0; x < width; x++) cells[mod((Math.sin(x / 5 + t) + 1) * (height - 1) / 2, height)]![x] = "~";
  } else {
    const count = Math.min(24, Math.max(1, Math.floor(width * height / 12)));
    for (let i = 0; i < count; i++) {
      const seed = i * 17.31;
      const up = style === "bubbles" || style === "embers";
      const horizontal = style === "wind";
      const twinkle = style === "stars" || style === "fireflies";
      const x = mod(seed * 7 + (horizontal ? t * 8 : twinkle ? Math.sin(t + i) : Math.sin(t / 2 + i) * 3 + t), width);
      const y = mod(seed + (twinkle ? 0 : horizontal ? Math.sin(t + i) : t * (up ? -1.5 : style === "rain" ? 4 : 1)), height);
      const glyph = glyphs[style];
      cells[y]![x] = glyph[mod(seed + t * (twinkle ? 2 : 0.5), glyph.length)]!;
    }
  }
  return cells.map((row) => row.join("")).join("\n");
}

export class MotionControls {
  paused = false;
  constructor(public style: MotionStyle, public speed: number) {}
  handle(key: string): boolean {
    if (key === " ") this.paused = !this.paused;
    else if (key === "n") this.style = MOTION_STYLES[(MOTION_STYLES.indexOf(this.style) + 1) % MOTION_STYLES.length]!;
    else if (key === "+" || key === "=") this.speed = Math.min(3, Math.round((this.speed + 0.25) * 100) / 100);
    else if (key === "-") this.speed = Math.max(0.25, Math.round((this.speed - 0.25) * 100) / 100);
    else return false;
    return true;
  }
}
