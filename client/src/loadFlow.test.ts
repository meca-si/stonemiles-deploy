// loadFlow.test.ts — the load-flow panel's fuel + pay math.
import { describe, expect, test } from "bun:test";
import { afterFuelEstimate, afterFuelVerdict, fuelAdviceForLoad, loadPayFigures, nationalRpmCompare, paySplitLabel } from "./loadFlow";

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

describe("paySplitLabel", () => {
  test("percent names the split from the same model loadPayFigures reads", () => {
    // x's route-card report (2026-11-24): NET $299.74 on the $600
    // load = $540 cut − $240.26 fuel, and $540 is 90% of $600 — the
    // 90 in his saved My-pay model. The label names exactly that.
    expect(paySplitLabel({ payBasis: "percent", driverCpm: null, driverPayPct: 90 })).toBe("at 90% of gross");
    expect(paySplitLabel({ payBasis: "percent", driverCpm: null, driverPayPct: 80 })).toBe("at 80% of gross");
    const p = loadPayFigures({ payBasis: "percent", driverCpm: null, driverPayPct: 90, gross: 600, miles: 401 });
    expect(p.cut).toBe(540);
  });

  test("percent with no % set names nothing — no invented split", () => {
    expect(paySplitLabel({ payBasis: "percent", driverCpm: null, driverPayPct: null })).toBeNull();
  });

  test("cpm names the driver's own set rate only", () => {
    expect(paySplitLabel({ payBasis: "cpm", driverCpm: 0.72, driverPayPct: null })).toBe("at $0.72/mi");
    expect(paySplitLabel({ payBasis: "cpm", driverCpm: null, driverPayPct: null })).toBeNull();
  });
});

describe("afterFuelEstimate", () => {
  test("the Jacksonville \u2192 Montgomery offer: $480 cut, deadhead figured in", () => {
    // x's real lane: 368 loaded mi, ~25 mi deadhead to the pickup,
    // 40,000 lbs at profile 6.5 mpg, diesel at $3.85.
    const e = afterFuelEstimate({ cut: 480, loadedMiles: 368, deadheadMi: 25, baseMpg: 6.5, weightLbs: 40000, pricePerGal: 3.85 });
    expect(e).not.toBeNull();
    expect(e!.totalMi).toBe(393);
    expect(e!.deadheadMi).toBe(25);
    // Weight-adjusted burn runs under the profile mpg.
    expect(e!.effMpg).toBeLessThan(6.5);
    expect(e!.gallons).toBeGreaterThan(60);
    // The books balance: what's left + what fuel costs = the cut.
    expect(Math.abs(e!.afterFuel + e!.fuelCost - 480)).toBeLessThan(0.011);
    expect(e!.afterFuel).toBeLessThan(480);
    expect(e!.afterFuel).toBeGreaterThan(200);
    // Profitability per mile: the after-fuel remainder over ALL
    // miles the run takes, deadhead included.
    expect(Math.abs(e!.afterFuelPerMi - e!.afterFuel / 393)).toBeLessThan(0.011);
    expect(e!.afterFuelPerMi).toBeGreaterThan(0.5);
  });

  test("no position: deadhead is absent, never silently zero-costed into the total", () => {
    const e = afterFuelEstimate({ cut: 480, loadedMiles: 368, deadheadMi: null, baseMpg: 6.5, weightLbs: 40000, pricePerGal: 3.85 });
    expect(e).not.toBeNull();
    expect(e!.deadheadMi).toBeNull();
    expect(e!.totalMi).toBe(368);
  });

  test("a thin load can read negative \u2014 the line says so instead of hiding it", () => {
    const e = afterFuelEstimate({ cut: 150, loadedMiles: 900, deadheadMi: 60, baseMpg: 6.5, weightLbs: 45000, pricePerGal: 4.1 });
    expect(e).not.toBeNull();
    expect(e!.afterFuel).toBeLessThan(0);
  });

  test("the verdict: cushion over fuel is green, bare clearance is yellow, under fuel is red", () => {
    const green = afterFuelEstimate({ cut: 480, loadedMiles: 368, deadheadMi: 25, baseMpg: 6.5, weightLbs: 40000, pricePerGal: 3.85 });
    expect(afterFuelVerdict(green!)).toBe("green");
    const thin = afterFuelEstimate({ cut: 300, loadedMiles: 368, deadheadMi: 25, baseMpg: 6.5, weightLbs: 40000, pricePerGal: 3.85 });
    expect(thin!.afterFuel).toBeGreaterThan(0);
    expect(afterFuelVerdict(thin!)).toBe("yellow");
    const loser = afterFuelEstimate({ cut: 150, loadedMiles: 900, deadheadMi: 60, baseMpg: 6.5, weightLbs: 45000, pricePerGal: 4.1 });
    expect(afterFuelVerdict(loser!)).toBe("red");
  });

  test("missing real inputs figure nothing", () => {
    const base = { cut: 480, loadedMiles: 368, deadheadMi: 25, baseMpg: 6.5, weightLbs: 40000, pricePerGal: 3.85 };
    expect(afterFuelEstimate({ ...base, cut: null })).toBeNull();
    expect(afterFuelEstimate({ ...base, loadedMiles: null })).toBeNull();
    expect(afterFuelEstimate({ ...base, baseMpg: null })).toBeNull();
    // An unset profile MPG is never replaced by a default.
    expect(afterFuelEstimate({ ...base, baseMpg: 0 })).toBeNull();
    expect(afterFuelEstimate({ ...base, pricePerGal: null })).toBeNull();
  });
});

describe("nationalRpmCompare", () => {
  test("a short regional run reads below the national average — the real Jax→Montgomery lane", () => {
    // $600 over 368 loaded miles against DAT's dry van $3.11 (Nov 14–20, 2026).
    const c = nationalRpmCompare({ gross: 600, loadedMiles: 368, nationalRpm: 3.11 });
    expect(c).not.toBeNull();
    expect(c!.rpm).toBe(1.63);
    expect(c!.diffPerMile).toBe(-1.48);
    expect(c!.direction).toBe("below");
  });

  test("a strong rate reads above, with the gap in dollars per mile", () => {
    const c = nationalRpmCompare({ gross: 4000, loadedMiles: 1000, nationalRpm: 3.73 });
    expect(c!.rpm).toBe(4);
    expect(c!.diffPerMile).toBe(0.27);
    expect(c!.direction).toBe("above");
  });

  test("a load priced at the average reads at", () => {
    const c = nationalRpmCompare({ gross: 3110, loadedMiles: 1000, nationalRpm: 3.11 });
    expect(c!.diffPerMile).toBe(0);
    expect(c!.direction).toBe("at");
  });

  test("no rate, no miles, or no published lane average figures nothing", () => {
    expect(nationalRpmCompare({ gross: null, loadedMiles: 368, nationalRpm: 3.11 })).toBeNull();
    expect(nationalRpmCompare({ gross: 600, loadedMiles: null, nationalRpm: 3.11 })).toBeNull();
    expect(nationalRpmCompare({ gross: 600, loadedMiles: 0, nationalRpm: 3.11 })).toBeNull();
    expect(nationalRpmCompare({ gross: 600, loadedMiles: 368, nationalRpm: null })).toBeNull();
  });
});
