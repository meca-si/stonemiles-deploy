// Construction indicators — the client side of the work-zone build
// (x's order 2026-11-08): driver-reported zones (server lifecycle in
// server/src/workZone.ts) plus official DOT zones from free state
// WZDx feeds (server/src/wzdx.ts). Pure and framework-free, like
// hillGrade.ts, so the display + approach-alert behavior is
// unit-testable (see workZone.test.ts).
//
// Two sources, two labels, never blended:
//   driver → "Driver-reported" — a driver's one-tap report, with its
//            age ("reported 20 min ago") and the 12-hour lifecycle.
//   dot    → "DOT reported" — the publishing DOT named on the zone,
//            with the feed's own start/end window.
// The approach alert fires off the truck's ROUTE position against
// either source; a zone behind the truck or off the line never fires.

import { projectOntoRoute } from "./routeGeometry";

export interface DriverWorkZone {
  kind: "driver";
  /** "driver-<id>" — namespaced so both sources share one list. */
  id: string;
  lat: number;
  lon: number;
  note: string | null;
  reporter: string | null;
  confirmCount: number;
  createdAtMs: number;
  expiresAtMs: number;
  lastConfirmedAtMs: number | null;
}

export interface DotWorkZone {
  kind: "dot";
  id: string;
  lat: number;
  lon: number;
  road: string | null;
  description: string | null;
  /** The publishing agency, e.g. "Wisconsin DOT · 511WI". */
  sourceLabel: string;
  startMs: number;
  endMs: number;
}

export type WorkZone = DriverWorkZone | DotWorkZone;

/** The advance-alert distance: the banner + voice call fire when a
 *  zone on the route comes within a mile — close enough to matter,
 *  far enough to pick a lane. */
export const CONSTRUCTION_ALERT_MI = 1.0;
/** A zone counts as ON the route within this distance of the line
 *  (a work zone sits ON the road — a slightly wide pin still counts,
 *  a zone on a parallel street does not). */
export const CONSTRUCTION_ON_ROUTE_MI = 0.35;

/** The "reported … ago" age line for a driver report: "reported
 *  just now" under a minute, minutes under an hour, then hours.
 *  Future timestamps (clock skew) read as "just now" — an age is
 *  never negative and never invented. */
export function zoneAgeLabel(createdAtMs: number, nowMs: number): string {
  const ageMs = Math.max(0, nowMs - createdAtMs);
  const min = Math.floor(ageMs / 60_000);
  if (min < 1) return "reported just now";
  if (min < 60) return `reported ${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `reported ${h} h ago`;
  return `reported ${Math.floor(h / 24)} d ago`;
}

/** Whether this viewer should still see a driver zone at `nowMs` —
 *  the client mirror of the server lifecycle (the server only serves
 *  live zones; this guards the minutes between polls). DOT zones
 *  carry their own window from the feed. */
export function zoneLiveAt(zone: WorkZone, nowMs: number): boolean {
  if (zone.kind === "driver") return nowMs < zone.expiresAtMs;
  return nowMs >= zone.startMs && nowMs <= zone.endMs;
}

/** The one-line source label every surface shows — the honesty
 *  carrier. Driver zones always say "Driver-reported" (+ age); DOT
 *  zones always name the publishing DOT. */
export function zoneSourceLabel(zone: WorkZone, nowMs: number): string {
  if (zone.kind === "driver") return `Driver-reported · ${zoneAgeLabel(zone.createdAtMs, nowMs)}`;
  return `DOT reported · ${zone.sourceLabel}`;
}

/** The zone's headline: the road when the data names one, else the
 *  plain fact. */
export function zoneHeadline(zone: WorkZone): string {
  if (zone.kind === "dot") return zone.road ? `Construction — ${zone.road}` : "Construction";
  return "Construction";
}

export interface ConstructionAhead {
  zone: WorkZone;
  /** Miles from the truck's route position to the zone. */
  distAheadMi: number;
}

/** The nearest construction zone ahead ON the route inside the
 *  alert distance, or null. Zones at/behind the truck, off the
 *  line, or beyond CONSTRUCTION_ALERT_MI never fire — the same
 *  discipline as the grade trigger. */
export function constructionAhead(
  zones: WorkZone[],
  coords: [number, number][] | null | undefined,
  progressMi: number,
  nowMs: number,
): ConstructionAhead | null {
  if (!coords || coords.length < 2 || !Number.isFinite(progressMi)) return null;
  let best: ConstructionAhead | null = null;
  for (const z of zones) {
    if (!zoneLiveAt(z, nowMs)) continue;
    const proj = projectOntoRoute({ lat: z.lat, lon: z.lon }, coords);
    if (proj.offMi > CONSTRUCTION_ON_ROUTE_MI) continue;
    const dist = proj.alongMi - progressMi;
    if (dist <= 0.02 || dist > CONSTRUCTION_ALERT_MI) continue;
    if (!best || dist < best.distAheadMi) best = { zone: z, distAheadMi: dist };
  }
  return best;
}

/** Distance text the way the banner says it: "0.8 miles", "0.3
 *  miles" — one decimal, the brief's own phrasing. */
export function fmtZoneDist(distMi: number): string {
  return `${(Math.round(distMi * 10) / 10).toFixed(1)} miles`;
}

/** The banner headline: "Construction reported ahead — 0.8 miles".
 *  DOT zones say "DOT construction ahead" — the source is in the
 *  call itself, never just in small print. */
export function constructionHeadline(ahead: ConstructionAhead): string {
  return ahead.zone.kind === "dot"
    ? `DOT construction ahead — ${fmtZoneDist(ahead.distAheadMi)}`
    : `Construction reported ahead — ${fmtZoneDist(ahead.distAheadMi)}`;
}

/** The spoken call — short, plain, source named. */
export function constructionSpoken(ahead: ConstructionAhead): string {
  return ahead.zone.kind === "dot"
    ? `D O T construction ahead. ${fmtZoneDist(ahead.distAheadMi)} ahead.`
    : `Construction reported ahead. ${fmtZoneDist(ahead.distAheadMi)} ahead.`;
}
