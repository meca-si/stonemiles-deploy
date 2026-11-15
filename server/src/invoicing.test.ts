// invoicing.test.ts — UNIT tests for the invoicing + P&L pure rules
// (server/src/invoicing.ts, TMS queue item 3):
//   (a) invoice math against a sealed load: freight (rate + extras)
//       plus claim events grouped by kind = the amount; the lines
//       itemise exactly those parts and nothing else
//   (b) a load with no rate on file yields a null amount — an
//       invoice is never figured off an invented rate
//   (c) invoice numbering is sequential per year
//   (d) display status: overdue is derived from the due date, never
//       stored; paid is terminal
//   (e) P&L aggregation: period filtering (UTC month/quarter/year),
//       income from delivered loads + claims, costs split fuel
//       purchases / expenses by category / maintenance log, per-load
//       lines reconcile with the period expense total
//
// Integration coverage (actions, isolation, board clearing, the
// rate-only-on-invoice pin) lives in invoicingFlow.test.ts.

import { describe, expect, test } from "bun:test";
import {
  buildProfitLoss,
  formatInvoiceNumber,
  invoiceDisplayStatus,
  invoiceLinesFor,
  plPeriodRange,
} from "./invoicing";

describe("invoice lines + amount", () => {
  test("freight = rate + extras; claims group by kind; amount is the board figure", () => {
    const r = invoiceLinesFor(
      { rate: 2400, extraCharges: 150, extraChargesNote: "Detention" },
      [
        { kind: "tonu", amount: 250 },
        { kind: "layover", amount: 175 },
        { kind: "layover", amount: 175 },
      ],
    );
    expect(r.freight).toBe(2550);
    expect(r.claimsTotal).toBe(600);
    expect(r.amount).toBe(3150);
    expect(r.lines).toEqual([
      { label: "Freight", amount: 2400 },
      { label: "Additional charges — Detention", amount: 150 },
      { label: "TONU (truck ordered, not used)", amount: 250 },
      { label: "Layover", amount: 350 },
    ]);
  });

  test("no extras and no claims: a single freight line", () => {
    const r = invoiceLinesFor({ rate: 1800, extraCharges: 0, extraChargesNote: null }, []);
    expect(r.lines).toEqual([{ label: "Freight", amount: 1800 }]);
    expect(r.amount).toBe(1800);
    expect(r.claimsTotal).toBe(0);
  });

  test("no rate on file: null amount, no freight lines — never invented", () => {
    const r = invoiceLinesFor({ rate: null, extraCharges: 0, extraChargesNote: null }, [{ kind: "tonu", amount: 250 }]);
    expect(r.freight).toBeNull();
    expect(r.amount).toBeNull();
    // The claim is still real money owed — it itemises, but the bill
    // total stays unfigured until a rate exists.
    expect(r.claimsTotal).toBe(250);
    expect(r.lines.some((l) => l.label.startsWith("Freight"))).toBe(false);
  });

  test("cents round cleanly", () => {
    const r = invoiceLinesFor({ rate: 2500.25, extraCharges: 100.05, extraChargesNote: null }, [{ kind: "driver_assist", amount: 75.1 }]);
    expect(r.freight).toBe(2600.3);
    expect(r.amount).toBe(2675.4);
  });
});

describe("invoice numbering + status", () => {
  test("numbers are INV-<year>-<seq padded to 4>", () => {
    expect(formatInvoiceNumber(2026, 1)).toBe("INV-2026-0001");
    expect(formatInvoiceNumber(2026, 42)).toBe("INV-2026-0042");
    expect(formatInvoiceNumber(2027, 1234)).toBe("INV-2027-1234");
  });

  test("overdue derives from the due date; draft and paid never read overdue", () => {
    const now = Date.UTC(2026, 10, 15);
    expect(invoiceDisplayStatus({ status: "draft", dueAtMs: now - 1000 }, now)).toBe("draft");
    expect(invoiceDisplayStatus({ status: "issued", dueAtMs: now - 1000 }, now)).toBe("overdue");
    expect(invoiceDisplayStatus({ status: "issued", dueAtMs: now + 1000 }, now)).toBe("issued");
    expect(invoiceDisplayStatus({ status: "issued", dueAtMs: null }, now)).toBe("issued");
    expect(invoiceDisplayStatus({ status: "paid", dueAtMs: now - 1000 }, now)).toBe("paid");
  });
});

describe("P&L periods", () => {
  test("month / quarter / year ranges are UTC and half-open", () => {
    const m = plPeriodRange("month", 2026, 11);
    expect(m.startMs).toBe(Date.UTC(2026, 10, 1));
    expect(m.endMs).toBe(Date.UTC(2026, 11, 1));
    expect(m.label).toBe("November 2026");
    expect(m.key).toBe("month:2026:11");
    const q = plPeriodRange("quarter", 2026, 4);
    expect(q.startMs).toBe(Date.UTC(2026, 9, 1));
    expect(q.endMs).toBe(Date.UTC(2027, 0, 1));
    expect(q.label).toBe("Q4 2026");
    const y = plPeriodRange("year", 2026, 1);
    expect(y.startMs).toBe(Date.UTC(2026, 0, 1));
    expect(y.endMs).toBe(Date.UTC(2027, 0, 1));
  });

  test("out-of-range inputs clamp instead of throwing", () => {
    expect(plPeriodRange("month", 2026, 13).index).toBe(12);
    expect(plPeriodRange("quarter", 2026, 0).index).toBe(1);
  });
});

describe("P&L aggregation", () => {
  const period = plPeriodRange("month", 2026, 11); // November 2026 UTC
  const nov = (d: number) => Date.UTC(2026, 10, d);
  const input = {
    period,
    loads: [
      { loadId: 1, deliveredAtMs: nov(3), gross: 2550, claimsTotal: 600 },
      { loadId: 2, deliveredAtMs: nov(20), gross: 1800, claimsTotal: 0 },
      { loadId: 3, deliveredAtMs: Date.UTC(2026, 9, 31), gross: 9999, claimsTotal: 0 }, // October — out
      { loadId: 4, deliveredAtMs: nov(25), gross: null, claimsTotal: 100 }, // no rate — unfigured
    ],
    expenses: [
      { spentAtMs: nov(4), category: "fuel", amount: 300, loadId: 1 },
      { spentAtMs: nov(5), category: "tolls", amount: 45.5, loadId: 1 },
      { spentAtMs: nov(6), category: "meals", amount: 60, loadId: null },
      { spentAtMs: Date.UTC(2026, 9, 15), category: "tolls", amount: 999, loadId: 1 }, // October — out of period
      { spentAtMs: nov(21), category: "insurance", amount: 500, loadId: null },
    ],
    fuelPurchases: [
      { purchasedAtMs: nov(4), total: 412.75 },
      { purchasedAtMs: Date.UTC(2026, 11, 1), total: 888 }, // December — out
    ],
    maintenance: [
      { performedAtMs: nov(10), cost: 289.9 },
      { performedAtMs: Date.UTC(2026, 9, 2), cost: 777 }, // October — out
    ],
  };

  test("income: delivered loads' freight + claims, period-filtered, unfigured counted", () => {
    const pl = buildProfitLoss(input);
    expect(pl.incomeFreight).toBe(4350); // 2550 + 1800 (October's 9999 excluded)
    expect(pl.incomeClaims).toBe(700); // 600 + 100 from the unfigured load's claims
    expect(pl.incomeTotal).toBe(5050);
    expect(pl.unfiguredLoads).toBe(1);
  });

  test("costs: fuel purchases, expenses by category, maintenance log — separate lines", () => {
    const pl = buildProfitLoss(input);
    const byKey = new Map(pl.costLines.map((l) => [l.key, l.amount]));
    expect(byKey.get("fuel_purchases")).toBe(412.75);
    expect(byKey.get("expense:fuel")).toBe(300);
    expect(byKey.get("expense:tolls")).toBe(45.5); // the October 999 stays out
    expect(byKey.get("expense:meals")).toBe(60);
    expect(byKey.get("expense:insurance")).toBe(500);
    expect(byKey.get("maintenance_log")).toBe(289.9);
    expect(pl.costsTotal).toBe(1608.15);
    expect(pl.net).toBe(3441.85);
  });

  test("per-load lines: tagged in-period expenses land on their load and reconcile", () => {
    const pl = buildProfitLoss(input);
    const l1 = pl.perLoad.find((l) => l.loadId === 1)!;
    expect(l1.income).toBe(3150);
    expect(l1.costs).toBe(345.5); // 300 fuel + 45.50 tolls (the October toll is out of period)
    expect(l1.net).toBe(2804.5);
    const l2 = pl.perLoad.find((l) => l.loadId === 2)!;
    expect(l2).toMatchObject({ income: 1800, costs: 0, net: 1800 });
    const l4 = pl.perLoad.find((l) => l.loadId === 4)!;
    expect(l4.income).toBeNull();
    expect(l4.net).toBeNull();
    expect(pl.perLoad.some((l) => l.loadId === 3)).toBe(false); // October load not in a November statement
    // Reconciliation: period expenses (905.50) = per-load tagged (345.50) + unassigned (560).
    expect(pl.unassignedExpenses).toBe(560);
  });

  test("an empty period is all zeros, no lines", () => {
    const pl = buildProfitLoss({ loads: [], expenses: [], fuelPurchases: [], maintenance: [], period: plPeriodRange("year", 2025, 1) });
    expect(pl.incomeTotal).toBe(0);
    expect(pl.costsTotal).toBe(0);
    expect(pl.net).toBe(0);
    expect(pl.costLines).toEqual([]);
    expect(pl.perLoad).toEqual([]);
  });
});
