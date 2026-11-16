// workspaces.test.ts — the Five Workspaces contract (x's order,
// 2026-11-15: the app calls its five areas WORKSPACES, matching the
// marketing). Pins: exactly the five workspaces in the Reel's order,
// the Reel card's names + taglines verbatim, and exactly one real
// landing per door — a Meca destination id App's goMecaDest performs
// (the same ids the tool directory ships) or the calendar tab.

import { describe, expect, test } from "bun:test";
import { WORKSPACES } from "./workspaces";
import { ALL_TOOL_ITEMS } from "./toolDirectory";

describe("five workspaces — names and taglines", () => {
  test("exactly the five, in the Reel's order, with the Reel's wording", () => {
    expect(WORKSPACES.map((w) => w.name)).toEqual(["PAY", "FUEL", "PLANNER", "SCHEDULE", "REWARDS"]);
    expect(WORKSPACES.map((w) => w.tagEn)).toEqual([
      "earned, owed, checked",
      "cheapest stops, true cost",
      "routes + next load",
      "calendar + home time",
      "points for the work",
    ]);
    for (const w of WORKSPACES) {
      expect(w.icon.length).toBeGreaterThan(0);
      expect(w.tagEs.length).toBeGreaterThan(0);
    }
  });
});

describe("five workspaces — landings", () => {
  test("every door has exactly one landing, and dests are real Meca destinations", () => {
    const knownDests = new Set(ALL_TOOL_ITEMS.map((i) => i.dest).filter(Boolean));
    for (const w of WORKSPACES) {
      expect((w.dest ? 1 : 0) + (w.tab ? 1 : 0), w.id).toBe(1);
      if (w.dest) expect(knownDests.has(w.dest as never), `${w.id} → ${w.dest}`).toBe(true);
    }
    // The Schedule door opens the calendar tab itself — the
    // workspace's home is a top-level tab, not a panel.
    expect(WORKSPACES.find((w) => w.id === "schedule")?.tab).toBe("calendar");
  });
});
