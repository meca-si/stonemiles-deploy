// Unit tests for route weather pure logic (client/src/routeWeather.ts).
// Run: bun test client/src/routeWeather.test.ts
import { describe, expect, test } from "bun:test";
import {
  clampGustThreshold,
  conditionFromWmo,
  corridorSamplePoints,
  estimateTonightStop,
  evaluateWeatherDecisions,
  pairTonightStop,
  radarTileUrlFor,
  type CorridorWeatherPoint,
} from "./routeWeather";

// A straight ~111-mi eastbound route along the equator-ish Gulf coast:
// coords every ~11 mi so cumulative math is easy to reason about.
const ROUTE: [number, number][] = Array.from({ length: 11 }, (_, i) => [30, -88 + i * 0.18]);

function corridorPoint(partial: Partial<CorridorWeatherPoint> & { aheadMi: number }): CorridorWeatherPoint {
  return {
    lat: 30,
    lon: -88,
    alongMi: partial.aheadMi,
    label: `${partial.aheadMi} mi ahead`,
    condition: "clear",
    tempF: 60,
    windMph: 8,
    gustMph: 12,
    visibilityMi: 10,
    ...partial,
  };
}

describe("conditionFromWmo", () => {
  test("maps the driving conditions", () => {
    expect(conditionFromWmo(95)).toBe("thunderstorm");
    expect(conditionFromWmo(66)).toBe("freezing_rain");
    expect(conditionFromWmo(71)).toBe("snow");
    expect(conditionFromWmo(65)).toBe("heavy_rain");
    expect(conditionFromWmo(61)).toBe("rain");
    expect(conditionFromWmo(45)).toBe("fog");
    expect(conditionFromWmo(0)).toBe("clear");
    expect(conditionFromWmo(3)).toBe("cloudy");
  });
});

describe("corridorSamplePoints", () => {
  test("samples here, ahead steps, and the destination", () => {
    const pts = corridorSamplePoints(ROUTE, { lat: 30, lon: -88 });
    expect(pts.length).toBeGreaterThanOrEqual(3);
    expect(pts[0]!.aheadMi).toBe(0);
    expect(pts[pts.length - 1]!.label).toBe("At your destination");
    // Ahead distances strictly increase.
    for (let i = 1; i < pts.length; i++) expect(pts[i]!.aheadMi).toBeGreaterThan(pts[i - 1]!.aheadMi);
  });
  test("no route → no samples (honest empty)", () => {
    expect(corridorSamplePoints([], { lat: 30, lon: -88 })).toEqual([]);
    expect(corridorSamplePoints([[30, -88]], { lat: 30, lon: -88 })).toEqual([]);
  });
});

describe("estimateTonightStop", () => {
  test("HOS clock runs out mid-route → stop is partway along", () => {
    const est = estimateTonightStop({
      coords: ROUTE,
      pos: { lat: 30, lon: -88 },
      hosHasData: true,
      driveRemainH: 1, // ~50 mi at the parked pace
      speedMph: null,
      destinationLabel: "Mobile, AL",
    });
    expect(est?.basis).toBe("hos_clock");
    expect(est!.aheadMi).toBeGreaterThan(40);
    expect(est!.aheadMi).toBeLessThan(60);
  });
  test("destination closer than the clock → tonight is the destination", () => {
    const est = estimateTonightStop({
      coords: ROUTE,
      pos: { lat: 30, lon: -88 },
      hosHasData: true,
      driveRemainH: 11,
      speedMph: null,
      destinationLabel: "Mobile, AL",
    });
    expect(est?.basis).toBe("destination");
  });
  test("no HOS log → destination fallback, said plainly", () => {
    const est = estimateTonightStop({
      coords: ROUTE,
      pos: { lat: 30, lon: -88 },
      hosHasData: false,
      driveRemainH: 11,
      speedMph: null,
      destinationLabel: null,
    });
    expect(est?.basis).toBe("destination");
  });
  test("no route → tonight is here", () => {
    const est = estimateTonightStop({
      coords: [],
      pos: { lat: 30, lon: -88 },
      hosHasData: true,
      driveRemainH: 5,
      speedMph: null,
      destinationLabel: null,
    });
    expect(est?.basis).toBe("here");
  });
  test("no route and no position → null (nothing invented)", () => {
    expect(
      estimateTonightStop({ coords: [], pos: null, hosHasData: false, driveRemainH: 0, speedMph: null, destinationLabel: null }),
    ).toBeNull();
  });
});

describe("pairTonightStop", () => {
  const stops = [{ alongMi: 10 }, { alongMi: 44 }, { alongMi: 90 }];
  test("pairs the stop nearest the clock-out distance", () => {
    expect(pairTonightStop(stops, 50)).toBe(1);
  });
  test("a stop past the clock never pairs", () => {
    expect(pairTonightStop([{ alongMi: 80 }], 50)).toBe(-1);
  });
  test("nothing within the window → -1", () => {
    expect(pairTonightStop(stops, 70, 10)).toBe(-1);
  });
});

describe("evaluateWeatherDecisions", () => {
  const atMs = Date.UTC(2026, 10, 1, 12, 0, 0);
  test("benign corridor surfaces NOTHING (decisions only)", () => {
    const d = evaluateWeatherDecisions({
      corridor: [corridorPoint({ aheadMi: 0 }), corridorPoint({ aheadMi: 40 }), corridorPoint({ aheadMi: 90 })],
      tonight: null,
      gustThresholdMph: 35,
      atMs,
    });
    expect(d).toEqual([]);
  });
  test("ice ahead surfaces once with a last-clear-stop hint", () => {
    const d = evaluateWeatherDecisions({
      corridor: [corridorPoint({ aheadMi: 0 }), corridorPoint({ aheadMi: 30 }), corridorPoint({ aheadMi: 90, condition: "freezing_rain" })],
      tonight: null,
      gustThresholdMph: 35,
      atMs,
    });
    expect(d.length).toBe(1);
    expect(d[0]!.kind).toBe("ice_ahead");
    expect(d[0]!.detail).toContain("last sampled stretch clear");
    expect(d[0]!.dedupeKey).toContain("weather-ice-");
  });
  test("weather HERE never becomes an ahead decision", () => {
    const d = evaluateWeatherDecisions({
      corridor: [corridorPoint({ aheadMi: 0, condition: "freezing_rain" })],
      tonight: null,
      gustThresholdMph: 35,
      atMs,
    });
    expect(d).toEqual([]);
  });
  test("gusts surface only over the driver's own threshold", () => {
    const corridor = [corridorPoint({ aheadMi: 50, gustMph: 38 })];
    expect(evaluateWeatherDecisions({ corridor, tonight: null, gustThresholdMph: 35, atMs }).length).toBe(1);
    expect(evaluateWeatherDecisions({ corridor, tonight: null, gustThresholdMph: 45, atMs }).length).toBe(0);
  });
  test("tonight severe + tonight gusts both surface", () => {
    const d = evaluateWeatherDecisions({
      corridor: [corridorPoint({ aheadMi: 0 })],
      tonight: {
        label: "Where your driving clock runs out",
        weather: { condition: "snow", lowF: 24, highF: 31, precipChancePct: 80, gustMaxMph: 41, windMph: 18 },
      },
      gustThresholdMph: 35,
      atMs,
    });
    expect(d.map((x) => x.kind)).toContain("tonight_severe");
    expect(d.map((x) => x.kind)).toContain("gusts_ahead");
  });
  test("dedupe keys are stable within a window and roll with it", () => {
    const corridor = [corridorPoint({ aheadMi: 90, condition: "snow" })];
    const a = evaluateWeatherDecisions({ corridor, tonight: null, gustThresholdMph: 35, atMs })[0]!;
    const b = evaluateWeatherDecisions({ corridor, tonight: null, gustThresholdMph: 35, atMs: atMs + 3600_000 })[0]!;
    const c = evaluateWeatherDecisions({ corridor, tonight: null, gustThresholdMph: 35, atMs: atMs + 7 * 3600_000 })[0]!;
    expect(a.dedupeKey).toBe(b.dedupeKey);
    expect(c.dedupeKey).not.toBe(a.dedupeKey);
  });
});

describe("gust threshold + radar helpers", () => {
  test("threshold clamps to the offered range", () => {
    expect(clampGustThreshold(5)).toBe(20);
    expect(clampGustThreshold(90)).toBe(60);
    expect(clampGustThreshold(Number.NaN)).toBe(35);
  });
  test("radar probe URL is a real tile address", () => {
    const url = radarTileUrlFor(30.69, -88.04, 7);
    expect(url).toContain("mesonet.agron.iastate.edu");
    expect(url).toContain("/7/");
    expect(url.endsWith(".png")).toBe(true);
  });
});
