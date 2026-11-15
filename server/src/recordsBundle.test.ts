// recordsBundle.test.ts — PURE tests for the full records bundle
// (TMS queue item 5): section rendering, honest empty states,
// section caps, credential last-4-only, and the cover's chain
// stamp. The flow tests (recordsBundleFlow.test.ts) cover the
// Library document doors and per-driver isolation.
//
// Run: bun test server/src/recordsBundle.test.ts
import { describe, expect, test } from "bun:test";
import { BUNDLE_CAPS, buildRecordsBundle, bundleDate, type RecordsBundleInput } from "./recordsBundle";

function baseInput(over: Partial<RecordsBundleInput> = {}): RecordsBundleInput {
  return {
    driverLabel: "Alice A (@alice)",
    generatedAtIso: "2026-11-15T09:00:00.000Z",
    chainHead: "abc123headhash",
    chainIntact: true,
    chainChecked: 42,
    loads: [],
    hosDays: [],
    dvirs: [],
    maintenance: [],
    truck: null,
    ifta: null,
    credentials: [],
    ...over,
  };
}

function section(bundle: ReturnType<typeof buildRecordsBundle>, heading: string): string[] {
  const s = bundle.sections.find((x) => x.heading === heading);
  if (!s) throw new Error(`missing section ${heading}`);
  return s.lines;
}

describe("records bundle — cover", () => {
  test("the cover carries the driver, the counts, and the verified chain head", () => {
    const b = buildRecordsBundle(baseInput({ loads: [{ id: 1, shipper: "Acme", lane: "Mobile, AL → Pensacola, FL", referenceNumber: null, commodity: null, status: "Delivered", rate: 100, extraCharges: 0, loadedMiles: 10, sealed: true, deliveredAtIso: "2026-11-10T00:00:00.000Z" }] }));
    const cover = section(b, "About this bundle").join("\n");
    expect(cover).toContain("Alice A (@alice)");
    expect(cover).toContain("1 load(s)");
    expect(cover).toContain("abc123headhash");
    expect(cover).toContain("verified intact (42 records checked)");
    expect(b.counts.loads).toBe(1);
  });

  test("a chain that did not verify says so in plain words", () => {
    const b = buildRecordsBundle(baseInput({ chainIntact: false }));
    expect(section(b, "About this bundle").join("\n")).toContain("DID NOT VERIFY");
  });
});

describe("records bundle — honest empty states", () => {
  test("every record type with nothing on file says so — no silent gaps", () => {
    const b = buildRecordsBundle(baseInput());
    expect(section(b, "Loads")[0]).toContain("No loads on file yet");
    expect(section(b, "Hours of service — daily logs")[0]).toContain("No HOS daily logs on file yet");
    expect(section(b, "Inspection reports (DVIR)")[0]).toContain("No inspection reports on file yet");
    expect(section(b, "Truck & trailer record")[0]).toContain("No truck or trailer record on file yet");
    expect(section(b, "Maintenance log")[0]).toContain("No maintenance entries on file yet");
    expect(section(b, "IFTA data")[0]).toContain("No IFTA data on file yet");
    expect(section(b, "Credentials on file")[0]).toContain("No credentials on file yet");
  });
});

describe("records bundle — loads", () => {
  test("a sealed load prints lane, shipper, ref, seal date, and total pay (rate + extras)", () => {
    const b = buildRecordsBundle(baseInput({
      loads: [{
        id: 7, shipper: "Acme Steel", lane: "Mobile, AL → Pensacola, FL", referenceNumber: "BOL-9",
        commodity: "Steel coils", status: "Delivered", rate: 2400, extraCharges: 150,
        loadedMiles: 412.4, sealed: true, deliveredAtIso: "2026-11-10T15:00:00.000Z",
      }],
    }));
    const line = section(b, "Loads")[0]!;
    expect(line).toContain("Load #7");
    expect(line).toContain("Mobile, AL → Pensacola, FL");
    expect(line).toContain("Ref BOL-9");
    expect(line).toContain("POD sealed Nov 10, 2026");
    expect(line).toContain("$2,550.00");
    expect(line).toContain("412 loaded mi");
  });

  test("a load with no rate on file says so — no amount is invented", () => {
    const b = buildRecordsBundle(baseInput({
      loads: [{ id: 3, shipper: null, lane: "A → B", referenceNumber: null, commodity: null, status: "booked", rate: null, extraCharges: 0, loadedMiles: null, sealed: false, deliveredAtIso: null }],
    }));
    const line = section(b, "Loads")[0]!;
    expect(line).toContain("No rate on file");
    expect(line).toContain("Status: booked");
    expect(line).not.toContain("$");
  });

  test("a load's reefer temperature log exports with the bundle as delivery proof (Wave 2 item 11)", () => {
    const b = buildRecordsBundle(baseInput({
      loads: [{
        id: 9, shipper: "Gulf Foods", lane: "Mobile, AL → Atlanta, GA", referenceNumber: "RF-1",
        commodity: "Frozen chicken", status: "Delivered", rate: 1800, extraCharges: 0,
        loadedMiles: 330, sealed: true, deliveredAtIso: "2026-11-12T15:00:00.000Z",
        reeferTemps: {
          rangeLabel: "31°F–41°F",
          readings: [
            { atIso: "2026-11-12T08:00:00.000Z", tempF: 34.5, verdict: "in_range", source: "partner" },
            { atIso: "2026-11-12T11:00:00.000Z", tempF: 44.2, verdict: "out_of_range", source: "partner" },
            { atIso: "2026-11-12T13:00:00.000Z", tempF: 35.1, verdict: "in_range", source: "simulated" },
          ],
        },
      }],
    }));
    const lines = section(b, "Loads");
    const logHead = lines.find((l) => l.includes("Reefer temperature log"))!;
    expect(logHead).toContain("load range 31°F–41°F");
    expect(lines.some((l) => l.includes("34.5°F") && l.includes("in range"))).toBe(true);
    expect(lines.some((l) => l.includes("44.2°F") && l.includes("OUT OF RANGE"))).toBe(true);
    // A simulated reading is labelled simulated in the export too.
    expect(lines.some((l) => l.includes("35.1°F") && l.includes("SIMULATED"))).toBe(true);
  });

  test("a reefer load with no range set says the readings were logged without judgement", () => {
    const b = buildRecordsBundle(baseInput({
      loads: [{
        id: 10, shipper: null, lane: "A → B", referenceNumber: null, commodity: null, status: "booked",
        rate: null, extraCharges: 0, loadedMiles: null, sealed: false, deliveredAtIso: null,
        reeferTemps: {
          rangeLabel: null,
          readings: [{ atIso: "2026-11-12T08:00:00.000Z", tempF: 34.5, verdict: null, source: "partner" }],
        },
      }],
    }));
    const lines = section(b, "Loads");
    expect(lines.some((l) => l.includes("no range set on this load"))).toBe(true);
  });

  test("the loads section caps and says how many more exist", () => {
    const loads = Array.from({ length: BUNDLE_CAPS.loads + 5 }, (_, i) => ({
      id: i + 1, shipper: null, lane: "A → B", referenceNumber: null, commodity: null,
      status: "booked", rate: null, extraCharges: 0, loadedMiles: null, sealed: false, deliveredAtIso: null,
    }));
    const lines = section(buildRecordsBundle(baseInput({ loads })), "Loads");
    expect(lines.length).toBe(BUNDLE_CAPS.loads + 1);
    expect(lines[lines.length - 1]).toContain("and 5 more on file");
  });
});

describe("records bundle — HOS, DVIR, maintenance", () => {
  test("an HOS day prints date, status, miles, pre-trip, and a critical defect flag", () => {
    const b = buildRecordsBundle(baseInput({
      hosDays: [{ logDate: "2026-11-10", status: "closed", totalMiles: 512.34, loadsDelivered: 1, pretripResult: "pass", criticalDefect: true }],
    }));
    const line = section(b, "Hours of service — daily logs")[0]!;
    expect(line).toContain("2026-11-10");
    expect(line).toContain("512.3 mi");
    expect(line).toContain("Pre-trip: pass");
    expect(line).toContain("CRITICAL DEFECT flagged");
  });

  test("a DVIR prints kind, defect state, signer, odometer, and rig labels", () => {
    const b = buildRecordsBundle(baseInput({
      dvirs: [{ inspectedAtIso: "2026-11-10T12:12:00.000Z", kind: "pretrip", status: "defects_reported", defectCount: 2, odometer: 812340, truckLabel: "2021 Kenworth T680", trailerLabel: "2019 Utility", signedName: "Alice A" }],
    }));
    const line = section(b, "Inspection reports (DVIR)")[0]!;
    expect(line).toContain("Pre-trip");
    expect(line).toContain("2 defect(s) reported");
    expect(line).toContain("Signed: Alice A");
    expect(line).toContain("Odometer 812,340");
    expect(line).toContain("Truck: 2021 Kenworth T680");
  });

  test("maintenance prints every state honestly — a DVIR draft is labelled unconfirmed — and totals", () => {
    const b = buildRecordsBundle(baseInput({
      maintenance: [
        { performedAtIso: "2026-11-01T00:00:00.000Z", category: "oil", description: "Oil change", shop: "Shop A", cost: 450, odometer: 800000, status: "logged" },
        { performedAtIso: "2026-11-10T00:00:00.000Z", category: "brakes", description: "Brake chamber", shop: null, cost: 0, odometer: null, status: "draft" },
      ],
    }));
    const lines = section(b, "Maintenance log");
    expect(lines[0]).toContain("Oil change");
    expect(lines[1]).toContain("DRAFT — from a DVIR defect, not yet confirmed");
    expect(lines[2]).toContain("Total maintenance cost on file: $450.00");
  });
});

describe("records bundle — truck record, IFTA, credentials", () => {
  test("the truck section prints the owner's full identity (this is his own export)", () => {
    const b = buildRecordsBundle(baseInput({
      truck: {
        truckYear: 2021, truckMake: "Kenworth", truckModel: "T680", truckUnitNumber: "12",
        truckVin: "1XKYD49X1MJ123456", truckPlate: "AL-1234", truckEngine: "PACCAR MX-13", truckTransmission: "18-speed",
        heightFt: 13, heightIn: 6, weightLbs: 80000, lengthFt: 53,
        trailerYear: 2019, trailerMake: "Utility", trailerModel: "4000D-X", trailerType: "Step deck",
        trailerVin: "1UYVS2535KM654321", trailerPlate: "AL-9876",
      },
    }));
    const text = section(b, "Truck & trailer record").join("\n");
    expect(text).toContain("Truck: 2021 Kenworth T680");
    expect(text).toContain("Truck VIN: 1XKYD49X1MJ123456");
    expect(text).toContain("Trailer: 2019 Utility 4000D-X Step deck");
    expect(text).toContain("Trailer VIN: 1UYVS2535KM654321");
    expect(text).toContain("Height 13 ft 6 in");
  });

  test("IFTA prints state lines, totals, and the estimate disclaimer", () => {
    const b = buildRecordsBundle(baseInput({
      ifta: { year: 2026, rows: [{ state: "AL", miles: 1200.04, gallonsBought: 180.5 }, { state: "FL", miles: 300, gallonsBought: 0 }], totalMiles: 1500.04, totalGallons: 180.5 },
    }));
    const text = section(b, "IFTA data").join("\n");
    expect(text).toContain("AL: 1200 mi · 180.5 gal bought");
    expect(text).toContain("Totals: 1500 mi · 180.5 gal bought");
    expect(text).toContain("not a filing and not tax advice");
  });

  test("a credential prints kind, expiry, and last-4 only", () => {
    const b = buildRecordsBundle(baseInput({
      credentials: [{ label: "CDL", detail: "Alabama CDL", expiresIso: "2028-03-14T00:00:00.000Z", last4: "4321" }],
    }));
    const line = section(b, "Credentials on file")[0]!;
    expect(line).toContain("CDL");
    expect(line).toContain("Expires Mar 14, 2028");
    expect(line).toContain("····4321");
  });

  test("bundleDate renders UTC dates without timezone drift", () => {
    expect(bundleDate("2026-01-01T00:30:00.000Z")).toBe("Jan 1, 2026");
    expect(bundleDate("2026-12-31T23:30:00.000Z")).toBe("Dec 31, 2026");
  });
});
