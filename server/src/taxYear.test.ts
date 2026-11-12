// Unit tests for the Final Extras tax-year / per-diem logic
// (server/src/taxYear.ts). Run: bun test server/src/taxYear.test.ts

import { describe, expect, test } from "bun:test";
import { buildTaxWorksheet, expenseTotalsForYear, perDiemDates, perDiemDayCount, TAX_EXPENSE_CATEGORIES } from "./taxYear";

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

  test("the worksheet batch's categories joined the offered set (2026-11-12)", () => {
    for (const c of ["repairs", "dot_testing", "licensing", "software"]) {
      expect(TAX_EXPENSE_CATEGORIES).toContain(c as (typeof TAX_EXPENSE_CATEGORIES)[number]);
    }
  });
});

describe("buildTaxWorksheet — the paper worksheet over the driver's own records", () => {
  const income = [
    { paidAtMs: ms("2026-01-15T17:00:00Z"), kind: "w2", isForm: false, payer: "Acme Haul", gross: 1200 },
    { paidAtMs: ms("2026-02-15T17:00:00Z"), kind: "1099", isForm: false, payer: "Broker Co", gross: 2400.5 },
    // A year-end form for the same money — never a row, never counted.
    { paidAtMs: ms("2027-01-20T17:00:00Z"), kind: "1099", isForm: true, payer: "Broker Co", gross: 2400.5 },
    { paidAtMs: ms("2025-06-15T17:00:00Z"), kind: "w2", isForm: false, payer: "Old Job", gross: 900 },
  ];
  const expenses = [
    { spentAtMs: ms("2026-01-10T12:00:00Z"), category: "maintenance", amount: 300 },
    { spentAtMs: ms("2026-02-10T12:00:00Z"), category: "repairs", amount: 200 },
    { spentAtMs: ms("2026-03-10T12:00:00Z"), category: "dot_testing", amount: 85 },
    { spentAtMs: ms("2026-03-11T12:00:00Z"), category: "licensing", amount: 120 },
    { spentAtMs: ms("2026-04-10T12:00:00Z"), category: "software", amount: 25 },
    { spentAtMs: ms("2026-05-10T12:00:00Z"), category: "supplies", amount: 60 },
    { spentAtMs: ms("2026-06-10T12:00:00Z"), category: "mystery_future_category", amount: 40 },
  ];

  test("income rows are the year's paychecks only, each in its own lane, oldest first", () => {
    const ws = buildTaxWorksheet({ income, expenses, year: 2026 });
    expect(ws.incomeRows.map((r) => [r.dateIso, r.payer, r.lane, r.gross])).toEqual([
      ["2026-01-15", "Acme Haul", "w2", 1200],
      ["2026-02-15", "Broker Co", "1099", 2400.5],
    ]);
  });

  test("lane subtotals stay separate — there is no combined filing total", () => {
    const ws = buildTaxWorksheet({ income, expenses, year: 2026 });
    expect(ws.w2).toEqual({ gross: 1200, count: 1 });
    expect(ws.ten99).toEqual({ gross: 2400.5, count: 1 });
    expect(Object.keys(ws)).not.toContain("combinedGross");
    expect(Object.keys(ws)).not.toContain("combined");
  });

  test("pay rows carry miles only where the record carries them — never invented", () => {
    const ws = buildTaxWorksheet({ income, expenses, year: 2026 });
    expect(ws.incomeRows.every((r) => r.miles === null)).toBe(true);
    const withMiles = buildTaxWorksheet({
      income: [{ paidAtMs: ms("2026-01-15T17:00:00Z"), kind: "1099", isForm: false, payer: "P", gross: 100, miles: 2100 }],
      expenses: [],
      year: 2026,
    });
    expect(withMiles.incomeRows[0]!.miles).toBe(2100);
  });

  test("maintenance + repairs show as ONE worksheet line; the new categories get their own lines", () => {
    const ws = buildTaxWorksheet({ income, expenses, year: 2026 });
    const vehicle = ws.sections.find((s) => s.key === "vehicle")!;
    const line = (k: string) => vehicle.lines.find((l) => l.key === k)!;
    expect(line("maintenance_repairs")).toMatchObject({ total: 500, count: 2 });
    expect(line("dot_testing")).toMatchObject({ total: 85, count: 1 });
    expect(line("licensing")).toMatchObject({ total: 120, count: 1 });
    const equipment = ws.sections.find((s) => s.key === "equipment")!;
    expect(equipment.lines.find((l) => l.key === "supplies")).toMatchObject({ total: 60, count: 1 });
    expect(equipment.lines.find((l) => l.key === "software")).toMatchObject({ total: 25, count: 1 });
  });

  test("an unmapped category is never dropped — it lands in Other expenses and totals reconcile", () => {
    const ws = buildTaxWorksheet({ income, expenses, year: 2026 });
    const vehicle = ws.sections.find((s) => s.key === "vehicle")!;
    expect(vehicle.lines.find((l) => l.key === "other")).toMatchObject({ total: 40, count: 1 });
    const sectionSum = ws.sections.reduce((s, sec) => s + sec.subtotal, 0);
    expect(Math.round(sectionSum * 100) / 100).toBe(ws.expenseTotal);
    expect(ws.expenseTotal).toBe(expenseTotalsForYear(expenses, 2026).total);
    expect(ws.expenseCount).toBe(7);
  });

  test("an empty year is an honest empty worksheet", () => {
    const ws = buildTaxWorksheet({ income, expenses, year: 2024 });
    expect(ws.incomeRows).toEqual([]);
    expect(ws.w2).toEqual({ gross: 0, count: 0 });
    expect(ws.ten99).toEqual({ gross: 0, count: 0 });
    expect(ws.expenseTotal).toBe(0);
    expect(ws.sections.every((s) => s.subtotal === 0)).toBe(true);
  });
});
