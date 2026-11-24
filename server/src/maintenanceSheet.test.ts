// maintenanceSheet.test.ts — unit tests for the Maintenance Sheet
// pure module: the kind codec, the parts JSON codec, and the sheet
// document builder (the PDF and text exports share it, so the two
// faces of one record can never drift apart).

import { describe, expect, test } from "bun:test";
import {
  buildMaintenanceSheet,
  cleanMaintenancePartsJson,
  maintenanceKindLabel,
  maintenanceKindOf,
  parseMaintenanceParts,
  type MaintenanceSheetEntry,
} from "./maintenanceSheet";

describe("maintenance kind", () => {
  test("only 'repair' reads as repair; everything else is a scheduled service", () => {
    expect(maintenanceKindOf("repair")).toBe("repair");
    expect(maintenanceKindOf("service")).toBe("service");
    expect(maintenanceKindOf(null)).toBe("service");
    expect(maintenanceKindOf("nonsense")).toBe("service");
    expect(maintenanceKindLabel("repair")).toContain("Repair");
    expect(maintenanceKindLabel("service")).toContain("Scheduled service");
  });
});

describe("maintenance parts codec", () => {
  test("round-trips name + part number, blanks dropped", () => {
    const json = cleanMaintenancePartsJson([
      { name: " Oil filter ", partNumber: " LF16233 " },
      { name: "  ", partNumber: "X" },
      { name: "Fuel filter", partNumber: "" },
    ]);
    expect(parseMaintenanceParts(json)).toEqual([
      { name: "Oil filter", partNumber: "LF16233" },
      { name: "Fuel filter", partNumber: null },
    ]);
  });

  test("malformed JSON reads as no parts — never invented", () => {
    expect(parseMaintenanceParts("{nope")).toEqual([]);
    expect(parseMaintenanceParts(null)).toEqual([]);
    expect(parseMaintenanceParts('{"name":"x"}')).toEqual([]);
    expect(parseMaintenanceParts('[{"partNumber":"1"}]')).toEqual([]);
  });

  test("the list is capped", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ name: `Part ${i}` }));
    expect(parseMaintenanceParts(cleanMaintenancePartsJson(many)).length).toBe(24);
  });
});

const entry: MaintenanceSheetEntry = {
  id: 7,
  kind: "service",
  category: "oil",
  performedAtMs: Date.parse("2026-11-24T15:00:00Z"),
  odometer: 455404,
  description: "Oil change + filters",
  shop: null,
  cost: 292.63,
  parts: [{ name: "Oil filter", partNumber: "LF16233" }],
  oilBrand: "Shell Rotella T5",
  oilWeight: "10W-30",
  nextDueMiles: 490404,
  nextDueAtMs: null,
  notes: null,
  attachmentLabels: ["Walmart receipt"],
};

const truck = {
  truckYear: 2023,
  truckMake: "Kenworth",
  truckModel: "T680",
  truckUnitNumber: "8669",
  truckVin: "1XKYDP9X8PJ238669",
  truckPlate: "P1357517",
  truckEngine: "PACCAR MX-13",
};

describe("maintenance sheet builder", () => {
  test("the sheet carries truck identity, work, parts, oil, performer and cost", () => {
    const doc = buildMaintenanceSheet(entry, truck);
    const all = [doc.title, doc.subtitle, ...doc.sections.flatMap((s) => [s.heading, ...s.lines]), ...doc.textLines].join("\n");
    expect(doc.title).toBe("MAINTENANCE SHEET #7");
    expect(all).toContain("2023 Kenworth T680");
    expect(all).toContain("Unit 8669");
    expect(all).toContain("1XKYDP9X8PJ238669");
    expect(all).toContain("P1357517");
    expect(all).toContain("PACCAR MX-13");
    expect(all).toContain("2026-11-24");
    expect(all).toContain("455,404 mi");
    expect(all).toContain("Scheduled service");
    expect(all).toContain("Oil & filters");
    expect(all).toContain("Oil change + filters");
    expect(all).toContain("Driver (self)");
    expect(all).toContain("$292.63");
    expect(all).toContain("Oil: Shell Rotella T5 10W-30");
    expect(all).toContain("Oil filter - Part # LF16233");
    expect(all).toContain("490,404 mi");
    expect(all).toContain("Walmart receipt");
    expect(doc.filenameStem).toBe("stonemiles-maintenance-sheet-7");
  });

  test("a repair names its kind and its shop; no oil line without oil fields", () => {
    const doc = buildMaintenanceSheet(
      { ...entry, kind: "repair", category: "electrical", shop: "TA Truck Service", oilBrand: null, oilWeight: null, parts: [], attachmentLabels: [] },
      truck,
    );
    const all = doc.textLines.join("\n");
    expect(all).toContain("Repair — unscheduled fix");
    expect(all).toContain("Electrical");
    expect(all).toContain("TA Truck Service");
    expect(all).not.toContain("Oil:");
    expect(all).toContain("(no parts recorded)");
  });

  test("an unnamed truck never invents identity", () => {
    const doc = buildMaintenanceSheet(entry, {
      truckYear: null, truckMake: null, truckModel: null, truckUnitNumber: null, truckVin: null, truckPlate: null, truckEngine: null,
    });
    const all = doc.textLines.join("\n");
    expect(all).toContain("Truck not named yet");
    expect(all).toContain("VIN: -");
  });
});
