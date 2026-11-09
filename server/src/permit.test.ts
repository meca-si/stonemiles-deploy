import { describe, expect, test } from "bun:test";
import {
  cleanPermitLines,
  isIsoDate,
  linesFromTextBlock,
  parsePermitLines,
  permitStatusOf,
  todayIsoInZone,
} from "./permit";

describe("isIsoDate", () => {
  test("accepts real calendar dates only", () => {
    expect(isIsoDate("2026-11-04")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false); // 2026 is not a leap year
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("11/04/2026")).toBe(false);
    expect(isIsoDate("2026-11-4")).toBe(false);
    expect(isIsoDate(null)).toBe(false);
    expect(isIsoDate("")).toBe(false);
  });
});

describe("permitStatusOf — derived from the window, never stored", () => {
  const today = "2026-11-04";
  test("inside the window is active; edges are inclusive", () => {
    expect(permitStatusOf({ validFrom: "2026-11-02", validTo: "2026-11-06", completedAtMs: null }, today)).toBe("active");
    expect(permitStatusOf({ validFrom: "2026-11-04", validTo: "2026-11-04", completedAtMs: null }, today)).toBe("active");
  });
  test("window ended is expired", () => {
    expect(permitStatusOf({ validFrom: "2026-10-28", validTo: "2026-11-03", completedAtMs: null }, today)).toBe("expired");
  });
  test("window not yet open is upcoming", () => {
    expect(permitStatusOf({ validFrom: "2026-11-09", validTo: "2026-11-12", completedAtMs: null }, today)).toBe("upcoming");
  });
  test("completed beats every window state", () => {
    expect(permitStatusOf({ validFrom: "2026-11-02", validTo: "2026-11-06", completedAtMs: 123 }, today)).toBe("completed");
    expect(permitStatusOf({ validFrom: "2026-10-01", validTo: "2026-10-02", completedAtMs: 123 }, today)).toBe("completed");
  });
  test("no window at all reads active — nothing says it isn't usable", () => {
    expect(permitStatusOf({ validFrom: null, validTo: null, completedAtMs: null }, today)).toBe("active");
    expect(permitStatusOf({ validFrom: null, validTo: "2026-12-01", completedAtMs: null }, today)).toBe("active");
  });
  test("a malformed stored date never expires or gates a permit", () => {
    expect(permitStatusOf({ validFrom: "soon", validTo: "later", completedAtMs: null }, today)).toBe("active");
  });
});

describe("line lists", () => {
  test("parsePermitLines round-trips and refuses malformed storage", () => {
    expect(parsePermitLines(JSON.stringify(["I-10 W", "US-98 N"]))).toEqual(["I-10 W", "US-98 N"]);
    expect(parsePermitLines("not json")).toEqual([]);
    expect(parsePermitLines(JSON.stringify({ a: 1 }))).toEqual([]);
    expect(parsePermitLines(JSON.stringify(["ok", 5, null]))).toEqual(["ok"]);
    expect(parsePermitLines(null)).toEqual([]);
    expect(parsePermitLines("")).toEqual([]);
  });
  test("cleanPermitLines trims and drops blanks without rewording", () => {
    expect(cleanPermitLines(["  I-10 W  ", "", "   ", "US-98 N"])).toEqual(["I-10 W", "US-98 N"]);
    expect(cleanPermitLines(["a", "b"], 1)).toEqual(["a"]);
  });
  test("linesFromTextBlock splits one entry per line", () => {
    expect(linesFromTextBlock("I-10 W\nUS-98 N\r\n\nAL-158 E")).toEqual(["I-10 W", "US-98 N", "AL-158 E"]);
    expect(linesFromTextBlock("")).toEqual([]);
  });
});

describe("todayIsoInZone", () => {
  test("judges the window on the driver's local day", () => {
    // 2026-11-05T04:30Z is still Nov 4 in Chicago (CST, UTC-6).
    const ms = Date.UTC(2026, 10, 5, 4, 30);
    expect(todayIsoInZone(ms, "America/Chicago")).toBe("2026-11-04");
    expect(todayIsoInZone(ms, "UTC")).toBe("2026-11-05");
  });
  test("an unusable zone falls back to UTC instead of throwing", () => {
    const ms = Date.UTC(2026, 10, 5, 4, 30);
    expect(todayIsoInZone(ms, "Not/AZone")).toBe("2026-11-05");
  });
});
