import { MS_PER_HOUR, MS_PER_MINUTE, type TimeZone } from "./time.ts";

/** ±16h brackets all UTC offsets (-12h..+14h). */
const OFFSET_SEARCH_SLACK_MS = 16 * MS_PER_HOUR;

class IanaTimeZone implements TimeZone {
  readonly id: string;
  /** Caches Intl.DateTimeFormat (expensive to construct). */
  private readonly formatters = new Map<string, Intl.DateTimeFormat>();

  constructor(id: string) {
    this.id = id;
  }

  offsetMinutesAt(utcMs: number): number {
    const wall = wallClockFields(this.formatter().formatToParts(new Date(utcMs)));
    const asIfUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
    const wholeSeconds = Math.trunc(utcMs / 1_000) * 1_000; // offsets are minute-granular
    return Math.round((asIfUtc - wholeSeconds) / MS_PER_MINUTE);
  }

  toWallClockMs(utcMs: number): number {
    return utcMs + this.offsetMinutesAt(utcMs) * MS_PER_MINUTE;
  }

  earliestInstantAt(wallMs: number): number {
    // Probe pre-transition offset first so fall-back overlaps pick the earlier instant.
    const rough = wallMs - this.offsetMinutesAt(wallMs) * MS_PER_MINUTE;
    for (const guess of [wallMs - this.offsetMinutesAt(rough - 2 * MS_PER_HOUR) * MS_PER_MINUTE, rough]) {
      if (this.toWallClockMs(guess) >= wallMs && this.toWallClockMs(guess - 1) < wallMs) return guess;
    }
    return this.searchEarliest(wallMs);
  }

  /** O(log range) binary search (~27 Intl calls) when `wallMs` is in a DST gap. */
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

function wallClockFields(parts: Intl.DateTimeFormatPart[]): WallClockFields {
  const field = (type: Intl.DateTimeFormatPartTypes, fallback: number): number => {
    const part = parts.find((p) => p.type === type);
    return part === undefined ? fallback : Number(part.value);
  };
  return {
    year: field("year", 0),
    month: field("month", 1),
    day: field("day", 1),
    // Guard against ICU builds emitting "24" at midnight despite h23.
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

export function systemTimeZoneId(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}
