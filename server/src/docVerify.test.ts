import { describe, expect, test } from "bun:test";
import {
EMPTY_DOC_FIELDS,
addressesMatch,
canonicalOutcomesJson,
crossVerifyDocuments,
moneyToCents,
planExceptionChanges,
summarizeDocVerification,
windowsMatch,
type DocSide,
type DocSideFields,
} from "./docVerify";
import { evaluateSealGrade, type FixQualityTallies } from "./sealGrade";

/** A complete, self-consistent document field set — every compared
 *  field present, so a pair built from it can reach "verified". */
function fullFields(overrides: Partial<DocSideFields> = {}): DocSideFields {
  return {
    ...EMPTY_DOC_FIELDS,
    identity: "Peacock Pavers Acquisition LLC",
    pickupAddress: "1200 Industrial Pkwy",
    pickupCity: "Mobile",
    pickupState: "Alabama",
    deliveryAddress: "88 Quarry Rd",
    deliveryCity: "Pensacola",
    deliveryState: "Florida",
    pickupWindow: "10/26/2026 8:00 AM",
    deliveryWindow: "10/27/2026 2:00 PM",
    commodity: "Crushed stone",
    weightLbs: 44000,
    pieces: 12,
    sealNumber: "SL-009812",
    rate: 2500,
    chargesFuelSurcharge: 300,
    chargesDetention: 0,
    chargesLumper: 0,
    chargesOther: 0,
    chargesTotal: 300,
    loadNumber: "LD1042",
    poNumber: "PO-7781",
    proNumber: "PRO99120",
    ...overrides,
  };
}

function side(fields: DocSideFields, over: Partial<DocSide> = {}): DocSide {
  return { present: true, readFailed: false, fields, ...over };
}

describe("crossVerifyDocuments", () => {
  test("every field matches → verified", () => {
    const r = crossVerifyDocuments(side(fullFields()), side(fullFields()));
    expect(r.verdict).toBe("verified");
    expect(r.mismatchFields).toEqual([]);
    expect(r.matchedCount).toBe(r.fields.length);
    expect(r.missingCount).toBe(0);
    // The canonical outcomes string covers the verdict + every field.
    const parsed = JSON.parse(canonicalOutcomesJson(r)) as { verdict: string; fields: unknown[] };
    expect(parsed.verdict).toBe("verified");
    expect(parsed.fields.length).toBe(r.fields.length);
  });

  test("rate off by exactly one cent → differences_found, rate mismatch, exception opens", () => {
    const r = crossVerifyDocuments(
      side(fullFields({ rate: 2500 })),
      side(fullFields({ rate: 2499.99 })),
    );
    expect(r.verdict).toBe("differences_found");
    expect(r.mismatchFields).toEqual(["rate"]);
    const rate = r.fields.find((f) => f.field === "rate")!;
    expect(rate.rateconValue).toBe("$2,500.00");
    expect(rate.bolValue).toBe("$2,499.99");
    // No open exceptions yet → the plan opens one for the rate field.
    const plan = planExceptionChanges(r, []);
    expect(plan.toOpen).toEqual(["rate"]);
    expect(plan.toCloseOnMatch).toEqual([]);
    // Already open → the plan does not re-open it.
    const plan2 = planExceptionChanges(r, [{ field: "rate" }]);
    expect(plan2.toOpen).toEqual([]);
  });

  test("a corrected re-run (rate now matches) closes the open exception as rerun_match", () => {
    const r = crossVerifyDocuments(side(fullFields()), side(fullFields()));
    const plan = planExceptionChanges(r, [{ field: "rate" }, { field: "seal_number" }]);
    expect(plan.toCloseOnMatch).toEqual(["rate", "seal_number"]);
    expect(plan.toOpen).toEqual([]);
  });

  test("an open exception whose field is merely missing on re-run stays open", () => {
    const bolNoRate = fullFields({ rate: null });
    const r = crossVerifyDocuments(side(fullFields()), side(bolNoRate));
    expect(r.verdict).toBe("incomplete");
    const plan = planExceptionChanges(r, [{ field: "rate" }]);
    expect(plan.toCloseOnMatch).toEqual([]);
  });

  test("missing BOL (document not attached) → incomplete, BOL-side outcomes", () => {
    const bol: DocSide = { present: false, readFailed: false, fields: { ...EMPTY_DOC_FIELDS } };
    const r = crossVerifyDocuments(side(fullFields()), bol);
    expect(r.verdict).toBe("incomplete");
    expect(r.mismatchFields).toEqual([]);
    const rate = r.fields.find((f) => f.field === "rate")!;
    expect(rate.outcome).toBe("missing_bol");
    expect(rate.bolValue).toBeNull();
    expect(rate.rateconValue).toBe("$2,500.00");
  });

  test("BOL attached but unreadable → its fields are not_readable, verdict incomplete", () => {
    const bol: DocSide = { present: true, readFailed: true, fields: { ...EMPTY_DOC_FIELDS } };
    const r = crossVerifyDocuments(side(fullFields()), bol);
    expect(r.verdict).toBe("incomplete");
    expect(r.fields.every((f) => f.outcome === "not_readable")).toBe(true);
  });

  test("a field neither document prints holds the pair at incomplete (missing, never dropped)", () => {
    const rc = fullFields({ chargesDetention: null, chargesLumper: null });
    const bol = fullFields({ chargesDetention: null, chargesLumper: null });
    const r = crossVerifyDocuments(side(rc), side(bol));
    expect(r.verdict).toBe("incomplete");
    expect(r.fields.find((f) => f.field === "charges_detention")!.outcome).toBe("missing_ratecon");
    expect(r.fields.find((f) => f.field === "charges_lumper")!.outcome).toBe("missing_ratecon");
  });
});

describe("seal number mismatch → exception blocks release-grade", () => {
  const goodFix: FixQualityTallies = {
    accepted: 120, rejAccuracy: 0, rejJump: 0, rejTime: 0,
    accLe10: 40, accLe25: 40, accLe50: 30, accLe65: 10, accGt65: 0, accNone: 0,
  };

  test("seal-number mismatch opens an exception like any other field", () => {
    const r = crossVerifyDocuments(
      side(fullFields({ sealNumber: "SL009812" })),
      side(fullFields({ sealNumber: "SL009813" })),
    );
    expect(r.mismatchFields).toEqual(["seal_number"]);
    expect(planExceptionChanges(r, []).toOpen).toEqual(["seal_number"]);
  });

  test("a load with an open cross-verification exception does NOT reach release-grade", () => {
    const base = {
      distanceMi: 0.1,
      bolSha256: "a".repeat(64),
      sealMismatch: false,
      fixQuality: goodFix,
    };
    // Without the exception the same load IS release-grade…
    expect(evaluateSealGrade(base).grade).toBe("release_grade");
    // …with an open rate-con/BOL exception it is proof-grade, and the
    // criterion says why.
    const withException = evaluateSealGrade({
      ...base,
      openExceptionDetails: ["Rate-con / BOL check: Rate differs (rate con $2,500.00 vs BOL $2,400.00)."],
    });
    expect(withException.grade).toBe("proof_grade");
    expect(withException.criteria.noOpenExceptions.pass).toBe(false);
    expect(withException.criteria.noOpenExceptions.detail).toContain("Rate differs");
    // The original pickup seal mismatch still blocks the same way.
    const sealOnly = evaluateSealGrade({ ...base, sealMismatch: true });
    expect(sealOnly.grade).toBe("proof_grade");
    expect(sealOnly.criteria.noOpenExceptions.detail).toContain("seal number");
  });
});

describe("acknowledgment semantics (report history is never rewritten)", () => {
  test("after the only exception is acknowledged, the latest verdict still reads differences_found with zero open", () => {
    // The report from the mismatching run is immutable history; the
    // load status composes LATEST VERDICT + OPEN COUNT, so closing
    // the exception by acknowledgment clears the block without ever
    // editing the report's verdict.
    const r = crossVerifyDocuments(side(fullFields()), side(fullFields({ rate: 2400 })));
    expect(r.verdict).toBe("differences_found");
    const summary = summarizeDocVerification([
      { hasBothDocs: true, status: { checked: true, latestVerdict: r.verdict, openExceptions: 1 } },
      { hasBothDocs: true, status: { checked: true, latestVerdict: r.verdict, openExceptions: 0 } },
    ]);
    // Before acknowledgment: differences open. After: no longer
    // counted open, and NOT counted verified either (history stands).
    expect(summary.differencesOpen).toBe(1);
    expect(summary.verified).toBe(0);
    expect(summary.checked).toBe(2);
  });
});

describe("address normalization", () => {
  test("same address formatted differently matches", () => {
    expect(addressesMatch("1200 Industrial Pkwy, Mobile, AL 36618", "1200 INDUSTRIAL PARKWAY Mobile Alabama 36618")).toBe(true);
    expect(addressesMatch("88 Quarry Rd.", "88 QUARRY ROAD")).toBe(true);
    expect(addressesMatch("500 N Main St", "500 North Main Street")).toBe(true);
  });
  test("different ZIP mismatches even when the street agrees", () => {
    expect(addressesMatch("1200 Industrial Pkwy, Mobile, AL 36618", "1200 Industrial Pkwy, Mobile, AL 36619")).toBe(false);
  });
  test("different street mismatches", () => {
    expect(addressesMatch("1200 Industrial Pkwy, Mobile, AL", "1201 Industrial Pkwy, Mobile, AL")).toBe(false);
  });
  test("composed city/state fallback compares as an address", () => {
    const r = crossVerifyDocuments(
      side(fullFields({ pickupAddress: null })),
      side(fullFields({ pickupAddress: null, pickupCity: "mobile", pickupState: "AL" })),
    );
    const f = r.fields.find((x) => x.field === "pickup_address")!;
    expect(f.outcome).toBe("match");
  });
});

describe("moneyToCents — exact decimal parsing, no float fuzz", () => {
  test("whole and fractional dollars parse exactly", () => {
    expect(moneyToCents(2500)).toBe(250000);
    expect(moneyToCents(2500.1)).toBe(250010);
    expect(moneyToCents(0.07)).toBe(7);
    expect(moneyToCents("$2,499.99")).toBe(249999);
    expect(moneyToCents(null)).toBeNull();
    expect(moneyToCents("abc")).toBeNull();
  });
  test("a one-cent difference is a difference", () => {
    expect(moneyToCents(2500)).not.toBe(moneyToCents(2499.99));
  });
});

describe("windowsMatch", () => {
  test("same appointment printed two ways matches", () => {
    expect(windowsMatch("10/26/2026 8:00 AM", "Oct 26, 2026 08:00")).toBe(true);
    expect(windowsMatch("2026-10-26", "10/26/2026")).toBe(true);
  });
  test("different date or time mismatches", () => {
    expect(windowsMatch("10/26/2026 8:00 AM", "10/27/2026 8:00 AM")).toBe(false);
    expect(windowsMatch("10/26/2026 8:00 AM", "10/26/2026 9:00 AM")).toBe(false);
  });
});
