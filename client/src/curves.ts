// Sharp curve / rollover alerts (migration 0107, x's order
// 2026-11-08: "Build all five").
//
// Pure and framework-free (no DOM, no React), like hillGrade.ts, so
// the exact production math is unit-testable (see curves.test.ts).
//
// Curve severity is computed OFFLINE from the route's own stored
// geometry — the shape points planRoute already keeps on-device.
// No feed, no guess: the heading change of the road itself over a
// short window gives the curve's radius; the radius gives an
// advisory speed from the standard curve formula at a conservative
// truck lateral-acceleration line. The advisory is then compared
// against the driver's LIVE speed and the truck profile: a tall or
// heavy rig (high center of gravity, more rollover energy) gets a
// lower advisory and an earlier, stronger call. A curve the rig is
// already slow enough for never warns — crying wolf on every bend
// would train drivers to ignore the one that matters.

/** Resample step along the route (miles). */
const STEP_MI = 0.02;
/** Heading-change window: total turn measured across ±this (miles). */
const WINDOW_MI = 0.07;
/** A window turn at or over this (degrees) is a real curve, not
 *  shape-point jitter or a gentle sweep. */
export const CURVE_MIN_TURN_DEG = 20;
/** Conservative lateral acceleration for a loaded truck (fraction
 *  of g) behind the advisory speed — well under the passenger-car
 *  design line; rollover, not tire grip, is the truck limit. */
const TRUCK_LATERAL_G = 0.2;
/** Advisory speeds display rounded DOWN to a multiple of 5, capped
 *  so a gentle highway sweep never shows a silly number. */
export const CURVE_ADVISORY_CAP_MPH = 65;
/** Base advance-call distance before a tight curve. */
export const CURVE_WARN_BASE_MI = 0.3;
/** Advance-call distance for a tall/heavy rig — earlier, per the
 *  brief ("a tall, heavy rig gets the warning earlier"). */
export const CURVE_WARN_TALL_HEAVY_MI = 0.5;
/** Live speed must beat the advisory by more than this to warn. */
export const CURVE_SPEED_MARGIN_MPH = 3;
/** Speed over the advisory at or beyond this = STRONG call. */
export const CURVE_STRONG_OVER_MPH = 15;

const M_PER_MI = 1609.344;

function haversineMi(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 3958.8;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function bearingDeg(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const y = Math.sin(((bLon - aLon) * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180);
  const x =
    Math.cos((aLat * Math.PI) / 180) * Math.sin((bLat * Math.PI) / 180) -
    Math.sin((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.cos(((bLon - aLon) * Math.PI) / 180);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Signed smallest turn from heading a to heading b, degrees. */
function turnDeg(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

export interface RouteCurve {
  /** Stable within one route's curve list (index order). */
  id: number;
  /** Along-route miles where the curve's tight window sits. */
  atMi: number;
  /** Total heading change across the curve, degrees (absolute). */
  turnTotalDeg: number;
  /** Tightest radius inside the curve, meters. */
  radiusM: number;
  /** Advisory speed for a standard rig, mph (rounded down to 5). */
  advisoryMph: number;
  direction: "left" | "right";
}

/** Advisory speed (mph) for a curve radius at the truck lateral
 *  line: v = sqrt(g · 0.20 · R), rounded down to a multiple of 5
 *  and capped. */
export function advisoryMphForRadius(radiusM: number): number {
  if (!(radiusM > 0) || !Number.isFinite(radiusM)) return CURVE_ADVISORY_CAP_MPH;
  const vMs = Math.sqrt(9.81 * TRUCK_LATERAL_G * radiusM);
  const mph = vMs * 2.23694;
  return Math.max(5, Math.min(CURVE_ADVISORY_CAP_MPH, Math.floor(mph / 5) * 5));
}

interface Sample {
  lat: number;
  lon: number;
  alongMi: number;
  headingDeg: number;
}

/** Resample a route polyline to an even STEP_MI ladder with a
 *  heading per sample (heading of the step LEAVING the sample). */
function resample(coords: [number, number][]): Sample[] {
  const pts: { lat: number; lon: number; alongMi: number }[] = [];
  let acc = 0;
  for (let i = 0; i < coords.length; i++) {
    const c = coords[i]!;
    if (i > 0) {
      const p = coords[i - 1]!;
      acc += haversineMi(p[0], p[1], c[0], c[1]);
    }
    pts.push({ lat: c[0], lon: c[1], alongMi: acc });
  }
  if (pts.length < 2) return [];
  const total = acc;
  const out: Sample[] = [];
  let seg = 0;
  for (let d = 0; d <= total; d += STEP_MI) {
    while (seg < pts.length - 2 && pts[seg + 1]!.alongMi < d) seg++;
    const a = pts[seg]!;
    const b = pts[seg + 1]!;
    const span = b.alongMi - a.alongMi;
    const frac = span > 0 ? Math.max(0, Math.min(1, (d - a.alongMi) / span)) : 0;
    const lat = a.lat + (b.lat - a.lat) * frac;
    const lon = a.lon + (b.lon - a.lon) * frac;
    const prev = out[out.length - 1];
    out.push({ lat, lon, alongMi: d, headingDeg: prev ? bearingDeg(prev.lat, prev.lon, lat, lon) : 0 });
  }
  // First sample's heading = the second's (no step enters it).
  if (out.length > 1) out[0]!.headingDeg = out[1]!.headingDeg;
  return out;
}

/**
 * Find the sharp curves on a route from its stored geometry.
 * Windows whose total heading change reaches CURVE_MIN_TURN_DEG
 * cluster into curves; each curve keeps its TIGHTEST window radius
 * (the worst point governs the advisory). Gentle sweeps whose
 * advisory lands at the cap are dropped — they are not rollover
 * events at any legal truck speed.
 */
export function buildCurves(coords: [number, number][] | null | undefined): RouteCurve[] {
  if (!coords || coords.length < 3) return [];
  const samples = resample(coords);
  if (samples.length < 5) return [];
  // Detection window: total turn across ±WINDOW_MI decides a curve
  // exists. The RADIUS comes from the tightest honest estimate
  // across several window sizes — a fixed long window over a short
  // arc saturates (the turn stops growing once the window swallows
  // the whole arc, and the radius reads fatally gentle), so each
  // sample prices itself by the smallest window that still turns
  // meaningfully, and the cluster keeps its worst (smallest) one.
  const winSteps = Math.max(1, Math.round(WINDOW_MI / STEP_MI));
  const radiusSteps = [2, 4, 7];
  interface Win {
    turn: number;
    radiusM: number;
  }
  const wins: Win[] = samples.map((_s, i) => {
    const lo = samples[Math.max(0, i - winSteps)]!;
    const hi = samples[Math.min(samples.length - 1, i + winSteps)]!;
    const turn = turnDeg(lo.headingDeg, hi.headingDeg);
    let radiusM = Infinity;
    for (const rs of radiusSteps) {
      const a = samples[Math.max(0, i - rs)]!;
      const b = samples[Math.min(samples.length - 1, i + rs)]!;
      const t = Math.abs(turnDeg(a.headingDeg, b.headingDeg));
      const arcMi = b.alongMi - a.alongMi;
      if (t >= 10 && arcMi > 0) {
        radiusM = Math.min(radiusM, (arcMi * M_PER_MI) / ((t * Math.PI) / 180));
      }
    }
    return { turn, radiusM };
  });
  const curves: RouteCurve[] = [];
  let i = 0;
  while (i < samples.length) {
    if (Math.abs(wins[i]!.turn) < CURVE_MIN_TURN_DEG) {
      i++;
      continue;
    }
    // Cluster: consecutive samples over the turn line, same sign.
    const sign = Math.sign(wins[i]!.turn);
    let j = i;
    let minRadius = Infinity;
    let peakIdx = i;
    while (j < samples.length && Math.abs(wins[j]!.turn) >= CURVE_MIN_TURN_DEG && Math.sign(wins[j]!.turn) === sign) {
      if (wins[j]!.radiusM < minRadius) {
        minRadius = wins[j]!.radiusM;
        peakIdx = j;
      }
      j++;
    }
    const advisory = advisoryMphForRadius(minRadius);
    if (advisory < CURVE_ADVISORY_CAP_MPH) {
      const from = samples[i]!;
      const to = samples[Math.min(samples.length - 1, j - 1)]!;
      curves.push({
        id: curves.length,
        atMi: samples[peakIdx]!.alongMi,
        turnTotalDeg: Math.abs(turnDeg(from.headingDeg, to.headingDeg)),
        radiusM: Math.round(minRadius),
        advisoryMph: advisory,
        direction: sign > 0 ? "right" : "left",
      });
    }
    i = Math.max(j, i + 1);
  }
  return curves;
}

export interface RigProfile {
  /** Total rig height, inches (truck profile / loaded height). */
  heightIn: number;
  /** Gross weight, lbs. */
  weightLbs: number;
}

/** A tall rig (13 ft and up) or a heavy one (65,000 lbs and up)
 *  rolls sooner: the advisory drops and the call comes earlier. */
export function isTallOrHeavy(rig: RigProfile): boolean {
  return rig.heightIn >= 13 * 12 || rig.weightLbs >= 65000;
}

/** The advisory for THIS rig: the geometry advisory, less 5 mph
 *  for a tall/heavy rig (never below 5). */
export function rigAdvisoryMph(curve: RouteCurve, rig: RigProfile): number {
  return isTallOrHeavy(rig) ? Math.max(5, curve.advisoryMph - 5) : curve.advisoryMph;
}

/** How far ahead the curve call fires for this rig. */
export function curveWarnMi(rig: RigProfile): number {
  return isTallOrHeavy(rig) ? CURVE_WARN_TALL_HEAVY_MI : CURVE_WARN_BASE_MI;
}

export interface CurveAlertState {
  curve: RouteCurve;
  distAheadMi: number;
  /** The advisory for this rig, mph. */
  advisoryMph: number;
  /** The driver's live speed, mph. */
  speedMph: number;
  /** Speed beats the advisory by the strong line. */
  strong: boolean;
}

/**
 * The curve situation ahead: the nearest curve inside the warn
 * distance whose rig advisory the driver's live speed actually
 * beats (by the margin) — or null. Slow enough = silent, always.
 * No known speed (null) = silent: the call is a speed comparison,
 * and it is never made without the speed.
 */
export function curveAlertState(
  curves: RouteCurve[],
  progressMi: number,
  speedMph: number | null,
  rig: RigProfile,
): CurveAlertState | null {
  if (!Number.isFinite(progressMi) || speedMph == null || !Number.isFinite(speedMph)) return null;
  const warnMi = curveWarnMi(rig);
  for (const c of curves) {
    const dist = c.atMi - progressMi;
    if (dist < -0.05) continue;
    if (dist > warnMi) return null; // curves are in route order
    const advisory = rigAdvisoryMph(c, rig);
    if (speedMph > advisory + CURVE_SPEED_MARGIN_MPH) {
      return { curve: c, distAheadMi: Math.max(0, dist), advisoryMph: advisory, speedMph, strong: speedMph - advisory >= CURVE_STRONG_OVER_MPH };
    }
    return null; // nearest curve is fine at this speed — later ones are farther
  }
  return null;
}

/** The banner headline: "SHARP CURVE AHEAD — ADVISORY 35". */
export function curveHeadline(state: CurveAlertState): string {
  return `SHARP CURVE AHEAD — ADVISORY ${state.advisoryMph}`;
}

/** The spoken call — the brief's own shape, live speed named. */
export function curveSpoken(state: CurveAlertState): string {
  return `Sharp curve ahead. Advisory ${state.advisoryMph}. You are at ${Math.round(state.speedMph)}. Slow down.`;
}
