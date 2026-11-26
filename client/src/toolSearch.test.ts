// toolSearch tests — the by-name directory filter (2026-11-25
// UX package C). Pins: empty query finds nothing (the surfaces
// render the groups instead), matching is case-insensitive, both
// the English and Spanish names match, and every hit is a real
// directory item carrying its real group.
import { describe, expect, test } from "bun:test";
import { TOOL_GROUPS } from "./toolDirectory";
import { filterToolItems } from "./toolSearch";

describe("filterToolItems", () => {
  test("an empty or blank query returns no hits", () => {
    expect(filterToolItems("")).toEqual([]);
    expect(filterToolItems("   ")).toEqual([]);
  });

  test("matches by name, case-insensitively", () => {
    const hits = filterToolItems("FUEL");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.item.en.toLowerCase().includes("fuel") || h.item.es.toLowerCase().includes("fuel"))).toBe(true);
  });

  test("matches the Spanish name too", () => {
    const hits = filterToolItems("diésel");
    expect(hits.length).toBeGreaterThan(0);
  });

  test("every hit is a real directory item in its named group", () => {
    for (const hit of filterToolItems("pay")) {
      const group = TOOL_GROUPS.find((g) => g.id === hit.groupId);
      expect(group).toBeDefined();
      expect(group!.items).toContain(hit.item);
      expect(hit.groupEn).toBe(group!.en);
    }
  });

  test("a nonsense query finds nothing", () => {
    expect(filterToolItems("zzzzqqqq")).toEqual([]);
  });
});
