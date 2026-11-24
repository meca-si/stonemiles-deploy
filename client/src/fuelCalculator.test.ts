// fuelCalculator.test.ts — the fuel cost calculator's math.

import { describe, expect, test } from "bun:test";
import { fuelCostFor } from "./fuelCalculator";

describe("fuelCostFor", () => {
  test("the calculator.net example: 500 mi at 25 MPG and $3/gal", () => {
    const r = fuelCostFor({ distanceMi: 500, deadheadMi: 0, mpg: 25, pricePerGal: 3 });
    expect(r).not.toBeNull();
    expect(r!.gallons).toBe(20);
    expect(r!.totalCost).toBe(60);
    expect(r!.costPerMile).toBe(0.12);
    expect(r!.fuelSharePct).toBeNull();
  });

  test("a truck load: deadhead counts in the burn", () => {
    // 900 loaded + 100 deadhead at 6.5 MPG, $3.89/gal, $2,800 pay.
    const r = fuelCostFor({ distanceMi: 900, deadheadMi: 100, mpg: 6.5, pricePerGal: 3.89, loadPay: 2800 });
    expect(r!.totalMiles).toBe(1000);
    expect(r!.gallons).toBe(153.8);
    expect(r!.totalCost).toBe(598.46);
    expect(r!.costPerMile).toBe(0.6);
    expect(r!.fuelSharePct).toBe(21.4);
    expect(r!.netAfterFuel).toBe(2201.54);
  });

  test("no honest answer from bad inputs — null, never a fake zero", () => {
    expect(fuelCostFor({ distanceMi: 0, deadheadMi: 0, mpg: 6.5, pricePerGal: 3.89 })).toBeNull();
    expect(fuelCostFor({ distanceMi: 500, deadheadMi: 0, mpg: 0, pricePerGal: 3.89 })).toBeNull();
    expect(fuelCostFor({ distanceMi: 500, deadheadMi: 0, mpg: 6.5, pricePerGal: 0 })).toBeNull();
    expect(fuelCostFor({ distanceMi: Number.NaN, deadheadMi: 0, mpg: 6.5, pricePerGal: 3.89 })).toBeNull();
  });
});
