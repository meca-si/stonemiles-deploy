// loadStopChain.ts — the load STOP CHAIN (2026-11-24 follow-up,
// x's report: "When it routed the load it doesn't have the pick up
// and the fuel on the route only the drop off").
//
// Routing a load must produce a chain of stops, not a single
// destination: driver → PICKUP → the stop plan's stops (fuel with
// its FILL/SPLASH + gallons call, break, rest) → DELIVERY. This
// module is the pure builder every surface shares — the router
// (via-points), the Drive map pins, the Drive stop list, and the
// load-flow panel all read the SAME chain, so what the driver sees
// listed is exactly what the line passes through.
//
// The mid stops are the planner's own picks (autoAddStops.ts —
// buildStopPlan / selectAutoAddStops output); nothing is invented
// here. The pickup rides the chain only while the load is still
// Booked: once the load's status moves past pickup, the pickup is
// marked done and drops out of the via-points, so the route never
// bends back to the shipper.

import type { AutoAddStop } from "./autoAddStops";

export type LatLon = { lat: number; lon: number };

export type ChainStopKind = "pickup" | "fuel" | "break" | "rest" | "delivery";

export interface ChainStop {
  kind: ChainStopKind;
  /** Display label, e.g. "Pickup — BRWY", "Fuel — Love's #379",
   *  "Delivery — Montgomery, AL". */
  label: string;
  /** The place's own name (stop name / city label). */
  name: string;
  lat: number | null;
  lon: number | null;
  /** Miles along the route, when known. */
  alongMi: number | null;
  /** Fuel stops only: the planner's call ("FILL" / "SPLASH"). */
  action: string | null;
  /** Fuel stops only: gallons the planner says to buy. */
  buyGal: number | null;
  /** Pickup only: true once the load's status is past pickup. A
   *  done pickup stays visible in the list (marked) but never
   *  becomes a via-point again. */
  done: boolean;
}

export interface ChainPlace {
  label: string;
  lat: number | null;
  lon: number | null;
  /** Miles along the current route, when the caller can project
   *  the place onto it — used to order the via-points. */
  alongMi?: number | null;
}

const midKind = (s: AutoAddStop): ChainStopKind =>
  s.kinds.includes("fuel") ? "fuel" : s.kinds.includes("break") ? "break" : "rest";

const midLabel = (s: AutoAddStop): string => {
  const head = s.kinds.includes("fuel")
    ? "Fuel"
    : s.kinds.includes("break")
      ? "Break"
      : "Rest";
  return `${head} — ${s.name}`;
};

/**
 * Build the ordered stop chain for a routed load.
 *
 * - `pickup`: the load's pickup place, or null when the load
 *   carries none on this surface (display lists can still be built
 *   from the mid stops + delivery).
 * - `pickupDone`: the load's status is past pickup — the pickup
 *   renders as done and is excluded from `via`.
 * - `midStops`: the planner's routed picks (AutoAddStop[]), any
 *   order — the chain sorts them along the route.
 * - `delivery`: the load's delivery place (the route destination).
 *
 * Returns `stops` (display order, delivery last) and `via` (the
 * ordered through-points a route request must pass: pickup while
 * pending, then the mid stops — never the delivery, never a done
 * pickup, never a place without coordinates).
 */
export function buildLoadStopChain(args: {
  pickup: ChainPlace | null;
  pickupDone: boolean;
  midStops: AutoAddStop[];
  delivery: ChainPlace;
}): { stops: ChainStop[]; via: LatLon[] } {
  const stops: ChainStop[] = [];
  if (args.pickup) {
    stops.push({
      kind: "pickup",
      label: `Pickup — ${args.pickup.label}`,
      name: args.pickup.label,
      lat: args.pickup.lat,
      lon: args.pickup.lon,
      alongMi: args.pickup.alongMi ?? null,
      action: null,
      buyGal: null,
      done: args.pickupDone,
    });
  }
  const mids = [...args.midStops].sort((a, b) => a.alongMi - b.alongMi);
  for (const s of mids) {
    stops.push({
      kind: midKind(s),
      label: midLabel(s),
      name: s.name,
      lat: s.lat,
      lon: s.lon,
      alongMi: s.alongMi,
      action: s.kinds.includes("fuel") ? fuelActionOf(s) : null,
      buyGal: s.kinds.includes("fuel") ? s.buyGal : null,
      done: false,
    });
  }
  stops.push({
    kind: "delivery",
    label: `Delivery — ${args.delivery.label}`,
    name: args.delivery.label,
    lat: args.delivery.lat,
    lon: args.delivery.lon,
    alongMi: null,
    action: null,
    buyGal: null,
    done: false,
  });
  return { stops, via: chainViaPoints(stops) };
}

/** The planner's FILL/SPLASH call for a routed fuel stop. The
 *  AutoAddStop shape carries the decision in its price/buy fields
 *  only implicitly (a buy with gallons = the stop the plan depends
 *  on); the routed selection only ever contains the plan's FILL
 *  pick (see pickFuelStop in autoAddStops.ts), so a routed fuel
 *  stop with gallons is a FILL. Kept as one seam so a future
 *  SPLASH-carrying selection changes exactly here. */
function fuelActionOf(s: AutoAddStop): string | null {
  return s.buyGal != null && s.buyGal > 0 ? "FILL" : null;
}

/** The via-points of a built chain, in route order. */
export function chainViaPoints(stops: ChainStop[]): LatLon[] {
  const out: LatLon[] = [];
  for (const s of stops) {
    if (s.kind === "delivery") continue;
    if (s.kind === "pickup" && s.done) continue;
    if (s.lat == null || s.lon == null) continue;
    out.push({ lat: s.lat, lon: s.lon });
  }
  return out;
}

/**
 * Merge a pending pickup point into an existing via list, ordered
 * along the route. Every point may carry its along-route miles;
 * the pickup goes where its miles put it (a fuel stop on the
 * deadhead leg stays BEFORE the pickup; the usual case — pickup
 * first — falls out of the same sort). A pickup with unknown miles
 * leads the list; a stop with unknown miles keeps its given order
 * after the mile-known stops. With no pickup pending, the list is
 * returned as-is (bare points, miles stripped).
 */
export function orderViaPoints(
  pickup: (LatLon & { alongMi: number | null }) | null,
  others: (LatLon & { alongMi?: number | null })[],
): LatLon[] {
  const bare = others.map((o) => ({ lat: o.lat, lon: o.lon }));
  if (!pickup) return bare;
  const keyed: { lat: number; lon: number; key: number; seq: number }[] = [
    { lat: pickup.lat, lon: pickup.lon, key: pickup.alongMi ?? -1, seq: -1 },
    ...others.map((o, i) => ({
      lat: o.lat,
      lon: o.lon,
      key: o.alongMi ?? Number.MAX_SAFE_INTEGER,
      seq: i,
    })),
  ];
  keyed.sort((a, b) => (a.key - b.key) || (a.seq - b.seq));
  return keyed.map((k) => ({ lat: k.lat, lon: k.lon }));
}
