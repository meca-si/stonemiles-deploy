// Pins the inspections-by-the-HOS-clock build (2026-11-15):
//   (a) the Pre-trip / Post-trip buttons sit on the Drive view
//       immediately after the HOS clocks panel, before the auto-log
//       card — one tap from the clock, no tab hunting;
//   (b) the auto-flow wiring: the App asks the server for the due
//       prompt and opens the DVIR checklist with the kind preselected;
//       a saved DVIR and a duty change both re-ask;
//   (c) the On Duty → Pre-trip → Drive flow: the DVIR panel offers
//       Drive after a pre-trip seals;
//   (d) duty remarks: the quick-pick list (Fuel included) lives in
//       the duty buttons' remark row, shared with the Driver panel,
//       and the client keys agree with the server's dutyRemarks.ts;
//   (e) the log view renders the remark + the city/state stamp;
//   (f) the 30-minute break clock counts DRIVING time only
//       (49 CFR 395.3(a)(3)(ii)) — the HOS engine accumulates the
//       break clock under driving segments and resets it on any
//       >= 30 min non-driving stretch. (The reckoning lived inline
//       in App.tsx's computeHos when this pin was written; the
//       regulatory audit build A3/A10 extracted it into
//       client/src/hosEngine.ts — the pin follows the code.)
//
// Run: bun test client/src/inspectionPlacementPin.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const appSource = readFileSync(`${import.meta.dir}/App.tsx`, "utf8");
const nextSource = readFileSync(`${import.meta.dir}/NextLevel.tsx`, "utf8");
const engineSource = readFileSync(`${import.meta.dir}/hosEngine.ts`, "utf8");
const serverRemarks = readFileSync(`${import.meta.dir}/../../server/src/dutyRemarks.ts`, "utf8");

describe("inspection buttons beside the Drive HOS clocks", () => {
  test("(a) both buttons render after the Drive clocks panel and before the auto-log card", () => {
    const clocksAt = appSource.indexOf("<HosClocksPanel hos={hos} onOpenFull");
    const preAt = appSource.indexOf('aria-label="Start pre-trip inspection"');
    const postAt = appSource.indexOf('aria-label="Start post-trip inspection"');
    const autoLogAt = appSource.indexOf("<AutoLogCard", clocksAt);
    expect(clocksAt).toBeGreaterThan(-1);
    expect(preAt).toBeGreaterThan(clocksAt);
    expect(postAt).toBeGreaterThan(preAt);
    expect(autoLogAt).toBeGreaterThan(postAt);
  });
  test("(a) the buttons open the DVIR flow with the kind preselected", () => {
    expect(appSource).toContain('openDvirChecklist("pretrip")');
    expect(appSource).toContain('openDvirChecklist("posttrip")');
  });
  test("(a) a due-prompt strip with Start + Skip rides under the buttons", () => {
    expect(appSource).toContain("inspectionPrompt");
    expect(appSource).toContain("skipInspectionPrompt");
    expect(appSource).toContain("Start it");
  });
});

describe("auto-flow wiring", () => {
  test("(b) the App asks for the due prompt and auto-opens the checklist once per prompt", () => {
    expect(appSource).toContain('queryKey: ["inspection-prompts"]');
    expect(appSource).toContain("api.getInspectionPrompts");
    expect(appSource).toContain("dismissInspectionPrompt({ kind, key })");
  });
  test("(b) duty changes and DVIR saves re-ask for the prompt", () => {
    expect(appSource.split('invalidateQueries({ queryKey: ["inspection-prompts"] })').length).toBeGreaterThan(2);
    expect(nextSource).toContain('invalidateQueries({ queryKey: ["inspection-prompts"] })');
  });
  test("(c) after a pre-trip seals, the DVIR panel offers Drive — the flow's last step", () => {
    expect(nextSource).toContain('aria-label="Start driving — pre-trip complete"');
    expect(nextSource).toContain("On Duty → Pre-trip → Drive");
    expect(nextSource).toContain('remarkNote: "Rolling — pre-trip complete"');
  });
});

describe("duty remarks — quick-picks on every switch", () => {
  test("(d) the remark row carries all eight quick-picks, Fuel included", () => {
    for (const label of [
      "Pre-trip inspection", "Fuel", "Loading", "Unloading",
      "Post-trip inspection", "Break / Rest", "Personal", "Other",
    ]) {
      expect(appSource).toContain(`label: "${label}"`);
    }
    expect(appSource).toContain("function DutyRemarkRow");
    expect(appSource).toContain("function DutyButtons");
  });
  test("(d) the client quick-pick keys agree with the server's list", () => {
    const serverKeys = [...serverRemarks.matchAll(/^\s*"([a-z]+)",$/gm)].map((m) => m[1]);
    const clientBlock = appSource.slice(appSource.indexOf("const DUTY_REMARKS"), appSource.indexOf("type DutyRemarkKey"));
    const clientKeys = [...clientBlock.matchAll(/key: "([a-z]+)"/g)].map((m) => m[1]);
    expect(clientKeys.length).toBe(8);
    expect(clientKeys).toEqual(serverKeys);
  });
  test("(d) the place resolver derives city/state the app's usual way, raced so a change never waits", () => {
    expect(appSource).toContain("resolveDutyPlace");
    expect(appSource).toContain("fetchCityState(pos)");
    expect(appSource).toContain('localStorage.getItem("tgps-current-state")');
  });
  test("(e) the log view renders the remark and prefers the city/state stamp", () => {
    expect(appSource).toContain("Remark:");
    expect(appSource).toContain("dutyRemarkLabel(ev.remark)");
    expect(appSource).toContain("[ev.city, ev.usState].filter(Boolean).join(\", \")");
    expect(appSource).toContain("system default");
  });
});

describe("the 30-minute break counts driving time only", () => {
  test("(f) the HOS engine accumulates the break clock under driving segments only", () => {
    const start = engineSource.indexOf("const breakRemainH = Math.max(0, 8 - drivingSinceBreak / H);");
    expect(start).toBeGreaterThan(-1);
    const block = engineSource.slice(engineSource.lastIndexOf("let drivingSinceBreak = 0;", start), start);
    expect(block).toContain('if (s.state === "driving")');
    expect(block).toContain("drivingSinceBreak += s.end - s.start;");
    expect(block).toContain("nonDriveRun += s.end - s.start;");
    expect(block).toContain("if (nonDriveRun >= 0.5 * H) drivingSinceBreak = 0;");
    // And App.tsx's clocks really run on that engine (A3/A10).
    expect(appSource).toContain("hosClocksFromEvents(events, nowMs, cycleType)");
  });
});
