/**
 * Window boundary math in wall-clock space (UTC ms + instant offset), so a
 * local day is 23h on spring-forward, 25h on fall-back, and 24h otherwise.
 */

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

export interface TimeZone {
  readonly id: string;
  offsetMinutesAt(utcMs: number): number;
  toWallClockMs(utcMs: number): number;
  /** Smallest UTC instant with wall-clock ms >= `wallMs` (gaps move forward, overlaps pick earlier). */
  earliestInstantAt(wallMs: number): number;
}

export function startOfDay(timeZone: TimeZone, utcMs: number): number {
  return timeZone.earliestInstantAt(floorWallDay(timeZone.toWallClockMs(utcMs)));
}

/** Monday 00:00 local of the ISO week containing `utcMs`. */
export function startOfWeek(timeZone: TimeZone, utcMs: number): number {
  const wallDay = floorWallDay(timeZone.toWallClockMs(utcMs));
  const dayIndex = wallDay / MS_PER_DAY;
  const daysSinceMonday = (((dayIndex + 4) % 7) + 6) % 7;
  return timeZone.earliestInstantAt(wallDay - daysSinceMonday * MS_PER_DAY);
}

export function startOfMonth(timeZone: TimeZone, utcMs: number): number {
  const wall = new Date(timeZone.toWallClockMs(utcMs));
  const firstWall = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), 1);
  return timeZone.earliestInstantAt(firstWall);
}

export function startOfDayOffset(timeZone: TimeZone, utcMs: number, daysBack: number): number {
  const wall = floorWallDay(timeZone.toWallClockMs(utcMs)) - daysBack * MS_PER_DAY;
  return timeZone.earliestInstantAt(wall);
}

export function nextDayStart(timeZone: TimeZone, utcMs: number): number {
  return timeZone.earliestInstantAt(floorWallDay(timeZone.toWallClockMs(utcMs)) + MS_PER_DAY);
}

export function nextWeekStart(timeZone: TimeZone, utcMs: number): number {
  const start = startOfWeek(timeZone, utcMs);
  return timeZone.earliestInstantAt(floorWallDay(timeZone.toWallClockMs(start)) + 7 * MS_PER_DAY);
}

export function nextMonthStart(timeZone: TimeZone, utcMs: number): number {
  const wall = new Date(timeZone.toWallClockMs(startOfMonth(timeZone, utcMs)));
  const nextWall = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth() + 1, 1);
  return timeZone.earliestInstantAt(nextWall);
}

function floorWallDay(wallMs: number): number {
  return Math.floor(wallMs / MS_PER_DAY) * MS_PER_DAY;
}

export interface OffsetSegment {
  readonly start: number;
  readonly end: number;
  readonly offsetMinutes: number;
}

/** Constant-offset stretches in [from, to) for DST-exact daily buckets. O(hours + log(hour) per transition). */
export function offsetSegments(timeZone: TimeZone, from: number, to: number): OffsetSegment[] {
  if (to <= from) return [];
  const segments: OffsetSegment[] = [];
  let start = from;
  let offset = timeZone.offsetMinutesAt(from);
  for (let prev = from; prev < to - 1; ) {
    const probe = Math.min(prev + MS_PER_HOUR, to - 1);
    const nextOffset = timeZone.offsetMinutesAt(probe);
    if (nextOffset !== offset) {
      const change = transitionInstant(timeZone, prev, probe, offset);
      segments.push({ start, end: change, offsetMinutes: offset });
      start = change;
      offset = nextOffset;
    }
    prev = probe;
  }
  segments.push({ start, end: to, offsetMinutes: offset });
  return segments;
}

/** O(log hour) bisection for the offset transition instant. */
function transitionInstant(timeZone: TimeZone, low: number, high: number, oldOffset: number): number {
  let lo = low;
  let hi = high;
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (timeZone.offsetMinutesAt(mid) === oldOffset) lo = mid;
    else hi = mid;
  }
  return hi;
}
