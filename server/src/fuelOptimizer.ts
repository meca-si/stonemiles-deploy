// fuelOptimizer.ts — route fuel optimizer (ex-tax / IFTA-adjusted)
// + fuel-card geofence fraud controls (Research Wave 2 item 8).
// Pure logic + the partner seam; the actions in actions.ts wire
// these to the DB, the chain, and the exception queue.
//
// THE OPTIMIZER extends the Net-Price Fuel Planner (which ranks
// the stops on a corridor by NET = pump − purchase-state IFTA
// tax) into a whole-route purchase plan: how many gallons to take
// at which stop, figured on the same ex-tax math. IFTA settles tax
// on where fuel is BURNED, not where it is bought, so a trip's true
// fuel cost is:
//
//     Σ gallons bought × pump price            (cash at the pump)
//   + Σ gallons burned per state × that state's tax   (owed)
//   − Σ gallons bought per state × that state's tax   (credit)
//
// The burn term is fixed by the route itself, so minimizing true
// cost is minimizing Σ gallons × (pump − tax) — buy where the
// BASE (ex-tax) price is lowest, not where the pump price is
// lowest. The plan runs that greedy twice: once ranked by base
// price (the plan), once ranked by pump price (the naive plan a
// driver eyeballing pump prices would follow), and reports the
// difference as an ESTIMATE.
//
// HONESTY RULES (x's standing rules, owner-locked):
// - Paid data feeds wait for revenue (x, 2026-11-05): every price
//   here is an ESTIMATE from the app's existing evidence — the
//   driver's own fuel log and labelled driver reports — and rides
//   with its source label. A stop with no price on file is never
//   given one: it stays out of the ranking and serves only as a
//   fallback the tank can be forced to, its gallons counted as
//   unpriced. A stop whose state tax isn't loaded can't be ranked
//   either — NET can't be figured honestly without the tax.
// - State diesel tax rates are public facts (the IFTA, Inc. fuel
//   tax matrix); the table below is stamped with its as-of date
//   wherever it is shown.
// - Tank discipline: a plan never lets the tank fall below the
//   driver's reserve, never buys past tank capacity, and never
//   buys more than the rest of the route burns (plus the reserve
//   it must land with). A stretch no stop can cover is flagged as
//   a range gap, never papered over.
//
// THE GEOFENCE CHECK compares a fuel purchase's location against
// the truck's recorded position near that time (the track points
// the device uploads — the same track the sealed trip records are
// built from). Past the printed threshold it raises a POSSIBLE
// mismatch — "check it", with the evidence attached — into the
// exception queue (kind fuel_card_mismatch, managed by this flow
// the way tender_blocked / dq_blocked are managed by theirs; its
// loadId carries the fuel purchase id) plus an in-app
// notification. It never declines, blocks, or accuses: a station
// location or a position reading can be off, and the flag says
// exactly that. Purchases whose station has no location on file,
// or with no truck position near the time, are NOT checked — the
// result says so instead of implying a pass. When a fuel-card
// partner is connected (the seam below), the same evaluation
// consumes the partner's transaction feed; with no partner
// configured it runs on the driver's logged purchases, which are
// records the app already has.

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** A diesel price outside the plausible band is not evidence —
 *  it becomes "no price on file" rather than a figure the plan
 *  could stand on. Applied in the module itself so no caller can
 *  feed the math a junk price. */
export const DIESEL_PRICE_BAND = { min: 0.5, max: 15 } as const;
const sanePrice = (price: number | null | undefined): number | null =>
  price != null && Number.isFinite(price) && price >= DIESEL_PRICE_BAND.min && price <= DIESEL_PRICE_BAND.max
    ? price
    : null;

// ---------------------------------------------------------------------------
// State diesel tax table — public facts, dated. Moved here from
// actions.ts (Wave 2 item 8) so the optimizer and every existing
// IFTA surface read ONE maintained table; actions.ts imports it
// back under its historical names.
// ---------------------------------------------------------------------------

// IFTA diesel tax rates ($/gallon, the matrix's "Special Diesel"
// column, US$ per gallon — Canadian provinces at the matrix's own
// US$/gal equivalents) — the REAL published table: IFTA, Inc. fuel
// tax matrix, 4th quarter 2026 (Oct–Dec 2026), matrix dated
// October 15, 2026, updated by IFTA, Inc. November 5, 2026
// (https://www.iftach.org/taxmatrix4/Taxmatrix.php). IFTA marks the
// Q4 2026 matrix "not final until December 4, 2026" — the report
// labels that on screen and in every export. Kentucky and Virginia
// carry their IFTA surcharge folded into the figure shown
// (KY 0.2200 + 0.1050; VA 0.3360 + 0.1430), labelled in the report.
// Oregon is 0: the matrix prints no Oregon fuel-tax rate (Oregon
// runs a weight-mile tax instead of IFTA fuel tax). Alaska, Hawaii,
// and the District of Columbia are NOT IFTA member jurisdictions —
// they are deliberately ABSENT, so a quarter touching them reads
// "rate not loaded" rather than borrowing a non-IFTA number.
export const DIESEL_TAX_RATES: Record<string, number> = {
  Alabama: 0.31, Arizona: 0.26, Arkansas: 0.285, California: 0.979,
  Colorado: 0.335, Connecticut: 0.499, Delaware: 0.22, Florida: 0.4097,
  Georgia: 0.373, Idaho: 0.32, Illinois: 0.738, Indiana: 0.63,
  Iowa: 0.325, Kansas: 0.26, Kentucky: 0.325, Louisiana: 0.20,
  Maine: 0.312, Maryland: 0.4745, Massachusetts: 0.24, Michigan: 0.524,
  Minnesota: 0.326, Mississippi: 0.24, Missouri: 0.295, Montana: 0.2975,
  Nebraska: 0.318, Nevada: 0.27, "New Hampshire": 0.222, "New Jersey": 0.561,
  "New Mexico": 0.21, "New York": 0.3805, "North Carolina": 0.41,
  "North Dakota": 0.23, Ohio: 0.47, Oklahoma: 0.19, Oregon: 0,
  Pennsylvania: 0.741, "Rhode Island": 0.40, "South Carolina": 0.28,
  "South Dakota": 0.28, Tennessee: 0.27, Texas: 0.20, Utah: 0.379,
  Vermont: 0.31, Virginia: 0.479, Washington: 0.595, "West Virginia": 0.357,
  Wisconsin: 0.329, Wyoming: 0.24,
  Alberta: 0.3509, "British Columbia": 0.4049, Manitoba: 0.3374,
  "New Brunswick": 0.417, "Newfoundland and Labrador": 0.2564,
  "Nova Scotia": 0.4157, Ontario: 0.243, "Prince Edward Island": 0.3819,
  Quebec: 0.5452, Saskatchewan: 0.4049,
};

/** Short as-of stamp for plan surfaces. */
export const DIESEL_TAX_RATES_AS_OF =
  "IFTA, Inc. fuel tax matrix, 4th quarter 2026 (Oct–Dec 2026)";

export const IFTA_RATES_DATE_LABEL =
  "Rates as of the IFTA, Inc. fuel tax matrix, 4th quarter 2026 (Oct–Dec 2026) — matrix dated October 15, 2026, updated November 5, 2026; IFTA marks it not final until December 4, 2026, and rates change quarterly, so verify against the official matrix for the quarter you file. Kentucky and Virginia figures include their IFTA surcharge. Oregon has no IFTA fuel tax (weight-mile tax instead) and is shown at 0. Alaska, Hawaii, and DC are not IFTA members — no rate is loaded for them. Estimate for planning only — not a filing and not tax advice.";

/** States that also levy an IFTA surcharge on top of the matrix
 *  rate — the surcharge earns no purchase credit, so fuel bought
 *  there is a little worse than its net price looks (flagged on
 *  plan surfaces, not figured into the math — the same treatment
 *  the Net-Price Planner has always given it). */
export const DIESEL_SURCHARGE_STATES: ReadonlySet<string> = new Set([
  "Indiana",
  "Kentucky",
  "Virginia",
]);

/** The diesel tax for a state, or null when no rate is loaded
 *  (Alaska / Hawaii / DC / unknown) — null is NEVER read as 0.
 *  Oregon's 0 is a real loaded rate and returns 0. */
export function dieselTaxRateFor(state: string | null | undefined): number | null {
  if (!state) return null;
  const rate = DIESEL_TAX_RATES[state];
  return rate == null ? null : rate;
}

// ---------------------------------------------------------------------------
// Route + stops — the optimizer's inputs
// ---------------------------------------------------------------------------

export interface FuelPlanSegment {
  /** Full state name, matching the tax table's keys. */
  state: string;
  miles: number;
}

export interface FuelPlanStop {
  id: string;
  name: string;
  /** Full state name, or null when the stop's state isn't pinned. */
  state: string | null;
  /** Miles along the route from the start. */
  alongMi: number;
  /** Pump price ESTIMATE ($/gal) from the app's price evidence,
   *  or null when no price is on file for this stop. */
  price: number | null;
  /** The evidence's honest source label (grade + age), echoed
   *  back on the plan — never rewritten, never "live". */
  priceSource: string | null;
}

export interface FuelPlanInput {
  totalMiles: number;
  /** Burn segmentation of the route, in order. May be empty when
   *  the caller couldn't segment the route — the plan then prices
   *  purchases but reports no IFTA settlement. */
  segments: FuelPlanSegment[];
  stops: FuelPlanStop[];
  mpg: number;
  tankCapacityGal: number;
  startGallons: number;
  reserveGallons: number;
}

/**
 * Derive a state segmentation from the corridor stops themselves
 * when the caller has no real segmentation: each stop's state is
 * taken to run from the midpoint of the gap before it to the
 * midpoint of the gap after it (the first stop's state runs from
 * mile 0, the last stop's to the route end). An approximation for
 * planning, labelled as such wherever the settlement is shown —
 * the sealed trip sheet stays the IFTA record. Stops without a
 * state are skipped; with no stated stops there is nothing to
 * derive and the result is empty.
 */
export function segmentsFromStops(
  stops: readonly FuelPlanStop[],
  totalMiles: number,
): FuelPlanSegment[] {
  const stated = stops
    .filter((s) => s.state != null && s.alongMi >= 0 && s.alongMi <= totalMiles)
    .sort((a, b) => a.alongMi - b.alongMi);
  if (stated.length === 0 || !(totalMiles > 0)) return [];
  const segments: FuelPlanSegment[] = [];
  for (let i = 0; i < stated.length; i++) {
    const start = i === 0 ? 0 : (stated[i - 1]!.alongMi + stated[i]!.alongMi) / 2;
    const end =
      i === stated.length - 1 ? totalMiles : (stated[i]!.alongMi + stated[i + 1]!.alongMi) / 2;
    if (end <= start) continue;
    const last = segments[segments.length - 1];
    if (last && last.state === stated[i]!.state) last.miles += end - start;
    else segments.push({ state: stated[i]!.state!, miles: end - start });
  }
  return segments;
}

// ---------------------------------------------------------------------------
// The purchase simulation — one greedy, two ranking keys
// ---------------------------------------------------------------------------

interface SimStop extends FuelPlanStop {
  /** Purchase-state IFTA tax, null when not loaded. */
  tax: number | null;
  /** Ex-tax (base) price: pump − tax. Null when either is missing. */
  base: number | null;
  surcharge: boolean;
}

export interface FuelPlanPurchase {
  stopId: string;
  name: string;
  state: string | null;
  alongMi: number;
  gallons: number;
  /** Pump price paid ($/gal), null when the stop had no price on
   *  file — those gallons are counted, never costed. */
  price: number | null;
  priceSource: string | null;
  /** Ex-tax price ($/gal), null when it can't be figured. */
  basePrice: number | null;
  taxPerGal: number | null;
  surcharge: boolean;
  /** gallons × pump price; null when the price is unknown. */
  cost: number | null;
  /** Why the plan buys here — plain words for the driver. */
  why: string;
}

export interface FuelPlanStopVerdict {
  stopId: string;
  /** Gallons the (optimized) plan takes here; 0 = pass it by. */
  buyGallons: number;
  /** Why — for skipped stops, why the plan passes them by. */
  why: string;
}

export interface FuelPlanTotals {
  /** Cash at the pump for the purchases whose price is known. */
  pumpCost: number;
  /** Gallons bought at stops with no price on file (never costed). */
  unpricedGallons: number;
  /** IFTA settlement over the route's burn: tax owed on burn
   *  minus purchase credits. Positive = owed at filing. Null when
   *  it can't be figured completely (a burn state's rate isn't
   *  loaded, or a purchase state's rate isn't loaded). */
  iftaSettlement: number | null;
  /** pumpCost + settlement — the trip's true fuel cost. Null
   *  unless every figure behind it is known. */
  netTripCost: number | null;
  totalGallons: number;
}

interface SimResult {
  purchases: FuelPlanPurchase[];
  verdicts: FuelPlanStopVerdict[];
  totals: FuelPlanTotals;
  rangeGaps: { fromMi: number; toMi: number }[];
}

/** The ranking key a simulation follows: "base" ranks by ex-tax
 *  price (the optimizer), "pump" by pump price (the naive plan). */
type RankKey = "base" | "pump";

function keyOf(stop: SimStop, rank: RankKey): number | null {
  return rank === "base" ? stop.base : stop.price;
}

function simulate(input: FuelPlanInput, stops: SimStop[], rank: RankKey): SimResult {
  const { totalMiles, mpg, tankCapacityGal, reserveGallons } = input;
  const capacity = Math.max(0, tankCapacityGal);
  const reserve = Math.min(Math.max(0, reserveGallons), capacity);
  let fuel = Math.min(Math.max(0, input.startGallons), capacity);
  const purchases: FuelPlanPurchase[] = [];
  const boughtAt = new Map<string, FuelPlanPurchase>();
  const rangeGaps: { fromMi: number; toMi: number }[] = [];

  const nodes = stops.map((s) => ({ stop: s as SimStop | null, at: s.alongMi }));
  nodes.push({ stop: null, at: totalMiles }); // destination

  const keyAt = (idx: number): number | null => {
    const n = nodes[idx];
    return n && n.stop ? keyOf(n.stop, rank) : null;
  };

  let prevAt = 0;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    // Drive from the previous node to this one.
    const dist = Math.max(0, node.at - prevAt);
    fuel -= dist / mpg;
    if (fuel < reserve - 1e-9 && dist > 0) {
      // Even the plan's buying couldn't keep the reserve across
      // this stretch (a gap between stops longer than a tank, or
      // a start below reserve): flag it, don't paper over it.
      rangeGaps.push({ fromMi: Math.round(prevAt), toMi: Math.round(node.at) });
      fuel = Math.max(fuel, 0);
    }
    prevAt = node.at;
    const stop = node.stop;
    if (!stop) break; // destination — nothing to buy

    const myKey = keyOf(stop, rank);
    const remainingBurn = Math.max(0, (totalMiles - stop.alongMi) / mpg);
    let buy = 0;
    let why = "";
    if (myKey != null) {
      // A rankable stop: aim for the first cheaper stop ahead, or
      // the destination — buy enough to arrive there holding the
      // reserve, no more.
      let targetAt = totalMiles;
      for (let j = i + 1; j < nodes.length; j++) {
        const k = keyAt(j);
        if (k != null && k < myKey - 1e-9) {
          targetAt = nodes[j]!.at;
          break;
        }
      }
      const need = (targetAt - stop.alongMi) / mpg + reserve - fuel;
      buy = Math.min(need, capacity - fuel, remainingBurn + reserve - fuel);
      why =
        targetAt === totalMiles
          ? "Best price for the rest of this run — take what the remaining miles burn."
          : "Cheapest reachable price for this stretch — buy enough to get to the cheaper stop ahead, reserve kept.";
    } else {
      // Not rankable (no price on file, or its state tax isn't
      // loaded): buy ONLY the shortfall that keeps the reserve
      // until the next rankable stop (or the destination).
      let targetAt = totalMiles;
      for (let j = i + 1; j < nodes.length; j++) {
        if (keyAt(j) != null) {
          targetAt = nodes[j]!.at;
          break;
        }
      }
      const need = (targetAt - stop.alongMi) / mpg + reserve - fuel;
      buy = Math.min(Math.max(0, need), capacity - fuel, remainingBurn + reserve - fuel);
      why =
        stop.price == null
          ? "No price on file here — the plan only stops when the tank forces it, and those gallons stay unpriced."
          : "Price on file but this state's IFTA tax isn't loaded, so its net price can't be figured — the plan only stops when the tank forces it.";
    }
    buy = Math.max(0, Math.round(buy * 10) / 10);
    if (buy > 0) {
      fuel += buy;
      const purchase: FuelPlanPurchase = {
        stopId: stop.id,
        name: stop.name,
        state: stop.state,
        alongMi: stop.alongMi,
        gallons: buy,
        price: stop.price,
        priceSource: stop.priceSource,
        basePrice: stop.base,
        taxPerGal: stop.tax,
        surcharge: stop.surcharge,
        cost: stop.price != null ? round2(buy * stop.price) : null,
        why,
      };
      purchases.push(purchase);
      boughtAt.set(stop.id, purchase);
    }
  }

  // IFTA settlement over the route's burn.
  let owed = 0;
  let settlementKnown = input.segments.length > 0;
  for (const seg of input.segments) {
    const rate = dieselTaxRateFor(seg.state);
    if (rate == null) {
      settlementKnown = false;
      break;
    }
    owed += (seg.miles / mpg) * rate;
  }
  let credit = 0;
  if (settlementKnown) {
    for (const p of purchases) {
      if (p.taxPerGal == null) {
        settlementKnown = false;
        break;
      }
      credit += p.gallons * p.taxPerGal;
    }
  }
  const iftaSettlement = settlementKnown ? round2(owed - credit) : null;
  const pumpCost = round2(
    purchases.reduce((sum, p) => sum + (p.cost ?? 0), 0),
  );
  const unpricedGallons = round3(
    purchases.filter((p) => p.price == null).reduce((sum, p) => sum + p.gallons, 0),
  );
  const totalGallons = round3(purchases.reduce((sum, p) => sum + p.gallons, 0));
  const netTripCost =
    iftaSettlement != null && unpricedGallons === 0 ? round2(pumpCost + iftaSettlement) : null;

  const verdicts: FuelPlanStopVerdict[] = stops.map((s) => {
    const bought = boughtAt.get(s.id);
    if (bought) return { stopId: s.id, buyGallons: bought.gallons, why: bought.why };
    if (s.price == null) {
      return {
        stopId: s.id,
        buyGallons: 0,
        why: "No price on file for this stop — the plan can't rank it, and nothing is invented to fill the gap.",
      };
    }
    if (rank === "base" && s.base == null) {
      return {
        stopId: s.id,
        buyGallons: 0,
        why: "Price on file, but this state's IFTA tax isn't loaded — its net price can't be figured honestly, so the plan doesn't rank it.",
      };
    }
    return {
      stopId: s.id,
      buyGallons: 0,
      why: "No need to buy here — what's in the tank and the prices ahead cover this stretch.",
    };
  });

  return {
    purchases,
    verdicts,
    totals: { pumpCost, unpricedGallons, iftaSettlement, netTripCost, totalGallons },
    rangeGaps,
  };
}

// ---------------------------------------------------------------------------
// The plan — optimized vs naive, with the honesty notes attached
// ---------------------------------------------------------------------------

export interface FuelPlan {
  purchases: FuelPlanPurchase[];
  verdicts: FuelPlanStopVerdict[];
  totals: FuelPlanTotals;
  /** The same route planned by pump price alone (the naive plan). */
  naive: { purchases: FuelPlanPurchase[]; totals: FuelPlanTotals };
  /** naive.netTripCost − totals.netTripCost — what the ex-tax
   *  math saves on this route. An ESTIMATE, and null unless both
   *  plans costed completely. */
  savingsEstimate: number | null;
  notes: string[];
  /** The state split the settlement stands on: "segments" when the
   *  caller supplied it, "stops" when derived from the stops'
   *  states, "none" when there is no split (no settlement). */
  segmentsSource: "segments" | "stops" | "none";
  ratesAsOf: string;
  ratesLabel: string;
}

export function planRouteFuel(input: FuelPlanInput): FuelPlan {
  const stops: SimStop[] = input.stops
    .filter((s) => s.alongMi >= 0 && s.alongMi <= input.totalMiles)
    .sort((a, b) => a.alongMi - b.alongMi)
    .map((s) => {
      const tax = dieselTaxRateFor(s.state);
      const price = sanePrice(s.price);
      return {
        ...s,
        price,
        tax,
        base: price != null && tax != null ? round3(price - tax) : null,
        surcharge: s.state != null && DIESEL_SURCHARGE_STATES.has(s.state),
      };
    });

  let segments = input.segments.filter((s) => s.miles > 0);
  let segmentsSource: FuelPlan["segmentsSource"] = segments.length > 0 ? "segments" : "none";
  if (segments.length === 0) {
    segments = segmentsFromStops(input.stops, input.totalMiles);
    if (segments.length > 0) segmentsSource = "stops";
  }
  const effective: FuelPlanInput = { ...input, segments };

  const optimized = simulate(effective, stops, "base");
  const naive = simulate(effective, stops, "pump");

  const savingsEstimate =
    optimized.totals.netTripCost != null && naive.totals.netTripCost != null
      ? round2(naive.totals.netTripCost - optimized.totals.netTripCost)
      : null;

  const notes: string[] = [];
  notes.push(
    "Every price in this plan is an estimate from your fuel log and labelled driver reports — no live feed, and no price is invented for a stop that has none.",
  );
  if (optimized.purchases.length === 0 && optimized.rangeGaps.length === 0) {
    notes.push("Your starting fuel covers this run inside the reserve — the plan buys nothing.");
  }
  if (optimized.totals.unpricedGallons > 0) {
    notes.push(
      `${optimized.totals.unpricedGallons} gal of this plan is bought at stops with no price on file — those gallons are counted but never costed, so no trip total is claimed.`,
    );
  }
  if (input.segments.length === 0 && segmentsSource === "stops") {
    notes.push(
      "The state split behind the IFTA settlement was figured from the stops' states along the route — close enough for planning; your sealed trip sheet stays the filing record.",
    );
  }
  if (optimized.totals.iftaSettlement == null && segmentsSource !== "none") {
    notes.push(
      "The IFTA settlement couldn't be figured completely — a state on this route has no rate loaded (Alaska, Hawaii, and DC are not IFTA members), so the plan shows pump cost only.",
    );
  }
  if (segmentsSource === "none") {
    notes.push(
      "No state split was available for this route, so no IFTA settlement is figured — pump cost only.",
    );
  }
  for (const gap of optimized.rangeGaps) {
    notes.push(
      `Range gap: no fuel stop on this corridor covers mile ${gap.fromMi} to ${gap.toMi} inside the reserve on one tank — plan a stop off-corridor there.`,
    );
  }
  if (stops.some((s) => s.surcharge && optimized.purchases.some((p) => p.stopId === s.id))) {
    notes.push(
      "A planned stop sits in a surcharge state (IN, KY, VA): the surcharge earns no IFTA purchase credit, so fuel bought there is a little worse than its net price looks — flagged, not figured.",
    );
  }

  return {
    purchases: optimized.purchases,
    verdicts: optimized.verdicts,
    totals: optimized.totals,
    naive: { purchases: naive.purchases, totals: naive.totals },
    savingsEstimate,
    notes,
    segmentsSource,
    ratesAsOf: DIESEL_TAX_RATES_AS_OF,
    ratesLabel: IFTA_RATES_DATE_LABEL,
  };
}

// ---------------------------------------------------------------------------
// Fuel-card geofence check — pure evaluation
// ---------------------------------------------------------------------------

/** A purchase farther than this from the truck's recorded
 *  position is flagged as a possible mismatch. Printed wherever
 *  the check is shown — it is a review line, not an accusation. */
export const FUEL_CARD_MISMATCH_THRESHOLD_MI = 25;

/** The truck position reading must sit within this window BEFORE
 *  the purchase to count as "the truck's position at that time" —
 *  an older reading proves nothing about the purchase moment. */
export const FUEL_POSITION_MAX_AGE_MIN = 240;

/** A station location from the price layer is used only when the
 *  report carrying it is no older than this at purchase time —
 *  stations move and reports go stale. */
export const FUEL_STATION_LOCATION_MAX_AGE_DAYS = 45;

export function haversineMi(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type FuelGeofenceStatus = "match" | "mismatch" | "not_checked";

export interface FuelGeofenceResult {
  status: FuelGeofenceStatus;
  /** Miles between the purchase and the truck's position; null
   *  when the check couldn't run. */
  distanceMi: number | null;
  /** Plain words: what was compared, or why nothing was. */
  reason: string;
}

/**
 * Compare one purchase event against the truck's recorded
 * position. Either side missing → "not_checked" with the reason —
 * never a silent pass. The caller resolves the two locations from
 * records (the price layer for the station, the track for the
 * truck) and applies the freshness windows above when picking
 * them; this function judges the pair it is handed.
 */
export function evaluateFuelGeofence(input: {
  purchaseLat: number | null;
  purchaseLon: number | null;
  truckLat: number | null;
  truckLon: number | null;
}): FuelGeofenceResult {
  if (input.purchaseLat == null || input.purchaseLon == null) {
    return {
      status: "not_checked",
      distanceMi: null,
      reason:
        "No location is on file for that station, so this purchase wasn't distance-checked.",
    };
  }
  if (input.truckLat == null || input.truckLon == null) {
    return {
      status: "not_checked",
      distanceMi: null,
      reason:
        "No recorded truck position near that time, so this purchase wasn't distance-checked.",
    };
  }
  const distance = haversineMi(input.purchaseLat, input.purchaseLon, input.truckLat, input.truckLon);
  const rounded = Math.round(distance * 10) / 10;
  if (distance > FUEL_CARD_MISMATCH_THRESHOLD_MI) {
    return {
      status: "mismatch",
      distanceMi: rounded,
      reason: `The purchase sits about ${rounded} mi from the truck's recorded position — past the ${FUEL_CARD_MISMATCH_THRESHOLD_MI} mi check line.`,
    };
  }
  return {
    status: "match",
    distanceMi: rounded,
    reason: `The purchase sits about ${rounded} mi from the truck's recorded position — inside the ${FUEL_CARD_MISMATCH_THRESHOLD_MI} mi check line.`,
  };
}

/** The exception-queue detail for a flagged purchase: the whole
 *  story in plain words, evidence first, accusation never. */
export function fuelCardMismatchDetail(args: {
  station: string | null;
  state: string | null;
  gallons: number | null;
  purchasedAtLabel: string;
  distanceMi: number;
  truckAtLabel: string;
}): string {
  const where = `${args.station ?? "An unnamed station"}${args.state ? `, ${args.state}` : ""}`;
  const amount = args.gallons != null ? ` of ${args.gallons} gal` : "";
  return (
    `Possible mismatch — check it. A fuel purchase${amount} at ${where}, logged ${args.purchasedAtLabel}, ` +
    `sits about ${args.distanceMi} mi from where the truck's recorded position put it at ${args.truckAtLabel} — ` +
    `past the ${FUEL_CARD_MISMATCH_THRESHOLD_MI} mi check line. It can mean a fuel card was used away from the truck, ` +
    `or that a station location or a position reading is off. Nothing was declined, blocked, or changed — this flag is the whole action.`
  );
}

/** Notification-center copy for a newly flagged purchase. */
export function fuelCardMismatchNotification(args: {
  station: string | null;
  state: string | null;
  distanceMi: number;
}): { title: string; body: string } {
  const where = `${args.station ?? "An unnamed station"}${args.state ? `, ${args.state}` : ""}`;
  return {
    title: "Fuel purchase to check — possible card mismatch",
    body: `${where} — the purchase sits about ${args.distanceMi} mi from the truck's recorded position, past the ${FUEL_CARD_MISMATCH_THRESHOLD_MI} mi check line. It is in the exception queue with its evidence attached. Nothing was declined or changed.`,
  };
}

// ---------------------------------------------------------------------------
// Fuel-card partner seam — in the style of factorPartnerFromEnv /
// parkingPartnerFromEnv: env-gated, transport injected, and the
// actions pass no transport, so production is unconfigured until
// a real fuel-card agreement + credentials exist. When one is
// configured, the SAME evaluateFuelGeofence check consumes the
// partner's transactions — a transaction is just a purchase event
// with its own location attached.
// ---------------------------------------------------------------------------

export interface FuelCardTransaction {
  partnerRef: string;
  /** ISO time of the card transaction. */
  at: string;
  station: string | null;
  state: string | null;
  lat: number | null;
  lon: number | null;
  gallons: number | null;
  amount: number | null;
}

export interface FuelCardPartner {
  name: string;
  /** The partner's transactions since an ISO time, normalized.
   *  Rows without a reference or a usable time are skipped —
   *  never guessed into shape. */
  fetchTransactions(sinceIso: string): Promise<FuelCardTransaction[]>;
}

/** The slice of fetch the partner transport uses (injectable for tests). */
export type FuelCardFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

export function normalizeFuelCardTransaction(raw: unknown): FuelCardTransaction | null {
  if (raw == null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const partnerRef = strOrNull(r.id) ?? strOrNull(r.reference) ?? strOrNull(r.transactionId);
  const at = strOrNull(r.at) ?? strOrNull(r.occurredAt) ?? strOrNull(r.timestamp);
  if (!partnerRef || !at || Number.isNaN(new Date(at).getTime())) return null;
  return {
    partnerRef,
    at: new Date(at).toISOString(),
    station: strOrNull(r.station),
    state: strOrNull(r.state),
    lat: numOrNull(r.lat),
    lon: numOrNull(r.lon),
    gallons: numOrNull(r.gallons),
    amount: numOrNull(r.amount),
  };
}

/**
 * The fuel-card partner, when one is configured. Needs BOTH
 * FUEL_CARD_API_KEY and FUEL_CARD_BASE_URL — a key alone names
 * no partner to call. Returns null when unconfigured: the caller
 * then runs the geofence check on the driver's logged purchases
 * only, and says so.
 */
export function fuelCardPartnerFromEnv(
  env: Record<string, string | undefined>,
  transport?: FuelCardFetch,
): FuelCardPartner | null {
  const apiKey = env.FUEL_CARD_API_KEY?.trim();
  const baseUrl = env.FUEL_CARD_BASE_URL?.trim();
  if (!apiKey || !baseUrl) return null;
  const name = env.FUEL_CARD_PARTNER_NAME?.trim() || "Fuel-card partner";
  const fetchFn: FuelCardFetch =
    transport ??
    (async (url, init) => {
      const r = await fetch(url, init);
      return { ok: r.ok, status: r.status, json: () => r.json() as Promise<unknown> };
    });
  return {
    name,
    async fetchTransactions(sinceIso) {
      const r = await fetchFn(
        `${baseUrl.replace(/\/+$/, "")}/transactions?since=${encodeURIComponent(sinceIso)}`,
        { method: "GET", headers: { authorization: `Bearer ${apiKey}` } },
      );
      if (!r.ok) throw new Error(`fuel-card partner answered ${r.status}`);
      const out = (await r.json()) as { transactions?: unknown } | unknown[];
      const rows = Array.isArray(out) ? out : Array.isArray(out.transactions) ? out.transactions : [];
      return rows
        .map((row) => normalizeFuelCardTransaction(row))
        .filter((t): t is FuelCardTransaction => t !== null);
    },
  };
}
