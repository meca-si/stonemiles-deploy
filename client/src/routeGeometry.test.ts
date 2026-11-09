// Unit tests for route geometry (client/src/routeGeometry.ts) — the
// production math behind off-route detection and guidance progress.
// Synthetic routes stand in for Valhalla shapes (the build sandbox
// has no GPS and no routing service): a straight east-west "highway",
// an L-shaped route, and a long sparse segment — the case the old
// nearest-VERTEX math got wrong.
// Run: bun test client/src/routeGeometry.test.ts

import { describe, expect, test } from "bun:test";
import {
OFF_ROUTE_MI,
PARALLEL_MIN_TRAVEL_MI,
PARALLEL_SUSTAIN_MS,
bearingDeltaDeg,
createParallelTrackTracker,
headingFromTrack,
isParallelCandidate,
mapPlaneSideFor,
normalizeBearingDeg,
projectOntoRoute,
screenDeltaToMapDelta,
smoothBearingDeg,
snapDisplayToRoute,
type LatLon,
} from "./routeGeometry";

// Base point: Theodore, AL.
const BASE = { lat: 30.551, lon: -88.1687 };
const M_PER_DEG_LAT = 111189;
const M_PER_DEG_LON = 111189 * Math.cos((BASE.lat * Math.PI) / 180);

function pt(eastM: number, northM: number): LatLon {
  return {
    lat: BASE.lat + northM / M_PER_DEG_LAT,
    lon: BASE.lon + eastM / M_PER_DEG_LON,
  };
}
function coord(eastM: number, northM: number): [number, number] {
  const p = pt(eastM, northM);
  return [p.lat, p.lon];
}
const MI = 1609.344;

describe("point-to-segment distance", () => {
  test("a point dead-center on a long straight segment reads ~0 off route", () => {
    // One 2-mile segment, no intermediate vertices. The old
    // nearest-vertex math read ~1 mile here — the regression this
    // module exists to kill.
    const route: [number, number][] = [coord(0, 0), coord(2 * MI, 0)];
    const mid = projectOntoRoute(pt(MI, 0), route);
    expect(mid.offMi).toBeLessThan(0.001);
    expect(mid.alongMi).toBeGreaterThan(0.99);
    expect(mid.alongMi).toBeLessThan(1.01);
    expect(mid.totalMi).toBeGreaterThan(1.99);
    expect(mid.totalMi).toBeLessThan(2.01);
  });

  test("perpendicular distance to the segment is the true off-route distance", () => {
    const route: [number, number][] = [coord(0, 0), coord(2 * MI, 0)];
    // 200 m north of the midpoint: off route, and past the threshold.
    const off = projectOntoRoute(pt(MI, 200), route);
    expect(off.offMi).toBeGreaterThan(0.12);
    expect(off.offMi).toBeLessThan(0.13);
    expect(off.offMi).toBeGreaterThan(OFF_ROUTE_MI);
    // Along-track still points at the midpoint, not a vertex.
    expect(off.alongMi).toBeGreaterThan(0.99);
    expect(off.alongMi).toBeLessThan(1.01);
  });

  test("a few blocks off in town exceeds the threshold; on the road stays under it", () => {
    // Short city segments (intersections ~100 m apart), like the
    // reported failure: the driver stopped a couple of blocks from
    // the route line and nothing ever fired under the old 0.3 mi bar.
    const route: [number, number][] = [coord(0, 0), coord(100, 0), coord(200, 0), coord(300, 0)];
    const twoBlocksOff = projectOntoRoute(pt(150, 220), route);
    expect(twoBlocksOff.offMi).toBeGreaterThan(OFF_ROUTE_MI);
    const onRoad = projectOntoRoute(pt(150, 12), route);
    expect(onRoad.offMi).toBeLessThan(OFF_ROUTE_MI);
    expect(onRoad.offMi).toBeLessThan(0.01);
    // Worst accepted GPS fuzz (65 m) while truly on the road also
    // stays under the threshold — no false reroutes from fuzz alone.
    const fuzz = projectOntoRoute(pt(150, 65), route);
    expect(fuzz.offMi).toBeLessThan(OFF_ROUTE_MI);
  });

  test("past the end of the route, distance is to the endpoint and progress clamps", () => {
    const route: [number, number][] = [coord(0, 0), coord(MI, 0)];
    const past = projectOntoRoute(pt(MI + 300, 40), route);
    expect(past.alongMi).toBeCloseTo(past.totalMi, 3);
    expect(past.offMi).toBeGreaterThan(0.18);
    expect(past.offMi).toBeLessThan(0.2);
  });

  test("an L-shaped route picks the nearer leg for both distance and progress", () => {
    // East 1 mi, then north 1 mi.
    const route: [number, number][] = [coord(0, 0), coord(MI, 0), coord(MI, MI)];
    const nearSecondLeg = projectOntoRoute(pt(MI - 30, MI / 2), route);
    expect(nearSecondLeg.offMi).toBeLessThan(0.02);
    expect(nearSecondLeg.alongMi).toBeGreaterThan(1.49);
    expect(nearSecondLeg.alongMi).toBeLessThan(1.51);
    const nearFirstLeg = projectOntoRoute(pt(MI / 2, -30), route);
    expect(nearFirstLeg.offMi).toBeLessThan(0.02);
    expect(nearFirstLeg.alongMi).toBeGreaterThan(0.49);
    expect(nearFirstLeg.alongMi).toBeLessThan(0.51);
  });

  test("degenerate shapes behave honestly", () => {
    expect(projectOntoRoute(pt(0, 0), []).offMi).toBe(Infinity);
    const single = projectOntoRoute(pt(100, 0), [coord(0, 0)]);
    expect(single.offMi).toBeGreaterThan(0.06);
    expect(single.offMi).toBeLessThan(0.065);
    expect(single.alongMi).toBe(0);
  });
});

describe("heading-up bearing math", () => {
  test("normalize wraps into [0, 360)", () => {
    expect(normalizeBearingDeg(0)).toBe(0);
    expect(normalizeBearingDeg(360)).toBe(0);
    expect(normalizeBearingDeg(-90)).toBe(270);
    expect(normalizeBearingDeg(725)).toBe(5);
  });

  test("bearing delta takes the short way across the seam", () => {
    expect(bearingDeltaDeg(350, 10)).toBe(20);
    expect(bearingDeltaDeg(10, 350)).toBe(-20);
    expect(bearingDeltaDeg(0, 180)).toBe(180);
    expect(bearingDeltaDeg(90, 90)).toBe(0);
  });

  test("smoothing eases toward the target and never spins the long way", () => {
    // From north toward east: moves partway, capped per step.
    const step1 = smoothBearingDeg(0, 90);
    expect(step1).toBeGreaterThan(0);
    expect(step1).toBeLessThanOrEqual(24);
    // Repeated steps converge on the target.
    let b = 0;
    for (let i = 0; i < 40; i++) b = smoothBearingDeg(b, 90);
    expect(Math.abs(bearingDeltaDeg(b, 90))).toBeLessThan(2);
    // Crossing north: 350 -> 10 turns +20 through 0, never -340.
    const across = smoothBearingDeg(350, 10);
    expect(across).toBeGreaterThan(350);
    expect(across).toBeLessThan(360);
    // Jitter inside the deadband leaves the bearing alone.
    expect(smoothBearingDeg(45, 46)).toBe(45);
  });

  test("screen drag deltas rotate back into the map frame", () => {
    // North-up: identity.
    expect(screenDeltaToMapDelta(10, -4, 0)).toEqual({ dx: 10, dy: -4 });
    // Heading east (bearing 90): the map plane is rendered rotated
    // -90°, so a finger drag UP on screen (0,-10) is a drag toward
    // the map's east (+10, 0) in its own frame — the content still
    // follows the finger exactly on screen.
    const east = screenDeltaToMapDelta(0, -10, 90);
    expect(east.dx).toBeCloseTo(10, 6);
    expect(east.dy).toBeCloseTo(0, 6);
    // Heading south (180): screen up is map-frame down... reversed.
    const south = screenDeltaToMapDelta(0, -10, 180);
    expect(south.dx).toBeCloseTo(0, 6);
    expect(south.dy).toBeCloseTo(10, 6);
    // Heading west (270): screen up is map-frame west.
    const west = screenDeltaToMapDelta(0, -10, 270);
    expect(west.dx).toBeCloseTo(-10, 6);
    expect(west.dy).toBeCloseTo(0, 6);
    // Round trip: rotating a delta by the bearing and back returns it.
    const d = screenDeltaToMapDelta(7, 3, 137);
    const back = screenDeltaToMapDelta(d.dx, d.dy, 360 - 137);
    expect(back.dx).toBeCloseTo(7, 6);
    expect(back.dy).toBeCloseTo(3, 6);
  });
});

describe("map plane size — phone rotation (portrait ⇄ landscape)", () => {
  test("rotating the phone yields the SAME plane side (no clipped plane)", () => {
    // A typical phone frame, both orientations.
    expect(mapPlaneSideFor(390, 844)).toBe(mapPlaneSideFor(844, 390));
    expect(mapPlaneSideFor(360, 800)).toBe(mapPlaneSideFor(800, 360));
  });
  test("the plane covers the frame's corners in both orientations", () => {
    for (const [w, h] of [[390, 844], [844, 390]] as const) {
      const side = mapPlaneSideFor(w, h);
      // A square of this side, centred and rotated to any bearing,
      // covers the frame iff side ≥ the frame diagonal.
      expect(side).toBeGreaterThanOrEqual(Math.hypot(w, h));
      expect(side).toBeGreaterThan(w);
      expect(side).toBeGreaterThan(h);
    }
  });
  test("unmeasured frame falls back to the generous default", () => {
    expect(mapPlaneSideFor(0, 0)).toBe(1400);
    expect(mapPlaneSideFor(0, 844)).toBe(1400);
  });
});

describe("display snap — road test #3: marker off the side of the road", () => {
  const route: [number, number][] = [coord(0, 0), coord(2 * MI, 0)]; // east-west

  test("the projection's snapped point lies ON the line", () => {
    const proj = projectOntoRoute(pt(MI, 30), route);
    expect(Math.round((proj.snapped.lat - BASE.lat) * M_PER_DEG_LAT)).toBe(0);
    expect((proj.snapped.lon - BASE.lon) * M_PER_DEG_LON).toBeCloseTo(MI, 0);
    expect(Math.round(proj.bearingDeg ?? -1)).toBe(90);
  });

  test("a truck scattered 20 m beside its route snaps onto the road", () => {
    const snapped = snapDisplayToRoute(pt(MI, 20), route, { headingDeg: 90 });
    expect(snapped).not.toBeNull();
    expect(Math.round((snapped!.lat - BASE.lat) * M_PER_DEG_LAT)).toBe(0);
  });

  test("a driver on the parallel road 60 m over is NOT dragged onto the route", () => {
    // Frontage-road case: the offset is past the tight snap radius,
    // so the marker stays where GPS puts it and off-route logic
    // (128 m) remains the arbiter — no false "on the interstate".
    expect(snapDisplayToRoute(pt(MI, 60), route, { headingDeg: 90 })).toBeNull();
  });

  test("a crossing pass does not snap sideways (heading gate)", () => {
    // 15 m from the line but travelling north across an east-west
    // route: snapping would teleport the marker onto a road the
    // truck is merely crossing.
    expect(snapDisplayToRoute(pt(MI, 15), route, { headingDeg: 0 })).toBeNull();
    // Same spot, course along the route (either direction): snaps.
    expect(snapDisplayToRoute(pt(MI, 15), route, { headingDeg: 270 })).not.toBeNull();
  });
});

describe("parallel-road tracker — road test #4: the service-road dead zone", () => {
  // Interstate running east; the service road runs 50 m north of it.
  const route: [number, number][] = [coord(0, 0), coord(4 * MI, 0)];
  const projAt = (eastM: number, northM: number) => projectOntoRoute(pt(eastM, northM), route);

  test("the dead zone itself: 50 m over is past the snap, under the off-route bar, and IS a candidate", () => {
    const proj = projAt(MI, 50);
    expect(snapDisplayToRoute(pt(MI, 50), route, { headingDeg: 90 })).toBeNull();
    expect(proj.offMi).toBeLessThan(OFF_ROUTE_MI);
    expect(isParallelCandidate(proj, 90)).toBe(true);
    // Crossing the route at the same offset is NOT parallel running.
    expect(isParallelCandidate(proj, 0)).toBe(false);
    // On the line (10 m over) is not the dead zone at all.
    expect(isParallelCandidate(projAt(MI, 10), 90)).toBe(false);
  });

  test("sustained parallel running fires exactly once — and latches until back on the line", () => {
    const tr = createParallelTrackTracker();
    let fires = 0;
    // Rolling east on the service road: a fix every 2 s at ~30 mph
    // (26.8 m per fix), 50 m north of the interstate line.
    for (let i = 0; i <= 40; i++) {
      if (tr.push(projAt(26.8 * i, 50), 90, i * 2000)) fires += 1;
    }
    expect(fires).toBe(1);
    // Back on the route line: the tracker re-arms.
    tr.push(projAt(26.8 * 41, 5), 90, 42 * 2000);
    let fires2 = 0;
    for (let i = 0; i <= 40; i++) {
      if (tr.push(projAt(26.8 * (42 + i), 50), 90, (43 + i) * 2000)) fires2 += 1;
    }
    expect(fires2).toBe(1);
  });

  test("a brief parallel pass (under the sustain) never fires", () => {
    const tr = createParallelTrackTracker();
    let fires = 0;
    // 3 s in the band — a ramp weave or a wide turn, not a road.
    for (let i = 0; i <= 2; i++) {
      if (tr.push(projAt(26.8 * i, 50), 90, i * 1500)) fires += 1;
    }
    expect(fires).toBe(0);
  });

  test("parked beside the route never fires — no along-track travel, no episode", () => {
    const tr = createParallelTrackTracker();
    let fires = 0;
    // Sitting 50 m off the line for a full minute (timestamps pass
    // the sustain, but along-track progress is ~zero).
    for (let i = 0; i <= 30; i++) {
      if (tr.push(projAt(MI + (i % 2), 50), 90, i * 2000)) fires += 1;
    }
    expect(fires).toBe(0);
    expect(PARALLEL_MIN_TRAVEL_MI).toBeGreaterThan(0);
    expect(PARALLEL_SUSTAIN_MS).toBeGreaterThan(0);
  });

  test("heading from a breadcrumb: east travel reads ~90°, a jitter span reads null", () => {
    const east = headingFromTrack([pt(0, 0), pt(100, 0), pt(300, 4)]);
    expect(east).not.toBeNull();
    expect(Math.abs((east as number) - 90)).toBeLessThan(3);
    expect(headingFromTrack([pt(0, 0), pt(4, 3)])).toBeNull();
    expect(headingFromTrack([pt(0, 0)])).toBeNull();
  });
});

describe("parallel-road tracker — road test #5 calibration (2026-11-01)", () => {
  // Same interstate-east / service-road-50 m-north geometry as #4.
  const route: [number, number][] = [coord(0, 0), coord(4 * MI, 0)];
  const projAt = (eastM: number, northM: number) => projectOntoRoute(pt(eastM, northM), route);

  test("the retuned evidence bar fires sooner than road test #4's pair", () => {
    expect(PARALLEL_SUSTAIN_MS).toBeLessThanOrEqual(6000);
    expect(PARALLEL_MIN_TRAVEL_MI).toBeLessThanOrEqual(0.07);
    const tr = createParallelTrackTracker();
    let firedAt = -1;
    for (let i = 0; i <= 20 && firedAt < 0; i++) {
      if (tr.push(projAt(26.8 * i, 50), 90, i * 2000)) firedAt = i;
    }
    // ~30 mph service-road roll: fires within the first several
    // fixes (the old 0.12 mi bar needed ~8 fixes of travel alone).
    expect(firedAt).toBeGreaterThan(0);
    expect(firedAt).toBeLessThanOrEqual(6);
  });

  test("starved heading (null for a fix or two) holds the streak instead of wiping it", () => {
    const tr = createParallelTrackTracker();
    let fires = 0;
    // Rolling east; the browser GPS drops the course on fixes 2–3
    // (the real service-road failure: the old tracker reset the
    // whole streak on the first null).
    for (let i = 0; i <= 14; i++) {
      const heading = i === 2 || i === 3 ? null : 90;
      if (tr.push(projAt(26.8 * i, 50), heading, i * 2000)) fires += 1;
    }
    expect(fires).toBe(1);
  });

  test("a long heading blackout still ends the episode — three soft misses clear it", () => {
    const tr = createParallelTrackTracker();
    // Build most of a streak, then lose the heading for 3 fixes:
    // the streak must clear, so the fixes after it start over and
    // cannot fire on the old evidence.
    for (let i = 0; i <= 2; i++) tr.push(projAt(26.8 * i, 50), 90, i * 2000);
    for (let i = 3; i <= 5; i++) tr.push(projAt(26.8 * i, 50), null, i * 2000);
    let fires = 0;
    for (let i = 6; i <= 8; i++) {
      if (tr.push(projAt(26.8 * i, 50), 90, i * 2000)) fires += 1;
    }
    expect(fires).toBe(0);
  });

  test("a real heading that disagrees (a turn away) still ends the episode at once", () => {
    const tr = createParallelTrackTracker();
    for (let i = 0; i <= 2; i++) tr.push(projAt(26.8 * i, 50), 90, i * 2000);
    // One fix heading north — crossing away from the east route.
    tr.push(projAt(26.8 * 3, 50), 0, 3 * 2000);
    let fires = 0;
    for (let i = 4; i <= 6; i++) {
      if (tr.push(projAt(26.8 * i, 50), 90, i * 2000)) fires += 1;
    }
    expect(fires).toBe(0);
  });

  test("heading from a breadcrumb follows the TAIL — a turn onto the service road turns the course", () => {
    // East along the interstate, then north up the service road:
    // the whole-buffer course is a ~45° diagonal; the tail course
    // is the road actually being driven (north).
    const shape = [
      pt(0, 0), pt(100, 0), pt(200, 0), pt(300, 0),
      pt(300, 50), pt(300, 100), pt(300, 150), pt(300, 200), pt(300, 250), pt(300, 300),
    ];
    const h = headingFromTrack(shape);
    expect(h).not.toBeNull();
    expect(Math.min(Math.abs((h as number) - 0), Math.abs((h as number) - 360))).toBeLessThan(10);
  });
});
