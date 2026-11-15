// brokerCredit.test.ts — pure-rule tests for the broker
// payment-behaviour summary (Wave 2 item 7): in-app records
// only, sample size always printed, facts without a score below
// the minimum sample, and no-history brokers reading exactly
// that. Flow coverage (chain derivation + both board shapes)
// lives in factoringFlow.test.ts.

import { describe, expect, test } from "bun:test";
import { brokerCreditSummary, type BrokerPaymentFact } from "./brokerCredit";

const DAY = 86_400_000;
const T0 = Date.parse("2026-10-01T00:00:00.000Z");

const paid = (daysToPay: number): BrokerPaymentFact => ({
  delivered: true,
  issuedAtMs: T0,
  paidAtMs: T0 + daysToPay * DAY,
});

describe("brokerCreditSummary", () => {
  test("no history at all reads as no history", () => {
    const s = brokerCreditSummary([]);
    expect(s.paidLoads).toBe(0);
    expect(s.loadsCarried).toBe(0);
    expect(s.avgDaysToPay).toBeNull();
    expect(s.hasScore).toBe(false);
    expect(s.label).toBe("No payment history in STONEMILES yet");
  });

  test("carried-but-unpaid loads count as carried, not as payment history", () => {
    const s = brokerCreditSummary([
      { delivered: true, issuedAtMs: T0, paidAtMs: null },
      { delivered: true, issuedAtMs: null, paidAtMs: null },
      { delivered: false, issuedAtMs: null, paidAtMs: null },
    ]);
    expect(s.loadsCarried).toBe(2);
    expect(s.paidLoads).toBe(0);
    expect(s.label).toBe("No payment history in STONEMILES yet");
  });

  test("below the minimum sample: facts, no score", () => {
    const s = brokerCreditSummary([paid(10), paid(20)]);
    expect(s.paidLoads).toBe(2);
    expect(s.sampleSize).toBe(2);
    expect(s.avgDaysToPay).toBe(15);
    expect(s.hasScore).toBe(false);
    expect(s.label).toBe("2 paid loads on record");
  });

  test("one paid load uses the singular", () => {
    const s = brokerCreditSummary([paid(30)]);
    expect(s.label).toBe("1 paid load on record");
    expect(s.hasScore).toBe(false);
  });

  test("at the minimum sample the average becomes the score — with its numbers beside it", () => {
    const s = brokerCreditSummary([paid(10), paid(20), paid(30)]);
    expect(s.hasScore).toBe(true);
    expect(s.avgDaysToPay).toBe(20);
    expect(s.sampleSize).toBe(3);
    expect(s.label).toBe("Pays in about 20 days on average · 3 paid loads on record");
  });

  test("a payment recorded before its issue date counts at zero days, never negative", () => {
    const s = brokerCreditSummary([
      { delivered: true, issuedAtMs: T0 + 5 * DAY, paidAtMs: T0 },
      paid(10),
      paid(20),
    ]);
    expect(s.paidLoads).toBe(3);
    expect(s.avgDaysToPay).toBe(10);
  });

  test("the summary carries no amount-shaped fields (rate law)", () => {
    const s = brokerCreditSummary([paid(10), paid(20), paid(30)]);
    const keys = Object.keys(s).sort();
    expect(keys).toEqual(["avgDaysToPay", "hasScore", "label", "loadsCarried", "paidLoads", "sampleSize"]);
  });
});
