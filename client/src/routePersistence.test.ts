// Unit tests for active-route persistence (routePersistence.ts) —
// the snapshot behind Resume route. The reported failure was a
// resume that restored the trip sheet but not the route; these
// tests pin the round-trip that carries the route with it.
// Run: bun test client/src/routePersistence.test.ts

import { describe, expect, test } from "bun:test";
import {
parseRouteSnapshot,
serializeRouteSnapshot,
type SavedRouteSnapshot,
} from "./routePersistence";

const SNAP: SavedRouteSnapshot = {
  version: 1,
  savedAt: 1_730_000_000_000,
  destination: { label: "IP Casino, Biloxi, MS", lat: 30.411, lon: -88.895 },
  routeOrigin: null,
  avoidTolls: true,
  selectedRoute: 1,
  driveMode: true,
  activeLoadId: 42,
  routes: [
    {
      id: 0, miles: 46.7, minutes: 62, hasToll: false,
      coords: [[30.55, -88.17], [30.52, -88.4], [30.41, -88.895]],
      maneuvers: [{ instruction: "Drive west" }],
    },
    {
      id: 1, miles: 51.2, minutes: 70, hasToll: true,
      coords: [[30.55, -88.17], [30.48, -88.5], [30.41, -88.895]],
      maneuvers: [],
    },
  ],
};

describe("route snapshot round-trip", () => {
  test("destination, picked option, guidance flag, and geometry survive", () => {
    const raw = serializeRouteSnapshot(SNAP);
    expect(raw).not.toBeNull();
    const back = parseRouteSnapshot(raw);
    expect(back).not.toBeNull();
    expect(back!.destination.label).toBe("IP Casino, Biloxi, MS");
    expect(back!.selectedRoute).toBe(1);
    expect(back!.driveMode).toBe(true);
    expect(back!.activeLoadId).toBe(42);
    expect(back!.routes.length).toBe(2);
    expect(back!.routes[0]!.coords.length).toBe(3);
    expect(back!.routes[0]!.miles).toBe(46.7);
  });

  test("stale traffic overlays are stripped — congestion is never resurrected from storage", () => {
    const withTraffic = {
      ...SNAP,
      routes: SNAP.routes.map((r) => ({
        ...r,
        trafficState: "live" as const,
        trafficDelayMin: 18,
        trafficAsOf: 123,
        trafficFlow: [{ frac: 0.5, ratio: 0.4 }],
        trafficIncidents: [{ coords: r.coords, magnitude: 4, delayMin: 20, category: 6 }],
      })),
    } as unknown as SavedRouteSnapshot;
    const back = parseRouteSnapshot(serializeRouteSnapshot(withTraffic));
    const r0 = back!.routes[0]! as unknown as Record<string, unknown>;
    expect(r0.trafficState).toBe("idle");
    expect(r0.trafficDelayMin).toBeNull();
    expect(r0.trafficFlow).toBeUndefined();
    expect(r0.trafficIncidents).toBeUndefined();
  });

  test("corrupt or geometry-less snapshots offer no resume", () => {
    expect(parseRouteSnapshot(null)).toBeNull();
    expect(parseRouteSnapshot("{nope")).toBeNull();
    expect(parseRouteSnapshot(JSON.stringify({ version: 99 }))).toBeNull();
    expect(
      parseRouteSnapshot(JSON.stringify({ ...SNAP, routes: [{ id: 0, miles: 5, minutes: 5, coords: [[0, 0]] }] })),
    ).toBeNull();
    expect(serializeRouteSnapshot({ ...SNAP, routes: [] })).toBeNull();
  });

  test("an out-of-range picked option falls back to the first route", () => {
    const back = parseRouteSnapshot(serializeRouteSnapshot({ ...SNAP, selectedRoute: 9 }));
    expect(back!.selectedRoute).toBe(0);
  });
});
