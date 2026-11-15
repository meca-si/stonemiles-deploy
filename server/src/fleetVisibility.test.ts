// fleetVisibility.test.ts — PURE rule tests for fleet visibility +
// outward sharing (TMS queue item 4): freshness honesty, the
// deadhead assign ranking (a truck finishing near the pickup
// outranks an empty truck sitting farther away), stop cleaning,
// and the derived track-share state. Integration coverage (gates,
// scoping, the rate law over the wire) lives in
// fleetVisibilityFlow.test.ts.
//
// Run: bun test server/src/fleetVisibility.test.ts
import { describe, expect, test } from "bun:test";
import {
  SNAPSHOT_FRESH_MS,
  cleanStops,
  freshnessFor,
  haversineMi,
  laneLabel,
  plainLoadStatus,
  rankAssignCandidates,
  snapshotFreshFor,
  trackShareStateFor,
} from "./fleetVisibility";

const NOW = new Date("2026-11-15T18:00:00Z");
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60000);

describe("haversineMi", () => {
  test("zero for the same point, sane for a known lane", () => {
    expect(haversineMi({ lat: 32.78, lon: -96.8 }, { lat: 32.78, lon: -96.8 })).toBe(0);
    // Dallas → Fort Worth is ~30 mi straight-line.
    const d = haversineMi({ lat: 32.7767, lon: -96.797 }, { lat: 32.7555, lon: -97.3308 });
    expect(d).toBeGreaterThan(25);
    expect(d).toBeLessThan(40);
  });
});

describe("freshnessFor — a stale dot never poses as live", () => {
  test("no fix reads as none", () => {
    const f = freshnessFor(null, NOW);
    expect(f.bucket).toBe("none");
    expect(f.ageMinutes).toBeNull();
    expect(f.label).toContain("No location reported");
  });
  test("fresh fixes are live and labelled in minutes", () => {
    expect(freshnessFor(minsAgo(0), NOW).label).toBe("updated just now");
    const f = freshnessFor(minsAgo(2), NOW);
    expect(f.bucket).toBe("live");
    expect(f.label).toBe("updated 2 min ago");
  });
  test("buckets age honestly: recent, then stale", () => {
    expect(freshnessFor(minsAgo(45), NOW).bucket).toBe("recent");
    expect(freshnessFor(minsAgo(45), NOW).label).toBe("updated 45 min ago");
    const stale = freshnessFor(minsAgo(60 * 5 + 12), NOW);
    expect(stale.bucket).toBe("stale");
    expect(stale.label).toBe("updated 5 h 12 min ago");
    expect(freshnessFor(minsAgo(60 * 50), NOW).label).toBe("updated 2 d ago");
  });
});

describe("snapshotFreshFor", () => {
  test("inside the window counts, outside and missing do not", () => {
    expect(snapshotFreshFor(minsAgo(5), NOW)).toBe(true);
    expect(snapshotFreshFor(new Date(NOW.getTime() - SNAPSHOT_FRESH_MS), NOW)).toBe(true);
    expect(snapshotFreshFor(new Date(NOW.getTime() - SNAPSHOT_FRESH_MS - 1), NOW)).toBe(false);
    expect(snapshotFreshFor(null, NOW)).toBe(false);
  });
});

describe("plainLoadStatus + laneLabel + cleanStops", () => {
  test("plain statuses", () => {
    expect(plainLoadStatus("booked")).toContain("waiting for pickup");
    expect(plainLoadStatus("picked_up")).toContain("on the road");
    expect(plainLoadStatus("sealed")).toBe("Delivered");
    expect(plainLoadStatus(null)).toBe("In progress");
    expect(plainLoadStatus("whatever")).toBe("In progress");
  });
  test("lane labels fall back plainly", () => {
    expect(laneLabel("Dallas", "TX", "Memphis", "TN")).toBe("Dallas, TX → Memphis, TN");
    expect(laneLabel(null, null, null, null)).toBe("Pickup → Delivery");
    expect(laneLabel("Dallas", null, null, "TN")).toBe("Dallas → TN");
  });
  test("stops are trimmed, capped, and emptied of blanks", () => {
    expect(cleanStops(["  Fuel — Laredo ", "", "  ", "Rest"])).toEqual(["Fuel — Laredo", "Rest"]);
    expect(cleanStops(null)).toEqual([]);
    expect(cleanStops(Array.from({ length: 30 }, (_, i) => `stop ${i}`)).length).toBe(20);
    expect(cleanStops(["x".repeat(200)])[0]!.length).toBe(80);
  });
});

describe("rankAssignCandidates — deadhead ranking", () => {
  // Pickup: Dallas, TX.
  const pickup = { lat: 32.7767, lon: -96.797 };
  // ~9 mi from the pickup (Irving, TX).
  const near = { lat: 32.814, lon: -96.9489 };
  // ~180 mi away (Waco is ~95; use Oklahoma City ~190).
  const far = { lat: 35.4676, lon: -97.5164 };

  test("a truck finishing near the pickup outranks an empty truck sitting farther away", () => {
    const ranked = rankAssignCandidates(
      [
        { username: "emptyfar", currentPos: far, routeEnd: null, hasActiveLoad: false },
        { username: "finishing", currentPos: far, routeEnd: near, hasActiveLoad: true },
      ],
      pickup,
    );
    expect(ranked[0]!.username).toBe("finishing");
    expect(ranked[0]!.basis).toBe("route_end");
    expect(ranked[0]!.effectiveMi).toBe(ranked[0]!.deadheadEndMi);
    expect(ranked[0]!.effectiveMi!).toBeLessThan(20);
    expect(ranked[1]!.username).toBe("emptyfar");
    expect(ranked[1]!.basis).toBe("current");
    expect(ranked[1]!.effectiveMi!).toBeGreaterThan(150);
  });

  test("empty trucks rank by current position; unknown positions rank last, named", () => {
    const ranked = rankAssignCandidates(
      [
        { username: "ghost", currentPos: null, routeEnd: null, hasActiveLoad: false },
        { username: "faraway", currentPos: far, routeEnd: null, hasActiveLoad: false },
        { username: "closetruck", currentPos: near, routeEnd: null, hasActiveLoad: false },
      ],
      pickup,
    );
    expect(ranked.map((r) => r.username)).toEqual(["closetruck", "faraway", "ghost"]);
    expect(ranked[2]!.effectiveMi).toBeNull();
    expect(ranked[2]!.basis).toBe("unknown");
    expect(ranked[2]!.basisLabel).toContain("cannot rank");
  });

  test("a loaded truck without a known route end falls back to its current position, and says so", () => {
    const ranked = rankAssignCandidates(
      [{ username: "loaded", currentPos: near, routeEnd: null, hasActiveLoad: true }],
      pickup,
    );
    expect(ranked[0]!.basis).toBe("current");
    expect(ranked[0]!.basisLabel).toContain("route end unknown");
    expect(ranked[0]!.deadheadEndMi).toBeNull();
    expect(ranked[0]!.effectiveMi).toBe(ranked[0]!.deadheadNowMi);
  });

  test("without a pickup point nothing is invented — distances stay null, order is stable", () => {
    const ranked = rankAssignCandidates(
      [
        { username: "bravo", currentPos: far, routeEnd: null, hasActiveLoad: false },
        { username: "alpha", currentPos: near, routeEnd: null, hasActiveLoad: false },
      ],
      null,
    );
    expect(ranked.every((r) => r.effectiveMi == null && r.deadheadNowMi == null)).toBe(true);
    expect(ranked.map((r) => r.username)).toEqual(["alpha", "bravo"]);
  });
});

describe("trackShareStateFor — expiry is derived, never stored", () => {
  test("revoked beats everything, delivered ends the share, else live", () => {
    expect(trackShareStateFor({ linkStatus: "revoked", delivered: false })).toBe("revoked");
    expect(trackShareStateFor({ linkStatus: "revoked", delivered: true })).toBe("revoked");
    expect(trackShareStateFor({ linkStatus: "active", delivered: true })).toBe("delivered");
    expect(trackShareStateFor({ linkStatus: "active", delivered: false })).toBe("live");
  });
});
