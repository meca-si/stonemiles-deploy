// truckStop.ts — Truck-stop & rest-area cards (driver ask 2026-11-01:
// "is their a way we can have top tier graphics and content on the
// gps. You see loves on the app or pilot you tap it and it displays
// number of parking and amenities?" — scope correction the same
// night: "Not just for loves and pilot. All truck stops and also
// trucker rest areas").
//
// Pure logic for the tap-a-stop card: everything here is parsed from
// OpenStreetMap tags the app already fetches (fuel corridor scan +
// Explore pins + the parking planner's rest-area scan). The honesty
// rule is the app's standing one: a fact the map data doesn't carry
// is "not in map data" — never invented, never guessed. Parking
// COUNTS come only from OSM capacity tags; live parking STATUS comes
// only from driver intel reports (parking_open / parking_full),
// shown with their age, exactly like every other intel surface.
//
// Two card treatments:
//  - truck_stop (chains AND independents): fuel, DEF, showers,
//    scales, laundry, Wi-Fi, food, toilets, ATM.
//  - rest_area: restrooms, vending, picnic tables, pet area,
//    drinking water, info point, overnight parking.
// Brand styling is the caller's job (BRANDS in App.tsx); this module
// stays brand-agnostic so it unit-tests clean.

export type StopKind = "truck_stop" | "rest_area";
export type TriState = boolean | null;

export type StopAmenity = {
  key: string;
  label: string;
  icon: string;
  /** true = tagged present, false = tagged absent, null = map data doesn't say. */
  value: TriState;
};

export type TruckStopDetails = {
  kind: StopKind;
  /** Truck parking spaces from OSM capacity tags — null when untagged. */
  parkingSpaces: number | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  openingHours: string | null;
  open24: boolean;
  amenities: StopAmenity[];
};

export type ParkingReport = {
  status: "open" | "full";
  /** "just now" / "12m ago" / "3h ago" — the report's own age. */
  ageLabel: string;
  confirmed: boolean;
};

/** The render-ready card model the sheet component consumes. */
export type StopCardData = {
  id: string;
  name: string;
  kind: StopKind;
  kindLabel: string;
  brandLabel: string;
  brandMono: string | null;
  brandColor: string | null;
  lat: number;
  lon: number;
  /** Preformatted by the caller ("12.4 mi along route" / "3.1 mi away"). */
  distanceText: string | null;
  dieselPrice: number | null;
  details: TruckStopDetails;
  parkingReport: ParkingReport | null;
};

function tri(v: string | undefined): TriState {
  if (v === "yes" || v === "true" || v === "1") return true;
  if (v === "no" || v === "false" || v === "0") return false;
  return null;
}

function triAny(tags: Record<string, string>, keys: string[]): TriState {
  for (const k of keys) {
    const v = tri(tags[k]);
    if (v !== null) return v;
  }
  return null;
}

function parseCount(v: string | undefined): number | null {
  if (v == null) return null;
  const n = parseInt(v.replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Truck parking spaces: the truck-specific capacity wins; a plain
 *  `capacity` counts only for rest areas (their lots are the parking). */
export function parkingSpacesFor(tags: Record<string, string>, kind: StopKind): number | null {
  const truck =
    parseCount(tags["capacity:truck"]) ??
    parseCount(tags["capacity:hgv"]) ??
    parseCount(tags["capacity:trucks"]) ??
    parseCount(tags["truck_parking:spaces"]);
  if (truck != null) return truck;
  if (kind === "rest_area") return parseCount(tags.capacity) ?? parseCount(tags["capacity:parking"]);
  return null;
}

export function buildAddress(tags: Record<string, string>): string | null {
  const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  const cityState = [tags["addr:city"], tags["addr:state"]].filter(Boolean).join(", ");
  const parts = [street, cityState, tags["addr:postcode"]].filter((p) => p && p.trim().length > 0);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Which card treatment a place gets: OSM rest areas (and service
 *  areas tagged as rest areas) get the rest treatment; fuel stops,
 *  truck stops, and highway service areas get the commercial one. */
export function inferStopKind(tags: Record<string, string>, fallback: StopKind): StopKind {
  if (tags.highway === "rest_area" || tags.amenity === "rest_area") return "rest_area";
  if (tags.highway === "services" || tags.amenity === "fuel" || tags.truck_stop === "yes") return "truck_stop";
  return fallback;
}

const TRUCK_STOP_AMENITIES: { key: string; label: string; icon: string; tags: string[] }[] = [
  { key: "diesel", label: "Diesel", icon: "⛽", tags: ["fuel:diesel"] },
  { key: "def", label: "DEF", icon: "🧴", tags: ["fuel:DEF", "fuel:AdBlue", "fuel:def"] },
  { key: "truck_parking", label: "Truck parking", icon: "🅿️", tags: ["truck_parking", "parking:truck", "parking:hgv"] },
  { key: "showers", label: "Showers", icon: "🚿", tags: ["shower", "showers"] },
  { key: "scales", label: "Scales", icon: "⚖️", tags: ["weighbridge", "scales"] },
  { key: "laundry", label: "Laundry", icon: "🧺", tags: ["laundry"] },
  { key: "wifi", label: "Wi-Fi", icon: "📶", tags: ["internet_access", "wifi"] },
  { key: "food", label: "Food", icon: "🍔", tags: ["restaurant", "fast_food", "cafe"] },
  { key: "toilets", label: "Restrooms", icon: "🚻", tags: ["toilets"] },
  { key: "atm", label: "ATM", icon: "🏧", tags: ["atm"] },
];

const REST_AREA_AMENITIES: { key: string; label: string; icon: string; tags: string[] }[] = [
  { key: "restrooms", label: "Restrooms", icon: "🚻", tags: ["toilets"] },
  { key: "truck_parking", label: "Truck parking", icon: "🅿️", tags: ["truck_parking", "parking:truck", "parking:hgv", "hgv"] },
  { key: "vending", label: "Vending", icon: "🥤", tags: ["vending_machine", "vending"] },
  { key: "picnic", label: "Picnic area", icon: "🧺", tags: ["picnic_table", "picnic_tables"] },
  { key: "pet", label: "Pet area", icon: "🐕", tags: ["pet_area", "dog_area", "dog"] },
  { key: "water", label: "Drinking water", icon: "🚰", tags: ["drinking_water"] },
  { key: "info", label: "Info point", icon: "ℹ️", tags: ["information"] },
  { key: "overnight", label: "Overnight parking", icon: "🌙", tags: ["overnight"] },
];

export function parseTruckStopDetails(tags: Record<string, string>, kind: StopKind): TruckStopDetails {
  const defs = kind === "rest_area" ? REST_AREA_AMENITIES : TRUCK_STOP_AMENITIES;
  const amenities: StopAmenity[] = defs.map((d) => {
    let value = triAny(tags, d.tags);
    // A tagged truck-parking capacity is itself proof of truck parking.
    if (d.key === "truck_parking" && value === null && parkingSpacesFor(tags, kind) != null) value = true;
    return { key: d.key, label: d.label, icon: d.icon, value };
  });
  const openingHours = tags.opening_hours?.trim() ? tags.opening_hours.trim() : null;
  return {
    kind,
    parkingSpaces: parkingSpacesFor(tags, kind),
    address: buildAddress(tags),
    phone: tags.phone ?? tags["contact:phone"] ?? null,
    website: tags.website ?? tags["contact:website"] ?? null,
    openingHours,
    open24: openingHours === "24/7",
    amenities,
  };
}

export function amenityValue(details: TruckStopDetails, key: string): TriState {
  return details.amenities.find((a) => a.key === key)?.value ?? null;
}

/** Plain-words status for one amenity tile. */
export function amenityStatusLabel(a: StopAmenity): string {
  if (a.value === true) return "Yes";
  if (a.value === false) return "No";
  return "Not in map data";
}

function haversineMi(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 3958.8;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function parkingAgeLabel(createdAtIso: string, nowMs: number): string {
  const mins = Math.max(0, Math.round((nowMs - Date.parse(createdAtIso)) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

type IntelLike = { kind: string; lat: number; lon: number; createdAt: string; confirmedAt?: string | null };

/** The freshest driver-reported parking status at a stop: a
 *  parking_open / parking_full intel report within 0.4 mi and 12 h
 *  old (the same staleness bar the map uses for intel pins). Older
 *  or farther reports say nothing about THIS stop right now. */
export function parkingReportFor(
  reports: IntelLike[],
  lat: number,
  lon: number,
  nowMs: number,
): ParkingReport | null {
  let best: IntelLike | null = null;
  for (const r of reports) {
    if (r.kind !== "parking_open" && r.kind !== "parking_available" && r.kind !== "parking_full") continue;
    if (nowMs - Date.parse(r.createdAt) > 12 * 3600000) continue;
    if (haversineMi(lat, lon, r.lat, r.lon) > 0.4) continue;
    if (!best || Date.parse(r.createdAt) > Date.parse(best.createdAt)) best = r;
  }
  if (!best) return null;
  return {
    status: best.kind === "parking_full" ? "full" : "open",
    ageLabel: parkingAgeLabel(best.createdAt, nowMs),
    confirmed: !!best.confirmedAt,
  };
}
