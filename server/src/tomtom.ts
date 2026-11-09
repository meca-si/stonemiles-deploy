// TomTom traffic layer — SERVER ONLY.
//
// This module is imported exclusively by server/src/actions.ts. The API
// key below is a server-side secret: it must never be imported by, sent
// to, rendered in, or logged to the client. Every TomTom call in the
// app happens inside a server action that imports from here, and action
// responses carry only normalized traffic data (incidents, delay
// estimates, freshness stamps) — never the key, never a TomTom URL.
//
// Role in the app: TomTom supplies the TRAFFIC layer and (since
// 2026-10-27) the primary ADDRESS/PLACE SEARCH — see the Search
// section below for its entitlement state. Route geometry stays with
// the truck-legal Valhalla router; TomTom traffic supplies live
// incidents + flow (speed) data used to (a) feed the 30-minute scan
// ahead and (b) annotate route options with a live-traffic delay and a
// traffic-aware ETA.
//
// Quota discipline (Freemium/Evaluation key — monthly free quotas:
// Incident Details 2,500/mo, Flow Segment Data 20,000/mo): incidents
// are the scarce call, so responses are cached server-side — incidents
// per rounded bounding box, flow per rounded point — for
// TOMTOM_CACHE_MS. The scan client additionally self-limits to one
// incidents request per ~5 minutes per active trip, and Basic-tier
// sessions are refused in the action layer BEFORE any fetch happens
// (see actions.ts), so they make zero TomTom calls.

const TOMTOM_API_KEY = process.env.TOMTOM_API_KEY ?? "";

export const TOMTOM_CACHE_MS = 5 * 60_000;
const TOMTOM_TIMEOUT_MS = 9_000;

// Call counters — proof surface for the quota discipline and for the
// Basic-tier zero-call guarantee (read via getTomTomStatus; counts and
// timestamps only, no key material ever leaves through here).
export const tomtomStats = {
  incidentsCalls: 0,
  flowCalls: 0,
  searchCalls: 0,
  suggestionCalls: 0,
  lastFetchedAt: null as number | null,
};

export type TomTomIncident = {
  id: string;
  lat: number;
  lon: number;
  category: number; // TomTom iconCategory
  label: string; // short label derived from the category
  icon: string;
  description: string; // TomTom's own event text ("" when none given)
  delayMin: number; // TomTom-reported delay for this incident, minutes
  magnitude: number; // magnitudeOfDelay 0..4
  from: string | null;
  to: string | null;
  roads: string[];
  startTime: string | null;
  /** Full incident geometry ([lat, lon] pairs, downsampled to ≤48
   *  points) — the client paints the congested stretch of the route
   *  line itself from this (orange slow / red heavy, Apple-style).
   *  A Point incident yields a single pair. */
  coords: { lat: number; lon: number }[];
};

export type TomTomFlow = {
  currentSpeedMph: number;
  freeFlowSpeedMph: number;
  currentTravelTimeSec: number;
  freeFlowTravelTimeSec: number;
  roadClosure: boolean;
};

const CATEGORY_LABELS: Record<number, { label: string; icon: string }> = {
  0: { label: "Traffic incident", icon: "⚠️" },
  1: { label: "Crash", icon: "💥" },
  2: { label: "Fog", icon: "🌫️" },
  3: { label: "Dangerous conditions", icon: "⚠️" },
  4: { label: "Heavy rain", icon: "🌧️" },
  5: { label: "Ice on the road", icon: "🧊" },
  6: { label: "Traffic jam", icon: "🚗" },
  7: { label: "Lane closed", icon: "🚧" },
  8: { label: "Road closed", icon: "⛔" },
  9: { label: "Road work", icon: "🚧" },
  10: { label: "High wind", icon: "💨" },
  11: { label: "Flooding", icon: "🌊" },
  14: { label: "Broken-down vehicle", icon: "🚛" },
};

function categoryMeta(category: number): { label: string; icon: string } {
  return CATEGORY_LABELS[category] ?? { label: "Traffic incident", icon: "⚠️" };
}

type CacheEntry<T> = { at: number; value: T };
const incidentsCache = new Map<string, CacheEntry<TomTomIncident[] | null>>();
const flowCache = new Map<string, CacheEntry<TomTomFlow | null>>();

function bboxKey(minLat: number, minLon: number, maxLat: number, maxLon: number): string {
  // Round to a ~0.02° grid (≈1.4 mi) so a slowly moving truck reuses the
  // same cached corridor instead of minting a fresh incidents call for
  // every few hundred feet of travel.
  const r = (n: number) => Math.round(n / 0.02);
  return `${r(minLat)},${r(minLon)},${r(maxLat)},${r(maxLon)}`;
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TOMTOM_TIMEOUT_MS) });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

type RawIncident = {
  type?: string;
  geometry?: { type?: string; coordinates?: unknown };
  properties?: {
    id?: string | number;
    iconCategory?: number;
    magnitudeOfDelay?: number;
    events?: { description?: string; code?: number }[];
    startTime?: string;
    from?: string;
    to?: string;
    length?: number;
    delay?: number;
    roadNumbers?: string[];
  };
};

/** Representative point for an incident geometry: the point itself for
 *  Point geometry, the middle vertex for a LineString. Coordinates in
 *  the TomTom response are [lon, lat] pairs. */
function incidentPoint(geometry: RawIncident["geometry"]): { lat: number; lon: number } | null {
  const all = incidentCoords(geometry);
  if (all.length === 0) return null;
  return all[Math.floor(all.length / 2)] ?? all[0]!;
}

/** Every point of an incident geometry as {lat, lon}, downsampled to
 *  at most 48 points (a jam's line can carry hundreds of vertices;
 *  the client only needs the stretch it covers on the route). */
function incidentCoords(geometry: RawIncident["geometry"]): { lat: number; lon: number }[] {
  const coords = geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length === 0) return [];
  const asPair = (c: unknown): { lat: number; lon: number } | null => {
    if (!Array.isArray(c) || typeof c[0] !== "number" || typeof c[1] !== "number") return null;
    return { lat: c[1], lon: c[0] };
  };
  if (typeof coords[0] === "number") {
    const p = asPair(coords);
    return p ? [p] : [];
  }
  const pts: { lat: number; lon: number }[] = [];
  for (const c of coords) {
    const p = asPair(c);
    if (p) pts.push(p);
  }
  if (pts.length <= 48) return pts;
  const step = Math.ceil(pts.length / 48);
  const out: { lat: number; lon: number }[] = [];
  for (let i = 0; i < pts.length; i += step) out.push(pts[i]!);
  const lastPt = pts[pts.length - 1];
  if (lastPt && out[out.length - 1] !== lastPt) out.push(lastPt);
  return out;
}

/** Live traffic incidents inside a bounding box, cached per rounded
 *  box for TOMTOM_CACHE_MS. Returns null when TomTom is unreachable or
 *  answers an error — callers must treat null as "traffic unavailable",
 *  never as "no incidents". An empty array is a real answer: TomTom
 *  responded and reported nothing in the box. */
export async function fetchTomTomIncidents(
  minLat: number,
  minLon: number,
  maxLat: number,
  maxLon: number,
): Promise<TomTomIncident[] | null> {
  const key = bboxKey(minLat, minLon, maxLat, maxLon);
  const hit = incidentsCache.get(key);
  if (hit && Date.now() - hit.at < TOMTOM_CACHE_MS) return hit.value;
  const fields =
    "{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code},startTime,endTime,from,to,length,delay,roadNumbers}}}";
  const url =
    `https://api.tomtom.com/traffic/services/5/incidentDetails?key=${TOMTOM_API_KEY}` +
    `&bbox=${minLon},${minLat},${maxLon},${maxLat}` +
    `&fields=${encodeURIComponent(fields)}&language=en-US&timeValidityFilter=present`;
  tomtomStats.incidentsCalls += 1;
  const data = await fetchJson(url);
  let out: TomTomIncident[] | null = null;
  if (data != null && typeof data === "object") {
    const raw = (data as { incidents?: RawIncident[] }).incidents;
    if (Array.isArray(raw)) {
      out = [];
      for (const inc of raw) {
        const pt = incidentPoint(inc.geometry);
        const props = inc.properties ?? {};
        if (!pt) continue;
        const category = typeof props.iconCategory === "number" ? props.iconCategory : 0;
        const meta = categoryMeta(category);
        const description = (props.events ?? []).find((e) => typeof e.description === "string")?.description ?? "";
        out.push({
          id: String(props.id ?? `${pt.lat.toFixed(5)},${pt.lon.toFixed(5)},${category}`),
          lat: pt.lat,
          lon: pt.lon,
          category,
          label: meta.label,
          icon: meta.icon,
          description,
          delayMin: typeof props.delay === "number" ? Math.max(0, props.delay / 60) : 0,
          magnitude: typeof props.magnitudeOfDelay === "number" ? props.magnitudeOfDelay : 0,
          from: props.from ?? null,
          to: props.to ?? null,
          roads: Array.isArray(props.roadNumbers) ? props.roadNumbers.filter((r) => typeof r === "string") : [],
          startTime: props.startTime ?? null,
          coords: incidentCoords(inc.geometry),
        });
      }
      tomtomStats.lastFetchedAt = Date.now();
    }
  }
  incidentsCache.set(key, { at: Date.now(), value: out });
  return out;
}

/** Live flow (current vs free-flow speed/travel time) at one point,
 *  cached per rounded point for TOMTOM_CACHE_MS. Null = unavailable. */
export async function fetchTomTomFlow(lat: number, lon: number): Promise<TomTomFlow | null> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const hit = flowCache.get(key);
  if (hit && Date.now() - hit.at < TOMTOM_CACHE_MS) return hit.value;
  const url =
    `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?key=${TOMTOM_API_KEY}` +
    `&point=${lat},${lon}&unit=MPH`;
  tomtomStats.flowCalls += 1;
  const data = await fetchJson(url);
  let out: TomTomFlow | null = null;
  if (data != null && typeof data === "object") {
    const f = (data as { flowSegmentData?: Record<string, unknown> }).flowSegmentData;
    if (f && typeof f.currentSpeed === "number" && typeof f.freeFlowSpeed === "number") {
      out = {
        currentSpeedMph: f.currentSpeed,
        freeFlowSpeedMph: f.freeFlowSpeed,
        currentTravelTimeSec: typeof f.currentTravelTime === "number" ? f.currentTravelTime : 0,
        freeFlowTravelTimeSec: typeof f.freeFlowTravelTime === "number" ? f.freeFlowTravelTime : 0,
        roadClosure: f.roadClosure === true,
      };
      tomtomStats.lastFetchedAt = Date.now();
    }
  }
  flowCache.set(key, { at: Date.now(), value: out });
  return out;
}

// ---------- Search (address / place geocoding) ------------------------------
// TomTom Search API (fuzzy search) — wired 2026-10-27 as the PRIMARY
// address/place source for the app's one shared geocode chain, ahead of
// the free Nominatim/ArcGIS/Photon rungs. Same rules as traffic: server
// only, key never leaves this module, Gold+ gate enforced in the action
// layer BEFORE any fetch (Basic makes zero TomTom calls).
//
// ENTITLEMENT — VERIFIED LIVE 2026-10-27: the STONEMILES-APP key is
// currently NOT entitled to the Search API. Fuzzy search, autocomplete,
// and POI search all answered HTTP 403 {"code":"Forbidden","message":
// "You are not allowed to access this endpoint"} for known-good queries
// (the Theodore address OSM misses, "IP Casino Biloxi MS"). The wiring
// below is complete and live, but until Search is enabled on the TomTom
// account the rung stays DISABLED: the first 403 trips a circuit
// breaker (SEARCH_DISABLED_MS) and every later call returns null
// without touching TomTom, so the free chain serves exactly as before
// and no quota is burned re-probing. When the product is enabled on
// the account, the breaker lapses, the next search succeeds, and
// TomTom takes over as primary on its own — no code change needed.
//
// Quota discipline (the account's shared free allowance is 2,500
// non-tile requests/day across TomTom APIs): results are cached
// server-side per normalized query + coarse position grid for
// SEARCH_CACHE_MS, queries under 3 characters never call out, and the
// client debounces autocomplete keystrokes before asking.

export type TomTomPlace = {
  label: string;
  lat: number;
  lon: number;
  /** TomTom's own match score for this result (higher = closer match). */
  score: number;
};

const SEARCH_CACHE_MS = 10 * 60_000;
const SEARCH_DISABLED_MS = 6 * 60 * 60_000;
let searchDisabledUntil = 0;

/** True while the Search entitlement breaker is tripped (a 403 was
 *  seen and the cool-down has not lapsed). Exported for the status
 *  action — a boolean only, never key material. */
export function tomTomSearchDisabled(): boolean {
  return Date.now() < searchDisabledUntil;
}

const placeCache = new Map<string, CacheEntry<TomTomPlace[] | null>>();

type RawSearchResult = {
  type?: string;
  score?: number;
  poi?: { name?: string };
  address?: { freeformAddress?: string };
  position?: { lat?: number; lon?: number };
};

async function tomTomPlaces(
  q: string,
  limit: number,
  near: { lat: number; lon: number } | null,
  kind: "search" | "suggest",
): Promise<TomTomPlace[] | null> {
  const query = q.trim().replace(/\s+/g, " ");
  if (query.length < 3) return [];
  if (tomTomSearchDisabled()) return null;
  // Coarse position grid (~7 mi) so drivers in the same area share one
  // cached answer instead of minting a call per truck.
  const grid = near ? `${near.lat.toFixed(1)},${near.lon.toFixed(1)}` : "none";
  const cacheKey = `${query.toLowerCase()}|${grid}`;
  const hit = placeCache.get(cacheKey);
  if (hit && Date.now() - hit.at < SEARCH_CACHE_MS) {
    return hit.value == null ? null : hit.value.slice(0, limit);
  }
  let url =
    `https://api.tomtom.com/search/2/search/${encodeURIComponent(query)}.json?key=${TOMTOM_API_KEY}` +
    `&limit=8&countrySet=US&language=en-US`;
  if (near) url += `&lat=${near.lat}&lon=${near.lon}`;
  if (kind === "search") tomtomStats.searchCalls += 1;
  else tomtomStats.suggestionCalls += 1;
  let data: unknown = null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TOMTOM_TIMEOUT_MS) });
    if (res.status === 403) {
      // Not entitled (or the key lost the product): trip the breaker
      // and stay silent until the cool-down lapses. The free chain
      // serves meanwhile — never a dead end, never a fake result.
      searchDisabledUntil = Date.now() + SEARCH_DISABLED_MS;
      placeCache.set(cacheKey, { at: Date.now(), value: null });
      return null;
    }
    if (res.ok) data = (await res.json()) as unknown;
  } catch {
    data = null;
  }
  let out: TomTomPlace[] | null = null;
  if (data != null && typeof data === "object") {
    const raw = (data as { results?: RawSearchResult[] }).results;
    if (Array.isArray(raw)) {
      out = [];
      for (const r of raw) {
        const lat = r.position?.lat;
        const lon = r.position?.lon;
        if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const freeform = (r.address?.freeformAddress ?? "").trim();
        const name = (r.poi?.name ?? "").trim();
        const label = name && freeform && !freeform.startsWith(name) ? `${name} — ${freeform}` : freeform || name;
        if (label.length < 3) continue;
        out.push({ label, lat, lon, score: typeof r.score === "number" ? r.score : 0 });
      }
      tomtomStats.lastFetchedAt = Date.now();
    }
  }
  placeCache.set(cacheKey, { at: Date.now(), value: out });
  return out == null ? null : out.slice(0, limit);
}

/** Primary address/place search: TomTom fuzzy search over street
 *  addresses AND business/place names, biased toward `near` when
 *  given. Null = TomTom unavailable or not entitled — the caller
 *  falls back to the free geocode chain. An empty array is a real
 *  answer: TomTom responded and matched nothing. */
export async function fetchTomTomSearch(
  q: string,
  limit: number,
  near: { lat: number; lon: number } | null,
): Promise<TomTomPlace[] | null> {
  return tomTomPlaces(q, limit, near, "search");
}

/** As-you-type suggestions: the same fuzzy Search endpoint fed the
 *  partial text (TomTom's fuzzy matching resolves partial/sloppy
 *  input to canonical addresses and place names, each carrying a
 *  real position the driver can tap straight into a route). */
export async function fetchTomTomSuggestions(
  q: string,
  limit: number,
  near: { lat: number; lon: number } | null,
): Promise<TomTomPlace[] | null> {
  return tomTomPlaces(q, limit, near, "suggest");
}

/** Estimated added minutes to cover `freeFlowMin` minutes of free-flow
 *  driving, from flow samples along the stretch: each sample's slowdown
 *  multiplier is freeFlowSpeed / currentSpeed; the mean multiplier is
 *  applied to the free-flow time. Returns null when no sample answered
 *  — the caller then has no flow basis for a delay and must say so. */
export function flowDelayEstimate(freeFlowMin: number, samples: (TomTomFlow | null)[]): number | null {
  const mults: number[] = [];
  for (const s of samples) {
    if (!s) continue;
    if (s.roadClosure) {
      mults.push(3);
      continue;
    }
    if (s.currentSpeedMph > 1 && s.freeFlowSpeedMph > 0) {
      mults.push(Math.max(1, s.freeFlowSpeedMph / s.currentSpeedMph));
    }
  }
  if (mults.length === 0) return null;
  const mean = mults.reduce((a, b) => a + b, 0) / mults.length;
  return Math.max(0, freeFlowMin * (mean - 1));
}
