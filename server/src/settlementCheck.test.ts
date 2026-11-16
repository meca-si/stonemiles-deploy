// settlementCheck.test.ts — UNIT tests for the settlement
// cross-check's pure math (settlementCheck.ts): should-paid vs
// did-paid under both pay bases, the $1 match tolerance, unfigured
// loads listed with reasons and never guessed into the total,
// deduction reconciliation (itemized + unitemized remainder +
// withheld), per diem excluded from every figure, the entry-math
// flag, and the deterministic automatic coverage window.

import { describe, expect, test } from "bun:test";
import {
  applyLoadOverrides,
  computeSettlementCheck,
  previousSamePayerPaidAt,
  settlementWindowFor,
  type SettlementCheckExpectedLine,
} from "./settlementCheck";
import { settlementLineFor } from "./settlement";

const line = (
  loadId: number,
  expectedPay: number | null,
  basisNote = "figured",
  deliveredAtMs = 0,
): SettlementCheckExpectedLine => ({
  loadId,
  label: `City ${loadId}, AL → Town ${loadId}, TX`,
  deliveredAtMs,
  expectedPay,
  basisNote,
});

const entry = (over: Partial<Parameters<typeof computeSettlementCheck>[1]> = {}) => ({
  gross: 0,
  federalWithheld: 0,
  stateWithheld: 0,
  otherDeductions: 0,
  deductionLines: [],
  perDiem: 0,
  ...over,
});

describe("settlement check — should vs did", () => {
  test("SHORT: actual gross below expected beyond tolerance, shortBy stated", () => {
    const c = computeSettlementCheck([line(1, 1980), line(2, 550)], entry({ gross: 2400 }));
    expect(c.expectedTotal).toBe(2530);
    expect(c.actualGross).toBe(2400);
    expect(c.difference).toBe(-130);
    expect(c.status).toBe("short");
    expect(c.shortBy).toBe(130);
    expect(c.overBy).toBe(0);
  });

  test("OVER: actual gross above expected beyond tolerance", () => {
    const c = computeSettlementCheck([line(1, 1000)], entry({ gross: 1150.5 }));
    expect(c.status).toBe("over");
    expect(c.overBy).toBe(150.5);
    expect(c.shortBy).toBe(0);
  });

  test("MATCHES at the tolerance edge: exactly $1.00 either way still matches", () => {
    expect(computeSettlementCheck([line(1, 1000)], entry({ gross: 1001 })).status).toBe("matches");
    expect(computeSettlementCheck([line(1, 1000)], entry({ gross: 999 })).status).toBe("matches");
    expect(computeSettlementCheck([line(1, 1000)], entry({ gross: 1001.01 })).status).toBe("over");
    expect(computeSettlementCheck([line(1, 1000)], entry({ gross: 998.99 })).status).toBe("short");
  });

  test("percent basis lines (via settlement.ts) feed the expected total", () => {
    const s = { payBasis: "percent", driverCpm: null, driverPayPct: 90 };
    const l1 = settlementLineFor(s, { rate: 2000, extraCharges: 200, loadedMiles: 1100 });
    const l2 = settlementLineFor(s, { rate: 1000, extraCharges: 0, loadedMiles: 500 });
    const c = computeSettlementCheck(
      [
        { loadId: 1, label: "A", deliveredAtMs: 0, expectedPay: l1.pay, basisNote: l1.basisNote },
        { loadId: 2, label: "B", deliveredAtMs: 0, expectedPay: l2.pay, basisNote: l2.basisNote },
      ],
      entry({ gross: 2880 }),
    );
    expect(c.expectedTotal).toBe(2880); // 1980 + 900
    expect(c.status).toBe("matches");
  });

  test("CPM basis lines (via settlement.ts) feed the expected total", () => {
    const s = { payBasis: "cpm", driverCpm: 0.62, driverPayPct: null };
    const l1 = settlementLineFor(s, { rate: 1500, extraCharges: 0, loadedMiles: 1000 });
    const c = computeSettlementCheck(
      [{ loadId: 1, label: "A", deliveredAtMs: 0, expectedPay: l1.pay, basisNote: l1.basisNote }],
      entry({ gross: 600 }),
    );
    expect(c.expectedTotal).toBe(620);
    expect(c.status).toBe("short");
    expect(c.shortBy).toBe(20);
  });

  test("a no-rate load is excluded from the total and listed with its reason — never guessed", () => {
    const s = { payBasis: "percent", driverCpm: null, driverPayPct: 90 };
    const nr = settlementLineFor(s, { rate: null, extraCharges: 0, loadedMiles: 800 });
    const c = computeSettlementCheck(
      [
        line(1, 900),
        { loadId: 2, label: "No Rate Loads Inc lane", deliveredAtMs: 0, expectedPay: nr.pay, basisNote: nr.basisNote },
      ],
      entry({ gross: 900 }),
    );
    expect(c.expectedTotal).toBe(900);
    expect(c.figuredCount).toBe(1);
    expect(c.unfigured.length).toBe(1);
    expect(c.unfigured[0]!.loadId).toBe(2);
    expect(c.unfigured[0]!.reason).toContain("no rate on file");
    expect(c.status).toBe("matches");
  });

  test("no figured lines at all → no_data, never a verdict against $0", () => {
    const empty = computeSettlementCheck([], entry({ gross: 2400 }));
    expect(empty.status).toBe("no_data");
    expect(empty.statusReason).toContain("No sealed loads delivered in that window");
    const unfig = computeSettlementCheck([line(1, null, "no loaded miles on file")], entry({ gross: 2400 }));
    expect(unfig.status).toBe("no_data");
    expect(unfig.expectedTotal).toBe(0);
    expect(unfig.shortBy).toBe(0);
    expect(unfig.overBy).toBe(0);
  });
});

describe("settlement check — deductions reconcile exactly", () => {
  test("itemized lines classify via the Money Overview buckets; unitemized remainder lands in Other; withheld is Taxes", () => {
    const c = computeSettlementCheck(
      [line(1, 3000)],
      entry({
        gross: 3000,
        federalWithheld: 200,
        stateWithheld: 50,
        otherDeductions: 1000,
        deductionLines: [
          { label: "Fuel", amount: 600 },
          { label: "Maintenance escrow", amount: 250 },
        ],
      }),
    );
    const byCat = new Map(c.deductionBreakdown.map((b) => [b.category, b.amount]));
    expect(byCat.get("Fuel")).toBe(600);
    expect(byCat.get("Escrow")).toBe(250); // escrow wins over operations
    expect(byCat.get("Other")).toBe(150); // 1000 − 850 unitemized remainder
    expect(byCat.get("Taxes withheld")).toBe(250);
    const breakdownSum = c.deductionBreakdown.reduce((s, b) => s + b.amount, 0);
    expect(breakdownSum).toBe(c.totalDeductions + c.withheld);
    expect(c.totalDeductions).toBe(1000);
    expect(c.withheld).toBe(250);
    expect(c.actualNet).toBe(1750); // 3000 − 1000 − 250
    expect(c.expectedNet).toBe(1750);
  });

  test("expected net applies the SAME deductions actually taken to the expected gross", () => {
    const c = computeSettlementCheck(
      [line(1, 2530)],
      entry({ gross: 2400, otherDeductions: 300, deductionLines: [{ label: "Fuel", amount: 300 }] }),
    );
    expect(c.actualNet).toBe(2100);
    expect(c.expectedNet).toBe(2230); // the $130 shortage carries through to net
  });

  test("per diem is reported on its own line and excluded from gross, deductions, and both nets", () => {
    const c = computeSettlementCheck(
      [line(1, 1000)],
      entry({ gross: 1000, otherDeductions: 100, perDiem: 350 }),
    );
    expect(c.perDiem).toBe(350);
    expect(c.actualGross).toBe(1000);
    expect(c.actualNet).toBe(900);
    expect(c.expectedNet).toBe(900);
    expect(c.deductionBreakdown.reduce((s, b) => s + b.amount, 0)).toBe(100);
  });

  test("entry-math flag: itemized lines claiming more than the recorded total do not reconcile", () => {
    const bad = computeSettlementCheck(
      [line(1, 1000)],
      entry({ gross: 1000, otherDeductions: 100, deductionLines: [{ label: "Fuel", amount: 150 }] }),
    );
    expect(bad.entryMathOk).toBe(false);
    expect(bad.entryMathNote).toContain("don't reconcile");
    const partial = computeSettlementCheck(
      [line(1, 1000)],
      entry({ gross: 1000, otherDeductions: 400, deductionLines: [{ label: "Fuel", amount: 150 }] }),
    );
    expect(partial.entryMathOk).toBe(true); // partial itemization reconciles via the Other remainder
  });
});

describe("settlement check — driver overrides (verify + edit)", () => {
  const inWin = [line(1, 1000, "figured", 100), line(2, 500, "figured", 200)];
  const all = [...inWin, line(3, 250, "figured", 50), line(4, 750, "figured", 300)];

  test("hold out removes an in-window load; pull in adds an outside one; both are named", () => {
    const r = applyLoadOverrides(inWin, all, {
      windowFromMs: null,
      windowToMs: null,
      excludedLoadIds: [2],
      includedLoadIds: [3],
    });
    expect(r.lines.map((l) => l.loadId)).toEqual([1, 3]); // newest-delivered first: id1 @100, id3 @50 → sorted desc by deliveredAtMs: 100 then 50
    expect(r.heldOut.map((l) => l.loadId)).toEqual([2]);
    expect(r.pulledIn.map((l) => l.loadId)).toEqual([3]);
  });

  test("a load named in both lists is held out — exclusion wins, deterministically", () => {
    const r = applyLoadOverrides(inWin, all, {
      windowFromMs: null,
      windowToMs: null,
      excludedLoadIds: [4],
      includedLoadIds: [4],
    });
    // Load 4 isn't in the window, so there's nothing to hold out —
    // and the exclusion keeps it from being pulled in either.
    // (Lines read newest-delivered first: load 2 @200, load 1 @100.)
    expect(r.lines.map((l) => l.loadId)).toEqual([2, 1]);
    expect(r.pulledIn).toEqual([]);
  });

  test("an override changes the expected total AND the result carries the adjusted flag", () => {
    const base = computeSettlementCheck(inWin, entry({ gross: 1500 }));
    expect(base.expectedTotal).toBe(1500);
    expect(base.adjusted).toBe(false);
    expect(base.adjustmentNotes).toEqual([]);

    const applied = applyLoadOverrides(inWin, all, {
      windowFromMs: null,
      windowToMs: null,
      excludedLoadIds: [2],
      includedLoadIds: [3],
    });
    const edited = computeSettlementCheck(applied.lines, entry({ gross: 1500 }), {
      heldOut: applied.heldOut,
      pulledIn: applied.pulledIn,
    });
    expect(edited.expectedTotal).toBe(1250); // 1000 + 250 pulled in, 500 held out
    expect(edited.adjusted).toBe(true);
    expect(edited.adjustmentNotes.join(" ")).toContain("held out by driver");
    expect(edited.adjustmentNotes.join(" ")).toContain("pulled in by driver");
    expect(edited.heldOut.map((l) => l.loadId)).toEqual([2]);
    expect(edited.pulledIn.map((l) => l.loadId)).toEqual([3]);

    const windowOnly = computeSettlementCheck(inWin, entry({ gross: 1500 }), { windowAdjusted: true });
    expect(windowOnly.adjusted).toBe(true);
    expect(windowOnly.adjustmentNotes[0]).toContain("Window adjusted by driver");
  });
});

describe("settlement check — the automatic window (pay-lag driven)", () => {
  const DAY = 86400000;
  const paidAt = Date.UTC(2026, 10, 15, 17); // Nov 15 2026, noon-ish CST as stored

  test("lag 0, first entry: a weekly window ending ON the pay date (no arrears assumed)", () => {
    const w = settlementWindowFor("Fleetly", paidAt, null, 0);
    expect(w.fromMs).toBe(Date.UTC(2026, 10, 9));
    expect(w.toMs).toBe(Date.UTC(2026, 10, 15) + DAY - 1);
    expect(w.lagDays).toBe(0);
    expect(w.basis).toContain("Window: Nov 9");
    expect(w.basis).toContain("pays the same week (0-day lag)");
  });

  test("lag 7, first entry: the weekly window ending a week before the pay date", () => {
    const w = settlementWindowFor("Fleetly", paidAt, null, 7);
    expect(w.fromMs).toBe(Date.UTC(2026, 10, 2));
    expect(w.toMs).toBe(Date.UTC(2026, 10, 8) + DAY - 1);
    expect(w.basis).toContain("pays a week in the hole (7-day lag)");
  });

  test("chaining: consecutive settlements share no day and skip no day, at any lag, on any payday rhythm", () => {
    const p1 = Date.UTC(2026, 10, 15, 17);
    const p2 = Date.UTC(2026, 10, 22, 17);
    const p3 = Date.UTC(2026, 10, 29, 17);
    for (const lag of [0, 7, 14]) {
      const w1 = settlementWindowFor("Fleetly", p1, null, lag);
      const w2 = settlementWindowFor("Fleetly", p2, w1.toMs, lag);
      const w3 = settlementWindowFor("Fleetly", p3, w2.toMs, lag);
      expect(w2.fromMs).toBe(w1.toMs + 1);
      expect(w3.fromMs).toBe(w2.toMs + 1);
      expect(w2.basis).toContain("no day is counted twice or skipped");
    }
    // Irregular paydays chain identically — windows anchor only to
    // each entry's actual pay date and the lag, never a weekday.
    const q1 = Date.UTC(2026, 10, 3, 17); // a Tuesday
    const q2 = Date.UTC(2026, 10, 19, 17); // sixteen days later
    const v1 = settlementWindowFor("Fleetly", q1, null, 0);
    const v2 = settlementWindowFor("Fleetly", q2, v1.toMs, 0);
    expect(v2.fromMs).toBe(v1.toMs + 1);
    expect(v2.toMs).toBe(Date.UTC(2026, 10, 19) + DAY - 1);
  });

  test("same-day repeat settlement: window is that day, never inverted", () => {
    const w = settlementWindowFor("Fleetly", paidAt, paidAt - 3600000, 0);
    expect(w.fromMs).toBe(Date.UTC(2026, 10, 15));
    expect(w.fromMs).toBeLessThanOrEqual(w.toMs);
  });

  test("a recorded period on the settlement wins over lag math outright", () => {
    const rec = { fromMs: Date.UTC(2026, 9, 26), toMs: Date.UTC(2026, 10, 1) + DAY - 1 };
    const w = settlementWindowFor("Fleetly", paidAt, null, 7, { recordedPeriod: rec });
    expect(w.fromMs).toBe(rec.fromMs);
    expect(w.toMs).toBe(rec.toMs);
    expect(w.recorded).toBe(true);
    expect(w.basis).toContain("recorded on this Fleetly settlement itself");
  });

  test("a driver window override wins over lag math and is labelled adjusted on its face", () => {
    const ow = { fromMs: Date.UTC(2026, 10, 2), toMs: Date.UTC(2026, 10, 8) + DAY - 1 };
    const w = settlementWindowFor("Fleetly", paidAt, null, 0, { overrideWindow: ow });
    expect(w.fromMs).toBe(ow.fromMs);
    expect(w.toMs).toBe(ow.toMs);
    expect(w.adjustedByDriver).toBe(true);
    expect(w.basis).toContain("adjusted by driver for this settlement");
    // …but a recorded period still outranks the driver's override.
    const rec = { fromMs: Date.UTC(2026, 9, 26), toMs: Date.UTC(2026, 10, 1) + DAY - 1 };
    const w2 = settlementWindowFor("Fleetly", paidAt, null, 0, { overrideWindow: ow, recordedPeriod: rec });
    expect(w2.recorded).toBe(true);
    expect(w2.fromMs).toBe(rec.fromMs);
  });

  test("NEVER FIT TO THE ANSWER: same records, lag 0 vs lag 7 → different windows and different expected totals", () => {
    // A load delivered Nov 10 paying 1980, a settlement of 1900 paid Nov 15.
    const loads = [line(1, 1980, "figured", Date.UTC(2026, 10, 10, 17))];
    const ent = entry({ gross: 1900 });
    const inWindow = (w: { fromMs: number; toMs: number }) => loads.filter((l) => l.deliveredAtMs >= w.fromMs && l.deliveredAtMs <= w.toMs);
    const w0 = settlementWindowFor("Fleetly", paidAt, null, 0);
    const w7 = settlementWindowFor("Fleetly", paidAt, null, 7);
    const c0 = computeSettlementCheck(inWindow(w0), ent);
    const c7 = computeSettlementCheck(inWindow(w7), ent);
    // Lag 0 covers Nov 9–15: the load counts, the check says SHORT.
    expect(c0.expectedTotal).toBe(1980);
    expect(c0.status).toBe("short");
    // Lag 7 covers Nov 2–8: the load is outside — the window comes
    // from the setting, NOT from whichever lag makes the numbers
    // line up, so the honest answer is "not enough data".
    expect(c7.expectedTotal).toBe(0);
    expect(c7.status).toBe("no_data");
  });

  test("previousSamePayerPaidAt: same payer only, forms never count, latest before wins", () => {
    const entries = [
      { id: 1, payer: "Fleetly", paidAtMs: Date.UTC(2026, 10, 1, 17), isForm: false },
      { id: 2, payer: "Fleetly", paidAtMs: Date.UTC(2026, 10, 8, 17), isForm: false },
      { id: 3, payer: "Other Co", paidAtMs: Date.UTC(2026, 10, 10, 17), isForm: false },
      { id: 4, payer: "fleetly", paidAtMs: Date.UTC(2026, 10, 12, 17), isForm: true }, // form — never a settlement
      { id: 5, payer: "Fleetly", paidAtMs: Date.UTC(2026, 10, 15, 17), isForm: false },
    ];
    // For entry 5, the previous Fleetly settlement is entry 2 (the
    // Nov 12 form doesn't count, Other Co is a different payer).
    expect(previousSamePayerPaidAt(entries, entries[4]!)).toBe(Date.UTC(2026, 10, 8, 17));
    // Entry 1 has no previous.
    expect(previousSamePayerPaidAt(entries, entries[0]!)).toBeNull();
    // Case-insensitive payer matching.
    const ci = [
      { id: 1, payer: "FLEETLY", paidAtMs: Date.UTC(2026, 10, 1, 17), isForm: false },
      { id: 2, payer: "Fleetly", paidAtMs: Date.UTC(2026, 10, 15, 17), isForm: false },
    ];
    expect(previousSamePayerPaidAt(ci, ci[1]!)).toBe(Date.UTC(2026, 10, 1, 17));
  });
});
