// toolDirectory.test.ts — the dashboard cleanup contract (2026-11-06).
//
// Pins the navigation shape x ordered: five plain-language groups,
// every named tool present exactly once with a real landing (a Meca
// destination Ask Meca's "Take me there" performs, or a direct sheet /
// anchor the More menu has always opened), and every label carried
// in the i18n catalogue so all five languages name the tool the
// same way the dashboard does.

import { describe, expect, test } from "bun:test";
import { ALL_TOOL_ITEMS, TOOL_GROUPS } from "./toolDirectory";
import { PAIRS, pairText } from "./i18n";

describe("tool directory — group structure", () => {
  test("exactly the five plain-language groups, in order", () => {
    expect(TOOL_GROUPS.map((g) => g.en)).toEqual([
      "Drive",
      "Loads & Money",
      "Truck & Trailer",
      "Records & Taxes",
      "More & Settings",
    ]);
    expect(TOOL_GROUPS.map((g) => g.id)).toEqual([
      "drive",
      "loads-money",
      "truck-trailer",
      "records-taxes",
      "more-settings",
    ]);
  });

  test("every item is fully labelled and lands somewhere real", () => {
    for (const item of ALL_TOOL_ITEMS) {
      expect(item.icon.length).toBeGreaterThan(0);
      expect(item.en.length).toBeGreaterThan(0);
      expect(item.es.length).toBeGreaterThan(0);
      expect(item.subEn.length).toBeGreaterThan(0);
      expect(item.subEs.length).toBeGreaterThan(0);
      // Exactly one landing: a Meca destination OR a direct opener.
      expect((item.dest ? 1 : 0) + (item.direct ? 1 : 0)).toBe(1);
    }
  });

  test("no duplicate item ids, and no duplicate labels inside a group", () => {
    const ids = ALL_TOOL_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of TOOL_GROUPS) {
      const labels = g.items.map((i) => i.en);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });
});

describe("tool directory — the brief's tool checklist", () => {
  // Every tool x's cleanup order named, by directory id. Each must be
  // present exactly once — reachable in at most two taps from Today
  // (Find-a-tool row or the More dock tab, then the tool's row).
  const REQUIRED = [
    "atlas",
    "satellite-tilt", // satellite/tilt controls — landing is the Drive map itself
    "trailer-tools", // trailer profile + all trailer tools
    "doc-expiry", // document expiry wallet
    "owed-board", // who-owes-me board
    "true-rate",
    "claims-log", // TONU / layover logger
    "ifta", // IFTA estimator
    "maintenance", // maintenance countdown
    "breakdown", // breakdown mode
    "route-weather", // route-ahead weather
    "facility-memory", // receiver memory
    "scale-tickets",
    "scale-finder", // Scales finder
    "tax-records", // tax categories + per-diem counter + TaxPanel
    "night-parking", // night parking layer
    "language", // language picker (Settings → Appearance)
  ];

  test("every required tool is in the directory exactly once", () => {
    for (const id of REQUIRED) {
      expect(ALL_TOOL_ITEMS.filter((i) => i.id === id).length).toBe(1);
    }
  });

  test("the trailer tools row names every trailer tool it opens", () => {
    const t = ALL_TOOL_ITEMS.find((i) => i.id === "trailer-tools");
    expect(t).toBeDefined();
    for (const word of ["profile", "cold-chain", "securement", "loaded height", "axle", "dock", "wind", "pre-trip"]) {
      expect(t!.subEn.toLowerCase()).toContain(word);
    }
  });

  test("the tax row names categories and the per-diem counter", () => {
    const t = ALL_TOOL_ITEMS.find((i) => i.id === "tax-records");
    expect(t!.subEn.toLowerCase()).toContain("tax categories");
    expect(t!.subEn.toLowerCase()).toContain("per-diem");
  });

  test("the satellite row says where the controls live (Layers & display)", () => {
    const t = ALL_TOOL_ITEMS.find((i) => i.id === "satellite-tilt");
    expect(t!.subEn).toContain("Layers & display");
    expect(t!.subEn).toContain("Drive map");
    expect(t!.dest).toBe("satellite_view");
  });

  test("the language row lands on the language destination", () => {
    const t = ALL_TOOL_ITEMS.find((i) => i.id === "language");
    expect(t!.dest).toBe("language");
    expect(t!.subEn).toContain("Settings → Appearance");
  });
});

describe("tool directory — one name per tool, in every language", () => {
  test("every group name and item label is catalogued in pt, ru, uk", () => {
    const names = [
      ...TOOL_GROUPS.map((g) => g.en),
      ...TOOL_GROUPS.map((g) => g.subEn),
      ...ALL_TOOL_ITEMS.map((i) => i.en),
    ];
    for (const en of names) {
      const entry = PAIRS[en];
      expect(entry, `PAIRS missing: ${en}`).toBeDefined();
      for (const lang of ["pt", "ru", "uk"] as const) {
        expect((entry?.[lang] ?? "").trim().length, `PAIRS ${lang} missing: ${en}`).toBeGreaterThan(0);
        expect(pairText(lang, en, "es-literal").length).toBeGreaterThan(0);
      }
    }
  });
});
