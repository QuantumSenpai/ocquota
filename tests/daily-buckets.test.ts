/**
 * dailyBuckets must bucket by *real* local days: exact for fixed-offset zones
 * and for the 23-hour / 25-hour days of a DST zone. Both zones are passed
 * explicitly, so these assertions are independent of the machine's own zone.
 *
 *   bun test
 */

import { describe, expect, test } from "bun:test";
import { createTimeZone } from "../src/core/timezone.ts";
import { offsetSegments } from "../src/core/time.ts";
import { SqliteUsageRepository } from "../src/data/sqlite-usage-repository.ts";
import { assistantData, withFixture } from "./helpers/fixture-db.ts";

const utc = (iso: string): number => Date.parse(iso);
const IST = createTimeZone("Asia/Kolkata");
const NY = createTimeZone("America/New_York");
const token = (input: number) => assistantData({ input });

describe("dailyBuckets · fixed offset (Asia/Kolkata)", () => {
  test("a row at 23:59:59.999 and one at 00:00:00.000 land in different days", () => {
    withFixture((fx) => {
      const repo = new SqliteUsageRepository(fx.db);
      fx.message({ data: token(10), timeCreated: utc("2026-03-05T18:29:59.999Z") }); // Mar 5 23:59:59.999 IST
      fx.message({ data: token(20), timeCreated: utc("2026-03-05T18:30:00.000Z") }); // Mar 6 00:00:00.000 IST
      fx.message({ data: token(40), timeCreated: utc("2026-03-06T06:30:00.000Z") }); // Mar 6 12:00 IST

      const buckets = repo.dailyBuckets(utc("2026-03-04T18:30:00Z"), utc("2026-03-07T18:30:00Z"), IST);
      expect(buckets.map((b) => [new Date(b.dayStart).toISOString(), b.totalTokens])).toEqual([
        ["2026-03-04T18:30:00.000Z", 10], // Mar 5 00:00 IST
        ["2026-03-05T18:30:00.000Z", 60], // Mar 6 00:00 IST
      ]);
    });
  });

  test("one constant-offset segment covers the whole range", () => {
    const segments = offsetSegments(IST, utc("2026-03-01T00:00:00Z"), utc("2026-04-01T00:00:00Z"));
    expect(segments).toHaveLength(1);
    expect(segments[0]?.offsetMinutes).toBe(330);
  });
});

describe("dailyBuckets · spring forward (America/New_York, 2026-03-08)", () => {
  test("the last hour before the change stays on its own local day", () => {
    withFixture((fx) => {
      const repo = new SqliteUsageRepository(fx.db);
      fx.message({ data: token(1), timeCreated: utc("2026-03-08T04:30:00Z") }); // Mar 7 23:30 EST
      fx.message({ data: token(2), timeCreated: utc("2026-03-08T06:59:59Z") }); // Mar 8 01:59:59 EST
      fx.message({ data: token(4), timeCreated: utc("2026-03-08T07:00:00Z") }); // Mar 8 03:00 EDT (02:xx skipped)
      fx.message({ data: token(8), timeCreated: utc("2026-03-09T03:30:00Z") }); // Mar 8 23:30 EDT
      fx.message({ data: token(16), timeCreated: utc("2026-03-09T04:30:00Z") }); // Mar 9 00:30 EDT

      const buckets = repo.dailyBuckets(utc("2026-03-06T05:00:00Z"), utc("2026-03-10T04:00:00Z"), NY);
      expect(buckets.map((b) => [new Date(b.dayStart).toISOString(), b.totalTokens, b.messages])).toEqual([
        ["2026-03-07T05:00:00.000Z", 1, 1], // Mar 7 00:00 EST
        ["2026-03-08T05:00:00.000Z", 14, 3], // Mar 8 is 23 hours long
        ["2026-03-09T04:00:00.000Z", 16, 1], // Mar 9 00:00 EDT (already one hour ahead)
      ]);
    });
  });

  test("the transition instant is found to the millisecond", () => {
    const segments = offsetSegments(NY, utc("2026-03-06T05:00:00Z"), utc("2026-03-10T04:00:00Z"));
    expect(segments.map((s) => [new Date(s.end).toISOString(), s.offsetMinutes])).toEqual([
      ["2026-03-08T07:00:00.000Z", -300], // EST until 02:00 local
      ["2026-03-10T04:00:00.000Z", -240], // EDT after it
    ]);
  });
});

describe("dailyBuckets · fall back (America/New_York, 2026-11-01)", () => {
  test("the repeated hour stays on its day and the day is 25 hours long", () => {
    withFixture((fx) => {
      const repo = new SqliteUsageRepository(fx.db);
      fx.message({ data: token(1), timeCreated: utc("2026-11-01T03:30:00Z") }); // Oct 31 23:30 EDT
      fx.message({ data: token(2), timeCreated: utc("2026-11-01T05:30:00Z") }); // Nov 1 01:30 EDT
      fx.message({ data: token(4), timeCreated: utc("2026-11-01T06:30:00Z") }); // Nov 1 01:30 EST (again)
      fx.message({ data: token(8), timeCreated: utc("2026-11-02T04:30:00Z") }); // Nov 1 23:30 EST
      fx.message({ data: token(16), timeCreated: utc("2026-11-02T05:30:00Z") }); // Nov 2 00:30 EST

      const buckets = repo.dailyBuckets(utc("2026-10-31T04:00:00Z"), utc("2026-11-02T05:00:00Z"), NY);
      expect(buckets.map((b) => [new Date(b.dayStart).toISOString(), b.totalTokens, b.messages])).toEqual([
        ["2026-10-31T04:00:00.000Z", 1, 1], // Oct 31 00:00 EDT
        ["2026-11-01T04:00:00.000Z", 14, 3], // Nov 1 is 25 hours long
      ]);
    });
  });

  test("two segments, split exactly at the fall-back instant", () => {
    const segments = offsetSegments(NY, utc("2026-10-31T04:00:00Z"), utc("2026-11-02T05:00:00Z"));
    expect(segments.map((s) => [new Date(s.end).toISOString(), s.offsetMinutes])).toEqual([
      ["2026-11-01T06:00:00.000Z", -240],
      ["2026-11-02T05:00:00.000Z", -300],
    ]);
  });
});

describe("dailyBuckets · empty ranges", () => {
  test("an empty span yields no segments and no buckets", () => {
    withFixture((fx) => {
      const repo = new SqliteUsageRepository(fx.db);
      expect(offsetSegments(NY, utc("2026-03-01T00:00:00Z"), utc("2026-03-01T00:00:00Z"))).toEqual([]);
      expect(repo.dailyBuckets(utc("2026-03-01T00:00:00Z"), utc("2026-03-01T00:00:00Z"), NY)).toEqual([]);
      expect(repo.dailyBuckets(utc("2026-03-02T00:00:00Z"), utc("2026-03-01T00:00:00Z"), NY)).toEqual([]);
    });
  });
});
