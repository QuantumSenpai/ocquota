/**
 * Window boundary math in wall-clock space, driven by a TimeZone that resolves
 * the UTC offset *per instant*. That is what makes a day window 23 hours long
 * on the spring-forward day, 25 hours on the fall-back day, and exactly 24
 * hours everywhere else. A single fixed offset captured at startup cannot do
 * this — see tests/timezone.test.ts.
 *
 * Two coordinate systems:
 *  - UTC ms:   what SQLite stores (session_v2.time_updated, session_message.time_created)
 *  - wall ms:  UTC ms + offset of that instant; whole local days are exact here
 */

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

export interface TimeZone {
  /** IANA name, or a fixed offset like "+05:30". Shown in messages. */
  readonly id: string;
  /** Minutes east of UTC at `utcMs`. O(1). */
  offsetMinutesAt(utcMs: number): number;
  /** UTC instant -> wall-clock ms. O(1). */
  toWallClockMs(utcMs: number): number;
  /**
   * Smallest UTC instant whose wall-clock ms is >= `wallMs`. Handles DST gaps
   * (a skipped local hour) and overlaps (a repeated local hour): gaps move
   * forward, overlaps pick the earlier instant — Temporal's "compatible" rule.
   */
  earliestInstantAt(wallMs: number): number;
}

/** Start of the local day containing `utcMs`. O(1) Intl lookups. */
export function startOfDay(timeZone: TimeZone, utcMs: number): number {
  return timeZone.earliestInstantAt(floorWallDay(timeZone.toWallClockMs(utcMs)));
}

/** Monday 00:00 local of the week containing `utcMs` (ISO weeks). */
export function startOfWeek(timeZone: TimeZone, utcMs: number): number {
  const wallDay = floorWallDay(timeZone.toWallClockMs(utcMs));
  const dayIndex = wallDay / MS_PER_DAY;
  const daysSinceMonday = (((dayIndex + 4) % 7) + 6) % 7;
  return timeZone.earliestInstantAt(wallDay - daysSinceMonday * MS_PER_DAY);
}

/** 00:00 on the 1st of the local month containing `utcMs`. */
export function startOfMonth(timeZone: TimeZone, utcMs: number): number {
  const wall = new Date(timeZone.toWallClockMs(utcMs));
  const firstWall = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), 1);
  return timeZone.earliestInstantAt(firstWall);
}

/** Start of the local day `daysBack` days before the day containing `utcMs`. */
export function startOfDayOffset(timeZone: TimeZone, utcMs: number, daysBack: number): number {
  const wall = floorWallDay(timeZone.toWallClockMs(utcMs)) - daysBack * MS_PER_DAY;
  return timeZone.earliestInstantAt(wall);
}

/** Next local midnight strictly after `utcMs`. */
export function nextDayStart(timeZone: TimeZone, utcMs: number): number {
  return timeZone.earliestInstantAt(floorWallDay(timeZone.toWallClockMs(utcMs)) + MS_PER_DAY);
}

/** Next Monday 00:00 local strictly after `utcMs`. */
export function nextWeekStart(timeZone: TimeZone, utcMs: number): number {
  const start = startOfWeek(timeZone, utcMs);
  return timeZone.earliestInstantAt(timeZone.toWallClockMs(start) + 7 * MS_PER_DAY);
}

/** 00:00 on the 1st of the next local month. */
export function nextMonthStart(timeZone: TimeZone, utcMs: number): number {
  const wall = new Date(timeZone.toWallClockMs(startOfMonth(timeZone, utcMs)));
  const nextWall = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth() + 1, 1);
  return timeZone.earliestInstantAt(nextWall);
}

function floorWallDay(wallMs: number): number {
  return Math.floor(wallMs / MS_PER_DAY) * MS_PER_DAY;
}
