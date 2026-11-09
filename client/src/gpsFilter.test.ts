// Unit tests for the GPS fix filter (client/src/gpsFilter.ts) — the
// production gate every watchPosition fix passes through. Synthetic
// streams stand in for a live signal (the build sandbox has no GPS):
// standstill jitter, teleports, coarse fixes, gap-resume, speed spikes.
// Run: bun test client/src/gpsFilter.test.ts

import { describe, expect, test } from "bun:test";
import { createGpsFixFilter, type RawFix } from "./gpsFilter";

// Base point: Theodore, AL.
const BASE = { lat: 30.551, lon: -88.1687 };
const M_PER_DEG_LAT = 111189;
const M_PER_DEG_LON = 111189 * Math.cos((BASE.lat * Math.PI) / 180);

function fix(
  eastM: number,
  northM: number,
  timestampMs: number,
  opts: { accuracyM?: number | null; speedMps?: number | null } = {},
): RawFix {
  return {
    lat: BASE.lat + northM / M_PER_DEG_LAT,
    lon: BASE.lon + eastM / M_PER_DEG_LON,
    accuracyM: opts.accuracyM === undefined ? 10 : opts.accuracyM,
    speedMps: opts.speedMps === undefined ? null : opts.speedMps,
    timestampMs,
  };
}

const T0 = 1_700_000_000_000;

describe("accuracy gating", () => {
  test("coarse fixes never move the position or add distance; a good fix recovers", () => {
    const f = createGpsFixFilter();
    const good = f.push(fix(0, 0, T0, { accuracyM: 8 }));
    expect(good.accepted).toBe(true);

    let weakSeen = false;
    for (let i = 1; i <= 6; i++) {
      // Coarse fixes claiming the truck is 300 m away.
      const r = f.push(fix(300, 0, T0 + i * 5000, { accuracyM: 200 }));
      expect(r.accepted).toBe(false);
      expect(r.rejection).toBe("accuracy");
      expect(r.segmentMiles).toBe(0);
      expect(r.position?.lat).toBeCloseTo(BASE.lat, 6);
      if (r.weakSignal) weakSeen = true;
    }
    expect(weakSeen).toBe(true);

    const back = f.push(fix(2, 0, T0 + 35000, { accuracyM: 9 }));
    expect(back.accepted).toBe(true);
    expect(back.weakSignal).toBe(false);
  });

  test("a fix with no accuracy reported is treated as coarse", () => {
    const f = createGpsFixFilter();
    const r = f.push(fix(0, 0, T0, { accuracyM: null }));
    expect(r.accepted).toBe(false);
    expect(r.rejection).toBe("accuracy");
    expect(r.position).toBeNull();
  });

  test("fuzzy-but-honest fixes are not mistaken for teleports (accuracy slack)", () => {
    const f = createGpsFixFilter();
    expect(f.push(fix(0, 0, T0, { accuracyM: 65 })).accepted).toBe(true);
    // 100 m away 5 s later: raw implied speed ~45 mph, but the two
    // 65 m accuracy radii cover the whole distance — must accept.
    const r = f.push(fix(100, 0, T0 + 5000, { accuracyM: 65 }));
    expect(r.accepted).toBe(true);
  });
});

describe("teleport rejection", () => {
  test("a single 5-mile teleport adds no distance and does not move the track", () => {
    const f = createGpsFixFilter();
    f.push(fix(0, 0, T0));
    const jump = f.push(fix(8047, 0, T0 + 5000)); // 5 mi east, 5 s later
    expect(jump.accepted).toBe(false);
    expect(jump.rejection).toBe("jump");
    expect(jump.segmentMiles).toBe(0);
    expect(jump.position?.lon).toBeCloseTo(BASE.lon, 6);

    // Sane fixes resume: accepted again, still no phantom distance.
    const back = f.push(fix(3, 0, T0 + 10000));
    expect(back.accepted).toBe(true);
    expect(back.segmentMiles).toBe(0);
  });

  test("an out-of-order timestamp far from the last fix is rejected", () => {
    const f = createGpsFixFilter();
    f.push(fix(0, 0, T0 + 60000));
    const stale = f.push(fix(500, 0, T0)); // earlier clock, 500 m away
    expect(stale.accepted).toBe(false);
    expect(stale.rejection).toBe("time");
  });
});

describe("distance integrity", () => {
  test("standstill jitter for 10 minutes adds exactly zero miles", () => {
    const f = createGpsFixFilter();
    // Worst-case bounded jitter: fixes bounce between two points 36 m
    // apart (a wide jitter cloud for ±10 m accuracy) every 5 s.
    let total = 0;
    for (let i = 0; i <= 120; i++) {
      const east = i % 2 === 0 ? -18 : 18;
      const north = i % 3 === 0 ? 6 : -6;
      const r = f.push(fix(east, north, T0 + i * 5000, { accuracyM: 12, speedMps: 0 }));
      expect(r.accepted).toBe(true);
      total += r.segmentMiles;
    }
    expect(total).toBe(0);
  });

  test("a steady highway stream accumulates distance within tolerance", () => {
    const f = createGpsFixFilter();
    // 60 mph due east = 26.82 m/s, one fix per second for 60 s = 1.00 mi.
    let total = 0;
    for (let i = 0; i <= 60; i++) {
      const r = f.push(fix(26.82 * i, 0, T0 + i * 1000, { speedMps: 26.82 }));
      total += r.segmentMiles;
    }
    expect(total).toBeGreaterThan(0.97);
    expect(total).toBeLessThan(1.0);
  });

  test("gap-resume: the first fix after a long silence reports the elapsed time and re-anchors", () => {
    const f = createGpsFixFilter();
    // Rolling at 60 mph for 10 s.
    for (let i = 0; i <= 10; i++) {
      f.push(fix(26.82 * i, 0, T0 + i * 1000, { speedMps: 26.82 }));
    }
    // 5 minutes of silence (app backgrounded / signal lost), then a
    // fix 5 miles further along — consistent with having kept driving.
    const resume = f.push(fix(26.82 * 10 + 8047, 0, T0 + 10000 + 300000, { speedMps: 26.82 }));
    expect(resume.accepted).toBe(true);
    // The caller (trip tracker) sees the 300 s hole and declines to
    // count the bracketing segment — the gap is marked, never filled.
    expect(resume.msSincePrevAccepted).toBe(300000);
  });
});

describe("speed smoothing", () => {
  test("a single noisy speed spike does not move the smoothed speed", () => {
    const f = createGpsFixFilter();
    const mph = (mps: number) => mps * 2.23694;
    let smoothed: number | null = null;
    // 30 mph steady, one fix claiming 118 mph, then back to 30.
    const speeds = [13.41, 13.41, 13.41, 13.41, 52.8, 13.41, 13.41];
    speeds.forEach((mps, i) => {
      const r = f.push(fix(13.41 * i * 2, 0, T0 + i * 2000, { speedMps: mps }));
      smoothed = r.speedMph;
      expect(r.speedMph).not.toBeNull();
      expect(Math.abs((r.speedMph as number) - mph(13.41))).toBeLessThan(3);
    });
    expect(smoothed).not.toBeNull();
  });

  test("speed derives from credited movement when fixes carry no speed", () => {
    const f = createGpsFixFilter();
    // 30 mph = 13.41 m/s, fix every 2 s, speedMps always null.
    let smoothed: number | null = null;
    for (let i = 0; i <= 15; i++) {
      const r = f.push(fix(13.41 * i * 2, 0, T0 + i * 2000, { speedMps: null }));
      if (r.speedMph != null) smoothed = r.speedMph;
    }
    expect(smoothed).not.toBeNull();
    expect(smoothed as number).toBeGreaterThan(25);
    expect(smoothed as number).toBeLessThan(35);
  });

  test("a parked truck with no platform speed reads 0 mph, not unknown", () => {
    const f = createGpsFixFilter();
    // Parked jitter stream, speedMps always null (the iOS-at-a-
    // standstill shape): position is live, so speed must resolve to 0
    // once stillness is proven — never stay null.
    let last: ReturnType<typeof f.push> | null = null;
    for (let i = 0; i <= 12; i++) {
      const east = i % 2 === 0 ? -9 : 9;
      last = f.push(fix(east, 3, T0 + i * 3000, { accuracyM: 12, speedMps: null }));
      expect(last.accepted).toBe(true);
      expect(last.segmentMiles).toBe(0);
    }
    expect(last?.speedMph).toBe(0);
  });

  test("the first accepted fix anchors with zero distance", () => {
    const f = createGpsFixFilter();
    const r = f.push(fix(0, 0, T0));
    expect(r.accepted).toBe(true);
    expect(r.segmentMiles).toBe(0);
    expect(r.msSincePrevAccepted).toBeNull();
    expect(r.position?.lat).toBeCloseTo(BASE.lat, 6);
  });
});

describe("display position — road test #3: marker off the side of the road", () => {
  const eastNorthOf = (p: { lat: number; lon: number } | null) => ({
    eastM: p ? (p.lon - BASE.lon) * M_PER_DEG_LON : NaN,
    northM: p ? (p.lat - BASE.lat) * M_PER_DEG_LAT : NaN,
  });

  test("parked: the marker sits on the anchor, not on the jitter cloud", () => {
    const f = createGpsFixFilter();
    let last: ReturnType<typeof f.push> | null = null;
    for (let i = 0; i <= 40; i++) {
      const east = i % 2 === 0 ? -18 : 18;
      const north = i % 3 === 0 ? 6 : -6;
      last = f.push(fix(east, north, T0 + i * 3000, { accuracyM: 12, speedMps: 0 }));
      // The RAW position keeps bouncing with the fixes (records use it)…
      expect(Math.abs(eastNorthOf(last.position).eastM)).toBeGreaterThan(10);
      // …while the display position stays pinned at the first fix.
      const d = eastNorthOf(last.displayPosition);
      expect(Math.abs(d.eastM - -18)).toBeLessThan(1);
      expect(Math.abs(d.northM - 6)).toBeLessThan(1);
    }
    expect(last?.displayPosition).not.toBeNull();
  });

  test("rolling: the display trails the raw fix by metres, not by the scatter width", () => {
    const f = createGpsFixFilter();
    // 60 mph east, one fix per second, alternating ±14 m of lateral
    // scatter — raw markers would weave 28 m across the road.
    let last: ReturnType<typeof f.push> | null = null;
    for (let i = 0; i <= 40; i++) {
      const north = i % 2 === 0 ? 14 : -14;
      last = f.push(fix(26.82 * i, north, T0 + i * 1000, { speedMps: 26.82 }));
    }
    const d = eastNorthOf(last?.displayPosition ?? null);
    const rawEast = 26.82 * 40;
    // Longitudinal lag from the blend is small (< 25 m)…
    expect(rawEast - d.eastM).toBeGreaterThan(-1);
    expect(rawEast - d.eastM).toBeLessThan(25);
    // …and the lateral weave is damped well under the raw ±14 m.
    expect(Math.abs(d.northM)).toBeLessThan(8);
    // The recorded position is untouched by the smoothing.
    expect(Math.abs(eastNorthOf(last?.position ?? null).northM)).toBeCloseTo(14, 3);
  });

  test("a rejected fix holds the display position exactly", () => {
    const f = createGpsFixFilter();
    f.push(fix(0, 0, T0));
    const good = f.push(fix(30, 0, T0 + 2000, { speedMps: 15 }));
    const bad = f.push(fix(400, 0, T0 + 4000, { accuracyM: 200 }));
    expect(bad.accepted).toBe(false);
    expect(bad.displayPosition?.lat).toBe(good.displayPosition?.lat);
    expect(bad.displayPosition?.lon).toBe(good.displayPosition?.lon);
  });
});
