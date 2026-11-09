// Official work-zone feeds — WZDx (Work Zone Data Exchange), the
// USDOT standard format state DOTs publish their road-work data in.
//
// THE HONESTY RULES (x's order 2026-11-08, same family as the paid
// feeds gate): only a feed a state publishes OPENLY — no key, no
// account, no payment — may be wired here. Zones from a feed are
// labelled "DOT reported" with the publishing agency named, and are
// visually distinct from driver reports everywhere they show. Where
// no free official feed covers the road, the app shows driver
// reports only — an estimate is never dressed up as official data,
// and no commercial incident/traffic feed is bought (the revenue
// gate stands: paid feeds wait for app revenue).
//
// WIRED FEEDS (each verified live before wiring — see DATA-PLAN.md):
//   - Wisconsin DOT via 511WI: https://511wi.gov/api/wzdx
//     WZDx v4.2 GeoJSON, keyless, CC0 license, ~60 s publisher
//     refresh. Verified 2026-11-08: HTTP 200, 2,460 work-zone
//     features with road names, descriptions, and start/end dates.
//
// The feed is fetched SERVER-SIDE ONLY (the tomtom.ts pattern) and
// cached: a whole-state feed is megabytes, so one fetch serves every
// driver for the cache window, and callers get only the zones near
// their position. A feed that doesn't answer yields `available:
// false` — the client then shows driver reports only and says the
// official feed didn't answer; a DOT zone is never invented.

export interface DotWorkZone {
  /** Stable id from the feed (namespaced by feed key). */
  id: string;
  lat: number;
  lon: number;
  /** Road name(s) from the feed, e.g. "I-90 EB". */
  road: string | null;
  /** The feed's own description of the work, verbatim (trimmed). */
  description: string | null;
  startMs: number;
  endMs: number;
  /** The publishing agency label shown wherever the zone appears. */
  sourceLabel: string;
}

interface WzdxFeedDef {
  key: string;
  url: string;
  sourceLabel: string;
  /** Coarse coverage box — a feed is only fetched when the driver
   *  is inside (or near) the state it covers, so a Wisconsin feed
   *  never costs a fetch for a truck in Alabama. */
  bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number };
}

const WZDX_FEEDS: WzdxFeedDef[] = [
  {
    key: "wi511",
    url: "https://511wi.gov/api/wzdx",
    sourceLabel: "Wisconsin DOT · 511WI",
    bbox: { minLat: 42.4, maxLat: 47.1, minLon: -92.9, maxLon: -86.7 },
  },
];

/** How long one fetched feed serves every caller. The publisher
 *  refreshes about every minute; work zones change on the scale of
 *  hours, and the feed is megabytes — 10 minutes is the honest
 *  balance, and every answer carries its fetch time. */
export const WZDX_CACHE_MS = 10 * 60_000;

/** Zones are offered within this radius of the asking position —
 *  far enough to cover the road ahead, near enough to stay relevant. */
export const WZDX_NEAR_RADIUS_MI = 60;

function haversineMi(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** The first coordinate pair of a WZDx geometry — a work zone's pin
 *  sits at its START (the end a driver reaches first is unknowable
 *  without direction of travel; the route projection in the client
 *  refines placement for alerts). GeoJSON order is [lon, lat].
 *  Handles Point, MultiPoint, and LineString; anything else (or a
 *  malformed pair) yields null and the feature is skipped — a zone
 *  is never placed by guessing. */
export function wzdxPoint(geometry: unknown): { lat: number; lon: number } | null {
  if (!geometry || typeof geometry !== "object") return null;
  const g = geometry as { type?: unknown; coordinates?: unknown };
  let pair: unknown = null;
  if (g.type === "Point") pair = g.coordinates;
  else if (g.type === "MultiPoint" || g.type === "LineString") {
    pair = Array.isArray(g.coordinates) ? g.coordinates[0] : null;
  }
  if (!Array.isArray(pair) || pair.length < 2) return null;
  const [lon, lat] = pair as [unknown, unknown];
  if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

/** Parse one WZDx GeoJSON feed into the zones ACTIVE at `nowMs`
 *  (start ≤ now ≤ end — a future or finished zone is not a zone a
 *  driver can meet). Malformed features are skipped, never repaired.
 *  Pure: the exact production parse is unit-testable (wzdx.test.ts). */
export function parseWzdxFeed(feedJson: unknown, feed: { key: string; sourceLabel: string }, nowMs: number): DotWorkZone[] {
  if (!feedJson || typeof feedJson !== "object") return [];
  const features = (feedJson as { features?: unknown }).features;
  if (!Array.isArray(features)) return [];
  const out: DotWorkZone[] = [];
  for (const f of features) {
    if (!f || typeof f !== "object") continue;
    const feat = f as { id?: unknown; geometry?: unknown; properties?: unknown };
    const props = (feat.properties ?? {}) as {
      core_details?: { road_names?: unknown; description?: unknown };
      start_date?: unknown;
      end_date?: unknown;
    };
    const startMs = typeof props.start_date === "string" ? Date.parse(props.start_date) : NaN;
    const endMs = typeof props.end_date === "string" ? Date.parse(props.end_date) : NaN;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    if (nowMs < startMs || nowMs > endMs) continue;
    const pt = wzdxPoint(feat.geometry);
    if (!pt) continue;
    const roads = props.core_details?.road_names;
    // The feed itself sometimes carries the literal string "Unknown"
    // as a road name — that is the absence of a name, not a name.
    const namedRoads =
      Array.isArray(roads) && roads.every((r) => typeof r === "string")
        ? (roads as string[]).filter((r) => r.trim() && r.trim().toLowerCase() !== "unknown")
        : [];
    const road = namedRoads.length > 0 ? namedRoads.join(" / ") : null;
    const desc = props.core_details?.description;
    out.push({
      id: `${feed.key}-${typeof feat.id === "string" && feat.id ? feat.id : `${pt.lat.toFixed(5)},${pt.lon.toFixed(5)}`}`,
      lat: pt.lat,
      lon: pt.lon,
      road,
      description: typeof desc === "string" && desc.trim() ? desc.trim().slice(0, 300) : null,
      startMs,
      endMs,
      sourceLabel: feed.sourceLabel,
    });
  }
  return out;
}

/** Which wired feeds cover a position (with a small margin, so a
 *  driver near a state line still gets that state's zones). */
export function feedsForPosition(lat: number, lon: number): WzdxFeedDef[] {
  const M = 0.5; // ~35 mi of slack around the coverage box
  return WZDX_FEEDS.filter(
    (f) => lat >= f.bbox.minLat - M && lat <= f.bbox.maxLat + M && lon >= f.bbox.minLon - M && lon <= f.bbox.maxLon + M,
  );
}

interface FeedCacheEntry {
  fetchedAtMs: number;
  zones: DotWorkZone[];
}
const feedCache = new Map<string, FeedCacheEntry>();
const feedInFlight = new Map<string, Promise<DotWorkZone[] | null>>();

async function fetchFeedZones(feed: WzdxFeedDef): Promise<DotWorkZone[] | null> {
  const cached = feedCache.get(feed.key);
  if (cached && Date.now() - cached.fetchedAtMs < WZDX_CACHE_MS) return cached.zones;
  const inFlight = feedInFlight.get(feed.key);
  if (inFlight) return inFlight;
  const p = (async (): Promise<DotWorkZone[] | null> => {
    try {
      const res = await fetch(feed.url, {
        headers: { "User-Agent": "STONEMILES work-zone layer (WZDx reader)", Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return null;
      const json: unknown = await res.json();
      const zones = parseWzdxFeed(json, feed, Date.now());
      feedCache.set(feed.key, { fetchedAtMs: Date.now(), zones });
      return zones;
    } catch {
      return null;
    } finally {
      feedInFlight.delete(feed.key);
    }
  })();
  feedInFlight.set(feed.key, p);
  return p;
}

export interface DotZonesResult {
  /** True when at least one covering feed answered (or no feed
   *  covers the position — nothing official to miss, said plainly
   *  via `feedsCovering`). */
  available: boolean;
  /** How many wired feeds cover this position (0 = no free official
   *  feed is wired for this state yet — driver reports only). */
  feedsCovering: number;
  zones: (DotWorkZone & { distanceMi: number })[];
  /** Epoch ms of the oldest feed answer used. */
  fetchedAtMs: number | null;
}

/** Official work zones near a position, from every wired free feed
 *  covering it. Never throws: a dead feed answers available:false. */
export async function dotWorkZonesNear(lat: number, lon: number): Promise<DotZonesResult> {
  const feeds = feedsForPosition(lat, lon);
  if (feeds.length === 0) return { available: true, feedsCovering: 0, zones: [], fetchedAtMs: null };
  const results = await Promise.all(feeds.map((f) => fetchFeedZones(f)));
  const zones: (DotWorkZone & { distanceMi: number })[] = [];
  let fetchedAtMs: number | null = null;
  let anyOk = false;
  results.forEach((zs, i) => {
    if (zs == null) return;
    anyOk = true;
    const entry = feedCache.get(feeds[i]!.key);
    if (entry && (fetchedAtMs == null || entry.fetchedAtMs < fetchedAtMs)) fetchedAtMs = entry.fetchedAtMs;
    for (const z of zs) {
      const distanceMi = haversineMi(lat, lon, z.lat, z.lon);
      if (distanceMi <= WZDX_NEAR_RADIUS_MI) zones.push({ ...z, distanceMi });
    }
  });
  zones.sort((a, b) => a.distanceMi - b.distanceMi);
  return { available: anyOk, feedsCovering: feeds.length, zones: zones.slice(0, 60), fetchedAtMs };
}
