import { describe, expect, test } from "bun:test";
import { createTimeZone } from "../src/core/timezone.ts";
import { nextDayStart, startOfDay, startOfMonth, startOfWeek } from "../src/core/time.ts";
import { createWindow } from "../src/domain/window.ts";
import { formatLocalDateTime } from "../src/core/format.ts";

const H = 3_600_000;
const utc = (iso: string): number => Date.parse(iso);
const NY = createTimeZone("America/New_York");
const KOL = createTimeZone("Asia/Kolkata");
const UTC = createTimeZone("UTC");

describe("day windows", () => {
  test("normal New York day is 24h and starts at local midnight (EDT = 04:00Z)", () => {
    const range = createWindow("day", NY).range(utc("2026-06-15T18:00:00Z"));
    expect(new Date(range.start).toISOString()).toBe("2026-06-15T04:00:00.000Z");
    expect(new Date(range.end).toISOString()).toBe("2026-06-16T04:00:00.000Z");
    expect(range.end - range.start).toBe(24 * H);
  });

  test("spring-forward day (2026-03-08) is 23 hours", () => {
    const range = createWindow("day", NY).range(utc("2026-03-08T15:00:00Z"));
    expect(new Date(range.start).toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(new Date(range.end).toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect(range.end - range.start).toBe(23 * H);
  });

  test("fall-back day (2026-11-01) is 25 hours", () => {
    const range = createWindow("day", NY).range(utc("2026-11-01T15:00:00Z"));
    expect(new Date(range.start).toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(new Date(range.end).toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(range.end - range.start).toBe(25 * H);
  });

  test("Kolkata (+5:30, no DST) always has 24h days at 18:30Z", () => {
    const range = createWindow("day", KOL).range(utc("2026-03-08T15:00:00Z"));
    expect(new Date(range.start).toISOString()).toBe("2026-03-07T18:30:00.000Z");
    expect(range.end - range.start).toBe(24 * H);
  });

  test("UTC days are exactly 24h and start at 00:00Z", () => {
    const range = createWindow("day", UTC).range(utc("2026-03-08T15:00:00Z"));
    expect(range.start).toBe(utc("2026-03-08T00:00:00Z"));
    expect(range.end - range.start).toBe(24 * H);
  });

  test("a fixed-offset zone (+05:30) matches Kolkata", () => {
    const fixed = createTimeZone("+05:30");
    const range = createWindow("day", fixed).range(utc("2026-03-08T15:00:00Z"));
    expect(range.start).toBe(utc("2026-03-07T18:30:00Z"));
    expect(range.end - range.start).toBe(24 * H);
  });
});

describe("week windows (Monday start, ISO)", () => {
  test("week across spring-forward is 167 hours", () => {
    const range = createWindow("week", NY).range(utc("2026-03-05T15:00:00Z"));
    expect(new Date(range.start).toISOString()).toBe("2026-03-02T05:00:00.000Z");
    expect(new Date(range.end).toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect(range.end - range.start).toBe(167 * H);
  });

  test("week across fall-back is 169 hours", () => {
    const range = createWindow("week", NY).range(utc("2026-10-29T15:00:00Z"));
    expect(new Date(range.start).toISOString()).toBe("2026-10-26T04:00:00.000Z");
    expect(new Date(range.end).toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(range.end - range.start).toBe(169 * H);
  });

  test("a Sunday belongs to the week that started the previous Monday", () => {
    const start = startOfWeek(NY, utc("2026-10-25T15:00:00Z"));
    expect(new Date(start).toISOString()).toBe("2026-10-19T04:00:00.000Z");
  });

  test("Kolkata weeks are exactly 168 hours", () => {
    const range = createWindow("week", KOL).range(utc("2026-03-05T15:00:00Z"));
    expect(range.end - range.start).toBe(168 * H);
  });
});

describe("month windows", () => {
  test("December rolls over to January of the next year", () => {
    const range = createWindow("month", UTC).range(utc("2026-12-31T23:59:00Z"));
    expect(new Date(range.start).toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(new Date(range.end).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  test("Kolkata month boundary is 18:30Z on the 1st (including year rollover)", () => {
    const range = createWindow("month", KOL).range(utc("2026-12-31T14:30:00Z")); // 20:00 IST on Dec 31
    expect(new Date(range.start).toISOString()).toBe("2026-11-30T18:30:00.000Z");
    expect(new Date(range.end).toISOString()).toBe("2026-12-31T18:30:00.000Z");
  });

  test("February in a leap year has 29 days", () => {
    const range = createWindow("month", UTC).range(utc("2028-02-10T12:00:00Z"));
    expect(new Date(range.end).toISOString()).toBe("2028-03-01T00:00:00.000Z");
    expect((range.end - range.start) / (24 * H)).toBe(29);
  });
});

describe("TimeZone.earliestInstantAt (DST gap/overlap semantics)", () => {
  test("fall-back overlap picks the earlier instant (EDT, not EST)", () => {
    // 01:30 local happens twice on 2026-11-01 in New York.
    const wall = utc("2026-11-01T01:30:00Z");
    expect(new Date(NY.earliestInstantAt(wall)).toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });

  test("fall-back overlap in UTC+ zones (Berlin, Sydney) picks the earlier instant", () => {
    const berlin = createTimeZone("Europe/Berlin");
    const sydney = createTimeZone("Australia/Sydney");
    expect(new Date(berlin.earliestInstantAt(utc("2026-10-25T02:30:00Z"))).toISOString()).toBe("2026-10-25T00:30:00.000Z");
    expect(new Date(sydney.earliestInstantAt(utc("2026-04-05T02:30:00Z"))).toISOString()).toBe("2026-04-04T15:30:00.000Z");
  });

  test("spring-forward gap moves forward to the first real instant", () => {
    expect(new Date(NY.earliestInstantAt(utc("2026-03-08T02:30:00Z"))).toISOString()).toBe("2026-03-08T07:00:00.000Z");
  });
});

describe("boundary helpers", () => {
  test("startOfDay/nextDayStart agree with the strategy", () => {
    const now = utc("2026-03-08T15:00:00Z");
    expect(startOfDay(NY, now)).toBe(utc("2026-03-08T05:00:00Z"));
    expect(nextDayStart(NY, now)).toBe(utc("2026-03-09T04:00:00Z"));
  });
  test("startOfMonth lands on the 1st at local midnight", () => {
    expect(new Date(startOfMonth(NY, utc("2026-03-15T15:00:00Z"))).toISOString()).toBe("2026-03-01T05:00:00.000Z");
  });
  test("now always falls inside its own window", () => {
    for (const zone of [NY, KOL, UTC]) {
      for (const kind of ["day", "week", "month"] as const) {
        for (const iso of ["2026-03-08T06:59:59Z", "2026-03-08T07:00:01Z", "2026-11-01T05:30:00Z", "2026-12-31T23:59:59Z"]) {
          const now = utc(iso);
          const range = createWindow(kind, zone).range(now);
          expect(range.start).toBeLessThanOrEqual(now);
          expect(range.end).toBeGreaterThan(now);
        }
      }
    }
  });
});

describe("formatLocalDateTime", () => {
  test("formats in the requested zone, not the machine zone", () => {
    expect(formatLocalDateTime(utc("2026-03-08T15:00:00Z"), NY)).toBe("Mar 08 11:00");
    expect(formatLocalDateTime(utc("2026-03-08T15:00:00Z"), KOL)).toBe("Mar 08 20:30");
    expect(formatLocalDateTime(utc("2026-03-08T15:00:00Z"), UTC)).toBe("Mar 08 15:00");
  });
});
