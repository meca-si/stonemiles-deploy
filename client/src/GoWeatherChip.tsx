// GoWeatherChip.tsx — live weather ON the Go map (field fix
// 2026-11-01: "No weather update").
//
// The chip owns its own fetch (goWeather.ts): Open-Meteo current
// conditions HERE plus the corridor sample ~60 mi ahead when a
// route is set. It refreshes every 10 minutes, on route changes,
// and every ~5 miles rolled — deliberately NOT gated on SI: the
// Route weather panel's SI-gated auto-refresh is what left the
// driving screen with no weather at all while SI was off. SI
// still owns decision-grade surfacing (panel + inbox); this chip
// is the plain readout a driver glances at, and it says
// "unavailable" with a Retry when the feed doesn't answer —
// conditions are never invented.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  goWeatherUrl,
  parseGoWeather,
  shouldFetchGoWeather,
  type GoWeatherAnchor,
  type GoWeatherAhead,
  type GoWeatherReading,
  type LatLon,
} from "./goWeather";
import { CONDITION_LABEL, corridorSamplePoints } from "./routeWeather";

const CONDITION_ICON: Record<string, string> = {
  thunderstorm: "⛈️",
  freezing_rain: "🧊",
  snow: "❄️",
  heavy_rain: "🌧️",
  rain: "🌦️",
  fog: "🌫️",
  clear: "☀️",
  cloudy: "☁️",
  unknown: "🌡️",
};

async function fetchJson(url: string, timeoutMs = 9000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(t);
  }
}

function readingText(r: GoWeatherReading): string {
  return (
    `${CONDITION_LABEL[r.condition]}` +
    `${r.tempF != null ? ` ${Math.round(r.tempF)}°F` : ""}` +
    `${r.gustMph != null ? ` · gusts ${Math.round(r.gustMph)} mph` : r.windMph != null ? ` · wind ${Math.round(r.windMph)} mph` : ""}`
  );
}

export function GoWeatherChip({
  pos,
  routeCoords,
  onReading,
}: {
  pos: LatLon | null;
  routeCoords: [number, number][];
  /** Trailer Package (2026-11-06): the "here" reading is also
   *  reported up so the Drive screen can run the empty-trailer wind
   *  advisory off the SAME fetch — no second weather call. */
  onReading?: (r: GoWeatherReading | null) => void;
}) {
  const [here, setHere] = useState<GoWeatherReading | null>(null);
  const [ahead, setAhead] = useState<GoWeatherAhead | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "unavailable">("idle");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const anchorRef = useRef<GoWeatherAnchor | null>(null);
  const fetchingRef = useRef(false);

  const routeKey = useMemo(
    () =>
      routeCoords.length > 1
        ? `${routeCoords.length}|${routeCoords[0]![0].toFixed(3)},${routeCoords[0]![1].toFixed(3)}|${routeCoords[routeCoords.length - 1]![0].toFixed(3)},${routeCoords[routeCoords.length - 1]![1].toFixed(3)}`
        : "no-route",
    [routeCoords],
  );
  // The ahead sample: the corridor point nearest +60 mi (the
  // panel's own sampling — here / +25 / +60 / +120 / destination).
  const aheadPoint = useMemo(() => {
    if (!pos || routeCoords.length < 2) return null;
    const pts = corridorSamplePoints(routeCoords, pos);
    const candidates = pts.filter((p) => p.aheadMi >= 20);
    if (candidates.length === 0) return null;
    return candidates.reduce((best, p) => (Math.abs(p.aheadMi - 60) < Math.abs(best.aheadMi - 60) ? p : best), candidates[0]!);
  }, [routeCoords, pos]);

  const fetchWeather = useCallback(async () => {
    if (fetchingRef.current || !pos) return;
    fetchingRef.current = true;
    setStatus((s) => (s === "ok" ? s : "loading"));
    try {
      const hereData = await fetchJson(goWeatherUrl(pos.lat, pos.lon)).catch(() => null);
      const hereReading = hereData ? parseGoWeather(hereData) : null;
      let aheadReading: GoWeatherAhead | null = null;
      if (aheadPoint) {
        const d = await fetchJson(goWeatherUrl(aheadPoint.lat, aheadPoint.lon)).catch(() => null);
        const r = d ? parseGoWeather(d) : null;
        if (r) aheadReading = { ...r, aheadMi: aheadPoint.aheadMi };
      }
      if (!hereReading && !aheadReading) {
        setStatus("unavailable");
        return;
      }
      if (hereReading) {
        setHere(hereReading);
        onReading?.(hereReading);
      }
      setAhead(aheadReading);
      setStatus("ok");
      setUpdatedAt(Date.now());
      anchorRef.current = { lat: pos.lat, lon: pos.lon, routeKey, atMs: Date.now() };
    } finally {
      fetchingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos?.lat, pos?.lon, routeKey, aheadPoint?.lat, aheadPoint?.lon]);

  // Fetch on first position, on route change, every ~5 mi rolled,
  // and on the 10-minute beat — no SI gate, by design (see header).
  useEffect(() => {
    if (shouldFetchGoWeather({ anchor: anchorRef.current, pos, routeKey, nowMs: Date.now() })) {
      void fetchWeather();
    }
  }, [pos, routeKey, fetchWeather]);
  useEffect(() => {
    const t = setInterval(() => void fetchWeather(), 600_000);
    return () => clearInterval(t);
  }, [fetchWeather]);

  if (!pos) return null;

  const timeText = updatedAt
    ? new Date(updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;
  const aria =
    status === "ok" && here
      ? `Weather here: ${readingText(here)}${ahead ? `. Ahead ${Math.round(ahead.aheadMi)} miles: ${readingText(ahead)}` : ""}. Updated ${timeText ?? ""}. Source: Open-Meteo.`
      : status === "unavailable"
        ? "Weather unavailable — the public feed did not answer. Tap Retry weather to try again."
        : "Checking weather for the Go screen.";

  return (
    <div
      className="glass-pill flex max-w-[78vw] items-center gap-2 rounded-full py-1.5 pl-3 pr-2 text-[11px] font-bold leading-tight"
      role="status"
      aria-label={aria}
    >
      <span aria-hidden>{here ? (CONDITION_ICON[here.condition] ?? "🌡️") : "🌦️"}</span>
      {status === "ok" && here ? (
        <span className="min-w-0">
          {/* One line only (interface cleanup, 2026-11-01): the
              ahead-on-route reading stays in the aria-label above
              and in the Route weather panel — the chip no longer
              stacks a second line over the map. */}
          <span className="whitespace-nowrap">
            {readingText(here)}
            {timeText ? <span className="text-[var(--dim)]"> · {timeText}</span> : null}
          </span>
        </span>
      ) : status === "unavailable" ? (
        <span>Weather unavailable</span>
      ) : (
        <span>Checking weather…</span>
      )}
      {status === "unavailable" && (
        <button
          type="button"
          aria-label="Retry weather update"
          onClick={() => void fetchWeather()}
          className="btn-press shrink-0 rounded-full bg-[var(--accent)] px-2.5 py-1 text-[10px] font-bold text-black"
        >
          Retry
        </button>
      )}
    </div>
  );
}
