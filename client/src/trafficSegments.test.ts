// Unit tests for the traffic-segment builder (trafficSegments.ts) —
// the math that paints Apple-style orange/red congestion stretches
// onto the selected route line from live TomTom flow + incidents.
// Synthetic routes stand in for live traffic (the build sandbox has
// no TomTom route running); the production builder runs unchanged.
// Run: bun test client/src/trafficSegments.test.ts

import { describe, expect, test } from "bun:test";
import {
buildTrafficSegments,
congestionFromIncident,
congestionFromRatio,
FLOW_LONE_PAINT_RADIUS_MI,
FLOW_PAINT_RADIUS_MI,
TRAFFIC_COLORS,
TRAFFIC_INCIDENT_MAX_OFF_MI,
} from "./trafficSegments";

// A straight 100-point route heading east (~69 mi at 0.01° steps).
const ROUTE: [number, number][] = Array.from({ length: 100 }, (_, i) => [30.55, -88.17 + i * 0.01]);

describe("congestion thresholds", () => {
  test("flow ratios: free flow paints nothing, slow is orange, heavy is red", () => {
    expect(congestionFromRatio(0.95)).toBeNull();
    expect(congestionFromRatio(0.85)).toBeNull();
    expect(congestionFromRatio(0.7)).toBe("slow");
    expect(congestionFromRatio(0.4)).toBe("heavy");
    expect(congestionFromRatio(null)).toBeNull();
  });
  test("incidents: closure and big delays are heavy, moderate is slow, trivial is nothing", () => {
    expect(congestionFromIncident({ coords: ROUTE.slice(0, 2), magnitude: 0, delayMin: 0, category: 8 })).toBe("heavy");
    expect(congestionFromIncident({ coords: ROUTE.slice(0, 2), magnitude: 4, delayMin: 0, category: 6 })).toBe("heavy");
    expect(congestionFromIncident({ coords: ROUTE.slice(0, 2), magnitude: 0, delayMin: 20, category: 6 })).toBe("heavy");
    expect(congestionFromIncident({ coords: ROUTE.slice(0, 2), magnitude: 2, delayMin: 0, category: 6 })).toBe("slow");
    expect(congestionFromIncident({ coords: ROUTE.slice(0, 2), magnitude: 0, delayMin: 0, category: 0 })).toBeNull();
  });
});

describe("buildTrafficSegments", () => {
  test("no traffic data → no segments (the plain blue route stands)", () => {
    expect(buildTrafficSegments(ROUTE, [], [])).toEqual([]);
    expect(buildTrafficSegments(ROUTE, [{ frac: 0.5, ratio: 0.98 }], [])).toEqual([]);
  });

  test("a slow flow sample colors the stretch around it orange, on the route's own coords", () => {
    const segs = buildTrafficSegments(
      ROUTE,
      [
        { frac: 0.2, ratio: 0.97 },
        { frac: 0.45, ratio: 0.65 },
        { frac: 0.7, ratio: 0.96 },
        { frac: 0.92, ratio: 0.99 },
      ],
      [],
    );
    expect(segs.length).toBeGreaterThan(0);
    expect(segs.every((s) => s.level === "slow" && s.color === TRAFFIC_COLORS.slow)).toBe(true);
    // Every painted point is one of the route's own points — the
    // colored line can never drift off the road.
    const routeKeys = new Set(ROUTE.map((c) => c.join(",")));
    for (const s of segs) for (const c of s.coords) expect(routeKeys.has(c.join(","))).toBe(true);
    // The slow stretch covers the middle of the route, not the ends.
    const painted = segs.flatMap((s) => s.coords);
    expect(painted.some((c) => Math.abs(c[1] - (ROUTE[45]![1])) < 1e-9)).toBe(true);
  });

  test("a heavy incident paints red over the slow stretch — heavy wins the overlap", () => {
    const segs = buildTrafficSegments(
      ROUTE,
      [{ frac: 0.45, ratio: 0.65 }],
      [{ coords: [ROUTE[44]!, ROUTE[46]!], magnitude: 4, delayMin: 25, category: 6 }],
    );
    const heavy = segs.filter((s) => s.level === "heavy");
    expect(heavy.length).toBe(1);
    expect(heavy[0]!.color).toBe(TRAFFIC_COLORS.heavy);
    // The red bite sits at the incident, around index 45.
    const mid = heavy[0]!.coords[Math.floor(heavy[0]!.coords.length / 2)]!;
    expect(Math.abs(mid[1] - ROUTE[45]![1]) / 0.01).toBeLessThan(6);
  });

  test("an incident far off the route paints nothing", () => {
    const segs = buildTrafficSegments(
      ROUTE,
      [],
      [{ coords: [[31.5, -87.0]], magnitude: 4, delayMin: 30, category: 6 }],
    );
    expect(segs).toEqual([]);
  });

  test("road test #4: one slow flow sample paints only its measured window, not miles of clear road", () => {
    // The old builder colored the whole span between neighbouring
    // samples (here ~15 mi each way) plus head/tail with the slower
    // end's ratio. One slow sample at the route's middle may now
    // paint at most ~2× the paint radius.
    const segs = buildTrafficSegments(
      ROUTE,
      [
        { frac: 0.2, ratio: 0.97 },
        { frac: 0.45, ratio: 0.6 },
        { frac: 0.7, ratio: 0.96 },
        { frac: 0.92, ratio: 0.99 },
      ],
      [],
    );
    expect(segs.length).toBe(1);
    const paintedIdx = segs[0]!.coords.map((c) => ROUTE.findIndex((r) => r[0] === c[0] && r[1] === c[1]));
    const spanMi = (Math.max(...paintedIdx) - Math.min(...paintedIdx)) * 0.596; // ~0.596 mi per 0.01° step
    expect(spanMi).toBeLessThanOrEqual(2 * FLOW_PAINT_RADIUS_MI + 1.2); // + one coord step of slice slack
    // …and the window is centered on the sample that measured it.
    expect(Math.min(...paintedIdx)).toBeGreaterThan(30);
    expect(Math.max(...paintedIdx)).toBeLessThan(60);
  });

  test("road test #4: two neighbouring slow samples bridge — the stretch between two measurements is evidence", () => {
    const segs = buildTrafficSegments(
      ROUTE,
      [
        { frac: 0.42, ratio: 0.6 },
        { frac: 0.5, ratio: 0.62 },
      ],
      [],
    );
    const painted = segs.flatMap((s) => s.coords);
    // Index 46 sits in the gap between the two samples' own windows
    // — only the bridge between two agreeing measurements paints it.
    expect(painted.some((c) => Math.abs(c[1] - ROUTE[46]![1]) < 1e-9)).toBe(true);
  });

  test("road test #5: one lone HEAVY flow reading paints SLOW over a short window — never red on one sample's say-so", () => {
    // The 10:20 PM screenshot: one bad/marginal TomTom sample at
    // the route's middle, free flow everywhere else. Red required
    // no second opinion; now a lone heavy downgrades to orange
    // and paints only the lone window.
    const segs = buildTrafficSegments(
      ROUTE,
      [
        { frac: 0.2, ratio: 0.97 },
        { frac: 0.45, ratio: 0.35 },
        { frac: 0.7, ratio: 0.96 },
        { frac: 0.92, ratio: 0.99 },
      ],
      [],
    );
    expect(segs.length).toBe(1);
    expect(segs[0]!.level).toBe("slow");
    const paintedIdx = segs[0]!.coords.map((c) => ROUTE.findIndex((r) => r[0] === c[0] && r[1] === c[1]));
    const spanMi = (Math.max(...paintedIdx) - Math.min(...paintedIdx)) * 0.596;
    expect(spanMi).toBeLessThanOrEqual(2 * FLOW_LONE_PAINT_RADIUS_MI + 1.2);
    expect(FLOW_LONE_PAINT_RADIUS_MI).toBeLessThan(FLOW_PAINT_RADIUS_MI);
  });

  test("road test #5: two neighbouring HEAVY readings corroborate each other — red stands", () => {
    const segs = buildTrafficSegments(
      ROUTE,
      [
        { frac: 0.42, ratio: 0.35 },
        { frac: 0.5, ratio: 0.38 },
      ],
      [],
    );
    expect(segs.some((s) => s.level === "heavy")).toBe(true);
  });

  test("road test #5: a lone moderate incident paints orange, not red; a lone closure still paints red", () => {
    const moderate = buildTrafficSegments(
      ROUTE,
      [],
      [{ coords: [ROUTE[45]!], magnitude: 3, delayMin: 20, category: 6 }],
    );
    expect(moderate.length).toBe(1);
    expect(moderate[0]!.level).toBe("slow");
    const closure = buildTrafficSegments(
      ROUTE,
      [],
      [{ coords: [ROUTE[45]!], magnitude: 1, delayMin: 4, category: 8 }],
    );
    expect(closure.length).toBe(1);
    expect(closure[0]!.level).toBe("heavy");
  });

  test("audit repair: two HEAVY readings ~41 mi apart do NOT corroborate each other — each paints SLOW alone", () => {
    // The app samples flow at ≤4 points per route however long it
    // is, so array neighbours can be far apart. The old neighbour
    // check had no distance bound: these two readings — the only
    // samples, each the other's array neighbour — corroborated
    // each other and each painted full-radius red, though locally
    // each stretch had exactly ONE reading behind it.
    const segs = buildTrafficSegments(
      ROUTE,
      [
        { frac: 0.15, ratio: 0.35 },
        { frac: 0.85, ratio: 0.35 },
      ],
      [],
    );
    expect(segs.length).toBe(2);
    expect(segs.every((s) => s.level === "slow")).toBe(true);
    // …and each paints only the short lone window.
    for (const s of segs) {
      const idx = s.coords.map((c) => ROUTE.findIndex((r) => r[0] === c[0] && r[1] === c[1]));
      const spanMi = (Math.max(...idx) - Math.min(...idx)) * 0.596;
      expect(spanMi).toBeLessThanOrEqual(2 * FLOW_LONE_PAINT_RADIUS_MI + 1.2);
    }
  });

  test("corroboration: a congested flow sample inside a lone HEAVY incident's stretch makes red stand", () => {
    // Incident is heavy-level but NOT extreme (magnitude 3, 20 min
    // — stands alone only as SLOW); the slow flow reading measured
    // inside its stretch is the second signal.
    const segs = buildTrafficSegments(
      ROUTE,
      [{ frac: 0.4545, ratio: 0.65 }],
      [{ coords: [ROUTE[44]!, ROUTE[46]!], magnitude: 3, delayMin: 20, category: 6 }],
    );
    const heavy = segs.filter((s) => s.level === "heavy");
    expect(heavy.length).toBeGreaterThan(0);
    const mid = heavy[0]!.coords[Math.floor(heavy[0]!.coords.length / 2)]!;
    expect(Math.abs(mid[1] - ROUTE[45]![1]) / 0.01).toBeLessThan(6);
  });

  test("corroboration: an incident overlapping a lone HEAVY flow sample's window makes red stand", () => {
    // The flow reading is heavy and alone among samples; a SLOW
    // incident whose stretch overlaps its paint window is the
    // independent second signal.
    const segs = buildTrafficSegments(
      ROUTE,
      [{ frac: 0.4545, ratio: 0.35 }],
      [{ coords: [ROUTE[45]!], magnitude: 2, delayMin: 0, category: 6 }],
    );
    expect(segs.some((s) => s.level === "heavy")).toBe(true);
  });

  test("corroboration: two overlapping HEAVY incidents corroborate each other — red stands", () => {
    const segs = buildTrafficSegments(
      ROUTE,
      [],
      [
        { coords: [ROUTE[44]!, ROUTE[46]!], magnitude: 3, delayMin: 20, category: 6 },
        { coords: [ROUTE[45]!, ROUTE[47]!], magnitude: 3, delayMin: 20, category: 6 },
      ],
    );
    expect(segs.some((s) => s.level === "heavy")).toBe(true);
  });

  test("corroboration: a HEAVY incident with only a DISTANT congested flow sample stays SLOW", () => {
    // The heavy flow reading is ~18 mi away from the incident —
    // outside its stretch and paint window — so neither signal
    // corroborates the other and nothing paints red.
    const segs = buildTrafficSegments(
      ROUTE,
      [{ frac: 0.15, ratio: 0.35 }],
      [{ coords: [ROUTE[45]!], magnitude: 3, delayMin: 20, category: 6 }],
    );
    expect(segs.length).toBeGreaterThan(0);
    expect(segs.every((s) => s.level === "slow")).toBe(true);
  });

  test("corroboration: heavy + slow neighbours — the heavy end keeps red, the bridge between paints SLOW", () => {
    const segs = buildTrafficSegments(
      ROUTE,
      [
        { frac: 0.42, ratio: 0.35 },
        { frac: 0.5, ratio: 0.65 },
      ],
      [],
    );
    expect(segs.some((s) => s.level === "heavy")).toBe(true);
    // Index 46 sits in the bridge between the two windows — the
    // bridged level is the LESSER of the two ends, never heavier.
    const covering46 = segs.filter((s) => s.coords.some((c) => Math.abs(c[1] - ROUTE[46]![1]) < 1e-9));
    expect(covering46.length).toBeGreaterThan(0);
    expect(covering46.every((s) => s.level === "slow")).toBe(true);
  });

  test("road test #4: an incident on a parallel road ~0.2 mi over paints nothing", () => {
    // 0.2 mi north of the line — inside the OLD 0.75 mi admission,
    // far outside the geometry-to-line cap. This is the interstate
    // incident painting onto the service-road route.
    const parallel: [number, number][] = ROUTE.slice(40, 50).map(([lat, lon]) => [lat + 0.2 / 69, lon]);
    const segs = buildTrafficSegments(
      ROUTE,
      [],
      [{ coords: parallel, magnitude: 4, delayMin: 30, category: 6 }],
    );
    expect(segs).toEqual([]);
    expect(TRAFFIC_INCIDENT_MAX_OFF_MI).toBeLessThan(0.1);
  });
});
