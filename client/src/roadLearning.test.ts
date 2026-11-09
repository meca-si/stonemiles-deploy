// Unit tests for the road-learning layer (roadLearning.ts) — the
// app learning from its own road-matching and traffic mistakes.
// Synthetic corridors stand in for the real I-65 service-road
// stretch; the production functions run unchanged.
// Run: bun test client/src/roadLearning.test.ts

import { describe, expect, test } from "bun:test";
import {
applyTrafficLearning,
cellKeyFor,
clearRoadLearning,
createRoadLearningState,
falseHeavyCountAt,
forgetStretch,
headingBucketFor,
loadRoadLearning,
normalizeRoadLearningState,
observeTrafficGroundTruth,
parallelThresholdsAt,
recordParallelCorrection,
roadLearningSummary,
saveRoadLearning,
setRoadLearningEnabled,
shouldDowngradeHeavyAt,
trafficTrustAt,
type RoadLearningState,
} from "./roadLearning";
import { TRAFFIC_COLORS, type TrafficSegment } from "./trafficSegments";

// The I-65 service-road stretch from the driver's screenshot
// (Decatur, AL area — West I-65 Service Road beside the interstate).
const SPOT = { lat: 34.62, lon: -86.98 };
const NORTH = 0;
const SOUTH = 180;

function parallelHit(state: RoadLearningState, heading = NORTH, atMs = 1000): RoadLearningState {
  return recordParallelCorrection(state, { lat: SPOT.lat, lon: SPOT.lon, headingDeg: heading, offFt: 130, travelMi: 0.3, atMs });
}

function falseHeavyPass(state: RoadLearningState, atMs: number, speed = 45): RoadLearningState {
  return observeTrafficGroundTruth(state, { lat: SPOT.lat, lon: SPOT.lon, headingDeg: NORTH, paintedLevel: "heavy", ownSpeedMph: speed, atMs }).state;
}

describe("opt-in default", () => {
  test("a fresh state is OFF — learning is opt-in, and off records nothing", () => {
    const fresh = createRoadLearningState();
    expect(fresh.enabled).toBe(false);
    const after = parallelHit(fresh);
    expect(after.stretches.length).toBe(0);
    expect(loadRoadLearning(null).enabled).toBe(false);
    expect(normalizeRoadLearningState({ stretches: [], corrections: [] }).enabled).toBe(false);
    // A stored explicit choice survives normalization either way.
    expect(normalizeRoadLearningState({ enabled: true, stretches: [], corrections: [] }).enabled).toBe(true);
  });
});

describe("cells and heading buckets", () => {
  test("nearby points share a cell; a mile away is a different stretch", () => {
    expect(cellKeyFor(SPOT.lat, SPOT.lon)).toBe(cellKeyFor(SPOT.lat + 0.001, SPOT.lon + 0.001));
    expect(cellKeyFor(SPOT.lat, SPOT.lon)).not.toBe(cellKeyFor(SPOT.lat + 0.02, SPOT.lon));
  });
  test("heading buckets are 8-wind and wrap", () => {
    expect(headingBucketFor(0)).toBe(0);
    expect(headingBucketFor(44)).toBe(1);
    expect(headingBucketFor(180)).toBe(4);
    expect(headingBucketFor(359)).toBe(0);
    expect(headingBucketFor(null)).toBe(-1);
  });
});

describe("parallel-road memory", () => {
  test("a proven parallel episode is remembered and logged as a correction", () => {
    const s = parallelHit(createRoadLearningState(true));
    expect(s.stretches.length).toBe(1);
    expect(s.stretches[0]!.parallelHits).toBe(1);
    expect(s.corrections.length).toBe(1);
    expect(s.corrections[0]!.kind).toBe("parallel_road");
    expect(s.corrections[0]!.detail).toContain("service-road case");
  });
  test("a remembered stretch lowers the recognition bar in the same direction", () => {
    const fresh = createRoadLearningState(true);
    expect(parallelThresholdsAt(fresh, SPOT.lat, SPOT.lon, NORTH)).toEqual({ sustainMs: 6000, minTravelMi: 0.07 });
    const once = parallelHit(fresh);
    const t = parallelThresholdsAt(once, SPOT.lat, SPOT.lon, NORTH);
    expect(t.sustainMs).toBeLessThan(6000);
    expect(t.minTravelMi).toBeLessThan(0.07);
    const thrice = parallelHit(parallelHit(once, NORTH, 2000), NORTH, 3000);
    expect(parallelThresholdsAt(thrice, SPOT.lat, SPOT.lon, NORTH).sustainMs).toBeLessThan(t.sustainMs);
  });
  test("the opposite direction earns nothing — a different carriageway is a different lesson", () => {
    const s = parallelHit(createRoadLearningState(true), NORTH);
    expect(parallelThresholdsAt(s, SPOT.lat, SPOT.lon, SOUTH)).toEqual({ sustainMs: 6000, minTravelMi: 0.07 });
  });
  test("a different corridor earns nothing", () => {
    const s = parallelHit(createRoadLearningState(true));
    expect(parallelThresholdsAt(s, SPOT.lat + 0.05, SPOT.lon, NORTH)).toEqual({ sustainMs: 6000, minTravelMi: 0.07 });
  });
  test("while OFF, nothing is recorded and no bar moves", () => {
    const off = createRoadLearningState(false);
    const s = parallelHit(off);
    expect(s.stretches.length).toBe(0);
    expect(s.corrections.length).toBe(0);
    expect(parallelThresholdsAt(off, SPOT.lat, SPOT.lon, NORTH)).toEqual({ sustainMs: 6000, minTravelMi: 0.07 });
  });
});

describe("traffic ground truth — the truck's own speed judges the paint", () => {
  test("flowing at 45 through a HEAVY paint is a false-heavy observation", () => {
    const r = observeTrafficGroundTruth(createRoadLearningState(true), { lat: SPOT.lat, lon: SPOT.lon, headingDeg: NORTH, paintedLevel: "heavy", ownSpeedMph: 45, atMs: 1000 });
    expect(r.verdict).toBe("false_heavy");
    expect(r.state.corrections[0]!.kind).toBe("traffic_false_heavy");
  });
  test("crawling at 10 through a HEAVY paint confirms it", () => {
    const r = observeTrafficGroundTruth(createRoadLearningState(true), { lat: SPOT.lat, lon: SPOT.lon, headingDeg: NORTH, paintedLevel: "heavy", ownSpeedMph: 10, atMs: 1000 });
    expect(r.verdict).toBe("true_heavy");
  });
  test("inconclusive speeds (25 mph through heavy) teach nothing", () => {
    const r = observeTrafficGroundTruth(createRoadLearningState(true), { lat: SPOT.lat, lon: SPOT.lon, headingDeg: NORTH, paintedLevel: "heavy", ownSpeedMph: 25, atMs: 1000 });
    expect(r.verdict).toBeNull();
    expect(r.state.stretches.length).toBe(0);
  });
  test("two false-heavy passes drop trust below the downgrade bar; one does not", () => {
    const once = falseHeavyPass(createRoadLearningState(true), 1000);
    expect(shouldDowngradeHeavyAt(once, SPOT.lat, SPOT.lon)).toBe(false);
    const twice = falseHeavyPass(once, 2000);
    expect(falseHeavyCountAt(twice, SPOT.lat, SPOT.lon)).toBe(2);
    expect(trafficTrustAt(twice, SPOT.lat, SPOT.lon)).toBeLessThan(0.6);
    expect(shouldDowngradeHeavyAt(twice, SPOT.lat, SPOT.lon)).toBe(true);
  });
  test("confirmations earn trust back — a corridor is never banned", () => {
    let s = falseHeavyPass(createRoadLearningState(true), 1000);
    s = falseHeavyPass(s, 2000);
    expect(shouldDowngradeHeavyAt(s, SPOT.lat, SPOT.lon)).toBe(true);
    for (let i = 0; i < 4; i++) {
      s = observeTrafficGroundTruth(s, { lat: SPOT.lat, lon: SPOT.lon, headingDeg: NORTH, paintedLevel: "heavy", ownSpeedMph: 8, atMs: 3000 + i }).state;
    }
    expect(shouldDowngradeHeavyAt(s, SPOT.lat, SPOT.lon)).toBe(false);
    expect(trafficTrustAt(s, SPOT.lat, SPOT.lon)).toBeGreaterThan(0.6);
  });
});

describe("applyTrafficLearning — red becomes orange only where proven wrong", () => {
  const segAt = (lat: number, level: "slow" | "heavy"): TrafficSegment => ({
    coords: [[lat - 0.001, SPOT.lon], [lat, SPOT.lon], [lat + 0.001, SPOT.lon]],
    level,
    color: level === "heavy" ? TRAFFIC_COLORS.heavy : TRAFFIC_COLORS.slow,
  });
  test("a heavy segment in a twice-proven-wrong corridor downgrades to slow", () => {
    let s = falseHeavyPass(createRoadLearningState(true), 1000);
    s = falseHeavyPass(s, 2000);
    const { segments, downgraded } = applyTrafficLearning([segAt(SPOT.lat, "heavy")], s);
    expect(downgraded).toBe(1);
    expect(segments[0]!.level).toBe("slow");
    expect(segments[0]!.color).toBe(TRAFFIC_COLORS.slow);
  });
  test("a heavy segment in an unproven corridor stays red", () => {
    const { segments, downgraded } = applyTrafficLearning([segAt(SPOT.lat, "heavy")], createRoadLearningState(true));
    expect(downgraded).toBe(0);
    expect(segments[0]!.level).toBe("heavy");
  });
  test("a heavy segment in a DIFFERENT corridor stays red even when this one is distrusted", () => {
    let s = falseHeavyPass(createRoadLearningState(true), 1000);
    s = falseHeavyPass(s, 2000);
    const { downgraded } = applyTrafficLearning([segAt(SPOT.lat + 0.05, "heavy")], s);
    expect(downgraded).toBe(0);
  });
  test("while OFF, paint is never touched", () => {
    let s = falseHeavyPass(createRoadLearningState(true), 1000);
    s = setRoadLearningEnabled(falseHeavyPass(s, 2000), false);
    const { downgraded } = applyTrafficLearning([segAt(SPOT.lat, "heavy")], s);
    expect(downgraded).toBe(0);
  });
});

describe("memory management", () => {
  test("forgetting a stretch removes its behaviour but keeps the corrections log honest", () => {
    const s = parallelHit(createRoadLearningState(true));
    const stretch = s.stretches[0]!;
    const f = forgetStretch(s, stretch.cellKey, stretch.headingBucket);
    expect(f.stretches.length).toBe(0);
    expect(f.corrections.length).toBe(1); // history is not rewritten
    expect(parallelThresholdsAt(f, SPOT.lat, SPOT.lon, NORTH)).toEqual({ sustainMs: 6000, minTravelMi: 0.07 });
  });
  test("clear forgets everything; summary counts what was learned", () => {
    let s = parallelHit(createRoadLearningState(true));
    s = falseHeavyPass(s, 2000);
    const sum = roadLearningSummary(s);
    expect(sum.parallelStretches).toBeGreaterThanOrEqual(1);
    expect(sum.falseHeavyTotal).toBe(1);
    const cleared = clearRoadLearning(s);
    expect(cleared.stretches.length).toBe(0);
    expect(cleared.corrections.length).toBe(0);
    expect(cleared.enabled).toBe(true); // clearing memory never flips the switch
  });
  test("storage round-trips, and corrupt storage falls back to a fresh state", () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
    const s = parallelHit(createRoadLearningState(true));
    saveRoadLearning(s, storage);
    const back = loadRoadLearning(storage);
    expect(back.stretches.length).toBe(1);
    expect(back.corrections.length).toBe(1);
    mem.set("sm-road-learning-v1", "{not json");
    expect(loadRoadLearning(storage).stretches.length).toBe(0);
    expect(normalizeRoadLearningState({ stretches: "junk", corrections: 42 }).stretches.length).toBe(0);
  });
  test("corrections log is capped — it stays a log, not an archive", () => {
    let s = createRoadLearningState(true);
    for (let i = 0; i < 80; i++) s = parallelHit(s, NORTH, 1000 + i);
    expect(s.corrections.length).toBeLessThanOrEqual(60);
    expect(s.stretches[0]!.parallelHits).toBe(80); // the memory itself is not capped by the log
  });
});
