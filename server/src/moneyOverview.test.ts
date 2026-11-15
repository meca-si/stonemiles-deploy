// moneyOverview.test.ts — pure-math coverage for the Money Overview
// (DrayageIQ-style earnings dashboard): the deduction classifier,
// the category sum pin, YTD totals, sealed-miles RPM, the projection
// gate, and week bucketing across a year boundary.

import { describe, expect, test } from "bun:test";
import {
  classifyDeductionLabel,
  computeMoneyOverview,
  weekStartMs,
  type MoneyOverviewEntryLike,
} from "./moneyOverview";

const noon = (y: number, m: number, d: number) => Date.UTC(y, m, d, 12);

function entry(p: Partial<MoneyOverviewEntryLike>): MoneyOverviewEntryLike {
  return {
    paidAtMs: noon(2026, 2, 2),
    kind: "1099",
    isForm: false,
    gross: 0,
    federalWithheld: 0,
    stateWithheld: 0,
    otherDeductions: 0,
    perDiem: 0,
    deductionLines: [],
    ...p,
  };
}

describe("classifyDeductionLabel", () => {
  test("typical stub labels land in their buckets", () => {
    expect(classifyDeductionLabel("Fuel")).toBe("Fuel");
    expect(classifyDeductionLabel("Fuel surcharge")).toBe("Fuel");
    expect(classifyDeductionLabel("Diesel")).toBe("Fuel");
    expect(classifyDeductionLabel("Insurance")).toBe("Insurance");
    expect(classifyDeductionLabel("Cargo insurance")).toBe("Insurance");
    expect(classifyDeductionLabel("Physical damage")).toBe("Insurance");
    expect(classifyDeductionLabel("Health insurance")).toBe("Insurance");
    expect(classifyDeductionLabel("Escrow")).toBe("Escrow");
    expect(classifyDeductionLabel("Truck payment")).toBe("Operations");
    expect(classifyDeductionLabel("Quickpay fee")).toBe("Operations");
    expect(classifyDeductionLabel("Service fee")).toBe("Operations");
    expect(classifyDeductionLabel("Trailer lease")).toBe("Operations");
  });

  test("collisions resolve in the pinned order", () => {
    // Escrow beats operations for a maintenance escrow.
    expect(classifyDeductionLabel("Maintenance escrow")).toBe("Escrow");
    // Fuel beats the operations 'fee' word.
    expect(classifyDeductionLabel("Fuel card fee")).toBe("Fuel");
  });

  test("unrecognized labels are honestly Other — never guessed", () => {
    expect(classifyDeductionLabel("401(k)")).toBe("Other");
    expect(classifyDeductionLabel("Child support")).toBe("Other");
    expect(classifyDeductionLabel("Union dues")).toBe("Other");
    expect(classifyDeductionLabel("Coffee")).toBe("Other");
    expect(classifyDeductionLabel("")).toBe("Other");
  });
});

describe("computeMoneyOverview", () => {
  const entries: MoneyOverviewEntryLike[] = [
    entry({
      paidAtMs: noon(2026, 2, 2), // Mon Mar 2 2026
      gross: 3000,
      otherDeductions: 900,
      deductionLines: [
        { label: "Fuel", amount: 400 },
        { label: "Insurance", amount: 200 },
        { label: "Escrow", amount: 150 },
        { label: "Truck payment", amount: 150 },
      ],
    }),
    entry({
      paidAtMs: noon(2026, 2, 9),
      kind: "w2",
      gross: 2000,
      federalWithheld: 200,
      stateWithheld: 50,
      otherDeductions: 100, // lump, no lines → Other
      deductionLines: [],
    }),
    entry({
      paidAtMs: noon(2026, 2, 16),
      gross: 1000,
      otherDeductions: 300,
      deductionLines: [{ label: "Fuel", amount: 100 }], // partial: 200 remainder → Other
    }),
    entry({ paidAtMs: noon(2026, 2, 23), gross: 500, perDiem: 75 }),
    // A year-end form never counts.
    entry({ paidAtMs: noon(2026, 0, 20), isForm: true, gross: 99999, otherDeductions: 9999 }),
    // Last year never counts.
    entry({ paidAtMs: noon(2025, 11, 30), gross: 8888, otherDeductions: 888 }),
  ];

  test("YTD totals, margin, and the keep split", () => {
    const o = computeMoneyOverview(entries, [], Date.UTC(2026, 10, 15, 18));
    expect(o.year).toBe(2026);
    expect(o.hasData).toBe(true);
    expect(o.ytd.gross).toBe(6500);
    expect(o.ytd.deductions).toBe(1550);
    expect(o.ytd.net).toBe(4950);
    expect(o.ytd.perDiem).toBe(75);
    expect(o.ytd.marginPct).toBe(76.2);
    expect(o.ytd.entryCount).toBe(4);
    expect(o.keep).toEqual({ kept: 4950, takenOut: 1550 });
  });

  test("PIN: category amounts sum exactly to total deductions", () => {
    const o = computeMoneyOverview(entries, [], Date.UTC(2026, 10, 15, 18));
    const sum = o.categories.reduce((s, c) => s + Math.round(c.amount * 100), 0);
    expect(sum).toBe(Math.round(o.ytd.deductions * 100));
    const byCat = new Map(o.categories.map((c) => [c.category, c.amount]));
    expect(byCat.get("Fuel")).toBe(500);
    expect(byCat.get("Insurance")).toBe(200);
    expect(byCat.get("Escrow")).toBe(150);
    expect(byCat.get("Operations")).toBe(150);
    expect(byCat.get("Taxes withheld")).toBe(250);
    expect(byCat.get("Other")).toBe(300); // 100 lump + 200 unitemized remainder
    const shareSum = o.categories.reduce((s, c) => s + c.sharePct, 0);
    expect(Math.abs(shareSum - 100)).toBeLessThan(0.5);
  });

  test("RPM runs off sealed-load miles in the same year only", () => {
    const loads = [
      { sealedAtMs: noon(2026, 2, 5), miles: 2000 },
      { sealedAtMs: noon(2026, 2, 20), miles: 1000 },
      { sealedAtMs: noon(2025, 11, 31), miles: 9999 }, // prior year — excluded
    ];
    const o = computeMoneyOverview(entries, loads, Date.UTC(2026, 10, 15, 18));
    expect(o.ytd.miles).toBe(3000);
    expect(o.ytd.grossPerMile).toBe(2.17);
    expect(o.ytd.netPerMile).toBe(1.65);
  });

  test("no sealed miles → RPM is null, never a guess", () => {
    const o = computeMoneyOverview(entries, [], Date.UTC(2026, 10, 15, 18));
    expect(o.ytd.grossPerMile).toBeNull();
    expect(o.ytd.netPerMile).toBeNull();
  });

  test("miles this week / this month from sealed loads", () => {
    const loads = [
      { sealedAtMs: noon(2026, 10, 12), miles: 500 }, // Thu of the current week
      { sealedAtMs: noon(2026, 10, 2), miles: 300 }, // earlier week, same month
      { sealedAtMs: noon(2026, 9, 30), miles: 700 }, // last month
    ];
    const o = computeMoneyOverview(entries, loads, Date.UTC(2026, 10, 15, 18));
    expect(o.milesThisWeek).toBe(500);
    expect(o.milesThisMonth).toBe(800);
  });

  test("projection gate: fewer than 4 weeks with entries → no projection", () => {
    const threeWeeks = entries.slice(0, 3);
    const o = computeMoneyOverview(threeWeeks, [], Date.UTC(2026, 2, 29, 18));
    expect(o.projection).toBeNull();
  });

  test("projection: 4+ weeks with entries → labelled run-rate × 52", () => {
    // Now = Sun Mar 29 2026: weeks run Mon Dec 29 2025 → Mon Mar 23
    // 2026 = 13 elapsed weeks; the four entries sit in 4 of them.
    const o = computeMoneyOverview(entries, [], Date.UTC(2026, 2, 29, 18));
    expect(o.projection).not.toBeNull();
    expect(o.projection!.weeksElapsed).toBe(13);
    expect(o.projection!.weeksWithEntries).toBe(4);
    expect(o.projection!.annualGross).toBe(26000); // 6500 / 13 × 52
    expect(o.projection!.annualNet).toBe(19800); // 4950 / 13 × 52
    expect(o.avgWeeklyNet).toBe(380.77); // 4950 / 13, cents-rounded
  });

  test("week trend: gaps stay gaps", () => {
    // Late April: all 17 elapsed weeks display, March entries visible.
    const o = computeMoneyOverview(entries, [], Date.UTC(2026, 3, 26, 18));
    expect(o.weeks.length).toBe(17);
    const withData = o.weeks.filter((w) => w.hasData);
    expect(withData.length).toBe(4);
    const mar2 = o.weeks.find((w) => w.weekStartMs === weekStartMs(noon(2026, 2, 2)));
    expect(mar2).toMatchObject({ gross: 3000, deductions: 900, net: 2100 });
    const empty = o.weeks.find((w) => !w.hasData);
    expect(empty).toMatchObject({ gross: 0, deductions: 0, net: 0 });
  });

  test("week trend caps at the last 26 weeks — YTD totals still cover the whole year", () => {
    const o = computeMoneyOverview(entries, [], Date.UTC(2026, 10, 15, 18));
    expect(o.weeks.length).toBe(26);
    // The March weeks have scrolled out of the display window…
    expect(o.weeks.filter((w) => w.hasData).length).toBe(0);
    // …but the year-to-date figures still count them.
    expect(o.ytd.gross).toBe(6500);
  });

  test("year boundary: Jan 1 lands in the first bucket (week of Dec 29)", () => {
    const jan = [
      entry({ paidAtMs: noon(2026, 0, 1), gross: 1200 }),
      entry({ paidAtMs: noon(2025, 11, 31), gross: 9999 }), // 2025 — excluded
    ];
    const o = computeMoneyOverview(jan, [], Date.UTC(2026, 0, 5, 18));
    expect(o.ytd.gross).toBe(1200);
    expect(o.weeks[0]!.weekStartMs).toBe(Date.UTC(2025, 11, 29));
    expect(o.weeks[0]!.label).toBe("Dec 29");
    expect(o.weeks[0]).toMatchObject({ gross: 1200, hasData: true });
  });

  test("empty year: honest zeros and nulls, no invented figures", () => {
    const o = computeMoneyOverview([], [], Date.UTC(2026, 10, 15, 18));
    expect(o.hasData).toBe(false);
    expect(o.ytd).toMatchObject({ gross: 0, deductions: 0, net: 0, marginPct: null, grossPerMile: null });
    expect(o.categories).toEqual([]);
    expect(o.projection).toBeNull();
    expect(o.avgWeeklyNet).toBeNull();
  });
});
