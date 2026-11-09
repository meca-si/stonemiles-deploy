// Unit tests for load rate-per-mile math + board ranking
// (client/src/loadRate.ts) — the production math behind the
// automatic $/mi on loads and the load boards' Best-$/mi ranking.
// Run: bun test client/src/loadRate.test.ts

import { describe, expect, test } from "bun:test";
import {
ROAD_CIRCUITY,
displayPerMile,
effectivePerMile,
estimateLoadedMiles,
fmtPerMile,
haversineMi,
rankBoardLoads,
ratePerMile,
totalPerMile,
type LoadMoneyLike,
} from "./loadRate";

// Theodore, AL → Mobile, AL is ~12 mi straight-line (~19 by road).
const THEODORE = { lat: 30.551, lon: -88.1687 };
const MOBILE = { lat: 30.6944, lon: -88.0431 };

function load(partial: Partial<LoadMoneyLike> & { createdAt?: string }): LoadMoneyLike & { createdAt: string } {
  const rate = partial.rate !== undefined ? partial.rate : 1000;
  const extraCharges = partial.extraCharges ?? 0;
  const loadedMiles = partial.loadedMiles !== undefined ? partial.loadedMiles : 500;
  return {
    rate,
    extraCharges,
    totalWithExtras: rate != null ? rate + extraCharges : null,
    loadedMiles,
    totalPerMile: totalPerMile(rate, extraCharges, loadedMiles),
    createdAt: partial.createdAt ?? "2026-10-30T00:00:00.000Z",
  };
}

describe("per-mile derivation", () => {
  test("all-in $/mi includes additional charges; linehaul does not", () => {
    expect(totalPerMile(1000, 100, 500)).toBe(2.2);
    expect(ratePerMile(1000, 500)).toBe(2);
  });
  test("no rate or no miles → null, never a guess", () => {
    expect(totalPerMile(null, 0, 500)).toBeNull();
    expect(totalPerMile(1000, 0, null)).toBeNull();
    expect(totalPerMile(1000, 0, 0)).toBeNull();
    expect(ratePerMile(null, 500)).toBeNull();
  });
  test("formats the way drivers quote it", () => {
    expect(fmtPerMile(2.2)).toBe("$2.20/mi");
    expect(fmtPerMile(3)).toBe("$3.00/mi");
  });
});

describe("lane estimate", () => {
  test("haversine Theodore→Mobile is about 12 miles", () => {
    const d = haversineMi(THEODORE, MOBILE);
    expect(d).toBeGreaterThan(10);
    expect(d).toBeLessThan(15);
  });
  test("estimate applies the stated road factor and rounds", () => {
    const est = estimateLoadedMiles(THEODORE, MOBILE);
    expect(est).toBe(Math.round(haversineMi(THEODORE, MOBILE) * ROAD_CIRCUITY));
  });
  test("missing point or same-spot hop → null", () => {
    expect(estimateLoadedMiles(null, MOBILE)).toBeNull();
    expect(estimateLoadedMiles(THEODORE, THEODORE)).toBeNull();
  });
});

describe("display figure", () => {
  test("stored miles win over an estimate and are not labelled estimated", () => {
    const l = load({ rate: 1200, loadedMiles: 500 });
    const d = displayPerMile(l, { miles: 999, perMile: 9.99 });
    expect(d).toEqual({ perMile: 2.4, miles: 500, estimated: false });
  });
  test("estimate stands in, labelled, when the load has no miles", () => {
    const l = load({ rate: 1200, loadedMiles: null });
    const d = displayPerMile(l, { miles: 480, perMile: 2.5 });
    expect(d).toEqual({ perMile: 2.5, miles: 480, estimated: true });
    expect(effectivePerMile(l, null)).toBeNull();
  });
  test("nothing on file and no estimate → blank", () => {
    expect(displayPerMile(load({ rate: null, loadedMiles: null }), null)).toBeNull();
  });
});

describe("board ranking", () => {
  const a = load({ rate: 1500, loadedMiles: 500, createdAt: "2026-10-28T00:00:00.000Z" }); // $3.00/mi, $1500
  const b = load({ rate: 2000, loadedMiles: 1000, createdAt: "2026-10-29T00:00:00.000Z" }); // $2.00/mi, $2000
  const c = load({ rate: 900, loadedMiles: null, createdAt: "2026-10-30T00:00:00.000Z" }); // estimate only
  const d = load({ rate: null, loadedMiles: null, createdAt: "2026-10-27T00:00:00.000Z" }); // unrankable
  const estFor = (r: LoadMoneyLike & { createdAt: string }) =>
    r === (c as unknown) ? { miles: 300, perMile: 3.0 } : null;

  test("Best $/mi: highest first, estimate ties break on total, unrankable last", () => {
    const ranked = rankBoardLoads([b, d, c, a], "perMile", estFor);
    // a and c both $3.00/mi → a wins on total ($1500 > $900); then b; d sinks.
    expect(ranked.map((r) => r.rate)).toEqual([1500, 900, 2000, null]);
  });
  test("Highest total: biggest pay first, unpriced last", () => {
    const ranked = rankBoardLoads([a, d, c, b], "total", () => null);
    expect(ranked.map((r) => r.rate)).toEqual([2000, 1500, 900, null]);
  });
  test("Newest keeps the server's order untouched", () => {
    const rows = [b, a, d];
    expect(rankBoardLoads(rows, "newest", () => null)).toBe(rows);
  });
});
