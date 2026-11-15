// dutyRemarks.test.ts — UNIT tests for the duty-change remark
// resolver (dutyRemarks.ts). The carrier's rule (2026-11-15): a
// sealed duty_change NEVER lacks a remark. The driver's quick-pick
// wins verbatim; any path that cannot ask (auto-swap, offline
// capture, pre-trip stamp) gets an explicit system default stamped
// remarkSource "default" — visible as system-supplied, never
// dressed up as the driver's words.

import { describe, expect, test } from "bun:test";
import { DUTY_REMARK_KEYS, DUTY_REMARK_LABELS, isDutyRemarkKey, resolveDutyRemark } from "./dutyRemarks";

describe("the quick-pick list", () => {
  test("carries exactly the eight carrier reasons, Fuel among them", () => {
    expect([...DUTY_REMARK_KEYS]).toEqual([
      "pretrip", "fuel", "loading", "unloading", "posttrip", "break", "personal", "other",
    ]);
    for (const k of DUTY_REMARK_KEYS) expect(DUTY_REMARK_LABELS[k].length).toBeGreaterThan(0);
    expect(DUTY_REMARK_LABELS.fuel).toBe("Fuel");
    expect(isDutyRemarkKey("fuel")).toBe(true);
    expect(isDutyRemarkKey("nap")).toBe(false);
    expect(isDutyRemarkKey(null)).toBe(false);
  });
});

describe("resolveDutyRemark", () => {
  test("a driver's Fuel pick lands verbatim, note trimmed", () => {
    const r = resolveDutyRemark({ remark: "fuel", remarkNote: "  Filled at the truck stop  ", source: "manual" });
    expect(r).toEqual({ remark: "fuel", remarkNote: "Filled at the truck stop", remarkSource: "driver" });
  });

  test("every quick-pick passes through as the driver's own", () => {
    for (const k of DUTY_REMARK_KEYS) {
      const r = resolveDutyRemark({ remark: k, source: "manual" });
      expect(r.remark).toBe(k);
      expect(r.remarkSource).toBe("driver");
    }
  });

  test("a typed note with no pick is the driver's Other", () => {
    const r = resolveDutyRemark({ remark: null, remarkNote: "Waiting on a door", source: "manual" });
    expect(r).toEqual({ remark: "other", remarkNote: "Waiting on a door", remarkSource: "driver" });
  });

  test("an unrecognized pick falls to the default — never sealed as-is, never empty", () => {
    const r = resolveDutyRemark({ remark: "nap", source: "manual" });
    expect(r.remark).toBe("other");
    expect(r.remarkSource).toBe("default");
  });

  test("a manual change with nothing gets the plain default", () => {
    const r = resolveDutyRemark({ source: "manual" });
    expect(r).toEqual({ remark: "other", remarkNote: null, remarkSource: "default" });
  });

  test("the auto-swap default names the stage honestly", () => {
    const off = resolveDutyRemark({ source: "auto_no_movement", autoStage: "off_duty_2min" });
    expect(off.remarkSource).toBe("default");
    expect(off.remarkNote).toContain("2 minutes");
    const slp = resolveDutyRemark({ source: "auto_no_movement", autoStage: "sleeper_10min" });
    expect(slp.remarkNote).toContain("10 minutes");
    expect(slp.remarkNote).toContain("Sleeper");
  });

  test("the pre-trip stamp's remark is the pre-trip itself", () => {
    const r = resolveDutyRemark({ remark: "pretrip", source: "pretrip_checklist" });
    expect(r.remark).toBe("pretrip");
    const bare = resolveDutyRemark({ source: "pretrip_checklist" });
    expect(bare).toEqual({ remark: "pretrip", remarkNote: null, remarkSource: "default" });
  });

  test("an offline capture with no remark says so on the record", () => {
    const r = resolveDutyRemark({ source: "manual", offline: true });
    expect(r.remark).toBe("other");
    expect(r.remarkSource).toBe("default");
    expect(r.remarkNote).toContain("Captured offline");
  });

  test("an offline capture WITH the driver's pick keeps it", () => {
    const r = resolveDutyRemark({ remark: "loading", source: "manual", offline: true });
    expect(r).toEqual({ remark: "loading", remarkNote: null, remarkSource: "driver" });
  });

  test("notes are capped at 200 characters", () => {
    const r = resolveDutyRemark({ remark: "other", remarkNote: "x".repeat(500), source: "manual" });
    expect(r.remarkNote!.length).toBe(200);
  });
});
