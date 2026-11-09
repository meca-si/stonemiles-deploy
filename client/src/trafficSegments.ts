// Traffic segments — pure logic (no DOM, no React), like
// routeGeometry.ts, so the exact production math is unit-testable
// (see trafficSegments.test.ts).
//
// Why this module exists (driver report, 2026-10-27): "traffic lines
// doesn't appear like slow or traffic jam heavy traffic like my
// apple map show." The app HAD live TomTom traffic the whole time —
// but only as text notes under route cards ("+12 min traffic"). The
// route LINE itself was always one solid navigation blue, so slow
// and stopped stretches were invisible on the map. Apple Maps (the
// driver's reference screenshot) paints the route line itself:
// blue where it flows, orange where it's slow, red where it's heavy.
//
// This module turns the two live TomTom signals the server returns
// for a route into colored sub-lines that sit exactly on the route:
//
//   FLOW — current vs free-flow speed sampled at points along the
//   route: ratio >= 0.85 flows (no overlay — the blue shows),
//   0.55–0.85 is SLOW (orange), under 0.55 is HEAVY (red).
//
//   INCIDENTS — TomTom incidents near the route, with their real
//   geometry. Each is projected onto the route line; the route
//   stretch it covers is colored by severity: magnitude >= 3 or a
//   reported delay >= 15 min (or a road closure) is HEAVY, magnitude
//   2 or delay >= 5 min is SLOW. Incidents win over flow on the same
//   stretch, and HEAVY wins over SLOW where segments overlap.
//
// Nothing here invents traffic: a segment is emitted only from a
// measured flow ratio or a reported incident. No data → no segments
// → the plain blue route, exactly as before.
//
// Road test #4 (2026-10-30) — "it's showing slow traffic and it was
// clear": the painting itself was honest about the sample and dishonest
// about the STRETCH. Only 4 flow samples serve a whole route, and the
// old builder colored the entire span between neighbouring samples
// (plus the head and tail of the route) with the slower end's ratio —
// one marginal reading smeared orange across miles of clear road.
// Incidents were likewise admitted from up to 0.75 mi off the line,
// so trouble on a parallel road (the interstate beside the service
// road the truck was actually on) painted onto this route. Now:
//   - a flow sample paints only a bounded window around the point it
//     actually measured (FLOW_PAINT_RADIUS_MI each way); two
//     neighbouring congested samples bridge the gap between their
//     windows, because two measurements agreeing is a stretch, not
//     a smear — a free-flow sample between them blocks the bridge;
//   - an incident paints only when its geometry actually lies on
//     this route's line (TRAFFIC_INCIDENT_MAX_OFF_MI — geometry-to-
//     geometry distance between two map centrelines, so the tight
//     cap is right in a way a GPS fix's 65 m fuzz never would be).
//
// Road test #5 (2026-11-01) — "still shows heavy traffic when
// light": even bounded, ONE TomTom reading could still paint red —
// a single marginal flow sample or a single incident report was
// taken at its word. HEAVY now requires corroboration: a second
// signal agreeing near the same stretch (a neighbouring congested
// sample, a flow reading inside an incident's stretch, another
// incident, or an incident extreme enough to stand alone — a
// closure, a ≥30 min delay, top magnitude with a real delay). A
// lone heavy paints SLOW over a short window instead: the warning
// survives, the false certainty doesn't.

import { projectOntoRoute } from "./routeGeometry";

export type CongestionLevel = "slow" | "heavy";

export type TrafficFlowSample = {
  /** Position along the route, 0..1 (fraction of the coord list's
   *  haversine length — callers compute it from coord indices, which
   *  track length closely on a decoded route shape). */
  frac: number;
  /** currentSpeed / freeFlowSpeed at the sample, 0..~1. Null when
   *  TomTom gave no usable flow at that point. */
  ratio: number | null;
};

export type TrafficIncidentGeom = {
  coords: [number, number][];
  magnitude: number; // TomTom magnitudeOfDelay 0..4
  delayMin: number;
  category: number; // TomTom iconCategory; 8 = road closed
};

export type TrafficSegment = {
  coords: [number, number][];
  level: CongestionLevel;
  color: string;
};

export const TRAFFIC_COLORS: Record<CongestionLevel, string> = {
  slow: "#f59e0b", // Apple-style orange for slow
  heavy: "#e02424", // Apple-style red for heavy / stopped
};

/** How far (mi) either side of its sample point a flow reading may
 *  paint. A sample is a measurement AT a point; 1.25 mi of reach is
 *  already generous for the stretch it evidences, and it caps one
 *  bad reading at ~2.5 painted miles no matter how sparse the
 *  samples are (road test #4). */
export const FLOW_PAINT_RADIUS_MI = 1.25;

/** Paint radius (mi) for an UNCORROBORATED flow reading (road test
 *  #5 calibration, 2026-11-01 — "still shows heavy traffic when
 *  light", 10:20 PM on the I-65 service road): a lone reading with
 *  no agreeing neighbour and no incident anywhere near it is one
 *  sample's opinion — it paints a short stretch around the point it
 *  measured, and (see buildTrafficSegments) a lone HEAVY reading is
 *  downgraded to SLOW. Red is a claim the app makes to a driver;
 *  it now takes two signals agreeing, or one extreme incident, to
 *  make it. */
export const FLOW_LONE_PAINT_RADIUS_MI = 0.6;

/** An incident's geometry must lie within this distance (mi) of the
 *  route line to paint it — ~56 m, the width of a divided highway
 *  corridor. The old 0.75 mi admitted incidents on parallel roads
 *  wholesale (road test #4). */
export const TRAFFIC_INCIDENT_MAX_OFF_MI = 0.035;

/** Route length (mi) by the same haversine chain the app uses for
 *  route totals — flow windows are sized in miles, then converted
 *  to the coord-index fraction space the painter works in. */
function routeLengthMi(coords: [number, number][]): number {
  let mi = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]!;
    const b = coords[i]!;
    const dLat = ((b[0] - a[0]) * Math.PI) / 180;
    const dLon = ((b[1] - a[1]) * Math.PI) / 180;
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    mi += 2 * 3958.8 * Math.asin(Math.sqrt(s));
  }
  return mi;
}

export function congestionFromRatio(ratio: number | null): CongestionLevel | null {
  if (ratio == null || !Number.isFinite(ratio)) return null;
  if (ratio < 0.55) return "heavy";
  if (ratio < 0.85) return "slow";
  return null;
}

export function congestionFromIncident(inc: TrafficIncidentGeom): CongestionLevel | null {
  if (inc.category === 8) return "heavy";
  if (inc.magnitude >= 3 || inc.delayMin >= 15) return "heavy";
  if (inc.magnitude >= 2 || inc.delayMin >= 5) return "slow";
  if (inc.magnitude >= 1 && inc.delayMin > 0) return "slow";
  return null;
}

/** Slice the coord list between two fractions (by index, which on a
 *  decoded route shape tracks distance well enough for a colored
 *  overlay), always returning at least 2 points when the route has
 *  them. */
function sliceByFrac(coords: [number, number][], fromFrac: number, toFrac: number): [number, number][] {
  const n = coords.length;
  if (n < 2) return [];
  const a = Math.max(0, Math.min(n - 2, Math.floor(fromFrac * (n - 1))));
  const b = Math.max(1, Math.min(n - 1, Math.ceil(toFrac * (n - 1))));
  if (b <= a) return [];
  return coords.slice(a, b + 1);
}

type RawSeg = { from: number; to: number; level: CongestionLevel };

/** Build the colored traffic sub-lines for one route. Fractions are
 *  coord-index fractions; incident ranges are converted from true
 *  along-route miles (projectOntoRoute) into the same index space
 *  via total miles — close enough for an overlay that must sit ON
 *  the line, and the emitted coords are the route's OWN coords, so
 *  a segment can never drift off the road. */
export function buildTrafficSegments(
  coords: [number, number][],
  flow: TrafficFlowSample[],
  incidents: TrafficIncidentGeom[],
): TrafficSegment[] {
  if (coords.length < 2) return [];
  const raw: RawSeg[] = [];

  const totalMi = routeLengthMi(coords);
  const samples = [...flow]
    .filter((s) => Number.isFinite(s.frac))
    .sort((a, b) => a.frac - b.frac);
  const levels = samples.map((s) => congestionFromRatio(s.ratio));
  const radiusFrac = totalMi > 0 ? FLOW_PAINT_RADIUS_MI / totalMi : 0;
  const loneRadiusFrac = totalMi > 0 ? FLOW_LONE_PAINT_RADIUS_MI / totalMi : 0;

  // Incidents first (geometry only): project every geometry point
  // onto the route; the covered stretch is [min along, max along]
  // over the points that actually lie ON this line
  // (TRAFFIC_INCIDENT_MAX_OFF_MI — an incident on a parallel road
  // no longer paints this one), widened to at least ~0.4 mi so a
  // point incident (a crash dot) still paints a visible bite out
  // of the line, like the reference map. Levels are decided after
  // the corroboration pass below.
  type IncRange = { from: number; to: number; level: CongestionLevel; extreme: boolean };
  const incRanges: IncRange[] = [];
  for (const inc of incidents) {
    const level = congestionFromIncident(inc);
    if (!level || inc.coords.length === 0) continue;
    let minFrac = Infinity;
    let maxFrac = -Infinity;
    let incTotalMi = 0;
    for (const c of inc.coords) {
      const proj = projectOntoRoute({ lat: c[0], lon: c[1] }, coords);
      if (!Number.isFinite(proj.offMi) || proj.totalMi <= 0) continue;
      if (proj.offMi > TRAFFIC_INCIDENT_MAX_OFF_MI) continue; // not actually on this route
      incTotalMi = proj.totalMi;
      const f = proj.alongMi / proj.totalMi;
      if (f < minFrac) minFrac = f;
      if (f > maxFrac) maxFrac = f;
    }
    if (!Number.isFinite(minFrac) || incTotalMi <= 0) continue;
    const minWidthFrac = 0.4 / incTotalMi;
    if (maxFrac - minFrac < minWidthFrac) {
      const mid = (minFrac + maxFrac) / 2;
      minFrac = Math.max(0, mid - minWidthFrac / 2);
      maxFrac = Math.min(1, mid + minWidthFrac / 2);
    }
    // An incident whose own report carries two strong signals at
    // once (a closure, a ≥30 min delay, or top magnitude WITH a
    // real delay) is evidence enough to stand alone.
    const extreme = inc.category === 8 || inc.delayMin >= 30 || (inc.magnitude >= 4 && inc.delayMin >= 15);
    incRanges.push({ from: minFrac, to: maxFrac, level, extreme });
  }

  // Corroboration (road test #5): a signal is corroborated when a
  // SECOND, independent signal agrees near the same stretch — a
  // neighbouring congested flow sample, a flow sample inside an
  // incident's stretch, or another incident overlapping it.
  const overlaps = (aFrom: number, aTo: number, bFrom: number, bTo: number) => aFrom <= bTo && bFrom <= aTo;
  const flowCorroborated = samples.map((s, i) => {
    if (!levels[i]) return false;
    // A neighbouring congested sample corroborates only within the
    // bridge reach — 4 paint radii (≈5 mi), the same distance over
    // which the bridge below paints the stretch between two windows
    // as one piece of evidence. The app samples flow at ≤4 points
    // per route however long the route is, so array neighbours can
    // sit hundreds of miles apart; an unbounded neighbour check let
    // two unrelated heavy readings (different cities' rush hours)
    // corroborate EACH OTHER, and each painted full-radius red on
    // what was locally a single reading (audit repair, 2026-11-02).
    const reach = 4 * radiusFrac;
    const prev = samples[i - 1];
    const next = samples[i + 1];
    if (prev && levels[i - 1] && s.frac - prev.frac <= reach) return true;
    if (next && levels[i + 1] && next.frac - s.frac <= reach) return true;
    return incRanges.some((r) => overlaps(s.frac - radiusFrac, s.frac + radiusFrac, r.from, r.to));
  });
  const incCorroborated = incRanges.map((r, j) => {
    if (r.extreme) return true;
    const flowNear = samples.some((s, i) => levels[i] && s.frac >= r.from - radiusFrac && s.frac <= r.to + radiusFrac);
    if (flowNear) return true;
    return incRanges.some((o, k) => k !== j && overlaps(r.from, r.to, o.from, o.to));
  });

  // Flow windows (road test #4 + #5): each congested sample paints
  // a bounded window around the point it measured — never the
  // whole span to its neighbours, never the route's head or tail.
  // A CORROBORATED sample paints the full window at its measured
  // level; a LONE sample paints the short lone window, and a lone
  // HEAVY is downgraded to SLOW — one reading at 10 PM no longer
  // paints red over a road flowing freely. Two neighbouring
  // congested samples bridge the gap between their windows (two
  // agreeing measurements evidence the stretch between them); a
  // free-flow or missing neighbour blocks the bridge.
  if (samples.length > 0 && totalMi > 0) {
    for (let i = 0; i < samples.length; i++) {
      const measured = levels[i];
      if (!measured) continue;
      const s = samples[i]!;
      const corr = flowCorroborated[i]!;
      const level: CongestionLevel = measured === "heavy" && !corr ? "slow" : measured;
      const rFrac = corr ? radiusFrac : loneRadiusFrac;
      raw.push({ from: s.frac - rFrac, to: s.frac + rFrac, level });
      // Bridge to the NEXT congested sample when the gap between
      // the two windows is short (≤ the two radii again): the
      // stretch between two slow measurements is slow evidence,
      // not extrapolation. The bridged level is the lesser of the
      // two — a heavy + a slow bridge as slow, never heavier than
      // both ends measured. (Both ends are congested, so each
      // corroborates the other and the full radius applies.)
      const next = samples[i + 1];
      const nextLevel = levels[i + 1];
      if (next && nextLevel) {
        const gapFrac = next.frac - s.frac - 2 * radiusFrac;
        if (gapFrac >= 0 && gapFrac <= 2 * radiusFrac) {
          raw.push({
            from: s.frac + radiusFrac,
            to: next.frac - radiusFrac,
            level: measured === "heavy" && nextLevel === "heavy" ? "heavy" : "slow",
          });
        }
      }
    }
  }

  // Incidents paint at their measured level when corroborated (or
  // extreme); a lone, non-extreme HEAVY incident is downgraded to
  // SLOW — it still paints the warning bite, it just doesn't claim
  // red on one report's say-so.
  incRanges.forEach((r, j) => {
    const level: CongestionLevel = r.level === "heavy" && !incCorroborated[j] ? "slow" : r.level;
    raw.push({ from: r.from, to: r.to, level });
  });

  // Merge overlaps: split at every boundary into elementary
  // intervals, give each the WORST level covering it (heavy wins),
  // then coalesce neighbours with the same level.
  const clamped = raw
    .map((s) => ({ ...s, from: Math.max(0, s.from), to: Math.min(1, s.to) }))
    .filter((s) => s.to - s.from >= 0.002);
  const cuts = [...new Set([0, 1, ...clamped.flatMap((s) => [s.from, s.to])])].sort((a, b) => a - b);
  const merged: RawSeg[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const from = cuts[i]!;
    const to = cuts[i + 1]!;
    if (to - from < 0.002) continue;
    const mid = (from + to) / 2;
    let level: CongestionLevel | null = null;
    for (const s of clamped) {
      if (mid >= s.from && mid <= s.to) {
        if (s.level === "heavy") { level = "heavy"; break; }
        level = "slow";
      }
    }
    if (!level) continue;
    const last = merged[merged.length - 1];
    if (last && last.level === level && Math.abs(last.to - from) < 1e-9) last.to = to;
    else merged.push({ from, to, level });
  }

  const out: TrafficSegment[] = [];
  for (const seg of merged) {
    const slice = sliceByFrac(coords, seg.from, seg.to);
    if (slice.length >= 2) out.push({ coords: slice, level: seg.level, color: TRAFFIC_COLORS[seg.level] });
  }
  return out;
}
