// Unit tests for the Final Extras client logic (client/src/extras.ts).
// Run: bun test client/src/extras.test.ts

import { describe, expect, test } from "bun:test";
import {
  apptBehaviourLabel,
  classifyScalePoi,
  facilityNameMatches,
  groupVisitsByFacility,
  nightParkingPicks,
  normalizeFacilityName,
  type FacilityVisitLike,
} from "./extras";

describe("facility name matching — the driver's own history only", () => {
  test("normalises case and punctuation", () => {
    expect(normalizeFacilityName("Peacock Pavers — Mobile, AL")).toBe("peacock pavers mobile al");
  });

  test("matches either direction of containment", () => {
    expect(facilityNameMatches("Peacock Pavers — Mobile, AL", "peacock")).toBe(true);
    expect(facilityNameMatches("Peacock", "Peacock Pavers Mobile")).toBe(true);
    expect(facilityNameMatches("Peacock Pavers", "Granted Enterprise")).toBe(false);
  });

  test("empty never matches", () => {
    expect(facilityNameMatches("", "Peacock")).toBe(false);
    expect(facilityNameMatches("Peacock", "  ")).toBe(false);
  });
});

describe("apptBehaviourLabel — appointment behaviour in plain words", () => {
  test("within ±15 minutes is on time", () => {
    expect(apptBehaviourLabel(0)).toContain("on time");
    expect(apptBehaviourLabel(-14)).toContain("on time");
    expect(apptBehaviourLabel(15)).toContain("on time");
  });
  test("early and late say how much", () => {
    expect(apptBehaviourLabel(-40)).toContain("40 min early");
    expect(apptBehaviourLabel(95)).toContain("95 min after");
  });
  test("no appointment on file stays silent (null)", () => {
    expect(apptBehaviourLabel(null)).toBeNull();
  });
});

const visit = (over: Partial<FacilityVisitLike>): FacilityVisitLike => ({
  loadId: 1,
  facility: "Receiver — Dallas, TX",
  site: "delivery",
  arrivedAt: "2026-10-01T08:00:00Z",
  departedAt: "2026-10-01T12:00:00Z",
  dwellHours: 4,
  excessHours: 2,
  apptDeltaMin: null,
  lumperFee: null,
  dockDoor: null,
  dockNote: null,
  ...over,
});

describe("groupVisitsByFacility", () => {
  test("groups by facility + site with averages and the latest visit on top", () => {
    const groups = groupVisitsByFacility([
      visit({ loadId: 1, dwellHours: 4, excessHours: 2, departedAt: "2026-10-01T12:00:00Z" }),
      visit({ loadId: 2, dwellHours: 6, excessHours: 4, departedAt: "2026-10-05T12:00:00Z", lumperFee: 75 }),
      visit({ loadId: 3, facility: "Shipper — Mobile, AL", site: "pickup", dwellHours: 1, excessHours: 0 }),
    ]);
    expect(groups.length).toBe(2);
    const dallas = groups.find((g) => g.facility.includes("Dallas"))!;
    expect(dallas.visits.length).toBe(2);
    expect(dallas.avgDwellHours).toBe(5);
    expect(dallas.avgExcessHours).toBe(3);
    expect(dallas.last.loadId).toBe(2);
    expect(dallas.last.lumperFee).toBe(75);
  });

  test("no visits, no groups — empty history stays empty", () => {
    expect(groupVisitsByFacility([])).toEqual([]);
  });
});

describe("classifyScalePoi — scales from map tags only", () => {
  test("CAT Scale by brand or name", () => {
    expect(classifyScalePoi({ brand: "CAT Scale", amenity: "fuel" })).toBe("cat_scale");
    expect(classifyScalePoi({ name: "CAT Scale #123" })).toBe("cat_scale");
  });
  test("weighbridge and weigh-station tags are scales", () => {
    expect(classifyScalePoi({ amenity: "weighbridge" })).toBe("weighbridge");
    expect(classifyScalePoi({ highway: "weigh_station" })).toBe("weighbridge");
  });
  test("a truck stop tagged with scales", () => {
    expect(classifyScalePoi({ amenity: "fuel", scales: "yes" })).toBe("truck_stop_scales");
    expect(classifyScalePoi({ amenity: "fuel", weighbridge: "yes" })).toBe("truck_stop_scales");
  });
  test("an ordinary fuel stop is not a scale", () => {
    expect(classifyScalePoi({ amenity: "fuel", name: "Shell" })).toBeNull();
    expect(classifyScalePoi({ amenity: "fuel", scales: "no" })).toBeNull();
  });
});

describe("nightParkingPicks — map-data parking near the shutdown point", () => {
  const cand = (id: string, alongMi: number, truckParking: boolean | null, parkingSpaces: number | null = null) => ({
    id, name: id, alongMi, truckParking, parkingSpaces,
  });

  test("only map-tagged truck parking is picked, nearest the clock-out first", () => {
    const picks = nightParkingPicks([
      cand("far", 300, true),
      cand("near", 205, true),
      cand("no-parking", 200, false),
      cand("unknown", 202, null),
      cand("counted", 210, null, 40),
    ], 208);
    expect(picks.map((p) => p.id)).toEqual(["counted", "near", "far"]);
  });

  test("with no clock-out point, picks run in route order", () => {
    const picks = nightParkingPicks([cand("b", 50, true), cand("a", 10, true)], null);
    expect(picks.map((p) => p.id)).toEqual(["a", "b"]);
  });

  test("nothing tagged means no picks — never an invented lot", () => {
    expect(nightParkingPicks([cand("x", 10, null), cand("y", 20, false)], 15)).toEqual([]);
  });
});
