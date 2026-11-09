import { describe, expect, test } from "bun:test";
import {
  ATLAS_REFERENCE_NOTE,
  ATLAS_STATES,
  FEDERAL_STANDARD_LABEL,
  FEDERAL_WEIGHTS,
  FEDERAL_WIDTH_IN,
  atlasStateByCode,
  atlasStateSummary,
  findAtlasStateInText,
} from "./atlas";

// The Atlas's honesty rules, pinned: all 50 states, the federal
// baseline exact, and NO invented state numbers — a phone number or a
// state note may only ever exist for the vetted short list below,
// so a future edit that "helpfully" fills one in for another state
// fails this suite until a human re-verifies it.

const ALL_CODES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

/** States cleared to carry a printed phone number (real published
 *  lines, known with confidence). Anyone adding a state here must
 *  re-verify the number against the agency's own publication. */
const PHONE_CLEARED = new Set(["CA", "FL", "GA", "MO", "OH", "TX"]);

describe("atlas coverage", () => {
  test("all 50 states, exactly once each", () => {
    expect(ATLAS_STATES.length).toBe(50);
    expect(ATLAS_STATES.map((s) => s.code).sort()).toEqual([...ALL_CODES].sort());
    expect(new Set(ATLAS_STATES.map((s) => s.name)).size).toBe(50);
  });

  test("every state names its DOT and patrol agency", () => {
    for (const s of ATLAS_STATES) {
      expect(s.dotName.length).toBeGreaterThan(3);
      expect(s.patrolName.length).toBeGreaterThan(3);
    }
  });

  test("the federal baseline is the federal baseline", () => {
    expect(FEDERAL_WEIGHTS.gvwLbs).toBe(80_000);
    expect(FEDERAL_WEIGHTS.singleAxleLbs).toBe(20_000);
    expect(FEDERAL_WEIGHTS.tandemAxleLbs).toBe(34_000);
    expect(FEDERAL_WIDTH_IN).toBe(102);
  });

  test("the standing labels read exactly as ordered", () => {
    expect(ATLAS_REFERENCE_NOTE).toBe("Reference only — posted signs, your permit, and your ELD govern.");
    expect(FEDERAL_STANDARD_LABEL).toBe("Federal standard — verify state specifics before you roll.");
  });
});

describe("atlas honesty guards", () => {
  test("phone numbers only for the verified short list, and shaped like phone numbers", () => {
    for (const s of ATLAS_STATES) {
      for (const phone of [s.dotPhone, s.patrolPhone]) {
        if (phone == null) continue;
        expect(PHONE_CLEARED.has(s.code)).toBe(true);
        expect(phone).toMatch(/^[*#0-9][0-9\-*#() ]*$/);
      }
    }
    // The verified lines themselves, pinned byte-for-byte.
    expect(atlasStateByCode("CA")?.dotPhone).toBe("1-800-427-7623");
    expect(atlasStateByCode("CA")?.patrolPhone).toBe("1-800-835-5247");
    expect(atlasStateByCode("TX")?.dotPhone).toBe("1-800-558-9368");
    expect(atlasStateByCode("FL")?.patrolPhone).toBe("*347");
    expect(atlasStateByCode("GA")?.patrolPhone).toBe("*477");
    expect(atlasStateByCode("MO")?.patrolPhone).toBe("*55");
    expect(atlasStateByCode("OH")?.patrolPhone).toBe("#677");
  });

  test("the famous state weight exceptions carry their real numbers — and only those", () => {
    expect(atlasStateByCode("MI")?.weightNote).toContain("164,000");
    expect(atlasStateByCode("ME")?.weightNote).toContain("100,000");
    expect(atlasStateByCode("VT")?.weightNote).toContain("100,000");
    expect(atlasStateByCode("ID")?.weightNote).toContain("105,500");
    // A state off the exception list never states a gross-weight number.
    for (const s of ATLAS_STATES) {
      if (["MI", "ME", "VT", "ID"].includes(s.code) || s.weightNote == null) continue;
      expect(s.weightNote).not.toMatch(/\d{2,3},\d{3}\s*lb/);
    }
  });

  test("kingpin rules are California 40 and Florida 41 — nobody else's is invented", () => {
    expect(atlasStateByCode("CA")?.sizeNote).toContain("40 ft");
    expect(atlasStateByCode("FL")?.sizeNote).toContain("41 ft");
    for (const s of ATLAS_STATES) {
      if (s.code === "CA" || s.code === "FL" || s.sizeNote == null) continue;
      expect(s.sizeNote.toLowerCase()).not.toContain("kingpin");
    }
  });

  test("clearance notes name only the famous, sourced traps", () => {
    const withNotes = ATLAS_STATES.filter((s) => s.clearanceNote != null).map((s) => s.code).sort();
    expect(withNotes).toEqual(["IL", "MA", "NC", "NY"]);
    expect(atlasStateByCode("NC")?.clearanceNote).toContain("12 ft 4 in");
  });
});

describe("atlas lookups", () => {
  test("by code, case-insensitive, null on junk", () => {
    expect(atlasStateByCode("tx")?.name).toBe("Texas");
    expect(atlasStateByCode(" TX ")?.name).toBe("Texas");
    expect(atlasStateByCode("XX")).toBeNull();
    expect(atlasStateByCode(null)).toBeNull();
  });

  test("findAtlasStateInText hears the driver's phrasings", () => {
    expect(findAtlasStateInText("open the Texas atlas page")?.code).toBe("TX");
    expect(findAtlasStateInText("what's the weight limit in Michigan?")?.code).toBe("MI");
    expect(findAtlasStateInText("take me to the atlas for new york")?.code).toBe("NY");
    expect(findAtlasStateInText("north carolina low bridges")?.code).toBe("NC");
    expect(findAtlasStateInText("atlas page for TX weight limits")?.code).toBe("TX");
  });

  test("findAtlasStateInText never guesses a state that isn't there", () => {
    expect(findAtlasStateInText("open the atlas")).toBeNull();
    expect(findAtlasStateInText("where are my trip sheets")).toBeNull();
    // Everyday words that happen to be codes never read as states.
    expect(findAtlasStateInText("show me my loads or my hours")).toBeNull();
    expect(findAtlasStateInText("take me there")).toBeNull();
  });

  test("the summary carries the baseline, the state note, and the reference label", () => {
    const tx = atlasStateSummary(atlasStateByCode("TX")!);
    expect(tx).toContain("80,000 lb gross");
    expect(tx).toContain("federal standard — verify state specifics");
    expect(tx).toContain(ATLAS_REFERENCE_NOTE);
    const mi = atlasStateSummary(atlasStateByCode("MI")!);
    expect(mi).toContain("164,000 lb");
    expect(mi).toContain(ATLAS_REFERENCE_NOTE);
  });
});
