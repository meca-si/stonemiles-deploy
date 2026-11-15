// Pins the DQF surfaces (Wave 2 item 6): the fleet qualification
// board must render in BOTH desks (owner + dispatch — the two
// seats that fix files and feel the dispatch hold), and the
// driver's own file must render in the Money tab beside the
// credential wallet. The panel itself must call the DQF actions
// and must never compute a verdict client-side — it renders the
// server's evaluation (dqf.ts) only.
//
// Run: bun test client/src/dqfPanelPin.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const panel = readFileSync(`${import.meta.dir}/DqfPanel.tsx`, "utf8");
const ownerDesk = readFileSync(`${import.meta.dir}/OwnerDesk.tsx`, "utf8");
const dispatchDesk = readFileSync(`${import.meta.dir}/DispatchDesk.tsx`, "utf8");
const moneyFlow = readFileSync(`${import.meta.dir}/MoneyFlow.tsx`, "utf8");

describe("DQF panel wiring (Wave 2 item 6)", () => {
  test("the fleet board renders in the Owner Desk and the Dispatch Desk", () => {
    expect(ownerDesk).toContain("<FleetDqfPanel />");
    expect(dispatchDesk).toContain("<FleetDqfPanel />");
  });

  test("the driver's own file renders in the Money tab", () => {
    expect(moneyFlow).toContain("<MyDqfCard />");
  });

  test("the panel drives the DQF actions", () => {
    for (const action of ["getDqfFile", "saveDqfEntry", "voidDqfEntry", "verifyDqfMedical", "getFleetDqf", "dismissDqfAlert", "getDqfEntryDoc", "getLibraryDocument"]) {
      expect(panel).toContain(`.${action}(`);
    }
  });

  test("the audit packet goes through the Library doors with an as-of date", () => {
    expect(panel).toContain("dqf:${data.fileId}:${asOf}");
  });

  test("the panel states the medical honesty rule in plain words", () => {
    expect(panel).toContain("A paper medical card isn't proof on its own anymore");
    expect(panel).toContain("The app never looks a driver up itself.");
  });
});
