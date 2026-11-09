// Route weather — pure logic (no DOM, no React), like
// routeGeometry.ts / trafficSegments.ts, so the exact production
// behaviour is unit-testable (see routeWeather.test.ts).
//
// Driver order 2026-11-01: "add weather also" → "Let's do it.
// We SI keep it updated?" — ROUTE weather, not a weather app:
//   - corridor samples: weather at points AHEAD of the truck on
//     the active route, labelled by miles ahead — never a city
//     forecast page;
//   - wind-gust decisions against a driver-set threshold
//     (flatbed-relevant: a gusty crosswind is a business call);
//   - "tonight at your stop": weather at the place the HOS
//     driving clock runs out on this route (the same reachability
//     math the parking planner runs), paired with a real stop
//     when one sits near that point;
//   - decision grading: only weather that changes a driving
//     decision surfaces (SI Rule 5 — decisions, not chores).
//     Benign weather is panel data, never a banner, never an
//     inbox item.
//
// Sources are PUBLIC only (SI Rule 1): Open-Meteo forecasts and
// National Weather Service alerts — no key, no personal data.
// Nothing here invents a condition: a sample the feed didn't
// answer is absent, and the panel says "weather unavailable".

export type LatLon = { lat: number; lon: number };

export function haversineMi(a: LatLon, b: LatLon): number {
  const R = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Cumulative along-route miles for each coord (index-aligned). */
export function cumulativeMiles(coords: [number, number][]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < coords.length; i++) {
    if (i > 0) {
      const a = coords[i - 1]!;
      const b = coords[i]!;
      acc += haversineMi({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] });
    }
    out.push(acc);
  }
  return out;
}

/** The coord at an along-route distance (mi from the route start),
 *  linearly interpolated between its neighbours. Null on a route
 *  too short to walk. */
export function pointAtAlongMi(
  coords: [number, number][],
  cum: number[],
  alongMi: number,
): { lat: number; lon: number; alongMi: number } | null {
  if (coords.length < 2 || cum.length !== coords.length) return null;
  const total = cum[cum.length - 1] ?? 0;
  const target = Math.max(0, Math.min(total, alongMi));
  let idx = cum.findIndex((c) => c >= target);
  if (idx < 0) idx = coords.length - 1;
  if (idx === 0) {
    const c = coords[0]!;
    return { lat: c[0], lon: c[1], alongMi: 0 };
  }
  const prev = coords[idx - 1]!;
  const cur = coords[idx]!;
  const segStart = cum[idx - 1] ?? 0;
  const segEnd = cum[idx] ?? segStart;
  const frac = segEnd > segStart ? (target - segStart) / (segEnd - segStart) : 0;
  return {
    lat: prev[0] + (cur[0] - prev[0]) * frac,
    lon: prev[1] + (cur[1] - prev[1]) * frac,
    alongMi: target,
  };
}

/** Along-route distance of the point on the route nearest to pos. */
export function nearestAlongMi(coords: [number, number][], cum: number[], pos: LatLon): number {
  let best = 0;
  let bestOff = Number.POSITIVE_INFINITY;
  for (let i = 0; i < coords.length; i++) {
    const c = coords[i]!;
    const off = haversineMi(pos, { lat: c[0], lon: c[1] });
    if (off < bestOff) {
      bestOff = off;
      best = cum[i] ?? 0;
    }
  }
  return best;
}

export type CorridorSamplePoint = {
  lat: number;
  lon: number;
  /** Miles from the route start. */
  alongMi: number;
  /** Miles ahead of the truck (0 at/behind the truck). */
  aheadMi: number;
  label: string;
};

/** Sample points AHEAD of the truck on the route: here, then
 *  roughly +25 / +60 / +120 mi ahead (whichever exist), then the
 *  destination end. Short routes collapse to here + the end.
 *  Pure geometry — no weather is claimed here. */
export function corridorSamplePoints(
  coords: [number, number][],
  pos: LatLon | null,
): CorridorSamplePoint[] {
  if (coords.length < 2) return [];
  const cum = cumulativeMiles(coords);
  const total = cum[cum.length - 1] ?? 0;
  if (total <= 0) return [];
  const hereAlong = pos ? nearestAlongMi(coords, cum, pos) : 0;
  const targets: { along: number; label: string }[] = [{ along: hereAlong, label: "Here" }];
  for (const step of [25, 60, 120]) {
    const along = hereAlong + step;
    if (along < total - 8) targets.push({ along, label: `${step} mi ahead` });
  }
  if (total - hereAlong > 8) targets.push({ along: total, label: "At your destination" });
  const out: CorridorSamplePoint[] = [];
  const seen = new Set<string>();
  for (const t of targets) {
    const p = pointAtAlongMi(coords, cum, t.along);
    if (!p) continue;
    const key = `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      lat: p.lat,
      lon: p.lon,
      alongMi: Math.round(p.alongMi * 10) / 10,
      aheadMi: Math.round(Math.max(0, p.alongMi - hereAlong) * 10) / 10,
      label: t.label,
    });
  }
  return out;
}

// ---------- Tonight's stop (HOS end-of-day) ----------------------------------

export type TonightStopEstimate = {
  lat: number;
  lon: number;
  /** Miles ahead of the truck where the driving clock runs out. */
  aheadMi: number;
  /** How the estimate was made — stated honestly in the UI. */
  basis: "hos_clock" | "destination" | "here";
  label: string;
};

/** Where tonight's stop is: walk the route to the distance the
 *  HOS driving clock can still cover at the truck's pace (the
 *  parking planner's own math: current speed when rolling, else
 *  50 mph). If the destination is closer than the clock, tonight
 *  is the destination. With no HOS log yet, the honest fallback
 *  is the destination; with no route at all, tonight is here. */
export function estimateTonightStop(args: {
  coords: [number, number][];
  pos: LatLon | null;
  hosHasData: boolean;
  driveRemainH: number;
  speedMph: number | null;
  destinationLabel: string | null;
}): TonightStopEstimate | null {
  const { coords, pos } = args;
  if (coords.length < 2) {
    if (!pos) return null;
    return { lat: pos.lat, lon: pos.lon, aheadMi: 0, basis: "here", label: "Where you are now (no route set)" };
  }
  const cum = cumulativeMiles(coords);
  const total = cum[cum.length - 1] ?? 0;
  const hereAlong = pos ? nearestAlongMi(coords, cum, pos) : 0;
  const remaining = Math.max(0, total - hereAlong);
  if (!args.hosHasData) {
    const end = pointAtAlongMi(coords, cum, total);
    if (!end) return null;
    return {
      lat: end.lat,
      lon: end.lon,
      aheadMi: Math.round(remaining * 10) / 10,
      basis: "destination",
      label: args.destinationLabel ? `Your destination — ${args.destinationLabel}` : "Your destination",
    };
  }
  const pace = args.speedMph != null && args.speedMph > 10 ? args.speedMph : 50;
  const rangeMi = Math.max(0, args.driveRemainH) * pace;
  if (rangeMi >= remaining) {
    const end = pointAtAlongMi(coords, cum, total);
    if (!end) return null;
    return {
      lat: end.lat,
      lon: end.lon,
      aheadMi: Math.round(remaining * 10) / 10,
      basis: "destination",
      label: args.destinationLabel ? `Your destination — ${args.destinationLabel}` : "Your destination",
    };
  }
  const p = pointAtAlongMi(coords, cum, hereAlong + rangeMi);
  if (!p) return null;
  return {
    lat: p.lat,
    lon: p.lon,
    aheadMi: Math.round(rangeMi * 10) / 10,
    basis: "hos_clock",
    label: `Where your driving clock runs out — about ${Math.round(rangeMi)} mi ahead on this route`,
  };
}

/** Pair tonight's estimate with a real stop: the fuel stop whose
 *  along-route miles sit closest to the clock-out distance, within
 *  a window, and no farther than the clock reaches. Returns the
 *  stop's index in the given list, or -1 when nothing pairs —
 *  the weather then pins to the route point itself, labelled so. */
export function pairTonightStop<T extends { alongMi: number }>(
  stops: T[],
  tonightAheadMi: number,
  windowMi = 20,
): number {
  let best = -1;
  let bestGap = Number.POSITIVE_INFINITY;
  stops.forEach((s, i) => {
    if (s.alongMi > tonightAheadMi + 2) return; // past the clock — not tonight's stop
    const gap = Math.abs(tonightAheadMi - s.alongMi);
    if (gap <= windowMi && gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  });
  return best;
}

// ---------- Weather conditions ------------------------------------------------

export type WeatherCondition =
  | "thunderstorm"
  | "freezing_rain"
  | "snow"
  | "heavy_rain"
  | "rain"
  | "fog"
  | "clear"
  | "cloudy"
  | "unknown";

/** WMO weather code → the condition a driver plans around. */
export function conditionFromWmo(code: number): WeatherCondition {
  if (code >= 95) return "thunderstorm";
  if (code === 56 || code === 57 || code === 66 || code === 67) return "freezing_rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code === 65 || code === 82) return "heavy_rain";
  if (code === 51 || code === 53 || code === 55 || code === 61 || code === 63 || code === 80 || code === 81) return "rain";
  if (code === 45 || code === 48) return "fog";
  if (code === 0 || code === 1) return "clear";
  if (code === 2 || code === 3) return "cloudy";
  return "unknown";
}

export const CONDITION_LABEL: Record<WeatherCondition, string> = {
  thunderstorm: "Thunderstorms",
  freezing_rain: "Freezing rain / ice",
  snow: "Snow",
  heavy_rain: "Heavy rain",
  rain: "Rain",
  fog: "Fog",
  clear: "Clear",
  cloudy: "Cloudy",
  unknown: "—",
};

export type CorridorWeatherPoint = CorridorSamplePoint & {
  condition: WeatherCondition;
  tempF: number | null;
  windMph: number | null;
  gustMph: number | null;
  visibilityMi: number | null;
};

export type TonightWeather = {
  condition: WeatherCondition;
  lowF: number | null;
  highF: number | null;
  precipChancePct: number | null;
  gustMaxMph: number | null;
  windMph: number | null;
};

// ---------- Decision grading (SI Rule 5) ---------------------------------------

export type WeatherDecisionKind =
  | "ice_ahead"
  | "snow_ahead"
  | "storm_ahead"
  | "gusts_ahead"
  | "low_visibility_ahead"
  | "tonight_severe"
  | "tonight_freeze";

export type WeatherDecision = {
  kind: WeatherDecisionKind;
  title: string;
  detail: string;
  /** Stable per segment + 6-hour window: the same decision never
   *  surfaces twice inside its window (the server dedupes on it
   *  across sessions; the client dedupes on it in-session). */
  dedupeKey: string;
};

export const DEFAULT_GUST_THRESHOLD_MPH = 35;
export const GUST_THRESHOLD_MIN = 20;
export const GUST_THRESHOLD_MAX = 60;

export function clampGustThreshold(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_GUST_THRESHOLD_MPH;
  return Math.max(GUST_THRESHOLD_MIN, Math.min(GUST_THRESHOLD_MAX, Math.round(v)));
}

function windowBucket(atMs: number): number {
  return Math.floor(atMs / (6 * 3600_000));
}

function segmentKey(p: { aheadMi: number }): string {
  // Bucket by ~25-mi corridor segment so a decision follows the
  // STRETCH, not a single sampled coordinate.
  return `seg${Math.floor(p.aheadMi / 25)}`;
}

/** Grade corridor + tonight weather into decisions. ONLY these
 *  surface: ice / snow / storm / gusts over the driver's own
 *  threshold / near-zero visibility ahead, and severe or freezing
 *  weather on tonight's stop. Everything else stays panel data.
 *  The last-good-stop hint rides on ice/snow/storm decisions when
 *  an earlier sample is still clear of that hazard. */
export function evaluateWeatherDecisions(args: {
  corridor: CorridorWeatherPoint[];
  tonight: { weather: TonightWeather; label: string } | null;
  gustThresholdMph: number;
  atMs: number;
}): WeatherDecision[] {
  const threshold = clampGustThreshold(args.gustThresholdMph);
  const bucket = windowBucket(args.atMs);
  const out: WeatherDecision[] = [];
  const firstClearBefore = (idx: number): CorridorWeatherPoint | null => {
    for (let i = idx - 1; i >= 0; i--) {
      const p = args.corridor[i]!;
      if (p.condition !== "freezing_rain" && p.condition !== "snow" && p.condition !== "thunderstorm") return p;
    }
    return null;
  };
  args.corridor.forEach((p, idx) => {
    if (p.aheadMi < 1) return; // weather HERE is the panel's job; decisions are about what's AHEAD
    const where = `${Math.round(p.aheadMi)} mi ahead`;
    const stopHint = (() => {
      const prev = firstClearBefore(idx);
      return prev ? ` The last sampled stretch clear of it is around ${Math.round(prev.aheadMi)} mi ahead — plan the stop before the hazard, not in it.` : "";
    })();
    if (p.condition === "freezing_rain") {
      out.push({
        kind: "ice_ahead",
        title: `Ice ahead — freezing rain about ${where}`,
        detail: `Open-Meteo is reporting freezing rain / ice on your route about ${where}. Ice changes the run: slow early, and treat bridges and overpasses as iced first.${stopHint}`,
        dedupeKey: `weather-ice-${segmentKey(p)}-${bucket}`,
      });
    } else if (p.condition === "snow") {
      out.push({
        kind: "snow_ahead",
        title: `Snow ahead — about ${where}`,
        detail: `Open-Meteo is reporting snow on your route about ${where}. Check chain laws for the states ahead and leave following room early.${stopHint}`,
        dedupeKey: `weather-snow-${segmentKey(p)}-${bucket}`,
      });
    } else if (p.condition === "thunderstorm") {
      out.push({
        kind: "storm_ahead",
        title: `Storm ahead — thunderstorms about ${where}`,
        detail: `Open-Meteo is reporting thunderstorms on your route about ${where}. A high-profile rig in a storm cell is a wind problem as much as a rain problem.${stopHint}`,
        dedupeKey: `weather-storm-${segmentKey(p)}-${bucket}`,
      });
    }
    if (p.gustMph != null && p.gustMph >= threshold) {
      out.push({
        kind: "gusts_ahead",
        title: `Wind gusts ${Math.round(p.gustMph)} mph ahead — over your ${threshold} mph line`,
        detail: `Gusts of ${Math.round(p.gustMph)} mph are forecast about ${where} (sustained ${p.windMph != null ? Math.round(p.windMph) : "—"} mph). That's over the gust threshold you set — an empty or light flatbed feels that first. The threshold is yours to move in Route weather.`,
        dedupeKey: `weather-gust-${segmentKey(p)}-${bucket}`,
      });
    }
    if (p.visibilityMi != null && p.visibilityMi < 0.25) {
      out.push({
        kind: "low_visibility_ahead",
        title: `Near-zero visibility ahead — about ${where}`,
        detail: `Visibility is forecast under a quarter mile about ${where}. Plan to slow well before it, not in it.`,
        dedupeKey: `weather-vis-${segmentKey(p)}-${bucket}`,
      });
    }
  });
  if (args.tonight) {
    const w = args.tonight.weather;
    const label = args.tonight.label;
    if (w.condition === "thunderstorm" || w.condition === "freezing_rain" || w.condition === "snow") {
      out.push({
        kind: "tonight_severe",
        title: `Tonight at your stop: ${CONDITION_LABEL[w.condition]}`,
        detail: `${label}. Tonight there: ${CONDITION_LABEL[w.condition].toLowerCase()}${w.lowF != null ? `, low ${Math.round(w.lowF)}°F` : ""}${w.gustMaxMph != null ? `, gusts to ${Math.round(w.gustMaxMph)} mph` : ""}. Pick tonight's parking with that sky in mind — the stop card for the paired stop is in Route weather.`,
        dedupeKey: `weather-tonight-severe-${bucket}`,
      });
    } else if (w.lowF != null && w.lowF <= 32 && (w.precipChancePct ?? 0) >= 30) {
      out.push({
        kind: "tonight_freeze",
        title: `Tonight at your stop: freezing with precipitation likely`,
        detail: `${label}. Low ${Math.round(w.lowF)}°F with a ${Math.round(w.precipChancePct ?? 0)}% chance of precipitation — expect iced steps, mirrors, and lot surfaces by morning.`,
        dedupeKey: `weather-tonight-freeze-${bucket}`,
      });
    }
    if (w.gustMaxMph != null && w.gustMaxMph >= threshold) {
      out.push({
        kind: "gusts_ahead",
        title: `Tonight at your stop: gusts ${Math.round(w.gustMaxMph)} mph — over your ${threshold} mph line`,
        detail: `${label}. Overnight gusts to ${Math.round(w.gustMaxMph)} mph are forecast there. Park nose-into-the-wind where you can and chock the plan accordingly.`,
        dedupeKey: `weather-tonight-gust-${bucket}`,
      });
    }
  }
  return out;
}

/** Radar tile template (NWS NEXRAD composite via the Iowa State
 *  Mesonet tile cache — public, keyless). {z}/{x}/{y} are filled
 *  by the map engine. */
export const RADAR_TILE_URL =
  "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png";
export const RADAR_SOURCE_LABEL = "NWS NEXRAD radar via Iowa State Mesonet (public tiles)";

/** Slippy-map tile indices for a position at a zoom — used to
 *  probe ONE real radar tile before claiming the overlay works. */
export function tileFor(lat: number, lon: number, z: number): { x: number; y: number } {
  const x = Math.floor(((lon + 180) / 360) * 2 ** z);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
  return { x, y };
}

export function radarTileUrlFor(lat: number, lon: number, z: number): string {
  const { x, y } = tileFor(lat, lon, z);
  return RADAR_TILE_URL.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}
