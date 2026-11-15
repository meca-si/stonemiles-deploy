// remarkInspection.test.ts — the duty-remark → checklist mapping
// (owner addition 2026-11-15): only the two inspection remarks map
// to a checklist; every other remark opens nothing.

import { describe, expect, test } from "bun:test";
import { inspectionKindForRemark } from "./remarkInspection";

describe("inspectionKindForRemark", () => {
  test("the Pre-trip inspection remark opens the pre-trip checklist", () => {
    expect(inspectionKindForRemark("pretrip")).toBe("pretrip");
  });
  test("the Post-trip inspection remark opens the post-trip checklist", () => {
    expect(inspectionKindForRemark("posttrip")).toBe("posttrip");
  });
  test("a Fuel remark opens nothing", () => {
    expect(inspectionKindForRemark("fuel")).toBeNull();
  });
  test("other remarks open nothing", () => {
    for (const r of ["loading", "unloading", "break", "personal", "other"]) {
      expect(inspectionKindForRemark(r)).toBeNull();
    }
  });
  test("no remark / unknown remark opens nothing", () => {
    expect(inspectionKindForRemark(null)).toBeNull();
    expect(inspectionKindForRemark(undefined)).toBeNull();
    expect(inspectionKindForRemark("")).toBeNull();
    expect(inspectionKindForRemark("PRETRIP")).toBeNull();
  });
});
