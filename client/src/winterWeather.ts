// Severe weather + the winter package (migration 0107, x's order
// 2026-11-08: "Build all five" — the winter package is x's own
// addition: "Like snow chain alert with snow depth alert").
//
// Pure and framework-free (no DOM, no React), like hillGrade.ts, so
// the exact production matching is unit-testable (see
// winterWeather.test.ts).
//
// DATA — free only, per the standing paid-feeds rule:
//   - Warnings: the National Weather Service (api.weather.gov, no
//     key). A warning counts as ON ROUTE when its polygon covers a
//     point of the route corridor, and it is TIMED against the
//     driver's ETA at that segment — "you reach the warned area in
//     about 40 minutes", never just a forecast page.
//   - Snow: forecast snowfall amounts sampled along the route
//     (NWS gridpoint snowfall / Open-Meteo snowfall — the app fills
//     the samples), matched to the ETA at each point.
//   - Chains: state chain/traction LAW is static reference data
//     (below, Atlas-style, labelled as reference). An ACTIVE
//     requirement is only ever called from a DOT-posted requirement
//     record carrying its source — this module never promotes a
//     law, a warning, or a forecast into "chains required". Where
//     no DOT post exists, no chain call fires.
//
// Settings → Driving → "Winter & weather alerts" (default ON)
// gates the whole package on the Drive screen.

// ------------------------------------------------------------------
// NWS warnings on route

export interface RouteSample {
  lat: number;
  lon: number;
  /** Miles from the route start. */
  alongMi: number;
  /** When the driver reaches this point at the current pace, ms. */
  etaMs: number;
}

export interface NwsRouteAlert {
  id: string;
  /** "Tornado Warning", "Flash Flood Warning", "Winter Storm Warning", … */
  event: string;
  severity: string;
  headline: string;
  areaDesc: string;
  /** Warning polygon as [lat, lon] rings; null when NWS published
   *  none (the alert was matched by the point it was fetched for —
   *  fetchAlongMi/fetchEtaMs below carry that association). */
  polygon: [number, number][] | null;
  fetchAlongMi?: number;
  fetchEtaMs?: number;
}

/** The GeoJSON shape api.weather.gov/alerts/active returns. */
export interface NwsFeature {
  id?: string;
  geometry?: { type?: string; coordinates?: number[][][] } | null;
  properties?: {
    event?: string;
    severity?: string;
    headline?: string;
    areaDesc?: string;
  };
}

/** Parse NWS alert features into route alerts. Only WARNINGS ride
 *  the Drive banner path (watches stay panel data), and only the
 *  events that change a driving decision — the brief's set:
 *  tornado, flash flood, winter storm, and their severe kin. */
export function parseNwsAlerts(features: NwsFeature[] | null | undefined): NwsRouteAlert[] {
  if (!Array.isArray(features)) return [];
  const out: NwsRouteAlert[] = [];
  for (const f of features) {
    const pr = f.properties ?? {};
    const ev = pr.event ?? "";
    if (!/warning/i.test(ev)) continue;
    if (!/(tornado|flash flood|winter|blizzard|ice storm|snow|thunderstorm|hurricane|tropical|extreme wind|dust storm)/i.test(ev)) continue;
    let polygon: [number, number][] | null = null;
    const ring = f.geometry?.coordinates?.[0];
    if (Array.isArray(ring) && ring.length >= 3) {
      polygon = ring
        .filter((p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
        .map((p) => [p[1]!, p[0]!] as [number, number]); // GeoJSON is [lon, lat]
    }
    out.push({
      id: f.id ?? `${ev}|${pr.areaDesc ?? ""}`,
      event: ev,
      severity: pr.severity ?? "",
      headline: pr.headline ?? ev,
      areaDesc: pr.areaDesc ?? "",
      polygon,
    });
  }
  return out;
}

/** Ray-casting point-in-polygon over a [lat, lon] ring. */
export function pointInPolygon(lat: number, lon: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    const crosses = a[0] > lat !== b[0] > lat && lon < ((b[1] - a[1]) * (lat - a[0])) / (b[0] - a[0]) + a[1];
    if (crosses) inside = !inside;
  }
  return inside;
}

export interface WarningOnRoute {
  alert: NwsRouteAlert;
  /** Along-route miles where the warned stretch starts / ends. */
  fromMi: number;
  toMi: number;
  /** The driver's ETA at the warned stretch, ms. */
  etaMs: number;
}

/**
 * Match NWS warnings against the route corridor: a warning is on
 * route when a corridor sample falls inside its polygon (the
 * warned stretch runs from the first to the last covered sample).
 * Polygon-less alerts match only through the fetch association the
 * caller stamped (the sample point the alert was fetched for) —
 * never by area name or guesswork.
 */
export function warningsOnRoute(alerts: NwsRouteAlert[], samples: RouteSample[]): WarningOnRoute[] {
  const out: WarningOnRoute[] = [];
  const seen = new Set<string>();
  for (const alert of alerts) {
    if (seen.has(alert.id)) continue;
    if (alert.polygon) {
      const covered = samples.filter((s) => pointInPolygon(s.lat, s.lon, alert.polygon!));
      if (covered.length === 0) continue;
      seen.add(alert.id);
      out.push({
        alert,
        fromMi: Math.min(...covered.map((s) => s.alongMi)),
        toMi: Math.max(...covered.map((s) => s.alongMi)),
        etaMs: Math.min(...covered.map((s) => s.etaMs)),
      });
    } else if (alert.fetchAlongMi != null && alert.fetchEtaMs != null) {
      seen.add(alert.id);
      out.push({ alert, fromMi: alert.fetchAlongMi, toMi: alert.fetchAlongMi, etaMs: alert.fetchEtaMs });
    }
  }
  return out.sort((a, b) => a.fromMi - b.fromMi);
}

/** "in about 40 minutes" / "in about 2 hours" / "around 2 PM". */
export function etaWhenLabel(etaMs: number, nowMs: number): string {
  const mins = Math.round((etaMs - nowMs) / 60_000);
  if (mins <= 1) return "now";
  if (mins < 90) return `in about ${mins} minutes`;
  const d = new Date(etaMs);
  let h = d.getHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 === 0 ? 12 : h % 12;
  return `around ${h} ${ampm}`;
}

/** The banner headline: "TORNADO WARNING ON YOUR ROUTE". */
export function warningHeadline(w: WarningOnRoute): string {
  return `${w.alert.event.toUpperCase()} ON YOUR ROUTE`;
}

/** The spoken call — event, area, and when the driver reaches it. */
export function warningSpoken(w: WarningOnRoute, nowMs: number): string {
  return `National Weather Service: ${w.alert.event}. You reach the warned area ${etaWhenLabel(w.etaMs, nowMs)}. ${w.alert.headline}`;
}

// ------------------------------------------------------------------
// Snow depth on route

export interface SnowSample {
  alongMi: number;
  etaMs: number;
  /** Forecast NEW snowfall (inches) expected at this point around
   *  the driver's ETA — a range where the source gives one, a
   *  single value (low = high) where it doesn't. */
  lowIn: number;
  highIn: number;
}

/** Accumulation (inches) at or over this on the road ahead raises
 *  the plain park-it advisory. */
export const PARK_SNOW_IN = 8;
/** The snow summary looks this far ahead, miles. */
export const SNOW_LOOKAHEAD_MI = 150;

export interface SnowSummary {
  /** Expected range across the snowy stretch, inches. */
  lowIn: number;
  highIn: number;
  /** Length of the snowy stretch ahead, miles. */
  spanMi: number;
  /** ETA at the first snowy point, ms. */
  startEtaMs: number;
  /** True when the worst forecast point crosses PARK_SNOW_IN. */
  parkAdvisory: boolean;
}

/**
 * Summarize forecast snow along the route ahead, matched to ETA:
 * the snowy stretch (samples expecting ≥1 inch), its expected
 * range, when it starts for THIS driver, and the park-it call when
 * accumulation crosses the heavy line. No snow in the samples =
 * null — silence, never a "no snow" guess dressed as data (the
 * samples only exist where a forecast answered).
 */
export function snowSummary(samples: SnowSample[], progressMi: number): SnowSummary | null {
  const ahead = samples
    .filter((s) => s.alongMi >= progressMi - 0.5 && s.alongMi <= progressMi + SNOW_LOOKAHEAD_MI)
    .sort((a, b) => a.alongMi - b.alongMi);
  const snowy = ahead.filter((s) => s.highIn >= 1);
  if (snowy.length === 0) return null;
  const first = snowy[0]!;
  const last = snowy[snowy.length - 1]!;
  return {
    lowIn: Math.floor(Math.min(...snowy.map((s) => s.lowIn))),
    highIn: Math.ceil(Math.max(...snowy.map((s) => s.highIn))),
    spanMi: Math.max(10, Math.round((last.alongMi - Math.max(progressMi, first.alongMi - 7.5)) / 5) * 5),
    startEtaMs: first.etaMs,
    parkAdvisory: Math.max(...snowy.map((s) => s.highIn)) >= PARK_SNOW_IN,
  };
}

/** The snow line the way the brief says it: "4 to 6 inches
 *  expected across your next 90 miles, starting around 2 PM". */
export function snowHeadline(s: SnowSummary, nowMs: number): string {
  const amt = s.lowIn === s.highIn ? `${s.highIn} inches` : `${s.lowIn} to ${s.highIn} inches`;
  return `${amt} expected across your next ${s.spanMi} miles, starting ${etaWhenLabel(s.startEtaMs, nowMs)}`;
}

/** The spoken snow call, with the park-it advisory when it applies. */
export function snowSpoken(s: SnowSummary, nowMs: number): string {
  const base = `Snow ahead. ${snowHeadline(s, nowMs)}.`;
  return s.parkAdvisory
    ? `${base} That is park-it snow for a loaded rig — plan to stop before it, not in it.`
    : base;
}

// ------------------------------------------------------------------
// Chain / traction law + active requirements

export interface ChainLaw {
  state: string;
  name: string;
  /** Plain-language summary of the law — REFERENCE data. */
  summary: string;
  /** When it typically applies — reference, not a live status. */
  season: string;
}

/** State chain/traction law reference for the mountain states a
 *  route runs through — Atlas-style static data, labelled as
 *  reference wherever it shows. This is the LAW, never a claim
 *  that a requirement is active right now. */
export const CHAIN_LAWS: Record<string, ChainLaw> = {
  CO: {
    state: "CO",
    name: "Colorado Traction Law / Chain Law",
    summary:
      "On I-70 between Dotsero and Morrison (and other posted segments), commercial vehicles must carry chains or approved traction devices Sept 1 – May 31; when the Passenger Vehicle Chain Law is activated, every vehicle needs chains or approved alternatives on the posted stretch.",
    season: "Carry requirement Sept 1 – May 31 on posted segments",
  },
  CA: {
    state: "CA",
    name: "California Chain Control",
    summary:
      "Caltrans posts chain controls (R-1 / R-2 / R-3) on Sierra and Cascade passes — I-80 over Donner, US-50, I-5 near Redding and others. Trucks chain a drive axle (and drag chains on trailers where posted) at the control point; no control posted, no chains required.",
    season: "Posted per storm, mainly winter",
  },
  OR: {
    state: "OR",
    name: "Oregon Chain Law",
    summary:
      "Oregon's chain law applies on posted mountain highways statewide: when signs say chains required, commercial vehicles must use them; carry requirements apply on designated routes during the winter season.",
    season: "Posted per storm; carry on designated routes in winter",
  },
  WA: {
    state: "WA",
    name: "Washington Chain Requirements",
    summary:
      "WSDOT posts traction and chain requirements on the Cascade passes (I-90 Snoqualmie, US-2 Stevens, US-12 White). Vehicles over 10,000 lbs GVWR must carry chains Nov 1 – Apr 1 on posted routes, and install them when the sign says.",
    season: "Carry Nov 1 – Apr 1 on posted routes",
  },
  NV: {
    state: "NV",
    name: "Nevada Chain Controls",
    summary:
      "NDOT posts chain controls on mountain routes (I-80 over the Sierra approach, Mt. Rose, Spooner). When posted, trucks must chain drive axles at the control point.",
    season: "Posted per storm",
  },
  UT: {
    state: "UT",
    name: "Utah Traction Device Requirements",
    summary:
      "UDOT posts traction-device requirements in the canyons and on I-70 / I-15 mountain stretches during storms; commercial vehicles chain when the requirement is posted for their vehicle class.",
    season: "Posted per storm",
  },
  WY: {
    state: "WY",
    name: "Wyoming Chain Law",
    summary:
      "Wyoming posts chain requirements on I-80 and mountain routes during storms; when the chain law is in effect for a segment, commercial vehicles must be chained to legally proceed — and I-80 closes outright in the worst of it.",
    season: "Posted per storm",
  },
  MT: {
    state: "MT",
    name: "Montana Chain Requirements",
    summary:
      "Montana posts chain requirements on the passes (I-90 Lookout and Homestake, US-2 Marias) during severe storms; install at the posted chain-up areas.",
    season: "Posted per storm",
  },
  ID: {
    state: "ID",
    name: "Idaho Chain Requirements",
    summary:
      "Idaho posts chain requirements on mountain routes (I-84 / I-90 passes, US-12) during storms; commercial vehicles chain at the posted turnouts when required.",
    season: "Posted per storm",
  },
};

/** An ACTIVE chain/traction requirement, posted by a state DOT.
 *  Only a record like this — a real DOT post with its source named —
 *  can ever fire the "Chains required ahead" call. */
export interface ChainRequirement {
  state: string;
  /** Where the requirement applies ("I-70, milepost 180–195"). */
  areaLabel: string;
  /** The posting source, named ("Colorado DOT · COtrip"). */
  sourceLabel: string;
  /** Along-route miles where the requirement starts. */
  atAlongMi: number;
  /** Chain-up pullouts on the approach, from map data. */
  pulloutMi: number[];
}

/** The chain call fires when a DOT-posted requirement starts
 *  within this distance ahead. */
export const CHAIN_ALERT_MI = 10;

export interface ChainAlert {
  requirement: ChainRequirement;
  distAheadMi: number;
  law: ChainLaw | null;
  /** The nearest chain-up pullout ahead before the checkpoint. */
  nextPulloutMi: number | null;
}

/** The nearest DOT-posted active requirement ahead — or null.
 *  Requirements behind the truck or beyond the alert distance
 *  never fire. NO requirement record, NO call: the static law
 *  alone never produces this alert. */
export function chainAlertFor(requirements: ChainRequirement[], progressMi: number): ChainAlert | null {
  let best: ChainAlert | null = null;
  for (const r of requirements) {
    const dist = r.atAlongMi - progressMi;
    if (dist <= 0 || dist > CHAIN_ALERT_MI) continue;
    if (!best || dist < best.distAheadMi) {
      const pull = r.pulloutMi.filter((m) => m > progressMi && m <= r.atAlongMi).sort((a, b) => a - b);
      best = {
        requirement: r,
        distAheadMi: dist,
        law: CHAIN_LAWS[r.state] ?? null,
        nextPulloutMi: pull.length > 0 ? pull[pull.length - 1]! : null,
      };
    }
  }
  return best;
}

/** The spoken chain call — the brief's own words + the pullout. */
export function chainSpoken(a: ChainAlert): string {
  const d = (Math.round(a.distAheadMi * 10) / 10).toFixed(1);
  const pull =
    a.nextPulloutMi != null
      ? ` Chain-up pullout ${((Math.round((a.nextPulloutMi) * 10) / 10)).toFixed(1)} miles along your route.`
      : "";
  return `Chains required ahead. ${a.requirement.areaLabel}, in ${d} miles.${pull}`;
}

/** Chain-up pullout from map data (OpenStreetMap): a parking /
 *  rest area whose tags say it is for chaining up. Locations only,
 *  like every map layer — where the map has none, none show. */
export interface ChainPullout {
  id: string;
  lat: number;
  lon: number;
  name: string | null;
}

export interface PulloutElement {
  id: number;
  type: string;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

export function parseChainPullouts(elements: PulloutElement[] | null | undefined): ChainPullout[] {
  if (!Array.isArray(elements)) return [];
  const out: ChainPullout[] = [];
  const seen = new Set<string>();
  for (const el of elements) {
    const tags = el.tags ?? {};
    const named = /chain/i.test(tags.name ?? "");
    const tagged = tags.chain_up === "yes" || tags.service === "chain_up";
    if (!named && !tagged) continue;
    let lat: number | null = null;
    let lon: number | null = null;
    if (el.lat != null && el.lon != null) {
      lat = el.lat;
      lon = el.lon;
    } else if (el.geometry && el.geometry.length > 0) {
      const mid = el.geometry[Math.floor(el.geometry.length / 2)]!;
      lat = mid.lat;
      lon = mid.lon;
    }
    if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const id = `pullout-${el.type}-${el.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, lat, lon, name: tags.name ?? null });
  }
  return out;
}
