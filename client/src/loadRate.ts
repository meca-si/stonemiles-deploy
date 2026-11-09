// Load rate-per-mile — the single source for "what does this load
// pay per mile" (x's order, 2026-10-31: automatic $/mi on loads, and
// the load boards rank by it).
//
// Pure and framework-free, like routeGeometry.ts, so the exact
// production math is unit-testable (see loadRate.test.ts).
//
// Rules, held everywhere this module is used:
// - $/mi is DERIVED, never stored or typed: total pay ÷ loaded miles.
//   The headline figure is the ALL-IN rate — (rate + additional
//   charges) ÷ miles — because that is what the truck actually runs
//   for. The linehaul-only figure rides along for the breakdown.
// - No miles (or no rate) → no $/mi. The UI leaves it blank / shows
//   an estimate labelled "est." — a $/mi is never invented.
// - When the load itself carries no miles, a lane ESTIMATE may stand
//   in: straight-line city-to-city distance × ROAD_CIRCUITY. Road
//   miles run longer than the crow flies; 1.25 is the planning
//   factor the app states wherever an estimate is shown. Estimates
//   are always labelled and never written back as fact — a load's
//   stored miles (document / entered) always win over an estimate.

export type LatLon = { lat: number; lon: number };

/** Road miles ≈ straight-line miles × this factor (planning estimate). */
export const ROAD_CIRCUITY = 1.25;

export function haversineMi(a: LatLon, b: LatLon): number {
  const R = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Estimated loaded (road) miles between two city points, rounded to
 *  whole miles. Null when either point is missing or the lane is a
 *  same-spot hop (under ~5 road miles the factor is meaningless). */
export function estimateLoadedMiles(a: LatLon | null, b: LatLon | null): number | null {
  if (!a || !b) return null;
  const est = Math.round(haversineMi(a, b) * ROAD_CIRCUITY);
  return est >= 5 ? est : null;
}

/** All-in $/mi: (rate + additional charges) ÷ miles. Null unless a
 *  rate and positive miles are both on file. */
export function totalPerMile(
  rate: number | null,
  extraCharges: number,
  miles: number | null,
): number | null {
  if (rate == null || miles == null || !(miles > 0)) return null;
  return Math.round(((rate + (extraCharges ?? 0)) / miles) * 1000) / 1000;
}

/** Linehaul-only $/mi: rate ÷ miles. */
export function ratePerMile(rate: number | null, miles: number | null): number | null {
  if (rate == null || miles == null || !(miles > 0)) return null;
  return Math.round((rate / miles) * 1000) / 1000;
}

/** "$2.34/mi" — always two decimals, the way drivers quote rates. */
export function fmtPerMile(n: number): string {
  return `$${n.toFixed(2)}/mi`;
}

export type LaneEstimate = { miles: number; perMile: number };

/** Build the display estimate for ONE load from a lane's estimated
 *  miles: the miles are the lane's, but the $/mi is figured from THIS
 *  load's own rate + charges (two loads on one lane rarely pay the
 *  same). Null when the load has no rate to divide. */
export function laneEstimateFor(
  load: { rate: number | null; extraCharges: number },
  estMiles: number | null,
): LaneEstimate | null {
  if (estMiles == null) return null;
  const perMile = totalPerMile(load.rate, load.extraCharges, estMiles);
  return perMile != null ? { miles: estMiles, perMile } : null;
}

export type LoadMoneyLike = {
  rate: number | null;
  extraCharges: number;
  totalWithExtras: number | null;
  loadedMiles: number | null;
  totalPerMile: number | null;
};

/** The $/mi a card should show for a load: the load's own derived
 *  figure when its miles are on file, else the lane estimate's.
 *  `estimated` says which — the UI labels estimates "est." and never
 *  presents one as the load's real rate. */
export function displayPerMile(
  load: LoadMoneyLike,
  estimate: LaneEstimate | null,
): { perMile: number; miles: number; estimated: boolean } | null {
  if (load.totalPerMile != null && load.loadedMiles != null) {
    return { perMile: load.totalPerMile, miles: load.loadedMiles, estimated: false };
  }
  if (estimate) {
    return { perMile: estimate.perMile, miles: estimate.miles, estimated: true };
  }
  return null;
}

/** The effective $/mi used to RANK board loads: the same figure the
 *  card displays (stored miles first, lane estimate second), so the
 *  order on the board always matches the numbers on the cards. */
export function effectivePerMile(
  load: LoadMoneyLike,
  estimate: LaneEstimate | null,
): number | null {
  return displayPerMile(load, estimate)?.perMile ?? null;
}

export type BoardSortKey = "perMile" | "total" | "newest";

export const BOARD_SORT_OPTIONS: { key: BoardSortKey; label: string }[] = [
  { key: "perMile", label: "Best $/mi" },
  { key: "total", label: "Highest total" },
  { key: "newest", label: "Newest" },
];

/**
 * Rank board rows. "perMile" (the board's default ranking, x's
 * order): highest effective $/mi first; loads whose $/mi can't be
 * figured yet (no rate, or no miles and no lane estimate) sink below
 * every ranked load, newest first among themselves — a load is never
 * ranked on an invented rate. Ties break on the bigger total, then
 * newest. "total": highest total pay first, unpriced loads last.
 * "newest": the board's original order (server sends newest first),
 * returned untouched.
 */
export function rankBoardLoads<T extends LoadMoneyLike & { createdAt: string }>(
  rows: T[],
  sort: BoardSortKey,
  estimateFor: (row: T) => LaneEstimate | null,
): T[] {
  if (sort === "newest") return rows;
  const decorated = rows.map((row, i) => ({
    row,
    i,
    perMile: effectivePerMile(row, estimateFor(row)),
    total: row.totalWithExtras,
  }));
  decorated.sort((a, b) => {
    if (sort === "perMile") {
      if (a.perMile != null && b.perMile != null && a.perMile !== b.perMile) {
        return b.perMile - a.perMile;
      }
      if (a.perMile != null && b.perMile == null) return -1;
      if (a.perMile == null && b.perMile != null) return 1;
      if (a.perMile != null && b.perMile != null) {
        const t = (b.total ?? 0) - (a.total ?? 0);
        if (t !== 0) return t;
      }
    } else {
      // total
      if (a.total != null && b.total != null && a.total !== b.total) {
        return b.total - a.total;
      }
      if (a.total != null && b.total == null) return -1;
      if (a.total == null && b.total != null) return 1;
    }
    const byNew = Date.parse(b.row.createdAt) - Date.parse(a.row.createdAt);
    return byNew !== 0 ? byNew : a.i - b.i;
  });
  return decorated.map((d) => d.row);
}
