// goWeather.ts — the Go screen's live weather chip: pure logic
// (no DOM, no React), like routeWeather.ts, so the production
// behaviour is unit-testable (see goWeather.test.ts).
//
// Why this exists (field verdict 2026-11-01: "No weather update"):
// corridor weather lived ONLY in the Route weather panel, which
// is mounted in the parked Drive view — never on the Go map the
// driver is actually looking at — and its automatic refresh ran
// only while SI was on. SI off (the driver's state in the report)
// meant nothing fetched, nothing updated, and the driving screen
// showed no weather at all.
//
// The chip fixes the surface, not just the schedule:
//  - it lives ON the Go map, always visible while driving;
//  - it fetches on its own cadence — every 10 minutes, on a route
//    change, and every ~5 miles rolled — with NO SI gate (SI
//    still owns decision surfacing in the panel; a plain weather
//    readout was never a decision, and gating the readout on SI
//    is what starved it);
//  - it shows HERE plus the worst condition ahead on the route
//    (the +60 mi corridor sample) when a route is set;
//  - a feed that doesn't answer shows "weather unavailable" with
//    a Retry — conditions are never invented (SI Rule 1 holds:
//    public Open-Meteo data only).

import { conditionFromWmo, haversineMi, type WeatherCondition } from "./routeWeather";

export type LatLon = { lat: number; lon: number };

export type GoWeatherReading = {
  condition: WeatherCondition;
  tempF: number | null;
  windMph: number | null;
  gustMph: number | null;
};

export type GoWeatherAhead = GoWeatherReading & { aheadMi: number };

/** Refresh cadence for the chip: a 10-minute beat… */
export const GO_WEATHER_REFRESH_MS = 600_000;
/** …or ~5 miles rolled since the last fetch's anchor, whichever
 *  comes first — the same discipline the panel uses, minus the
 *  SI gate. */
export const GO_WEATHER_MOVE_MI = 5;

export function goWeatherUrl(lat: number, lon: number): string {
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&current=temperature_2m,weather_code,wind_speed_10m,wind_gusts_10m` +
    `&forecast_days=1&wind_speed_unit=mph&temperature_unit=fahrenheit`
  );
}

type OmCurrent = {
  current?: {
    temperature_2m?: number;
    weather_code?: number;
    wind_speed_10m?: number;
    wind_gusts_10m?: number;
  };
};

/** Parse one Open-Meteo current-conditions answer. Null when the
 *  answer carries no current block — never a guessed reading. */
export function parseGoWeather(data: unknown): GoWeatherReading | null {
  const cur = (data as OmCurrent | null)?.current;
  if (!cur || typeof cur.weather_code !== "number") return null;
  return {
    condition: conditionFromWmo(cur.weather_code),
    tempF: typeof cur.temperature_2m === "number" ? cur.temperature_2m : null,
    windMph: typeof cur.wind_speed_10m === "number" ? cur.wind_speed_10m : null,
    gustMph: typeof cur.wind_gusts_10m === "number" ? cur.wind_gusts_10m : null,
  };
}

export type GoWeatherAnchor = { lat: number; lon: number; routeKey: string; atMs: number };

/** Should the chip fetch now? True on first need, on a route
 *  change, when the refresh beat has passed, or when the truck
 *  has rolled the move distance past the last fetch's anchor. */
export function shouldFetchGoWeather(args: {
  anchor: GoWeatherAnchor | null;
  pos: LatLon | null;
  routeKey: string;
  nowMs: number;
}): boolean {
  const { anchor, pos, routeKey, nowMs } = args;
  if (!pos) return false;
  if (!anchor) return true;
  if (anchor.routeKey !== routeKey) return true;
  if (nowMs - anchor.atMs >= GO_WEATHER_REFRESH_MS) return true;
  return haversineMi(pos, anchor) >= GO_WEATHER_MOVE_MI;
}
