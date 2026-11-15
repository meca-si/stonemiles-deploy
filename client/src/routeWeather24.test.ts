// routeWeather24.test.ts — PURE tests for the next-24-hours
// arrival weather (TMS queue item 6): Open-Meteo hourly parsing,
// ETA computation at the truck's pace, local-time hour matching,
// the 24h cap, and future-tense arrival decision grading.
//
// Run: bun test client/src/routeWeather24.test.ts
import { describe, expect, test } from "bun:test";
import {
  buildArrivalForecast,
  evaluateArrivalDecisions,
  hourlyIndexAt,
  paceMphFor,
  parseOmHourly,
  type ArrivalForecastPoint,
  type OmHourly,
} from "./routeWeather24";

// A synthetic hourly feed: 48 hours from 2026-11-15T00:00 local,
// clear except a freezing-rain hour at index 8 and a gusty
// thunderstorm at index 30. UTC offset -6 (Central).
function makeHourly(over: Partial<OmHourly> = {}): OmHourly {
  const times: string[] = [];
  for (let i = 0; i < 48; i++) {
    const day = 15 + Math.floor(i / 24);
    times.push(`2026-11-${day}T${String(i % 24).padStart(2, "0")}:00`);
  }
  const codes = times.map(() => 0);
  codes[8] = 66; // freezing rain
  codes[30] = 95; // thunderstorm
  const gust = times.map(() => 10);
  gust[30] = 55;
  return {
    utcOffsetSeconds: -6 * 3600,
    times,
    codes,
    tempF: times.map(() => 40),
    precipChancePct: times.map(() => 10),
    gustMph: gust,
    visibilityMi: times.map(() => 10),
    ...over,
  };
}

// 2026-11-15T06:00:00Z = local midnight (offset -6) → index 0.
const NOW = Date.parse("2026-11-15T06:00:00.000Z");

describe("routeWeather24 — parsing and hour matching", () => {
  test("parseOmHourly reads the axis, offset, and converts visibility to miles", () => {
    const raw = {
      utc_offset_seconds: -21600,
      hourly: {
        time: ["2026-11-15T00:00", "2026-11-15T01:00"],
        weather_code: [0, 66],
        temperature_2m: [40, 31],
        precipitation_probability: [10, 80],
        wind_gusts_10m: [8, 12],
        visibility: [16093.4, 1609.34],
      },
    };
    const h = parseOmHourly(raw);
    expect(h).not.toBeNull();
    expect(h!.utcOffsetSeconds).toBe(-21600);
    expect(h!.codes[1]).toBe(66);
    expect(h!.visibilityMi[0]).toBe(10);
    expect(h!.visibilityMi[1]).toBe(1);
  });

  test("parseOmHourly refuses an answer with no hourly axis", () => {
    expect(parseOmHourly({ current: { weather_code: 0 } })).toBeNull();
    expect(parseOmHourly(null)).toBeNull();
  });

  test("hourlyIndexAt matches the instant in the point's own local time", () => {
    const h = makeHourly();
    expect(hourlyIndexAt(h, NOW)).toBe(0); // local midnight
    expect(hourlyIndexAt(h, NOW + 8 * 3600_000)).toBe(8); // local 08:00
    expect(hourlyIndexAt(h, NOW + 100 * 3600_000)).toBe(-1); // outside the window
  });

  test("pace is the rolling speed, else the standing 50 mph", () => {
    expect(paceMphFor(62)).toBe(62);
    expect(paceMphFor(8)).toBe(50);
    expect(paceMphFor(null)).toBe(50);
  });
});

describe("routeWeather24 — arrival forecasts", () => {
  test("each point ahead gets the forecast for its ETA hour, not the current hour", () => {
    const h = makeHourly();
    const pts = buildArrivalForecast({
      samples: [
        { label: "Here", aheadMi: 0, alongMi: 0 },
        { label: "400 mi ahead", aheadMi: 400, alongMi: 400 },
      ],
      hourlyBySample: [h, h],
      nowMs: NOW,
      speedMph: null, // standing pace 50 → 400 mi = 8h → index 8 (freezing rain)
    });
    expect(pts.length).toBe(1); // "Here" is current conditions' job
    expect(pts[0]!.aheadMi).toBe(400);
    expect(pts[0]!.condition).toBe("freezing_rain");
    expect(pts[0]!.beyond24h).toBe(false);
  });

  test("a point beyond 24 hours carries no condition — the window is the spec", () => {
    const h = makeHourly();
    const pts = buildArrivalForecast({
      samples: [{ label: "Destination", aheadMi: 1500, alongMi: 1500 }],
      hourlyBySample: [h],
      nowMs: NOW,
      speedMph: null, // 1500 mi at 50 mph = 30h out
    });
    expect(pts[0]!.beyond24h).toBe(true);
    expect(pts[0]!.condition).toBeNull();
  });

  test("a point whose feed didn't answer keeps its slot with a null condition", () => {
    const pts = buildArrivalForecast({
      samples: [{ label: "60 mi ahead", aheadMi: 60, alongMi: 60 }],
      hourlyBySample: [null],
      nowMs: NOW,
      speedMph: 60,
    });
    expect(pts.length).toBe(1);
    expect(pts[0]!.condition).toBeNull();
    expect(pts[0]!.beyond24h).toBe(false);
  });
});

describe("routeWeather24 — arrival decisions", () => {
  const label = (p: ArrivalForecastPoint) => `~${new Date(p.etaMs).toISOString().slice(11, 16)}`;

  test("ice at arrival grades a future-tense decision with an eta dedupe key", () => {
    const h = makeHourly();
    const pts = buildArrivalForecast({
      samples: [{ label: "400 mi ahead", aheadMi: 400, alongMi: 400 }],
      hourlyBySample: [h],
      nowMs: NOW,
      speedMph: null,
    });
    const ds = evaluateArrivalDecisions({ points: pts, gustThresholdMph: 35, etaLabel: label });
    expect(ds.length).toBe(1);
    expect(ds[0]!.kind).toBe("eta_ice");
    expect(ds[0]!.title).toContain("Ice when you get there");
    expect(ds[0]!.dedupeKey.startsWith("weather-eta-ice-")).toBe(true);
  });

  test("gusts at arrival grade against the driver's own threshold", () => {
    const direct: ArrivalForecastPoint[] = [{
      label: "X", aheadMi: 300, alongMi: 300, etaMs: NOW + 30 * 3600_000,
      beyond24h: false, condition: "thunderstorm", tempF: 60, precipChancePct: 90, gustMph: 55, visibilityMi: 5,
    }];
    expect(evaluateArrivalDecisions({ points: direct, gustThresholdMph: 35, etaLabel: label }).map((d) => d.kind)).toEqual(["eta_storm", "eta_gusts"]);
    expect(evaluateArrivalDecisions({ points: direct, gustThresholdMph: 60, etaLabel: label }).map((d) => d.kind)).toEqual(["eta_storm"]);
  });

  test("benign arrival weather grades nothing", () => {
    const pts: ArrivalForecastPoint[] = [{
      label: "X", aheadMi: 100, alongMi: 100, etaMs: NOW + 2 * 3600_000,
      beyond24h: false, condition: "clear", tempF: 55, precipChancePct: 0, gustMph: 8, visibilityMi: 10,
    }];
    expect(evaluateArrivalDecisions({ points: pts, gustThresholdMph: 35, etaLabel: label })).toEqual([]);
  });
});
