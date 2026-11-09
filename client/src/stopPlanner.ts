// stopPlanner.ts — Fuel + Stop Planner (x's order, 2026-11-01).
//
// One planner brain on the route timeline: fuel, the 30-minute break,
// and the stop-for-the-day are one decision — where the truck stops,
// and when — so they are planned together here, priced against the
// load the driver is under WHEN there is one.
//
// Load pay is OPTIONAL (x, 2026-11-01 ~19:59 CT): with no load
// assigned, deadheading, or pay simply not entered, pay drops out of
// the ranking entirely — the FILL / SPLASH / SKIP calls and the
// true-cost order run on station price, tank %, weight-adjusted burn,
// loaded/remaining miles, and detour distance + time alone. The
// FILL/SPLASH/SKIP simulation never read pay at all (it is price-
// ahead + tank + burn + miles math); pay only ever valued detour
// TIME in the ranking, and without a load that time value falls back
// to the driver's own detour-time-cost setting (a plain $/hr they
// set), or — the default — to minutes only, with no dollar conversion
// invented. Nothing here nags for pay or invents a rate.
//
// Pure and framework-free, like loadRate.ts / truckStop.ts, so the
// exact production math is unit-testable (see stopPlanner.test.ts).
//
// Honesty rules (standing app law, held by every function here):
// - Tank source is labelled, never faked: "eld" only when a real ELD
//   fuel reading is handed in; otherwise the tank is an ESTIMATE from
//   the driver's own manual entry minus modelled burn. There is no
//   code path that invents an ELD reading.
// - Prices come only from data the app already holds (map tags /
//   the driver's price layer / EIA regional context), each carrying
//   its own source label. A stop with no price is ranked and planned
//   as UNPRICED — never assigned an invented price.
// - Parking capacity comes only from real map data; null stays null
//   and the UI renders "Not in map data".
// - Planning is advisory: this module recommends; it never touches
//   duty status, trips, or pay records.

export type PlannerStopKind = "fuel" | "rest" | "sleeper";

export type PlannerCandidate = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Miles along the route from the truck's current position. */
  alongMi: number;
  /** Miles off the route line (one way). */
  offRouteMi: number;
  kind: PlannerStopKind;
  /** Diesel $/gal from a real source the app holds, or null. */
  pricePerGal: number | null;
  /** Where that price came from ("map tag", "reported …", "EIA regional estimate"). */
  priceLabel: string | null;
  /** Truck parking spaces from map capacity tags — null = not in map data. */
  parkingSpaces: number | null;
  /** Truck parking tagged in map data: true / false / null (doesn't say). */
  truckParking: boolean | null;
};

export type DriverStop = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  alongMi: number;
  kind: PlannerStopKind;
};

export type TankSource = "eld" | "estimate";

export type TankReading = {
  source: TankSource;
  /** Current tank level, percent 0–100. */
  pct: number;
  /** Connected ELD with no fuel feed received yet — labelled as such. */
  eldConnectedNoFeed: boolean;
  /** The linked ELD provider's display name ("Motive", "Samsara", …)
   *  when one is linked — named wherever the tank source is labelled.
   *  Null when no ELD is linked or the provider is unnamed. */
  providerName: string | null;
};

export type HosInput = {
  hasData: boolean;
  driveRemainH: number;
  windowRemainH: number;
  breakRemainH: number;
};

// ---------- Burn model -------------------------------------------------------

/** A full legal load (45,000 lb of freight) burns this much more fuel
 *  per mile than an empty truck, on top of the truck's own MPG profile.
 *  The factor scales linearly with freight weight and caps at 45k. */
export const FULL_LOAD_BURN_PENALTY = 0.2;
export const FULL_LOAD_WEIGHT_LBS = 45_000;

/** Burn multiplier for a given freight weight: 1.0 empty, 1.20 at a
 *  full 45,000 lb load. Negative / junk weights read as empty. */
export function loadBurnFactor(loadWeightLbs: number | null | undefined): number {
  if (loadWeightLbs == null || !Number.isFinite(loadWeightLbs) || loadWeightLbs <= 0) return 1;
  const frac = Math.min(loadWeightLbs, FULL_LOAD_WEIGHT_LBS) / FULL_LOAD_WEIGHT_LBS;
  return 1 + FULL_LOAD_BURN_PENALTY * frac;
}

/** Effective MPG under load: the truck's profile MPG divided by the
 *  weight burn factor — a loaded truck goes fewer miles per gallon. */
export function effectiveMpg(baseMpg: number, loadWeightLbs: number | null | undefined): number {
  const base = baseMpg > 0 && Number.isFinite(baseMpg) ? baseMpg : 6.5;
  return base / loadBurnFactor(loadWeightLbs);
}

export function gallonsForMiles(miles: number, effMpg: number): number {
  if (!(miles > 0) || !(effMpg > 0)) return 0;
  return miles / effMpg;
}

/** Tank percent after driving `miles` from `startPct`, given tank
 *  capacity and the weight-adjusted burn rate. Clamps at 0 — the model
 *  never reports a negative tank; running dry is a feasibility flag,
 *  computed separately in the plan. */
export function tankPctAfterMiles(
  startPct: number,
  miles: number,
  capacityGal: number,
  baseMpg: number,
  loadWeightLbs: number | null | undefined,
): number {
  if (!(capacityGal > 0)) return Math.max(0, Math.min(100, startPct));
  const burnedGal = gallonsForMiles(miles, effectiveMpg(baseMpg, loadWeightLbs));
  const pct = startPct - (burnedGal / capacityGal) * 100;
  return Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
}

/** Miles the truck can still run on `pct` of a tank before hitting the
 *  reserve floor (reservePct of capacity is kept in the tank). */
export function usableRangeMi(
  pct: number,
  capacityGal: number,
  baseMpg: number,
  loadWeightLbs: number | null | undefined,
  reservePct: number,
): number {
  const usableGal = Math.max(0, (pct - reservePct) / 100) * Math.max(0, capacityGal);
  return usableGal * effectiveMpg(baseMpg, loadWeightLbs);
}

/** Resolve the tank's source label — the reading path for a real ELD
 *  fuel feed. A live reading is used ONLY when one is actually handed
 *  in (eldFuelPct != null). A connected ELD with no fuel reading yet
 *  still runs on the manual estimate, and says so. */
export function resolveTankReading(input: {
  eldFuelPct: number | null;
  eldConnected: boolean;
  /** Linked ELD provider's display name, named in the label. */
  eldProviderName?: string | null;
  manualPct: number;
  milesSinceManualEntry: number;
  capacityGal: number;
  baseMpg: number;
  loadWeightLbs: number | null;
}): TankReading {
  if (input.eldFuelPct != null && Number.isFinite(input.eldFuelPct)) {
    return {
      source: "eld",
      pct: Math.max(0, Math.min(100, Math.round(input.eldFuelPct * 10) / 10)),
      eldConnectedNoFeed: false,
      providerName: input.eldProviderName ?? null,
    };
  }
  return {
    source: "estimate",
    pct: tankPctAfterMiles(
      input.manualPct,
      Math.max(0, input.milesSinceManualEntry),
      input.capacityGal,
      input.baseMpg,
      input.loadWeightLbs,
    ),
    eldConnectedNoFeed: input.eldConnected,
    providerName: input.eldProviderName ?? null,
  };
}

export function tankSourceLabel(r: TankReading): string {
  if (r.source === "eld") return r.providerName ? `ELD live — ${r.providerName}` : "ELD live";
  if (r.eldConnectedNoFeed) {
    return r.providerName
      ? `Estimate — ${r.providerName} linked, no fuel feed received yet`
      : "Estimate — ELD connected, no fuel feed received yet";
  }
  return "Estimate — no ELD linked";
}

// ---------- ELD connection layer (provider-agnostic) -------------------------
//
// ONE interface between the planner and any ELD (x, 2026-11-01):
// providers plug in as ADAPTERS, so the planner never changes per
// provider. The only read the planner consumes today is the truck's
// fuel level % — designed against the connected-vehicle data shape
// every provider's vehicle feed carries (a vehicle, a fuel level %,
// a reading timestamp). HOS clocks, the odometer, and the on-connect
// driver & truck identity pull (spec §6 — its shape and display live
// in eldIdentity.ts) are declared FUTURE reads on this same
// interface — named here, not built.
//
// This build ships the interface, the adapter shape, and the honest
// states ONLY: no live connection, login, credential entry, or API
// call to any provider exists anywhere in it, and no adapter can
// produce a fuel % — a fuel % reaches the planner solely through
// resolveEldSlot, which yields one ONLY when a link exists AND a
// real reading object was handed in. Linking a fleet account is the
// fleet owner's call (their ELD account, their permission).

/** A fuel-level reading on the shared ELD interface, in the
 *  connected-vehicle shape: which vehicle, its fuel level %, and
 *  when the feed read it (ISO timestamp). Provider adapters map
 *  their own vehicle payloads into exactly this shape. */
export type EldFuelReading = {
  vehicleId: string | null;
  /** Fuel level, percent 0–100, as read by the provider's feed. */
  fuelLevelPct: number;
  /** ISO timestamp of the feed reading. */
  receivedAt: string;
};

/** A provider adapter: everything provider-specific lives behind
 *  this shape. Adding a provider = adding one registry entry (and,
 *  when a real link is built, its payload mapping into
 *  EldFuelReading) — the planner, the tank, and the labels never
 *  change. */
export type EldAdapter = {
  /** Stable provider key, matching the ELD hub's provider keys. */
  key: string;
  /** Display name, used wherever the tank source is labelled. */
  name: string;
  /** The interface reads this adapter serves. fuelLevel is the read
   *  the planner needs; hosClocks, odometer, and the on-connect
   *  identity pull are future reads on the same interface —
   *  declared, not built. */
  reads: { fuelLevel: true; hosClocks: "future"; odometer: "future"; identity: "future" };
  /** Where the fuel level % sits in this provider's connected-
   *  vehicle data, in words — the mapping target for a future link. */
  fuelLevelSource: string;
};

/** Adapter registry. Motive is listed FIRST as the example option;
 *  Samsara and Geotab slot in behind it in the same shape. (Which
 *  provider any given fleet runs is that fleet's fact to confirm —
 *  nothing here claims one.) Registry order is display order in the
 *  connection UI. */
export const ELD_ADAPTERS: EldAdapter[] = [
  {
    key: "motive",
    name: "Motive",
    reads: { fuelLevel: true, hosClocks: "future", odometer: "future", identity: "future" },
    fuelLevelSource: "Motive connected-vehicle data — the vehicle's current fuel level %",
  },
  {
    key: "samsara",
    name: "Samsara",
    reads: { fuelLevel: true, hosClocks: "future", odometer: "future", identity: "future" },
    fuelLevelSource: "Samsara vehicle stats — the vehicle's fuel level %",
  },
  {
    key: "geotab",
    name: "Geotab",
    reads: { fuelLevel: true, hosClocks: "future", odometer: "future", identity: "future" },
    fuelLevelSource: "Geotab vehicle engine data — the vehicle's fuel level %",
  },
];

/** Resolve an adapter by key. An unregistered key still resolves to
 *  a generic adapter named by its key, so a future provider works
 *  through the same interface the day it is linked — no planner
 *  change. Null key = no adapter chosen. */
export function eldAdapterFor(key: string | null | undefined): EldAdapter | null {
  if (key == null || key === "") return null;
  return (
    ELD_ADAPTERS.find((a) => a.key === key) ?? {
      key,
      name: key,
      reads: { fuelLevel: true, hosClocks: "future", odometer: "future", identity: "future" },
      fuelLevelSource: "Connected-vehicle data — the vehicle's fuel level %",
    }
  );
}

export type EldLinkState = "not_linked" | "linked_no_feed" | "live";

export type EldSlot = {
  adapter: EldAdapter | null;
  linkState: EldLinkState;
  /** The fuel % the planner may use. Non-null ONLY in "live" —
   *  there is no path to a provider fuel % without a link AND a
   *  real reading. */
  fuelPct: number | null;
  /** The honest state line, shown wherever the tank source is
   *  labelled: "ELD — not linked" · "ELD live — Motive" · … */
  label: string;
};

/** Resolve the ELD slot from the link state + whatever reading was
 *  actually handed in. A reading without a link is disregarded (not
 *  linked wins); a junk reading (NaN, outside 0–100) is no feed, not
 *  a number to clamp into existence. */
export function resolveEldSlot(input: {
  adapterKey: string | null;
  linked: boolean;
  reading: EldFuelReading | null;
}): EldSlot {
  const adapter = eldAdapterFor(input.adapterKey);
  if (!input.linked || adapter == null) {
    return { adapter, linkState: "not_linked", fuelPct: null, label: "ELD — not linked" };
  }
  const pct = input.reading?.fuelLevelPct;
  if (pct == null || !Number.isFinite(pct) || pct < 0 || pct > 100) {
    return {
      adapter,
      linkState: "linked_no_feed",
      fuelPct: null,
      label: `ELD linked — ${adapter.name} · no fuel feed received yet`,
    };
  }
  return {
    adapter,
    linkState: "live",
    fuelPct: Math.round(pct * 10) / 10,
    label: `ELD live — ${adapter.name}`,
  };
}

// ---------- True-cost ranking --------------------------------------------------

export type RankedFuelStop = {
  stop: PlannerCandidate;
  /** $/gal including detour fuel + the time the detour and the stop
   *  itself cost, valued at the resolved time value (load pay, the
   *  driver's time-cost setting, or — minutes-only — $0 of time).
   *  Null when unpriced. */
  trueCostPerGal: number | null;
  detourMi: number;
  /** Minutes the detour + a fuel stop's dwell cost, at route pace. */
  timeCostMin: number;
  /** Where the hour behind timeCostMin was valued from. */
  timeValueSource: TimeValueSource;
  /** Dollars the detour + dwell time cost at the resolved $/hr.
   *  Null in minutes-only mode — time is reported, never converted. */
  timeCostDollars: number | null;
};

/** Value of one driving hour under this load: $/mi × pace mph. Null
 *  when the load carries no $/mi — then time is reported in minutes
 *  and never converted to invented dollars. */
export function timeValuePerHour(payPerMile: number | null, paceMph: number): number | null {
  if (payPerMile == null || !(payPerMile > 0) || !(paceMph > 0)) return null;
  return payPerMile * paceMph;
}

/** Where the value of an hour of detour time came from:
 *  - "load": the active load's $/mi × pace (pay was applicable).
 *  - "settings": no load pay — the driver's own detour-time-cost
 *    setting ($/hr, set in the planner's settings) stands in.
 *  - "minutes-only": no load pay and no setting — the default. Time
 *    counts in minutes only; no dollar value is put on it, and in the
 *    ranking minutes break ties between otherwise-equal true costs
 *    instead of being converted to invented dollars. */
export type TimeValueSource = "load" | "settings" | "minutes-only";

export type ResolvedTimeValue = {
  /** $/hr used to convert detour minutes to dollars, or null when
   *  time stays in minutes (minutes-only mode). */
  perHour: number | null;
  source: TimeValueSource;
};

/** Resolve the detour time value. Load pay wins when it is actually
 *  there; without it, the driver's settings $/hr is the fallback;
 *  without either, minutes-only. A junk settings value (≤ 0, NaN)
 *  reads as unset — minutes-only, never a nonsense rate. */
export function resolveTimeValue(input: {
  payPerMile: number | null;
  paceMph: number;
  settingsTimeValuePerHour?: number | null;
}): ResolvedTimeValue {
  const fromLoad = timeValuePerHour(input.payPerMile, input.paceMph);
  if (fromLoad != null) return { perHour: fromLoad, source: "load" };
  const s = input.settingsTimeValuePerHour;
  if (s != null && Number.isFinite(s) && s > 0) return { perHour: s, source: "settings" };
  return { perHour: null, source: "minutes-only" };
}

const FUEL_DWELL_MIN = 15;

/** Rank fuel stops by TRUE cost: pump price + detour miles (fuel to
 *  run them, at this stop's own price) + time (detour drive + dwell,
 *  valued at the resolved time value — the load's $/mi when a load
 *  carries one, else the driver's time-cost setting, else minutes
 *  only), spread over the gallons a typical buy takes. Pay is one
 *  optional input among price / tank-independent detour / time —
 *  with no pay the ranking is complete without it. Unpriced stops
 *  rank last — their cost is unknown, not zero. */
export function rankFuelStops(
  stops: PlannerCandidate[],
  ctx: {
    effMpg: number;
    paceMph: number;
    payPerMile: number | null;
    typicalBuyGal: number;
    /** Driver-set detour time cost ($/hr) used only when there is no
     *  load pay. Null/omitted = minutes only (the default). */
    settingsTimeValuePerHour?: number | null;
  },
): RankedFuelStop[] {
  const buyGal = ctx.typicalBuyGal > 0 ? ctx.typicalBuyGal : 50;
  const resolved = resolveTimeValue({
    payPerMile: ctx.payPerMile,
    paceMph: ctx.paceMph,
    settingsTimeValuePerHour: ctx.settingsTimeValuePerHour ?? null,
  });
  const perHour = resolved.perHour;
  const ranked = stops
    .filter((s) => s.kind === "fuel")
    .map((stop) => {
      const detourMi = Math.max(0, stop.offRouteMi) * 2;
      const driveMin = ctx.paceMph > 0 ? (detourMi / ctx.paceMph) * 60 : 0;
      const timeCostMin = Math.round(driveMin + FUEL_DWELL_MIN);
      const timeCostDollars = perHour != null ? Math.round((timeCostMin / 60) * perHour * 100) / 100 : null;
      if (stop.pricePerGal == null) {
        return { stop, trueCostPerGal: null, detourMi, timeCostMin, timeValueSource: resolved.source, timeCostDollars };
      }
      const detourFuelCost = gallonsForMiles(detourMi, ctx.effMpg) * stop.pricePerGal;
      const timeCost = timeCostDollars ?? 0;
      const trueCostPerGal = stop.pricePerGal + (detourFuelCost + timeCost) / buyGal;
      return {
        stop,
        trueCostPerGal: Math.round(trueCostPerGal * 1000) / 1000,
        detourMi,
        timeCostMin,
        timeValueSource: resolved.source,
        timeCostDollars,
      };
    });
  ranked.sort((a, b) => {
    if (a.trueCostPerGal != null && b.trueCostPerGal != null) {
      // Minutes-only mode: time never became dollars, so minutes
      // themselves break a true-cost tie — the shorter detour wins.
      return a.trueCostPerGal - b.trueCostPerGal || a.timeCostMin - b.timeCostMin || a.stop.alongMi - b.stop.alongMi;
    }
    if (a.trueCostPerGal != null) return -1;
    if (b.trueCostPerGal != null) return 1;
    return a.stop.alongMi - b.stop.alongMi;
  });
  return ranked;
}

// ---------- The plan -----------------------------------------------------------

export type FuelAction = "FILL" | "SPLASH" | "SKIP";

export type FuelDecision = {
  stop: PlannerCandidate;
  action: FuelAction;
  /** Gallons to buy at this stop (0 for SKIP). */
  buyGal: number;
  /** Tank percent on arrival at this stop, before buying. */
  arrivalPct: number;
  reason: string;
};

export type TimelineEntry = {
  key: string;
  alongMi: number;
  name: string;
  kind: PlannerStopKind | "break" | "day";
  title: string;
  detail: string;
};

export type StopPlan = {
  effMpg: number;
  burnFactor: number;
  /** True when the active load's pay actually fed this plan's time
   *  value. False = pay was not applicable (no load / deadhead / pay
   *  not entered) and was dropped from the math entirely. */
  usesLoadPay: boolean;
  /** The resolved detour time value behind this plan: $/hr (null in
   *  minutes-only mode) and where it came from. */
  timeValuePerHour: number | null;
  timeValueSource: TimeValueSource;
  /** Miles until the tank reaches the reserve floor. */
  rangeMi: number;
  fuelDecisions: FuelDecision[];
  breakPick: { stop: PlannerCandidate | DriverStop; combinedWithFuel: boolean } | null;
  breakDueMi: number | null;
  dayPick: { stop: PlannerCandidate | DriverStop } | null;
  dayDueMi: number | null;
  timeline: TimelineEntry[];
  flags: string[];
};

export type PlanInput = {
  routeMiles: number;
  paceMph: number;
  tankPct: number;
  capacityGal: number;
  baseMpg: number;
  loadWeightLbs: number | null;
  /** The active load's all-in $/mi, or null when no load/rate is on
   *  file. OPTIONAL: null (no load, deadheading, pay not entered)
   *  drops pay from the plan entirely — the calls run on price, tank,
   *  burn, miles, and detour alone. */
  payPerMile: number | null;
  /** Driver-set detour time cost ($/hr) — the fallback time value
   *  when there is no load pay. Null/omitted = minutes only. */
  settingsTimeValuePerHour?: number | null;
  hos: HosInput;
  candidates: PlannerCandidate[];
  driverStops: DriverStop[];
  /** Percent of the tank the plan never plans to burn. Default 12. */
  reservePct?: number;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export function buildStopPlan(input: PlanInput): StopPlan {
  const reservePct = input.reservePct ?? 12;
  const effMpg = effectiveMpg(input.baseMpg, input.loadWeightLbs);
  const burnFactor = loadBurnFactor(input.loadWeightLbs);
  const capacity = Math.max(1, input.capacityGal);
  const reserveGal = (reservePct / 100) * capacity;
  const pace = input.paceMph > 0 ? input.paceMph : 50;
  // Time value resolution (pay optional): the FILL/SPLASH/SKIP
  // simulation below never reads pay — it is price-ahead + tank +
  // burn + miles math, identical with or without a load. The resolved
  // value is carried on the plan so the UI can state honestly which
  // basis the detour-time ranking used (load / settings / minutes).
  const resolvedTime = resolveTimeValue({
    payPerMile: input.payPerMile,
    paceMph: pace,
    settingsTimeValuePerHour: input.settingsTimeValuePerHour ?? null,
  });
  const flags: string[] = [];

  const sorted = [...input.candidates].sort((a, b) => a.alongMi - b.alongMi);
  const fuelStops = sorted.filter((s) => s.kind === "fuel" && s.alongMi <= input.routeMiles + 0.5);
  // Driver-added fuel stops count as refuel points in the simulation:
  // the driver chose them, so the plan assumes a fill there.
  const driverFuel = input.driverStops
    .filter((d) => d.kind === "fuel")
    .map(
      (d): PlannerCandidate => ({
        id: d.id,
        name: d.name,
        lat: d.lat,
        lon: d.lon,
        alongMi: d.alongMi,
        offRouteMi: 0,
        kind: "fuel",
        pricePerGal: null,
        priceLabel: null,
        parkingSpaces: null,
        truckParking: null,
      }),
    );
  const allFuel = [...fuelStops, ...driverFuel].sort((a, b) => a.alongMi - b.alongMi);
  const driverFuelIds = new Set(driverFuel.map((d) => d.id));

  // --- Fuel simulation, in route order -------------------------------------
  const decisions: FuelDecision[] = [];
  let gal = (Math.max(0, Math.min(100, input.tankPct)) / 100) * capacity;
  let pos = 0;
  let tankFlagged = false;
  for (let i = 0; i < allFuel.length; i++) {
    const stop = allFuel[i]!;
    const legMi = Math.max(0, stop.alongMi - pos);
    const arrivalGal = gal - gallonsForMiles(legMi, effMpg);
    const arrivalPct = Math.max(0, (arrivalGal / capacity) * 100);
    pos = stop.alongMi;
    if (arrivalGal < 0 && !tankFlagged) {
      flags.push(
        `Tank won't reach ${stop.name} — the tank runs dry about ${round1(Math.abs(arrivalGal) * effMpg)} mi before it. Add a fuel stop sooner or fuel before you roll.`,
      );
      tankFlagged = true;
    }
    const milesToDest = Math.max(0, input.routeMiles - stop.alongMi);
    const galToDest = gallonsForMiles(milesToDest, effMpg) + reserveGal;
    const isDriverStop = driverFuelIds.has(stop.id);
    if (!isDriverStop && arrivalGal >= galToDest) {
      decisions.push({
        stop,
        action: "SKIP",
        buyGal: 0,
        arrivalPct: round1(arrivalPct),
        reason: "Tank covers the rest of the route from here, keeping the reserve — no need to stop.",
      });
      gal = Math.max(0, arrivalGal);
      continue;
    }
    // Cheaper PRICED fuel ahead, reachable on a full tank from here?
    const fullRangeMi = Math.max(0, capacity - reserveGal) * effMpg;
    const cheaperAhead =
      stop.pricePerGal != null
        ? allFuel
            .slice(i + 1)
            .find(
              (s) =>
                s.pricePerGal != null &&
                s.pricePerGal < stop.pricePerGal! - 0.02 &&
                s.alongMi - stop.alongMi <= fullRangeMi,
            )
        : undefined;
    if (!isDriverStop && cheaperAhead && cheaperAhead.pricePerGal != null && stop.pricePerGal != null) {
      const galToCheaper = gallonsForMiles(cheaperAhead.alongMi - stop.alongMi, effMpg) + reserveGal;
      if (arrivalGal >= galToCheaper) {
        decisions.push({
          stop,
          action: "SKIP",
          buyGal: 0,
          arrivalPct: round1(arrivalPct),
          reason: `Cheaper fuel ahead at ${cheaperAhead.name} (${cheaperAhead.priceLabel ?? "estimate"} $${cheaperAhead.pricePerGal.toFixed(2)}/gal) and the tank reaches it — roll past.`,
        });
        gal = Math.max(0, arrivalGal);
        continue;
      }
      const buy = Math.min(capacity - Math.max(0, arrivalGal), galToCheaper - arrivalGal);
      decisions.push({
        stop,
        action: "SPLASH",
        buyGal: Math.max(0, Math.round(buy)),
        arrivalPct: round1(arrivalPct),
        reason: `Splash only — buy just enough to reach cheaper fuel at ${cheaperAhead.name} ($${cheaperAhead.pricePerGal.toFixed(2)}/gal vs $${stop.pricePerGal.toFixed(2)} here).`,
      });
      gal = Math.max(0, arrivalGal) + buy;
      continue;
    }
    // FILL: enough to finish the route, capped at a full tank.
    const buy = Math.max(0, Math.min(capacity - Math.max(0, arrivalGal), galToDest - arrivalGal));
    decisions.push({
      stop,
      action: "FILL",
      buyGal: Math.round(buy),
      arrivalPct: round1(arrivalPct),
      reason: isDriverStop
        ? "Your added fuel stop — the plan fills here and re-checks the rest of the route from this tank."
        : stop.pricePerGal != null
          ? "Best fill on this stretch — no cheaper priced fuel ahead inside a tank's range."
          : "Fill here — this stop carries no price in the data the app holds, so no cheaper-fuel claim is made; the tank needs it to finish the route.",
    });
    gal = Math.max(0, arrivalGal) + buy;
  }
  // Destination reachability on the final simulated tank.
  const finalLegGal = gal - gallonsForMiles(Math.max(0, input.routeMiles - pos), effMpg);
  if (allFuel.length === 0) {
    const startGal = (Math.max(0, Math.min(100, input.tankPct)) / 100) * capacity;
    if (startGal - gallonsForMiles(input.routeMiles, effMpg) < reserveGal) {
      flags.push(
        "Tank won't finish this route on what's in it, and no fuel stops are on the route data yet — set a route so the corridor scan finds stops, or fuel before you roll.",
      );
    }
  } else if (finalLegGal < 0 && !tankFlagged) {
    flags.push(
      `Tank won't reach the end of the route — even filling at every planned stop, it runs dry about ${round1(Math.abs(finalLegGal) * effMpg)} mi short. A closer fuel stop is needed.`,
    );
  } else if (finalLegGal >= 0 && finalLegGal < reserveGal && allFuel.length > 0) {
    flags.push("Plan finishes under the reserve floor — you'll arrive on fumes. A splash at the last stop fixes it.");
  }

  // --- 30-minute break -------------------------------------------------------
  const breakDueMi = input.hos.hasData ? round1(Math.max(0, input.hos.breakRemainH) * pace) : null;
  let breakPick: StopPlan["breakPick"] = null;
  if (breakDueMi != null) {
    const eligible: (PlannerCandidate | DriverStop)[] = [
      ...sorted.filter((s) => s.alongMi <= input.routeMiles + 0.5),
      ...input.driverStops.filter((d) => d.kind !== "fuel"),
    ];
    const before = eligible.filter((s) => s.alongMi <= breakDueMi).sort((a, b) => b.alongMi - a.alongMi);
    const after = eligible.filter((s) => s.alongMi > breakDueMi).sort((a, b) => a.alongMi - b.alongMi);
    const pick = before[0] ?? after[0] ?? null;
    if (pick) {
      const fuelThere = decisions.find(
        (d) => (d.action === "FILL" || d.action === "SPLASH") && Math.abs(d.stop.alongMi - pick.alongMi) <= Math.max(2, pace * 0.25),
      );
      breakPick = { stop: pick, combinedWithFuel: !!fuelThere };
      if (pick.alongMi > breakDueMi) {
        const lateMin = Math.round(((pick.alongMi - breakDueMi) / pace) * 60);
        flags.push(
          `Break comes due about ${lateMin} min before ${pick.name} — the closest stop to the break point is past when the 30-minute break is due. Take the break earlier or pick a sooner stop.`,
        );
      }
    } else {
      flags.push("No stop on the route data sits near the 30-minute break point — add a rest stop where you'll take it.");
    }
  }

  // --- Stop for the day --------------------------------------------------------
  const dayLimitH = input.hos.hasData ? Math.min(input.hos.driveRemainH, input.hos.windowRemainH) : null;
  const dayDueMi = dayLimitH != null ? round1(Math.max(0, dayLimitH) * pace) : null;
  let dayPick: StopPlan["dayPick"] = null;
  if (dayDueMi != null) {
    const parkable = (s: PlannerCandidate | DriverStop): boolean => {
      if ((s as DriverStop).kind === "sleeper" || (s as DriverStop).kind === "rest") return true;
      const c = s as PlannerCandidate;
      return c.kind !== "fuel" || c.truckParking !== false;
    };
    const eligible: (PlannerCandidate | DriverStop)[] = [
      ...sorted.filter((s) => s.alongMi <= input.routeMiles + 0.5),
      ...input.driverStops.filter((d) => d.kind === "sleeper" || d.kind === "rest"),
    ].filter(parkable);
    const within = eligible.filter((s) => s.alongMi <= dayDueMi).sort((a, b) => b.alongMi - a.alongMi);
    const beyond = eligible.filter((s) => s.alongMi > dayDueMi).sort((a, b) => a.alongMi - b.alongMi);
    const pick = within[0] ?? null;
    if (pick) {
      dayPick = { stop: pick };
    } else if (beyond[0]) {
      flags.push(
        `No parking stop on the route data is reachable before the driving clock runs out — the first one (${beyond[0].name}) is past it. Shut down earlier than planned or add a stop.`,
      );
    } else {
      flags.push("No parking stop on the route data for tonight — add a sleeper or rest stop where you'll shut down.");
    }
  }

  // --- Driver-added stop feasibility -------------------------------------------
  for (const d of input.driverStops) {
    if (d.alongMi > input.routeMiles + 0.5) {
      flags.push(`Your stop at ${d.name} sits past the end of this route (${round1(d.alongMi)} mi in on a ${round1(input.routeMiles)} mi route) — it isn't on this run.`);
    }
    if ((d.kind === "rest" || d.kind === "sleeper") && breakDueMi != null && d.alongMi > breakDueMi) {
      const lateMin = Math.round(((d.alongMi - breakDueMi) / pace) * 60);
      if (lateMin >= 10) {
        flags.push(`Break comes due about ${lateMin} min before your stop at ${d.name} — the 30-minute break lands first.`);
      }
    }
    if (d.kind === "sleeper" && dayDueMi != null && d.alongMi > dayDueMi) {
      const lateMin = Math.round(((d.alongMi - dayDueMi) / pace) * 60);
      flags.push(`Your shutdown stop at ${d.name} is about ${lateMin} min past where the driving clock runs out — it isn't reachable on today's clock.`);
    }
  }

  // --- Timeline ------------------------------------------------------------------
  const timeline: TimelineEntry[] = [];
  for (const d of decisions) {
    if (d.action === "SKIP") continue;
    timeline.push({
      key: `fuel-${d.stop.id}`,
      alongMi: d.stop.alongMi,
      name: d.stop.name,
      kind: "fuel",
      title: `${d.action} — ${d.stop.name}`,
      detail: `Buy ~${d.buyGal} gal · arrive at ~${d.arrivalPct}% · ${d.reason}`,
    });
  }
  if (breakPick) {
    timeline.push({
      key: `break-${breakPick.stop.id ?? breakPick.stop.name}`,
      alongMi: breakPick.stop.alongMi,
      name: breakPick.stop.name,
      kind: "break",
      title: `30-min break — ${breakPick.stop.name}`,
      detail: breakPick.combinedWithFuel
        ? "Combined with a fuel stop — one stop covers the break and the tank, and the plan says so."
        : "Your 30-minute break lands here, placed off your HOS break clock at the stop nearest the due point.",
    });
  }
  if (dayPick) {
    const c = dayPick.stop as PlannerCandidate;
    const spaces = typeof c.parkingSpaces === "number" ? `${c.parkingSpaces} truck spaces in map data` : "Parking spaces: not in map data";
    timeline.push({
      key: `day-${dayPick.stop.id ?? dayPick.stop.name}`,
      alongMi: dayPick.stop.alongMi,
      name: dayPick.stop.name,
      kind: "day",
      title: `Stop for the day — ${dayPick.stop.name}`,
      detail: `Shut down here so tomorrow starts clean. ${spaces}. Sleeper / rest options are on this stop's card.`,
    });
  }
  for (const d of input.driverStops) {
    if (timeline.some((t) => t.alongMi === d.alongMi && t.name === d.name)) continue;
    timeline.push({
      key: `driver-${d.id}`,
      alongMi: d.alongMi,
      name: d.name,
      kind: d.kind,
      title: `Your stop — ${d.name}`,
      detail: d.kind === "fuel" ? "Your added fuel stop." : d.kind === "rest" ? "Your added rest stop." : "Your added sleeper stop.",
    });
  }
  timeline.sort((a, b) => a.alongMi - b.alongMi);

  return {
    effMpg: Math.round(effMpg * 100) / 100,
    burnFactor,
    usesLoadPay: resolvedTime.source === "load",
    timeValuePerHour: resolvedTime.perHour != null ? Math.round(resolvedTime.perHour * 100) / 100 : null,
    timeValueSource: resolvedTime.source,
    rangeMi: round1(usableRangeMi(input.tankPct, capacity, input.baseMpg, input.loadWeightLbs, reservePct)),
    fuelDecisions: decisions,
    breakPick,
    breakDueMi,
    dayPick,
    dayDueMi,
    timeline,
    flags,
  };
}
