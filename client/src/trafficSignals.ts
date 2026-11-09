// Traffic lights layer — OpenStreetMap traffic-signal LOCATIONS on
// the Drive map and ahead on the active route (x's order 2026-11-08).
//
// Pure and framework-free (no DOM, no React), like hillGrade.ts, so
// the exact production behavior is unit-testable (see
// trafficSignals.test.ts).
//
// HONESTY LAW (absolute): OpenStreetMap's highway=traffic_signals
// data carries WHERE signals are — nothing about their state. There
// is NO live red/green phase, timing, or countdown data available to
// this app, and none is ever displayed: no signal color, no "light
// is red/green", no timing estimate. Locations only. The marker art
// is a neutral unlit signal head for the same reason.
//
// OFFLINE: signals ride the same Overpass fetch as the hazard layer
// (around the truck), and every successful fetch is cached on-device
// (localStorage, per area grid cell — the helpers below own the
// shape). A dead-zone drive replays the cache for the area instead
// of going blank: stored map data, Atlas-style, labelled as map
// data wherever it shows.

import { projectOntoRoute } from "./routeGeometry";

export interface TrafficSignal {
  /** Stable id from the map data ("signal-<osm node id>"). */
  id: string;
  lat: number;
  lon: number;
}

/** The Overpass element shape the signal parse reads (the hazard
 *  query's element type, narrowed to what signals need). */
export interface SignalElement {
  id: number;
  type: string;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
}

/** Parse Overpass elements into traffic signals. Only node elements
 *  actually tagged highway=traffic_signals with real coordinates
 *  count; duplicates (the same node returned by overlapping query
 *  clauses) collapse to one. */
export function parseTrafficSignals(elements: SignalElement[] | null | undefined): TrafficSignal[] {
  if (!Array.isArray(elements)) return [];
  const seen = new Set<number>();
  const out: TrafficSignal[] = [];
  for (const el of elements) {
    if (el.type !== "node") continue;
    if (el.tags?.highway !== "traffic_signals") continue;
    if (el.lat == null || el.lon == null || !Number.isFinite(el.lat) || !Number.isFinite(el.lon)) continue;
    if (seen.has(el.id)) continue;
    seen.add(el.id);
    out.push({ id: `signal-${el.id}`, lat: el.lat, lon: el.lon });
  }
  return out;
}

/** Keep the nearest `cap` signals to a point — a dense downtown grid
 *  can hold hundreds inside the fetch radius, and the map only ever
 *  needs the ones around the truck. */
export function nearestSignals(signals: TrafficSignal[], at: { lat: number; lon: number }, cap: number): TrafficSignal[] {
  if (signals.length <= cap) return signals;
  const d2 = (s: TrafficSignal): number => {
    const dLat = s.lat - at.lat;
    // Longitude degrees shrink with latitude; a plain degree-distance
    // ranking is fine at this scale (it's a cap, not a measurement).
    const dLon = (s.lon - at.lon) * Math.cos((at.lat * Math.PI) / 180);
    return dLat * dLat + dLon * dLon;
  };
  return signals.slice().sort((a, b) => d2(a) - d2(b)).slice(0, cap);
}

/** A signal counts as ON the route when its projection lands within
 *  this distance of the line — a signal at the intersection the
 *  route passes through sits essentially on the line; a signal on a
 *  cross street one block over does not. */
export const SIGNAL_ON_ROUTE_MI = 0.12;

export interface SignalAhead {
  signal: TrafficSignal;
  /** Miles from the truck's route position to the signal. */
  distAheadMi: number;
  /** Along-route miles of the signal itself. */
  alongMi: number;
}

/** The next traffic signal ahead on the active route, or null.
 *  Signals at or behind the truck's position never fire, and neither
 *  do signals off the line (a light on a side street is not a light
 *  on your route). */
export function nextSignalAhead(
  signals: TrafficSignal[],
  coords: [number, number][],
  progressMi: number,
): SignalAhead | null {
  if (!coords || coords.length < 2 || !Number.isFinite(progressMi)) return null;
  let best: SignalAhead | null = null;
  for (const s of signals) {
    const proj = projectOntoRoute({ lat: s.lat, lon: s.lon }, coords);
    if (proj.offMi > SIGNAL_ON_ROUTE_MI) continue;
    const dist = proj.alongMi - progressMi;
    if (dist <= 0.02) continue; // at or behind the truck
    if (!best || dist < best.distAheadMi) best = { signal: s, distAheadMi: dist, alongMi: proj.alongMi };
  }
  return best;
}

/** All signals ahead on the route within `withinMi`, nearest first —
 *  the route strip's "lights ahead" count reads this. */
export function signalsAhead(
  signals: TrafficSignal[],
  coords: [number, number][],
  progressMi: number,
  withinMi: number,
): SignalAhead[] {
  if (!coords || coords.length < 2 || !Number.isFinite(progressMi)) return [];
  const out: SignalAhead[] = [];
  for (const s of signals) {
    const proj = projectOntoRoute({ lat: s.lat, lon: s.lon }, coords);
    if (proj.offMi > SIGNAL_ON_ROUTE_MI) continue;
    const dist = proj.alongMi - progressMi;
    if (dist <= 0.02 || dist > withinMi) continue;
    out.push({ signal: s, distAheadMi: dist, alongMi: proj.alongMi });
  }
  return out.sort((a, b) => a.distAheadMi - b.distAheadMi);
}

// ---------- On-device cache (offline replay) ---------------------------
// One cache entry per ~0.05° grid cell (about 3.5 mi) — the fetch
// radius is bigger than a cell, so a cell's stored set covers the
// area around it. Entries older than SIGNAL_CACHE_MAX_AGE_MS are
// stale map data and are dropped rather than drawn: OSM signals do
// get added/removed, and a month-old pin is a claim, not a cache.

export const SIGNAL_CACHE_MAX_AGE_MS = 7 * 24 * 3600_000;

export interface SignalCacheEntry {
  fetchedAtMs: number;
  signals: TrafficSignal[];
}

export function signalCacheKey(lat: number, lon: number): string {
  const cell = (v: number): number => Math.round(v / 0.05);
  return `tgps-signals-${cell(lat)},${cell(lon)}`;
}

/** Validate an untrusted cache payload. Anything malformed reads as
 *  no cache — the layer then simply waits for a live fetch. */
export function parseSignalCache(raw: unknown, nowMs: number): SignalCacheEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as { fetchedAtMs?: unknown; signals?: unknown };
  if (typeof e.fetchedAtMs !== "number" || !Number.isFinite(e.fetchedAtMs)) return null;
  if (nowMs - e.fetchedAtMs > SIGNAL_CACHE_MAX_AGE_MS || e.fetchedAtMs > nowMs + 3600_000) return null;
  if (!Array.isArray(e.signals)) return null;
  const signals: TrafficSignal[] = [];
  for (const s of e.signals) {
    if (!s || typeof s !== "object") return null;
    const sig = s as { id?: unknown; lat?: unknown; lon?: unknown };
    if (typeof sig.id !== "string" || typeof sig.lat !== "number" || typeof sig.lon !== "number") return null;
    if (!Number.isFinite(sig.lat) || !Number.isFinite(sig.lon)) return null;
    signals.push({ id: sig.id, lat: sig.lat, lon: sig.lon });
  }
  return { fetchedAtMs: e.fetchedAtMs, signals };
}
