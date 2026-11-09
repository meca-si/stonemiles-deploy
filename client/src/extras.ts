// extras.ts — Final Extras batch (2026-11-06): pure client logic
// for receiver memory, the scale finder, tax categories, and the
// night-parking picks. No DOM, no React — unit-testable like the
// app's other logic modules (extras.test.ts).
//
// Honesty rules carried here:
//  - Facility matching is name-normalised contains-matching over
//    the DRIVER'S OWN history — a facility the driver has never
//    sealed a visit at matches nothing, and the UI says so.
//  - Scale finder classification reads OpenStreetMap tags only:
//    a place is a scale because the map data tags it as one, never
//    because the app hopes it is.
//  - Night-parking picks use map-data parking facts only (tagged
//    truck parking / a tagged space count). Nothing here claims a
//    space is free — there is no live availability feed.

/** Lowercase, punctuation-collapsed facility name for matching. */
export function normalizeFacilityName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Does a stored facility name match what the driver typed/named?
 *  Either side containing the other counts (drivers type "Peacock"
 *  for "Peacock Pavers — Mobile, AL" and vice versa). Empty never
 *  matches. */
export function facilityNameMatches(stored: string, named: string): boolean {
  const a = normalizeFacilityName(stored);
  const b = normalizeFacilityName(named);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

/** Plain-words appointment behaviour from the sealed arrival vs
 *  the recorded appointment (minutes late; negative = early).
 *  Within ±15 minutes reads "on time". Null stays null — the UI
 *  shows nothing rather than guessing an appointment existed. */
export function apptBehaviourLabel(deltaMin: number | null): string | null {
  if (deltaMin == null || !Number.isFinite(deltaMin)) return null;
  if (Math.abs(deltaMin) <= 15) return "arrived on time for the appointment";
  if (deltaMin < 0) return `arrived ${Math.abs(Math.round(deltaMin))} min early for the appointment`;
  return `arrived ${Math.round(deltaMin)} min after the appointment time`;
}

export type FacilityVisitLike = {
  loadId: number;
  facility: string;
  site: string;
  arrivedAt: string;
  departedAt: string;
  dwellHours: number;
  excessHours: number;
  apptDeltaMin: number | null;
  lumperFee: number | null;
  dockDoor: string | null;
  dockNote: string | null;
};

export type FacilityGroup = {
  facility: string;
  site: string;
  visits: FacilityVisitLike[];
  avgDwellHours: number;
  avgExcessHours: number;
  last: FacilityVisitLike;
};

/** Group a flat visit list (newest first from the server) into
 *  per-facility history with averages — the "what to expect here"
 *  shape. Averages round to tenths, like the server's dwell math. */
export function groupVisitsByFacility(visits: FacilityVisitLike[]): FacilityGroup[] {
  const map = new Map<string, FacilityVisitLike[]>();
  for (const v of visits) {
    const key = `${v.facility}|${v.site}`;
    const arr = map.get(key) ?? [];
    arr.push(v);
    map.set(key, arr);
  }
  const groups: FacilityGroup[] = [];
  for (const arr of map.values()) {
    const sorted = [...arr].sort((a, b) => b.departedAt.localeCompare(a.departedAt));
    const first = sorted[0]!;
    const avg = (pick: (v: FacilityVisitLike) => number) =>
      Math.round((sorted.reduce((s, v) => s + pick(v), 0) / Math.max(1, sorted.length)) * 10) / 10;
    groups.push({
      facility: first.facility,
      site: first.site,
      visits: sorted,
      avgDwellHours: avg((v) => v.dwellHours),
      avgExcessHours: avg((v) => v.excessHours),
      last: first,
    });
  }
  return groups.sort((a, b) => b.last.departedAt.localeCompare(a.last.departedAt));
}

// ---------- Scale finder (map data) -------------------------------------------

export type ScalePoiKind = "cat_scale" | "weighbridge" | "truck_stop_scales";

/** Classify an OpenStreetMap element's tags as a public truck
 *  scale, or null. CAT Scale wins by brand/name; a weighbridge tag
 *  is a scale in its own right; a truck stop / fuel place tagged
 *  with scales is the third kind. Reads tags only. */
export function classifyScalePoi(tags: Record<string, string>): ScalePoiKind | null {
  const brand = `${tags.brand ?? ""} ${tags.name ?? ""} ${tags.operator ?? ""}`.toLowerCase();
  if (/cat scale/.test(brand)) return "cat_scale";
  if (tags.amenity === "weighbridge" || tags.highway === "weigh_station") return "weighbridge";
  const scalesTag = (tags.weighbridge ?? tags.scales ?? "").toLowerCase();
  if (scalesTag === "yes" || scalesTag === "true" || scalesTag === "1") return "truck_stop_scales";
  return null;
}

export const SCALE_KIND_LABEL: Record<ScalePoiKind, string> = {
  cat_scale: "CAT Scale",
  weighbridge: "Weighbridge / scale",
  truck_stop_scales: "Truck stop with scales (map-tagged)",
};

// ---------- Night parking picks (stop planning) -------------------------------

export type NightParkingCandidate = {
  id: string;
  name: string;
  alongMi: number;
  parkingSpaces: number | null;
  truckParking: boolean | null;
};

/** The night-parking picks for the stop planner: route candidates
 *  the MAP DATA says have truck parking (tagged yes, or a tagged
 *  space count), nearest to where the driving clock runs out.
 *  A candidate the map data says has NO truck parking is excluded;
 *  one it says nothing about is excluded too — an unknown is not a
 *  parking recommendation. Space counts are lot sizes from map
 *  tags, never live availability. */
export function nightParkingPicks<T extends NightParkingCandidate>(
  candidates: T[],
  shutdownAlongMi: number | null,
  limit = 5,
): T[] {
  const withParking = candidates.filter((c) => c.truckParking === true || c.parkingSpaces != null);
  const sorted = [...withParking].sort((a, b) => {
    if (shutdownAlongMi == null) return a.alongMi - b.alongMi;
    return Math.abs(a.alongMi - shutdownAlongMi) - Math.abs(b.alongMi - shutdownAlongMi);
  });
  return sorted.slice(0, limit);
}
