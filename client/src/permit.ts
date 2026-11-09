// permit.ts — OS/OW Permit Mode client logic (migration 0097).
//
// Pure logic (no DOM, no React), like routeGeometry.ts /
// signCheck.ts, so the production behaviour is unit-testable (see
// permit.test.ts). Three jobs:
//
//  1. STATUS + GROUPS for the permit library — derived from the
//     permit's valid-date window and completion stamp, mirroring the
//     server rule (server/src/permit.ts) exactly: completed beats
//     everything, a passed window end is expired, a window that
//     hasn't opened is upcoming, anything else is active.
//  2. RESTRICTION PLACARDS for the Drive screen — built ONLY from
//     what the driver confirmed on the docket (escorts, curfew
//     windows, printed dimensions, restriction lines). Display-only:
//     nothing here records, prompts, or stores a driver response.
//  3. CORRIDOR MATH for Permit route navigation — the approved route
//     is matched to the road network by the app's routing stack
//     (App.tsx), and the geometry that comes back is DERIVED: this
//     module measures the truck against that matched line and works
//     out the way back (distance + compass heading to the nearest
//     point on the corridor). Every number it returns is labelled
//     derived at the surface that shows it — it is never the state's
//     own geometry.

import { normalizeBearingDeg, projectOntoRoute, type LatLon } from "./routeGeometry";

/** The permit docket as the API returns it (listPermits/getPermit). */
export type PermitDocket = {
  id: number;
  loadId: number | null;
  permitNumber: string | null;
  issuingState: string | null;
  issuingAgency: string | null;
  routeSteps: string[];
  routePlaces: string[];
  heightText: string | null;
  widthText: string | null;
  lengthText: string | null;
  weightText: string | null;
  heightIn: number | null;
  widthIn: number | null;
  lengthIn: number | null;
  weightLbs: number | null;
  validFrom: string | null;
  validTo: string | null;
  escorts: string | null;
  curfews: string[];
  restrictions: string[];
  qrText: string | null;
  hasDoc: boolean;
  docMime: string | null;
  filedCopyId: number | null;
  completedAt: number | null;
  createdAt: number;
};

export type PermitStatus = "active" | "upcoming" | "expired" | "completed";

/** Mirror of the server rule (server/src/permit.ts permitStatusOf). */
export function permitStatusOf(
  p: { validFrom: string | null; validTo: string | null; completedAt: number | null },
  todayIso: string,
): PermitStatus {
  if (p.completedAt != null) return "completed";
  if (p.validTo != null && /^\d{4}-\d{2}-\d{2}$/.test(p.validTo) && todayIso > p.validTo) return "expired";
  if (p.validFrom != null && /^\d{4}-\d{2}-\d{2}$/.test(p.validFrom) && todayIso < p.validFrom) return "upcoming";
  return "active";
}

/** The library's three shelves. Upcoming permits ride the Active
 *  shelf (labelled with their start date) — the brief's grouping is
 *  Active / Completed / Expired, and a not-yet-open permit is none of
 *  expired or completed. */
export type PermitGroups = { active: PermitDocket[]; completed: PermitDocket[]; expired: PermitDocket[] };

export function groupPermits(permits: readonly PermitDocket[], todayIso: string): PermitGroups {
  const groups: PermitGroups = { active: [], completed: [], expired: [] };
  for (const p of permits) {
    const s = permitStatusOf(p, todayIso);
    if (s === "completed") groups.completed.push(p);
    else if (s === "expired") groups.expired.push(p);
    else groups.active.push(p);
  }
  return groups;
}

/** The permit that should be OFFERED for Permit route navigation:
 *  an active one — one attached to the load being navigated wins;
 *  otherwise the only active permit, or the most recently filed when
 *  several stand alone. Upcoming permits are never offered (their
 *  window hasn't opened). Null when nothing qualifies. */
export function permitOfferFor(
  permits: readonly PermitDocket[],
  todayIso: string,
  loadId: number | null,
): PermitDocket | null {
  const actives = permits.filter((p) => permitStatusOf(p, todayIso) === "active");
  if (actives.length === 0) return null;
  if (loadId != null) {
    const attached = actives.find((p) => p.loadId === loadId);
    if (attached) return attached;
  }
  const unattached = actives.filter((p) => p.loadId == null);
  if (loadId == null) return actives[0] ?? null;
  return unattached.length === 1 ? (unattached[0] ?? null) : null;
}

// ---------- Restriction placards -------------------------------------------

export type PermitPlacard = { key: string; icon: string; label: string };

/** Escort text that means NO escort is required — such a docket gets
 *  no escort placard (a placard shouting "no escort" is noise). */
const NO_ESCORT_RE = /^\s*(none|no|not required|n\/a|na|-)\b/i;

/**
 * The glanceable restriction chips for the Drive screen, built ONLY
 * from the confirmed docket, in docket order of importance: escorts,
 * curfew / no-movement windows, printed width/height/weight limits,
 * then each restriction line (bridge bypasses ride here — they are
 * restriction lines as printed). Capped so the Drive screen never
 * grows a stack; the overflow count is stated, never hidden.
 */
export function buildPlacards(p: PermitDocket, max = 6): { placards: PermitPlacard[]; moreCount: number } {
  const all: PermitPlacard[] = [];
  if (p.escorts && !NO_ESCORT_RE.test(p.escorts)) {
    all.push({ key: "escorts", icon: "🚓", label: `Escort: ${p.escorts}` });
  }
  p.curfews.forEach((c, i) => all.push({ key: `curfew-${i}`, icon: "🌙", label: `Curfew: ${c}` }));
  if (p.widthText) all.push({ key: "width", icon: "↔️", label: `Width ${p.widthText}` });
  if (p.heightText) all.push({ key: "height", icon: "↕️", label: `Height ${p.heightText}` });
  if (p.weightText) all.push({ key: "weight", icon: "⚖️", label: `Weight ${p.weightText}` });
  p.restrictions.forEach((r, i) => all.push({ key: `restriction-${i}`, icon: "⛔", label: r }));
  const placards = all.slice(0, max);
  return { placards, moreCount: Math.max(0, all.length - placards.length) };
}

// ---------- Corridor math ---------------------------------------------------

/** Distance from the matched corridor line that counts as OFF the
 *  approved route in Permit mode: 0.1 mi (~160 m) — wider than the
 *  ordinary 0.08 mi reroute threshold because a permit corridor is a
 *  matched/derived line, not a surveyed one, and a hard alert must
 *  never fire on matching slack. */
export const PERMIT_OFF_ROUTE_MI = 0.1;

const COMPASS8 = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** 8-point compass label for a bearing in degrees (0 = north). */
export function compass8(bearingDeg: number): string {
  const idx = Math.round(normalizeBearingDeg(bearingDeg) / 45) % 8;
  return COMPASS8[idx] ?? "N";
}

/** Initial bearing (deg, 0 = north) from one point to another. */
export function bearingTo(from: LatLon, to: LatLon): number {
  const dLon = ((to.lon - from.lon) * Math.PI) / 180;
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return normalizeBearingDeg((Math.atan2(y, x) * 180) / Math.PI);
}

export type CorridorReturn = {
  /** True distance (mi) from the truck to the nearest point on the
   *  matched corridor line. */
  offMi: number;
  /** True when the truck is beyond PERMIT_OFF_ROUTE_MI — off the
   *  approved route. */
  offRoute: boolean;
  /** The nearest point on the corridor line (derived). */
  nearest: LatLon;
  /** Compass heading from the truck back to that nearest point. */
  headingBackDeg: number;
  headingBackCompass: string;
};

/**
 * Where the truck stands against the matched permit corridor, and
 * the way back. Derived from the matched line (projectOntoRoute) —
 * honest about its source at every surface that shows it.
 */
export function corridorReturn(pos: LatLon, coords: [number, number][]): CorridorReturn | null {
  if (coords.length === 0) return null;
  const proj = projectOntoRoute(pos, coords);
  if (!Number.isFinite(proj.offMi)) return null;
  const heading = bearingTo(pos, proj.snapped);
  return {
    offMi: proj.offMi,
    offRoute: proj.offMi > PERMIT_OFF_ROUTE_MI,
    nearest: proj.snapped,
    headingBackDeg: heading,
    headingBackCompass: compass8(heading),
  };
}

// ---------- Scan-read merging (PDF pages) -----------------------------------

export type PermitRead = {
  found: boolean;
  permitNumber: string | null;
  issuingState: string | null;
  issuingAgency: string | null;
  routeSteps: string[];
  routePlaces: string[];
  heightText: string | null;
  widthText: string | null;
  lengthText: string | null;
  weightText: string | null;
  heightIn: number | null;
  widthIn: number | null;
  lengthIn: number | null;
  weightLbs: number | null;
  validFrom: string | null;
  validTo: string | null;
  escorts: string | null;
  curfews: string[];
  restrictions: string[];
  qrText: string | null;
};

/**
 * Merge per-page reads of one permit document (a PDF rendered to
 * page images): the first page that reports a field wins it, line
 * lists append in page order without exact duplicates. A field no
 * page reported stays empty — merging never invents.
 */
export function mergePermitReads(reads: readonly PermitRead[]): PermitRead | null {
  const found = reads.filter((r) => r.found);
  if (found.length === 0) return null;
  const first = <T,>(pick: (r: PermitRead) => T | null): T | null => {
    for (const r of found) {
      const v = pick(r);
      if (v != null) return v;
    }
    return null;
  };
  const lines = (pick: (r: PermitRead) => string[]): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const r of found) {
      for (const line of pick(r)) {
        const k = line.trim().toLowerCase();
        if (k && !seen.has(k)) {
          seen.add(k);
          out.push(line);
        }
      }
    }
    return out;
  };
  return {
    found: true,
    permitNumber: first((r) => r.permitNumber),
    issuingState: first((r) => r.issuingState),
    issuingAgency: first((r) => r.issuingAgency),
    routeSteps: lines((r) => r.routeSteps),
    routePlaces: lines((r) => r.routePlaces),
    heightText: first((r) => r.heightText),
    widthText: first((r) => r.widthText),
    lengthText: first((r) => r.lengthText),
    weightText: first((r) => r.weightText),
    heightIn: first((r) => r.heightIn),
    widthIn: first((r) => r.widthIn),
    lengthIn: first((r) => r.lengthIn),
    weightLbs: first((r) => r.weightLbs),
    validFrom: first((r) => r.validFrom),
    validTo: first((r) => r.validTo),
    escorts: first((r) => r.escorts),
    curfews: lines((r) => r.curfews),
    restrictions: lines((r) => r.restrictions),
    qrText: first((r) => r.qrText),
  };
}
