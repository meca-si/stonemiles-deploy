// Pins the client homes for TMS queue items 5 + 6:
//
//   (a) item 5 — the Full records bundle lives in the Library as
//       its own section, resolving through the standing Library
//       document doors with the fixed ref "records:bundle" (the
//       owner's own document door, like every other statement).
//   (b) item 6 — the Route weather panel carries the next-24-hours
//       arrival strip from routeWeather24.ts, labelled with its
//       free public source (Open-Meteo — no paid feed).
//
// Run: bun test client/src/recordsBundlePin.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const librarySource = readFileSync(`${import.meta.dir}/Library.tsx`, "utf8");
const panelSource = readFileSync(`${import.meta.dir}/RouteWeatherPanel.tsx`, "utf8");

describe("records bundle + route weather 24h — client homes", () => {
  test("the Library mounts the Full records bundle section on the document doors", () => {
    expect(librarySource).toContain('title="Full records bundle"');
    expect(librarySource).toContain('docRef="records:bundle"');
  });

  test("the Route weather panel builds the arrival strip from routeWeather24", () => {
    expect(panelSource).toContain('from "./routeWeather24"');
    expect(panelSource).toContain("buildArrivalForecast");
    expect(panelSource).toContain("evaluateArrivalDecisions");
    expect(panelSource).toContain("Next 24 hours");
  });

  test("the arrival strip labels its free public source — no paid feed", () => {
    expect(panelSource).toContain("Open-Meteo hourly forecast — free");
    expect(panelSource).toContain("public data, no paid feed");
  });
});
