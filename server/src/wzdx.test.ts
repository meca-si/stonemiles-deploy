// Unit tests for the WZDx official work-zone feed parse
// (server/src/wzdx.ts). The fixture mirrors the verified Wisconsin
// DOT / 511WI feed shape (WZDx v4.2 GeoJSON, fetched live
// 2026-11-08): LineString geometry in [lon, lat] order, core_details
// with road_names + description, start_date / end_date window.
// Run: bun test server/src/wzdx.test.ts

import { describe, expect, test } from "bun:test";
import { feedsForPosition, parseWzdxFeed, wzdxPoint } from "./wzdx";

const FEED = { key: "wi511", sourceLabel: "Wisconsin DOT · 511WI" };
const NOW = Date.parse("2026-11-08T18:00:00Z");

function feature(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "wz-1",
    type: "Feature",
    geometry: { type: "LineString", coordinates: [[-89.8072, 43.6303], [-89.8068, 43.6294]] },
    properties: {
      core_details: {
        event_type: "work-zone",
        road_names: ["I-90 EB"],
        description: "Mainline Left Shoulder Closed on I-90 EB",
      },
      start_date: "2026-11-08T12:00:00+00:00",
      end_date: "2026-11-08T23:00:00+00:00",
    },
    ...over,
  };
}

describe("wzdxPoint", () => {
  test("takes the first coordinate of a LineString, [lon, lat] → {lat, lon}", () => {
    expect(wzdxPoint({ type: "LineString", coordinates: [[-89.8072, 43.6303], [-89.8, 43.6]] })).toEqual({
      lat: 43.6303,
      lon: -89.8072,
    });
  });
  test("handles Point and MultiPoint", () => {
    expect(wzdxPoint({ type: "Point", coordinates: [-89.4, 43.07] })).toEqual({ lat: 43.07, lon: -89.4 });
    expect(wzdxPoint({ type: "MultiPoint", coordinates: [[-89.4, 43.07]] })).toEqual({ lat: 43.07, lon: -89.4 });
  });
  test("malformed geometry yields null — never a guessed point", () => {
    expect(wzdxPoint(null)).toBeNull();
    expect(wzdxPoint({ type: "Polygon", coordinates: [[[-89, 43]]] })).toBeNull();
    expect(wzdxPoint({ type: "LineString", coordinates: [] })).toBeNull();
    expect(wzdxPoint({ type: "Point", coordinates: ["x", "y"] })).toBeNull();
    expect(wzdxPoint({ type: "Point", coordinates: [-200, 43] })).toBeNull();
  });
});

describe("parseWzdxFeed", () => {
  test("an active zone parses with road, description, window, and the DOT label", () => {
    const zones = parseWzdxFeed({ type: "FeatureCollection", features: [feature()] }, FEED, NOW);
    expect(zones.length).toBe(1);
    const z = zones[0]!;
    expect(z.id).toBe("wi511-wz-1");
    expect(z.lat).toBeCloseTo(43.6303);
    expect(z.lon).toBeCloseTo(-89.8072);
    expect(z.road).toBe("I-90 EB");
    expect(z.description).toContain("I-90 EB");
    expect(z.sourceLabel).toBe("Wisconsin DOT · 511WI");
    expect(z.startMs).toBe(Date.parse("2026-11-08T12:00:00+00:00"));
  });

  test("future and finished zones are excluded — only zones a driver can meet now", () => {
    const future = feature({ id: "f", properties: { core_details: { road_names: ["I-39"] }, start_date: "2026-11-09T00:00:00Z", end_date: "2026-11-10T00:00:00Z" } });
    const done = feature({ id: "d", properties: { core_details: { road_names: ["I-39"] }, start_date: "2026-11-01T00:00:00Z", end_date: "2026-11-07T00:00:00Z" } });
    expect(parseWzdxFeed({ features: [future, done] }, FEED, NOW)).toEqual([]);
  });

  test("the feed's literal 'Unknown' road name reads as no name", () => {
    const f = feature({
      properties: {
        core_details: { road_names: ["Unknown"], description: "Bridge closed" },
        start_date: "2026-11-08T12:00:00+00:00",
        end_date: "2026-11-08T23:00:00+00:00",
      },
    });
    const zones = parseWzdxFeed({ features: [f] }, FEED, NOW);
    expect(zones.length).toBe(1);
    expect(zones[0]!.road).toBeNull();
  });

  test("malformed features are skipped, not repaired", () => {
    const noDates = feature({ id: "x", properties: { core_details: {} } });
    const noGeom = feature({ id: "y", geometry: null });
    const zones = parseWzdxFeed({ features: [noDates, noGeom, feature()] }, FEED, NOW);
    expect(zones.length).toBe(1);
    expect(zones[0]!.id).toBe("wi511-wz-1");
  });

  test("a non-feed payload parses to nothing", () => {
    expect(parseWzdxFeed(null, FEED, NOW)).toEqual([]);
    expect(parseWzdxFeed({ hello: 1 }, FEED, NOW)).toEqual([]);
    expect(parseWzdxFeed("nope", FEED, NOW)).toEqual([]);
  });
});

describe("feedsForPosition", () => {
  test("Wisconsin is covered; Alabama (no wired free feed yet) is not", () => {
    expect(feedsForPosition(43.07, -89.4).length).toBe(1); // Madison, WI
    expect(feedsForPosition(30.69, -88.04).length).toBe(0); // Mobile, AL
  });
});
