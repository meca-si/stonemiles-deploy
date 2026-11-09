// Unit tests for the traffic lights layer (client/src/
// trafficSignals.ts) — the production parse, route projection, and
// offline-cache rules behind the Drive map's signal markers.
// Run: bun test client/src/trafficSignals.test.ts

import { describe, expect, test } from "bun:test";
import {
  SIGNAL_CACHE_MAX_AGE_MS,
  nearestSignals,
  nextSignalAhead,
  parseSignalCache,
  parseTrafficSignals,
  signalCacheKey,
  signalsAhead,
  type SignalElement,
} from "./trafficSignals";

// A straight northbound route: 3 miles of latitude steps.
const ROUTE: [number, number][] = [
  [43.0, -89.4],
  [43.0145, -89.4], // ~1 mi
  [43.029, -89.4], // ~2 mi
  [43.0435, -89.4], // ~3 mi
];

const sigAt = (id: number, lat: number, lon: number): SignalElement => ({
  id,
  type: "node",
  lat,
  lon,
  tags: { highway: "traffic_signals" },
});

describe("parseTrafficSignals", () => {
  test("keeps only real signal nodes with coordinates", () => {
    const out = parseTrafficSignals([
      sigAt(1, 43.0, -89.4),
      { id: 2, type: "node", lat: 43.1, lon: -89.4, tags: { highway: "weigh_station" } },
      { id: 3, type: "way", lat: 43.2, lon: -89.4, tags: { highway: "traffic_signals" } },
      { id: 4, type: "node", tags: { highway: "traffic_signals" } },
      { id: 5, type: "node", lat: 43.3, lon: -89.4 },
    ]);
    expect(out).toEqual([{ id: "signal-1", lat: 43.0, lon: -89.4 }]);
  });

  test("duplicate nodes collapse to one signal", () => {
    const out = parseTrafficSignals([sigAt(7, 43.0, -89.4), sigAt(7, 43.0, -89.4)]);
    expect(out.length).toBe(1);
  });

  test("junk input parses to nothing — no invented signals", () => {
    expect(parseTrafficSignals(null)).toEqual([]);
    expect(parseTrafficSignals(undefined)).toEqual([]);
    expect(parseTrafficSignals([])).toEqual([]);
  });
});

describe("nextSignalAhead", () => {
  const signals = parseTrafficSignals([
    sigAt(1, 43.0072, -89.4), // ~0.5 mi along the route
    sigAt(2, 43.0217, -89.4), // ~1.5 mi along
    sigAt(3, 42.99, -89.4), // behind the start
    sigAt(4, 43.0145, -89.38), // ~1 mi along but ~1 mi EAST of the line
  ]);

  test("finds the nearest signal ahead on the line", () => {
    const hit = nextSignalAhead(signals, ROUTE, 0);
    expect(hit?.signal.id).toBe("signal-1");
    expect(hit!.distAheadMi).toBeGreaterThan(0.4);
    expect(hit!.distAheadMi).toBeLessThan(0.6);
  });

  test("signals behind the truck never fire", () => {
    const hit = nextSignalAhead(signals, ROUTE, 1.0);
    expect(hit?.signal.id).toBe("signal-2");
  });

  test("a signal on a side street is not a signal on your route", () => {
    const onlySide = parseTrafficSignals([sigAt(4, 43.0145, -89.38)]);
    expect(nextSignalAhead(onlySide, ROUTE, 0)).toBeNull();
  });

  test("no route / no signals = no callout", () => {
    expect(nextSignalAhead(signals, [], 0)).toBeNull();
    expect(nextSignalAhead([], ROUTE, 0)).toBeNull();
  });

  test("signalsAhead lists all on-route lights inside the window, nearest first", () => {
    const list = signalsAhead(signals, ROUTE, 0, 5);
    expect(list.map((s) => s.signal.id)).toEqual(["signal-1", "signal-2"]);
    expect(signalsAhead(signals, ROUTE, 0, 1).map((s) => s.signal.id)).toEqual(["signal-1"]);
  });
});

describe("nearestSignals cap", () => {
  test("keeps the closest signals when a downtown grid overflows the cap", () => {
    const many = parseTrafficSignals(
      Array.from({ length: 50 }, (_, i) => sigAt(100 + i, 43.0 + i * 0.01, -89.4)),
    );
    const kept = nearestSignals(many, { lat: 43.0, lon: -89.4 }, 5);
    expect(kept.length).toBe(5);
    expect(kept[0]!.id).toBe("signal-100");
  });
});

describe("offline cache", () => {
  test("the key is a stable grid cell", () => {
    expect(signalCacheKey(43.001, -89.401)).toBe(signalCacheKey(43.002, -89.402));
    expect(signalCacheKey(43.001, -89.401)).not.toBe(signalCacheKey(44.5, -89.401));
  });

  test("a fresh, well-formed entry round-trips", () => {
    const now = Date.parse("2026-11-08T18:00:00Z");
    const entry = { fetchedAtMs: now - 3600_000, signals: [{ id: "signal-1", lat: 43, lon: -89.4 }] };
    expect(parseSignalCache(entry, now)).toEqual(entry);
  });

  test("stale (over a week) or malformed cache reads as no cache", () => {
    const now = Date.parse("2026-11-08T18:00:00Z");
    expect(parseSignalCache({ fetchedAtMs: now - SIGNAL_CACHE_MAX_AGE_MS - 1, signals: [] }, now)).toBeNull();
    expect(parseSignalCache({ fetchedAtMs: now, signals: [{ id: 5, lat: 43, lon: -89 }] }, now)).toBeNull();
    expect(parseSignalCache("junk", now)).toBeNull();
    expect(parseSignalCache(null, now)).toBeNull();
  });
});
