/**
 * ProgressBar — the one place block glyphs and cell math live, so every
 * renderer draws identical bars for identical fractions.
 */

import { clamp } from "../core/format.ts";

/** Eighth-block progress glyphs; index 7 is a full cell. */
const EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "█"] as const;

export class ProgressBar {
  constructor(private readonly width: number) {}

  /** fraction 0..1 -> "[████▌░░░]". Clamped; O(width). */
  render(fraction: number): string {
    const scaled = clamp(fraction, 0, 1) * this.width;
    const fullCells = Math.floor(scaled);
    const eighth = Math.floor((scaled - fullCells) * 8);
    const partial = eighth > 0 ? (EIGHTHS[eighth] ?? "") : "";
    const emptyCells = this.width - fullCells - (partial === "" ? 0 : 1);
    return `${"█".repeat(fullCells)}${partial}${"░".repeat(Math.max(0, emptyCells))}`;
  }
}
