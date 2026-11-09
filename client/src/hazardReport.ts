// Driver-reported road hazards — the client side of the hazard
// system (migration 0107, x's order 2026-11-08: "Build all five").
// The short-lived sibling of the work-zone system (workZone.ts):
// three quick types, a 2-HOUR life (server lifecycle in
// server/src/hazardReport.ts), and the same approach discipline —
// the banner + voice fire off the truck's ROUTE position, and a
// hazard behind the truck or off the line never fires.
//
// Every surface labels these "Driver-reported" with their age —
// they are driver truth, never dressed as official data.

import { projectOntoRoute } from "./routeGeometry";
import { zoneAgeLabel } from "./workZone";

export type HazardKind = "traffic_stopped" | "debris" | "vehicle_shoulder";

export interface DriverHazard {
  /** "hazard-<id>". */
  id: string;
  kind: HazardKind;
  lat: number;
  lon: number;
  note: string | null;
  reporter: string | null;
  confirmCount: number;
  createdAtMs: number;
  expiresAtMs: number;
}

export const HAZARD_KIND_META: Record<HazardKind, { label: string; icon: string }> = {
  traffic_stopped: { label: "Traffic stopped", icon: "🛑" },
  debris: { label: "Debris in road", icon: "⚠️" },
  vehicle_shoulder: { label: "Vehicle on shoulder", icon: "🚗" },
};

/** The advance-alert distance: the banner + voice call fire when a
 *  hazard on the route comes within a mile. */
export const HAZARD_ALERT_MI = 1.0;
/** A hazard counts as ON the route within this distance. */
export const HAZARD_ON_ROUTE_MI = 0.35;

/** Whether this viewer should still see the hazard at `nowMs` —
 *  the client mirror of the server 2-hour lifecycle. */
export function hazardLiveAt(h: DriverHazard, nowMs: number): boolean {
  return nowMs < h.expiresAtMs;
}

/** The one-line source label every surface shows. */
export function hazardSourceLabel(h: DriverHazard, nowMs: number): string {
  return `Driver-reported · ${zoneAgeLabel(h.createdAtMs, nowMs)}`;
}

/** The hazard's headline: "Debris in road". */
export function hazardHeadline(h: DriverHazard): string {
  return HAZARD_KIND_META[h.kind].label;
}

export interface HazardAhead {
  hazard: DriverHazard;
  distAheadMi: number;
}

/** The nearest LIVE hazard ahead ON the route inside the alert
 *  distance, or null. */
export function hazardAhead(
  hazards: DriverHazard[],
  coords: [number, number][] | null | undefined,
  progressMi: number,
  nowMs: number,
): HazardAhead | null {
  if (!coords || coords.length < 2 || !Number.isFinite(progressMi)) return null;
  let best: HazardAhead | null = null;
  for (const h of hazards) {
    if (!hazardLiveAt(h, nowMs)) continue;
    const proj = projectOntoRoute({ lat: h.lat, lon: h.lon }, coords);
    if (proj.offMi > HAZARD_ON_ROUTE_MI) continue;
    const dist = proj.alongMi - progressMi;
    if (dist <= 0.02 || dist > HAZARD_ALERT_MI) continue;
    if (!best || dist < best.distAheadMi) best = { hazard: h, distAheadMi: dist };
  }
  return best;
}

/** Distance text the way the banner says it: "0.6 miles". */
export function fmtHazardDist(distMi: number): string {
  return `${(Math.round(distMi * 10) / 10).toFixed(1)} miles`;
}

/** The banner headline: "DEBRIS IN ROAD AHEAD — 0.6 MILES". */
export function hazardBannerHeadline(ahead: HazardAhead): string {
  return `${hazardHeadline(ahead.hazard).toUpperCase()} AHEAD — ${fmtHazardDist(ahead.distAheadMi).toUpperCase()}`;
}

/** The spoken call — short, plain, source named. */
export function hazardSpoken(ahead: HazardAhead): string {
  return `${hazardHeadline(ahead.hazard)} ahead. ${fmtHazardDist(ahead.distAheadMi)} ahead. Driver reported.`;
}
