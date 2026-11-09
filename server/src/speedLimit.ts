// Speed-limit lookup — SERVER ONLY.
//
// Why this exists (driver reports, 2026-10-27 and 2026-10-28): the
// LIMIT box read "––" for whole drives even on I-10. The lookup ran
// from the phone's webview against the single public Overpass
// instance overpass-api.de — and that one host is a single point of
// failure: it answers some networks with HTTP 406 (its mod_security
// IP rules; verified 2026-10-28 — every request from this host,
// including /api/status, is refused in ~1 s, browser UA or not),
// crawls under load at others, and when it fails the client has
// nowhere else to go. The server path is the one that demonstrably
// reaches the phone (the TomTom layer rides it), so the lookup now
// runs here.
//
// Third report (2026-10-29, screenshot: 79 mph on I-10 at Carol
// Plantation Rd, LIMIT "––", no NO-LIMIT-DATA caption — the readout
// was stuck in "loading", never reaching any answer): the previous
// build put Valhalla LAST, behind two sequential Overpass passes.
// Measured again 2026-10-29 from this host: overpass-api.de 406/502
// in ~1–2 s, kumi.systems 20.5 s for one small query (past the 8 s
// per-attempt cap, so aborted), private.coffee > 30 s, nchc closed
// the connection — a server answer took ~40 s when it came at all,
// while the client re-fired a new lookup every ~0.08 mi (~4 s at
// highway speed) and its sequence guard discarded every late
// answer as stale. NO answer could ever land. Two fixes:
//
//   - Valhalla runs FIRST whenever the client sent a breadcrumb
//     shape (≥2 fixes): it map-matches the DRIVEN road and answers
//     in ~2 s (verified live 2026-10-29 on the exact screenshot
//     stretch: I-10 at Carol Plantation Rd, Mobile AL → edges
//     89 → 113 → 113 km/h, current edge 113 = 70 mph posted). Its
//     speed_limit is the same OSM maxspeed data Overpass serves.
//     Only when Valhalla cannot answer (no shape, no match, host
//     down) does the Overpass chain below run.
//   - The client no longer starves lookups (15 s / 0.6 mi minimum
//     re-query life + an in-flight guard; see
//     client/src/speedLimit.ts speedLimitQueryDue).
//
// Fifth report (2026-11-09, the LIMIT fix): on the driver's
// overnight I-65 run the sign sat at a bare "––" again — but this
// time the segment data was proven present (OSM tags 70 on all 68
// mainline ways; Valhalla returns 70), and the same stretch showed
// 70 one minute later. The failure was pure latency: the public
// Overpass instances measured 28 s+, 502s, and >100 s no-answers,
// and this ladder could spend ~30 s+ per pass × up to three passes
// before answering anything. The whole lookup now runs against
// ONE deadline (LOOKUP_BUDGET_MS, just inside the client's 20 s
// end-to-end budget): every fetch's timeout is the time left,
// passes stop when the budget is spent, and the ladder returns
// whatever it honestly has by then — an answered "no data" (with
// the matched road's identity, so the client's same-road LAST
// KNOWN hold can judge continuity) or available:false — instead
// of holding the badge hostage.
//
// The Overpass fallback keeps its discipline:
//
//   - FOUR full-planet public Overpass instances, tried in order,
//     the last one that answered goes first next time — one blocked
//     or sick instance can no longer kill the feature.
//   - A descriptive User-Agent (Overpass's usage policy asks for
//     one; browsers cannot set it, servers can).
//   - A 3-minute cache per ~110 m grid cell, so a truck rolling
//     down one road costs the providers a handful of calls,
//     not one per GPS fix.
//   - Cheap queries: ways CARRYING a maxspeed tag first (a fraction
//     of the data of "every highway way with geometry"), widening
//     once, and a small class-only query last for the labelled
//     interstate estimate.
//
// The selection math (parse a maxspeed tag, distance from the truck
// to a way's LINE, nearest tagged way wins, motorway-only estimate)
// mirrors client/src/speedLimit.ts exactly — that module is the
// unit-tested original; this copy exists because server code cannot
// import the client bundle. The honesty rules are identical: a limit
// is only ever a real OSM maxspeed tag on the nearest mapped road,
// the ~70 EST is motorway-class only and display-only, and anything
// else answers "no data" rather than inventing a number.

export type SpeedLimitResult = {
  /** false = every instance failed (offline / all down); the client
   *  then runs its own direct failover chain before giving up. */
  available: boolean;
  /** Posted limit (mph) of the nearest maxspeed-tagged way, or null. */
  limitMph: number | null;
  /** Labelled estimate for a mapped motorway with no limit tag —
   *  display only, never an overspeed input. Null for other roads. */
  estMph: number | null;
  /** Highway class of the nearest mapped way, when known. */
  highway: string | null;
  /** Road identity (OSM ref / name) of the matched way, when the
   *  Overpass rung supplied it — the client's continuity key for
   *  parallel-road matching AND for the same-road LAST KNOWN hold
   *  (2026-11-09: the class-only answer carries it too, so a
   *  no-posted-limit stretch can still prove it is the same road
   *  the held limit was posted on). Null on the Valhalla rung. */
  roadRef: string | null;
  roadName: string | null;
};

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.nchc.org.tw/api/interpreter",
];
let goodEndpoint = 0;
const PER_ATTEMPT_MS = 8_000;

/** The whole lookup's budget (2026-11-09 LIMIT fix): the client
 *  holds the end-to-end line at ~20 s (client/src/speedLimit.ts
 *  SPEED_LIMIT_LOOKUP_BUDGET_MS); this ladder answers inside
 *  18 s so a real answer can still land before the client's
 *  deadline drops it. */
export const LOOKUP_BUDGET_MS = 18_000;

/** Time left before the deadline, floored at 0. */
function budgetLeftMs(deadlineAt: number): number {
  return Math.max(0, deadlineAt - Date.now());
}

type OsmWayLite = {
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
  lat?: number;
  lon?: number;
};

async function overpassServer(
  query: string,
  deadlineAt: number,
): Promise<{ elements?: OsmWayLite[] } | null> {
  for (let n = 0; n < OVERPASS_ENDPOINTS.length; n++) {
    // Budget spent: stop starting attempts the deadline would
    // only abort — the ladder settles with what it has.
    const left = budgetLeftMs(deadlineAt);
    if (left <= 750) return null;
    const idx = (goodEndpoint + n) % OVERPASS_ENDPOINTS.length;
    const url = OVERPASS_ENDPOINTS[idx];
    if (!url) continue;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "STONEMILES speed-limit lookup (OpenStreetMap Overpass)",
          Accept: "application/json",
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(Math.min(PER_ATTEMPT_MS, left)),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { elements?: OsmWayLite[] };
      goodEndpoint = idx;
      return data;
    } catch {
      // This instance is blocked, down, or too slow — try the next.
    }
  }
  return null;
}

// ---- Selection math (mirror of client/src/speedLimit.ts) -----------

function parseMaxspeedMph(raw: string | undefined): number | null {
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

function wayLimitMph(tags: Record<string, string> | undefined): number | null {
  if (!tags) return null;
  return (
    parseMaxspeedMph(tags.maxspeed) ??
    parseMaxspeedMph(tags["maxspeed:forward"]) ??
    parseMaxspeedMph(tags["maxspeed:backward"]) ??
    parseMaxspeedMph(tags["maxspeed:lanes"])
  );
}

const EARTH_R_M = 6371000;

function wayDistanceM(
  pos: { lat: number; lon: number },
  way: OsmWayLite,
): number {
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
    const d = Math.hypot(a.x + t * dx, a.y + t * dy);
    if (d < best) best = d;
  }
  return best;
}

/** Bearing (deg) of a way's segment nearest `pos`, directed along
 *  the way's node order — the heading signal for the score below.
 *  Road test #3 (2026-10-30): distance-only selection flip-flops
 *  between parallel roads (interstate vs frontage) inside GPS
 *  noise; the truck's course and the road's direction are what
 *  actually tell the carriageways apart. Mirrors the scoring in
 *  client/src/speedLimit.ts (matchRoad), minus the continuity
 *  bonus — the server is stateless per call, so continuity lives
 *  on the client; heading comes from the breadcrumb shape. */
function nearestSegmentBearingDeg(
  pos: { lat: number; lon: number },
  way: OsmWayLite,
): number | null {
  const geom = way.geometry ?? [];
  if (geom.length < 2) return null;
  const latRad = (pos.lat * Math.PI) / 180;
  const mPerDegLat = (Math.PI / 180) * EARTH_R_M;
  const mPerDegLon = mPerDegLat * Math.cos(latRad);
  const toXY = (lat: number, lon: number): { x: number; y: number } => ({
    x: (lon - pos.lon) * mPerDegLon,
    y: (lat - pos.lat) * mPerDegLat,
  });
  let bestD = Infinity;
  let bearing: number | null = null;
  for (let i = 1; i < geom.length; i++) {
    const a = toXY(geom[i - 1]!.lat, geom[i - 1]!.lon);
    const b = toXY(geom[i]!.lat, geom[i]!.lon);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 0) {
      t = Math.max(0, Math.min(1, (-a.x * dx - a.y * dy) / lenSq));
    }
    const d = Math.hypot(a.x + t * dx, a.y + t * dy);
    if (d < bestD) {
      bestD = d;
      bearing = lenSq > 0 ? ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360 : null;
    }
  }
  return bearing;
}

function angularDiffDeg(a: number, b: number): number {
  const n = ((a - b) % 360 + 360) % 360;
  return Math.min(n, 360 - n);
}

/** Heading penalty (m-equivalent) for a candidate way — same table
 *  as the client's matchRoad: one-way ways judged directionally
 *  (the opposing carriageway is the wrong road), others against
 *  the line in either direction (a crossing street ≈ +85). */
function headingPenaltyM(
  headingDeg: number | null,
  bearingDeg: number | null,
  tags: Record<string, string> | undefined,
): number {
  if (headingDeg == null || bearingDeg == null) return 0;
  const oneway = tags?.oneway ?? "";
  if (oneway === "yes" || oneway === "true" || oneway === "1" || oneway === "-1") {
    const wayBearing = oneway === "-1" ? bearingDeg + 180 : bearingDeg;
    const diff = angularDiffDeg(headingDeg, wayBearing);
    return diff <= 25 ? 0 : diff <= 60 ? 20 : diff <= 120 ? 55 : 95;
  }
  const lineErr = Math.min(
    angularDiffDeg(headingDeg, bearingDeg),
    angularDiffDeg(headingDeg, bearingDeg + 180),
  );
  return lineErr <= 25 ? 0 : lineErr <= 50 ? 18 : lineErr <= 75 ? 48 : 85;
}

export function pickNearestLimit(
  pos: { lat: number; lon: number },
  ways: OsmWayLite[],
  maxDistM: number,
  headingDeg: number | null = null,
): { limitMph: number; highway: string | null; ref: string | null; name: string | null } | null {
  let best: {
    limitMph: number;
    distM: number;
    scoreM: number;
    highway: string | null;
    ref: string | null;
    name: string | null;
  } | null = null;
  for (const w of ways) {
    const limitMph = wayLimitMph(w.tags);
    if (limitMph == null) continue;
    const distM = wayDistanceM(pos, w);
    if (distM > maxDistM) continue;
    const scoreM = distM + headingPenaltyM(headingDeg, nearestSegmentBearingDeg(pos, w), w.tags);
    if (!best || scoreM < best.scoreM) {
      best = {
        limitMph,
        distM,
        scoreM,
        highway: w.tags?.highway ?? null,
        ref: w.tags?.ref ?? null,
        name: w.tags?.name ?? null,
      };
    }
  }
  return best;
}

export function nearestHighwayClass(
  pos: { lat: number; lon: number },
  ways: OsmWayLite[],
  maxDistM = 120,
  headingDeg: number | null = null,
): { highway: string; ref: string | null; name: string | null } | null {
  let best: { highway: string; ref: string | null; name: string | null; distM: number; scoreM: number } | null = null;
  for (const w of ways) {
    const hw = w.tags?.highway;
    if (!hw) continue;
    const distM = wayDistanceM(pos, w);
    if (distM > maxDistM) continue;
    const scoreM = distM + headingPenaltyM(headingDeg, nearestSegmentBearingDeg(pos, w), w.tags);
    if (!best || scoreM < best.scoreM) {
      best = { highway: hw, ref: w.tags?.ref ?? null, name: w.tags?.name ?? null, distM, scoreM };
    }
  }
  return best ? { highway: best.highway, ref: best.ref, name: best.name } : null;
}

/** Course over ground (deg) implied by the breadcrumb shape —
 *  null when the span is under 15 m. */
export function trackHeadingDeg(shape: { lat: number; lon: number }[]): number | null {
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

// ---- Valhalla map-matching rung (the FIRST rung since 2026-10-29) ----
// The app's ROUTER is the primary witness: valhalla1.openstreetmap.de
// demonstrably answers (it plans every route in the app, ~2 s) and
// its trace_attributes map-matches the truck's recent GPS fixes to
// the road actually being driven, returning that edge's speed_limit
// (OSM-sourced, km/h) and road class. Verified live 2026-10-28 on the
// driver's own ground: a shape along I-10 in Alabama matched motorway
// edges with speed_limit 113 (= 70 mph); along Halls Mill Rd it
// matched the tertiary road by name — and re-verified 2026-10-29 on
// the exact stretch in the driver's screenshot (I-10 at Carol
// Plantation Rd, Mobile AL): edges 89 → 113 → 113 km/h. Edges come
// back in path order, so the truck's CURRENT road is at the END of
// the list — the scan walks backwards from there for the first edge
// carrying a limit, and takes the road class from that same stretch.
// A matched road with no limit still answers the class question (the
// EST rung), honestly labelled downstream.

const VALHALLA_TRACE_URL = "https://valhalla1.openstreetmap.de/trace_attributes";

const VALHALLA_CLASS_TO_OSM: Record<string, string> = {
  motorway: "motorway",
  trunk: "trunk",
  primary: "primary",
  secondary: "secondary",
  tertiary: "tertiary",
  unclassified: "unclassified",
  residential: "residential",
  service_other: "service",
  other_service: "service",
};

type ValhallaEdge = { speed_limit?: number; road_class?: string };

/**
 * Choose the truck's CURRENT limit from a Valhalla edge list
 * (edges arrive in path order; the truck is at the END).
 *
 * Road test #3 fix (2026-10-30): the old scan walked backwards
 * WITHOUT LIMIT until it found ANY edge carrying a speed_limit —
 * across road changes. Rolling from a 55 mph road onto the
 * interstate (or across a ramp/frontage stretch whose own edge
 * carries no tag), the first tagged edge behind the truck could
 * be the PREVIOUS road, and its 55 became the interstate's
 * displayed limit — at 69 mph, a false over-limit banner. The
 * scan now stays on the current road: it walks back at most 3
 * edges and stops at the first edge whose road class differs
 * from the current (last) edge's class. A limit found there is
 * the current road's own; otherwise the rung honestly reports
 * "no posted limit on this road" plus the current class, and
 * the client's last-known / EST ladder takes it from there.
 * Pure and exported so the rule is unit-testable without the
 * router (see speedLimit.test.ts in this folder).
 */
export function selectValhallaLimit(
  edges: ValhallaEdge[],
): { limitMph: number | null; highway: string | null } | null {
  if (edges.length === 0) return null;
  const classOf = (e: ValhallaEdge): string | null =>
    e.road_class ? (VALHALLA_CLASS_TO_OSM[e.road_class] ?? null) : null;
  const currentClass = classOf(edges[edges.length - 1]!);
  const maxBack = Math.min(edges.length, 3);
  for (let back = 0; back < maxBack; back++) {
    const e = edges[edges.length - 1 - back]!;
    const cls = classOf(e);
    // A differently-classed edge is a different road (ramp, frontage,
    // the street before the turn) — its limit is not this road's.
    if (back > 0 && cls !== currentClass) break;
    if (typeof e.speed_limit === "number" && e.speed_limit > 0) {
      return { limitMph: Math.round(e.speed_limit * 0.621371), highway: cls ?? currentClass };
    }
  }
  return { limitMph: null, highway: currentClass };
}

async function fetchValhallaLimit(
  shape: { lat: number; lon: number }[],
  timeoutMs: number,
): Promise<{ limitMph: number | null; highway: string | null } | null> {
  if (shape.length < 2) return null;
  if (timeoutMs <= 0) return null;
  try {
    const res = await fetch(VALHALLA_TRACE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shape: shape.map((p) => ({ lat: p.lat, lon: p.lon })),
        costing: "auto",
        shape_match: "map_snap",
        filters: {
          attributes: ["edge.speed_limit", "edge.road_class"],
          action: "include",
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { edges?: ValhallaEdge[] };
    return selectValhallaLimit(data.edges ?? []);
  } catch {
    return null;
  }
}

// ---- Cache ----------------------------------------------------------
// ~110 m grid, 3 minutes: a stretch of road is one cell sequence, and
// a posted limit does not change while a truck crosses it. Only
// ANSWERED lookups are cached — a total failure retries next time.

const CACHE_MS = 3 * 60_000;
const cache = new Map<string, { at: number; result: SpeedLimitResult }>();

/**
 * Cache key — road test #3: the cell alone is NOT a road. At an
 * interchange or along a frontage pair, two different roads with
 * different limits cross the SAME ~110 m cell; a cell-only key
 * served whichever road was looked up first to trucks on the
 * other one for up to 3 minutes. The key now also carries the
 * truck's course bucket (8-wind, from the breadcrumb shape): a
 * northbound interstate truck and a southbound frontage truck in
 * the same cell are different lookups. No shape yet → the plain
 * cell bucket, as before.
 */
export function cacheKeyFor(lat: number, lon: number, headingDeg: number | null): string {
  const cell = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  if (headingDeg == null) return cell;
  const bucket = Math.floor((((headingDeg % 360) + 360) % 360) / 45) % 8;
  return `${cell}@${bucket}`;
}

/** Crude bound on the cache: drop the oldest entries first
 *  (insertion order) once it grows past 300 cells. */
function trimCache(): void {
  if (cache.size <= 300) return;
  for (const k of cache.keys()) {
    cache.delete(k);
    if (cache.size <= 200) break;
  }
}

// ---- The lookup ------------------------------------------------------

export async function fetchSpeedLimit(
  lat: number,
  lon: number,
  shape: { lat: number; lon: number }[] = [],
): Promise<SpeedLimitResult> {
  const headingDeg = trackHeadingDeg(shape);
  const key = cacheKeyFor(lat, lon, headingDeg);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.result;

  const pos = { lat, lon };
  // The whole ladder runs against ONE deadline (2026-11-09 LIMIT
  // fix): when the budget is spent the lookup answers with what
  // it honestly has instead of starting another slow pass.
  const deadlineAt = Date.now() + LOOKUP_BUDGET_MS;

  // Rung 1 — Valhalla map-match, FIRST (2026-10-29 reorder; see the
  // header). When the client sent a breadcrumb shape and the router
  // matches it to a driven edge, that answer — posted limit, or the
  // road class for the labelled estimate — is complete on its own:
  // the edge's speed_limit IS the OSM maxspeed of the road being
  // driven, so a slower Overpass pass could only repeat it (or, on
  // an untagged road, tempt a number off a NEIGHBOURING road — the
  // exact error the nearest-way math exists to prevent). The answer
  // lands in ~2 s instead of after ~40 s of instance failover.
  if (shape.length >= 2) {
    const v = await fetchValhallaLimit(shape, Math.min(9_000, budgetLeftMs(deadlineAt)));
    if (v) {
      const result: SpeedLimitResult = {
        available: true,
        limitMph: v.limitMph,
        estMph: v.limitMph == null && v.highway === "motorway" ? 70 : null,
        highway: v.highway,
        roadRef: null,
        roadName: null,
      };
      cache.set(key, { at: Date.now(), result });
      trimCache();
      return result;
    }
    // No match / router unreachable — fall through to Overpass.
  }

  // Rung 2 — Overpass chain (no shape yet, or Valhalla could not
  // answer): tagged ways near the point, best road match wins
  // (distance + heading — see pickNearestLimit). The acceptance
  // cap stays 120 m at BOTH radii (road test #3): the wider query
  // exists so a way whose nodes sit farther out still returns its
  // geometry, NOT so a limit can be claimed off a road 200 m
  // away — at an interchange that is a different road entirely.
  let answered = false;
  let posted: { limitMph: number; highway: string | null; ref: string | null; name: string | null } | null = null;
  for (const radius of [200, 500]) {
    if (budgetLeftMs(deadlineAt) <= 750) break; // budget spent — settle with what we have
    const q =
      `[out:json][timeout:12];` +
      `way(around:${radius},${lat},${lon})[highway][maxspeed];` +
      `out tags geom 40;`;
    const data = await overpassServer(q, deadlineAt);
    if (data === null) continue; // every instance failed (or the budget ran out) on this pass
    answered = true;
    posted = pickNearestLimit(pos, data.elements ?? [], 120, headingDeg);
    if (posted) break;
  }

  let result: SpeedLimitResult;
  if (posted) {
    result = {
      available: true,
      limitMph: posted.limitMph,
      estMph: null,
      highway: posted.highway,
      roadRef: posted.ref,
      roadName: posted.name,
    };
  } else if (answered && budgetLeftMs(deadlineAt) > 750) {
    // The road network answered but no tagged limit is near: one
    // small class-only query decides the labelled motorway
    // estimate — and names the road it matched, so the client's
    // same-road LAST KNOWN hold can judge continuity on this
    // stretch too (2026-11-09).
    const q =
      `[out:json][timeout:12];` +
      `way(around:150,${lat},${lon})[highway];` +
      `out tags geom 40;`;
    const data = await overpassServer(q, deadlineAt);
    const cls = data ? nearestHighwayClass(pos, data.elements ?? [], 120, headingDeg) : null;
    result = {
      available: true,
      limitMph: null,
      estMph: cls?.highway === "motorway" ? 70 : null,
      highway: cls?.highway ?? null,
      roadRef: cls?.ref ?? null,
      roadName: cls?.name ?? null,
    };
  } else if (answered) {
    // Answered "no tagged limit near", but the budget is spent
    // before the class query could run: report the honest no-data
    // answer with no class rather than starting a pass the
    // deadline would only abort.
    result = { available: true, limitMph: null, estMph: null, highway: null, roadRef: null, roadName: null };
  } else {
    // Every provider failed: the lookup is honestly unavailable
    // (the client then runs its own direct chain before giving up).
    result = { available: false, limitMph: null, estMph: null, highway: null, roadRef: null, roadName: null };
  }

  if (result.available) {
    cache.set(key, { at: Date.now(), result });
    trimCache();
  }
  return result;
}
