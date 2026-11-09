// Unit tests for the ELD identity log shaping (eldIdentity.ts).
// Run: bun test client/src/eldIdentity.test.ts
import { describe, expect, test } from "bun:test";
import {
  eldIdentitySections,
  eldIdentityStamp,
  profileFieldsWithEld,
  type EldIdentitySnapshot,
} from "./eldIdentity";

const snap = (over: Partial<EldIdentitySnapshot> = {}): EldIdentitySnapshot => ({
  provider: "motive",
  providerName: "Motive",
  pulledAt: "2026-11-16T14:30:00.000Z",
  driver: {
    name: "Alex Ruggs",
    driverId: "drv-123",
    cdlNumber: "AL-987654",
    cdlState: "AL",
    cdlClass: "A",
    cdlEndorsements: "N",
    homeTerminal: "Haleyville, AL",
  },
  truck: {
    unitNumber: "T-42",
    vin: "1FUJA6CV0LL123456",
    make: "Freightliner",
    model: "Cascadia",
    year: 2022,
    plate: "AL TRK42",
    odometerMi: 512340.6,
  },
  ...over,
});

const manual = [
  { key: "driverName", label: "Driver name", value: "Hand-typed Name" },
  { key: "cdlNumber", label: "CDL number", value: "MANUAL-CDL" },
  { key: "homeTerminal", label: "Home terminal", value: null },
  { key: "truckUnit", label: "Unit number", value: "Old Unit" },
  { key: "truckVin", label: "VIN", value: null },
];

describe("unlinked state — manual profile untouched", () => {
  test("null snapshot returns every manual field exactly as entered, all source 'manual', no stamp", () => {
    const view = profileFieldsWithEld(manual, null);
    expect(view).toHaveLength(manual.length);
    for (let i = 0; i < manual.length; i++) {
      expect(view[i]?.value).toBe(manual[i]?.value);
      expect(view[i]?.label).toBe(manual[i]?.label);
      expect(view[i]?.source).toBe("manual");
      expect(view[i]?.stamp).toBeNull();
    }
  });
});

describe("the stamp", () => {
  test("an ELD-sourced value carries 'from ELD — <provider>, <date/time>'", () => {
    const s = snap();
    const stamp = eldIdentityStamp(s);
    expect(stamp.startsWith("from ELD — Motive, ")).toBe(true);
    expect(stamp).toContain("2026");
    const view = profileFieldsWithEld(manual, s);
    const name = view.find((f) => f.key === "driverName");
    expect(name?.source).toBe("eld");
    expect(name?.value).toBe("Alex Ruggs");
    expect(name?.stamp).toBe(stamp);
  });
  test("the provider in the stamp is whichever adapter pulled — the shape is provider-agnostic", () => {
    const s = snap({ provider: "samsara", providerName: "Samsara" });
    expect(eldIdentityStamp(s).startsWith("from ELD — Samsara, ")).toBe(true);
  });
});

describe("merge rules with a snapshot", () => {
  test("ELD values override where present; null ELD fields never blank a manual value", () => {
    const partial = snap({
      driver: { name: null, driverId: null, cdlNumber: "ELD-CDL", cdlState: null, cdlClass: null, cdlEndorsements: null, homeTerminal: null },
      truck: { unitNumber: null, vin: null, make: null, model: null, year: null, plate: null, odometerMi: null },
    });
    const view = profileFieldsWithEld(manual, partial);
    const byKey = Object.fromEntries(view.map((f) => [f.key, f]));
    expect(byKey["cdlNumber"]?.value).toBe("ELD-CDL");
    expect(byKey["cdlNumber"]?.source).toBe("eld");
    // ELD didn't carry a name or unit — the manual entries stand.
    expect(byKey["driverName"]?.value).toBe("Hand-typed Name");
    expect(byKey["driverName"]?.source).toBe("manual");
    expect(byKey["truckUnit"]?.value).toBe("Old Unit");
    expect(byKey["homeTerminal"]?.value).toBeNull();
  });
});

describe("view everything logged — sections show only what arrived", () => {
  test("a full snapshot lists every driver and truck field, odometer rounded", () => {
    const sections = eldIdentitySections(snap());
    const driver = sections.find((s) => s.title === "Driver");
    const truck = sections.find((s) => s.title === "Truck");
    expect(driver?.rows.map((r) => r.label)).toEqual(["Name", "Driver ID", "CDL number", "CDL state", "CDL class", "CDL endorsements", "Home terminal"]);
    expect(truck?.rows.map((r) => r.label)).toEqual(["Unit number", "VIN", "Truck", "Plate", "Odometer at pull"]);
    expect(truck?.rows.find((r) => r.label === "Truck")?.value).toBe("2022 Freightliner Cascadia");
    expect(truck?.rows.find((r) => r.label === "Odometer at pull")?.value).toBe("512,341 mi");
  });
  test("a sparse snapshot yields only the rows that arrived — nothing padded, nothing invented", () => {
    const sparse = snap({
      driver: { name: "Alex Ruggs", driverId: null, cdlNumber: null, cdlState: null, cdlClass: null, cdlEndorsements: null, homeTerminal: null },
      truck: { unitNumber: null, vin: null, make: null, model: null, year: null, plate: null, odometerMi: null },
    });
    const sections = eldIdentitySections(sparse);
    expect(sections.find((s) => s.title === "Driver")?.rows).toEqual([{ label: "Name", value: "Alex Ruggs" }]);
    expect(sections.find((s) => s.title === "Truck")?.rows).toEqual([]);
  });
});
