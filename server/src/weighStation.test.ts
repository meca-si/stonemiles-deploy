import { describe, expect, test } from "bun:test";
import {
  NOT_HERE_RETIRE_THRESHOLD,
  WEIGH_APPROACH_MI,
  WEIGH_DEDUPE_MI,
  WEIGH_FRESH_MS,
  WEIGH_STALE_MS,
  WEIGH_VERIFY_RADIUS_MI,
  effectiveWeighStatus,
  excludeRetiredCandidates,
  intelReportIdForPlaceId,
  isPlaceSuppressedForDriver,
  planNotHereCorrection,
  planStationHereReport,
  roadPlaceKindForId,
  weighReportVerified,
  weighStatusAgeMin,
  weighStatusIsFresh,
  type StationHereCandidate,
} from "./weighStation";

const NOW = 1_800_000_000_000;

describe("effectiveWeighStatus — 4-hour staleness", () => {
  test("a fresh report shows its status", () => {
    expect(effectiveWeighStatus("open", NOW - 5 * 60000, NOW)).toBe("open");
    expect(effectiveWeighStatus("closed", NOW - 59 * 60000, NOW)).toBe("closed");
  });
  test("at exactly 4 hours the status still shows; past it, unknown", () => {
    expect(effectiveWeighStatus("open", NOW - WEIGH_STALE_MS, NOW)).toBe("open");
    expect(effectiveWeighStatus("open", NOW - WEIGH_STALE_MS - 1, NOW)).toBe("unknown");
    expect(effectiveWeighStatus("closed", NOW - 9 * 3600000, NOW)).toBe("unknown");
  });
  test("no report / junk status is unknown", () => {
    expect(effectiveWeighStatus(null, null, NOW)).toBe("unknown");
    expect(effectiveWeighStatus("open", null, NOW)).toBe("unknown");
    expect(effectiveWeighStatus("banana", NOW, NOW)).toBe("unknown");
  });
});

describe("weighStatusIsFresh — the 60-minute prompt gate", () => {
  test("under 60 minutes is fresh (no prompt)", () => {
    expect(weighStatusIsFresh("open", NOW - 30 * 60000, NOW)).toBe(true);
    expect(weighStatusIsFresh("closed", NOW - (WEIGH_FRESH_MS - 1), NOW)).toBe(true);
  });
  test("at/over 60 minutes is no longer fresh (prompt allowed)", () => {
    expect(weighStatusIsFresh("open", NOW - WEIGH_FRESH_MS, NOW)).toBe(false);
    expect(weighStatusIsFresh("open", NOW - 90 * 60000, NOW)).toBe(false);
  });
  test("unknown and stale statuses are never fresh", () => {
    expect(weighStatusIsFresh(null, null, NOW)).toBe(false);
    expect(weighStatusIsFresh("open", NOW - WEIGH_STALE_MS - 60000, NOW)).toBe(false);
  });
});

describe("weighReportVerified — points only when GPS-verified", () => {
  test("the prompt distance is 0.7 mi but the verification radius did NOT shrink with it", () => {
    expect(WEIGH_APPROACH_MI).toBe(0.7);
    expect(WEIGH_VERIFY_RADIUS_MI).toBe(2.5);
    // Sandbox verification paid a report at 1.5 mi — it still pays.
    expect(weighReportVerified(1.5)).toBe(true);
  });
  test("inside the approach zone verifies", () => {
    expect(weighReportVerified(0)).toBe(true);
    expect(weighReportVerified(1.9)).toBe(true);
    expect(weighReportVerified(WEIGH_VERIFY_RADIUS_MI)).toBe(true);
  });
  test("outside the approach zone does not verify — status counts, points don't", () => {
    expect(weighReportVerified(WEIGH_VERIFY_RADIUS_MI + 0.01)).toBe(false);
    expect(weighReportVerified(40)).toBe(false);
    expect(weighReportVerified(Number.NaN)).toBe(false);
    expect(weighReportVerified(-1)).toBe(false);
  });
});

describe("weighStatusAgeMin", () => {
  test("floors at whole minutes and never goes negative", () => {
    expect(weighStatusAgeMin(NOW - 12 * 60000 - 30000, NOW)).toBe(12);
    expect(weighStatusAgeMin(NOW + 60000, NOW)).toBe(0);
  });
});

describe("planStationHereReport — Station-here create vs dedupe update", () => {
  // The driver's tap position, standing at the station.
  const TAP = { lat: 33.0, lon: -86.8 };
  const cand = (stationId: string, lat: number, lon: number): StationHereCandidate => ({ stationId, lat, lon });
  // ~0.2 mi north of the tap.
  const AT_0_2MI = cand("weigh-100", 33.0029, -86.8);
  // ~0.29 mi north — just inside the dedupe radius.
  const AT_0_29MI = cand("driver-near", 33.0042, -86.8);
  // ~0.45 mi north — outside the dedupe radius.
  const AT_0_45MI = cand("weigh-200", 33.0065, -86.8);
  // ~0.5 mi north — clearly outside.
  const AT_0_5MI = cand("weigh-300", 33.0072, -86.8);

  test("the dedupe radius is 0.3 miles", () => {
    expect(WEIGH_DEDUPE_MI).toBe(0.3);
  });
  test("no known stations → create a new station at the tap position", () => {
    expect(planStationHereReport([], TAP)).toEqual({ kind: "create" });
  });
  test("an existing station within 0.3 mi → update it, never a duplicate", () => {
    const plan = planStationHereReport([AT_0_2MI], TAP);
    expect(plan.kind).toBe("update");
    if (plan.kind === "update") {
      expect(plan.stationId).toBe("weigh-100");
      expect(plan.distanceMi).toBeLessThan(0.3);
    }
    expect(planStationHereReport([AT_0_29MI], TAP).kind).toBe("update");
  });
  test("dedupe does NOT trigger beyond 0.3 mi → create", () => {
    expect(planStationHereReport([AT_0_45MI], TAP)).toEqual({ kind: "create" });
    expect(planStationHereReport([AT_0_5MI], TAP)).toEqual({ kind: "create" });
  });
  test("driver-reported stations dedupe exactly like OSM stations; the nearest wins", () => {
    const plan = planStationHereReport([AT_0_29MI, AT_0_2MI], TAP);
    expect(plan.kind).toBe("update");
    if (plan.kind === "update") expect(plan.stationId).toBe("weigh-100");
    const driverOnly = planStationHereReport([AT_0_29MI], TAP);
    expect(driverOnly.kind).toBe("update");
    if (driverOnly.kind === "update") expect(driverOnly.stationId).toBe("driver-near");
  });
  test("creation pays exactly once per location: a second tap at the same spot plans an update, not a create", () => {
    // First tap: nothing exists → create (the only branch that can
    // pay a creation reward).
    expect(planStationHereReport([], TAP).kind).toBe("create");
    // The station now exists at the tap position; the identical
    // second tap dedupes onto it.
    const created = cand("driver-new", TAP.lat, TAP.lon);
    const second = planStationHereReport([created], TAP);
    expect(second.kind).toBe("update");
    if (second.kind === "update") {
      expect(second.stationId).toBe("driver-new");
      expect(second.distanceMi).toBe(0);
    }
  });
});

describe("planNotHereCorrection — 'Not here' outcomes (migration 0094)", () => {
  test("the retire threshold is two independent drivers", () => {
    expect(NOT_HERE_RETIRE_THRESHOLD).toBe(2);
  });
  test("a first mark by a non-creator hides the spot for that driver only", () => {
    const plan = planNotHereCorrection({ reporter: "alice", creator: "bob", existingReporters: [] });
    expect(plan).toEqual({ outcome: "hidden", distinctReporters: 1, alreadyMarked: false });
  });
  test("a first mark on a creator-less spot (OSM station) hides only", () => {
    const plan = planNotHereCorrection({ reporter: "alice", creator: null, existingReporters: [] });
    expect(plan.outcome).toBe("hidden");
    expect(plan.distinctReporters).toBe(1);
  });
  test("the creator marking their own spot deletes it outright — even as the first mark", () => {
    const plan = planNotHereCorrection({ reporter: "bob", creator: "bob", existingReporters: [] });
    expect(plan).toEqual({ outcome: "deleted", distinctReporters: 1, alreadyMarked: false });
  });
  test("the creator's mark outranks the threshold: creator second still deletes", () => {
    const plan = planNotHereCorrection({ reporter: "bob", creator: "bob", existingReporters: ["alice"] });
    expect(plan.outcome).toBe("deleted");
    expect(plan.distinctReporters).toBe(2);
  });
  test("a second INDEPENDENT driver's mark retires the spot for everyone", () => {
    const plan = planNotHereCorrection({ reporter: "carol", creator: "bob", existingReporters: ["alice"] });
    expect(plan).toEqual({ outcome: "retired", distinctReporters: 2, alreadyMarked: false });
  });
  test("the same driver marking twice never counts twice — no retirement from one driver", () => {
    const plan = planNotHereCorrection({ reporter: "alice", creator: "bob", existingReporters: ["alice"] });
    expect(plan).toEqual({ outcome: "hidden", distinctReporters: 1, alreadyMarked: true });
  });
  test("duplicate names in the existing list collapse before counting", () => {
    const plan = planNotHereCorrection({ reporter: "carol", creator: null, existingReporters: ["alice", "alice"] });
    expect(plan.outcome).toBe("retired");
    expect(plan.distinctReporters).toBe(2);
  });
});

describe("roadPlaceKindForId / intelReportIdForPlaceId — the unified place universe", () => {
  test("place kinds derive from the id namespace", () => {
    expect(roadPlaceKindForId("weigh-12345")).toBe("weigh_station");
    expect(roadPlaceKindForId("driver-9f2c")).toBe("driver_weigh_station");
    expect(roadPlaceKindForId("intel-42")).toBe("intel_report");
    expect(roadPlaceKindForId("explore-weigh-30.63469--88.15890")).toBe("place");
  });
  test("intel place ids parse back to their report id; others do not", () => {
    expect(intelReportIdForPlaceId("intel-42")).toBe(42);
    expect(intelReportIdForPlaceId("weigh-42")).toBeNull();
    expect(intelReportIdForPlaceId("intel-")).toBeNull();
    expect(intelReportIdForPlaceId("intel-abc")).toBeNull();
  });
});

describe("isPlaceSuppressedForDriver — hide + retired suppression", () => {
  test("hidden for the reporter and retired for everyone both suppress; other places do not", () => {
    const hidden = new Set(["intel-7"]);
    const retired = new Set(["weigh-99"]);
    expect(isPlaceSuppressedForDriver("intel-7", hidden, retired)).toBe(true);
    expect(isPlaceSuppressedForDriver("weigh-99", hidden, retired)).toBe(true);
    expect(isPlaceSuppressedForDriver("weigh-100", hidden, retired)).toBe(false);
    expect(isPlaceSuppressedForDriver("intel-7", new Set(), new Set())).toBe(false);
  });
});

describe("excludeRetiredCandidates — Station here never resurrects a retired spot", () => {
  const cand = (stationId: string, lat: number, lon: number): StationHereCandidate => ({ stationId, lat, lon });
  const TAP = { lat: 33.0, lon: -86.8 };
  test("a retired station at the tap position is excluded, so the tap plans a CREATE", () => {
    const retiredStation = cand("weigh-retired", TAP.lat, TAP.lon);
    const kept = excludeRetiredCandidates([retiredStation], new Set(["weigh-retired"]));
    expect(kept).toEqual([]);
    expect(planStationHereReport(kept, TAP)).toEqual({ kind: "create" });
  });
  test("a live station at the tap position still dedupes to an UPDATE (Station here unregressed)", () => {
    const live = cand("weigh-live", TAP.lat, TAP.lon);
    const kept = excludeRetiredCandidates([live], new Set(["weigh-retired"]));
    const plan = planStationHereReport(kept, TAP);
    expect(plan.kind).toBe("update");
    if (plan.kind === "update") expect(plan.stationId).toBe("weigh-live");
  });
});
