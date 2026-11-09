// Route geometry — the single source for "where is the truck relative
// to the planned route line": true point-to-POLYLINE distance and
// along-track progress.
//
// Pure and framework-free (no DOM, no React), like gpsFilter.ts, so the
// exact production math is unit-testable with synthetic routes (see
// routeGeometry.test.ts).
//
// Why this module exists: the previous guidance code measured the
// distance from the truck to the nearest route VERTEX (shape point).
// That overstates the true distance everywhere except exactly at a
// shape point — midway along a long straight segment the reading can
// be hundreds of meters even with the truck dead-center on the road —
// and it made along-track progress snap from vertex to vertex. Reroute
// detection was therefore unreliable at any threshold. The projection
// below measures to the SEGMENTS, which is the distance a driver
// means by "how far off the route am I".

export type LatLon = { lat: number; lon: number };

const M_PER_MI = 1609.344;
const EARTH_R_M = 6371000;

function haversineMi(a: LatLon, b: LatLon): number {
  const R = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export type RouteProjection = {
  /** True distance (mi) from the point to the nearest point ON the
   *  route polyline — segments, not just vertices. */
  offMi: number;
  /** Distance (mi) along the route from its start to that nearest
   *  point — smooth along-track progress. */
  alongMi: number;
  /** Full route length (mi) by the same haversine chain the rest of
   *  the app uses for route totals. */
  totalMi: number;
  /** The nearest point ON the polyline itself (road test #3: the
   *  truck marker's display snap target — the raw GPS point can sit
   *  beside the road it's actually on; this is where on the road
   *  it belongs). */
  snapped: LatLon;
  /** Directed bearing (deg, 0 = north) of the segment the nearest
   *  point lands on, or null for a degenerate route. */
  bearingDeg: number | null;
};

/**
 * Project a point onto a route polyline (`coords` are [lat, lon]
 * pairs, the shape format the routing response decodes to).
 *
 * The projection runs in a local tangent plane anchored at the point
 * itself (equirectangular scaling — accurate to well under a meter at
 * the segment scales a route shape uses), while along-track distances
 * accumulate with the same haversine segment lengths the app already
 * uses for route totals, so progress stays consistent with the
 * route's own mileage.
 */
export function projectOntoRoute(pos: LatLon, coords: [number, number][]): RouteProjection {
  if (coords.length === 0) return { offMi: Infinity, alongMi: 0, totalMi: 0, snapped: pos, bearingDeg: null };
  const first = coords[0]!;
  if (coords.length === 1) {
    return {
      offMi: haversineMi(pos, { lat: first[0], lon: first[1] }),
      alongMi: 0,
      totalMi: 0,
      snapped: { lat: first[0], lon: first[1] },
      bearingDeg: null,
    };
  }

  // Tangent plane: meters east/north of `pos`.
  const latRad = (pos.lat * Math.PI) / 180;
  const mPerDegLat = (Math.PI / 180) * EARTH_R_M;
  const mPerDegLon = mPerDegLat * Math.cos(latRad);
  const toXY = (c: [number, number]): { x: number; y: number } => ({
    x: (c[1] - pos.lon) * mPerDegLon,
    y: (c[0] - pos.lat) * mPerDegLat,
  });

  let bestOffM = Infinity;
  let bestAlongMi = 0;
  let bestSnapped: LatLon = pos;
  let bestBearing: number | null = null;
  let accMi = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]!;
    const b = coords[i]!;
    const segMi = haversineMi({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] });
    const pa = toXY(a);
    const pb = toXY(b);
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const lenSq = dx * dx + dy * dy;
    // The point is the plane origin, so t is the projection of
    // (origin - a) onto the segment direction, clamped to the segment.
    let t = 0;
    if (lenSq > 0) {
      t = (-pa.x * dx - pa.y * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
    }
    const cx = pa.x + t * dx;
    const cy = pa.y + t * dy;
    const offM = Math.sqrt(cx * cx + cy * cy);
    if (offM < bestOffM) {
      bestOffM = offM;
      bestAlongMi = accMi + t * segMi;
      bestSnapped = { lat: pos.lat + cy / mPerDegLat, lon: pos.lon + cx / mPerDegLon };
      bestBearing = lenSq > 0 ? ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360 : null;
    }
    accMi += segMi;
  }
  return { offMi: bestOffM / M_PER_MI, alongMi: bestAlongMi, totalMi: accMi, snapped: bestSnapped, bearingDeg: bestBearing };
}

/**
 * Display snap for the truck marker (road test #3, 2026-10-30:
 * "truck goes off on the side not in the road"). The marker used to
 * draw the RAW filtered fix — honest GPS scatter of ±10–65 m put
 * it in the ditch, on the shoulder, or visually on the parallel
 * road beside the one being driven. When the truck is following a
 * planned route and the raw point sits within `maxOffM` of the
 * route LINE, with its course aligned to that segment, the marker
 * belongs ON the line at the projection.
 *
 * The radius is deliberately TIGHT (default 25 m): parallel roads
 * (interstate carriageway vs frontage road) are typically 30 m+
 * apart, so a driver genuinely on the frontage road while the
 * route runs on the interstate is NOT dragged onto the interstate
 * by this snap — their offset is usually past the radius, and the
 * off-route detection (128 m) still owns that case. The heading
 * gate (course within 40° of the segment, either direction) keeps
 * a crossing-street pass from snapping sideways. DISPLAY ONLY:
 * nothing here feeds miles, seals, geofences, or the speed-limit
 * match — those keep using the raw accepted fix.
 */
export function snapDisplayToRoute(
  pos: LatLon,
  coords: [number, number][],
  opts: { headingDeg?: number | null; maxOffM?: number } = {},
): LatLon | null {
  if (coords.length < 2) return null;
  const proj = projectOntoRoute(pos, coords);
  const maxOffM = opts.maxOffM ?? 25;
  if (proj.offMi * M_PER_MI > maxOffM) return null;
  const heading = opts.headingDeg;
  if (heading != null && Number.isFinite(heading) && proj.bearingDeg != null) {
    const n = ((heading - proj.bearingDeg) % 360 + 360) % 360;
    const diff = Math.min(n, 360 - n);
    const lineErr = Math.min(diff, 180 - diff);
    if (lineErr > 40) return null;
  }
  return proj.snapped;
}

/** Off-route threshold (mi): the truck is "off the planned route"
 *  when its true distance to the route LINE exceeds this. 0.08 mi ≈
 *  128 m ≈ 420 ft — a block or so of city streets — and still roughly
 *  twice the worst GPS accuracy radius the fix filter accepts (65 m),
 *  so an on-route truck with honest-but-fuzzy fixes stays under it.
 *  (The previous 0.3 mi ≈ 480 m threshold meant a driver could be
 *  several blocks off course in town and the app never even started
 *  its reroute timer.) */
export const OFF_ROUTE_MI = 0.08;

// ---------- Parallel-road awareness (road test #4, 2026-10-30) -----------
// The I-65 failure: the route ran on the interstate, the truck ran on
// its service road ~30–60 m to the side. That offset sits in a DEAD
// ZONE between two thresholds that were each right on their own:
//   - the display snap (25 m, above) correctly refuses to drag a
//     frontage-road driver onto the interstate line, and
//   - the off-route threshold (128 m) correctly refuses to reroute
//     an on-route truck over GPS fuzz.
// Between them, the app did NOTHING — it kept scoring the drive
// against a road the truck was not on, kept issuing the interstate's
// turn instructions, and never rerouted. The tracker below owns the
// dead zone: a truck that runs PARALLEL to the route — offset past
// the snap radius but inside the off-route threshold, course aligned
// with the route's direction, making real along-track progress — for
// a sustained stretch is on a DIFFERENT road that happens to run the
// same way, and the honest response is a reroute from the truck's
// actual position (with its course fed to the router, see App.tsx)
// so the new line lands on the road being driven.

/** Parallel band (m off the route line): past the display-snap
 *  radius, inside the off-route threshold. */
export const PARALLEL_MIN_OFF_M = 28;
export const PARALLEL_MAX_OFF_M = OFF_ROUTE_MI * 1609.344;
/** Course must agree with the route segment's direction (either way
 *  along the line) within this many degrees to count as "running
 *  parallel" rather than crossing or wandering. Calibrated
 *  2026-11-01 (road test #5 — the I-65 service road again): 30° was
 *  tighter than the course a browser GPS breadcrumb actually holds
 *  through a ramp weave or a gentle curve, so real service-road
 *  runs kept failing the gate; 42° still rejects a crossing street
 *  (~90° off) outright. */
export const PARALLEL_HEADING_TOL_DEG = 42;
/** Sustained-parallel evidence required before firing: at least
 *  this long AND at least this much along-track travel while staying
 *  in the band the whole time. A parked truck beside the route (no
 *  along-track progress) and a brief pass on a cross street (no
 *  duration) can never fire it. Calibrated 2026-11-01 (road test
 *  #5): the old 0.12 mi / 8 s pair asked for ~200 m of flawless
 *  evidence — service roads are short and their GPS headings are
 *  intermittent, so the episode usually broke before it could fire.
 *  0.07 mi / 6 s is still far beyond a ramp weave or a wide turn. */
export const PARALLEL_SUSTAIN_MS = 6000;
export const PARALLEL_MIN_TRAVEL_MI = 0.07;

/** Is this projection + course a parallel-running candidate right
 *  now? Pure per-fix judgement; the tracker adds the sustain. */
export function isParallelCandidate(
  proj: RouteProjection,
  headingDeg: number | null | undefined,
): boolean {
  const offM = proj.offMi * 1609.344;
  if (!(offM >= PARALLEL_MIN_OFF_M && offM < PARALLEL_MAX_OFF_M)) return false;
  if (headingDeg == null || !Number.isFinite(headingDeg) || proj.bearingDeg == null) return false;
  const n = (((headingDeg - proj.bearingDeg) % 360) + 360) % 360;
  const diff = Math.min(n, 360 - n);
  const lineErr = Math.min(diff, 180 - diff);
  return lineErr <= PARALLEL_HEADING_TOL_DEG;
}

/**
 * Stateful sustained-parallel detector. Feed every accepted fix's
 * projection + course; `push` returns true exactly once per parallel
 * episode (when the sustain is met) and then latches until the truck
 * is seen back on the route line (or clearly off it the ordinary
 * way), so one service-road run produces one reroute, not a loop.
 */
export class ParallelTrackTracker {
  private streakStartMs: number | null = null;
  private streakStartAlongMi = 0;
  private lastAlongMi = 0;
  private fired = false;
  /** Learning-layer thresholds (road learning, 2026-11-01): the
   *  sustain/travel bar this tracker fires at. Defaults are the
   *  calibrated constants; the road-learning layer lowers them ONLY
   *  on stretches it has already proven parallel in this direction
   *  (see roadLearning.ts parallelThresholdsAt) via setThresholds —
   *  everywhere else the calibrated defaults stand untouched. */
  sustainMs: number = PARALLEL_SUSTAIN_MS;
  minTravelMi: number = PARALLEL_MIN_TRAVEL_MI;

  setThresholds(sustainMs: number, minTravelMi: number): void {
    this.sustainMs = sustainMs;
    this.minTravelMi = minTravelMi;
  }
  /** Consecutive SOFT misses inside an open streak (road test #5
   *  calibration): a fix whose heading is simply MISSING — the
   *  browser GPS starves the course signal for a fix or two at a
   *  time, especially at service-road speeds — or a one-fix GPS
   *  scatter dip toward the route line. The old tracker wiped the
   *  whole streak on ANY single non-candidate fix, so on the real
   *  I-65 service road the 8 s of evidence never survived long
   *  enough to fire. A soft miss now holds the streak; only a HARD
   *  miss (a real heading that disagrees with the route — a
   *  crossing, a turn away) or a run of soft misses ends it. */
  private softMisses = 0;

  reset(): void {
    this.streakStartMs = null;
    this.fired = false;
    this.softMisses = 0;
  }

  private clearStreak(): void {
    this.streakStartMs = null;
    this.softMisses = 0;
  }

  push(proj: RouteProjection, headingDeg: number | null | undefined, nowMs: number): boolean {
    const offM = proj.offMi * 1609.344;
    // Clearly back ON the line (well inside the snap radius) or
    // beyond the ordinary off-route threshold: this episode is
    // over either way — the off-route logic owns the second case.
    if (offM < 15 || offM >= PARALLEL_MAX_OFF_M) {
      this.clearStreak();
      this.fired = false;
      return false;
    }
    if (this.fired) return false;
    const inBand = offM >= PARALLEL_MIN_OFF_M && offM < PARALLEL_MAX_OFF_M;
    if (isParallelCandidate(proj, headingDeg)) {
      this.softMisses = 0;
      if (this.streakStartMs == null) {
        this.streakStartMs = nowMs;
        this.streakStartAlongMi = proj.alongMi;
      }
      this.lastAlongMi = proj.alongMi;
      return this.checkFire(proj, nowMs);
    }
    // Not a candidate this fix. With no open streak there is
    // nothing to protect.
    if (this.streakStartMs == null) return false;
    const headingMissing = headingDeg == null || !Number.isFinite(headingDeg);
    // HARD miss: in the band with a real heading that disagrees —
    // the truck turned or is crossing; the episode is over.
    if (inBand && !headingMissing) {
      this.clearStreak();
      return false;
    }
    // SOFT miss: heading starved for this fix, or a scatter dip
    // just inside the band's inner edge (15–28 m off). Hold the
    // streak through up to two in a row; in-band soft fixes still
    // contribute their along-track progress — a truck that keeps
    // travelling parallel while its heading signal blinks is
    // exactly the service-road case.
    this.softMisses += 1;
    if (this.softMisses > 2) {
      this.clearStreak();
      return false;
    }
    if (inBand) {
      this.lastAlongMi = proj.alongMi;
      return this.checkFire(proj, nowMs);
    }
    return false;
  }

  private checkFire(proj: RouteProjection, nowMs: number): boolean {
    if (this.streakStartMs == null) return false;
    const sustained = nowMs - this.streakStartMs >= this.sustainMs;
    const travelled = proj.alongMi - this.streakStartAlongMi >= this.minTravelMi;
    if (sustained && travelled) {
      this.fired = true;
      return true;
    }
    return false;
  }

  /** Along-track miles covered by the current (unfired) streak —
   *  for honest UI copy ("running beside the route for 0.3 mi"). */
  get streakTravelMi(): number {
    return this.streakStartMs == null ? 0 : Math.max(0, this.lastAlongMi - this.streakStartAlongMi);
  }
}

export function createParallelTrackTracker(): ParallelTrackTracker {
  return new ParallelTrackTracker();
}

/** Course over ground (deg) implied by a breadcrumb of recent fixes
 *  (oldest → newest) — the heading signal handed to the router when
 *  a route is (re)planned, so Valhalla snaps the origin onto the
 *  carriageway the truck is actually travelling, not whichever
 *  parallel road a single fuzzy fix happens to sit closest to. Null
 *  when the span is too short (<15 m) to mean anything.
 *  Calibrated 2026-11-01 (road test #5): the course is read off the
 *  breadcrumb's TAIL (the last few fixes, ~100 m of travel), not
 *  the whole ~300 m buffer — after the truck turns off the
 *  interstate onto its service road, a whole-buffer course keeps
 *  pointing along the old road (and through the ramp's curve) for
 *  hundreds of metres, which starved the parallel detector and the
 *  router's heading alike. The tail turns with the truck. */
export function headingFromTrack(shape: LatLon[]): number | null {
  if (shape.length < 2) return null;
  const tail = shape.slice(-6);
  const a = tail[0]!;
  const b = tail[tail.length - 1]!;
  const latRad = (a.lat * Math.PI) / 180;
  const mPerDegLat = (Math.PI / 180) * EARTH_R_M;
  const mPerDegLon = mPerDegLat * Math.cos(latRad);
  const dx = (b.lon - a.lon) * mPerDegLon;
  const dy = (b.lat - a.lat) * mPerDegLat;
  if (Math.hypot(dx, dy) < 15) return null;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

/** How long (ms) the truck must stay beyond OFF_ROUTE_MI before a
 *  reroute fires. The check is re-evaluated on a 1-second timer as
 *  well as on every GPS fix (see App.tsx), so a truck that STOPPED
 *  off route — where the platform may deliver no new fixes — still
 *  reroutes on schedule. */
export const OFF_ROUTE_SUSTAIN_MS = 6000;

/** Minimum gap (ms) between automatic reroute attempts. A failed
 *  attempt re-arms sooner (see REROUTE_RETRY_MS in App.tsx) so the
 *  "it will try again" promise on the failure banner is real. */
export const REROUTE_COOLDOWN_MS = 20000;

// ---------- Heading-up map rotation -------------------------------------
// Pure math for the heading-up map view (App.tsx owns the DOM/Leaflet
// plumbing). Kept here so the exact production math is unit-testable:
// the bearing the map is rotated to, how it eases toward the GPS
// heading without spinning across the 0°/360° seam, and how a finger
// drag in SCREEN pixels converts to a pan in the map's own (rotated)
// pixel frame so grab-the-map dragging stays true at any bearing.

/** Normalize any degree value to [0, 360). */
export function normalizeBearingDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Signed shortest turn from `from` to `to`, in (-180, 180]. */
export function bearingDeltaDeg(from: number, to: number): number {
  const d = normalizeBearingDeg(to - from);
  return d > 180 ? d - 360 : d;
}

/**
 * Ease the displayed bearing toward the GPS heading: move at most
 * `maxStepDeg` per update and cover only `fraction` of the remaining
 * turn, so the map swings smoothly instead of snapping on every fix,
 * and GPS jitter under `deadbandDeg` never moves it at all.
 */
export function smoothBearingDeg(
  current: number,
  target: number,
  opts: { fraction?: number; maxStepDeg?: number; deadbandDeg?: number } = {},
): number {
  const fraction = opts.fraction ?? 0.4;
  const maxStepDeg = opts.maxStepDeg ?? 24;
  const deadbandDeg = opts.deadbandDeg ?? 2;
  const delta = bearingDeltaDeg(current, target);
  if (Math.abs(delta) < deadbandDeg) return normalizeBearingDeg(current);
  const step = Math.max(-maxStepDeg, Math.min(maxStepDeg, delta * fraction));
  return normalizeBearingDeg(current + step);
}

/**
 * Convert a drag delta measured in screen pixels to the delta in the
 * map plane's own pixel frame when the plane is rendered rotated by
 * CSS `rotate(-bearingDeg)` (heading-up: the truck's heading points
 * to the top of the screen). The map content must follow the finger
 * exactly on screen, so the local delta is the screen delta rotated
 * back by the bearing. At bearing 0 this is the identity.
 */
/**
 * Side length (px) of the square heading-up plane for a visible frame
 * of `w` × `h`: the frame's diagonal plus a margin, so the rotated
 * plane covers the frame's corners at every bearing. Symmetric in
 * w/h — a phone rotating between portrait and landscape yields the
 * SAME plane side, which is what lets Leaflet re-measure (via
 * invalidateSize on the orientation/resize passes) into an identical,
 * fully-covered plane instead of a clipped or stale one. Before the
 * first measure (w/h still 0) a generous default keeps the initial
 * tile load sensible.
 */
export function mapPlaneSideFor(w: number, h: number): number {
  if (!(w > 0) || !(h > 0)) return 1400;
  return Math.ceil(Math.hypot(w, h)) + 24;
}

export function screenDeltaToMapDelta(
  dx: number,
  dy: number,
  bearingDeg: number,
): { dx: number; dy: number } {
  if (bearingDeg === 0) return { dx, dy };
  const rad = (normalizeBearingDeg(bearingDeg) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { dx: cos * dx - sin * dy, dy: sin * dx + cos * dy };
}
