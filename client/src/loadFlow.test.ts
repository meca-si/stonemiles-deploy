// loadFlow.test.ts — the load-flow panel's fuel + pay math.
import { describe, expect, test } from "bun:test";
import { fuelAdviceForLoad, loadPayFigures } from "./loadFlow";

describe("fuelAdviceForLoad", () => {
  test("the Jacksonville → Montgomery run on 3/8 of a 120-gal tank", () => {
    // x's real first load: ~368 mi, 40,000 lbs, profile 6.5 mpg.
    const a = fuelAdviceForLoad({ tankPct: 37.5, capacityGal: 120, baseMpg: 6.5, loadWeightLbs: 40000, miles: 368 });
    expect(a.gallonsOnBoard).toBe(45);
    // Weight-adjusted burn: 6.5 mpg derated for a full load.
    expect(a.effMpg).toBeLessThan(6.5);
    expect(a.gallonsNeeded).toBeGreaterThan(56);
    expect(a.canMakeIt).toBe(false);
    expect(a.buyGalToFinish).toBeGreaterThan(20);
    expect(a.rangeMi).toBeLessThan(368);
  });

  test("a full tank makes the same run with reserve to spare", () => {
    const a = fuelAdviceForLoad({ tankPct: 100, capacityGal: 120, baseMpg: 6.5, loadWeightLbs: 40000, miles: 368 });
    expect(a.canMakeIt).toBe(true);
    expect(a.shortfallGal).toBe(0);
    expect(a.buyGalToFinish).toBe(0);
    expect(a.arrivalPct).toBeGreaterThan(15);
  });

  test("an empty run (no weight) burns at the base mpg", () => {
    const a = fuelAdviceForLoad({ tankPct: 50, capacityGal: 100, baseMpg: 7, loadWeightLbs: null, miles: 350 });
    expect(a.effMpg).toBe(7);
    expect(a.gallonsNeeded).toBe(50);
  });
});

describe("loadPayFigures", () => {
  test("percent of gross: the $600 load at 80% pays $480", () => {
    const p = loadPayFigures({ payBasis: "percent", driverCpm: null, driverPayPct: 80, gross: 600, miles: 368 });
    expect(p.cut).toBe(480);
    expect(p.needsSetup).toBe(false);
    // The per-mile figure is DERIVED from the cut, never the driver.
    expect(p.cutPerMile).toBe(1.3);
  });

  test("percent with no % set asks for setup — no stand-in math", () => {
    const p = loadPayFigures({ payBasis: "percent", driverCpm: null, driverPayPct: null, gross: 600, miles: 368 });
    expect(p.cut).toBe(null);
    expect(p.needsSetup).toBe(true);
  });

  test("percent with no rate on the load figures nothing", () => {
    const p = loadPayFigures({ payBasis: "percent", driverCpm: null, driverPayPct: 80, gross: null, miles: 368 });
    expect(p.cut).toBe(null);
    expect(p.needsSetup).toBe(false);
  });

  test("cpm uses the driver's own set rate", () => {
    const p = loadPayFigures({ payBasis: "cpm", driverCpm: 0.72, driverPayPct: null, gross: 600, miles: 300 });
    expect(p.cut).toBe(216);
    expect(p.cutPerMile).toBe(0.72);
  });

  test("cpm unset NEVER falls back to the $0.55 default", () => {
    const p = loadPayFigures({ payBasis: "cpm", driverCpm: null, driverPayPct: null, gross: 600, miles: 368 });
    expect(p.cut).toBe(null);
    expect(p.needsSetup).toBe(true);
  });
});
