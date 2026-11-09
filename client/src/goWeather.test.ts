// Unit tests for the Go-screen weather chip logic (goWeather.ts).
// Run: bun test client/src/goWeather.test.ts
import { describe, expect, test } from "bun:test";
import {
  GO_WEATHER_REFRESH_MS,
  goWeatherUrl,
  parseGoWeather,
  shouldFetchGoWeather,
  type GoWeatherAnchor,
} from "./goWeather";

describe("parseGoWeather", () => {
  test("reads a real Open-Meteo current block", () => {
    const r = parseGoWeather({
      current: { temperature_2m: 71.6, weather_code: 61, wind_speed_10m: 9.2, wind_gusts_10m: 21.5 },
    });
    expect(r?.condition).toBe("rain");
    expect(r?.tempF).toBe(71.6);
    expect(r?.gustMph).toBe(21.5);
  });
  test("a feed answer with no current block yields NO reading — never invented", () => {
    expect(parseGoWeather({})).toBeNull();
    expect(parseGoWeather(null)).toBeNull();
    expect(parseGoWeather({ current: {} })).toBeNull();
  });
  test("the URL is the public Open-Meteo forecast endpoint", () => {
    expect(goWeatherUrl(30.69, -88.04)).toContain("api.open-meteo.com/v1/forecast");
    expect(goWeatherUrl(30.69, -88.04)).toContain("latitude=30.6900");
  });
});

describe("shouldFetchGoWeather — the chip updates with NO SI gate", () => {
  const pos = { lat: 30.69, lon: -88.04 };
  const anchor: GoWeatherAnchor = { lat: pos.lat, lon: pos.lon, routeKey: "r1", atMs: 1_000_000 };
  test("first position always fetches", () => {
    expect(shouldFetchGoWeather({ anchor: null, pos, routeKey: "r1", nowMs: 1_000_000 })).toBe(true);
  });
  test("no position never fetches", () => {
    expect(shouldFetchGoWeather({ anchor: null, pos: null, routeKey: "r1", nowMs: 1_000_000 })).toBe(false);
  });
  test("inside the cadence at the same spot, it waits", () => {
    expect(shouldFetchGoWeather({ anchor, pos, routeKey: "r1", nowMs: 1_000_000 + 60_000 })).toBe(false);
  });
  test("the 10-minute beat refetches even parked", () => {
    expect(
      shouldFetchGoWeather({ anchor, pos, routeKey: "r1", nowMs: 1_000_000 + GO_WEATHER_REFRESH_MS }),
    ).toBe(true);
  });
  test("rolling ~5 miles refetches early", () => {
    // ~5.5 mi north of the anchor.
    expect(
      shouldFetchGoWeather({ anchor, pos: { lat: pos.lat + 0.08, lon: pos.lon }, routeKey: "r1", nowMs: 1_000_000 + 60_000 }),
    ).toBe(true);
  });
  test("a route change refetches at once", () => {
    expect(shouldFetchGoWeather({ anchor, pos, routeKey: "r2", nowMs: 1_000_000 + 60_000 })).toBe(true);
  });
});
