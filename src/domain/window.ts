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
  readonly label: string;
  /** Window containing `nowMs`; `range.end` is the reset instant. O(1). */
  range(nowMs: number): WindowRange;
}

abstract class CadenceWindow implements WindowStrategy {
  protected constructor(
    protected readonly timeZone: TimeZone,
    readonly kind: WindowKind,
    readonly label: string,
  ) {}

  protected abstract start(timeZone: TimeZone, utcMs: number): number;
  protected abstract next(timeZone: TimeZone, utcMs: number): number;

  range(nowMs: number): WindowRange {
    return { start: this.start(this.timeZone, nowMs), end: this.next(this.timeZone, nowMs) };
  }
}

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
