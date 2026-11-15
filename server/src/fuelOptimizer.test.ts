// fuelOptimizer.test.ts — pure-rule tests for the route fuel
// optimizer (ex-tax / IFTA-adjusted) + fuel-card geofence check
// (Research Wave 2 item 8). The optimizer math, the tax table,
// the state-split derivation, the geofence verdicts, and the
// partner seam's normalization — all without a database. Action
// wiring (plan gate, exception opening, notifications) lives in
// fuelOptimizerFlow.test.ts.

import { describe, expect, test } from "bun:test";
import {
  DIESEL_TAX_RATES,
  FUEL_CARD_MISMATCH_THRESHOLD_MI,
  dieselTaxRateFor,
  evaluateFuelGeofence,
  fuelCardMismatchDetail,
  fuelCardPartnerFromEnv,
  haversineMi,
  normalizeFuelCardTransaction,
  planRouteFuel,
  segmentsFromStops,
  type FuelPlanInput,
} from "./fuelOptimizer";

describe("diesel tax table — public facts, dated, honest gaps", () => {
  test("spot rates match the IFTA Q4 2026 matrix", () => {
    expect(DIESEL_TAX_RATES["Texas"]).toBe(0.2);
    expect(DIESEL_TAX_RATES["California"]).toBe(0.979);
    expect(DIESEL_TAX_RATES["Illinois"]).toBe(0.738);
    expect(DIESEL_TAX_RATES["Oklahoma"]).toBe(0.19);
  });

  test("Oregon's 0 is a real loaded rate; non-IFTA jurisdictions are absent, never 0", () => {
    expect(dieselTaxRateFor("Oregon")).toBe(0);
    expect(dieselTaxRateFor("Alaska")).toBeNull();
    expect(dieselTaxRateFor("Hawaii")).toBeNull();
    expect(dieselTaxRateFor("District of Columbia")).toBeNull();
    expect(dieselTaxRateFor("Narnia")).toBeNull();
    expect(dieselTaxRateFor(null)).toBeNull();
    expect(dieselTaxRateFor(undefined)).toBeNull();
  });
});

describe("segmentsFromStops — the planning-grade state split", () => {
  test("state runs split at gap midpoints and merge", () => {
    const segs = segmentsFromStops(
      [
        { id: "a", name: "A", state: "Texas", alongMi: 100, price: null, priceSource: null },
        { id: "b", name: "B", state: "Texas", alongMi: 300, price: null, priceSource: null },
        { id: "c", name: "C", state: "Illinois", alongMi: 500, price: null, priceSource: null },
      ],
      600,
    );
    expect(segs).toEqual([
      { state: "Texas", miles: 400 },
      { state: "Illinois", miles: 200 },
    ]);
  });

  test("no stated stops → no split (settlement stays unfigured, never invented)", () => {
    expect(
      segmentsFromStops(
        [{ id: "a", name: "A", state: null, alongMi: 100, price: null, priceSource: null }],
        600,
      ),
    ).toEqual([]);
    expect(segmentsFromStops([], 600)).toEqual([]);
  });
});

// The classic trap, hand-figured:
//   600 mi at 10 mpg = 60 gal burned (30 TX + 30 IL).
//   IFTA owed: 30 × $0.20 (TX) + 30 × $0.738 (IL) = $28.14.
//   TX stop (mi 100) pump $3.90 → base $3.70. IL stop (mi 400)
//   pump $4.30 → base $3.562. Start 30 gal, reserve 10, tank 120.
//   Ex-tax plan: 20 gal in TX (reach IL holding reserve) + 20 gal
//   in IL → pump $164.00, credit $18.76, settlement $9.38,
//   true cost $173.38.
//   Pump-price plan: 40 gal in TX, none in IL → pump $156.00,
//   credit $8.00, settlement $20.14, true cost $176.14.
//   The ex-tax plan saves $2.76 by buying where the BASE is low.
const TRAP: FuelPlanInput = {
  totalMiles: 600,
  segments: [
    { state: "Texas", miles: 300 },
    { state: "Illinois", miles: 300 },
  ],
  stops: [
    { id: "tx", name: "Texas Stop", state: "Texas", alongMi: 100, price: 3.9, priceSource: "your fuel log · Nov 10" },
    { id: "il", name: "Illinois Stop", state: "Illinois", alongMi: 400, price: 4.3, priceSource: "reported 1d ago by a driver" },
  ],
  mpg: 10,
  tankCapacityGal: 120,
  startGallons: 30,
  reserveGallons: 10,
};

describe("planRouteFuel — the ex-tax math", () => {
  test("buys where the BASE price is lowest, not where the pump price is lowest", () => {
    const plan = planRouteFuel(TRAP);
    expect(plan.purchases.map((p) => [p.stopId, p.gallons])).toEqual([
      ["tx", 20],
      ["il", 20],
    ]);
    const il = plan.purchases.find((p) => p.stopId === "il")!;
    expect(il.price).toBe(4.3); // the HIGHER pump price…
    expect(il.basePrice).toBe(3.562); // …with the lower base price
    expect(il.taxPerGal).toBe(0.738);
    expect(plan.totals.pumpCost).toBe(164);
    expect(plan.totals.iftaSettlement).toBe(9.38);
    expect(plan.totals.netTripCost).toBe(173.38);
  });

  test("the naive pump-price plan buys it all in Texas and costs more", () => {
    const plan = planRouteFuel(TRAP);
    expect(plan.naive.purchases.map((p) => [p.stopId, p.gallons])).toEqual([["tx", 40]]);
    expect(plan.naive.totals.netTripCost).toBe(176.14);
    expect(plan.savingsEstimate).toBe(2.76);
  });

  test("every purchase shows pump and base side by side, with its source", () => {
    const plan = planRouteFuel(TRAP);
    for (const p of plan.purchases) {
      expect(p.priceSource).toBeTruthy();
      expect(p.basePrice).not.toBeNull();
      expect(p.why.length).toBeGreaterThan(10);
    }
    expect(plan.ratesAsOf).toContain("4th quarter 2026");
    expect(plan.notes.join(" ")).toContain("no price is invented");
  });

  test("tank discipline: never past capacity, never below reserve, never more than the route burns", () => {
    const plan = planRouteFuel({
      totalMiles: 700,
      segments: [{ state: "Texas", miles: 700 }],
      stops: [
        { id: "s1", name: "One", state: "Texas", alongMi: 300, price: 4.0, priceSource: "log" },
        { id: "s2", name: "Two", state: "Texas", alongMi: 600, price: 4.0, priceSource: "log" },
      ],
      mpg: 10,
      tankCapacityGal: 50,
      startGallons: 50,
      reserveGallons: 10,
    });
    // Arrive stop 1 with 20 gal; the fill is capped by the 50-gal
    // tank (30), which is also exactly the remaining burn + reserve.
    expect(plan.purchases).toEqual([
      expect.objectContaining({ stopId: "s1", gallons: 30 }),
    ]);
    expect(plan.totals.totalGallons).toBe(30);
  });

  test("starting fuel that covers the run buys nothing", () => {
    const plan = planRouteFuel({
      totalMiles: 200,
      segments: [{ state: "Texas", miles: 200 }],
      stops: [
        { id: "s1", name: "One", state: "Texas", alongMi: 100, price: 4.0, priceSource: "log" },
      ],
      mpg: 10,
      tankCapacityGal: 100,
      startGallons: 40,
      reserveGallons: 10,
    });
    expect(plan.purchases).toEqual([]);
    expect(plan.totals.pumpCost).toBe(0);
    expect(plan.notes.join(" ")).toContain("covers this run");
  });

  test("an unpriced stop is never ranked and never costed — the tank can only be forced to it", () => {
    const plan = planRouteFuel({
      totalMiles: 800,
      segments: [{ state: "Texas", miles: 800 }],
      stops: [
        { id: "u", name: "Unpriced", state: "Texas", alongMi: 300, price: null, priceSource: null },
        { id: "p", name: "Priced", state: "Texas", alongMi: 600, price: 4.0, priceSource: "log" },
      ],
      mpg: 10,
      tankCapacityGal: 60,
      startGallons: 60,
      reserveGallons: 10,
    });
    const forced = plan.purchases.find((p) => p.stopId === "u")!;
    expect(forced.gallons).toBe(10);
    expect(forced.cost).toBeNull();
    expect(plan.totals.unpricedGallons).toBe(10);
    // Unpriced gallons in the plan → no trip total is claimed.
    expect(plan.totals.netTripCost).toBeNull();
    expect(plan.notes.join(" ")).toContain("never costed");
    const verdict = plan.verdicts.find((v) => v.stopId === "u")!;
    expect(verdict.why).toContain("No price on file");
  });

  test("a stop whose state tax isn't loaded can't be ranked — tax-only honesty", () => {
    const plan = planRouteFuel({
      totalMiles: 400,
      segments: [
        { state: "Alaska", miles: 200 },
        { state: "Texas", miles: 200 },
      ],
      stops: [
        { id: "ak", name: "Alaska Stop", state: "Alaska", alongMi: 100, price: 4.0, priceSource: "log" },
        { id: "tx", name: "Texas Stop", state: "Texas", alongMi: 300, price: 4.5, priceSource: "log" },
      ],
      mpg: 10,
      tankCapacityGal: 120,
      startGallons: 30,
      reserveGallons: 10,
    });
    const ak = plan.verdicts.find((v) => v.stopId === "ak")!;
    expect(ak.why).toContain("net price can't be figured");
    // Alaska has no IFTA rate → the settlement can't be figured.
    expect(plan.totals.iftaSettlement).toBeNull();
    expect(plan.totals.netTripCost).toBeNull();
    expect(plan.notes.join(" ")).toContain("no rate loaded");
  });

  test("a stretch no stop covers is flagged as a range gap, never papered over", () => {
    const plan = planRouteFuel({
      totalMiles: 1000,
      segments: [{ state: "Texas", miles: 1000 }],
      stops: [
        { id: "s1", name: "Only Stop", state: "Texas", alongMi: 100, price: 4.0, priceSource: "log" },
      ],
      mpg: 10,
      tankCapacityGal: 50,
      startGallons: 50,
      reserveGallons: 10,
    });
    expect(plan.notes.join(" ")).toContain("Range gap");
  });

  test("with no segments supplied, the split is derived from the stops and labelled", () => {
    const plan = planRouteFuel({ ...TRAP, segments: [] });
    expect(plan.segmentsSource).toBe("stops");
    expect(plan.totals.iftaSettlement).not.toBeNull();
    expect(plan.notes.join(" ")).toContain("figured from the stops' states");
  });

  test("a junk price is treated as no price, never as a figure", () => {
    const plan = planRouteFuel({
      ...TRAP,
      stops: [
        { id: "tx", name: "Texas Stop", state: "Texas", alongMi: 100, price: 99, priceSource: "junk" },
        TRAP.stops[1]!,
      ],
    });
    const tx = plan.verdicts.find((v) => v.stopId === "tx")!;
    expect(tx.why).toContain("No price on file");
  });
});

describe("evaluateFuelGeofence — possible mismatch, never an accusation", () => {
  test("haversine sanity: Mobile to Birmingham is ~230 mi", () => {
    const d = haversineMi(30.6944, -88.0431, 33.5207, -86.8025);
    expect(d).toBeGreaterThan(200);
    expect(d).toBeLessThan(260);
  });

  test("same place → match, with the distance shown", () => {
    const r = evaluateFuelGeofence({
      purchaseLat: 30.6944,
      purchaseLon: -88.0431,
      truckLat: 30.7,
      truckLon: -88.05,
    });
    expect(r.status).toBe("match");
    expect(r.distanceMi).not.toBeNull();
    expect(r.distanceMi!).toBeLessThan(FUEL_CARD_MISMATCH_THRESHOLD_MI);
  });

  test("far away → mismatch past the printed threshold", () => {
    const r = evaluateFuelGeofence({
      purchaseLat: 33.5207,
      purchaseLon: -86.8025,
      truckLat: 30.6944,
      truckLon: -88.0431,
    });
    expect(r.status).toBe("mismatch");
    expect(r.distanceMi!).toBeGreaterThan(FUEL_CARD_MISMATCH_THRESHOLD_MI);
    expect(r.reason).toContain(`${FUEL_CARD_MISMATCH_THRESHOLD_MI} mi check line`);
  });

  test("either side missing → not_checked with the reason, never a silent pass", () => {
    const noStation = evaluateFuelGeofence({
      purchaseLat: null,
      purchaseLon: null,
      truckLat: 30.7,
      truckLon: -88.05,
    });
    expect(noStation.status).toBe("not_checked");
    expect(noStation.reason).toContain("No location is on file for that station");
    const noTruck = evaluateFuelGeofence({
      purchaseLat: 30.6944,
      purchaseLon: -88.0431,
      truckLat: null,
      truckLon: null,
    });
    expect(noTruck.status).toBe("not_checked");
    expect(noTruck.reason).toContain("No recorded truck position");
  });

  test("the flag copy says 'check it', carries the evidence, and accuses nobody", () => {
    const detail = fuelCardMismatchDetail({
      station: "Love's #412",
      state: "Alabama",
      gallons: 50,
      purchasedAtLabel: "Nov 14, 9:41 AM",
      distanceMi: 231.4,
      truckAtLabel: "Nov 14, 9:12 AM",
    });
    expect(detail).toContain("Possible mismatch — check it");
    expect(detail).toContain("Love's #412, Alabama");
    expect(detail).toContain("231.4 mi");
    expect(detail).toContain("Nothing was declined, blocked, or changed");
    expect(detail.toLowerCase()).not.toContain("fraud");
    expect(detail.toLowerCase()).not.toContain("theft");
  });
});

describe("fuel-card partner seam — env-gated, normalized, honest", () => {
  test("unconfigured without BOTH key and base URL", () => {
    expect(fuelCardPartnerFromEnv({})).toBeNull();
    expect(fuelCardPartnerFromEnv({ FUEL_CARD_API_KEY: "k" })).toBeNull();
    expect(fuelCardPartnerFromEnv({ FUEL_CARD_BASE_URL: "https://card.example" })).toBeNull();
  });

  test("normalization keeps good rows and skips junk — never guesses a row into shape", () => {
    expect(
      normalizeFuelCardTransaction({
        id: "t1",
        at: "2026-11-14T15:41:00Z",
        station: "Pilot #88",
        state: "Texas",
        lat: 32.7,
        lon: -96.8,
        gallons: 40,
        amount: 164,
      }),
    ).toEqual({
      partnerRef: "t1",
      at: "2026-11-14T15:41:00.000Z",
      station: "Pilot #88",
      state: "Texas",
      lat: 32.7,
      lon: -96.8,
      gallons: 40,
      amount: 164,
    });
    expect(normalizeFuelCardTransaction({ at: "2026-11-14T15:41:00Z" })).toBeNull(); // no ref
    expect(normalizeFuelCardTransaction({ id: "t2", at: "not a date" })).toBeNull();
    expect(normalizeFuelCardTransaction(null)).toBeNull();
    expect(normalizeFuelCardTransaction("t3")).toBeNull();
  });

  test("a configured partner's feed is fetched and normalized through the seam", async () => {
    const partner = fuelCardPartnerFromEnv(
      { FUEL_CARD_API_KEY: "k", FUEL_CARD_BASE_URL: "https://card.example/", FUEL_CARD_PARTNER_NAME: "TestCard" },
      async (url, init) => {
        expect(url).toContain("https://card.example/transactions?since=");
        expect(init.headers.authorization).toBe("Bearer k");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            transactions: [
              { id: "a", at: "2026-11-14T10:00:00Z", lat: 1, lon: 2 },
              { nope: true },
            ],
          }),
        };
      },
    );
    expect(partner?.name).toBe("TestCard");
    const txns = await partner!.fetchTransactions("2026-11-01T00:00:00.000Z");
    expect(txns).toHaveLength(1);
    expect(txns[0]!.partnerRef).toBe("a");
  });

  test("a partner failure surfaces as an error, never as an empty feed", async () => {
    const partner = fuelCardPartnerFromEnv(
      { FUEL_CARD_API_KEY: "k", FUEL_CARD_BASE_URL: "https://card.example" },
      async () => ({ ok: false, status: 503, json: async () => ({}) }),
    );
    await expect(partner!.fetchTransactions("2026-11-01T00:00:00.000Z")).rejects.toThrow("503");
  });
});
