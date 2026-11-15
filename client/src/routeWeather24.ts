// routeWeather24.ts — the NEXT-24-HOURS half of route weather:
// pure logic (no DOM, no React), like routeWeather.ts, so the
// exact production behaviour is unit-testable (see
// routeWeather24.test.ts).
//
// What routeWeather.ts already did (2026-11-01 build): CURRENT
// conditions at corridor points, tonight at your stop, NWS alerts,
// decision grading. What it never did — the TMS queue item 6 gap
// (2026-11-15): the forecast for WHEN THE DRIVER GETS THERE. A
// corridor point 300 miles out is six hours away; its current
// weather is trivia, its weather at arrival is a plan.
//
// This module closes that gap with the same honesty rules:
//  - source is Open-Meteo's hourly forecast — FREE public data,
//    no key, no paid feed (the revenue gate on paid feeds stands);
//  - each corridor point's ETA comes from its miles ahead at the
//    truck's pace — current speed when rolling, else 50 mph, the
//    same standing pace the tonight-stop estimate uses;
//  - the reading is the hourly forecast AT that ETA, matched in
//    the forecast point's own local time (Open-Meteo hourly times
//    are local to the point; utc_offset_seconds does the math);
//  - a point whose ETA lands beyond 24 hours, or whose hour the
//    feed didn't answer, carries NO condition — it says so
//    instead of borrowing a nearer hour's weather;
//  - arrival hazards grade into decisions in the FUTURE tense
//    with their own dedupe keys, so a storm at your arrival never
//    masquerades as a storm right now, and never collides with
//    the current-conditions decisions in the fired list.

import { conditionFromWmo, clampGustThreshold, type WeatherCondition } from "./routeWeather";

export const ROUTE_WEATHER_24H_MS = 24 * 3600_000;

/** The truck's planning pace: current speed when actually rolling,
 *  else 50 mph — the standing estimate the tonight-stop math uses. */
export function paceMphFor(speedMph: number | null): number {
  return speedMph != null && speedMph > 10 ? speedMph : 50;
}

export interface OmHourly {
  utcOffsetSeconds: number;
  /** Local ISO hours at the forecast point: "2026-11-15T14:00". */
  times: string[];
  codes: number[];
  tempF: (number | null)[];
  precipChancePct: (number | null)[];
  gustMph: (number | null)[];
  visibilityMi: (number | null)[];
}

type OmHourlyResponse = {
  utc_offset_seconds?: number;
  hourly?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m?: number[];
    precipitation_probability?: number[];
    wind_gusts_10m?: number[];
    visibility?: number[];
  };
};

/** Parse one Open-Meteo response's hourly block. Null when the
 *  answer carries no usable hourly time axis — never a guess. */
export function parseOmHourly(data: unknown): OmHourly | null {
  const d = data as OmHourlyResponse | null;
  const h = d?.hourly;
  if (!h || !Array.isArray(h.time) || h.time.length === 0 || !Array.isArray(h.weather_code)) return null;
  const num = (arr: number[] | undefined, i: number): number | null =>
    arr && typeof arr[i] === "number" && Number.isFinite(arr[i]) ? arr[i]! : null;
  return {
    utcOffsetSeconds: typeof d.utc_offset_seconds === "number" ? d.utc_offset_seconds : 0,
    times: h.time,
    codes: h.time.map((_, i) => (typeof h.weather_code![i] === "number" ? h.weather_code![i]! : -1)),
    tempF: h.time.map((_, i) => num(h.temperature_2m, i)),
    precipChancePct: h.time.map((_, i) => num(h.precipitation_probability, i)),
    gustMph: h.time.map((_, i) => num(h.wind_gusts_10m, i)),
    visibilityMi: h.time.map((_, i) => {
      const m = num(h.visibility, i);
      return m == null ? null : Math.round((m / 1609.34) * 10) / 10;
    }),
  };
}

function localHourKey(atMs: number, utcOffsetSeconds: number): string {
  const local = new Date(atMs + utcOffsetSeconds * 1000);
  const y = local.getUTCFullYear();
  const mo = String(local.getUTCMonth() + 1).padStart(2, "0");
  const da = String(local.getUTCDate()).padStart(2, "0");
  const hh = String(local.getUTCHours()).padStart(2, "0");
  return `${y}-${mo}-${da}T${hh}:00`;
}

/** The hourly index covering an instant, in the forecast point's
 *  own local time. -1 when the fetched window doesn't cover it. */
export function hourlyIndexAt(hourly: OmHourly, atMs: number): number {
  return hourly.times.indexOf(localHourKey(atMs, hourly.utcOffsetSeconds));
}

export interface ArrivalSampleLike {
  label: string;
  aheadMi: number;
  alongMi: number;
}

export interface ArrivalForecastPoint extends ArrivalSampleLike {
  etaMs: number;
  /** ETA lands beyond the 24-hour spec window — no reading. */
  beyond24h: boolean;
  /** Null = the feed's hourly window didn't cover the ETA hour. */
  condition: WeatherCondition | null;
  tempF: number | null;
  precipChancePct: number | null;
  gustMph: number | null;
  visibilityMi: number | null;
}

/** Arrival-timed forecasts for the corridor points AHEAD of the
 *  truck (here is covered by current conditions). One entry per
 *  sample, in sample order; points the feed couldn't answer keep
 *  their slot with a null condition so the UI can say so. */
export function buildArrivalForecast(args: {
  samples: ArrivalSampleLike[];
  hourlyBySample: (OmHourly | null)[];
  nowMs: number;
  speedMph: number | null;
}): ArrivalForecastPoint[] {
  const pace = paceMphFor(args.speedMph);
  const out: ArrivalForecastPoint[] = [];
  args.samples.forEach((s, i) => {
    if (s.aheadMi < 1) return; // here — current conditions own it
    const etaMs = args.nowMs + (s.aheadMi / pace) * 3600_000;
    const base: ArrivalForecastPoint = {
      ...s,
      etaMs,
      beyond24h: etaMs - args.nowMs > ROUTE_WEATHER_24H_MS,
      condition: null,
      tempF: null,
      precipChancePct: null,
      gustMph: null,
      visibilityMi: null,
    };
    if (base.beyond24h) {
      out.push(base);
      return;
    }
    const hourly = args.hourlyBySample[i] ?? null;
    if (!hourly) {
      out.push(base);
      return;
    }
    const idx = hourlyIndexAt(hourly, etaMs);
    if (idx < 0) {
      out.push(base);
      return;
    }
    out.push({
      ...base,
      condition: conditionFromWmo(hourly.codes[idx] ?? -1),
      tempF: hourly.tempF[idx] ?? null,
      precipChancePct: hourly.precipChancePct[idx] ?? null,
      gustMph: hourly.gustMph[idx] ?? null,
      visibilityMi: hourly.visibilityMi[idx] ?? null,
    });
  });
  return out;
}

// ---------- Arrival decision grading ------------------------------------------

export type ArrivalDecisionKind = "eta_ice" | "eta_snow" | "eta_storm" | "eta_gusts" | "eta_low_visibility";

export interface ArrivalDecision {
  kind: ArrivalDecisionKind;
  title: string;
  detail: string;
  /** weather-eta-… keys, bucketed by corridor segment + the ETA's
   *  own 6-hour window: as the ETA rolls into a new window the
   *  finding may surface again; inside a window it fires once. */
  dedupeKey: string;
}

function etaBucket(etaMs: number): number {
  return Math.floor(etaMs / (6 * 3600_000));
}

function segmentKey(aheadMi: number): string {
  return `seg${Math.floor(aheadMi / 25)}`;
}

/** Grade arrival forecasts into decisions — the same hazards as
 *  the current-conditions grader (ice / snow / storm / gusts over
 *  the driver's own line / near-zero visibility), phrased for
 *  arrival: this is the sky the driver is driving INTO, hours
 *  from now, which is exactly when a plan can still change. */
export function evaluateArrivalDecisions(args: {
  points: ArrivalForecastPoint[];
  gustThresholdMph: number;
  etaLabel: (p: ArrivalForecastPoint) => string;
}): ArrivalDecision[] {
  const threshold = clampGustThreshold(args.gustThresholdMph);
  const out: ArrivalDecision[] = [];
  for (const p of args.points) {
    if (p.beyond24h || p.condition == null) continue;
    const where = `${Math.round(p.aheadMi)} mi ahead`;
    const when = args.etaLabel(p);
    const seg = segmentKey(p.aheadMi);
    const bucket = etaBucket(p.etaMs);
    if (p.condition === "freezing_rain") {
      out.push({
        kind: "eta_ice",
        title: `Ice when you get there — freezing rain about ${where}, arriving ${when}`,
        detail: `The forecast for your arrival about ${where} (${when}) is freezing rain / ice. That's hours out — the plan can still change: a stop short of it, or a later start, beats meeting ice on schedule. Forecast: Open-Meteo hourly, free public data.`,
        dedupeKey: `weather-eta-ice-${seg}-${bucket}`,
      });
    } else if (p.condition === "snow") {
      out.push({
        kind: "eta_snow",
        title: `Snow when you get there — about ${where}, arriving ${when}`,
        detail: `The forecast for your arrival about ${where} (${when}) is snow. Check chain laws for the states ahead before you're committed to the timing. Forecast: Open-Meteo hourly, free public data.`,
        dedupeKey: `weather-eta-snow-${seg}-${bucket}`,
      });
    } else if (p.condition === "thunderstorm") {
      out.push({
        kind: "eta_storm",
        title: `Storms when you get there — about ${where}, arriving ${when}`,
        detail: `The forecast for your arrival about ${where} (${when}) is thunderstorms. A high-profile rig meets a storm cell as a wind problem — arriving an hour either side can be a different sky. Forecast: Open-Meteo hourly, free public data.`,
        dedupeKey: `weather-eta-storm-${seg}-${bucket}`,
      });
    }
    if (p.gustMph != null && p.gustMph >= threshold) {
      out.push({
        kind: "eta_gusts",
        title: `Gusts ${Math.round(p.gustMph)} mph when you get there — about ${where}, over your ${threshold} mph line`,
        detail: `Gusts of ${Math.round(p.gustMph)} mph are forecast about ${where} for your arrival (${when}) — over the gust threshold you set. An empty or light flatbed feels that first; timing the leg differently is the lever. Forecast: Open-Meteo hourly, free public data.`,
        dedupeKey: `weather-eta-gust-${seg}-${bucket}`,
      });
    }
    if (p.visibilityMi != null && p.visibilityMi < 0.25) {
      out.push({
        kind: "eta_low_visibility",
        title: `Near-zero visibility when you get there — about ${where}, arriving ${when}`,
        detail: `Visibility under a quarter mile is forecast about ${where} for your arrival (${when}). Plan the slow-down — or the stop — before it, not in it. Forecast: Open-Meteo hourly, free public data.`,
        dedupeKey: `weather-eta-vis-${seg}-${bucket}`,
      });
    }
  }
  return out;
}
