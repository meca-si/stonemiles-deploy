// Auto-add stops to route (x's approved direction, 2026-11-13):
// "On any planned route, the app auto-adds three stops as waypoints
// (final destination never changes): the best fuel stop by true cost
// when your tank/range calls for it, the best 30-minute break spot
// timed off your HOS break clock, and a 10-hour rest stop placed
// before your 11/14 clocks run out — picked from HOS + fuel % + fuel
// prices along the route, break folded into the fuel stop when they
// line up, each added stop announced on a banner with one-tap remove,
// never touching a permit-locked route, and a Settings → Driving
// switch ('Auto-add stops to my route,' ON by default) for drivers
// who want to pick their own."
//
// This module is the SELECTION half only, and it is deliberately a
// thin layer over the Fuel + Stop Planner engine (stopPlanner.ts):
// every pick comes out of buildStopPlan / rankFuelStops — the same
// math the "Plan my stops" sheet shows — never a parallel brain.
// The routing half (via-points through the picks) lives in App.tsx;
// the setting persists as app_settings.autoAddStops (migration 0116).
//
// Guards encoded here:
//  - Setting OFF → no picks, reason "off" (behaviour exactly as
//    before: suggestions only).
//  - Permit-locked corridor → no picks, reason "permit" (a permit
//    route is NEVER auto-added to or altered).
// Everything else is honest planner output: a stop the planner did
// not pick is never invented here, prices keep the planner's own
// labels, and parking comes only from the candidates the planner
// already holds (real map data — no availability is ever claimed).

import type {
  FuelDecision,
  PlannerCandidate,
  RankedFuelStop,
  StopPlan,
} from "./stopPlanner";

export type AutoAddStopKind = "fuel" | "break" | "rest";

/** One stop the planner picked to be added to the route as a
 *  waypoint. `kinds` carries every job the stop does — a fuel stop
 *  that also covers the 30-minute break lists both. */
export type AutoAddStop = {
  /** Stable key for this stop within a plan (the planner stop id). */
  key: string;
  kinds: AutoAddStopKind[];
  name: string;
  lat: number;
  lon: number;
  /** Miles along the route from its start, as the planner saw it. */
  alongMi: number;
  /** Fuel only: gallons the planner says to buy here. */
  buyGal: number | null;
  /** Fuel only: the planner's own price label for the stop (an
   *  estimate stays labelled an estimate); null when unpriced. */
  priceLabel: string | null;
  pricePerGal: number | null;
  /** Fuel only: estimated saving vs the priciest true-cost stop the
   *  planner ranked on this route, in dollars — computed ONLY from
   *  the planner's own true-cost numbers, and null when the planner's
   *  numbers don't support one (single priced stop, or this pick is
   *  the priciest). Never an invented figure. */
  estSaving: number | null;
  /** True when this stop is the planner's break pick AND a fuel
   *  buy lines up with it (the planner's own combination call). */
  combinedWithFuel: boolean;
};

export type AutoAddSkipReason = "off" | "permit" | null;

export type AutoAddSelection = {
  stops: AutoAddStop[];
  /** Why nothing was selected, when nothing was: the setting is off
   *  or the route is a locked permit corridor. Null when the planner
   *  simply had no picks (or picks exist). */
  skipped: AutoAddSkipReason;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Pick the fuel stop to auto-add: only when the planner's own fuel
 *  math says fuel is needed on this route — i.e. the plan carries a
 *  FILL decision with gallons to buy (a buy the simulation actually
 *  depends on; a degenerate FILL of 0 gal is not a stop). Among the
 *  FILL stops, the winner is the one rankFuelStops puts first
 *  (lowest true cost: price + detour fuel + detour/stop time). A
 *  SPLASH-only plan adds nothing here: a splash is a bridge to
 *  cheaper fuel ahead, and the FILL at that cheaper stop is the
 *  stop worth routing through. */
function pickFuelStop(
  plan: StopPlan,
  ranked: RankedFuelStop[],
): { decision: FuelDecision; estSaving: number | null } | null {
  const fills = plan.fuelDecisions.filter((d) => d.action === "FILL" && d.buyGal > 0);
  if (fills.length === 0) return null;
  const rankOf = new Map(ranked.map((r, i) => [r.stop.id, i]));
  const byTrueCost = [...fills].sort(
    (a, b) => (rankOf.get(a.stop.id) ?? Number.MAX_SAFE_INTEGER) - (rankOf.get(b.stop.id) ?? Number.MAX_SAFE_INTEGER),
  );
  const decision = byTrueCost[0]!;
  // Estimated saving, only where the planner's own numbers support
  // one: the pick is priced, at least one OTHER ranked stop is
  // priced, and the priciest of those costs more per gallon in true
  // cost than the pick. Saving = that gap × the gallons the planner
  // says to buy here.
  let estSaving: number | null = null;
  const pickRanked = ranked.find((r) => r.stop.id === decision.stop.id);
  if (pickRanked?.trueCostPerGal != null && decision.buyGal > 0) {
    const others = ranked.filter(
      (r) => r.stop.id !== decision.stop.id && r.trueCostPerGal != null,
    );
    if (others.length > 0) {
      const priciest = Math.max(...others.map((r) => r.trueCostPerGal!));
      const gap = priciest - pickRanked.trueCostPerGal;
      if (gap > 0) estSaving = round2(gap * decision.buyGal);
    }
  }
  return { decision, estSaving };
}

type StopLike = PlannerCandidate | { id: string; name: string; lat: number; lon: number; alongMi: number };

function baseStop(stop: StopLike, kind: AutoAddStopKind): AutoAddStop {
  return {
    key: stop.id,
    kinds: [kind],
    name: stop.name,
    lat: stop.lat,
    lon: stop.lon,
    alongMi: stop.alongMi,
    buyGal: null,
    priceLabel: null,
    pricePerGal: null,
    estSaving: null,
    combinedWithFuel: false,
  };
}

/** Select the stops to auto-add for one planned route.
 *
 *  - Fuel: the planner's top true-cost FILL, only when the plan
 *    needs fuel (see pickFuelStop).
 *  - Break: the planner's breakPick — a 30-minute break stop that
 *    arrives before the HOS break deadline. When the break pick IS
 *    the fuel pick (same stop), or the planner says a fuel buy lines
 *    up at the break stop and that lining-up buy is the fuel pick,
 *    the fuel stop carries the break too (one waypoint, both jobs).
 *  - Rest: the planner's dayPick — the stop-for-the-day placed off
 *    the 11h/14h clocks, sized here as the 10-hour clock-restart
 *    stop.
 *  Both clock stops are added ONLY when their deadline actually
 *  lands on this route (due miles < route miles): if the break or
 *  the driving day outlasts the route, the driver reaches the
 *  destination inside their clocks and no en-route stop is owed —
 *  the planner still SHOWS those picks in "Plan my stops" for the
 *  day, they just don't become waypoints.
 *  Picks are returned in along-route order, deduplicated by stop:
 *  one physical stop never becomes two waypoints. */
export function selectAutoAddStops(args: {
  plan: StopPlan;
  ranked: RankedFuelStop[];
  /** Miles of route the plan was built over (the same figure the
   *  planner received — remaining miles when mid-route). */
  routeMiles: number;
  enabled: boolean;
  permitLocked: boolean;
}): AutoAddSelection {
  if (!args.enabled) return { stops: [], skipped: "off" };
  if (args.permitLocked) return { stops: [], skipped: "permit" };
  const { plan, ranked } = args;

  const out: AutoAddStop[] = [];
  const byKey = new Map<string, AutoAddStop>();
  const add = (stop: AutoAddStop) => {
    const existing = byKey.get(stop.key);
    if (existing) {
      for (const k of stop.kinds) if (!existing.kinds.includes(k)) existing.kinds.push(k);
      existing.combinedWithFuel = existing.combinedWithFuel || stop.combinedWithFuel;
      return existing;
    }
    byKey.set(stop.key, stop);
    out.push(stop);
    return stop;
  };

  // Fuel first — the break merge below keys off the fuel pick.
  const fuel = pickFuelStop(plan, ranked);
  let fuelStop: AutoAddStop | null = null;
  if (fuel) {
    fuelStop = add(baseStop(fuel.decision.stop, "fuel"));
    fuelStop.buyGal = fuel.decision.buyGal;
    fuelStop.priceLabel = fuel.decision.stop.priceLabel;
    fuelStop.pricePerGal = fuel.decision.stop.pricePerGal;
    fuelStop.estSaving = fuel.estSaving;
  }

  // Break: the planner's pick, only when the break deadline lands
  // on this route; folded into the fuel stop when they line up —
  // either literally the same stop, or the planner's own
  // combination flag with the lining-up fuel buy being our pick.
  if (plan.breakPick && plan.breakDueMi != null && plan.breakDueMi < args.routeMiles) {
    const bp = plan.breakPick;
    const linesUpWithFuelPick =
      fuel != null &&
      bp.combinedWithFuel &&
      plan.fuelDecisions.some(
        (d) => d.stop.id === bp.stop.id && (d.action === "FILL" || d.action === "SPLASH"),
      ) &&
      bp.stop.id === fuel.decision.stop.id;
    if (fuelStop && (bp.stop.id === fuelStop.key || linesUpWithFuelPick)) {
      if (!fuelStop.kinds.includes("break")) fuelStop.kinds.push("break");
      fuelStop.combinedWithFuel = fuelStop.combinedWithFuel || bp.combinedWithFuel;
    } else {
      const entry = add(baseStop(bp.stop, "break"));
      entry.combinedWithFuel = bp.combinedWithFuel;
    }
  }

  // Rest: the planner's stop-for-the-day, off the 11/14 clocks —
  // only when the day actually ends before the route does.
  if (plan.dayPick && plan.dayDueMi != null && plan.dayDueMi < args.routeMiles) {
    add(baseStop(plan.dayPick.stop, "rest"));
  }

  out.sort((a, b) => a.alongMi - b.alongMi);
  return { stops: out, skipped: null };
}
