// workspaces.test.ts — the Ten Workspaces contract (x's orders,
// 2026-11-15: the app calls its areas WORKSPACES, matching the
// marketing — five headline doors first, then every feature area
// that stands on its own). Pins: exactly the ten workspaces in the
// canonical order (the driver's day), the names + taglines verbatim,
// exactly one real landing per door — a Meca destination id App's
// goMecaDest performs (the same ids the tool directory ships) or the
// calendar tab — a non-empty grouping list per door, and the reveal
// wiring that makes the hub-gated landings actually land (a door
// whose target lives behind a hub category/section needs the reveal
// registry to switch that category/section before the scroll).

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { WORKSPACES } from "./workspaces";
import { ALL_TOOL_ITEMS } from "./toolDirectory";

const appSource = readFileSync(`${import.meta.dir}/App.tsx`, "utf8");
const moneySource = readFileSync(`${import.meta.dir}/MoneyFlow.tsx`, "utf8");
const nextLevelSource = readFileSync(`${import.meta.dir}/NextLevel.tsx`, "utf8");

describe("ten workspaces — names and taglines", () => {
  test("exactly the ten, in canonical order, with the canonical wording", () => {
    expect(WORKSPACES.map((w) => w.name)).toEqual([
      "LOADS", "DRIVE", "PLANNER", "FUEL", "PAY", "RECORDS", "TRUCK", "SCHEDULE", "TEAM", "REWARDS",
    ]);
    expect(WORKSPACES.map((w) => w.tagEn)).toEqual([
      "find it, book it, haul it",
      "truck GPS, cab mode, hours clock",
      "plan the run: routes, parking, stops",
      "cheapest stops, true cost",
      "earned, owed, checked",
      "paperwork, sealed + proven",
      "your rig, kept ready",
      "calendar + home time",
      "messages, fleet + shares",
      "points for the work",
    ]);
    for (const w of WORKSPACES) {
      expect(w.icon.length).toBeGreaterThan(0);
      expect(w.tagEs.length).toBeGreaterThan(0);
    }
  });

  test("every door carries a non-empty grouping list", () => {
    for (const w of WORKSPACES) {
      expect(w.tools.length, w.id).toBeGreaterThan(0);
      for (const t of w.tools) expect(t.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("ten workspaces — landings", () => {
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

  test("no two doors share a landing", () => {
    const landings = WORKSPACES.map((w) => w.dest ?? `tab:${w.tab}`);
    expect(new Set(landings).size).toBe(landings.length);
  });
});

describe("ten workspaces — hub-gated landings actually land", () => {
  test("the Rewards door's anchor switches the Driver hub category first", () => {
    // points-lanes lives inside DriverPanel's Rewards category — the
    // element does not exist until the category shows. The hub must
    // register a reveal opener that flips the category (the Money
    // hub's anchor→section pattern, one hub over).
    expect(appSource).toContain('"points-lanes": "rewards"');
    expect(appSource).toContain("onAnchorReveal(anchor, () => setDrvCat(cat))");
  });

  test("the Truck door's anchor switches the Money hub section first", () => {
    // maintenance lives inside the Money hub's Truck section — the
    // anchor→section map must carry it, or the scroll lands nowhere.
    expect(moneySource).toContain('maintenance: "truck"');
  });

  test("the Records and Fuel doors' anchors are ExpandRow reveal targets", () => {
    // library-panel / ifta-panel live in folded rows on the Driver
    // tab — the rows must register those anchors as reveal ids.
    expect(appSource).toContain('revealIds={["library-panel", "doc-vault", "tax-records", "tax-worksheet"]}');
    expect(appSource).toContain('revealIds={["ifta-panel"]}');
  });

  test("the Drive door's reveal opens the Drive panel sheet", () => {
    // The Drive tab's panels live in a sheet that starts closed and
    // the workspace eyebrow is the sheet's first line — opening the
    // tab alone lands on the bare map. The jump must fire the
    // drive-panel reveal, App must register an opener that opens the
    // sheet, and the sheet content must carry the anchor id the
    // scroll lands on.
    expect(appSource).toContain('scrollToAnchor("drive-panel", 700)');
    expect(appSource).toContain('onAnchorReveal("drive-panel", () => { setTab("drive"); setDrivePanelOpen(true); })');
    expect(appSource).toContain('id="drive-panel"');
  });

  test("the Fuel door's reveal also opens the IFTA Complete section", () => {
    // ifta-panel opens the Driver-tab row, but the Fuel eyebrow is
    // the first line inside IftaPanel's own Section fold — the panel
    // must register a reveal opener for the same anchor that opens
    // that Section, and pass the Section controlled open state.
    expect(nextLevelSource).toContain('onAnchorReveal("ifta-panel", () => setSectionOpen(true))');
    expect(nextLevelSource).toContain("open={sectionOpen} onOpenChange={setSectionOpen}");
  });
});
