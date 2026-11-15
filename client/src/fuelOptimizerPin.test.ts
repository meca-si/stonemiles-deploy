// fuelOptimizerPin.test.ts — source pins for the route fuel
// plan + fuel-card geofence checks (Wave 2 item 8) in the
// client: the plan panel mounts inside the Diamond Net-Price
// Fuel Planner section, the checks panel mounts in the IFTA
// panel under the fuel log, and the exception queue renders a
// fuel flag as a fuel purchase, not a load. Same substring-pin
// style as factoringPin.test.ts — these pin the SURFACES plus
// the honesty lines that must stay attached to them.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (rel: string) => readFileSync(path.join(import.meta.dir, rel), "utf8");

const app = read("App.tsx");
const planPanel = read("FuelPlanPanel.tsx");
const cardPanel = read("FuelCardPanel.tsx");
const nextLevel = read("NextLevel.tsx");
const autonomyPanel = read("AutonomyPanel.tsx");

describe("Route fuel plan — mounted in the Diamond planner, honestly labelled", () => {
  test("the panel is defined and mounted in App's planner section with the corridor props", () => {
    expect(planPanel).toContain("export function RouteFuelPlanPanel(");
    expect(planPanel).toContain("api.planFuelStops(");
    expect(app).toContain("<RouteFuelPlanPanel");
    expect(app).toContain('from "./FuelPlanPanel"');
    expect(app).toContain("stopPriceById.get(s.id)");
  });

  test("the honesty lines stay attached: estimates labelled, savings labelled, rates stamped", () => {
    expect(planPanel).toContain("Every price below is an estimate");
    expect(planPanel).toContain("Estimated saving from the ex-tax plan");
    expect(planPanel).toContain("an estimate, figured from the same price estimates above");
    expect(planPanel).toContain("result.ratesLabel");
    expect(planPanel).toContain("result.ratesAsOf");
    expect(planPanel).toContain("cost never guessed");
    expect(planPanel).not.toContain("live feed,");
  });
});

describe("Fuel-card checks — mounted under the fuel log, check-it copy only", () => {
  test("the panel is defined and mounted in the IFTA panel", () => {
    expect(cardPanel).toContain("export function FuelCardChecksPanel(");
    expect(cardPanel).toContain("api.getFuelCardChecks(");
    expect(nextLevel).toContain("<FuelCardChecksPanel />");
    expect(nextLevel).toContain('from "./FuelCardPanel"');
    expect(nextLevel).toContain("<FuelLogForm setBanner={setBanner} />");
  });

  test("the copy says possible mismatch and check it — never fraud, never a decline", () => {
    expect(cardPanel).toContain("possible mismatch — check it");
    expect(cardPanel).toContain("Possible mismatch — check it");
    expect(cardPanel).toContain("Nothing is ever declined, blocked, or");
    expect(cardPanel).toContain("No fuel-card partner connected");
    expect(cardPanel.toLowerCase()).not.toContain("fraud");
    expect(cardPanel.toLowerCase()).not.toContain("stolen");
  });

  test("an uncheckable purchase is never shown as a pass", () => {
    expect(cardPanel).toContain("Not checked");
    expect(cardPanel).toContain("never as a silent pass");
  });
});

describe("Exception queue — a fuel flag reads as a fuel purchase, not a load", () => {
  test("the card header special-cases fuel_card_mismatch", () => {
    expect(autonomyPanel).toContain('item.kind === "fuel_card_mismatch"');
    expect(autonomyPanel).toContain("Fuel purchase #${item.loadId}");
    expect(autonomyPanel).toContain("Fuel card purchase — ${item.kindLabel}");
  });
});
