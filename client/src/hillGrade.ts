// Hill grade alerts — the grade engine behind the Drive screen's
// steep-grade warnings (driver order 2026-11-08: "steep hill incline
// or steep downhill alerting with speed").
//
// Pure and framework-free (no DOM, no React), like routeGeometry.ts,
// so the exact production math is unit-testable with synthetic
// elevation profiles (see hillGrade.test.ts).
//
// DATA HONESTY — the Atlas standard: the elevation comes from the
// route's OWN stored profile. planRoute asks Valhalla for elevation
// samples along the route (elevation_interval) and buildRouteOption
// stitches them onto the route option, which is also what Resume
// route restores from on-device storage — so grades work fully
// OFFLINE once a route is planned. Where a route carries NO
// elevation (the routing answer had none), every function here
// answers "no grade" and the UI shows nothing — a grade is never
// guessed, interpolated from a map, or invented.

/** Elevation sampled along a route: heights in METERS at a fixed
 *  along-route step (miles). Index i sits at i * stepMi. */
export interface ElevProfile {
  stepMi: number;
  samplesM: number[];
}

export type GradeDirection = "down" | "up";

export interface GradeSegment {
  /** Stable within one route's segment list (index order). */
  id: number;
  direction: GradeDirection;
  /** Along-route miles where the sustained grade starts / ends. */
  startMi: number;
  endMi: number;
  lengthMi: number;
  /** Mean grade over the segment, percent, always positive. */
  avgPct: number;
  /** Steepest windowed grade inside the segment, percent, positive. */
  peakPct: number;
  /** Peak at or over the strong-warning line (6%). */
  strong: boolean;
}

/** Sustained grades at or over this average percent alert. */
export const GRADE_ALERT_PCT = 4;
/** A peak at or over this percent makes the warning STRONG. */
export const GRADE_STRONG_PCT = 6;
/** A grade must hold at least this long to count as sustained —
 *  shorter pitches are ordinary rolling road, not a hill event. */
export const GRADE_MIN_LENGTH_MI = 0.3;
/** Same-direction runs split by a dip shorter than this merge back
 *  into one hill (a brief flattening on a long descent is still the
 *  same descent to the driver's brakes). */
export const GRADE_MERGE_GAP_MI = 0.2;
/** The standard advance warning distance before a grade. */
export const GRADE_ADVANCE_MI = 0.5;
/** The crest call zone: the first stretch of the segment itself. */
export const GRADE_CREST_ZONE_MI = 0.12;
/** Live readout floor: below this the road is effectively flat and
 *  the readout beside the speed bubble stays out of the way. */
export const GRADE_LIVE_MIN_PCT = 2;

const M_PER_MI = 1609.344;

/** Centered moving-average smoothing, half-window in samples. Edge
 *  samples average what's available — never padded with invented
 *  heights. */
function smooth(samples: number[], halfWin: number): number[] {
  if (halfWin <= 0 || samples.length === 0) return samples.slice();
  const out = new Array<number>(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const lo = Math.max(0, i - halfWin);
    const hi = Math.min(samples.length - 1, i + halfWin);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += samples[j]!;
    out[i] = sum / (hi - lo + 1);
  }
  return out;
}

/** Signed grade (percent) at a smoothed-sample index, measured over a
 *  window of ±halfWin samples around it. Positive = climbing. */
function windowGradePct(sm: number[], i: number, halfWin: number, stepM: number): number {
  const lo = Math.max(0, i - halfWin);
  const hi = Math.min(sm.length - 1, i + halfWin);
  const runM = (hi - lo) * stepM;
  if (runM <= 0) return 0;
  return ((sm[hi]! - sm[lo]!) / runM) * 100;
}

/**
 * Segment a route's stored elevation into sustained grades.
 *
 * Pipeline: smooth the samples (~0.2 mi window — DEM samples jitter),
 * grade every sample over a ~0.25 mi window, take runs of samples
 * whose windowed grade holds one sign at or over a 3.5% entry line
 * (hysteresis under the 4% alert line, so a grade hovering at the
 * threshold doesn't fragment), merge same-direction runs across
 * short dips, then keep only runs at least GRADE_MIN_LENGTH_MI long
 * whose MEAN grade is at or over GRADE_ALERT_PCT. Null / empty /
 * degenerate profiles return [] — no elevation, no segments, no
 * alerts, ever.
 */
export function buildGradeSegments(profile: ElevProfile | null | undefined): GradeSegment[] {
  if (!profile || !Array.isArray(profile.samplesM) || profile.samplesM.length < 2) return [];
  const stepMi = profile.stepMi;
  if (!(stepMi > 0) || !Number.isFinite(stepMi)) return [];
  const samples = profile.samplesM;
  if (samples.some((v) => typeof v !== "number" || !Number.isFinite(v))) return [];
  const stepM = stepMi * M_PER_MI;

  const smoothHalf = Math.max(1, Math.round(0.1 / stepMi));
  const sm = smooth(samples, smoothHalf);
  const gradeHalf = Math.max(1, Math.round(0.125 / stepMi));
  const grades = sm.map((_, i) => windowGradePct(sm, i, gradeHalf, stepM));

  const ENTRY_PCT = GRADE_ALERT_PCT - 0.5;
  type Run = { dir: 1 | -1; from: number; to: number };
  const runs: Run[] = [];
  let cur: Run | null = null;
  for (let i = 0; i < grades.length; i++) {
    const g = grades[i]!;
    const dir: 1 | -1 | 0 = Math.abs(g) >= ENTRY_PCT ? (g > 0 ? 1 : -1) : 0;
    if (dir !== 0 && cur && cur.dir === dir) {
      cur.to = i;
    } else if (dir !== 0) {
      cur = { dir, from: i, to: i };
      runs.push(cur);
    } else {
      cur = null;
    }
  }

  // Merge same-direction runs across short flat/opposite dips.
  const merged: Run[] = [];
  for (const r of runs) {
    const prev = merged[merged.length - 1];
    if (prev && prev.dir === r.dir && (r.from - prev.to) * stepMi <= GRADE_MERGE_GAP_MI) {
      prev.to = r.to;
    } else {
      merged.push({ ...r });
    }
  }

  const segments: GradeSegment[] = [];
  for (const r of merged) {
    const startMi = r.from * stepMi;
    const endMi = r.to * stepMi;
    const lengthMi = endMi - startMi;
    if (lengthMi < GRADE_MIN_LENGTH_MI) continue;
    const riseM = sm[r.to]! - sm[r.from]!;
    const avgPct = Math.abs(riseM / (lengthMi * M_PER_MI)) * 100;
    if (avgPct < GRADE_ALERT_PCT) continue;
    let peakPct = 0;
    for (let i = r.from; i <= r.to; i++) peakPct = Math.max(peakPct, Math.abs(grades[i]!));
    segments.push({
      id: segments.length,
      direction: r.dir < 0 ? "down" : "up",
      startMi,
      endMi,
      lengthMi,
      avgPct,
      peakPct,
      strong: peakPct >= GRADE_STRONG_PCT,
    });
  }
  return segments;
}

/**
 * The live signed grade (percent) at an along-route position, from
 * the same smoothed profile the segments were built from. Positive =
 * climbing, negative = descending. Null when there is no elevation
 * or the position is outside the profile — the readout then shows
 * nothing rather than a stale or guessed number.
 */
export function gradeAtMi(profile: ElevProfile | null | undefined, alongMi: number): number | null {
  if (!profile || !Array.isArray(profile.samplesM) || profile.samplesM.length < 2) return null;
  const stepMi = profile.stepMi;
  if (!(stepMi > 0) || !Number.isFinite(stepMi) || !Number.isFinite(alongMi)) return null;
  const samples = profile.samplesM;
  if (samples.some((v) => typeof v !== "number" || !Number.isFinite(v))) return null;
  const totalMi = (samples.length - 1) * stepMi;
  if (alongMi < 0 || alongMi > totalMi) return null;
  const sm = smooth(samples, Math.max(1, Math.round(0.1 / stepMi)));
  const idx = Math.round(alongMi / stepMi);
  return windowGradePct(sm, idx, Math.max(1, Math.round(0.125 / stepMi)), stepMi * M_PER_MI);
}

/**
 * How far ahead of a grade the advance warning fires. Downgrades —
 * the safety-critical side — warn EARLIER the heavier the rig: brake
 * fade and runaway risk scale with gross weight, so a heavy truck
 * gets its gear-down call sooner. Climbs keep the standard half
 * mile at every weight (a climb costs time, not brakes).
 */
export function advanceWarnMi(direction: GradeDirection, grossWeightLbs: number): number {
  if (direction !== "down") return GRADE_ADVANCE_MI;
  if (grossWeightLbs >= 75000) return 1.0;
  if (grossWeightLbs >= 60000) return 0.75;
  return GRADE_ADVANCE_MI;
}

export type GradePhase = "approach" | "crest" | "on";

export interface GradeAlertState {
  segment: GradeSegment;
  phase: GradePhase;
  /** Miles until the grade starts — approach phase only, else 0. */
  distToStartMi: number;
  /** Signed live grade % at the truck while on the grade, else null. */
  livePct: number | null;
}

/**
 * The grade situation at an along-route position: ON a segment
 * (crest for its first stretch, then on), APPROACHING the next one
 * inside its weight-scaled warning distance, or nothing (null).
 * Segments behind the truck never re-fire.
 */
export function gradeAlertState(
  segments: GradeSegment[],
  profile: ElevProfile | null | undefined,
  alongMi: number,
  grossWeightLbs: number,
): GradeAlertState | null {
  if (!Number.isFinite(alongMi)) return null;
  for (const seg of segments) {
    if (alongMi >= seg.startMi && alongMi <= seg.endMi) {
      return {
        segment: seg,
        phase: alongMi - seg.startMi <= GRADE_CREST_ZONE_MI ? "crest" : "on",
        distToStartMi: 0,
        livePct: gradeAtMi(profile, alongMi),
      };
    }
    if (seg.startMi > alongMi) {
      const dist = seg.startMi - alongMi;
      if (dist <= advanceWarnMi(seg.direction, grossWeightLbs)) {
        return { segment: seg, phase: "approach", distToStartMi: dist, livePct: null };
      }
      return null; // segments are in route order — nothing nearer past this one
    }
  }
  return null;
}

/** Whole-percent grade for display ("6"). */
export function fmtGradePct(pct: number): string {
  return `${Math.round(pct)}`;
}

/** Segment length the way the alerts say it ("1.2"). */
export function fmtGradeLen(mi: number): string {
  return (Math.round(mi * 10) / 10).toFixed(1);
}

/** The banner headline: "DOWNGRADE — 6% FOR 1.2 MI" / "CLIMB — 5% FOR 2.0 MI". */
export function gradeHeadline(seg: GradeSegment): string {
  const word = seg.direction === "down" ? "DOWNGRADE" : "CLIMB";
  return `${word} — ${fmtGradePct(seg.avgPct)}% FOR ${fmtGradeLen(seg.lengthMi)} MI`;
}

/** The spoken line — short and plain, on the existing voice path.
 *  Downgrades carry the gear-down / brake-check prompt; the crest
 *  call repeats the numbers as the descent actually starts. */
export function gradeSpoken(seg: GradeSegment, phase: GradePhase): string {
  const pct = fmtGradePct(seg.avgPct);
  const len = fmtGradeLen(seg.lengthMi);
  if (seg.direction === "down") {
    return phase === "approach"
      ? `Downgrade ahead. ${pct} percent for ${len} miles. Gear down and check your brakes.`
      : `Downgrade. ${pct} percent for ${len} miles. Gear down.`;
  }
  return phase === "approach"
    ? `Climb ahead. ${pct} percent for ${len} miles.`
    : `Climb. ${pct} percent for ${len} miles.`;
}
