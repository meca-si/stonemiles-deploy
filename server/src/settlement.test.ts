// settlement.test.ts — UNIT tests for the fleet-driver settlement
// view's pay math (settlement.ts): both My Pay bases (CPM and
// percent), the standing $0.55/mi CPM fallback, and the honest
// can't-figure cases (no miles, no rate, no percent set) which must
// return a null pay with a plain reason — never an invented number.

import { describe, expect, test } from "bun:test";
import { DEFAULT_DRIVER_CPM, settlementLineFor, settlementTotals } from "./settlement";

describe("settlement — CPM basis", () => {
  test("pay = the driver's CPM × loaded miles; gross = rate + extra charges", () => {
    const line = settlementLineFor(
      { payBasis: "cpm", driverCpm: 0.62, driverPayPct: null },
      { rate: 2000, extraCharges: 150, loadedMiles: 1000 },
    );
    expect(line.pay).toBe(620);
    expect(line.gross).toBe(2150);
    expect(line.miles).toBe(1000);
    expect(line.cpmUsed).toBe(0.62);
    expect(line.cpmDefaulted).toBe(false);
    expect(line.basisNote).toContain("× 1,000 loaded mi");
  });

  test("no CPM set → the standing $0.55/mi standard, flagged on the line", () => {
    const line = settlementLineFor(
      { payBasis: "cpm", driverCpm: null, driverPayPct: null },
      { rate: 1800, extraCharges: 0, loadedMiles: 2000 },
    );
    expect(line.cpmUsed).toBe(DEFAULT_DRIVER_CPM);
    expect(line.cpmDefaulted).toBe(true);
    expect(line.pay).toBe(1100);
    expect(line.basisNote).toContain("isn't set");
  });

  test("no loaded miles on file → no figure, plain reason (deadhead never substitutes)", () => {
    const line = settlementLineFor(
      { payBasis: "cpm", driverCpm: 0.62, driverPayPct: null },
      { rate: 2000, extraCharges: 0, loadedMiles: null },
    );
    expect(line.pay).toBeNull();
    expect(line.basisNote).toContain("no loaded miles");
  });

  test("cents round cleanly", () => {
    const line = settlementLineFor(
      { payBasis: "cpm", driverCpm: 0.575, driverPayPct: null },
      { rate: 900, extraCharges: 0, loadedMiles: 333 },
    );
    expect(line.pay).toBe(191.48);
  });
});

describe("settlement — percent basis", () => {
  test("pay = the driver's % of the load's pay (rate + additional charges)", () => {
    const line = settlementLineFor(
      { payBasis: "percent", driverCpm: null, driverPayPct: 90 },
      { rate: 2000, extraCharges: 200, loadedMiles: 1100 },
    );
    expect(line.gross).toBe(2200);
    expect(line.pay).toBe(1980);
    expect(line.cpmUsed).toBeNull();
    expect(line.basisNote).toContain("90% of the load's pay");
  });

  test("percent set but no rate on file → no figure (percent never runs off an invented gross)", () => {
    const line = settlementLineFor(
      { payBasis: "percent", driverCpm: null, driverPayPct: 90 },
      { rate: null, extraCharges: 0, loadedMiles: 1100 },
    );
    expect(line.pay).toBeNull();
    expect(line.gross).toBeNull();
    expect(line.basisNote).toContain("no rate on file");
  });

  test("percent basis chosen but percent never set → no figure, points at My Pay", () => {
    const line = settlementLineFor(
      { payBasis: "percent", driverCpm: 0.62, driverPayPct: null },
      { rate: 2000, extraCharges: 0, loadedMiles: 1100 },
    );
    expect(line.pay).toBeNull();
    expect(line.basisNote).toContain("Settings → My pay");
  });

  test("percent lines don't need miles", () => {
    const line = settlementLineFor(
      { payBasis: "percent", driverCpm: null, driverPayPct: 25 },
      { rate: 1000, extraCharges: 0, loadedMiles: null },
    );
    expect(line.pay).toBe(250);
  });
});

describe("settlement — totals", () => {
  test("totals sum figured lines only, and count the rest honestly", () => {
    const setting = { payBasis: "percent", driverCpm: null, driverPayPct: 50 };
    const lines = [
      settlementLineFor(setting, { rate: 2000, extraCharges: 0, loadedMiles: 900 }),
      settlementLineFor(setting, { rate: 1000, extraCharges: 100, loadedMiles: 500 }),
      settlementLineFor(setting, { rate: null, extraCharges: 0, loadedMiles: 100 }),
    ];
    const t = settlementTotals(lines);
    expect(t.totalPay).toBe(1550);
    expect(t.totalGross).toBe(3100);
    expect(t.figured).toBe(2);
    expect(t.unfigured).toBe(1);
  });

  test("empty view totals zero", () => {
    expect(settlementTotals([])).toEqual({ totalPay: 0, totalGross: 0, figured: 0, unfigured: 0 });
  });
});
