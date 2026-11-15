// Pins the safety & equipment surfaces (Wave 2 item 11): the
// driver's coaching / fault-code / smart-trailer card renders in
// the Money tab beside the DQF and home-time cards, and the fleet
// safety board renders in BOTH desks (owner + dispatch — the two
// seats that coach). The panel must drive the item-11 actions,
// must label simulated data wherever it shows, must say plainly
// when no partner is connected, and must never carry a money
// figure or a score — patterns are counts and dates, positions
// print their age, fault meanings come from the server's table.
//
// Run: bun test client/src/safetyEquipmentPin.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const panel = readFileSync(`${import.meta.dir}/SafetyEquipmentPanel.tsx`, "utf8");
const ownerDesk = readFileSync(`${import.meta.dir}/OwnerDesk.tsx`, "utf8");
const dispatchDesk = readFileSync(`${import.meta.dir}/DispatchDesk.tsx`, "utf8");
const moneyFlow = readFileSync(`${import.meta.dir}/MoneyFlow.tsx`, "utf8");

describe("safety & equipment panel wiring (Wave 2 item 11)", () => {
  test("the fleet safety board renders in the Owner Desk and the Dispatch Desk", () => {
    expect(ownerDesk).toContain("<FleetSafetyPanel />");
    expect(dispatchDesk).toContain("<FleetSafetyPanel />");
  });

  test("the driver's safety card renders in the Money tab", () => {
    expect(moneyFlow).toContain("<MySafetyCard />");
    expect(moneyFlow).toContain('id="my-safety"');
  });

  test("the panel drives the item-11 actions", () => {
    for (const action of [
      "getDashcamPanel",
      "createDashcamConnection",
      "revokeDashcamConnection",
      "runDashcamTestEvent",
      "noteDashcamEvent",
      "reviewDashcamEvent",
      "pinExoneration",
      "removeExoneration",
      "getFaultCodes",
      "reportFaultCode",
      "getTrailerTelemetry",
      "connectTrailerDevice",
      "revokeTrailerDevice",
      "syncTrailerDevice",
      "runTrailerTestReadings",
      "setLoadReeferRange",
      "getFleetSafety",
      "getLibraryDocument",
    ]) {
      expect(panel).toContain(`.${action}(`);
    }
  });

  test("simulated data is labelled wherever it can appear", () => {
    expect(panel).toContain("SIMULATED");
    expect(panel).toContain("stamped SIMULATED");
  });

  test("an unconfigured partner reads plainly, never as live", () => {
    expect(panel).toContain("No dashcam partner is connected yet");
    expect(panel).toContain("No trailer partner is connected yet");
  });

  test("patterns are facts only — counts and dates, no scores", () => {
    expect(panel).toContain("Counts and dates only");
    expect(panel.toLowerCase()).not.toContain("safety score");
    expect(panel.toLowerCase()).not.toContain("driver score");
  });

  test("trailer position prints its freshness, never upgraded", () => {
    expect(panel).toContain("not a live position");
    expect(panel).not.toContain("Live position");
  });

  test("unknown fault codes carry the no-invented-meaning line", () => {
    expect(panel).toContain("no invented meaning");
    expect(panel).toContain("no plain-language entry for it yet");
  });

  test("the webhook secret is shown once and labelled so", () => {
    expect(panel).toContain("shown only this once");
    expect(panel).toContain("shown once");
  });

  test("no money figures anywhere in the panel", () => {
    expect(panel.toLowerCase()).not.toContain("usd");
    expect(panel.toLowerCase()).not.toContain("dollar");
    expect(panel.toLowerCase()).not.toContain("price");
    expect(panel.toLowerCase()).not.toContain("split");
    expect(panel.toLowerCase()).not.toContain("fee");
  });
});
