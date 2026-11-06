import { clamp } from "../core/format.ts";

const EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "█"] as const;

export class ProgressBar {
  constructor(private readonly width: number) {}

  /** O(width). */
  render(fraction: number): string {
    const scaled = clamp(fraction, 0, 1) * this.width;
    const fullCells = Math.floor(scaled);
    const eighth = Math.floor((scaled - fullCells) * 8);
    const partial = eighth > 0 ? (EIGHTHS[eighth] ?? "") : "";
    const emptyCells = this.width - fullCells - (partial === "" ? 0 : 1);
    return `${"█".repeat(fullCells)}${partial}${"░".repeat(Math.max(0, emptyCells))}`;
  }
}
