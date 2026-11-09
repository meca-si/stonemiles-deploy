// Explore place pins — the server rung (driver report, 2026-11-06:
// "Not loading fuel stations", the map's busy note sat on "Loading
// pins from the map data…" indefinitely).
//
// Diagnosis, verified from the server's own network while fixing:
// the Explore chips used to query Overpass ONLY from the phone, via
// the client's sequential failover helper. That chain breaks exactly
// the way the speed-limit ladder broke before its 2026-10-29 reorder
// (see speedLimit.ts):
//   - overpass-api.de answers some clients HTTP 406 (its mod_security
//     refuses user-agents it dislikes — a bare curl UA gets 406 while
//     the SAME query with a descriptive UA returns 200; the phone
//     webview's UA is in the refused class, and a web page cannot set
//     its own User-Agent header — that header is browser-owned);
//   - the mirror instances (kumi, private.coffee) hang past any
//     reasonable wait when they are sick, and the client's chain
//     tries instances SEQUENTIALLY at up to 20 s apiece, so one
//     refused + two hanging instances reads as "never loads".
// The server sends a proper descriptive user-agent (the request .de
// accepted) and RACES all four instances — first healthy answer
// wins, the rest are aborted. Measured while fixing: .de is the
// only instance that answered at all, and under evening load its
// (correct) answer took 17–37 s of mostly queue time, so the race's
// per-attempt cap is 45 s — a slow-but-healthy instance still lands,
// and the busy note on the phone is honest while it waits. The
// client keeps its direct chain as the second rung for when the
// server itself is unreachable.
// A limit is never invented here either: elements are raw
// OpenStreetMap data, shaped by the client exactly as before.
//
// Query coverage fix in the same pass: the Fuel chip's query used to
// ask for nodes only (`node[amenity=fuel]`), but a large share of
// fuel stations are mapped in OpenStreetMap as building/area ways or
// relations — those stations could NEVER come back, however healthy
// the connection. Fuel now queries nwr (nodes + ways + relations),
// like the Scales chip's CAT Scale clause already did. `out center`
// gives ways/relations their centroid, which the client already
// reads.

export type ExploreCategoryKey =
  | "truckstops"
  | "weigh"
  | "fuel"
  | "parking"
  | "rest"
  | "scales"
  | "night";

export type OsmPoiElement = {
  type: string;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

export const EXPLORE_RADIUS_M = 25000;

// The per-category Overpass clauses — a deliberate mirror of the
// client's fallback copy in App.tsx (fetchExplorePois); the two must
// stay in step, the same mirror discipline as speedLimit.ts.
export function exploreQueryParts(cat: ExploreCategoryKey, lat: number, lon: number): string {
  const R = EXPLORE_RADIUS_M;
  const parts: Record<ExploreCategoryKey, string> = {
    truckstops: `node(around:${R},${lat},${lon})[highway=services];way(around:${R},${lat},${lon})[highway=services];node(around:${R},${lat},${lon})[amenity=fuel][hgv];node(around:${R},${lat},${lon})[truck_stop=yes];way(around:${R},${lat},${lon})[truck_stop=yes];`,
    weigh: `node(around:${R},${lat},${lon})[amenity=weighbridge];node(around:${R},${lat},${lon})[highway=weigh_station];`,
    fuel: `nwr(around:${R},${lat},${lon})[amenity=fuel];`,
    parking: `node(around:${R},${lat},${lon})[amenity=parking][access!=private];way(around:${R},${lat},${lon})[amenity=parking][access!=private];`,
    rest: `node(around:${R},${lat},${lon})[highway=rest_area];way(around:${R},${lat},${lon})[highway=rest_area];`,
    scales: `node(around:${R},${lat},${lon})[amenity=weighbridge];way(around:${R},${lat},${lon})[amenity=weighbridge];node(around:${R},${lat},${lon})[highway=weigh_station];nwr(around:${R},${lat},${lon})["brand"~"CAT Scale",i];node(around:${R},${lat},${lon})[amenity=fuel][scales];way(around:${R},${lat},${lon})[highway=services][scales];`,
    night: `node(around:${R},${lat},${lon})[amenity=parking][access!=private];way(around:${R},${lat},${lon})[amenity=parking][access!=private];node(around:${R},${lat},${lon})[highway=rest_area];way(around:${R},${lat},${lon})[highway=rest_area];node(around:${R},${lat},${lon})[highway=services];way(around:${R},${lat},${lon})[highway=services];`,
  };
  return parts[cat];
}

export function buildExploreQuery(cat: ExploreCategoryKey, lat: number, lon: number): string {
  return `[out:json][timeout:25];(${exploreQueryParts(cat, lat, lon)});out center tags 60;`;
}

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.nchc.org.tw/api/interpreter",
];
const PER_ATTEMPT_MS = 45_000;

function attempt(url: string, query: string, cancelRest: AbortSignal): Promise<OsmPoiElement[]> {
  return new Promise<OsmPoiElement[]>((resolve, reject) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PER_ATTEMPT_MS);
    const onCancel = () => ctrl.abort();
    cancelRest.addEventListener("abort", onCancel, { once: true });
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "STONEMILES explore places lookup (OpenStreetMap Overpass)",
        Accept: "application/json",
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: ctrl.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { elements?: OsmPoiElement[] };
        resolve(data.elements ?? []);
      })
      .catch(reject)
      .finally(() => {
        clearTimeout(timer);
        cancelRest.removeEventListener("abort", onCancel);
      });
  });
}

/**
 * Run one Explore category query against the public Overpass
 * instances, racing them: the first instance to answer with data
 * wins and the rest are aborted. `available: false` only when every
 * instance failed or timed out — the client then runs its own
 * direct failover chain before showing its honest failure note.
 */
export async function fetchExplorePois(
  lat: number,
  lon: number,
  category: ExploreCategoryKey,
): Promise<{ available: boolean; elements: OsmPoiElement[] }> {
  const query = buildExploreQuery(category, lat, lon);
  const cancelRest = new AbortController();
  const elements = await new Promise<OsmPoiElement[] | null>((resolve) => {
    let settled = false;
    let failed = 0;
    for (const url of OVERPASS_ENDPOINTS) {
      attempt(url, query, cancelRest.signal).then(
        (els) => {
          if (!settled) {
            settled = true;
            resolve(els);
          }
        },
        () => {
          failed += 1;
          if (failed === OVERPASS_ENDPOINTS.length && !settled) {
            settled = true;
            resolve(null);
          }
        },
      );
    }
  });
  cancelRest.abort();
  if (!elements) return { available: false, elements: [] };
  return { available: true, elements };
}
