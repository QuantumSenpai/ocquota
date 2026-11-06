import type { QuotaSnapshot } from "../core/types.ts";

export interface Renderer {
  render(snapshot: QuotaSnapshot): string;
}

export interface RendererColors {
  bold: (text: string) => string;
  dim: (text: string) => string;
  red: (text: string) => string;
  yellow: (text: string) => string;
  green: (text: string) => string;
}

export function quotaColor(percent: number, colors: RendererColors): (text: string) => string {
  if (percent >= 1) return colors.red;
  if (percent >= 0.8) return colors.yellow;
  return colors.green;
}
