// Unit tests for auto-add stop selection (autoAddStops.ts) — the
// thin selection layer over the Fuel + Stop Planner engine. Every
// scenario runs the REAL planner (buildStopPlan + rankFuelStops)
// and checks what the selection layer does with its output.
// Run: bun test client/src/autoAddStops.test.ts
import { describe, expect, test } from "bun:test";
import {
  buildStopPlan,
  rankFuelStops,
  type PlanInput,
  type PlannerCandidate,
} from "./stopPlanner";
import { selectAutoAddStops } from "./autoAddStops";

const cand = (p: Partial<PlannerCandidate> & { alongMi: number }): PlannerCandidate => ({
  id: `c-${p.alongMi}`,
  name: `Stop ${p.alongMi}`,
  lat: 30,
  lon: -88,
  offRouteMi: 0.2,
  kind: "fuel",
  pricePerGal: null,
  priceLabel: null,
  parkingSpaces: null,
  truckParking: true,
  ...p,
});

const select = (input: PlanInput, over: Partial<{ enabled: boolean; permitLocked: boolean }> = {}) => {
  const plan = buildStopPlan(input);
  // Same ranking context the planner sheet uses (typical buy 80 gal).
  const ranked = rankFuelStops(
    input.candidates.map((c) => ({ ...c })),
    {
      effMpg: plan.effMpg,
      paceMph: input.paceMph,
      payPerMile: input.payPerMile,
      typicalBuyGal: 80,
      settingsTimeValuePerHour: input.settingsTimeValuePerHour ?? null,
    },
  );
  return {
    plan,
    sel: selectAutoAddStops({
      plan,
      ranked,
      routeMiles: input.routeMiles,
      enabled: over.enabled ?? true,
      permitLocked: over.permitLocked ?? false,
    }),
  };
};

const base: PlanInput = {
  routeMiles: 300,
  paceMph: 50,
  tankPct: 100,
  capacityGal: 200,
  baseMpg: 6,
  loadWeightLbs: 0,
  payPerMile: null,
  hos: { hasData: true, driveRemainH: 11, windowRemainH: 14, breakRemainH: 4 },
  candidates: [],
  driverStops: [],
};

describe("fuel — only when the planner's math says fuel is needed", () => {
  test("full tank covering the route: no fuel stop is added", () => {
    const { plan, sel } = select({
      ...base,
      candidates: [cand({ alongMi: 120 }), cand({ alongMi: 185 }), cand({ alongMi: 260 })],
    });
    // The planner itself says SKIP everywhere — nothing to add.
    expect(plan.fuelDecisions.every((d) => d.action === "SKIP")).toBe(true);
    expect(sel.stops.some((s) => s.kinds.includes("fuel"))).toBe(false);
  });

  test("fuel needed: the top true-cost FILL is picked, with the planner-priced saving", () => {
    const { plan, sel } = select({
      ...base,
      routeMiles: 800,
      tankPct: 30,
      capacityGal: 120,
      hos: { hasData: true, driveRemainH: 11, windowRemainH: 14, breakRemainH: 8 },
      candidates: [
        cand({ alongMi: 100, pricePerGal: 4.5, priceLabel: "map tag" }),
        cand({ alongMi: 400, pricePerGal: 3.5, priceLabel: "map tag" }),
        cand({ alongMi: 750, pricePerGal: 4.0, priceLabel: "map tag" }),
      ],
    });
    const fills = plan.fuelDecisions.filter((d) => d.action === "FILL" && d.buyGal > 0);
    expect(fills.length).toBeGreaterThan(0);
    const fuel = sel.stops.find((s) => s.kinds.includes("fuel"));
    expect(fuel).toBeDefined();
    // The $3.50 stop at mile 400 is the cheapest true-cost FILL.
    expect(fuel!.alongMi).toBe(400);
    expect(fuel!.pricePerGal).toBe(3.5);
    expect(fuel!.buyGal).toBeGreaterThan(0);
    // Saving ≈ (priciest other true cost − pick true cost) × gallons
    // bought: the $1.00/gal price gap, plus pennies of detour fuel in
    // the planner's true-cost numbers — about $67 on this buy.
    expect(fuel!.estSaving).toBeGreaterThan(60);
    expect(fuel!.estSaving!).toBeCloseTo(1.0 * fuel!.buyGal!, 0);
  });

  test("single priced fuel stop: no saving is invented", () => {
    const { sel } = select({
      ...base,
      routeMiles: 400,
      tankPct: 22,
      capacityGal: 150,
      candidates: [cand({ alongMi: 190, name: "FuelNearBreak", pricePerGal: 3.8, priceLabel: "map tag" })],
    });
    const fuel = sel.stops.find((s) => s.kinds.includes("fuel"));
    expect(fuel).toBeDefined();
    expect(fuel!.estSaving).toBeNull();
  });
});

describe("break — timed off the HOS break clock", () => {
  test("break stop lands at or before the break deadline", () => {
    const { plan, sel } = select({
      ...base,
      candidates: [cand({ alongMi: 120 }), cand({ alongMi: 185 }), cand({ alongMi: 260 })],
    });
    const brk = sel.stops.find((s) => s.kinds.includes("break"));
    expect(brk).toBeDefined();
    expect(brk!.alongMi).toBe(185);
    expect(brk!.alongMi).toBeLessThanOrEqual(plan.breakDueMi!);
  });

  test("break folds into the fuel stop when they line up — one waypoint, both jobs", () => {
    const { plan, sel } = select({
      ...base,
      routeMiles: 400,
      tankPct: 22,
      capacityGal: 150,
      candidates: [cand({ alongMi: 190, name: "FuelNearBreak", pricePerGal: 3.8, priceLabel: "map tag" })],
    });
    expect(plan.breakPick?.combinedWithFuel).toBe(true);
    const atStop = sel.stops.filter((s) => s.alongMi === 190);
    expect(atStop.length).toBe(1);
    expect(atStop[0]!.kinds).toContain("fuel");
    expect(atStop[0]!.kinds).toContain("break");
    expect(atStop[0]!.combinedWithFuel).toBe(true);
  });

  test("break deadline past the destination: no break waypoint is added", () => {
    const { sel } = select({
      ...base,
      hos: { hasData: true, driveRemainH: 11, windowRemainH: 14, breakRemainH: 8 },
      candidates: [cand({ alongMi: 120 }), cand({ alongMi: 260 })],
    });
    // Break due at 8h × 50 mph = 400 mi, route is 300 — the driver
    // arrives inside the break clock, so nothing is owed en route.
    expect(sel.stops.some((s) => s.kinds.includes("break"))).toBe(false);
  });
});

describe("rest — the 10-hour clock-restart stop", () => {
  test("rest stop is placed before the 11/14 clocks run out", () => {
    const { plan, sel } = select({
      ...base,
      routeMiles: 700,
      hos: { hasData: true, driveRemainH: 6, windowRemainH: 14, breakRemainH: 8 },
      driverStops: [
        { id: "r150", name: "Rest 150", lat: 30, lon: -88, alongMi: 150, kind: "rest" },
        { id: "r280", name: "Rest 280", lat: 30, lon: -88, alongMi: 280, kind: "rest" },
        { id: "r400", name: "Rest 400", lat: 30, lon: -88, alongMi: 400, kind: "rest" },
      ],
    });
    const rest = sel.stops.find((s) => s.kinds.includes("rest"));
    expect(rest).toBeDefined();
    expect(rest!.name).toBe("Rest 280");
    expect(rest!.alongMi).toBeLessThanOrEqual(plan.dayDueMi!);
  });

  test("day outlasts the route: no rest waypoint is added", () => {
    const { sel } = select({
      ...base,
      candidates: [cand({ alongMi: 120 }), cand({ alongMi: 260 })],
    });
    // 11h drive / 14h window at 50 mph = 550 mi of day on a 300-mi
    // route — the destination is reached inside the clocks.
    expect(sel.stops.some((s) => s.kinds.includes("rest"))).toBe(false);
  });
});

describe("guards", () => {
  const richInput: PlanInput = {
    ...base,
    routeMiles: 800,
    tankPct: 30,
    capacityGal: 120,
    hos: { hasData: true, driveRemainH: 11, windowRemainH: 14, breakRemainH: 8 },
    candidates: [
      cand({ alongMi: 100, pricePerGal: 4.5, priceLabel: "map tag" }),
      cand({ alongMi: 400, pricePerGal: 3.5, priceLabel: "map tag" }),
      cand({ alongMi: 750, pricePerGal: 4.0, priceLabel: "map tag" }),
    ],
  };

  test("setting OFF produces no auto-add (suggestions only, as before)", () => {
    const { sel } = select(richInput, { enabled: false });
    expect(sel.skipped).toBe("off");
    expect(sel.stops).toEqual([]);
  });

  test("permit-locked route is skipped entirely", () => {
    const { sel } = select(richInput, { permitLocked: true });
    expect(sel.skipped).toBe("permit");
    expect(sel.stops).toEqual([]);
  });

  test("same rich plan with the setting on and no permit lock DOES add stops", () => {
    const { sel } = select(richInput);
    expect(sel.skipped).toBeNull();
    expect(sel.stops.length).toBeGreaterThan(0);
  });
});
