// Unit tests for the construction indicators' client logic
// (client/src/workZone.ts) — age display, source labels, the live
// window, and the approach-alert trigger.
// Run: bun test client/src/workZone.test.ts

import { describe, expect, test } from "bun:test";
import {
  constructionAhead,
  constructionHeadline,
  constructionSpoken,
  zoneAgeLabel,
  zoneLiveAt,
  zoneSourceLabel,
  type DotWorkZone,
  type DriverWorkZone,
  type WorkZone,
} from "./workZone";

const T0 = Date.parse("2026-11-08T12:00:00Z");
const H = 3600_000;

// Straight northbound route, ~3 miles.
const ROUTE: [number, number][] = [
  [43.0, -89.4],
  [43.0145, -89.4],
  [43.029, -89.4],
  [43.0435, -89.4],
];

function driverZone(over: Partial<DriverWorkZone> = {}): DriverWorkZone {
  return {
    kind: "driver",
    id: "driver-1",
    lat: 43.0145, // ~1 mi along the route
    lon: -89.4,
    note: null,
    reporter: "@driver1",
    confirmCount: 0,
    createdAtMs: T0,
    expiresAtMs: T0 + 12 * H,
    lastConfirmedAtMs: null,
    ...over,
  };
}

function dotZone(over: Partial<DotWorkZone> = {}): DotWorkZone {
  return {
    kind: "dot",
    id: "wi511-wz-1",
    lat: 43.0145,
    lon: -89.4,
    road: "I-90 EB",
    description: "Left lane closed",
    sourceLabel: "Wisconsin DOT · 511WI",
    startMs: T0 - H,
    endMs: T0 + 6 * H,
    ...over,
  };
}

describe("age display", () => {
  test("just now / minutes / hours, in the brief's phrasing", () => {
    expect(zoneAgeLabel(T0, T0 + 30_000)).toBe("reported just now");
    expect(zoneAgeLabel(T0, T0 + 20 * 60_000)).toBe("reported 20 min ago");
    expect(zoneAgeLabel(T0, T0 + 59 * 60_000)).toBe("reported 59 min ago");
    expect(zoneAgeLabel(T0, T0 + 3 * H)).toBe("reported 3 h ago");
    expect(zoneAgeLabel(T0, T0 + 26 * H)).toBe("reported 1 d ago");
  });

  test("clock skew never produces a negative age", () => {
    expect(zoneAgeLabel(T0 + 5000, T0)).toBe("reported just now");
  });
});

describe("source labels — the honesty carrier", () => {
  test("driver zones always say Driver-reported with their age", () => {
    expect(zoneSourceLabel(driverZone(), T0 + 20 * 60_000)).toBe("Driver-reported · reported 20 min ago");
  });
  test("DOT zones always name the publishing DOT", () => {
    expect(zoneSourceLabel(dotZone(), T0)).toBe("DOT reported · Wisconsin DOT · 511WI");
  });
});

describe("live window", () => {
  test("a driver zone dies at its 12-hour expiry", () => {
    const z = driverZone();
    expect(zoneLiveAt(z, T0 + 11 * H)).toBe(true);
    expect(zoneLiveAt(z, T0 + 12 * H)).toBe(false);
  });
  test("a DOT zone lives only inside the feed's own window", () => {
    const z = dotZone();
    expect(zoneLiveAt(z, T0 - 2 * H)).toBe(false);
    expect(zoneLiveAt(z, T0)).toBe(true);
    expect(zoneLiveAt(z, T0 + 7 * H)).toBe(false);
  });
});

describe("approach-alert trigger", () => {
  test("fires for a live zone on the route within a mile ahead", () => {
    const hit = constructionAhead([driverZone()], ROUTE, 0.4, T0 + H);
    expect(hit).not.toBeNull();
    expect(hit!.distAheadMi).toBeGreaterThan(0.4);
    expect(hit!.distAheadMi).toBeLessThan(0.8);
  });

  test("does NOT fire beyond the 1-mile alert distance", () => {
    const far = driverZone({ lat: 43.029 }); // ~2 mi along the route
    expect(constructionAhead([far], ROUTE, 0, T0 + H)).toBeNull();
    // The same zone DOES fire once the truck closes inside a mile.
    expect(constructionAhead([far], ROUTE, 1.2, T0 + H)).not.toBeNull();
  });

  test("does NOT fire for a zone behind the truck", () => {
    expect(constructionAhead([driverZone()], ROUTE, 2.0, T0 + H)).toBeNull();
  });

  test("does NOT fire for a zone off the route line", () => {
    const offLine = driverZone({ lon: -89.35 }); // ~2.7 mi east
    expect(constructionAhead([offLine], ROUTE, 0.4, T0 + H)).toBeNull();
  });

  test("does NOT fire for an expired driver zone or an out-of-window DOT zone", () => {
    expect(constructionAhead([driverZone()], ROUTE, 0.4, T0 + 13 * H)).toBeNull();
    expect(constructionAhead([dotZone()], ROUTE, 0.4, T0 + 8 * H)).toBeNull();
  });

  test("fires for a live DOT zone on the route, and the copy names the source", () => {
    const hit = constructionAhead([dotZone()], ROUTE, 0.4, T0 + H);
    expect(hit).not.toBeNull();
    expect(constructionHeadline(hit!)).toContain("DOT construction ahead");
    expect(constructionSpoken(hit!)).toContain("D O T construction ahead");
  });

  test("the nearest zone wins when several are ahead", () => {
    const near = driverZone({ id: "driver-near", lat: 43.0087 }); // ~0.6 mi along
    const hit = constructionAhead([driverZone(), near], ROUTE, 0, T0 + H);
    expect(hit?.zone.id).toBe("driver-near");
  });

  test("banner copy matches the brief's phrasing for driver reports", () => {
    const hit = constructionAhead([driverZone()], ROUTE, 0.2, T0 + H)!;
    expect(constructionHeadline(hit)).toMatch(/^Construction reported ahead — \d\.\d miles$/);
    expect(constructionSpoken(hit)).toContain("Construction reported ahead");
  });

  test("no route = no trigger", () => {
    const zones: WorkZone[] = [driverZone()];
    expect(constructionAhead(zones, null, 0, T0 + H)).toBeNull();
    expect(constructionAhead(zones, [], 0, T0 + H)).toBeNull();
  });
});
