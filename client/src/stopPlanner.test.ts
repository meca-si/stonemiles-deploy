// Unit tests for the Fuel + Stop Planner math (stopPlanner.ts).
// Run: bun test client/src/stopPlanner.test.ts
import { describe, expect, test } from "bun:test";
import {
  buildStopPlan,
  effectiveMpg,
  ELD_ADAPTERS,
  eldAdapterFor,
  loadBurnFactor,
  rankFuelStops,
  resolveEldSlot,
  resolveTankReading,
  resolveTimeValue,
  tankPctAfterMiles,
  tankSourceLabel,
  usableRangeMi,
  type EldFuelReading,
  type PlannerCandidate,
} from "./stopPlanner";

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

describe("burn estimate — load weight effect", () => {
  test("empty truck burns at profile MPG; full load burns 20% more per mile", () => {
    expect(loadBurnFactor(0)).toBe(1);
    expect(loadBurnFactor(null)).toBe(1);
    expect(loadBurnFactor(45000)).toBeCloseTo(1.2, 6);
    expect(loadBurnFactor(90000)).toBeCloseTo(1.2, 6); // capped
    expect(effectiveMpg(6, 0)).toBe(6);
    expect(effectiveMpg(6, 45000)).toBeCloseTo(5, 6);
  });
  test("tank drops faster loaded than empty over the same miles", () => {
    const empty = tankPctAfterMiles(100, 300, 150, 6, 0); // 50 gal burned
    const loaded = tankPctAfterMiles(100, 300, 150, 6, 45000); // 60 gal burned
    expect(empty).toBeCloseTo(66.7, 1);
    expect(loaded).toBeCloseTo(60, 1);
    expect(loaded).toBeLessThan(empty);
  });
  test("range respects the reserve floor", () => {
    // 50% of 150 gal = 75 gal; reserve 12% = 18 gal; usable 57 gal @ 6 mpg = 342 mi
    expect(usableRangeMi(50, 150, 6, 0, 12)).toBeCloseTo(342, 0);
  });
});

describe("tank source honesty", () => {
  const base = { manualPct: 80, milesSinceManualEntry: 0, capacityGal: 150, baseMpg: 6, loadWeightLbs: null };
  test("no ELD reading -> estimate, labelled no ELD linked", () => {
    const r = resolveTankReading({ ...base, eldFuelPct: null, eldConnected: false });
    expect(r.source).toBe("estimate");
    expect(tankSourceLabel(r)).toBe("Estimate — no ELD linked");
  });
  test("a real ELD reading is used and labelled ELD live", () => {
    const r = resolveTankReading({ ...base, eldFuelPct: 42.4, eldConnected: true });
    expect(r.source).toBe("eld");
    expect(r.pct).toBe(42.4);
    expect(tankSourceLabel(r)).toBe("ELD live");
  });
  test("connected ELD with no feed still estimates — and says so", () => {
    const r = resolveTankReading({ ...base, eldFuelPct: null, eldConnected: true });
    expect(r.source).toBe("estimate");
    expect(tankSourceLabel(r)).toContain("no fuel feed");
  });
  test("estimate burns down from the manual entry by GPS miles", () => {
    const r = resolveTankReading({ ...base, eldFuelPct: null, eldConnected: false, milesSinceManualEntry: 150 });
    expect(r.pct).toBeCloseTo(63.3, 1); // 25 gal of 150
  });
});

describe("ELD connection layer — provider-agnostic, Motive first (x, 2026-11-01)", () => {
  const reading = (pct: number): EldFuelReading => ({ vehicleId: "trk-1", fuelLevelPct: pct, receivedAt: "2026-11-01T20:00:00Z" });
  const tankBase = { manualPct: 80, milesSinceManualEntry: 0, capacityGal: 150, baseMpg: 6, loadWeightLbs: null };

  test("registry: Motive is the first adapter; Samsara and Geotab slot into the same shape", () => {
    expect(ELD_ADAPTERS[0]?.key).toBe("motive");
    expect(ELD_ADAPTERS.map((a) => a.key)).toEqual(["motive", "samsara", "geotab"]);
    for (const a of ELD_ADAPTERS) {
      expect(a.reads.fuelLevel).toBe(true);
      expect(a.reads.hosClocks).toBe("future"); // declared on the interface, not built
      expect(a.reads.odometer).toBe("future");
      expect(a.reads.identity).toBe("future"); // on-connect identity pull (spec §6) — shape in eldIdentity.ts
    }
    expect(eldAdapterFor("motive")?.name).toBe("Motive");
    expect(eldAdapterFor(null)).toBeNull();
  });

  test("not linked: the slot is 'ELD — not linked' and the tank takes the estimate path with its honest label", () => {
    const slot = resolveEldSlot({ adapterKey: "motive", linked: false, reading: null });
    expect(slot.linkState).toBe("not_linked");
    expect(slot.label).toBe("ELD — not linked");
    expect(slot.fuelPct).toBeNull();
    const tank = resolveTankReading({
      ...tankBase,
      eldFuelPct: slot.fuelPct,
      eldConnected: false,
      eldProviderName: slot.adapter?.name ?? null,
    });
    expect(tank.source).toBe("estimate");
    expect(tank.pct).toBe(80); // the manual entry, untouched by any ELD claim
    expect(tankSourceLabel(tank)).toBe("Estimate — no ELD linked");
  });

  test("no code path produces a provider fuel % without a linked feed", () => {
    // A reading object handed in with NO link is disregarded — not linked wins.
    const unlinked = resolveEldSlot({ adapterKey: "motive", linked: false, reading: reading(57) });
    expect(unlinked.linkState).toBe("not_linked");
    expect(unlinked.fuelPct).toBeNull();
    // Linked but junk readings are no feed, never clamped into a number.
    for (const junk of [Number.NaN, -5, 140]) {
      const slot = resolveEldSlot({ adapterKey: "motive", linked: true, reading: reading(junk) });
      expect(slot.linkState).toBe("linked_no_feed");
      expect(slot.fuelPct).toBeNull();
    }
  });

  test("linked, no feed yet: estimate path, provider named, label says no feed received", () => {
    const slot = resolveEldSlot({ adapterKey: "motive", linked: true, reading: null });
    expect(slot.linkState).toBe("linked_no_feed");
    expect(slot.fuelPct).toBeNull();
    expect(slot.label).toContain("Motive");
    const tank = resolveTankReading({
      ...tankBase,
      eldFuelPct: slot.fuelPct,
      eldConnected: true,
      eldProviderName: slot.adapter?.name ?? null,
    });
    expect(tank.source).toBe("estimate");
    expect(tankSourceLabel(tank)).toBe("Estimate — Motive linked, no fuel feed received yet");
  });

  test("linked + a real reading: live for EVERY adapter with the same planner path — provider named in the label", () => {
    for (const [key, name] of [
      ["motive", "Motive"],
      ["samsara", "Samsara"],
      ["geotab", "Geotab"],
    ] as const) {
      const slot = resolveEldSlot({ adapterKey: key, linked: true, reading: reading(57.5) });
      expect(slot.linkState).toBe("live");
      expect(slot.fuelPct).toBe(57.5);
      expect(slot.label).toBe(`ELD live — ${name}`);
      const tank = resolveTankReading({
        ...tankBase,
        eldFuelPct: slot.fuelPct,
        eldConnected: true,
        eldProviderName: slot.adapter?.name ?? null,
      });
      expect(tank.source).toBe("eld");
      expect(tank.pct).toBe(57.5);
      expect(tankSourceLabel(tank)).toBe(`ELD live — ${name}`);
    }
    // Even an unregistered future provider resolves through the same
    // interface — the planner does not change per provider.
    const future = resolveEldSlot({ adapterKey: "somefutureeld", linked: true, reading: reading(41) });
    expect(future.linkState).toBe("live");
    expect(future.label).toBe("ELD live — somefutureeld");
  });
});

describe("splash vs fill", () => {
  const input = {
    routeMiles: 600,
    paceMph: 50,
    tankPct: 30, // 45 gal of 150
    capacityGal: 150,
    baseMpg: 6,
    loadWeightLbs: 0,
    payPerMile: 2.5,
    hos: { hasData: false, driveRemainH: 11, windowRemainH: 14, breakRemainH: 8 },
    driverStops: [],
  };
  test("splash at the pricey stop when cheaper fuel is reachable ahead", () => {
    const plan = buildStopPlan({
      ...input,
      candidates: [
        cand({ alongMi: 60, name: "Pricey", pricePerGal: 4.2, priceLabel: "map tag" }),
        cand({ alongMi: 200, name: "Cheap", pricePerGal: 3.6, priceLabel: "map tag" }),
      ],
    });
    const pricey = plan.fuelDecisions.find((d) => d.stop.name === "Pricey");
    expect(pricey?.action).toBe("SPLASH");
    expect(pricey!.buyGal).toBeGreaterThan(0);
    // Splash buys just enough to reach Cheap with the reserve — not a fill.
    expect(pricey!.buyGal).toBeLessThan(60);
  });
  test("fill when no cheaper priced fuel is ahead", () => {
    const plan = buildStopPlan({
      ...input,
      candidates: [
        cand({ alongMi: 60, name: "Only", pricePerGal: 4.2, priceLabel: "map tag" }),
        cand({ alongMi: 200, name: "Pricier", pricePerGal: 4.6, priceLabel: "map tag" }),
      ],
    });
    const only = plan.fuelDecisions.find((d) => d.stop.name === "Only");
    expect(only?.action).toBe("FILL");
  });
  test("skip when the tank already covers the route", () => {
    const plan = buildStopPlan({
      ...input,
      tankPct: 100,
      routeMiles: 300,
      candidates: [cand({ alongMi: 60, name: "Unneeded", pricePerGal: 3.5, priceLabel: "map tag" })],
    });
    expect(plan.fuelDecisions[0]?.action).toBe("SKIP");
  });
  test("unpriced stop never gets a splash — no cheaper-fuel claim without prices", () => {
    const plan = buildStopPlan({
      ...input,
      candidates: [cand({ alongMi: 60, name: "NoPrice" }), cand({ alongMi: 200, name: "AlsoNoPrice" })],
    });
    expect(plan.fuelDecisions[0]?.action).toBe("FILL");
    expect(plan.fuelDecisions[0]?.reason).toContain("no price");
  });
});

describe("true-cost ranking", () => {
  test("detour + time value can outrank a cheaper pump price", () => {
    const ranked = rankFuelStops(
      [
        cand({ alongMi: 50, name: "CheapFar", pricePerGal: 3.5, offRouteMi: 6 }),
        cand({ alongMi: 55, name: "NearPricier", pricePerGal: 3.65, offRouteMi: 0.1 }),
      ],
      { effMpg: 6, paceMph: 50, payPerMile: 3, typicalBuyGal: 80 },
    );
    expect(ranked[0]?.stop.name).toBe("NearPricier");
    expect(ranked[0]?.trueCostPerGal).toBeLessThan(ranked[1]?.trueCostPerGal ?? Infinity);
  });
  test("unpriced stops rank last — unknown cost is not zero cost", () => {
    const ranked = rankFuelStops([cand({ alongMi: 10, name: "Unknown" }), cand({ alongMi: 90, name: "Priced", pricePerGal: 5 })], {
      effMpg: 6,
      paceMph: 50,
      payPerMile: null,
      typicalBuyGal: 80,
    });
    expect(ranked[0]?.stop.name).toBe("Priced");
    expect(ranked[1]?.trueCostPerGal).toBeNull();
  });
});

describe("no load / no pay — pay is optional (x, 2026-11-01)", () => {
  const stops = [
    cand({ alongMi: 50, name: "CheapFar", pricePerGal: 3.5, offRouteMi: 6 }),
    cand({ alongMi: 55, name: "NearPricier", pricePerGal: 3.65, offRouteMi: 0.1 }),
  ];
  test("ranking runs complete with payPerMile null — price + detour fuel decide, time stays minutes", () => {
    const ranked = rankFuelStops(stops, { effMpg: 6, paceMph: 50, payPerMile: null, typicalBuyGal: 80 });
    // No pay and no setting: minutes-only. The far cheap stop's detour
    // fuel (12 mi round trip ≈ 2 gal ≈ $7 ≈ $0.088/gal) eats most of
    // its $0.15 pump edge, but with no dollar value on time it still
    // wins on price + detour fuel alone — the opposite of the loaded
    // ranking above, where time dollars flipped it.
    expect(ranked[0]?.stop.name).toBe("CheapFar");
    expect(ranked[0]?.timeValueSource).toBe("minutes-only");
    expect(ranked[0]?.timeCostDollars).toBeNull();
    expect(ranked[0]?.timeCostMin).toBeGreaterThan(ranked[1]?.timeCostMin ?? 0);
    expect(ranked[0]?.trueCostPerGal).not.toBeNull();
  });
  test("minutes break a true-cost tie in minutes-only mode — shorter detour wins over route order", () => {
    // Same pump price; with a huge typical buy the detour-fuel share
    // rounds away, so both true costs tie at the pump price — and the
    // LATER stop has the shorter detour. Minutes (not route order,
    // and not invented dollars) must put the short-detour stop first.
    const ranked = rankFuelStops(
      [
        cand({ alongMi: 50, name: "LongDetour", pricePerGal: 3.8, offRouteMi: 3 }),
        cand({ alongMi: 90, name: "ShortDetour", pricePerGal: 3.8, offRouteMi: 0 }),
      ],
      { effMpg: 6, paceMph: 50, payPerMile: null, typicalBuyGal: 10000 },
    );
    expect(ranked[0]?.trueCostPerGal).toBe(ranked[1]?.trueCostPerGal);
    expect(ranked[0]?.timeCostMin).toBeLessThan(ranked[1]?.timeCostMin ?? Infinity);
    expect(ranked.map((r) => r.stop.name)).toEqual(["ShortDetour", "LongDetour"]);
  });
  test("FILL / SPLASH / SKIP calls are identical with and without load pay", () => {
    const base = {
      routeMiles: 600,
      paceMph: 50,
      tankPct: 30,
      capacityGal: 150,
      baseMpg: 6,
      loadWeightLbs: 20000,
      hos: { hasData: false, driveRemainH: 11, windowRemainH: 14, breakRemainH: 8 },
      candidates: [
        cand({ alongMi: 60, name: "Pricey", pricePerGal: 4.2, priceLabel: "map tag" }),
        cand({ alongMi: 200, name: "Cheap", pricePerGal: 3.6, priceLabel: "map tag" }),
        cand({ alongMi: 420, name: "Last", pricePerGal: 3.9, priceLabel: "map tag" }),
      ],
      driverStops: [],
    };
    const withPay = buildStopPlan({ ...base, payPerMile: 2.75 });
    const noPay = buildStopPlan({ ...base, payPerMile: null });
    const calls = (p: typeof withPay) => p.fuelDecisions.map((d) => [d.stop.name, d.action, d.buyGal]);
    expect(calls(noPay)).toEqual(calls(withPay));
    expect(withPay.usesLoadPay).toBe(true);
    expect(withPay.timeValueSource).toBe("load");
    expect(noPay.usesLoadPay).toBe(false);
    expect(noPay.timeValueSource).toBe("minutes-only");
    expect(noPay.timeValuePerHour).toBeNull();
  });
});

describe("settings-based time-cost fallback (no load pay)", () => {
  const stops = [
    cand({ alongMi: 50, name: "CheapFar", pricePerGal: 3.5, offRouteMi: 6 }),
    cand({ alongMi: 55, name: "NearPricier", pricePerGal: 3.65, offRouteMi: 0.1 }),
  ];
  test("resolveTimeValue: load beats settings, settings beat minutes-only, junk setting is unset", () => {
    expect(resolveTimeValue({ payPerMile: 3, paceMph: 50, settingsTimeValuePerHour: 40 })).toEqual({ perHour: 150, source: "load" });
    expect(resolveTimeValue({ payPerMile: null, paceMph: 50, settingsTimeValuePerHour: 40 })).toEqual({ perHour: 40, source: "settings" });
    expect(resolveTimeValue({ payPerMile: null, paceMph: 50, settingsTimeValuePerHour: null })).toEqual({ perHour: null, source: "minutes-only" });
    expect(resolveTimeValue({ payPerMile: null, paceMph: 50 })).toEqual({ perHour: null, source: "minutes-only" });
    expect(resolveTimeValue({ payPerMile: null, paceMph: 50, settingsTimeValuePerHour: 0 }).source).toBe("minutes-only");
    expect(resolveTimeValue({ payPerMile: 0, paceMph: 50, settingsTimeValuePerHour: 25 })).toEqual({ perHour: 25, source: "settings" });
  });
  test("a settings $/hr flips the no-pay ranking the way load pay does — time becomes dollars", () => {
    const minutesOnly = rankFuelStops(stops, { effMpg: 6, paceMph: 50, payPerMile: null, typicalBuyGal: 80 });
    const withSetting = rankFuelStops(stops, {
      effMpg: 6,
      paceMph: 50,
      payPerMile: null,
      typicalBuyGal: 80,
      settingsTimeValuePerHour: 150,
    });
    expect(minutesOnly[0]?.stop.name).toBe("CheapFar");
    expect(withSetting[0]?.stop.name).toBe("NearPricier");
    expect(withSetting[0]?.timeValueSource).toBe("settings");
    expect(withSetting[0]?.timeCostDollars).not.toBeNull();
    expect(withSetting[0]?.timeCostDollars).toBeLessThan(withSetting[1]?.timeCostDollars ?? 0);
  });
  test("the plan carries the settings fallback when there is no load pay", () => {
    const plan = buildStopPlan({
      routeMiles: 400,
      paceMph: 50,
      tankPct: 60,
      capacityGal: 150,
      baseMpg: 6,
      loadWeightLbs: 0,
      payPerMile: null,
      settingsTimeValuePerHour: 30,
      hos: { hasData: false, driveRemainH: 11, windowRemainH: 14, breakRemainH: 8 },
      candidates: [cand({ alongMi: 100, name: "Only", pricePerGal: 3.9, priceLabel: "map tag" })],
      driverStops: [],
    });
    expect(plan.usesLoadPay).toBe(false);
    expect(plan.timeValueSource).toBe("settings");
    expect(plan.timeValuePerHour).toBe(30);
  });
  test("load pay present: the settings value is ignored, not blended", () => {
    const plan = buildStopPlan({
      routeMiles: 400,
      paceMph: 50,
      tankPct: 60,
      capacityGal: 150,
      baseMpg: 6,
      loadWeightLbs: 0,
      payPerMile: 2,
      settingsTimeValuePerHour: 30,
      hos: { hasData: false, driveRemainH: 11, windowRemainH: 14, breakRemainH: 8 },
      candidates: [cand({ alongMi: 100, name: "Only", pricePerGal: 3.9, priceLabel: "map tag" })],
      driverStops: [],
    });
    expect(plan.timeValueSource).toBe("load");
    expect(plan.timeValuePerHour).toBe(100); // $2/mi × 50 mph, not the $30 setting
  });
});

describe("break placement", () => {
  const base = {
    routeMiles: 700,
    paceMph: 50,
    tankPct: 100,
    capacityGal: 200,
    baseMpg: 6,
    loadWeightLbs: 0,
    payPerMile: null,
    driverStops: [],
  };
  test("break lands on the latest stop at or before the due point", () => {
    // Break due in 4h at 50 mph = 200 mi. Stops at 120, 185, 260.
    const plan = buildStopPlan({
      ...base,
      hos: { hasData: true, driveRemainH: 11, windowRemainH: 14, breakRemainH: 4 },
      candidates: [cand({ alongMi: 120, name: "A" }), cand({ alongMi: 185, name: "B" }), cand({ alongMi: 260, name: "C" })],
    });
    expect(plan.breakDueMi).toBe(200);
    expect(plan.breakPick?.stop.name).toBe("B");
  });
  test("break combines with a planned fuel stop and says so", () => {
    // Low tank forces a FILL around the break point.
    const plan = buildStopPlan({
      ...base,
      tankPct: 22,
      capacityGal: 150,
      hos: { hasData: true, driveRemainH: 11, windowRemainH: 14, breakRemainH: 4 },
      candidates: [cand({ alongMi: 190, name: "FuelNearBreak", pricePerGal: 3.8, priceLabel: "map tag" })],
    });
    expect(plan.breakPick?.combinedWithFuel).toBe(true);
    const entry = plan.timeline.find((t) => t.kind === "break");
    expect(entry?.detail).toContain("Combined with a fuel stop");
  });
  test("only stop past the due point flags the late break plainly", () => {
    const plan = buildStopPlan({
      ...base,
      hos: { hasData: true, driveRemainH: 11, windowRemainH: 14, breakRemainH: 4 },
      candidates: [cand({ alongMi: 260, name: "TooLate" })],
    });
    expect(plan.flags.some((f) => f.includes("Break comes due") && f.includes("TooLate"))).toBe(true);
  });
});

describe("day-stop placement", () => {
  test("shutdown is the last parkable stop before the clock runs out", () => {
    // Drive limit 6h at 50 mph = 300 mi.
    const plan = buildStopPlan({
      routeMiles: 800,
      paceMph: 50,
      tankPct: 100,
      capacityGal: 250,
      baseMpg: 6,
      loadWeightLbs: 0,
      payPerMile: null,
      hos: { hasData: true, driveRemainH: 6, windowRemainH: 9, breakRemainH: 8 },
      candidates: [
        cand({ alongMi: 240, name: "Early" }),
        cand({ alongMi: 295, name: "LastGood" }),
        cand({ alongMi: 340, name: "TooFar" }),
      ],
      driverStops: [],
    });
    expect(plan.dayDueMi).toBe(300);
    expect(plan.dayPick?.stop.name).toBe("LastGood");
    const entry = plan.timeline.find((t) => t.kind === "day");
    expect(entry?.detail).toContain("not in map data"); // parking spaces untagged
  });
  test("the 14h window binds when it is tighter than the 11h drive clock", () => {
    const plan = buildStopPlan({
      routeMiles: 800,
      paceMph: 50,
      tankPct: 100,
      capacityGal: 250,
      baseMpg: 6,
      loadWeightLbs: 0,
      payPerMile: null,
      hos: { hasData: true, driveRemainH: 10, windowRemainH: 5, breakRemainH: 8 },
      candidates: [cand({ alongMi: 240, name: "InWindow" }), cand({ alongMi: 290, name: "PastWindow" })],
      driverStops: [],
    });
    expect(plan.dayDueMi).toBe(250);
    expect(plan.dayPick?.stop.name).toBe("InWindow");
  });
});

describe("feasibility flags after a driver-added stop", () => {
  const base = {
    routeMiles: 500,
    paceMph: 50,
    capacityGal: 150,
    baseMpg: 6,
    loadWeightLbs: 0,
    payPerMile: null,
    hos: { hasData: true, driveRemainH: 11, windowRemainH: 14, breakRemainH: 4 }, // break due at 200 mi
    candidates: [cand({ alongMi: 100, name: "FuelA", pricePerGal: 3.9, priceLabel: "map tag" })],
  };
  test("a rest stop past the break point flags 'break comes due … before this stop'", () => {
    const plan = buildStopPlan({
      ...base,
      tankPct: 90,
      driverStops: [{ id: "d1", name: "My Rest", lat: 30, lon: -88, alongMi: 300, kind: "rest" }],
    });
    expect(plan.flags.some((f) => f.includes("Break comes due") && f.includes("My Rest"))).toBe(true);
  });
  test("a first fuel stop beyond tank range flags 'tank won't reach'", () => {
    const plan = buildStopPlan({
      ...base,
      tankPct: 15, // 22.5 gal ≈ 135 mi of range
      candidates: [cand({ alongMi: 220, name: "FarAway", pricePerGal: 3.9, priceLabel: "map tag" })],
      driverStops: [],
    });
    expect(plan.flags.some((f) => f.includes("Tank won't reach") && f.includes("FarAway"))).toBe(true);
  });
  test("a driver fuel stop inside range re-sequences the plan and clears the dry flag", () => {
    const plan = buildStopPlan({
      ...base,
      tankPct: 15,
      candidates: [cand({ alongMi: 220, name: "FarAway", pricePerGal: 3.9, priceLabel: "map tag" })],
      driverStops: [{ id: "d2", name: "My Fuel", lat: 30, lon: -88, alongMi: 90, kind: "fuel" }],
    });
    expect(plan.flags.some((f) => f.includes("Tank won't reach"))).toBe(false);
    expect(plan.timeline.some((t) => t.name === "My Fuel")).toBe(true);
  });
  test("a stop past the end of the route is flagged", () => {
    const plan = buildStopPlan({
      ...base,
      tankPct: 90,
      driverStops: [{ id: "d3", name: "Beyond", lat: 30, lon: -88, alongMi: 640, kind: "sleeper" }],
    });
    expect(plan.flags.some((f) => f.includes("past the end of this route"))).toBe(true);
  });
});
