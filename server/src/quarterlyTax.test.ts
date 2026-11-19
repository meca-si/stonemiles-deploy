// Unit tests for the Quarterly Tax card logic (server/src/quarterlyTax.ts).
// Run: bun test server/src/quarterlyTax.test.ts

import { describe, expect, test } from "bun:test";
import { clampIncomeRatePct, summarizeQuarterlyTax } from "./quarterlyTax";

const ms = (iso: string) => Date.parse(iso);
const NOW = ms("2026-11-18T12:00:00Z"); // mid-P4 2026: P1–P3 past, P4 open

const check = (paidAt: string, gross: number, otherDeductions = 0, kind: "w2" | "1099" = "1099", isForm = false) => ({
  paidAtMs: ms(paidAt),
  kind,
  isForm,
  gross,
  otherDeductions,
});
const expense = (spentAt: string, amount: number) => ({ spentAtMs: ms(spentAt), amount });
const fuelRow = (purchasedAt: string, total: number) => ({ purchasedAtMs: ms(purchasedAt), total });

describe("summarizeQuarterlyTax — IRS period bucketing", () => {
  test("April and May land in P2, June opens P3 (the IRS quarters are not calendar quarters)", () => {
    const s = summarizeQuarterlyTax(
      [check("2026-04-10T17:00:00Z", 1000), check("2026-05-20T17:00:00Z", 2000), check("2026-06-05T17:00:00Z", 4000)],
      [],
      [],
      2026,
      12,
      NOW,
    );
    expect(s.periods[1]!.gross1099).toBe(3000);
    expect(s.periods[1]!.count).toBe(2);
    expect(s.periods[2]!.gross1099).toBe(4000);
    expect(s.periods[0]!.gross1099).toBe(0);
    expect(s.periods[3]!.gross1099).toBe(0);
  });

  test("due dates are the real IRS ones, P4 due Jan 15 of the next year", () => {
    const s = summarizeQuarterlyTax([], [], [], 2026, 12, NOW);
    expect(s.periods.map((p) => p.dueIso)).toEqual(["2026-04-15", "2026-06-15", "2026-09-15", "2027-01-15"]);
    expect(s.periods.map((p) => p.dueLabel)).toEqual(["Apr 15, 2026", "Jun 15, 2026", "Sep 15, 2026", "Jan 15, 2027"]);
    expect(s.periods.map((p) => p.monthsLabel)).toEqual(["Jan – Mar", "Apr – May", "Jun – Aug", "Sep – Dec"]);
  });

  test("due states follow the clock: past periods, the open one, and next year's view", () => {
    const s = summarizeQuarterlyTax([], [], [], 2026, 12, NOW);
    expect(s.periods.map((p) => p.dueState)).toEqual(["past", "past", "past", "open"]);
    const future = summarizeQuarterlyTax([], [], [], 2027, 12, NOW);
    expect(future.periods.every((p) => p.dueState === "upcoming")).toBe(true);
  });

  test("other years' rows never leak into the asked year", () => {
    const s = summarizeQuarterlyTax(
      [check("2025-02-10T17:00:00Z", 9000), check("2026-02-10T17:00:00Z", 1000)],
      [expense("2025-02-11T17:00:00Z", 500)],
      [fuelRow("2026-02-12T17:00:00Z", 300)],
      2026,
      12,
      NOW,
    );
    expect(s.totals.gross1099).toBe(1000);
    expect(s.totals.expenses).toBe(0);
    expect(s.totals.fuel).toBe(300);
    expect(s.hasData).toBe(true);
  });
});

describe("summarizeQuarterlyTax — lanes and netting", () => {
  test("W-2 checks and 1099 form entries never count", () => {
    const s = summarizeQuarterlyTax(
      [
        check("2026-01-15T17:00:00Z", 5000, 0, "w2"),
        check("2026-01-20T17:00:00Z", 7000, 0, "1099", true),
        check("2026-01-25T17:00:00Z", 3000),
      ],
      [],
      [],
      2026,
      12,
      NOW,
    );
    expect(s.periods[0]!.gross1099).toBe(3000);
    expect(s.periods[0]!.count).toBe(1);
    expect(s.totals.count).toBe(1);
  });

  test("net mirrors the 1099 packet: gross − stub deductions − expenses − fuel, each dollar once", () => {
    const s = summarizeQuarterlyTax(
      [check("2026-07-10T17:00:00Z", 10000, 2500)],
      [expense("2026-07-12T17:00:00Z", 1200)],
      [fuelRow("2026-08-01T17:00:00Z", 800)],
      2026,
      12,
      NOW,
    );
    const p3 = s.periods[2]!;
    expect(p3.gross1099).toBe(10000);
    expect(p3.stubDeductions).toBe(2500);
    expect(p3.expenses).toBe(1200);
    expect(p3.fuel).toBe(800);
    expect(p3.net).toBe(5500);
  });

  test("an empty year is an honest zero, hasData false", () => {
    const s = summarizeQuarterlyTax([], [], [], 2026, 12, NOW);
    expect(s.hasData).toBe(false);
    expect(s.totals.net).toBe(0);
    expect(s.totals.setAside).toBe(0);
    expect(s.periods).toHaveLength(4);
  });
});

describe("summarizeQuarterlyTax — the estimate", () => {
  test("SE tax is 15.3% on 92.35% of net; income tax rides the picked rate; set-aside is their sum", () => {
    const s = summarizeQuarterlyTax([check("2026-02-01T17:00:00Z", 10000)], [], [], 2026, 12, NOW);
    const p1 = s.periods[0]!;
    // 10000 × 0.9235 = 9235; × 0.153 = 1412.955 → 1412.96 (banker's-free Math.round path: 923500c → 9235.00 → se 141295.5c → 141296c)
    expect(p1.seTax).toBe(1412.96);
    expect(p1.incomeTax).toBe(1200);
    expect(p1.setAside).toBe(2612.96);
    expect(s.totals.setAside).toBe(2612.96);
  });

  test("a losing period estimates zero tax but keeps its negative net on the record", () => {
    const s = summarizeQuarterlyTax(
      [check("2026-04-10T17:00:00Z", 1000, 400)],
      [expense("2026-04-11T17:00:00Z", 900)],
      [],
      2026,
      22,
      NOW,
    );
    const p2 = s.periods[1]!;
    expect(p2.net).toBe(-300);
    expect(p2.seTax).toBe(0);
    expect(p2.incomeTax).toBe(0);
    expect(p2.setAside).toBe(0);
  });

  test("a 0% income rate leaves SE tax alone standing", () => {
    const s = summarizeQuarterlyTax([check("2026-10-01T17:00:00Z", 5000)], [], [], 2026, 0, NOW);
    expect(s.periods[3]!.incomeTax).toBe(0);
    expect(s.periods[3]!.seTax).toBeGreaterThan(0);
    expect(s.periods[3]!.setAside).toBe(s.periods[3]!.seTax);
  });

  test("cents stay exact across many small checks", () => {
    const entries = Array.from({ length: 10 }, (_, i) => check(`2026-01-${String(i + 1).padStart(2, "0")}T17:00:00Z`, 333.33, 11.11));
    const s = summarizeQuarterlyTax(entries, [], [], 2026, 12, NOW);
    expect(s.periods[0]!.gross1099).toBe(3333.3);
    expect(s.periods[0]!.stubDeductions).toBe(111.1);
    expect(s.periods[0]!.net).toBe(3222.2);
  });
});

describe("clampIncomeRatePct", () => {
  test("clamps to 0–40 and defaults broken input to 12", () => {
    expect(clampIncomeRatePct(12)).toBe(12);
    expect(clampIncomeRatePct(-5)).toBe(0);
    expect(clampIncomeRatePct(99)).toBe(40);
    expect(clampIncomeRatePct(Number.NaN)).toBe(12);
  });
});
