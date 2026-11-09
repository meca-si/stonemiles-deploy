// Unit tests for the Final Extras tax-year / per-diem logic
// (server/src/taxYear.ts). Run: bun test server/src/taxYear.test.ts

import { describe, expect, test } from "bun:test";
import { expenseTotalsForYear, perDiemDates, perDiemDayCount, TAX_EXPENSE_CATEGORIES } from "./taxYear";

const ms = (iso: string) => Date.parse(iso);

describe("perDiemDates — days out from sealed trip records only", () => {
  test("a same-day trip counts its one day", () => {
    const trips = [{ startedAtMs: ms("2026-03-04T08:00:00Z"), endedAtMs: ms("2026-03-04T19:00:00Z") }];
    expect(perDiemDates(trips, 2026)).toEqual(["2026-03-04"]);
    expect(perDiemDayCount(trips, 2026)).toBe(1);
  });

  test("a multi-day trip counts every day it touched, inclusive", () => {
    const trips = [{ startedAtMs: ms("2026-03-04T08:00:00Z"), endedAtMs: ms("2026-03-07T06:00:00Z") }];
    expect(perDiemDates(trips, 2026)).toEqual(["2026-03-04", "2026-03-05", "2026-03-06", "2026-03-07"]);
  });

  test("overlapping trips never double-count a day", () => {
    const trips = [
      { startedAtMs: ms("2026-05-01T06:00:00Z"), endedAtMs: ms("2026-05-03T06:00:00Z") },
      { startedAtMs: ms("2026-05-02T06:00:00Z"), endedAtMs: ms("2026-05-04T06:00:00Z") },
    ];
    expect(perDiemDayCount(trips, 2026)).toBe(4);
  });

  test("days outside the asked year are excluded, even mid-trip", () => {
    const trips = [{ startedAtMs: ms("2025-12-30T08:00:00Z"), endedAtMs: ms("2026-01-02T08:00:00Z") }];
    expect(perDiemDates(trips, 2026)).toEqual(["2026-01-01", "2026-01-02"]);
    expect(perDiemDates(trips, 2025)).toEqual(["2025-12-30", "2025-12-31"]);
  });

  test("no trips means zero days — nothing is estimated into existence", () => {
    expect(perDiemDayCount([], 2026)).toBe(0);
    expect(perDiemDates([], 2026)).toEqual([]);
  });

  test("a broken span (end before start) counts only its start day", () => {
    const trips = [{ startedAtMs: ms("2026-06-10T08:00:00Z"), endedAtMs: ms("2026-06-09T08:00:00Z") }];
    expect(perDiemDates(trips, 2026)).toEqual(["2026-06-10"]);
  });
});

describe("expenseTotalsForYear — grouped by the driver-confirmed category", () => {
  const expenses = [
    { spentAtMs: ms("2026-01-15T12:00:00Z"), category: "fuel", amount: 400.1 },
    { spentAtMs: ms("2026-02-15T12:00:00Z"), category: "fuel", amount: 300.2 },
    { spentAtMs: ms("2026-03-15T12:00:00Z"), category: "meals", amount: 45.5 },
    { spentAtMs: ms("2025-12-31T12:00:00Z"), category: "fuel", amount: 999 },
  ];

  test("sums per category for the year only, biggest first", () => {
    const r = expenseTotalsForYear(expenses, 2026);
    expect(r.count).toBe(3);
    expect(r.total).toBe(745.8);
    expect(r.byCategory).toEqual([
      { category: "fuel", total: 700.3, count: 2 },
      { category: "meals", total: 45.5, count: 1 },
    ]);
  });

  test("an empty year is an honest zero", () => {
    const r = expenseTotalsForYear(expenses, 2024);
    expect(r).toEqual({ byCategory: [], total: 0, count: 0 });
  });

  test("the offered category set covers the brief's working set", () => {
    for (const c of ["fuel", "maintenance", "tolls", "parking", "meals", "supplies", "other"]) {
      expect(TAX_EXPENSE_CATEGORIES).toContain(c as (typeof TAX_EXPENSE_CATEGORIES)[number]);
    }
  });
});
