// globalSearch.test.ts — pure-rule tests for the global search
// (Alvys-grab build): normalization, the load-number match, and
// the per-group cap. The scoping + rate-law integration coverage
// lives in alvysGrabFlow.test.ts.

import { describe, expect, test } from "bun:test";
import {
  SEARCH_GROUP_CAP,
  capSearchGroup,
  cleanSearchQuery,
  normalizeSearchText,
  searchFieldsMatch,
  searchLoadIdMatch,
} from "./globalSearch";

describe("normalizeSearchText", () => {
  test("lowercases, thins punctuation to spaces, collapses whitespace", () => {
    expect(normalizeSearchText("  Fort-Worth,  TX! ")).toBe("fort worth tx");
    expect(normalizeSearchText("REF-100/A")).toBe("ref 100 a");
    expect(normalizeSearchText(null)).toBe("");
    expect(normalizeSearchText(undefined)).toBe("");
  });
});

describe("cleanSearchQuery", () => {
  test("too short or too long is refused, never silently widened", () => {
    expect(cleanSearchQuery("")).toBeNull();
    expect(cleanSearchQuery(" a ")).toBeNull();
    expect(cleanSearchQuery("x".repeat(81))).toBeNull();
  });
  test("a usable query returns the normalized form + the raw text", () => {
    const c = cleanSearchQuery("  Acme Steel ");
    expect(c?.query).toBe("acme steel");
    expect(c?.raw).toBe("Acme Steel");
  });
});

describe("searchFieldsMatch", () => {
  test("substring over normalized fields; null fields skipped", () => {
    expect(searchFieldsMatch("acme", ["Acme Steel", null])).toBe(true);
    expect(searchFieldsMatch("fort worth", ["Fort-Worth, TX"])).toBe(true);
    expect(searchFieldsMatch("zebra", ["Acme Steel", null, undefined])).toBe(false);
    expect(searchFieldsMatch("", ["Acme Steel"])).toBe(false);
  });
});

describe("searchLoadIdMatch", () => {
  test("the full number, bare or #-prefixed — never a prefix of it", () => {
    expect(searchLoadIdMatch("1048", 1048)).toBe(true);
    expect(searchLoadIdMatch("#1048", 1048)).toBe(true);
    expect(searchLoadIdMatch("load #1048", 1048)).toBe(false); // the number must be the whole query
    expect(searchLoadIdMatch("104", 1048)).toBe(false);
    expect(searchLoadIdMatch("10480", 1048)).toBe(false);
    expect(searchLoadIdMatch("acme", 1048)).toBe(false);
  });
});

describe("capSearchGroup", () => {
  test("caps at the group cap and reports the true total", () => {
    const items = Array.from({ length: SEARCH_GROUP_CAP + 5 }, (_, i) => i);
    const capped = capSearchGroup(items);
    expect(capped.items.length).toBe(SEARCH_GROUP_CAP);
    expect(capped.total).toBe(SEARCH_GROUP_CAP + 5);
    expect(capped.capped).toBe(true);
    const small = capSearchGroup([1, 2]);
    expect(small.capped).toBe(false);
    expect(small.total).toBe(2);
  });
});
