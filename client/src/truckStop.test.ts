// Unit tests for the truck-stop / rest-area card logic
// (truckStop.ts) — OSM tag parsing and driver-reported parking
// status. Honesty rules under test: counts only from capacity tags,
// amenities tri-state (unknown is never a "no"), stale or far-away
// parking reports say nothing.
// Run: bun test client/src/truckStop.test.ts

import { describe, expect, test } from "bun:test";
import {
amenityValue,
buildAddress,
inferStopKind,
parkingReportFor,
parkingSpacesFor,
parseTruckStopDetails,
} from "./truckStop";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("parking spaces — counts only from real capacity tags", () => {
  test("truck-specific capacity wins", () => {
    expect(parkingSpacesFor({ "capacity:truck": "85", capacity: "200" }, "truck_stop")).toBe(85);
    expect(parkingSpacesFor({ "capacity:hgv": "40" }, "truck_stop")).toBe(40);
  });
  test("a plain capacity never becomes a truck count at a truck stop", () => {
    expect(parkingSpacesFor({ capacity: "200" }, "truck_stop")).toBeNull();
  });
  test("rest areas count their lot capacity", () => {
    expect(parkingSpacesFor({ capacity: "45" }, "rest_area")).toBe(45);
    expect(parkingSpacesFor({ "capacity:truck": "12", capacity: "45" }, "rest_area")).toBe(12);
  });
  test("junk and zero are not counts", () => {
    expect(parkingSpacesFor({ "capacity:truck": "many" }, "truck_stop")).toBeNull();
    expect(parkingSpacesFor({ "capacity:truck": "0" }, "truck_stop")).toBeNull();
    expect(parkingSpacesFor({}, "truck_stop")).toBeNull();
  });
});

describe("truck stop details", () => {
  const tags = {
    name: "Love's Travel Stop",
    "fuel:diesel": "yes",
    "fuel:DEF": "yes",
    shower: "yes",
    weighbridge: "yes",
    laundry: "no",
    "capacity:truck": "92",
    opening_hours: "24/7",
    phone: "+1-555-0100",
    "addr:housenumber": "1200",
    "addr:street": "Service Road",
    "addr:city": "Decatur",
    "addr:state": "AL",
  };
  const d = parseTruckStopDetails(tags, "truck_stop");
  test("facts land", () => {
    expect(d.parkingSpaces).toBe(92);
    expect(d.open24).toBe(true);
    expect(d.phone).toBe("+1-555-0100");
    expect(d.address).toBe("1200 Service Road · Decatur, AL");
  });
  test("amenities are tri-state — untagged is unknown, never no", () => {
    expect(amenityValue(d, "diesel")).toBe(true);
    expect(amenityValue(d, "def")).toBe(true);
    expect(amenityValue(d, "showers")).toBe(true);
    expect(amenityValue(d, "scales")).toBe(true);
    expect(amenityValue(d, "laundry")).toBe(false);
    expect(amenityValue(d, "wifi")).toBeNull();
    expect(amenityValue(d, "atm")).toBeNull();
  });
  test("a tagged capacity proves truck parking", () => {
    expect(amenityValue(d, "truck_parking")).toBe(true);
  });
  test("commercial set, not the rest-area set", () => {
    expect(d.amenities.map((a) => a.key)).toContain("showers");
    expect(d.amenities.map((a) => a.key)).not.toContain("picnic");
  });
});

describe("rest area details", () => {
  const d = parseTruckStopDetails(
    { toilets: "yes", vending_machine: "yes", picnic_table: "yes", dog: "yes", capacity: "38" },
    "rest_area",
  );
  test("rest treatment: restrooms / vending / picnic / pet, no fuel set", () => {
    expect(amenityValue(d, "restrooms")).toBe(true);
    expect(amenityValue(d, "vending")).toBe(true);
    expect(amenityValue(d, "picnic")).toBe(true);
    expect(amenityValue(d, "pet")).toBe(true);
    expect(amenityValue(d, "overnight")).toBeNull();
    expect(d.amenities.map((a) => a.key)).not.toContain("showers");
    expect(d.parkingSpaces).toBe(38);
  });
});

describe("kind inference", () => {
  test("rest_area tag wins; fuel/services are commercial", () => {
    expect(inferStopKind({ highway: "rest_area" }, "truck_stop")).toBe("rest_area");
    expect(inferStopKind({ amenity: "fuel" }, "rest_area")).toBe("truck_stop");
    expect(inferStopKind({ highway: "services" }, "rest_area")).toBe("truck_stop");
    expect(inferStopKind({}, "rest_area")).toBe("rest_area");
  });
});

describe("address", () => {
  test("empty tags give no address", () => {
    expect(buildAddress({})).toBeNull();
  });
});

describe("driver-reported parking status", () => {
  const at = { lat: 34.62, lon: -86.98 };
  test("freshest nearby report wins, with age + confirmation", () => {
    const r = parkingReportFor(
      [
        { kind: "parking_full", lat: at.lat, lon: at.lon, createdAt: iso(3 * 3600000) },
        { kind: "parking_open", lat: at.lat, lon: at.lon, createdAt: iso(20 * 60000), confirmedAt: iso(10 * 60000) },
        { kind: "crash", lat: at.lat, lon: at.lon, createdAt: iso(5 * 60000) },
      ],
      at.lat,
      at.lon,
      NOW,
    );
    expect(r).toEqual({ status: "open", ageLabel: "20m ago", confirmed: true });
  });
  test("stale (>12h) and far (>0.4 mi) reports say nothing", () => {
    expect(
      parkingReportFor([{ kind: "parking_full", lat: at.lat, lon: at.lon, createdAt: iso(13 * 3600000) }], at.lat, at.lon, NOW),
    ).toBeNull();
    expect(
      parkingReportFor([{ kind: "parking_full", lat: at.lat + 0.05, lon: at.lon, createdAt: iso(60000) }], at.lat, at.lon, NOW),
    ).toBeNull();
    expect(parkingReportFor([], at.lat, at.lon, NOW)).toBeNull();
  });
});
