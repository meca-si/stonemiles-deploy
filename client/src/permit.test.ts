import { describe, expect, test } from "bun:test";
import {
  buildPlacards,
  compass8,
  corridorReturn,
  groupPermits,
  mergePermitReads,
  permitOfferFor,
  permitStatusOf,
  type PermitDocket,
  type PermitRead,
} from "./permit";

const docket = (over: Partial<PermitDocket> = {}): PermitDocket => ({
  id: 1,
  loadId: null,
  permitNumber: "AL-2026-1234",
  issuingState: "Alabama",
  issuingAgency: "ALDOT",
  routeSteps: ["I-10 W", "US-98 N"],
  routePlaces: ["Mobile, AL"],
  heightText: null,
  widthText: null,
  lengthText: null,
  weightText: null,
  heightIn: null,
  widthIn: null,
  lengthIn: null,
  weightLbs: null,
  validFrom: "2026-11-02",
  validTo: "2026-11-06",
  escorts: null,
  curfews: [],
  restrictions: [],
  qrText: null,
  hasDoc: true,
  docMime: "image/jpeg",
  filedCopyId: null,
  completedAt: null,
  createdAt: 1,
  ...over,
});

const TODAY = "2026-11-04";

describe("permitStatusOf / groupPermits", () => {
  test("status derives from the window", () => {
    expect(permitStatusOf(docket(), TODAY)).toBe("active");
    expect(permitStatusOf(docket({ validTo: "2026-11-03" }), TODAY)).toBe("expired");
    expect(permitStatusOf(docket({ validFrom: "2026-11-09", validTo: "2026-11-12" }), TODAY)).toBe("upcoming");
    expect(permitStatusOf(docket({ completedAt: 5 }), TODAY)).toBe("completed");
  });
  test("groups land on the three shelves; upcoming rides Active", () => {
    const g = groupPermits(
      [
        docket({ id: 1 }),
        docket({ id: 2, validFrom: "2026-11-09", validTo: "2026-11-12" }),
        docket({ id: 3, completedAt: 5 }),
        docket({ id: 4, validTo: "2026-11-01" }),
      ],
      TODAY,
    );
    expect(g.active.map((p) => p.id)).toEqual([1, 2]);
    expect(g.completed.map((p) => p.id)).toEqual([3]);
    expect(g.expired.map((p) => p.id)).toEqual([4]);
  });
});

describe("permitOfferFor — what navigation may offer", () => {
  test("the load's own active permit wins", () => {
    const offer = permitOfferFor([docket({ id: 1 }), docket({ id: 2, loadId: 7 })], TODAY, 7);
    expect(offer?.id).toBe(2);
  });
  test("a lone unattached active permit is offered for a load run", () => {
    expect(permitOfferFor([docket({ id: 1 })], TODAY, 7)?.id).toBe(1);
  });
  test("several unattached permits are NOT guessed between for a load", () => {
    expect(permitOfferFor([docket({ id: 1 }), docket({ id: 2 })], TODAY, 7)).toBeNull();
  });
  test("expired, completed, and upcoming permits are never offered", () => {
    expect(permitOfferFor([docket({ validTo: "2026-11-01" })], TODAY, null)).toBeNull();
    expect(permitOfferFor([docket({ completedAt: 5 })], TODAY, null)).toBeNull();
    expect(permitOfferFor([docket({ validFrom: "2026-11-09", validTo: "2026-11-12" })], TODAY, null)).toBeNull();
    expect(permitOfferFor([], TODAY, null)).toBeNull();
  });
});

describe("buildPlacards — confirmed docket only, capped, honest overflow", () => {
  test("escorts, curfews, dimensions, restrictions in order", () => {
    const { placards, moreCount } = buildPlacards(
      docket({
        escorts: "1 pilot car front",
        curfews: ["No movement 6–9 AM in Mobile County"],
        widthText: "12 ft",
        heightText: "14 ft 6 in",
        restrictions: ["Bypass Bridge #441 via US-98"],
      }),
    );
    expect(placards.map((p) => p.label)).toEqual([
      "Escort: 1 pilot car front",
      "Curfew: No movement 6–9 AM in Mobile County",
      "Width 12 ft",
      "Height 14 ft 6 in",
      "Bypass Bridge #441 via US-98",
    ]);
    expect(moreCount).toBe(0);
  });
  test("'none' escorts earn no placard", () => {
    const { placards } = buildPlacards(docket({ escorts: "None required" }));
    expect(placards).toEqual([]);
  });
  test("the cap holds and the overflow is counted, not hidden", () => {
    const { placards, moreCount } = buildPlacards(
      docket({ curfews: ["a", "b", "c"], restrictions: ["r1", "r2", "r3", "r4"] }),
      6,
    );
    expect(placards.length).toBe(6);
    expect(moreCount).toBe(1);
  });
  test("an unrestricted docket yields no placards", () => {
    expect(buildPlacards(docket()).placards).toEqual([]);
  });
});

describe("corridor math", () => {
  test("compass8 maps bearings to 8 points", () => {
    expect(compass8(0)).toBe("N");
    expect(compass8(44)).toBe("NE");
    expect(compass8(90)).toBe("E");
    expect(compass8(181)).toBe("S");
    expect(compass8(359)).toBe("N");
  });
  // A straight east-west corridor along lat 30.0 from lon -88 to -87.
  const line: [number, number][] = [
    [30.0, -88.0],
    [30.0, -87.5],
    [30.0, -87.0],
  ];
  test("on the line reads on-route", () => {
    const r = corridorReturn({ lat: 30.0, lon: -87.5 }, line);
    expect(r).not.toBeNull();
    expect(r!.offRoute).toBe(false);
    expect(r!.offMi).toBeLessThan(0.01);
  });
  test("north of the line reads off-route with a way back heading south", () => {
    // ~0.35 mi north of the corridor.
    const r = corridorReturn({ lat: 30.005, lon: -87.5 }, line);
    expect(r).not.toBeNull();
    expect(r!.offRoute).toBe(true);
    expect(r!.offMi).toBeGreaterThan(0.3);
    expect(r!.offMi).toBeLessThan(0.4);
    expect(r!.headingBackCompass).toBe("S");
  });
  test("an empty corridor yields null, never a fabricated reading", () => {
    expect(corridorReturn({ lat: 30, lon: -87.5 }, [])).toBeNull();
  });
});

describe("mergePermitReads — PDF pages merge without inventing", () => {
  const read = (over: Partial<PermitRead> = {}): PermitRead => ({
    found: true,
    permitNumber: null,
    issuingState: null,
    issuingAgency: null,
    routeSteps: [],
    routePlaces: [],
    heightText: null,
    widthText: null,
    lengthText: null,
    weightText: null,
    heightIn: null,
    widthIn: null,
    lengthIn: null,
    weightLbs: null,
    validFrom: null,
    validTo: null,
    escorts: null,
    curfews: [],
    restrictions: [],
    qrText: null,
    ...over,
  });
  test("first page wins a field; line lists append in order, deduped", () => {
    const merged = mergePermitReads([
      read({ permitNumber: "P-1", routeSteps: ["I-10 W"], restrictions: ["Bypass A"] }),
      read({ permitNumber: "P-2", routeSteps: ["US-98 N"], restrictions: ["Bypass A", "No night moves"], validTo: "2026-11-06" }),
    ]);
    expect(merged?.permitNumber).toBe("P-1");
    expect(merged?.routeSteps).toEqual(["I-10 W", "US-98 N"]);
    expect(merged?.restrictions).toEqual(["Bypass A", "No night moves"]);
    expect(merged?.validTo).toBe("2026-11-06");
  });
  test("no page found anything → null", () => {
    expect(mergePermitReads([read({ found: false }), read({ found: false })])).toBeNull();
    expect(mergePermitReads([])).toBeNull();
  });
});
