import { describe, expect, test } from "bun:test";
import {
  agingBucket,
  avgLoggedFuelPrice,
  breakdownExportText,
  breakdownTotals,
  buildOwedBoard,
  currentOdometerFrom,
  daysLeftFrom,
  docAlertCount,
  docAlertTier,
  feeDeductionsFor,
  fuelBasisFor,
  iftaRowCalc,
  maintenanceStatusFor,
  mostUrgentDoc,
  owedTotals,
  trueRateFor,
} from "./moneyMath";

const DAY = 86400000;
const NOW = Date.parse("2026-11-06T12:00:00Z");

describe("docAlertTier — 30 / 14 / 7 + expired", () => {
  test("boundaries", () => {
    expect(docAlertTier(null)).toBe("no_date");
    expect(docAlertTier(-1)).toBe("expired");
    expect(docAlertTier(0)).toBe("due7");
    expect(docAlertTier(7)).toBe("due7");
    expect(docAlertTier(8)).toBe("due14");
    expect(docAlertTier(14)).toBe("due14");
    expect(docAlertTier(15)).toBe("due30");
    expect(docAlertTier(30)).toBe("due30");
    expect(docAlertTier(31)).toBe("ok");
  });
  test("daysLeftFrom matches the server's ceil rule", () => {
    expect(daysLeftFrom(NOW, NOW + 7 * DAY)).toBe(7);
    expect(daysLeftFrom(NOW, NOW - DAY)).toBe(-1);
    expect(daysLeftFrom(NOW, NOW + DAY / 2)).toBe(1);
  });
  test("most urgent + badge count skip ok / no-date docs", () => {
    const docs = [
      { kind: "cdl", label: "CDL", expiresAt: null, daysLeft: 200 },
      { kind: "medical", label: "Medical card", expiresAt: null, daysLeft: 12 },
      { kind: "insurance", label: "Insurance", expiresAt: null, daysLeft: -3 },
      { kind: "registration", label: "Registration", expiresAt: null, daysLeft: null },
    ];
    expect(mostUrgentDoc(docs)?.doc.kind).toBe("insurance");
    expect(mostUrgentDoc(docs)?.tier).toBe("expired");
    expect(docAlertCount(docs)).toBe(2);
    expect(mostUrgentDoc([{ kind: "cdl", label: "CDL", expiresAt: null, daysLeft: 90 }])).toBeNull();
  });
});

describe("buildOwedBoard", () => {
  const inputs = [
    { loadId: 3, deliveredAtMs: NOW - 45 * DAY, freight: 2000, claimsTotal: 150, paidTotal: 0 },
    { loadId: 1, deliveredAtMs: NOW - 70 * DAY, freight: 1500, claimsTotal: 0, paidTotal: 500 },
    { loadId: 2, deliveredAtMs: NOW - 10 * DAY, freight: 900, claimsTotal: 0, paidTotal: 900 },
    { loadId: 4, deliveredAtMs: NOW - 5 * DAY, freight: null, claimsTotal: 0, paidTotal: 0 },
    { loadId: 5, deliveredAtMs: NOW - 3 * DAY, freight: null, claimsTotal: 0, paidTotal: 250 },
  ];
  test("oldest first, paid-off loads leave, no-amount loads stay until paid", () => {
    const rows = buildOwedBoard(inputs, NOW);
    expect(rows.map((r) => r.loadId)).toEqual([1, 3, 4]);
    expect(rows[0]!.remaining).toBe(1000);
    expect(rows[0]!.daysOutstanding).toBe(70);
    expect(rows[0]!.aging).toBe("stale");
    expect(rows[1]!.totalOwed).toBe(2150);
    expect(rows[2]!.remaining).toBeNull();
  });
  test("totals only count loads whose amount is on file", () => {
    const t = owedTotals(buildOwedBoard(inputs, NOW));
    expect(t.totalRemaining).toBe(3150);
    expect(t.loadsOwing).toBe(3);
    expect(t.loadsNoAmount).toBe(1);
    expect(t.oldestDays).toBe(70);
  });
  test("aging buckets", () => {
    expect(agingBucket(0)).toBe("current");
    expect(agingBucket(14)).toBe("current");
    expect(agingBucket(15)).toBe("watch");
    expect(agingBucket(30)).toBe("watch");
    expect(agingBucket(31)).toBe("late");
    expect(agingBucket(60)).toBe("late");
    expect(agingBucket(61)).toBe("stale");
  });
});

describe("true rate", () => {
  test("gross divides by ALL miles (loaded + deadhead)", () => {
    const tr = trueRateFor({ totalPay: 2400, loadedMiles: 800, deadheadMiles: 200 }, { kind: "none" });
    expect(tr.totalMiles).toBe(1000);
    expect(tr.grossPerMile).toBe(2.4);
    expect(tr.netPerMile).toBeNull();
  });
  test("no pay or no miles → no rate, never invented", () => {
    expect(trueRateFor({ totalPay: null, loadedMiles: 500, deadheadMiles: 0 }, { kind: "none" }).grossPerMile).toBeNull();
    expect(trueRateFor({ totalPay: 1000, loadedMiles: null, deadheadMiles: 50 }, { kind: "none" }).grossPerMile).toBeNull();
  });
  test("fuel basis: logged wins, estimate needs logged price + mpg, else none", () => {
    expect(fuelBasisFor({ linkedFuelCost: 300, totalMiles: 1000, mpg: 6, avgLoggedPricePerGallon: 4 })).toEqual({ kind: "logged", fuelCost: 300 });
    const est = fuelBasisFor({ linkedFuelCost: null, totalMiles: 1200, mpg: 6, avgLoggedPricePerGallon: 4 });
    expect(est).toEqual({ kind: "estimate", fuelCost: 800 });
    expect(fuelBasisFor({ linkedFuelCost: null, totalMiles: 1200, mpg: 6, avgLoggedPricePerGallon: null }).kind).toBe("none");
    expect(fuelBasisFor({ linkedFuelCost: null, totalMiles: 1200, mpg: null, avgLoggedPricePerGallon: 4 }).kind).toBe("none");
  });
  test("net after fuel — logged and estimated", () => {
    const logged = trueRateFor({ totalPay: 2400, loadedMiles: 800, deadheadMiles: 200 }, { kind: "logged", fuelCost: 400 });
    expect(logged.netPerMile).toBe(2);
    const est = trueRateFor({ totalPay: 2400, loadedMiles: 800, deadheadMiles: 200 }, { kind: "estimate", fuelCost: 800 });
    expect(est.netPerMile).toBe(1.6);
    expect(est.fuel.kind).toBe("estimate");
  });
  test("avg logged price is gallon-weighted and null when nothing logged", () => {
    expect(avgLoggedFuelPrice([])).toBeNull();
    expect(avgLoggedFuelPrice([{ gallons: 100, total: 400 }, { gallons: 50, total: 225 }])).toBe(4.167);
  });
  test("driver's own fees: deductions come off the pay, per line", () => {
    const f = feeDeductionsFor(2400, 2.75, 10);
    expect(f.factoringAmt).toBe(66);
    expect(f.dispatcherAmt).toBe(240);
    expect(f.totalFees).toBe(306);
    expect(f.netPay).toBe(2094);
    // Missing percentages are 0 — a fee is never invented.
    expect(feeDeductionsFor(2400, null, undefined).totalFees).toBe(0);
    expect(feeDeductionsFor(2400, 0, 0).netPay).toBe(2400);
  });
  test("net after fees divides the NET pay by ALL miles", () => {
    const tr = trueRateFor({ totalPay: 2400, loadedMiles: 800, deadheadMiles: 200, factoringPct: 2.75, dispatcherPct: 10 }, { kind: "none" });
    expect(tr.grossPerMile).toBe(2.4);
    expect(tr.fees.totalFees).toBe(306);
    expect(tr.netAfterFeesPerMile).toBe(2.094);
  });
  test("no percentages saved → no after-fees figure (gross already is it)", () => {
    const tr = trueRateFor({ totalPay: 2400, loadedMiles: 800, deadheadMiles: 200 }, { kind: "none" });
    expect(tr.fees.totalFees).toBe(0);
    expect(tr.netAfterFeesPerMile).toBeNull();
    // Out-of-range saved percentages clamp instead of exploding.
    const clamped = trueRateFor({ totalPay: 1000, loadedMiles: 500, deadheadMiles: 0, factoringPct: 250, dispatcherPct: -3 }, { kind: "none" });
    expect(clamped.fees.factoringPct).toBe(100);
    expect(clamped.fees.dispatcherPct).toBe(0);
  });
});

describe("iftaRowCalc", () => {
  test("brief formula: (miles ÷ mpg) × rate − bought × rate", () => {
    const r = iftaRowCalc({ state: "Texas", miles: 1200, gallonsBought: 150, rate: 0.2, fleetMpg: 6 });
    expect(r.gallonsUsed).toBe(200);
    expect(r.taxOwed).toBe(40);
    expect(r.taxPaid).toBe(30);
    expect(r.net).toBe(10);
    expect(r.rateLoaded).toBe(true);
  });
  test("rate not loaded → nulls, never invented", () => {
    const r = iftaRowCalc({ state: "Alaska", miles: 500, gallonsBought: 40, rate: null, fleetMpg: 6 });
    expect(r.rateLoaded).toBe(false);
    expect(r.taxOwed).toBeNull();
    expect(r.taxPaid).toBeNull();
    expect(r.net).toBeNull();
    expect(r.gallonsUsed).toBe(83.33);
  });
  test("no MPG → used/owed stay null", () => {
    const r = iftaRowCalc({ state: "Texas", miles: 500, gallonsBought: 40, rate: 0.2, fleetMpg: null });
    expect(r.gallonsUsed).toBeNull();
    expect(r.taxOwed).toBeNull();
    expect(r.taxPaid).toBe(8);
  });
});

describe("maintenanceStatusFor", () => {
  test("miles countdown: ok / due soon / overdue", () => {
    const base = { key: "oil", intervalMi: 25000, lastDoneOdometer: 500000, lastDoneAtMs: NOW - 90 * DAY, nowMs: NOW };
    expect(maintenanceStatusFor({ ...base, currentOdometer: 520000 }).milesRemaining).toBe(5000);
    expect(maintenanceStatusFor({ ...base, currentOdometer: 520000 }).state).toBe("ok");
    expect(maintenanceStatusFor({ ...base, currentOdometer: 524500 }).state).toBe("due_soon");
    expect(maintenanceStatusFor({ ...base, currentOdometer: 526000 }).state).toBe("overdue");
    expect(maintenanceStatusFor({ ...base, currentOdometer: 526000 }).milesRemaining).toBe(-1000);
  });
  test("unknown without a baseline or an odometer", () => {
    expect(maintenanceStatusFor({ key: "oil", intervalMi: 25000, lastDoneOdometer: null, lastDoneAtMs: null, currentOdometer: 500000, nowMs: NOW }).state).toBe("unknown");
    expect(maintenanceStatusFor({ key: "oil", intervalMi: 25000, lastDoneOdometer: 480000, lastDoneAtMs: null, currentOdometer: null, nowMs: NOW }).state).toBe("unknown");
  });
  test("DOT annual is date-based at interval 0 (12 months)", () => {
    const done = Date.parse("2025-12-01T00:00:00Z");
    const s = maintenanceStatusFor({ key: "dot_inspection", intervalMi: 0, lastDoneOdometer: null, lastDoneAtMs: done, currentOdometer: null, nowMs: NOW });
    expect(s.daysRemaining).not.toBeNull();
    expect(s.state).toBe("due_soon"); // due Dec 1 2026, ~25 days out from Nov 6
    const overdue = maintenanceStatusFor({ key: "dot_inspection", intervalMi: 0, lastDoneOdometer: null, lastDoneAtMs: Date.parse("2025-10-01T00:00:00Z"), currentOdometer: null, nowMs: NOW });
    expect(overdue.state).toBe("overdue");
  });
  test("current odometer takes the highest recorded reading", () => {
    expect(currentOdometerFrom([null, 512000, undefined, 498000])).toBe(512000);
    expect(currentOdometerFrom([null, undefined])).toBeNull();
    expect(currentOdometerFrom([0, -5])).toBeNull();
  });
});

describe("breakdownTotals + export", () => {
  test("downtime and cost totals; open log counts to now", () => {
    const t = breakdownTotals({ startedAtMs: NOW - 5 * 3600000, endedAtMs: null, costs: [{ label: "Tow", amount: 450 }, { label: "Tire", amount: 620.5 }], nowMs: NOW });
    expect(t.downtimeHours).toBe(5);
    expect(t.totalCost).toBe(1070.5);
    expect(t.open).toBe(true);
  });
  test("export text carries the record plainly", () => {
    const text = breakdownExportText({
      id: 7,
      startedAtIso: new Date(NOW - 26 * 3600000).toISOString(),
      endedAtIso: new Date(NOW - 2 * 3600000).toISOString(),
      locationNote: "I-10 mile 85",
      note: "Blown steer tire",
      costs: [{ label: "Roadside tire service", amount: 700 }],
      chainHash: "abc123",
      nowMs: NOW,
    });
    expect(text).toContain("BREAKDOWN RECORD #7");
    expect(text).toContain("Downtime: 24.0 hours");
    expect(text).toContain("Total cost: $700.00");
    expect(text).toContain("does not dispatch or pay anyone");
    expect(text).toContain("abc123");
  });
});
