import { describe, expect, test } from "bun:test";
import {
  bridgeFormulaCalc,
  bridgeGroupAllowed,
  fmtHeightIn,
  heightInUse,
  minTiedowns393110,
  pretripChecklist,
  reeferBandStatus,
  securementCalc,
  trailerProfile,
  windAdvisory,
  TRAILER_PROFILES,
} from "./trailer";

describe("trailer profiles", () => {
  test("all five types exist with tool orders", () => {
    expect(Object.keys(TRAILER_PROFILES).sort()).toEqual(["dry_van", "flatbed", "reefer", "rgn", "step_deck"]);
    expect(trailerProfile("reefer").toolOrder[0]).toBe("reefer");
    expect(trailerProfile("dry_van").toolOrder[0]).toBe("dock");
    expect(trailerProfile("flatbed").toolOrder[0]).toBe("securement");
    expect(trailerProfile("rgn").toolOrder[0]).toBe("axle");
    expect(trailerProfile("flatbed").openDeck).toBe(true);
    expect(trailerProfile("dry_van").highProfile).toBe(true);
    expect(trailerProfile("reefer").highProfile).toBe(true);
    expect(trailerProfile("rgn").highProfile).toBe(false);
  });
});

describe("heightInUse", () => {
  test("loaded height wins when recorded; truck height is the labelled fallback", () => {
    const loaded = heightInUse({ loadedHeightIn: 148, truckHeightIn: 162 });
    expect(loaded.inches).toBe(148);
    expect(loaded.source).toBe("loaded");
    const fallback = heightInUse({ loadedHeightIn: null, truckHeightIn: 162 });
    expect(fallback.inches).toBe(162);
    expect(fallback.source).toBe("truck");
    expect(fallback.label).toContain("no loaded height recorded");
  });
  test("fmtHeightIn", () => {
    expect(fmtHeightIn(162)).toBe("13'6\"");
    expect(fmtHeightIn(144)).toBe("12'0\"");
    expect(fmtHeightIn(null)).toBe("—");
  });
});

describe("securement — 49 CFR 393.110 minimum tiedowns", () => {
  test("unblocked table", () => {
    expect(minTiedowns393110(4, 900, false)).toBe(1); // ≤5 ft, ≤1,100 lb
    expect(minTiedowns393110(5, 1100, false)).toBe(1);
    expect(minTiedowns393110(4, 5000, false)).toBe(2); // ≤5 ft, >1,100 lb
    expect(minTiedowns393110(8, 20000, false)).toBe(2); // >5, ≤10 ft
    expect(minTiedowns393110(10, 20000, false)).toBe(2);
    expect(minTiedowns393110(11, 20000, false)).toBe(3); // 2 + 1 for the part-10-ft
    expect(minTiedowns393110(20, 20000, false)).toBe(3);
    expect(minTiedowns393110(21, 20000, false)).toBe(4);
    expect(minTiedowns393110(40, 20000, false)).toBe(5);
  });
  test("blocked table — one per 10 ft or part thereof", () => {
    expect(minTiedowns393110(6, 20000, true)).toBe(1);
    expect(minTiedowns393110(10, 20000, true)).toBe(1);
    expect(minTiedowns393110(15, 20000, true)).toBe(2);
    expect(minTiedowns393110(40, 20000, true)).toBe(4);
  });
});

describe("securementCalc — counts + aggregate WLL (393.106(d))", () => {
  test("passes when count and WLL both meet the rule", () => {
    const r = securementCalc({
      lengthFt: 20,
      weightLbs: 20000,
      blockedForward: false,
      tiedowns: [{ count: 4, wllLbs: 5400, kind: "indirect" }],
    });
    expect(r.inScope).toBe(true);
    expect(r.minTiedowns).toBe(3);
    expect(r.tiedownCountPass).toBe(true);
    expect(r.requiredWllLbs).toBe(10000); // 50% of cargo weight
    expect(r.aggregateWllLbs).toBe(21600);
    expect(r.wllPass).toBe(true);
  });
  test("direct tiedowns count at half WLL — can fail WLL while count passes", () => {
    const r = securementCalc({
      lengthFt: 8,
      weightLbs: 30000,
      blockedForward: false,
      tiedowns: [{ count: 2, wllLbs: 6600, kind: "direct" }],
    });
    expect(r.minTiedowns).toBe(2);
    expect(r.tiedownCountPass).toBe(true);
    expect(r.aggregateWllLbs).toBe(6600); // 2 × 6,600 × ½
    expect(r.requiredWllLbs).toBe(15000);
    expect(r.wllPass).toBe(false);
  });
  test("missing length/weight is out of scope, never guessed", () => {
    const r = securementCalc({ lengthFt: 0, weightLbs: 0, blockedForward: false, tiedowns: [] });
    expect(r.inScope).toBe(false);
    expect(r.minTiedowns).toBeNull();
    expect(r.outOfScopeReason).toContain("won't guess");
  });
  test("labels itself a planning guide, not legal advice", () => {
    const r = securementCalc({ lengthFt: 10, weightLbs: 5000, blockedForward: false, tiedowns: [] });
    expect(r.notes.join(" ")).toContain("not legal advice");
    expect(r.notes.join(" ")).toContain("393.116");
  });
});

describe("bridge formula — 23 CFR 658.17", () => {
  test("single axle cap", () => {
    expect(bridgeGroupAllowed(1, 0 + 1)).toBe(20000);
  });
  test("tandem cap at ≤8 ft; formula governs a 10-ft spread", () => {
    expect(bridgeGroupAllowed(2, 8)).toBe(34000);
    expect(bridgeGroupAllowed(2, 4)).toBe(34000);
    expect(bridgeGroupAllowed(2, 10)).toBe(40000); // spread-axle case
  });
  test("published-table spot checks", () => {
    expect(bridgeGroupAllowed(3, 16)).toBe(48000);
    expect(bridgeGroupAllowed(5, 51)).toBe(80000); // 79,875 by formula, rounds to the table's 80,000
  });
  test("group + gross evaluation", () => {
    const r = bridgeFormulaCalc([
      { axles: 1, spacingFt: 1, actualLbs: 12000 },
      { axles: 2, spacingFt: 4.25, actualLbs: 34000 },
      { axles: 2, spacingFt: 4.25, actualLbs: 36000 },
    ]);
    expect(r.groups[0]!.pass).toBe(true);
    expect(r.groups[1]!.pass).toBe(true);
    expect(r.groups[2]!.pass).toBe(false);
    expect(r.groups[2]!.overLbs).toBe(2000);
    expect(r.grossActualLbs).toBe(82000);
    expect(r.grossPass).toBe(false);
    expect(r.allPass).toBe(false);
  });
  test("nonsense input is out of scope, not guessed", () => {
    const r = bridgeFormulaCalc([{ axles: 0, spacingFt: 0, actualLbs: 1000 }]);
    expect(r.groups[0]!.allowedLbs).toBeNull();
    expect(r.groups[0]!.outOfScopeReason).toContain("won't guess");
  });
});

describe("reefer band", () => {
  test("in / above / below the driver-set band", () => {
    expect(reeferBandStatus({ setpointF: 34, bandF: 5, tempF: 36 }).status).toBe("in_band");
    expect(reeferBandStatus({ setpointF: 34, bandF: 5, tempF: 39 }).status).toBe("in_band"); // edge counts in
    expect(reeferBandStatus({ setpointF: 34, bandF: 5, tempF: 41 }).status).toBe("above");
    expect(reeferBandStatus({ setpointF: -10, bandF: 5, tempF: -18 }).status).toBe("below");
  });
});

describe("wind advisory", () => {
  test("fires only for an empty high-profile trailer at/over the gust threshold", () => {
    expect(windAdvisory({ trailerType: "dry_van", trailerEmpty: true, gustMph: 45, windMph: 28 }).show).toBe(true);
    expect(windAdvisory({ trailerType: "reefer", trailerEmpty: true, gustMph: 40, windMph: 25 }).show).toBe(true);
    expect(windAdvisory({ trailerType: "dry_van", trailerEmpty: false, gustMph: 55, windMph: 30 }).show).toBe(false); // loaded
    expect(windAdvisory({ trailerType: "flatbed", trailerEmpty: true, gustMph: 55, windMph: 30 }).show).toBe(false); // not high-profile
    expect(windAdvisory({ trailerType: "dry_van", trailerEmpty: true, gustMph: 39, windMph: 22 }).show).toBe(false); // under threshold
    expect(windAdvisory({ trailerType: "dry_van", trailerEmpty: true, gustMph: null, windMph: null }).show).toBe(false); // no data, no claim
  });
  test("text labels itself an advisory, not an official warning", () => {
    const r = windAdvisory({ trailerType: "dry_van", trailerEmpty: true, gustMph: 45, windMph: 28 });
    expect(r.text).toContain("not an official warning");
  });
});

describe("pre-trip checklists", () => {
  test("each trailer type gets its own items on top of the common set", () => {
    const reefer = pretripChecklist("reefer").map((i) => i.id);
    expect(reefer).toContain("reefer_unit");
    expect(reefer).toContain("setpoint_check");
    const flatbed = pretripChecklist("flatbed").map((i) => i.id);
    expect(flatbed).toContain("winches");
    expect(flatbed).toContain("straps_chains");
    const rgn = pretripChecklist("rgn").map((i) => i.id);
    expect(rgn).toContain("neck");
    expect(rgn).toContain("hydraulics");
    const van = pretripChecklist("dry_van").map((i) => i.id);
    expect(van).toContain("doors");
    expect(van).toContain("seal");
    for (const t of ["dry_van", "reefer", "flatbed", "step_deck", "rgn"] as const) {
      expect(pretripChecklist(t).length).toBeGreaterThanOrEqual(10);
    }
  });
});
