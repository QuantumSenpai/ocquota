/**
 * Reset-cadence strategies (Strategy pattern). QuotaService holds a
 * WindowStrategy and never asks which kind it has; adding a cadence means
 * writing one class and adding one entry to REGISTRY — nothing else changes.
 *
 * Boundary math lives in core/time.ts and is DST-correct: the day containing a
 * spring-forward is 23h, a fall-back day is 25h, and weeks/months follow.
 */

import { ConfigError } from "../core/errors.ts";
import {
  nextDayStart,
  nextMonthStart,
  nextWeekStart,
  startOfDay,
  startOfMonth,
  startOfWeek,
  type TimeZone,
} from "../core/time.ts";
import type { WindowKind, WindowRange } from "../core/types.ts";

export interface WindowStrategy {
  readonly kind: WindowKind;
  /** Short human label, e.g. "day". */
  readonly label: string;
  /** The window containing `nowMs`; `range.end` is the reset instant. O(1). */
  range(nowMs: number): WindowRange;
}

/** Shared frame: start of the current boundary, start of the next one. */
abstract class CadenceWindow implements WindowStrategy {
  protected constructor(
    protected readonly timeZone: TimeZone,
    readonly kind: WindowKind,
    readonly label: string,
  ) {}

  /** First instant of the boundary containing `utcMs`. */
  protected abstract start(timeZone: TimeZone, utcMs: number): number;
  /** First instant of the boundary after `utcMs`. */
  protected abstract next(timeZone: TimeZone, utcMs: number): number;

  range(nowMs: number): WindowRange {
    return { start: this.start(this.timeZone, nowMs), end: this.next(this.timeZone, nowMs) };
  }
}

/** Local midnight today -> tomorrow (23h/25h across DST transitions). */
class DayWindow extends CadenceWindow {
  constructor(timeZone: TimeZone) {
    super(timeZone, "day", "day");
  }

  protected override start(zone: TimeZone, utcMs: number): number {
    return startOfDay(zone, utcMs);
  }

  protected override next(zone: TimeZone, utcMs: number): number {
    return nextDayStart(zone, utcMs);
  }
}

/** Monday 00:00 local -> the following Monday (ISO weeks). */
class WeekWindow extends CadenceWindow {
  constructor(timeZone: TimeZone) {
    super(timeZone, "week", "week");
  }

  protected override start(zone: TimeZone, utcMs: number): number {
    return startOfWeek(zone, utcMs);
  }

  protected override next(zone: TimeZone, utcMs: number): number {
    return nextWeekStart(zone, utcMs);
  }
}

/** The 1st of the local month 00:00 -> the 1st of the next one. */
class MonthWindow extends CadenceWindow {
  constructor(timeZone: TimeZone) {
    super(timeZone, "month", "month");
  }

  protected override start(zone: TimeZone, utcMs: number): number {
    return startOfMonth(zone, utcMs);
  }

  protected override next(zone: TimeZone, utcMs: number): number {
    return nextMonthStart(zone, utcMs);
  }
}

type WindowFactory = (timeZone: TimeZone) => WindowStrategy;

/** Map, not a plain object: `get` tells us honestly whether a kind exists. */
const REGISTRY = new Map<WindowKind, WindowFactory>([
  ["day", (timeZone) => new DayWindow(timeZone)],
  ["week", (timeZone) => new WeekWindow(timeZone)],
  ["month", (timeZone) => new MonthWindow(timeZone)],
]);

export function createWindow(kind: WindowKind, timeZone: TimeZone): WindowStrategy {
  const factory = REGISTRY.get(kind);
  if (factory === undefined) {
    throw new ConfigError(`Unknown window "${kind}". Expected one of: ${[...REGISTRY.keys()].join(", ")}.`);
  }
  return factory(timeZone);
}
