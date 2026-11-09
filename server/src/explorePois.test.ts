// Explore POI query-builder tests: the query the server sends to
// Overpass is the contract the Fuel fix stands on — fuel must ask
// for nodes + ways + relations (nwr), because stations mapped as
// building/area ways were unreachable by the old node-only query,
// and every category must keep its radius/center and the
// `out center tags 60` shape the client's POI shaping reads.
import { describe, expect, test } from "bun:test";
import { buildExploreQuery, exploreQueryParts, EXPLORE_RADIUS_M } from "./explorePois";

const LAT = 30.79;
const LON = -88.25;

describe("buildExploreQuery", () => {
  test("fuel asks for nodes, ways, and relations — not nodes only", () => {
    const q = buildExploreQuery("fuel", LAT, LON);
    expect(q).toContain(`nwr(around:${EXPLORE_RADIUS_M},${LAT},${LON})[amenity=fuel];`);
    expect(q).not.toContain("node(around:");
  });

  test("every category keeps the out-center shape and the caller's center", () => {
    for (const cat of ["truckstops", "weigh", "fuel", "parking", "rest", "scales", "night"] as const) {
      const q = buildExploreQuery(cat, LAT, LON);
      expect(q.startsWith("[out:json][timeout:25];(")).toBe(true);
      expect(q.endsWith(");out center tags 60;")).toBe(true);
      expect(q).toContain(`${LAT},${LON}`);
    }
  });

  test("truck stops still include services ways and hgv fuel nodes", () => {
    const parts = exploreQueryParts("truckstops", LAT, LON);
    expect(parts).toContain("[highway=services]");
    expect(parts).toContain("[amenity=fuel][hgv]");
    expect(parts).toContain("[truck_stop=yes]");
  });

  test("scales still hunts the CAT Scale brand clause", () => {
    const parts = exploreQueryParts("scales", LAT, LON);
    expect(parts).toContain('["brand"~"CAT Scale",i]');
  });
});
