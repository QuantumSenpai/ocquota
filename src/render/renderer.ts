/**
 * Renderer boundary: turn a QuotaSnapshot into terminal text. Implementations
 * are pure functions of the snapshot — no clock, no I/O, no shared state — and
 * take their colors as a dependency so they can be tested or silenced.
 */

import type { QuotaSnapshot } from "../core/types.ts";

export interface Renderer {
  render(snapshot: QuotaSnapshot): string;
}

/** The picocolors surface renderers actually use. */
export interface RendererColors {
  bold: (text: string) => string;
  dim: (text: string) => string;
  red: (text: string) => string;
  yellow: (text: string) => string;
  green: (text: string) => string;
}

/** Green < 80% <= yellow < 100% <= red. */
export function quotaColor(percent: number, colors: RendererColors): (text: string) => string {
  if (percent >= 1) return colors.red;
  if (percent >= 0.8) return colors.yellow;
  return colors.green;
}
