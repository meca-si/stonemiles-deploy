// Unit tests for the server speed-limit lookup's pure selection
// rules (server/src/speedLimit.ts) — road test #3 (2026-10-30):
// the LIMIT showed 55 at 69 mph near I-10 and the match landed on
// the wrong parallel road. Three server-side causes are pinned
// here: the Valhalla scan borrowing the PREVIOUS road's limit,
// the grid-cell cache serving one road's answer to the parallel
// road crossing the same cell, and distance-only Overpass picks
// at crossings. Run: bun test server/src/speedLimit.test.ts

import { describe, expect, test } from "bun:test";
import { cacheKeyFor, LOOKUP_BUDGET_MS, nearestHighwayClass, pickNearestLimit, selectValhallaLimit, trackHeadingDeg } from "./speedLimit";

describe("selectValhallaLimit — the current road only", () => {
  test("the current edge's own limit wins (113 km/h = 70 mph)", () => {
    const got = selectValhallaLimit([
      { speed_limit: 89, road_class: "motorway" },
      { speed_limit: 113, road_class: "motorway" },
    ]);
    expect(got?.limitMph).toBe(70);
    expect(got?.highway).toBe("motorway");
  });

  test("the previous road's 55 is NOT borrowed onto the interstate", () => {
    // The road-test shape: the truck turned from a 55 mph primary
    // onto motorway edges that carry no tag of their own. The old
    // scan walked back across the class change and served the 55.
    const got = selectValhallaLimit([
      { speed_limit: 89, road_class: "primary" }, // 55 mph, previous road
      { road_class: "motorway" },
      { road_class: "motorway" },
    ]);
    expect(got?.limitMph).toBeNull();
    expect(got?.highway).toBe("motorway"); // class still answers the EST rung
  });

  test("a limit a couple of edges back on the SAME road still counts", () => {
    const got = selectValhallaLimit([
      { speed_limit: 113, road_class: "motorway" },
      { road_class: "motorway" },
      { road_class: "motorway" },
    ]);
    expect(got?.limitMph).toBe(70);
  });

  test("the walk back stops after 3 edges even on the same road", () => {
    const got = selectValhallaLimit([
      { speed_limit: 113, road_class: "motorway" },
      { road_class: "motorway" },
      { road_class: "motorway" },
      { road_class: "motorway" },
      { road_class: "motorway" },
    ]);
    expect(got?.limitMph).toBeNull();
    expect(got?.highway).toBe("motorway");
  });

  test("no edges → no answer (the Overpass rung gets its turn)", () => {
    expect(selectValhallaLimit([])).toBeNull();
  });
});

describe("cacheKeyFor — a grid cell is not a road", () => {
  test("opposite courses through the same cell are different lookups", () => {
    const north = cacheKeyFor(30.6405, -88.2587, 10);
    const south = cacheKeyFor(30.6405, -88.2587, 190);
    expect(north).not.toBe(south);
  });
  test("the same course through the same cell hits the same key", () => {
    expect(cacheKeyFor(30.6405, -88.2587, 90)).toBe(cacheKeyFor(30.6405, -88.2587, 100));
  });
  test("no course yet → the plain cell key", () => {
    expect(cacheKeyFor(30.6405, -88.2587, null)).toBe("30.640,-88.259");
  });
});

describe("trackHeadingDeg", () => {
  test("eastward breadcrumb reads 90°, a stub reads null", () => {
    const shape = [
      { lat: 30.6405, lon: -88.2587 },
      { lat: 30.6405, lon: -88.2557 },
    ];
    expect(Math.round(trackHeadingDeg(shape) ?? -1)).toBe(90);
    expect(trackHeadingDeg([{ lat: 30.6405, lon: -88.2587 }])).toBeNull();
  });
});

describe("pickNearestLimit — heading breaks the crossing tie", () => {
  const BASE = { lat: 30.6405, lon: -88.2587 };
  const M_PER_DEG_LAT = 111189;
  const M_PER_DEG_LON = 111189 * Math.cos((BASE.lat * Math.PI) / 180);
  const pt = (eastM: number, northM: number) => ({
    lat: BASE.lat + northM / M_PER_DEG_LAT,
    lon: BASE.lon + eastM / M_PER_DEG_LON,
  });
  const ewWay = (northM: number, tags: Record<string, string>) => ({
    tags,
    geometry: [pt(-500, northM), pt(500, northM)],
  });
  const nsWay = (eastM: number, tags: Record<string, string>) => ({
    tags,
    geometry: [pt(eastM, -500), pt(eastM, 500)],
  });

  test("an eastbound truck gets the motorway's 70, not the crossing street's 35", () => {
    const ways = [
      nsWay(8, { highway: "primary", maxspeed: "35 mph" }),
      ewWay(25, { highway: "motorway", maxspeed: "70 mph", ref: "I-10" }),
    ];
    expect(pickNearestLimit(BASE, ways, 120)?.limitMph).toBe(35); // distance-only
    const got = pickNearestLimit(BASE, ways, 120, 90);
    expect(got?.limitMph).toBe(70);
    expect(got?.ref).toBe("I-10");
  });
});

describe("nearestHighwayClass — identity for the client's continuity hold (2026-11-09)", () => {
  const BASE = { lat: 30.6405, lon: -88.2587 };
  const M_PER_DEG_LAT = 111189;
  const M_PER_DEG_LON = 111189 * Math.cos((BASE.lat * Math.PI) / 180);
  const pt = (eastM: number, northM: number) => ({
    lat: BASE.lat + northM / M_PER_DEG_LAT,
    lon: BASE.lon + eastM / M_PER_DEG_LON,
  });
  const ewWay = (northM: number, tags: Record<string, string>) => ({
    tags,
    geometry: [pt(-500, northM), pt(500, northM)],
  });

  test("the class answer names the matched road (ref + name ride along)", () => {
    const got = nearestHighwayClass(BASE, [ewWay(20, { highway: "motorway", ref: "I-65" })], 120, null);
    expect(got?.highway).toBe("motorway");
    expect(got?.ref).toBe("I-65");
    expect(got?.name).toBeNull();
  });
  test("no road inside the cap → null (no identity invented)", () => {
    expect(nearestHighwayClass(BASE, [ewWay(300, { highway: "motorway", ref: "I-65" })], 120, null)).toBeNull();
  });
});

describe("LOOKUP_BUDGET_MS — the ladder's deadline sits inside the client's budget (2026-11-09)", () => {
  test("18 s: the server answers before the client's ~20 s end-to-end deadline drops the call", () => {
    expect(LOOKUP_BUDGET_MS).toBe(18_000);
    expect(LOOKUP_BUDGET_MS).toBeLessThan(20_000);
  });
});
