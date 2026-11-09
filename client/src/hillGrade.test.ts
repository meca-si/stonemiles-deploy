// Unit tests for the hill grade engine (client/src/hillGrade.ts) —
// the production math behind the Drive screen's steep-grade alerts.
// Synthetic elevation profiles stand in for Valhalla's stored route
// elevation: exact ramps at known grades, so every assertion is
// arithmetic, not vibes.
// Run: bun test client/src/hillGrade.test.ts

import { describe, expect, test } from "bun:test";
import {
  advanceWarnMi,
  buildGradeSegments,
  gradeAlertState,
  gradeAtMi,
  gradeHeadline,
  gradeSpoken,
  type ElevProfile,
} from "./hillGrade";

const STEP_MI = 100 / 1609.344; // the 100 m Valhalla sampling step

/** A profile that runs flat, ramps at `gradePct` for `rampMi`, then
 *  runs flat again. Elevations in meters, samples every 100 m. */
function rampProfile(flatMi: number, rampMi: number, gradePct: number, tailMi = 1): ElevProfile {
  const totalMi = flatMi + rampMi + tailMi;
  const n = Math.round(totalMi / STEP_MI) + 1;
  const samplesM: number[] = [];
  let elev = 1000;
  for (let i = 0; i < n; i++) {
    const mi = i * STEP_MI;
    samplesM.push(elev);
    if (mi >= flatMi && mi < flatMi + rampMi) elev += (gradePct / 100) * 100;
  }
  return { stepMi: STEP_MI, samplesM };
}

const FLAT: ElevProfile = { stepMi: STEP_MI, samplesM: Array.from({ length: 200 }, () => 500) };

describe("buildGradeSegments", () => {
  test("no elevation = no segments (null, empty, degenerate, non-finite)", () => {
    expect(buildGradeSegments(null)).toEqual([]);
    expect(buildGradeSegments(undefined)).toEqual([]);
    expect(buildGradeSegments({ stepMi: STEP_MI, samplesM: [] })).toEqual([]);
    expect(buildGradeSegments({ stepMi: STEP_MI, samplesM: [100] })).toEqual([]);
    expect(buildGradeSegments({ stepMi: 0, samplesM: [1, 2, 3] })).toEqual([]);
    expect(buildGradeSegments({ stepMi: STEP_MI, samplesM: [1, Number.NaN, 3] })).toEqual([]);
  });

  test("flat road segments nothing", () => {
    expect(buildGradeSegments(FLAT)).toEqual([]);
  });

  test("a sustained 6% descent is one downgrade segment, strong", () => {
    const segs = buildGradeSegments(rampProfile(1, 1.2, -6));
    expect(segs.length).toBe(1);
    const s = segs[0]!;
    expect(s.direction).toBe("down");
    expect(s.avgPct).toBeGreaterThan(5.4);
    expect(s.avgPct).toBeLessThan(6.6);
    expect(s.peakPct).toBeGreaterThanOrEqual(6);
    expect(s.strong).toBe(true);
    expect(s.lengthMi).toBeGreaterThan(0.9);
    expect(s.lengthMi).toBeLessThan(1.5);
    expect(s.startMi).toBeGreaterThan(0.7);
    expect(s.startMi).toBeLessThan(1.3);
  });

  test("a sustained 5% climb is a climb segment, not strong", () => {
    const segs = buildGradeSegments(rampProfile(1, 2, 5));
    expect(segs.length).toBe(1);
    expect(segs[0]!.direction).toBe("up");
    expect(segs[0]!.avgPct).toBeGreaterThan(4.5);
    expect(segs[0]!.avgPct).toBeLessThan(5.5);
    expect(segs[0]!.strong).toBe(false);
  });

  test("a 3% grade never alerts — under the 4% threshold", () => {
    expect(buildGradeSegments(rampProfile(1, 2, -3))).toEqual([]);
    expect(buildGradeSegments(rampProfile(1, 2, 3.5))).toEqual([]);
  });

  test("a steep but SHORT pitch is not a sustained grade", () => {
    // 8% for only ~0.15 mi — a dip over a creek, not a hill event.
    expect(buildGradeSegments(rampProfile(1, 0.15, -8))).toEqual([]);
  });

  test("a climb and a descent on one route segment separately, in order", () => {
    // Up 5% for 1 mi, flat, then down 6% for 1 mi.
    const up = rampProfile(0.5, 1, 5, 0);
    const samples = [...up.samplesM];
    let elev = samples[samples.length - 1]!;
    for (let i = 0; i < Math.round(0.5 / STEP_MI); i++) samples.push(elev);
    for (let i = 0; i < Math.round(1 / STEP_MI); i++) {
      elev -= 6;
      samples.push(elev);
    }
    for (let i = 0; i < 10; i++) samples.push(elev);
    const segs = buildGradeSegments({ stepMi: STEP_MI, samplesM: samples });
    expect(segs.length).toBe(2);
    expect(segs[0]!.direction).toBe("up");
    expect(segs[1]!.direction).toBe("down");
    expect(segs[1]!.startMi).toBeGreaterThan(segs[0]!.endMi);
  });

  test("a brief flattening mid-descent does not split the hill", () => {
    // 6% down for 0.6 mi, flat ~0.1 mi, 6% down for 0.6 mi more.
    const samples: number[] = [];
    let elev = 2000;
    const push = (gradePct: number, mi: number) => {
      const n = Math.round(mi / STEP_MI);
      for (let i = 0; i < n; i++) {
        samples.push(elev);
        elev += (gradePct / 100) * 100;
      }
    };
    push(0, 0.5);
    push(-6, 0.6);
    push(0, 0.1);
    push(-6, 0.6);
    push(0, 0.5);
    samples.push(elev);
    const segs = buildGradeSegments({ stepMi: STEP_MI, samplesM: samples });
    expect(segs.length).toBe(1);
    expect(segs[0]!.direction).toBe("down");
    expect(segs[0]!.lengthMi).toBeGreaterThan(1.1);
  });
});

describe("gradeAtMi", () => {
  test("null without elevation or outside the profile", () => {
    expect(gradeAtMi(null, 1)).toBeNull();
    expect(gradeAtMi(FLAT, -1)).toBeNull();
    expect(gradeAtMi(FLAT, 999)).toBeNull();
  });

  test("reads ~0 on flat, negative descending, positive climbing", () => {
    expect(Math.abs(gradeAtMi(FLAT, 1)!)).toBeLessThan(0.5);
    const down = rampProfile(1, 1.2, -6);
    const mid = gradeAtMi(down, 1.6)!;
    expect(mid).toBeLessThan(-5);
    expect(mid).toBeGreaterThan(-7);
    const up = rampProfile(1, 2, 5);
    expect(gradeAtMi(up, 2)!).toBeGreaterThan(4);
  });
});

describe("advanceWarnMi — heavier rigs warn earlier on downgrades", () => {
  test("standard half mile for climbs at any weight", () => {
    expect(advanceWarnMi("up", 30000)).toBe(0.5);
    expect(advanceWarnMi("up", 80000)).toBe(0.5);
  });
  test("downgrade tiers by gross weight", () => {
    expect(advanceWarnMi("down", 40000)).toBe(0.5);
    expect(advanceWarnMi("down", 59999)).toBe(0.5);
    expect(advanceWarnMi("down", 60000)).toBe(0.75);
    expect(advanceWarnMi("down", 74999)).toBe(0.75);
    expect(advanceWarnMi("down", 75000)).toBe(1.0);
    expect(advanceWarnMi("down", 120000)).toBe(1.0);
  });
});

describe("gradeAlertState", () => {
  const profile = rampProfile(2, 1.2, -6); // descent starts at ~2 mi
  const segs = buildGradeSegments(profile);
  const seg = segs[0]!;

  test("nothing far out, nothing without segments", () => {
    expect(gradeAlertState(segs, profile, 0.5, 40000)).toBeNull();
    expect(gradeAlertState([], profile, 1.9, 40000)).toBeNull();
    expect(gradeAlertState(segs, null, seg.startMi - 0.4, 40000)?.phase).toBe("approach");
  });

  test("approach fires inside the advance distance", () => {
    const st = gradeAlertState(segs, profile, seg.startMi - 0.4, 40000);
    expect(st?.phase).toBe("approach");
    expect(st?.segment.id).toBe(seg.id);
    expect(st?.distToStartMi).toBeCloseTo(0.4, 1);
    expect(st?.livePct).toBeNull();
  });

  test("a heavy rig gets the approach call earlier than a light one", () => {
    const at = seg.startMi - 0.9;
    expect(gradeAlertState(segs, profile, at, 40000)).toBeNull(); // 0.5 mi window
    expect(gradeAlertState(segs, profile, at, 80000)?.phase).toBe("approach"); // 1.0 mi window
  });

  test("crest at the top, then on — with a live grade while descending", () => {
    expect(gradeAlertState(segs, profile, seg.startMi + 0.05, 40000)?.phase).toBe("crest");
    const on = gradeAlertState(segs, profile, seg.startMi + 0.6, 40000);
    expect(on?.phase).toBe("on");
    expect(on?.livePct).not.toBeNull();
    expect(on!.livePct!).toBeLessThan(-4);
  });

  test("past the segment, nothing fires again", () => {
    expect(gradeAlertState(segs, profile, seg.endMi + 0.5, 40000)).toBeNull();
  });
});

describe("wording", () => {
  const down = buildGradeSegments(rampProfile(1, 1.2, -6))[0]!;
  const up = buildGradeSegments(rampProfile(1, 2, 5))[0]!;

  test("headlines read like the road signs", () => {
    expect(gradeHeadline(down)).toMatch(/^DOWNGRADE — 6% FOR 1\.\d MI$/);
    expect(gradeHeadline(up)).toMatch(/^CLIMB — 5% FOR [12]\.\d MI$/);
  });

  test("downgrade speech carries gear-down + brake-check on approach", () => {
    const s = gradeSpoken(down, "approach");
    expect(s).toContain("Downgrade ahead");
    expect(s).toContain("Gear down and check your brakes");
    expect(gradeSpoken(down, "crest")).toContain("Downgrade.");
    expect(gradeSpoken(up, "approach")).toContain("Climb ahead");
  });
});
