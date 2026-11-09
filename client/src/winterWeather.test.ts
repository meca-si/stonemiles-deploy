// Winter package tests (migration 0107): NWS warning ↔ route/ETA
// matching, chain logic (a DOT-posted requirement record or NO
// call — the law alone never fires), and snow-depth summaries with
// the park-it line.
import { describe, expect, test } from "bun:test";
import {
  CHAIN_LAWS,
  chainAlertFor,
  chainSpoken,
  parseChainPullouts,
  parseNwsAlerts,
  pointInPolygon,
  snowHeadline,
  snowSummary,
  warningsOnRoute,
  type ChainRequirement,
  type NwsFeature,
  type RouteSample,
  type SnowSample,
} from "./winterWeather";

const NOW = Date.UTC(2026, 11, 8, 18, 0, 0); // Dec 8, 2026, noon CT-ish

// Route samples running north along lon -105, one every ~7 mi,
// ETA 10 minutes per sample.
function samples(n = 12): RouteSample[] {
  const out: RouteSample[] = [];
  for (let i = 0; i < n; i++) out.push({ lat: 39 + i * 0.1, lon: -105, alongMi: i * 7, etaMs: NOW + i * 600_000 });
  return out;
}

// A polygon covering samples 3..5 (lat 39.25..39.55).
const POLY: [number, number][] = [
  [39.25, -105.1],
  [39.25, -104.9],
  [39.55, -104.9],
  [39.55, -105.1],
];

function feature(over: Partial<NwsFeature> = {}): NwsFeature {
  return {
    id: "urn:test:1",
    geometry: { type: "Polygon", coordinates: [[[-105.1, 39.25], [-104.9, 39.25], [-104.9, 39.55], [-105.1, 39.55], [-105.1, 39.25]]] },
    properties: { event: "Winter Storm Warning", severity: "Severe", headline: "Winter Storm Warning issued", areaDesc: "Front Range" },
    ...over,
  };
}

describe("NWS parsing + route matching", () => {
  test("only warnings of driving consequence parse", () => {
    expect(parseNwsAlerts([feature()]).length).toBe(1);
    expect(parseNwsAlerts([feature({ properties: { event: "Winter Storm Watch" } })]).length).toBe(0);
    expect(parseNwsAlerts([feature({ properties: { event: "Heat Advisory Warning" } })]).length).toBe(0);
    expect(parseNwsAlerts([feature({ properties: { event: "Tornado Warning" } })]).length).toBe(1);
    expect(parseNwsAlerts(null)).toEqual([]);
  });

  test("pointInPolygon", () => {
    expect(pointInPolygon(39.4, -105, POLY)).toBe(true);
    expect(pointInPolygon(39.1, -105, POLY)).toBe(false);
  });

  test("a warning whose polygon covers the route matches, timed by ETA", () => {
    const alerts = parseNwsAlerts([feature()]);
    const on = warningsOnRoute(alerts, samples());
    expect(on.length).toBe(1);
    expect(on[0]!.fromMi).toBe(21); // sample 3
    expect(on[0]!.toMi).toBe(35); // sample 5
    expect(on[0]!.etaMs).toBe(NOW + 3 * 600_000);
  });

  test("a warning nowhere near the route does not match", () => {
    const far = feature({ geometry: { type: "Polygon", coordinates: [[[-100, 35], [-99, 35], [-99, 36], [-100, 36], [-100, 35]]] } });
    expect(warningsOnRoute(parseNwsAlerts([far]), samples())).toEqual([]);
  });

  test("a polygon-less alert matches only through its fetch association", () => {
    const bare = parseNwsAlerts([feature({ geometry: null })]);
    expect(warningsOnRoute(bare, samples())).toEqual([]);
    bare[0]!.fetchAlongMi = 14;
    bare[0]!.fetchEtaMs = NOW + 2 * 600_000;
    const on = warningsOnRoute(bare, samples());
    expect(on.length).toBe(1);
    expect(on[0]!.fromMi).toBe(14);
  });
});

describe("snow depth", () => {
  function snow(over: Partial<SnowSample>[] = []): SnowSample[] {
    const base: SnowSample[] = [
      { alongMi: 20, etaMs: NOW + 1800_000, lowIn: 0, highIn: 0 },
      { alongMi: 40, etaMs: NOW + 3600_000, lowIn: 4, highIn: 6 },
      { alongMi: 70, etaMs: NOW + 5400_000, lowIn: 4, highIn: 6 },
      { alongMi: 100, etaMs: NOW + 7200_000, lowIn: 3, highIn: 5 },
      { alongMi: 130, etaMs: NOW + 9000_000, lowIn: 0, highIn: 0 },
    ];
    return base.map((s, i) => ({ ...s, ...(over[i] ?? {}) }));
  }

  test("summarizes range, span and start like the brief says", () => {
    const s = snowSummary(snow(), 10);
    expect(s).not.toBeNull();
    expect(s!.lowIn).toBe(3);
    expect(s!.highIn).toBe(6);
    expect(s!.parkAdvisory).toBe(false);
    expect(snowHeadline(s!, NOW)).toContain("inches expected across your next");
    expect(snowHeadline(s!, NOW)).toContain("starting");
  });

  test("heavy accumulation crosses the park-it line", () => {
    const s = snowSummary(snow([{ }, { lowIn: 8, highIn: 10 }]), 10);
    expect(s!.parkAdvisory).toBe(true);
  });

  test("no snow in the forecast = silence, and snow far behind never counts", () => {
    expect(snowSummary(snow([{ lowIn: 0, highIn: 0 }, { lowIn: 0, highIn: 0 }, { lowIn: 0, highIn: 0 }, { lowIn: 0, highIn: 0 }]), 10)).toBeNull();
    expect(snowSummary(snow(), 120)).toBeNull(); // snowy stretch is behind the truck
    expect(snowSummary([], 0)).toBeNull();
  });
});

describe("chain alerts", () => {
  const req: ChainRequirement = {
    state: "CO",
    areaLabel: "I-70, Dotsero to Morrison",
    sourceLabel: "Colorado DOT · COtrip",
    atAlongMi: 55,
    pulloutMi: [48, 52],
  };

  test("a DOT-posted requirement inside 10 mi fires, with law + pullout", () => {
    const a = chainAlertFor([req], 48);
    expect(a).not.toBeNull();
    expect(a!.law?.state).toBe("CO");
    expect(a!.nextPulloutMi).toBe(52);
    expect(chainSpoken(a!)).toContain("Chains required ahead");
  });

  test("the LAW alone never fires the call — no requirement record, no alert", () => {
    expect(CHAIN_LAWS.CO).toBeDefined();
    expect(chainAlertFor([], 48)).toBeNull();
    expect(chainAlertFor([req], 20)).toBeNull(); // 35 mi out — too early
    expect(chainAlertFor([req], 60)).toBeNull(); // already inside/past it
  });

  test("chain-up pullouts parse from map data only", () => {
    const els = [
      { id: 1, type: "node" as const, lat: 39.5, lon: -105.5, tags: { name: "Chain Up Area", amenity: "parking" } },
      { id: 2, type: "node" as const, lat: 39.5, lon: -105.5, tags: { name: "Rest Area", amenity: "parking" } },
    ];
    const ps = parseChainPullouts(els);
    expect(ps.length).toBe(1);
    expect(ps[0]!.name).toBe("Chain Up Area");
  });
});
