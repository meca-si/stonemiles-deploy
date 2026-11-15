/**
 * FLEET VISIBILITY + OUTWARD SHARING — pure rules module (TMS
 * completion queue item 4, approved by x 2026-11-15; gap-tools-spec
 * items 4–5).
 *
 * Two surfaces, one law each:
 *
 * FLEET BOARD (inside the walls): a fleet's owner + dispatch seats
 * see their own drivers' current load, route, and truck location.
 * The data arrives over the SHARE-UP PIPE: a driver's app publishes
 * a fleet-status snapshot (driver_fleet_status) naming their active
 * load, its lane, its ordered stops, the route end, and an ETA —
 * company tables were always the only cross-profile read in this
 * architecture, and the snapshot keeps it that way (a driver's
 * private load rows never leave their own profile scope; what the
 * fleet sees is what the driver's app published for the fleet).
 * Position itself still lives in driver_positions, and the standing
 * location-privacy rule still gates it server-side: coordinates
 * leave the server only while the driver is on duty or on an active
 * trip. A live published snapshot naming an undelivered load IS the
 * server-verifiable active-trip signal for another member's row
 * (their duty timeline is sealed in their own profile, exactly as
 * the Owner Console documents).
 *
 * ASSIGN RANKING (the deadhead purpose): when dispatch assigns the
 * next load, candidate trucks rank by the deadhead they will
 * actually drive — from the truck's ROUTE END when it is finishing
 * a load (a truck finishing near the pickup outranks an empty truck
 * sitting farther away), else from its current position. Distances
 * are straight-line haversine off coordinates the devices already
 * hold (the pickup is geocoded by the desk's client through the
 * app's existing geocode chain; the route end rides the snapshot
 * the driver's app published from its own planned route). Unknown
 * positions rank last and say so — never guessed.
 *
 * OUTWARD SHARE (outside the walls): an opt-in, per-load tracking
 * link (receive_links kind "track", extending the BOL receive-link
 * family). It shows route, stops, ETA, and the truck's location
 * WITH ITS FRESHNESS. It expires at delivery. And the standing
 * rate law holds unchanged: NO outward payload — this module, the
 * share actions, the public track page — ever carries a rate or
 * any money amount. The shapes below have no money fields at all.
 *
 * Every rule here is a pure function of its inputs (the
 * settlement.ts / invoicing.ts pattern) so it is unit-tested
 * without a database.
 */

const round1 = (n: number) => Math.round(n * 10) / 10;

export interface LatLonLike {
  lat: number;
  lon: number;
}

/** Straight-line distance in miles (the server's haversine twin). */
export function haversineMi(a: LatLonLike, b: LatLonLike): number {
  const R = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ---------------------------------------------------------------------------
// Freshness — a stale dot is never presented as live; every surface
// that shows a position prints how old it is.
// ---------------------------------------------------------------------------

export type FreshnessBucket = "live" | "recent" | "stale" | "none";

export interface Freshness {
  bucket: FreshnessBucket;
  /** Whole minutes since the fix, null when there is no fix. */
  ageMinutes: number | null;
  /** Plain label, e.g. "updated 2 min ago". */
  label: string;
}

const LIVE_WITHIN_MIN = 15;
const RECENT_WITHIN_MIN = 120;

export function freshnessFor(updatedAt: Date | null, now: Date): Freshness {
  if (!updatedAt) return { bucket: "none", ageMinutes: null, label: "No location reported yet" };
  const ageMin = Math.max(0, Math.floor((now.getTime() - updatedAt.getTime()) / 60000));
  const label =
    ageMin < 1
      ? "updated just now"
      : ageMin < 60
        ? `updated ${ageMin} min ago`
        : ageMin < 60 * 24
          ? `updated ${Math.floor(ageMin / 60)} h ${ageMin % 60} min ago`
          : `updated ${Math.floor(ageMin / (60 * 24))} d ago`;
  const bucket: FreshnessBucket =
    ageMin < LIVE_WITHIN_MIN ? "live" : ageMin < RECENT_WITHIN_MIN ? "recent" : "stale";
  return { bucket, ageMinutes: ageMin, label };
}

/**
 * How fresh a published fleet snapshot must be to count as the
 * driver's live in-fleet presence signal on the fleet board: the
 * driver's app republishes alongside its position reports while it
 * runs, so a snapshot older than this means the app has gone quiet
 * and the last fix must not pose as current sharing.
 */
export const SNAPSHOT_FRESH_MS = 30 * 60 * 1000;

export function snapshotFreshFor(publishedAt: Date | null, now: Date): boolean {
  if (!publishedAt) return false;
  return now.getTime() - publishedAt.getTime() <= SNAPSHOT_FRESH_MS;
}

// ---------------------------------------------------------------------------
// Plain load status for outward + fleet surfaces.
// ---------------------------------------------------------------------------

export function plainLoadStatus(status: string | null | undefined): string {
  switch (status) {
    case "booked":
      return "Booked — waiting for pickup";
    case "picked_up":
      return "Picked up — on the road";
    case "sealed":
      return "Delivered";
    default:
      return "In progress";
  }
}

/** "Dallas, TX → Memphis, TN" lane label from city/state parts. */
export function laneLabel(
  pickupCity: string | null,
  pickupState: string | null,
  deliveryCity: string | null,
  deliveryState: string | null,
): string {
  const side = (city: string | null, state: string | null, fallback: string) =>
    [city, state].filter(Boolean).join(", ") || fallback;
  return `${side(pickupCity, pickupState, "Pickup")} → ${side(deliveryCity, deliveryState, "Delivery")}`;
}

/** Clean a published stops list: trimmed labels, capped count/length. */
export function cleanStops(input: readonly string[] | null | undefined): string[] {
  if (!input) return [];
  return input
    .map((s) => (typeof s === "string" ? s.trim().slice(0, 80) : ""))
    .filter(Boolean)
    .slice(0, 20);
}

// ---------------------------------------------------------------------------
// Assign ranking by deadhead.
// ---------------------------------------------------------------------------

export interface AssignCandidateLike {
  username: string;
  /** Privacy-visible current position, or null when not visible. */
  currentPos: LatLonLike | null;
  /** The published route end of the driver's active load, if any. */
  routeEnd: LatLonLike | null;
  /** True while the driver is running a load (they start the next
   *  one from its route end, not from where they sit now). */
  hasActiveLoad: boolean;
}

export interface RankedCandidate extends AssignCandidateLike {
  /** Deadhead from the truck's current position to the pickup. */
  deadheadNowMi: number | null;
  /** Deadhead from the route end of the current load to the pickup. */
  deadheadEndMi: number | null;
  /** The deadhead the assignment would actually cost: route-end
   *  based for a truck finishing a load, current-position based
   *  for an empty truck, null when neither point is known. */
  effectiveMi: number | null;
  basis: "route_end" | "current" | "unknown";
  /** Plain explanation of the basis, for the desk. */
  basisLabel: string;
}

export function rankAssignCandidates(
  candidates: readonly AssignCandidateLike[],
  pickup: LatLonLike | null,
): RankedCandidate[] {
  const ranked = candidates.map((c): RankedCandidate => {
    const deadheadNowMi =
      pickup && c.currentPos ? round1(haversineMi(c.currentPos, pickup)) : null;
    const deadheadEndMi =
      pickup && c.routeEnd ? round1(haversineMi(c.routeEnd, pickup)) : null;
    // The truck starts the next load from where its current load
    // ENDS when it has one — that is the number dispatch is really
    // spending. An empty truck starts from where it sits.
    const fromRouteEnd = c.hasActiveLoad && c.routeEnd != null;
    const effectiveMi = fromRouteEnd ? deadheadEndMi : deadheadNowMi;
    const basis: RankedCandidate["basis"] = fromRouteEnd
      ? "route_end"
      : c.currentPos != null
        ? "current"
        : "unknown";
    const basisLabel = fromRouteEnd
      ? "Finishing a load — ranked from its route end"
      : c.currentPos != null
        ? c.hasActiveLoad
          ? "On a load, route end unknown — ranked from current position"
          : "Empty — ranked from current position"
        : "Position unknown — cannot rank by deadhead";
    return { ...c, deadheadNowMi, deadheadEndMi, effectiveMi, basis, basisLabel };
  });
  ranked.sort((a, b) => {
    if (a.effectiveMi == null && b.effectiveMi == null) return a.username.localeCompare(b.username);
    if (a.effectiveMi == null) return 1;
    if (b.effectiveMi == null) return -1;
    if (a.effectiveMi !== b.effectiveMi) return a.effectiveMi - b.effectiveMi;
    return a.username.localeCompare(b.username);
  });
  return ranked;
}

// ---------------------------------------------------------------------------
// Outward track share state. Expiry is DERIVED at read time (the
// invoice-overdue pattern): the link row stays "active" until it is
// revoked; a delivered load ends the share on its own.
// ---------------------------------------------------------------------------

export type TrackShareState = "live" | "delivered" | "revoked";

export function trackShareStateFor(args: {
  linkStatus: string;
  delivered: boolean;
}): TrackShareState {
  if (args.linkStatus === "revoked") return "revoked";
  if (args.delivered) return "delivered";
  return "live";
}
