import { describe, expect, test } from "bun:test";
import { clampPct, loadFeeBreakdown } from "./loadFees";

describe("driver's own load fee deductions (factoring / dispatcher)", () => {
  test("zero percentages → no deduction, net equals gross", () => {
    const b = loadFeeBreakdown(2400, 0, 0);
    expect(b.factoringAmt).toBe(0);
    expect(b.dispatcherAmt).toBe(0);
    expect(b.totalFees).toBe(0);
    expect(b.netRate).toBe(2400);
  });

  test("null / undefined percentages read as 0 — never invented", () => {
    const b = loadFeeBreakdown(2400, null, undefined);
    expect(b.totalFees).toBe(0);
    expect(b.netRate).toBe(2400);
  });

  test("each fee is its % of the GROSS rate, shown as its own amount", () => {
    // The LoadIntel-style example shape: $2,400 gross, 2.75% factoring,
    // 10% dispatcher.
    const b = loadFeeBreakdown(2400, 2.75, 10);
    expect(b.factoringAmt).toBe(66);
    expect(b.dispatcherAmt).toBe(240);
    expect(b.totalFees).toBe(306);
    expect(b.netRate).toBe(2094);
  });

  test("amounts round to cents and the lines add up exactly", () => {
    const b = loadFeeBreakdown(1875.33, 3, 7.5);
    expect(b.factoringAmt).toBe(56.26);
    expect(b.dispatcherAmt).toBe(140.65);
    expect(b.netRate).toBe(Math.round((1875.33 - b.factoringAmt - b.dispatcherAmt) * 100) / 100);
  });

  test("out-of-range percentages clamp to 0–100", () => {
    expect(clampPct(-5)).toBe(0);
    expect(clampPct(150)).toBe(100);
    expect(clampPct(Number.NaN)).toBe(0);
    const b = loadFeeBreakdown(1000, 100, 100);
    // Two 100% fees can't take more than the math says line by line —
    // each is figured on gross, so the net can go negative; the
    // Worth-It verdict then reads red, which is the honest answer.
    expect(b.factoringAmt).toBe(1000);
    expect(b.dispatcherAmt).toBe(1000);
    expect(b.netRate).toBe(-1000);
  });

  test("the verdict flip: a load clear of break-even gross can lose net", () => {
    // $2,000 gross over 1,000 total miles at a $1.90/mi break-even:
    // gross profit would be +$100; with 3% factoring + 10% dispatcher
    // ($260 out), the net-after-fees profit is −$160.
    const b = loadFeeBreakdown(2000, 3, 10);
    const runCost = 1.9 * 1000;
    expect(2000 - runCost).toBe(100);
    expect(b.netRate - runCost).toBe(-160);
  });
});
