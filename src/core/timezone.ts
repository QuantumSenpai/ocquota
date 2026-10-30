/**
 * TimeZone implementations. The interface and the boundary math live in
 * time.ts; this file only answers "what is the offset at this instant?" — the
 * piece that makes DST-correct windows possible.
 */

import { MS_PER_HOUR, MS_PER_MINUTE, type TimeZone } from "./time.ts";

/** Offsets on Earth span -12h..+14h; ±16h brackets every possible answer. */
const OFFSET_SEARCH_SLACK_MS = 16 * MS_PER_HOUR;

class IanaTimeZone implements TimeZone {
  readonly id: string;
  /** Formatter cache: constructing Intl.DateTimeFormat is the expensive part. */
  private readonly formatters = new Map<string, Intl.DateTimeFormat>();

  constructor(id: string) {
    this.id = id;
  }

  offsetMinutesAt(utcMs: number): number {
    const wall = wallClockFields(this.formatter().formatToParts(new Date(utcMs)));
    // Read the same wall clock as if it were UTC, then diff against the instant.
    const asIfUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
    const wholeSeconds = Math.trunc(utcMs / 1_000) * 1_000;  // offsets are minute-granular
    return Math.round((asIfUtc - wholeSeconds) / MS_PER_MINUTE);
  }

  toWallClockMs(utcMs: number): number {
    return utcMs + this.offsetMinutesAt(utcMs) * MS_PER_MINUTE;
  }

  earliestInstantAt(wallMs: number): number {
    // Fast path: no DST transition nearby, so the algebraic answer is exact.
    // Verified by checking it is the *first* crossing, not a neighbour inside
    // a repeated (fall-back) hour.
    const guess = wallMs - this.offsetMinutesAt(wallMs) * MS_PER_MINUTE;
    if (this.toWallClockMs(guess) >= wallMs && this.toWallClockMs(guess - 1) < wallMs) return guess;
    return this.searchEarliest(wallMs);
  }

  /** Binary search for the first instant at/after `wallMs`. ~27 Intl calls worst case. */
  private searchEarliest(wallMs: number): number {
    let low = wallMs - OFFSET_SEARCH_SLACK_MS;
    let high = wallMs + OFFSET_SEARCH_SLACK_MS;
    while (high - low > 1) {
      const mid = low + Math.floor((high - low) / 2);
      if (this.toWallClockMs(mid) >= wallMs) high = mid;
      else low = mid;
    }
    return high;
  }

  private formatter(): Intl.DateTimeFormat {
    const cached = this.formatters.get(this.id);
    if (cached !== undefined) return cached;
    // h23 keeps midnight at "00"; without it some ICU builds emit "24".
    const options: Intl.DateTimeFormatOptions = {
      timeZone: this.id, hourCycle: "h23", year: "numeric", month: "2-digit",
      day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    };
    const formatter = new Intl.DateTimeFormat("en-US", options);
    this.formatters.set(this.id, formatter);
    return formatter;
  }
}

/** A constant offset ("+05:30" style). No DST by construction. */
class FixedTimeZone implements TimeZone {
  readonly id: string;
  private readonly offsetMinutes: number;

  constructor(offsetMinutes: number) {
    this.offsetMinutes = offsetMinutes;
    this.id = formatOffset(offsetMinutes);
  }

  offsetMinutesAt(): number {
    return this.offsetMinutes;
  }

  toWallClockMs(utcMs: number): number {
    return utcMs + this.offsetMinutes * MS_PER_MINUTE;
  }

  earliestInstantAt(wallMs: number): number {
    return wallMs - this.offsetMinutes * MS_PER_MINUTE;
  }
}

/** Accepts an IANA name or a "+05:30"/"-0800" offset; throws a friendly error otherwise. */
export function createTimeZone(id: string): TimeZone {
  const fixed = parseOffset(id);
  if (fixed !== null) return new FixedTimeZone(fixed);
  if (!isValidTimeZone(id)) {
    throw new RangeError(
      `Unknown time zone "${id}". Use an IANA name like "Asia/Kolkata" or an offset like "+05:30".`,
    );
  }
  return new IanaTimeZone(id);
}

/** Numeric calendar fields out of Intl parts; ignores literals. */
function wallClockFields(parts: Intl.DateTimeFormatPart[]): WallClockFields {
  const field = (type: Intl.DateTimeFormatPartTypes, fallback: number): number => {
    const part = parts.find((p) => p.type === type);
    return part === undefined ? fallback : Number(part.value);
  };
  return {
    year: field("year", 0),
    month: field("month", 1),
    day: field("day", 1),
    // h23 should never emit 24, but some ICU versions do at midnight.
    hour: field("hour", 0) % 24,
    minute: field("minute", 0),
    second: field("second", 0),
  };
}

interface WallClockFields {
  year: number; month: number; day: number;
  hour: number; minute: number; second: number;
}

function parseOffset(id: string): number | null {
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(id);
  if (match === null) return null;
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 14 || minutes > 59) return null;
  return sign * (hours * 60 + minutes);
}

function isValidTimeZone(id: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: id }).format();
    return true;
  } catch {
    return false;
  }
}

/** The machine's own zone, e.g. "Asia/Calcutta". */
export function systemTimeZoneId(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** "+05:30" / "-08:00"; the one place an offset becomes a string. */
export function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}
