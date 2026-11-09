// Speed-limit lookup math — which nearby road the truck is actually
// ON, and what that road's posted limit is.
//
// Pure and framework-free (no DOM, no React), like routeGeometry.ts,
// so the exact production selection logic is unit-testable (see
// speedLimit.test.ts).
//
// Why this module exists: the previous lookup asked Overpass for the
// ways carrying a maxspeed tag within ~160 m and took the FIRST one
// that parsed. Overpass returns elements in storage order, not
// nearest-first, and `out … 6` truncated the list — so on an
// interstate the "limit" could come from a frontage road, an exit
// ramp, or a crossing street, and when the truck's own segment wasn't
// among the first six the box showed "––" for the whole trip (driver
// report, 2026-10-27: 62 mph on I-10, limit "––" in both readouts).
// The fix: fetch the nearby highway ways WITH geometry and pick the
// limit of the way whose LINE is nearest the truck — the road the
// truck is on wins over every road that merely passes nearby.
//
// Road test #3 (2026-10-30) — nearest-line ALONE is not enough, and
// this module now says why in code. The LIMIT chip finally showed a
// number, but near the I-10 ramps it showed 55 while the truck did
// 69 on the interstate side, firing a false "OVER THE LIMIT" banner;
// and on parallel roads (interstate vs its frontage/service road)
// the truck marker sat off the side of the road and the app matched
// the WRONG carriageway. Root causes, all in the selection layer:
//   - GPS fixes are accepted with up to 65 m of accuracy radius
//     (gpsFilter.ts), while parallel carriageways/frontage roads sit
//     15–50 m apart. At that scale "nearest line wins" is a coin
//     flip weighted by this second's GPS noise — the match flips
//     between the two roads fix by fix.
//   - A single point carries no direction and no history. A crossing
//     street, the opposite carriageway, and the road the truck has
//     been driving for the last mile were all scored identically.
// The match below therefore scores every candidate way on FOUR
// signals, not one: distance to its line, alignment between the
// truck's heading and the way's direction at the nearest segment
// (one-way ways are judged directionally — the southbound
// carriageway is the WRONG road for a northbound truck however
// close it is), continuity with the road matched a moment ago
// (same ref/name/class earns a bonus, switching roads costs a
// little hysteresis, so a match only moves when the evidence is
// clearly better), and plain plausibility at the truck's speed (a
// service road is not where a truck sustains 65+ mph). Nothing here
// invents a limit: the winner still has to carry a real maxspeed
// tag and lie within the distance cap — the extra signals only
// decide WHICH real road the truck is on.

export type LatLon = { lat: number; lon: number };

/** One Overpass way, reduced to what the selection needs. */
export type OsmWayLite = {
  id?: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  /** Node position for node elements (not used for ways). */
  lat?: number;
  lon?: number;
};

/**
 * Parse an OSM maxspeed tag to mph. Handles "70 mph", "50", "30 mph;
 * 20 mph" (first value wins), per-lane "60|70" forms, and km/h units.
 * Bare numbers follow the OSM convention for the US (mph). Returns
 * null for anything unparseable ("none", "walk", signals, …) — a
 * limit is never invented from a tag that doesn't state one.
 */
export function parseMaxspeedMph(raw: string | undefined): number | null {
  if (!raw) return null;
  const first = raw.split(";")[0]?.split("|")[0]?.trim() ?? "";
  const m = first.match(/^([\d.]+)\s*(mph|km\/h|kmh|kph)?$/i);
  if (!m) return null;
  const v = parseFloat(m[1] ?? "");
  if (!Number.isFinite(v) || v <= 0) return null;
  const unit = (m[2] ?? "").toLowerCase();
  if (unit === "mph") return Math.round(v);
  if (unit) return Math.round(v * 0.621371);
  return Math.round(v);
}

/** The posted limit a way carries, checking the tag spellings OSM
 *  actually uses: plain `maxspeed`, then the directional variants,
 *  then per-lane. `maxspeed:type` (sign / advisory provenance) is NOT
 *  a limit and is never read as one. */
export function wayLimitMph(tags: Record<string, string> | undefined): number | null {
  if (!tags) return null;
  return (
    parseMaxspeedMph(tags.maxspeed) ??
    parseMaxspeedMph(tags["maxspeed:forward"]) ??
    parseMaxspeedMph(tags["maxspeed:backward"]) ??
    parseMaxspeedMph(tags["maxspeed:lanes"])
  );
}

const EARTH_R_M = 6371000;

/** Distance in meters from a point to a way's polyline (segments, not
 *  just vertices), in a local tangent plane anchored at the point —
 *  the same projection routeGeometry.ts uses. Ways without geometry
 *  fall back to their node position, then to +Infinity. */
export function wayDistanceM(pos: LatLon, way: OsmWayLite): number {
  const latRad = (pos.lat * Math.PI) / 180;
  const mPerDegLat = (Math.PI / 180) * EARTH_R_M;
  const mPerDegLon = mPerDegLat * Math.cos(latRad);
  const toXY = (lat: number, lon: number): { x: number; y: number } => ({
    x: (lon - pos.lon) * mPerDegLon,
    y: (lat - pos.lat) * mPerDegLat,
  });
  const geom = way.geometry ?? [];
  if (geom.length === 0) {
    if (way.lat != null && way.lon != null) {
      const p = toXY(way.lat, way.lon);
      return Math.hypot(p.x, p.y);
    }
    return Infinity;
  }
  if (geom.length === 1) {
    const p = toXY(geom[0]!.lat, geom[0]!.lon);
    return Math.hypot(p.x, p.y);
  }
  let best = Infinity;
  for (let i = 1; i < geom.length; i++) {
    const a = toXY(geom[i - 1]!.lat, geom[i - 1]!.lon);
    const b = toXY(geom[i]!.lat, geom[i]!.lon);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 0) {
      t = (-a.x * dx - a.y * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
    }
    const cx = a.x + t * dx;
    const cy = a.y + t * dy;
    const d = Math.hypot(cx, cy);
    if (d < best) best = d;
  }
  return best;
}

export type NearestLimit = {
  limitMph: number;
  /** Distance (m) from the truck to the winning way's line. */
  distM: number;
  highway: string | null;
  /** Road identity of the winning way, for continuity matching. */
  ref: string | null;
  name: string | null;
  wayId: number | null;
  /** Point on the winning way's line nearest the truck — where the
   *  truck is on that road, for display snapping. */
  snapped: LatLon;
  /** Directed bearing (deg) of the winning segment at that point. */
  bearingDeg: number | null;
  /** Match score (m-equivalent; distance plus/minus the penalties
   *  and bonuses in matchRoad). Lower is a better match. */
  scoreM: number;
};

/** What the matcher knows about the truck beyond its position —
 *  the signals that separate parallel roads (road test #3). All
 *  optional: with none of them the match degrades gracefully to the
 *  old nearest-line behaviour. */
export type RoadMatchContext = {
  /** GPS course over ground (deg, 0 = north). Only trusted while
   *  actually moving — callers pass null below ~8 mph, where a GPS
   *  heading wanders. */
  headingDeg?: number | null;
  /** Smoothed speed (mph), for the plausibility signal. */
  speedMph?: number | null;
  /** The road matched by the previous lookup — continuity. */
  prevHighway?: string | null;
  prevRef?: string | null;
  prevName?: string | null;
  prevLimitMph?: number | null;
};

export type RoadMatchOptions = RoadMatchContext & {
  /** A way whose LINE is farther than this is not claimed at all. */
  maxDistM?: number;
  /** Only consider ways carrying a parseable posted limit. */
  requireLimit?: boolean;
};

export type RoadMatch = {
  way: OsmWayLite;
  limitMph: number | null;
  highway: string | null;
  ref: string | null;
  name: string | null;
  distM: number;
  scoreM: number;
  snapped: LatLon;
  bearingDeg: number | null;
};

type SegmentHit = {
  distM: number;
  snapped: LatLon;
  /** Directed bearing (deg) of the segment, start → end node. */
  bearingDeg: number | null;
};

/** Nearest point on a way's polyline to `pos`, with the bearing of
 *  the segment it lands on — the geometric heart of matchRoad.
 *  Same local tangent plane as wayDistanceM. */
function nearestSegmentHit(pos: LatLon, way: OsmWayLite): SegmentHit | null {
  const latRad = (pos.lat * Math.PI) / 180;
  const mPerDegLat = (Math.PI / 180) * EARTH_R_M;
  const mPerDegLon = mPerDegLat * Math.cos(latRad);
  const toXY = (lat: number, lon: number): { x: number; y: number } => ({
    x: (lon - pos.lon) * mPerDegLon,
    y: (lat - pos.lat) * mPerDegLat,
  });
  const geom = way.geometry ?? [];
  if (geom.length === 0) {
    if (way.lat != null && way.lon != null) {
      const p = toXY(way.lat, way.lon);
      return {
        distM: Math.hypot(p.x, p.y),
        snapped: { lat: way.lat, lon: way.lon },
        bearingDeg: null,
      };
    }
    return null;
  }
  if (geom.length === 1) {
    const g = geom[0]!;
    const p = toXY(g.lat, g.lon);
    return { distM: Math.hypot(p.x, p.y), snapped: { lat: g.lat, lon: g.lon }, bearingDeg: null };
  }
  let best: SegmentHit | null = null;
  for (let i = 1; i < geom.length; i++) {
    const a = geom[i - 1]!;
    const b = geom[i]!;
    const pa = toXY(a.lat, a.lon);
    const pb = toXY(b.lat, b.lon);
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 0) {
      t = (-pa.x * dx - pa.y * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
    }
    const cx = pa.x + t * dx;
    const cy = pa.y + t * dy;
    const distM = Math.hypot(cx, cy);
    if (!best || distM < best.distM) {
      best = {
        distM,
        snapped: { lat: pos.lat + cy / mPerDegLat, lon: pos.lon + cx / mPerDegLon },
        bearingDeg: lenSq > 0 ? (Math.atan2(dx, dy) * 180) / Math.PI : null,
      };
    }
  }
  return best;
}

/** Smallest absolute turn between two bearings, in [0, 180]. */
function angularDiffDeg(a: number, b: number): number {
  const n = ((a - b) % 360 + 360) % 360;
  return Math.min(n, 360 - n);
}

/**
 * Match the truck to the road it is actually on, among `ways`.
 *
 * Score (metre-equivalents, lower wins) starts at the true distance
 * to the way's line, then:
 *   - heading: the way's direction at the nearest segment must
 *     agree with the truck's course. Two-way ways are judged on
 *     undirected alignment (a road running north–south matches
 *     travel either way); `oneway` ways are judged directionally,
 *     so the opposing carriageway of a divided highway scores up
 *     to +95 — it is the wrong road however close it runs. A
 *     crossing street (~90° off) scores +85 undirected.
 *   - continuity: matching the previously matched road's ref
 *     (−34) or name (−30), or at least its class (−12), pulls the
 *     score down; jumping to a different class while a previous
 *     match exists costs +14 of hysteresis. A match therefore only
 *     changes roads when the new road's evidence beats the old
 *     road's by a real margin — parallel-road flip-flop dies here.
 *   - plausibility at speed: at ≥50 mph a service/residential
 *     parallel scores +40 (and +22 for service at ≥35 mph); a way
 *     tagged ≤30 mph scores +20 against a truck sustaining ≥50.
 *     These never create or erase a limit — they only break ties
 *     between real mapped roads in favour of the one a truck at
 *     this speed can actually be on.
 * The distance cap is applied to the TRUE distance, before any
 * bonus: a road farther than maxDistM is never claimed, however
 * well it aligns.
 */
/** Continuity only breaks TIES (calibration, 2026-11-01 — road
 *  test #5): the previously matched road's bonus applies only when
 *  the way is within this many metres of the NEAREST candidate's
 *  distance. The old scoring let the −34 ref bonus rescue a road
 *  40 m+ farther than the one under the truck — a driver who left
 *  the interstate for its service road kept the interstate's limit
 *  (or none, when the geometry flipped) because the match was
 *  locked to the road driven a minute ago. Clear distance evidence
 *  now outranks history; inside the window, history still wins the
 *  flip-flop fight it was built for. */
export const CONTINUITY_WINDOW_M = 25;

export function matchRoad(
  pos: LatLon,
  ways: OsmWayLite[],
  opts: RoadMatchOptions = {},
): RoadMatch | null {
  const maxDistM = opts.maxDistM ?? 120;
  const heading = opts.headingDeg != null && Number.isFinite(opts.headingDeg) ? opts.headingDeg : null;
  const speed = opts.speedMph != null && Number.isFinite(opts.speedMph) ? opts.speedMph : null;
  // First pass: geometry for every eligible way, so the continuity
  // window can be judged against the nearest real candidate.
  type Cand = { w: OsmWayLite; tags: Record<string, string>; limitMph: number | null; hit: SegmentHit };
  const cands: Cand[] = [];
  for (const w of ways) {
    const tags = w.tags ?? {};
    const limitMph = wayLimitMph(tags);
    if (opts.requireLimit && limitMph == null) continue;
    const hit = nearestSegmentHit(pos, w);
    if (!hit || hit.distM > maxDistM) continue;
    cands.push({ w, tags, limitMph, hit });
  }
  if (cands.length === 0) return null;
  const nearestDistM = Math.min(...cands.map((c) => c.hit.distM));
  let best: RoadMatch | null = null;
  for (const { w, tags, limitMph, hit } of cands) {
    let score = hit.distM;
    if (heading != null && hit.bearingDeg != null) {
      const oneway = tags.oneway ?? tags["oneway:car"] ?? "";
      if (oneway === "yes" || oneway === "true" || oneway === "1" || oneway === "-1") {
        const wayBearing = oneway === "-1" ? hit.bearingDeg + 180 : hit.bearingDeg;
        const diff = angularDiffDeg(heading, wayBearing);
        score += diff <= 25 ? 0 : diff <= 60 ? 20 : diff <= 120 ? 55 : 95;
      } else {
        // Alignment error against the LINE (either direction of
        // travel along it is fine), in [0, 90]: 0 = parallel with
        // the truck's course, 90 = a crossing street.
        const lineErr = Math.min(
          angularDiffDeg(heading, hit.bearingDeg),
          angularDiffDeg(heading, hit.bearingDeg + 180),
        );
        score += lineErr <= 25 ? 0 : lineErr <= 50 ? 18 : lineErr <= 75 ? 48 : 85;
      }
    }
    if (speed != null) {
      const hw = tags.highway ?? "";
      if (speed >= 50 && (hw === "service" || hw === "residential" || hw === "living_street" || hw === "track")) score += 40;
      else if (speed >= 35 && hw === "service") score += 22;
      if (speed >= 50 && limitMph != null && limitMph <= 30) score += 20;
    }
    const ref = tags.ref ?? null;
    const name = tags.name ?? null;
    const hw = tags.highway ?? null;
    // Continuity (see CONTINUITY_WINDOW_M): the bonuses AND the
    // switch-away hysteresis only apply inside the tie window —
    // a candidate clearly farther than the nearest road gets
    // neither rescue nor penalty from history.
    const inContinuityWindow = hit.distM <= nearestDistM + CONTINUITY_WINDOW_M;
    if (inContinuityWindow) {
      if (opts.prevRef && ref && ref === opts.prevRef) score -= 34;
      else if (opts.prevName && name && name === opts.prevName) score -= 30;
      else if (opts.prevHighway && hw && hw === opts.prevHighway) score -= 12;
      if ((opts.prevRef || opts.prevName) && opts.prevHighway && hw && hw !== opts.prevHighway) {
        const identityMatch =
          (opts.prevRef && ref === opts.prevRef) || (opts.prevName && name === opts.prevName);
        if (!identityMatch) score += 14;
      }
    }
    const cand: RoadMatch = {
      way: w,
      limitMph,
      highway: hw,
      ref,
      name,
      distM: hit.distM,
      scoreM: score,
      snapped: hit.snapped,
      bearingDeg: hit.bearingDeg,
    };
    if (!best || cand.scoreM < best.scoreM || (cand.scoreM === best.scoreM && cand.distM < best.distM)) {
      best = cand;
    }
  }
  return best;
}

/**
 * The posted limit of the road the truck is on: among the ways that
 * carry a parseable limit, the best road match (see matchRoad).
 * A limit from a road farther than `maxDistM` is not claimed — at
 * that point the truck is off every mapped road in the result and
 * the honest answer is "no posted limit here".
 *
 * The third argument stays a plain number for the original call
 * shape; new callers pass the full options object (or a context as
 * the fourth argument) to bring heading/speed/continuity to bear.
 */
export function pickNearestLimit(
  pos: LatLon,
  ways: OsmWayLite[],
  maxDistOrOpts: number | RoadMatchOptions = 120,
  ctx: RoadMatchContext = {},
): NearestLimit | null {
  const opts: RoadMatchOptions =
    typeof maxDistOrOpts === "number"
      ? { ...ctx, maxDistM: maxDistOrOpts }
      : { ...ctx, ...maxDistOrOpts };
  const m = matchRoad(pos, ways, { ...opts, requireLimit: true });
  if (!m || m.limitMph == null) return null;
  return {
    limitMph: m.limitMph,
    distM: m.distM,
    highway: m.highway,
    ref: m.ref,
    name: m.name,
    wayId: m.way.id ?? null,
    snapped: m.snapped,
    bearingDeg: m.bearingDeg,
    scoreM: m.scoreM,
  };
}

/** The highway class of the best-matched way, limit or not — the
 *  input to the labelled-estimate fallback. Scored by the same
 *  matchRoad, so the estimate is about the road the truck is ON,
 *  not whichever line happens to be a metre closer this fix. */
export function nearestHighwayClass(
  pos: LatLon,
  ways: OsmWayLite[],
  maxDistOrOpts: number | RoadMatchOptions = 120,
  ctx: RoadMatchContext = {},
): { highway: string; distM: number; ref: string | null; name: string | null } | null {
  const opts: RoadMatchOptions =
    typeof maxDistOrOpts === "number"
      ? { ...ctx, maxDistM: maxDistOrOpts }
      : { ...ctx, ...maxDistOrOpts };
  const m = matchRoad(pos, ways, opts);
  if (!m || !m.highway) return null;
  return { highway: m.highway, distM: m.distM, ref: m.ref, name: m.name };
}

/** Course over ground (deg) implied by a breadcrumb of fixes —
 *  the heading signal for the matcher when the platform reports no
 *  heading of its own. Uses the oldest→newest span so a couple of
 *  jittery fixes can't swing it; null when the span is too short
 *  (<15 m) to mean anything. */
export function trackHeadingDeg(shape: LatLon[]): number | null {
  if (shape.length < 2) return null;
  const a = shape[0]!;
  const b = shape[shape.length - 1]!;
  const latRad = (a.lat * Math.PI) / 180;
  const mPerDegLat = (Math.PI / 180) * EARTH_R_M;
  const mPerDegLon = mPerDegLat * Math.cos(latRad);
  const dx = (b.lon - a.lon) * mPerDegLon;
  const dy = (b.lat - a.lat) * mPerDegLat;
  if (Math.hypot(dx, dy) < 15) return null;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

/**
 * Overspeed-alert stabilizer (road test #3: one bad parallel-road
 * match showed LIMIT 55 at 69 mph and instantly fired the red
 * banner, the beep, the voice alert, and a sealed safety event —
 * a single lookup's mistake became an accusation). The DISPLAY
 * still updates the moment a posted limit lands; the ALERT input
 * is stricter: a limit only becomes alert-eligible after TWO
 * consecutive lookups agree on it. A changed limit drops the old
 * alert input back to null until the new one confirms — during a
 * genuine road change the banner simply waits one lookup cycle
 * (≤30 s) instead of risking a false one, and a one-off wrong
 * match can never fire it at all.
 */
export class PostedLimitStabilizer {
  private candidateLimit: number | null = null;
  private candidateCount = 0;
  private confirmedLimit: number | null = null;

  reset(): void {
    this.candidateLimit = null;
    this.candidateCount = 0;
    this.confirmedLimit = null;
  }

  /** Feed one posted-limit answer. Returns what to display (the
   *  answer itself, immediately) and what may feed the overspeed
   *  alert (the confirmed limit, or null while unconfirmed). */
  push(limitMph: number): { displayMph: number; alertMph: number | null } {
    if (this.candidateLimit === limitMph) {
      this.candidateCount += 1;
    } else {
      this.candidateLimit = limitMph;
      this.candidateCount = 1;
      if (this.confirmedLimit !== limitMph) this.confirmedLimit = null;
    }
    if (this.candidateCount >= 2) this.confirmedLimit = limitMph;
    return { displayMph: limitMph, alertMph: this.confirmedLimit };
  }

  /** The currently confirmed alert limit, if any. */
  get alertMph(): number | null {
    return this.confirmedLimit;
  }

  /** Alert input for a HELD (last-known) limit: the held number
   *  may feed the alert only if it is the confirmed one — a limit
   *  that never confirmed does not gain alert powers by being
   *  held on screen. */
  alertFor(limitMph: number): number | null {
    return this.confirmedLimit === limitMph ? limitMph : null;
  }
}

export function createPostedLimitStabilizer(): PostedLimitStabilizer {
  return new PostedLimitStabilizer();
}

/**
 * Labelled-estimate fallback, used ONLY when the nearest road is
 * mapped but carries no posted-limit tag. US interstate-class roads
 * (OSM `motorway`) are signed 70 mph across most of the states this
 * app's drivers run, and never below 55 — so the estimate is shown
 * with a "~" and an EST label, and it NEVER feeds the overspeed
 * alert, which needs a real posted limit. Every other road class
 * gets no estimate: a guessed limit on a two-lane or a city street
 * would be a fabrication, so the box honestly shows no data there.
 */
export function estimateLimitMph(highway: string | null): number | null {
  if (highway === "motorway") return 70;
  return null;
}

/** Great-circle distance in miles between two fixes. */
export function distanceMi(a: LatLon, b: LatLon): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la = (a.lat * Math.PI) / 180;
  const lb = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 3958.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Re-query throttle — the anti-starvation rule (driver report
 * 2026-10-29: LIMIT "––" for a whole I-10 drive at 79 mph, again).
 *
 * The previous rule re-queried whenever the truck had moved
 * > 0.08 mi OR 30 s had passed. At highway speed 0.08 mi is ~4 s,
 * but a lookup takes far longer than that whenever it has to fall
 * back to the public Overpass instances (measured 2026-10-29:
 * 15–40 s of sequential instance failover server-side). Every new
 * fix therefore started a new lookup, the sequence guard discarded
 * the previous lookup's answer as stale when it finally landed,
 * and the readout sat in "loading" forever — no answer EVER
 * landed, moving or parked (parked re-fired every 30 s against the
 * same > 30 s latency). A lookup must be given time to finish:
 *
 *   - nothing queried yet → due;
 *   - 30 s since the last query STARTED → due (the standing
 *     refresh, now also the minimum life a slow lookup is
 *     guaranteed before anything can supersede it on time alone);
 *   - moved > 0.08 mi AND at least 15 s since the last start → due
 *     (limits change at road changes, not every few seconds);
 *   - moved > 0.6 mi → due immediately (a different road for
 *     sure — and a re-query is also what re-judges whether the
 *     last-known hold still applies on the road now under the
 *     truck; see lastKnownHoldApplies).
 *
 * The caller additionally never starts a second lookup while one
 * is in flight (see querySpeedLimit in App.tsx): the in-flight
 * answer always lands, and one follow-up runs for the newest
 * position when it finishes.
 */
export function speedLimitQueryDue(
  last: { at: number; lat: number; lon: number },
  nowMs: number,
  pos: LatLon,
): boolean {
  if (!last.at) return true;
  const elapsed = nowMs - last.at;
  if (elapsed >= 30_000) return true;
  const dist = distanceMi({ lat: last.lat, lon: last.lon }, pos);
  if (dist > 0.6) return true;
  if (dist > 0.08 && elapsed >= 15_000) return true;
  return false;
}

// ---- The 2026-11-09 LIMIT fix ---------------------------------------
// Fifth report (overnight I-65 drive, driver's own screenshots):
// LIMIT "––" with NO caption at 2:55 AM — and LIMIT 70 one minute
// later, same road, same speed. The data existed the whole time
// (OSM tags 70 on every mainline way; Valhalla returns 70); the
// blank was LATENCY: the public Overpass instances measured 28 s+,
// 502s, and >100 s no-answers that day, the server action call
// carried no client-side deadline, and the "loading"/"idle" states
// rendered "––" with no caption at all, so a working-but-slow
// lookup read as a broken sign. At the Tyson Rd / I-65 Exit 158
// lot the local roads genuinely carry no maxspeed — an honest
// "no data" there, except that answer hadn't landed either.
// Three repairs, all pure and pinned by speedLimit.test.ts:
//
//   1. BOUNDED LOOKUP + VISIBLE LOADING — one hard budget
//      (SPEED_LIMIT_LOOKUP_BUDGET_MS) end to end: the client races
//      the server action against the remaining budget
//      (raceDeadline) and races each direct-path call the same
//      way; when the budget expires with no answer the ladder
//      settles (last-known / EST / NO LIMIT DATA) instead of
//      holding "loading" forever. The server ladder carries its
//      own matching deadline (server/src/speedLimit.ts). While a
//      lookup has been in flight past SPEED_LIMIT_CHECKING_AFTER_MS
//      the sign captions the wait "CHECKING…" — a bare
//      caption-less "––" never persists (limitBadgeCaption).
//   2. WIDER LAST KNOWN HOLD — the old window (posted <3 min old
//      AND <0.5 mi away) expired mid-stretch against measured
//      provider latency. The hold now follows ROAD CONTINUITY
//      (lastKnownHoldApplies): while answered lookups keep
//      identifying the same road the truck is on (same ref, same
//      name, or same class with no conflicting ref), the last
//      posted limit stays up, labelled LAST KNOWN, with no time
//      cap. A genuine road change (different class, or a
//      different ref) drops it at once, and a held limit is never
//      borrowed across road classes. Only when neither side can
//      identify the road does the old freshness window decide.
//   3. PARKED SETTLE — at ~0 mph, once one lookup has ANSWERED
//      "no data" (the Exit 158 lot), the readout settles to
//      NO LIMIT DATA and the normal moving cadence stops
//      re-firing the slow chain (parkedSettleActive) until the
//      truck moves again or leaves the spot.

/** Hard end-to-end budget for ONE speed-limit lookup, client
 *  side. The fast Valhalla answer lands in ~2 s; the budget only
 *  ever binds on the slow Overpass failover — and when it binds,
 *  the ladder settles instead of the badge sitting blank. */
export const SPEED_LIMIT_LOOKUP_BUDGET_MS = 20_000;

/** A lookup in flight longer than this captions the LIMIT sign
 *  "CHECKING…" — the wait is labelled, never a bare "––". */
export const SPEED_LIMIT_CHECKING_AFTER_MS = 3_000;

/** Race a promise against a deadline: resolves with the
 *  promise's value, or null when the deadline passes first.
 *  Handlers stay attached to the original promise, so a late
 *  answer (or failure) is safely dropped, never applied and
 *  never an unhandled rejection. */
export function raceDeadline<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve(null);
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/** The caption under the LIMIT sign — EVERY badge state carries
 *  one (2026-11-09 fix). A posted number speaks for itself (no
 *  caption, as always); the fallback rungs keep their labels; a
 *  lookup in flight past the checking threshold says CHECKING…;
 *  an answered "nothing here" says NO LIMIT DATA; and before the
 *  first GPS fix — when no lookup has ever started — the sign
 *  says WAITING FOR GPS instead of sitting at a bare "––" for
 *  as long as the fix takes. The only caption-less blank is the
 *  first ~3 s of an in-flight lookup: a transient, never a state
 *  the sign can rest in. */
export function limitBadgeCaption(args: {
  limitMph: number | null;
  source: "posted" | "last" | "est" | null;
  state: "idle" | "loading" | "ok" | "unavailable";
  /** The current lookup has been in flight past
   *  SPEED_LIMIT_CHECKING_AFTER_MS. */
  checking: boolean;
}): string | null {
  if (args.limitMph != null) {
    if (args.source === "est") return "EST — NO POSTED DATA";
    if (args.source === "last") return "LAST KNOWN LIMIT";
    return null;
  }
  if (args.state === "unavailable" || args.state === "ok") return "NO LIMIT DATA";
  // No fix yet → no lookup has ever started: say what's being
  // waited on, honestly, for however long the fix takes.
  if (args.state === "idle") return "WAITING FOR GPS";
  // loading: in flight — labelled once past the checking line.
  return args.checking ? "CHECKING…" : null;
}

/** Road identity for continuity judgements — the class, route
 *  ref (e.g. "I-65"), and name a lookup matched, any of which may
 *  be unknown on a given rung (Valhalla answers class only). */
export type RoadIdentity = {
  highway: string | null;
  ref: string | null;
  name: string | null;
};

/** Same road, different road, or can't tell (null)?
 *  - Different CLASSES are always different roads — a held limit
 *    is never borrowed across classes.
 *  - When both sides name a route ref, the ref decides (I-65 →
 *    I-10 is a road change even though both are motorways).
 *  - Otherwise a shared name, or a shared class with no ref
 *    conflict, is the same road.
 *  - When either side identifies nothing, continuity can't be
 *    judged from identity at all → null. */
export function sameRoadContinuity(
  a: RoadIdentity | null,
  b: RoadIdentity | null,
): boolean | null {
  if (!a || !b) return null;
  if (a.highway && b.highway && a.highway !== b.highway) return false;
  if (a.ref && b.ref) return a.ref === b.ref;
  if (a.name && b.name) return a.name === b.name;
  if (a.highway && b.highway) return true; // classes equal (checked above), no ref conflict
  return null;
}

/** The last POSTED limit found, with where/when and the road it
 *  was posted on — the input to the LAST KNOWN hold. */
export type LastPostedLimit = {
  mph: number;
  at: number;
  lat: number;
  lon: number;
  road: RoadIdentity;
};

/** The freshness window that decides the hold ONLY when road
 *  continuity can't be judged (the pre-2026-11-09 rule). */
export const LAST_KNOWN_FRESH_MS = 180_000;
export const LAST_KNOWN_FRESH_MI = 0.5;

/**
 * May the last posted limit stay on the sign (labelled LAST
 * KNOWN) after a lookup answered "no posted limit here" — or
 * failed outright (`currentRoad` null)?
 *
 * With an answered road identity, continuity rules: same road →
 * hold with NO time/distance cap (the hold ends when a new
 * answer lands or the road changes, and every re-query
 * re-judges it against the newest answer); different road →
 * drop at once. Without one, the old freshness window decides,
 * so a stale city limit still can't ride onto the interstate.
 */
export function lastKnownHoldApplies(
  last: LastPostedLimit | null,
  nowMs: number,
  pos: LatLon,
  currentRoad: RoadIdentity | null,
): boolean {
  if (!last) return false;
  const cont = sameRoadContinuity(last.road, currentRoad);
  if (cont === true) return true;
  if (cont === false) return false;
  return nowMs - last.at < LAST_KNOWN_FRESH_MS && distanceMi(last, pos) < LAST_KNOWN_FRESH_MI;
}

/** Parked settle radius: GPS wander inside a lot stays "here";
 *  leaving the lot releases the settle. */
export const PARKED_SETTLE_RADIUS_MI = 0.05;
/** At or above this speed the truck is moving again — the
 *  settle releases and lookups resume their normal cadence. */
export const PARKED_SETTLE_MAX_SPEED_MPH = 3;

/**
 * Is the parked no-data settle still in force? Set when a lookup
 * ANSWERS "no data" while the truck is parked (~0 mph, e.g. a
 * lot off Tyson Rd at I-65 Exit 158, where no nearby road carries
 * a maxspeed tag at all): the sign settles to NO LIMIT DATA and
 * stays there — the slow full lookup chain does not re-fire on
 * the moving cadence — until the truck moves again or leaves
 * the spot (the road context changed). A FAILED lookup never
 * sets this: offline is not "no data", and retries continue.
 */
export function parkedSettleActive(
  settle: { lat: number; lon: number } | null,
  pos: LatLon,
  speedMph: number | null,
): boolean {
  if (!settle) return false;
  if (speedMph != null && speedMph >= PARKED_SETTLE_MAX_SPEED_MPH) return false;
  return distanceMi(settle, pos) <= PARKED_SETTLE_RADIUS_MI;
}
