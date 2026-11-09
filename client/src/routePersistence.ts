// Active-route persistence — pure logic (no DOM, no React), like
// routeGeometry.ts, so the round-trip is unit-testable (see
// routePersistence.test.ts).
//
// Why this module exists (driver report, 2026-10-27): "Resume route
// doesn't work." The TRIP SHEET had a resume all along — an open
// trip snapshot in localStorage (tgps-open-trip) that restores miles
// and state. The ROUTE had nothing: destination, route options, and
// guidance lived only in React state, so any app close, reload, or
// webview recycle wiped them, and "resuming" the trip brought back
// the sheet with NO route, NO line, and NO guidance. The driver had
// to re-search and re-plan from scratch.
//
// The fix: whenever a route is live, its full snapshot (destination,
// every option's geometry + maneuvers, the picked option, toll
// choice, whether guidance had started) is stored on-device under
// ACTIVE_ROUTE_KEY. On launch the snapshot is offered back — Resume
// route restores it INSTANTLY from the stored geometry (no network,
// no GPS fix, no re-plan needed), then live traffic/weather refresh
// in the background like any fresh plan. End route clears it.

export const ACTIVE_ROUTE_KEY = "tgps-active-route-v1";

export type SavedDestination = {
  label: string;
  lat: number;
  lon: number;
  gateLat?: number | null;
  gateLon?: number | null;
  addressLabel?: string | null;
};

export type SavedRouteOption = {
  id: number;
  miles: number;
  minutes: number;
  hasToll: boolean;
  coords: [number, number][];
  maneuvers: unknown[];
  [key: string]: unknown;
};

export type SavedRouteSnapshot = {
  version: 1;
  savedAt: number;
  destination: SavedDestination;
  routeOrigin: { label: string; lat: number; lon: number } | null;
  avoidTolls: boolean;
  selectedRoute: number;
  driveMode: boolean;
  activeLoadId: number | null;
  routes: SavedRouteOption[];
};

function isLatLon(lat: unknown, lon: unknown): boolean {
  return (
    typeof lat === "number" && Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
    typeof lon === "number" && Number.isFinite(lon) && lon >= -180 && lon <= 180
  );
}

/** Serialize a snapshot for localStorage. Coords are rounded to 5
 *  decimals (~1 m — plenty for a route line) to keep the payload
 *  lean on long hauls. Returns null when the snapshot has nothing
 *  resumable (no destination or no route geometry). */
export function serializeRouteSnapshot(snap: SavedRouteSnapshot): string | null {
  if (!snap.destination || !isLatLon(snap.destination.lat, snap.destination.lon)) return null;
  if (!Array.isArray(snap.routes) || snap.routes.length === 0) return null;
  const routes = snap.routes
    .filter((r) => Array.isArray(r.coords) && r.coords.length >= 2)
    .map((r) => ({
      ...r,
      coords: r.coords.map(
        (c) => [Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5] as [number, number],
      ),
      // Traffic overlays are live data — never resurrect stale
      // congestion colors from storage; they refresh after resume.
      trafficFlow: undefined,
      trafficIncidents: undefined,
      trafficState: "idle",
      trafficDelayMin: null,
      trafficAsOf: null,
    }));
  if (routes.length === 0) return null;
  return JSON.stringify({ ...snap, version: 1, routes });
}

/** Parse + validate a stored snapshot. Anything malformed, stale-
 *  shaped, or geometry-less returns null — a corrupt snapshot must
 *  never offer a Resume that restores garbage. */
export function parseRouteSnapshot(raw: string | null): SavedRouteSnapshot | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const s = data as Partial<SavedRouteSnapshot>;
  if (s.version !== 1) return null;
  const dest = s.destination;
  if (!dest || typeof dest.label !== "string" || !isLatLon(dest.lat, dest.lon)) return null;
  if (!Array.isArray(s.routes) || s.routes.length === 0) return null;
  const routes: SavedRouteOption[] = [];
  for (const r of s.routes) {
    if (!r || typeof r !== "object") return null;
    const ro = r as SavedRouteOption;
    if (!Array.isArray(ro.coords) || ro.coords.length < 2) return null;
    if (!ro.coords.every((c) => Array.isArray(c) && isLatLon(c[0], c[1]))) return null;
    if (typeof ro.miles !== "number" || !(ro.miles > 0)) return null;
    if (typeof ro.minutes !== "number" || !(ro.minutes > 0)) return null;
    routes.push({ ...ro, maneuvers: Array.isArray(ro.maneuvers) ? ro.maneuvers : [] });
  }
  const selected =
    typeof s.selectedRoute === "number" && s.selectedRoute >= 0 && s.selectedRoute < routes.length
      ? Math.floor(s.selectedRoute)
      : 0;
  return {
    version: 1,
    savedAt: typeof s.savedAt === "number" ? s.savedAt : 0,
    destination: dest,
    routeOrigin:
      s.routeOrigin && isLatLon(s.routeOrigin.lat, s.routeOrigin.lon)
        ? { label: String(s.routeOrigin.label ?? ""), lat: s.routeOrigin.lat, lon: s.routeOrigin.lon }
        : null,
    avoidTolls: s.avoidTolls !== false,
    selectedRoute: selected,
    driveMode: s.driveMode === true,
    activeLoadId: typeof s.activeLoadId === "number" ? s.activeLoadId : null,
    routes,
  };
}
