/**
 * Number / money / percent / duration formatting shared by every renderer, so
 * "385K" or "8h 46m" means the same thing everywhere. All functions are O(1).
 */

import type { TimeZone } from "./time.ts";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const COUNTER = new Intl.NumberFormat("en-US");

/** 1234567 -> "1,234,567". */
export function formatCount(value: number): string {
  return COUNTER.format(Math.round(value));
}

/** 1234567 -> "1.2M", 12345 -> "12.3K", 999 -> "999". Compact labels for bars. */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return trimZero(value / 1e9) + "B";
  if (abs >= 1e6) return trimZero(value / 1e6) + "M";
  if (abs >= 1e3) return trimZero(value / 1e3) + "K";
  return formatCount(value);
}

function trimZero(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

/** USD; sub-cent amounts keep four decimals so free-model spend is visible. */
export function formatMoney(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

/** 0.413 -> "41.3%". */
export function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

const MS_PER_SECOND = 1_000;

/** 8h46m left -> "8h 46m". Zero/negative reads "now" (window already rolled over). */
export function formatDuration(ms: number): string {
  if (ms <= 0) return "now";
  const totalSeconds = Math.floor(ms / MS_PER_SECOND);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** "3m 12s ago" / "just now" / "never". */
export function formatAgo(thenMs: number | null, nowMs: number): string {
  if (thenMs === null) return "never";
  const delta = nowMs - thenMs;
  if (delta < 5_000) return "just now";
  return `${formatDuration(delta)} ago`;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * "Oct 30 15:13" in the configured zone. Built from UTC getters on a
 * wall-clock date, so the result never depends on the machine's own timezone.
 */
export function formatLocalDateTime(utcMs: number, timeZone: TimeZone): string {
  const date = wallDate(utcMs, timeZone);
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${formatWallDate(date)} ${hour}:${minute}`;
}

/** "Oct 30" in the configured zone (day buckets, timelines). */
export function formatLocalDate(utcMs: number, timeZone: TimeZone): string {
  return formatWallDate(wallDate(utcMs, timeZone));
}

/** The instant rendered as a wall-clock date in `timeZone`. */
function wallDate(utcMs: number, timeZone: TimeZone): Date {
  return new Date(timeZone.toWallClockMs(utcMs));
}

function formatWallDate(date: Date): string {
  const month = MONTHS[date.getUTCMonth()] ?? "";
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${month} ${day}`;
}
