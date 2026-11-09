// Lane estimates for the automatic $/mi (see loadRate.ts for the
// rules). When a load carries no loaded miles of its own, its card
// can still show a $/mi from a city-to-city ESTIMATE: both cities are
// geocoded once (Nominatim, the same keyless engine the app's search
// chain uses), the straight-line distance is stretched by the stated
// road factor, and the result is labelled "est." everywhere it shows.
//
// Estimates are display-only: they are never saved onto a load, and a
// load's own miles (document / entered, or a saved estimate the user
// confirmed in the form) always replace them. Geocoding is cached
// per city for the session and capped per render batch, so a board
// full of loads costs a handful of lookups, not one per card per
// paint. Any failure (offline, city not found) simply leaves that
// load's $/mi blank — honest, never guessed.

import { useEffect, useMemo, useState } from "react";
import { estimateLoadedMiles, type LatLon } from "./loadRate";

export type LaneLike = {
  pickupCity: string | null;
  pickupState: string | null;
  deliveryCity: string | null;
  deliveryState: string | null;
  rate: number | null;
  extraCharges: number;
  loadedMiles: number | null;
};

const cityCache = new Map<string, LatLon | null>();
const cityInflight = new Map<string, Promise<LatLon | null>>();

function cityKey(city: string, state: string | null): string {
  return `${city.trim().toLowerCase()},${(state ?? "").trim().toLowerCase()}`;
}

async function geocodeCity(city: string, state: string | null): Promise<LatLon | null> {
  const key = cityKey(city, state);
  if (cityCache.has(key)) return cityCache.get(key) ?? null;
  const pending = cityInflight.get(key);
  if (pending) return pending;
  const run = (async (): Promise<LatLon | null> => {
    try {
      const q = encodeURIComponent(`${city}, ${state ?? ""}, USA`);
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${q}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error("geocode failed");
      const hits = (await res.json()) as { lat?: string; lon?: string }[];
      const hit = hits[0];
      const point = hit?.lat && hit?.lon ? { lat: parseFloat(hit.lat), lon: parseFloat(hit.lon) } : null;
      cityCache.set(key, point);
      return point;
    } catch {
      // Not cached on failure — a later mount may retry when the
      // connection is back. The card just shows no $/mi meanwhile.
      return null;
    } finally {
      cityInflight.delete(key);
    }
  })();
  cityInflight.set(key, run);
  return run;
}

/** Estimated MILES keyed by lane (see laneKey) — miles only, never a
 *  $/mi: the $/mi is figured per load from its own rate via
 *  laneEstimateFor in loadRate.ts. Only lanes whose loads need one
 *  (rate on file, no stored miles, both cities present) are ever
 *  geocoded. */
export function laneKey(l: LaneLike): string {
  return [l.pickupCity ?? "", l.pickupState ?? "", l.deliveryCity ?? "", l.deliveryState ?? ""].join("|");
}

const MAX_LANES_PER_BATCH = 8;

export function useLaneEstimates(lanes: LaneLike[]): Map<string, number> {
  const [estimates, setEstimates] = useState<Map<string, number>>(new Map());

  const needed = useMemo(() => {
    const map = new Map<string, LaneLike>();
    for (const l of lanes) {
      if (l.rate == null || l.loadedMiles != null) continue;
      if (!l.pickupCity || !l.deliveryCity) continue;
      map.set(laneKey(l), l);
    }
    return map;
  }, [lanes]);

  const neededKeys = useMemo(() => [...needed.keys()].sort().join("~"), [needed]);

  useEffect(() => {
    if (needed.size === 0) return;
    let cancelled = false;
    void (async () => {
      const fresh = new Map<string, number>();
      let count = 0;
      for (const [key, l] of needed) {
        if (cancelled || count >= MAX_LANES_PER_BATCH) break;
        if (estimates.has(key)) continue;
        count++;
        const [from, to] = await Promise.all([
          geocodeCity(l.pickupCity!, l.pickupState),
          geocodeCity(l.deliveryCity!, l.deliveryState),
        ]);
        const miles = estimateLoadedMiles(from, to);
        if (miles != null) fresh.set(key, miles);
      }
      if (!cancelled && fresh.size > 0) {
        setEstimates((prev) => {
          const next = new Map(prev);
          for (const [k, v] of fresh) next.set(k, v);
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // estimates is read for the skip-check only; neededKeys is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [neededKeys]);

  return estimates;
}
