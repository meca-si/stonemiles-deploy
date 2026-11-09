// Road learning — the app learns from its OWN mistakes and fixes
// them next time (driver order, 2026-11-01: "make it to where it
// learns and fix it own mistakes" + "add the learning layer after
// this repair").
//
// What it learns — and ONLY this:
//   1. Parallel-road stretches. When the parallel tracker proves
//      the truck was running on a different road beside the route
//      (the I-65 service-road case), the stretch is remembered by
//      place + direction. Next time the truck enters that stretch
//      on the same heading, the parallel detector's sustain bar is
//      lower — the app recognises the road it is actually on
//      sooner instead of re-learning the same lesson every drive.
//   2. Traffic truth, from the truck's OWN speed. TomTom is a
//      report; the truck's speed through a painted stretch is
//      ground truth. Flowing at highway speed through a stretch
//      painted HEAVY is a false-heavy observation for that
//      corridor; crawling through it confirms the paint. Enough
//      false-heavy observations in a corridor drop its learned
//      trust, and a HEAVY segment in a low-trust corridor is
//      downgraded to SLOW on the map — the warning survives, the
//      false certainty doesn't. Confirmations restore trust.
//
// What it NEVER does (the locked limits from the readback):
//   - It never rewrites code, thresholds globally, or any setting
//     outside the two calibrations above.
//   - It never edits sealed records, miles, pay, duty, or any
//     history. Corrections are NEW log entries, never rewrites.
//   - It is opt-in: the driver turns it on/off in Driver →
//     Road learning, can clear one stretch or delete everything,
//     and while off it records nothing and changes nothing.
//
// Storage is device-local (localStorage) on purpose: this is
// calibration for THIS phone's GPS behaviour on the corridors
// THIS driver runs — the same place map prefs and other device
// calibration already live. Nothing here is shared or uploaded.
//
// Pure and framework-free (no DOM beyond an injected storage
// handle), like routeGeometry.ts / trafficSegments.ts, so the
// exact production math is unit-testable (roadLearning.test.ts).

import { TRAFFIC_COLORS, type TrafficSegment } from "./trafficSegments";

export const ROAD_LEARNING_STORAGE_KEY = "sm-road-learning-v1";

/** Corridor cell size (degrees). ~0.0045° ≈ 500 m N–S — a stretch
 *  of parallel road or a traffic corridor segment, not a point. */
export const CELL_DEG = 0.0045;

/** Corrections log cap — the visible log stays a log, not an
 *  archive; stretch memory (the part that changes behaviour)
 *  is capped separately and survives log trimming. */
export const MAX_CORRECTIONS = 60;
export const MAX_STRETCHES = 120;

export type CorrectionKind =
  | "parallel_road"
  | "traffic_false_heavy"
  | "traffic_confirmed_heavy"
  | "traffic_false_slow";

export type CorrectionEntry = {
  id: string;
  atMs: number;
  kind: CorrectionKind;
  lat: number;
  lon: number;
  cellKey: string;
  headingBucket: number; // 0..7, or -1 when no heading was known
  detail: string;
};

export type LearnedStretch = {
  cellKey: string;
  centerLat: number;
  centerLon: number;
  headingBucket: number;
  parallelHits: number;
  falseHeavy: number;
  trueHeavy: number;
  falseSlow: number;
  firstSeenMs: number;
  lastSeenMs: number;
};

export type RoadLearningState = {
  version: 1;
  enabled: boolean;
  stretches: LearnedStretch[];
  corrections: CorrectionEntry[];
};

/** Fresh state ships DISABLED — learning is opt-in (the readback
 *  the driver approved: "Learning stays opt-in like the rest of
 *  the app's learning features"). The panel switch is the consent;
 *  until it's turned on, the layer records nothing and the
 *  calibrations run at their shipped defaults. */
export function createRoadLearningState(enabled = false): RoadLearningState {
  return { version: 1, enabled, stretches: [], corrections: [] };
}

/** Grid cell for a position — the memory's notion of "this stretch". */
export function cellKeyFor(lat: number, lon: number): string {
  const a = Math.floor(lat / CELL_DEG);
  const b = Math.floor(lon / CELL_DEG);
  return `${a}:${b}`;
}

/** 8-wind heading bucket (0 = N, 1 = NE, … 7 = NW); -1 = unknown. */
export function headingBucketFor(headingDeg: number | null | undefined): number {
  if (headingDeg == null || !Number.isFinite(headingDeg)) return -1;
  const n = ((headingDeg % 360) + 360) % 360;
  return Math.floor(((n + 22.5) % 360) / 45);
}

function bucketsNear(bucket: number): number[] {
  if (bucket < 0) return [-1, 0, 1, 2, 3, 4, 5, 6, 7];
  return [(bucket + 7) % 8, bucket, (bucket + 1) % 8];
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Validate / repair an untrusted stored value. Anything malformed
 *  falls back per-field — a corrupt cache can never produce a
 *  half-broken memory, and an unknown value means a fresh state. */
export function normalizeRoadLearningState(input: unknown): RoadLearningState {
  if (!input || typeof input !== "object") return createRoadLearningState();
  const raw = input as Partial<RoadLearningState>;
  const stretches: LearnedStretch[] = [];
  if (Array.isArray(raw.stretches)) {
    for (const s of raw.stretches as LearnedStretch[]) {
      if (!s || typeof s.cellKey !== "string" || !isNum(s.centerLat) || !isNum(s.centerLon)) continue;
      stretches.push({
        cellKey: s.cellKey,
        centerLat: s.centerLat,
        centerLon: s.centerLon,
        headingBucket: isNum(s.headingBucket) ? Math.max(-1, Math.min(7, Math.floor(s.headingBucket))) : -1,
        parallelHits: isNum(s.parallelHits) ? Math.max(0, Math.floor(s.parallelHits)) : 0,
        falseHeavy: isNum(s.falseHeavy) ? Math.max(0, Math.floor(s.falseHeavy)) : 0,
        trueHeavy: isNum(s.trueHeavy) ? Math.max(0, Math.floor(s.trueHeavy)) : 0,
        falseSlow: isNum(s.falseSlow) ? Math.max(0, Math.floor(s.falseSlow)) : 0,
        firstSeenMs: isNum(s.firstSeenMs) ? s.firstSeenMs : 0,
        lastSeenMs: isNum(s.lastSeenMs) ? s.lastSeenMs : 0,
      });
      if (stretches.length >= MAX_STRETCHES) break;
    }
  }
  const corrections: CorrectionEntry[] = [];
  if (Array.isArray(raw.corrections)) {
    for (const c of raw.corrections as CorrectionEntry[]) {
      if (!c || typeof c.id !== "string" || !isNum(c.atMs) || !isNum(c.lat) || !isNum(c.lon)) continue;
      if (c.kind !== "parallel_road" && c.kind !== "traffic_false_heavy" && c.kind !== "traffic_confirmed_heavy" && c.kind !== "traffic_false_slow") continue;
      corrections.push({
        id: c.id,
        atMs: c.atMs,
        kind: c.kind,
        lat: c.lat,
        lon: c.lon,
        cellKey: typeof c.cellKey === "string" ? c.cellKey : cellKeyFor(c.lat, c.lon),
        headingBucket: isNum(c.headingBucket) ? c.headingBucket : -1,
        detail: typeof c.detail === "string" ? c.detail.slice(0, 400) : "",
      });
      if (corrections.length >= MAX_CORRECTIONS) break;
    }
  }
  return {
    version: 1,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : false,
    stretches,
    corrections,
  };
}

type StorageLike = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem?(k: string): void };

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadRoadLearning(storage: StorageLike | null = defaultStorage()): RoadLearningState {
  if (!storage) return createRoadLearningState();
  try {
    const raw = storage.getItem(ROAD_LEARNING_STORAGE_KEY);
    if (!raw) return createRoadLearningState();
    return normalizeRoadLearningState(JSON.parse(raw) as unknown);
  } catch {
    return createRoadLearningState();
  }
}

export function saveRoadLearning(state: RoadLearningState, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(ROAD_LEARNING_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full / unavailable — learning simply doesn't persist
    // this write; the in-memory state keeps working this session.
  }
}

// ---------- Stretch bookkeeping -------------------------------------------

function upsertStretch(
  state: RoadLearningState,
  lat: number,
  lon: number,
  headingBucket: number,
  atMs: number,
): { state: RoadLearningState; stretch: LearnedStretch } {
  const cellKey = cellKeyFor(lat, lon);
  const idx = state.stretches.findIndex((s) => s.cellKey === cellKey && s.headingBucket === headingBucket);
  const stretches = [...state.stretches];
  let stretch: LearnedStretch;
  if (idx >= 0) {
    stretch = { ...stretches[idx]!, lastSeenMs: atMs };
    stretches[idx] = stretch;
  } else {
    stretch = {
      cellKey,
      centerLat: lat,
      centerLon: lon,
      headingBucket,
      parallelHits: 0,
      falseHeavy: 0,
      trueHeavy: 0,
      falseSlow: 0,
      firstSeenMs: atMs,
      lastSeenMs: atMs,
    };
    stretches.push(stretch);
    // Cap: evict the least-recently-seen stretches first.
    if (stretches.length > MAX_STRETCHES) {
      stretches.sort((a, b) => b.lastSeenMs - a.lastSeenMs);
      stretches.length = MAX_STRETCHES;
    }
  }
  return { state: { ...state, stretches }, stretch };
}

function withCorrection(state: RoadLearningState, entry: CorrectionEntry): RoadLearningState {
  return { ...state, corrections: [entry, ...state.corrections].slice(0, MAX_CORRECTIONS) };
}

let correctionSeq = 0;
function correctionId(atMs: number): string {
  correctionSeq += 1;
  return `c${atMs.toString(36)}-${correctionSeq.toString(36)}`;
}

// ---------- 1. Parallel-road memory ----------------------------------------

/** Record a proven parallel-road episode (the tracker fired: the
 *  truck sustained a run beside the route on a different road).
 *  Returns the new state; a no-op (same state) while disabled. */
export function recordParallelCorrection(
  state: RoadLearningState,
  args: { lat: number; lon: number; headingDeg: number | null; offFt: number; travelMi: number; atMs: number },
): RoadLearningState {
  if (!state.enabled) return state;
  const bucket = headingBucketFor(args.headingDeg);
  const { state: s1, stretch } = upsertStretch(state, args.lat, args.lon, bucket, args.atMs);
  const updated: LearnedStretch = { ...stretch, parallelHits: stretch.parallelHits + 1 };
  const stretches = s1.stretches.map((s) => (s === stretch ? updated : s));
  const detail =
    `Running ${Math.round(args.offFt)} ft beside the planned route for ${args.travelMi.toFixed(2)} mi — ` +
    `a different road running the same way (the service-road case). Rerouted from the road actually being driven. ` +
    `This stretch is now remembered (${updated.parallelHits}×): next time it will be recognised sooner.`;
  return withCorrection(
    { ...s1, stretches },
    { id: correctionId(args.atMs), atMs: args.atMs, kind: "parallel_road", lat: args.lat, lon: args.lon, cellKey: updated.cellKey, headingBucket: bucket, detail },
  );
}

/** The parallel detector's sustain bar at a place: the defaults
 *  from routeGeometry.ts, lowered on stretches the app has already
 *  been wrong about in this direction. One remembered episode
 *  earns a faster recognition; three or more, faster still. A
 *  stretch remembered for the OPPOSITE direction earns nothing —
 *  the other carriageway's frontage road is a different lesson. */
export function parallelThresholdsAt(
  state: RoadLearningState,
  lat: number,
  lon: number,
  headingDeg: number | null,
): { sustainMs: number; minTravelMi: number } {
  const DEFAULTS = { sustainMs: 6000, minTravelMi: 0.07 };
  if (!state.enabled) return DEFAULTS;
  const cellKey = cellKeyFor(lat, lon);
  const near = bucketsNear(headingBucketFor(headingDeg));
  let hits = 0;
  for (const s of state.stretches) {
    if (s.cellKey === cellKey && near.includes(s.headingBucket)) hits += s.parallelHits;
  }
  if (hits >= 3) return { sustainMs: 2200, minTravelMi: 0.03 };
  if (hits >= 1) return { sustainMs: 3500, minTravelMi: 0.045 };
  return DEFAULTS;
}

// ---------- 2. Traffic ground truth (the truck's own speed) -----------------

export type TrafficVerdict = "false_heavy" | "true_heavy" | "false_slow" | null;

/** Speeds (mph) that settle the question. Between them the honest
 *  answer is "inconclusive" — stop-and-go averages, a brief slow
 *  patch, a sample caught mid-acceleration — and nothing is
 *  learned from an inconclusive pass. */
export const FALSE_HEAVY_MIN_MPH = 38;
export const TRUE_HEAVY_MAX_MPH = 16;
export const FALSE_SLOW_MIN_MPH = 48;

/**
 * Judge one pass through a painted stretch against the truck's own
 * speed and record the verdict. Callers throttle this (at most one
 * judgement per corridor cell per minute) — one pass is one
 * observation, and the trust math below needs several before it
 * moves the paint.
 */
export function observeTrafficGroundTruth(
  state: RoadLearningState,
  args: { lat: number; lon: number; headingDeg: number | null; paintedLevel: "slow" | "heavy" | null; ownSpeedMph: number | null; atMs: number },
): { state: RoadLearningState; verdict: TrafficVerdict } {
  if (!state.enabled) return { state, verdict: null };
  const { paintedLevel, ownSpeedMph } = args;
  if (paintedLevel == null || ownSpeedMph == null || !Number.isFinite(ownSpeedMph)) return { state, verdict: null };
  let verdict: TrafficVerdict = null;
  if (paintedLevel === "heavy" && ownSpeedMph >= FALSE_HEAVY_MIN_MPH) verdict = "false_heavy";
  else if (paintedLevel === "heavy" && ownSpeedMph <= TRUE_HEAVY_MAX_MPH) verdict = "true_heavy";
  else if (paintedLevel === "slow" && ownSpeedMph >= FALSE_SLOW_MIN_MPH) verdict = "false_slow";
  if (!verdict) return { state, verdict: null };

  const bucket = headingBucketFor(args.headingDeg);
  const { state: s1, stretch } = upsertStretch(state, args.lat, args.lon, bucket, args.atMs);
  const updated: LearnedStretch = { ...stretch };
  let detail = "";
  if (verdict === "false_heavy") {
    updated.falseHeavy += 1;
    detail =
      `Painted HEAVY here, but the truck flowed through at ${Math.round(ownSpeedMph)} mph — the paint was wrong. ` +
      `False-heavy #${updated.falseHeavy} for this corridor; learned trust here is now ${Math.round(trafficTrustForCounts(updated) * 100)}%.`;
  } else if (verdict === "true_heavy") {
    updated.trueHeavy += 1;
    detail =
      `Painted HEAVY here and the truck crawled at ${Math.round(ownSpeedMph)} mph — the paint was right. ` +
      `Confirmation #${updated.trueHeavy} for this corridor; learned trust here is now ${Math.round(trafficTrustForCounts(updated) * 100)}%.`;
  } else {
    updated.falseSlow += 1;
    detail =
      `Painted SLOW here, but the truck flowed through at ${Math.round(ownSpeedMph)} mph — overstated. ` +
      `Noted for this corridor (${updated.falseSlow}×).`;
  }
  const stretches = s1.stretches.map((s) => (s === stretch ? updated : s));
  const kind: CorrectionKind =
    verdict === "false_heavy" ? "traffic_false_heavy" : verdict === "true_heavy" ? "traffic_confirmed_heavy" : "traffic_false_slow";
  return {
    state: withCorrection(
      { ...s1, stretches },
      { id: correctionId(args.atMs), atMs: args.atMs, kind, lat: args.lat, lon: args.lon, cellKey: updated.cellKey, headingBucket: bucket, detail },
    ),
    verdict,
  };
}

/** Learned trust (0..1) from one stretch's counts: starts at full
 *  trust, each false-heavy costs real trust, confirmations buy it
 *  back, false-slow costs a little. Floored so a corridor can
 *  always earn its way back — trust is a judgement, not a ban. */
export function trafficTrustForCounts(s: { falseHeavy: number; trueHeavy: number; falseSlow: number }): number {
  const t = 1 - 0.22 * s.falseHeavy - 0.06 * s.falseSlow + 0.12 * s.trueHeavy;
  return Math.max(0.25, Math.min(1, t));
}

/** Aggregated learned trust for a corridor cell (all directions —
 *  TomTom's corridor reporting is not directional enough to split
 *  hairs the memory can't back up). 1 when nothing is learned. */
export function trafficTrustAt(state: RoadLearningState, lat: number, lon: number): number {
  if (!state.enabled) return 1;
  const cellKey = cellKeyFor(lat, lon);
  let falseHeavy = 0;
  let trueHeavy = 0;
  let falseSlow = 0;
  let any = false;
  for (const s of state.stretches) {
    if (s.cellKey !== cellKey) continue;
    any = true;
    falseHeavy += s.falseHeavy;
    trueHeavy += s.trueHeavy;
    falseSlow += s.falseSlow;
  }
  if (!any) return 1;
  return trafficTrustForCounts({ falseHeavy, trueHeavy, falseSlow });
}

/** False-heavy observations aggregated for a corridor cell. */
export function falseHeavyCountAt(state: RoadLearningState, lat: number, lon: number): number {
  const cellKey = cellKeyFor(lat, lon);
  let n = 0;
  for (const s of state.stretches) if (s.cellKey === cellKey) n += s.falseHeavy;
  return n;
}

/** A HEAVY paint is downgraded in a corridor only after the truck
 *  itself has proven the paint wrong at least twice there AND the
 *  aggregated trust has fallen below the bar — one bad evening
 *  never rewrites a corridor. */
export const DOWNGRADE_TRUST_BELOW = 0.6;
export const DOWNGRADE_MIN_FALSE_HEAVY = 2;

export function shouldDowngradeHeavyAt(state: RoadLearningState, lat: number, lon: number): boolean {
  if (!state.enabled) return false;
  return falseHeavyCountAt(state, lat, lon) >= DOWNGRADE_MIN_FALSE_HEAVY && trafficTrustAt(state, lat, lon) < DOWNGRADE_TRUST_BELOW;
}

/**
 * Apply learned traffic trust to built segments: a HEAVY segment
 * whose midpoint sits in a proven-unreliable corridor is painted
 * SLOW instead. Segments are the route's own coords (see
 * trafficSegments.ts), so the midpoint is on the corridor itself.
 * Returns the (possibly adjusted) segments and how many were
 * downgraded — the caller logs the self-correction when it's > 0.
 */
export function applyTrafficLearning(
  segments: TrafficSegment[],
  state: RoadLearningState,
): { segments: TrafficSegment[]; downgraded: number } {
  if (!state.enabled || segments.length === 0) return { segments, downgraded: 0 };
  let downgraded = 0;
  const out = segments.map((seg) => {
    if (seg.level !== "heavy" || seg.coords.length === 0) return seg;
    const mid = seg.coords[Math.floor(seg.coords.length / 2)]!;
    if (!shouldDowngradeHeavyAt(state, mid[0], mid[1])) return seg;
    downgraded += 1;
    return { ...seg, level: "slow" as const, color: TRAFFIC_COLORS.slow };
  });
  return { segments: out, downgraded };
}

// ---------- Panel helpers ----------------------------------------------------

export type RoadLearningSummary = {
  stretchesRemembered: number;
  parallelStretches: number;
  correctionsCount: number;
  falseHeavyTotal: number;
  confirmedHeavyTotal: number;
};

export function roadLearningSummary(state: RoadLearningState): RoadLearningSummary {
  let parallelStretches = 0;
  let falseHeavyTotal = 0;
  let confirmedHeavyTotal = 0;
  for (const s of state.stretches) {
    if (s.parallelHits > 0) parallelStretches += 1;
    falseHeavyTotal += s.falseHeavy;
    confirmedHeavyTotal += s.trueHeavy;
  }
  return {
    stretchesRemembered: state.stretches.length,
    parallelStretches,
    correctionsCount: state.corrections.length,
    falseHeavyTotal,
    confirmedHeavyTotal,
  };
}

/** Forget one stretch (the panel's per-stretch Remove). Corrections
 *  history is NOT rewritten — the log keeps what happened; only
 *  the behavioural memory is forgotten. */
export function forgetStretch(state: RoadLearningState, cellKey: string, headingBucket: number): RoadLearningState {
  return { ...state, stretches: state.stretches.filter((s) => !(s.cellKey === cellKey && s.headingBucket === headingBucket)) };
}

export function setRoadLearningEnabled(state: RoadLearningState, enabled: boolean): RoadLearningState {
  return { ...state, enabled };
}

export function clearRoadLearning(state: RoadLearningState): RoadLearningState {
  return { ...state, stretches: [], corrections: [] };
}
