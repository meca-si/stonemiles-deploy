// RouteWeatherPanel.tsx — Route weather (driver order 2026-11-01:
// "add weather also" → "Let's do it. We SI keep it updated?").
//
// NOT a weather app: this is weather a driver acts on.
//  - Corridor: conditions sampled at points AHEAD of the truck on
//    the active route, labelled by miles ahead (routeWeather.ts).
//    With no route it honestly shows current-position weather
//    only, and says so.
//  - Wind gusts against the driver's own threshold — gusts are a
//    flatbed decision, so the line is the driver's to set.
//  - Tonight at your stop: weather pinned to where the HOS
//    driving clock runs out on this route (the parking planner's
//    reachability math), paired with the real stop near that
//    point when one exists — its stop card opens from here.
//  - Radar: the Layers switch draws the NWS NEXRAD overlay; this
//    panel carries the same switch plus the honest tile status.
//
// SI keeps it updated (the driver's words): while the SI layer is
// ON, this panel re-fetches on its own — every 10 minutes, when
// the route changes, and when the truck has rolled ~5 mi since
// the last fetch — and decision-grade weather (ice/snow/storm
// ahead, gusts over the threshold, severe weather on tonight's
// stop) surfaces ONCE per corridor segment per 6-hour window as
// an SI decisions-inbox item + banner (server dedupes across
// sessions; a device-local fired list dedupes the banner).
// Benign weather never surfaces — SI Rule 5, decisions only.
// While SI is off the panel still works manually (Refresh, and a
// fetch when the route changes) but nothing auto-surfaces.
//
// Sources are PUBLIC only (SI Rule 1): Open-Meteo forecasts and
// National Weather Service alerts, both keyless. A feed that
// doesn't answer yields "weather unavailable" — never a guess.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import {
  CONDITION_LABEL,
  RADAR_SOURCE_LABEL,
  clampGustThreshold,
  conditionFromWmo,
  corridorSamplePoints,
  estimateTonightStop,
  evaluateWeatherDecisions,
  haversineMi,
  pairTonightStop,
  type CorridorWeatherPoint,
  type TonightWeather,
  type WeatherCondition,
  type WeatherDecision,
} from "./routeWeather";

type LatLon = { lat: number; lon: number };

export type RouteWeatherStopLike = { name: string; alongMi: number; lat: number; lon: number };

const CONDITION_ICON: Record<WeatherCondition, string> = {
  thunderstorm: "⛈️",
  freezing_rain: "🧊",
  snow: "❄️",
  heavy_rain: "🌧️",
  rain: "🌦️",
  fog: "🌫️",
  clear: "☀️",
  cloudy: "☁️",
  unknown: "—",
};

const SEVERITY: Record<WeatherCondition, number> = {
  clear: 0, cloudy: 1, unknown: 1, rain: 2, fog: 3, heavy_rain: 4, snow: 5, freezing_rain: 6, thunderstorm: 7,
};

async function fetchJson(url: string, timeoutMs = 12000): Promise<unknown> {
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

type OmResponse = {
  current?: {
    temperature_2m?: number;
    weather_code?: number;
    wind_speed_10m?: number;
    wind_gusts_10m?: number;
    visibility?: number;
  };
  hourly?: { time?: string[]; weather_code?: number[]; precipitation_probability?: number[] };
  daily?: {
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
    wind_gusts_10m_max?: number[];
  };
};

function omUrl(lat: number, lon: number): string {
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&current=temperature_2m,weather_code,wind_speed_10m,wind_gusts_10m,visibility` +
    `&hourly=weather_code,precipitation_probability` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_gusts_10m_max` +
    `&forecast_days=2&wind_speed_unit=mph&temperature_unit=fahrenheit`
  );
}

/** Tonight's condition from the overnight hourly codes (18:00
 *  today → 06:00 tomorrow, forecast-local indices 18..30): the
 *  worst condition in that window, because that's the sky the
 *  driver sleeps and wakes under. */
function tonightConditionFrom(data: OmResponse): WeatherCondition {
  const codes = data.hourly?.weather_code ?? [];
  let worst: WeatherCondition = conditionFromWmo(data.current?.weather_code ?? -1);
  for (let i = 18; i <= 30 && i < codes.length; i++) {
    const c = conditionFromWmo(codes[i] ?? -1);
    if (SEVERITY[c] > SEVERITY[worst]) worst = c;
  }
  return worst;
}

type NwsCorridorAlert = { id: string; event: string; area: string; nearLabel: string };

const FIRED_KEY = "sm-weather-decisions-fired-v1";
function loadFired(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(FIRED_KEY) ?? "{}") as Record<string, number>;
    const cutoff = Date.now() - 24 * 3600_000;
    return Object.fromEntries(Object.entries(raw).filter(([, t]) => typeof t === "number" && t > cutoff));
  } catch {
    return {};
  }
}

export function RouteWeatherPanel({
  pos,
  routeCoords,
  destinationLabel,
  hos,
  speedMph,
  fuelStops,
  gustThresholdMph,
  onGustThresholdChange,
  radarOn,
  onToggleRadar,
  radarStatus,
  onDecision,
  onSnapshot,
  onShowStop,
}: {
  pos: LatLon | null;
  routeCoords: [number, number][];
  destinationLabel: string | null;
  hos: { hasData: boolean; driveRemainH: number };
  speedMph: number | null;
  fuelStops: RouteWeatherStopLike[];
  gustThresholdMph: number;
  onGustThresholdChange: (mph: number) => void;
  radarOn: boolean;
  onToggleRadar: (on: boolean) => void;
  radarStatus: "unknown" | "available" | "unavailable";
  /** A decision-grade finding fired: App banners + speaks it per
   *  the driver's alert settings and logs it to AI activity. */
  onDecision: (msg: string) => void;
  /** One-line live summary for the Ask Meca snapshot — real fetched
   *  data only; null while nothing has answered. */
  onSnapshot?: (line: string | null) => void;
  /** Open the tap-a-stop card for the paired tonight stop. */
  onShowStop: (stop: RouteWeatherStopLike) => void;
}) {
  const siQuery = useQuery({ queryKey: ["si-state"], queryFn: () => api.getSiState({}) });
  const siEnabled = siQuery.data?.enabled ?? false;
  const threshold = clampGustThreshold(gustThresholdMph);

  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "unavailable">("idle");
  const [corridor, setCorridor] = useState<CorridorWeatherPoint[]>([]);
  const [tonightWx, setTonightWx] = useState<TonightWeather | null>(null);
  const [nwsAlerts, setNwsAlerts] = useState<NwsCorridorAlert[]>([]);
  const [decisions, setDecisions] = useState<WeatherDecision[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const anchorRef = useRef<{ routeKey: string; lat: number; lon: number } | null>(null);
  const firedRef = useRef<Record<string, number>>(loadFired());
  const fetchingRef = useRef(false);

  const routeKey = useMemo(
    () => (routeCoords.length > 1 ? `${routeCoords.length}|${routeCoords[0]![0].toFixed(3)},${routeCoords[0]![1].toFixed(3)}|${routeCoords[routeCoords.length - 1]![0].toFixed(3)},${routeCoords[routeCoords.length - 1]![1].toFixed(3)}` : "no-route"),
    [routeCoords],
  );

  const samples = useMemo(() => corridorSamplePoints(routeCoords, pos), [routeCoords, pos]);
  const tonightEst = useMemo(
    () =>
      estimateTonightStop({
        coords: routeCoords,
        pos,
        hosHasData: hos.hasData,
        driveRemainH: hos.driveRemainH,
        speedMph,
        destinationLabel,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routeKey, hos.hasData, hos.driveRemainH, destinationLabel],
  );
  const pairedIdx = useMemo(() => {
    if (!tonightEst || tonightEst.basis === "here") return -1;
    return pairTonightStop(fuelStops, tonightEst.aheadMi);
  }, [fuelStops, tonightEst]);
  const pairedStop = pairedIdx >= 0 ? fuelStops[pairedIdx]! : null;
  const tonightPoint = pairedStop ?? tonightEst;
  const tonightLabel = pairedStop
    ? `Tonight's stop — ${pairedStop.name} (about ${Math.round(pairedStop.alongMi)} mi ahead, at your clock-out)`
    : (tonightEst?.label ?? "");

  const fetchWeather = useCallback(async () => {
    if (fetchingRef.current) return;
    const hasRoute = routeCoords.length > 1;
    if (!pos && !hasRoute) {
      setStatus("idle");
      return;
    }
    fetchingRef.current = true;
    setStatus((s) => (s === "ok" ? s : "loading"));
    try {
      // Points to fetch: corridor samples (or just here), plus
      // tonight's point when it isn't already a sample.
      const pts: { lat: number; lon: number; label: string; aheadMi: number; alongMi: number }[] = hasRoute
        ? samples.map((s) => ({ ...s }))
        : pos
          ? [{ lat: pos.lat, lon: pos.lon, label: "Here", aheadMi: 0, alongMi: 0 }]
          : [];
      let tonightData: OmResponse | null = null;
      const results = new Map<string, OmResponse>();
      const keyOf = (lat: number, lon: number) => `${lat.toFixed(3)},${lon.toFixed(3)}`;
      const fetchOm = async (lat: number, lon: number): Promise<OmResponse | null> => {
        const k = keyOf(lat, lon);
        const hit = results.get(k);
        if (hit) return hit;
        try {
          const d = (await fetchJson(omUrl(lat, lon))) as OmResponse;
          results.set(k, d);
          return d;
        } catch {
          return null;
        }
      };
      const corridorOut: CorridorWeatherPoint[] = [];
      for (const p of pts) {
        const d = await fetchOm(p.lat, p.lon);
        if (!d?.current) continue;
        const cur = d.current;
        corridorOut.push({
          lat: p.lat,
          lon: p.lon,
          alongMi: p.alongMi,
          aheadMi: p.aheadMi,
          label: p.label,
          condition: conditionFromWmo(cur.weather_code ?? -1),
          tempF: cur.temperature_2m ?? null,
          windMph: cur.wind_speed_10m ?? null,
          gustMph: cur.wind_gusts_10m ?? null,
          visibilityMi: cur.visibility != null ? Math.round((cur.visibility / 1609.34) * 10) / 10 : null,
        });
      }
      if (tonightPoint) {
        tonightData = await fetchOm(tonightPoint.lat, tonightPoint.lon);
      }
      if (corridorOut.length === 0 && !tonightData) {
        setStatus("unavailable");
        return;
      }
      // NWS alerts along the corridor (public, US only) — merged
      // with, never replacing, the Drive screen's own NWS banners.
      const alerts: NwsCorridorAlert[] = [];
      const seenAlert = new Set<string>();
      const alertPts = [...pts.slice(0, 5), ...(tonightPoint ? [{ ...tonightPoint, label: "Tonight's stop" }] : [])];
      for (const p of alertPts) {
        try {
          const data = (await fetchJson(`https://api.weather.gov/alerts/active?point=${p.lat.toFixed(4)},${p.lon.toFixed(4)}`)) as {
            features?: { id?: string; properties?: { event?: string; areaDesc?: string } }[];
          };
          for (const f of data.features ?? []) {
            const ev = f.properties?.event ?? "";
            if (!/(warning|watch)/i.test(ev)) continue;
            if (!/(tornado|thunderstorm|winter|blizzard|ice storm|flood|wind|hurricane|snow)/i.test(ev)) continue;
            const id = f.id ?? `${ev}|${f.properties?.areaDesc ?? ""}`;
            if (seenAlert.has(id)) continue;
            seenAlert.add(id);
            alerts.push({ id, event: ev, area: f.properties?.areaDesc ?? "", nearLabel: p.label });
          }
        } catch {
          // NWS unreachable for this point — no alert is invented.
        }
      }
      const tonightWxOut: TonightWeather | null = tonightData
        ? {
            condition: tonightConditionFrom(tonightData),
            lowF: tonightData.daily?.temperature_2m_min?.[0] ?? null,
            highF: tonightData.daily?.temperature_2m_max?.[0] ?? null,
            precipChancePct: tonightData.daily?.precipitation_probability_max?.[0] ?? null,
            gustMaxMph: tonightData.daily?.wind_gusts_10m_max?.[0] ?? null,
            windMph: tonightData.current?.wind_speed_10m ?? null,
          }
        : null;
      setCorridor(corridorOut);
      setTonightWx(tonightWxOut);
      setNwsAlerts(alerts);
      setStatus("ok");
      setUpdatedAt(Date.now());
      if (onSnapshot) {
        const parts = corridorOut.map(
          (p) => `${p.label}${p.aheadMi >= 1 ? ` (${Math.round(p.aheadMi)} mi ahead)` : ""}: ${CONDITION_LABEL[p.condition]}${p.tempF != null ? ` ${Math.round(p.tempF)}°F` : ""}${p.gustMph != null ? `, gusts ${Math.round(p.gustMph)} mph` : ""}`,
        );
        const tonightPart = tonightWxOut
          ? ` Tonight at the stop (${tonightLabel}): ${CONDITION_LABEL[tonightWxOut.condition]}${tonightWxOut.lowF != null ? `, low ${Math.round(tonightWxOut.lowF)}°F` : ""}${tonightWxOut.gustMaxMph != null ? `, gusts to ${Math.round(tonightWxOut.gustMaxMph)} mph` : ""}.`
          : "";
        const nwsPart = alerts.length > 0 ? ` NWS alerts on the corridor: ${alerts.map((a) => a.event).join(", ")}.` : "";
        onSnapshot(`Route weather (Open-Meteo + NWS, updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}): ${parts.join(" · ")}.${tonightPart}${nwsPart} Gust decision line: ${threshold} mph. The radar overlay switch lives in Layers & display on the map.`);
      }
      if (pos) anchorRef.current = { routeKey, lat: pos.lat, lon: pos.lon };
      else if (pts[0]) anchorRef.current = { routeKey, lat: pts[0].lat, lon: pts[0].lon };

      // Decision grading — SI Rule 5: only decision-grade weather
      // surfaces, once per segment per 6-hour window.
      const graded = evaluateWeatherDecisions({
        corridor: corridorOut,
        tonight: tonightWxOut && tonightEst ? { weather: tonightWxOut, label: tonightLabel } : null,
        gustThresholdMph: threshold,
        atMs: Date.now(),
      });
      setDecisions(graded);
      for (const d of graded) {
        if (firedRef.current[d.dedupeKey]) continue;
        firedRef.current[d.dedupeKey] = Date.now();
        try {
          localStorage.setItem(FIRED_KEY, JSON.stringify(firedRef.current));
        } catch { /* device storage unavailable — in-session dedupe still holds */ }
        if (siEnabled) {
          onDecision(`Route weather decision: ${d.title}. ${d.detail}`);
          void api
            .reportSiWeatherAlert({ dedupeKey: d.dedupeKey, title: d.title, detail: d.detail })
            .then(() => undefined)
            .catch(() => undefined);
        }
      }
    } finally {
      fetchingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, samples.length, tonightPoint?.lat, tonightPoint?.lon, siEnabled, threshold]);

  // Fetch on mount and whenever the route itself changes.
  const routeKeyRef = useRef<string>("");
  useEffect(() => {
    if (routeKeyRef.current === routeKey && status !== "idle") return;
    routeKeyRef.current = routeKey;
    void fetchWeather();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  // SI keeps it updated: while SI is on, refresh on a 10-minute
  // beat and whenever the truck has rolled ~5 mi past the anchor.
  useEffect(() => {
    if (!siEnabled) return;
    const t = setInterval(() => void fetchWeather(), 600_000);
    return () => clearInterval(t);
  }, [siEnabled, fetchWeather]);
  useEffect(() => {
    if (!siEnabled || !pos || !anchorRef.current) return;
    if (anchorRef.current.routeKey !== routeKey) return;
    if (haversineMi(pos, anchorRef.current) >= 5) void fetchWeather();
  }, [siEnabled, pos, routeKey, fetchWeather]);

  const hasRoute = routeCoords.length > 1;

  return (
    <section className="glass-panel p-3.5" aria-label="Route weather — weather on your route, kept updated by SI">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-condensed text-xl font-semibold">🌦️ Route weather</h2>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="rounded-full bg-[var(--surface2)] px-2.5 py-1 text-[10px] font-bold text-[var(--accent)]">
            {siEnabled ? "SI KEEPING IT UPDATED" : "SI OFF — MANUAL"}
          </span>
          <button
            type="button"
            className="btn-press rounded-full bg-[var(--surface2)] border border-[var(--border)] px-3 py-1.5 text-xs font-bold"
            aria-label="Refresh route weather now"
            onClick={() => void fetchWeather()}
          >
            ↻ Refresh
          </button>
        </span>
      </div>
      <p className="mt-1 text-xs text-[var(--dim)]">
        Weather on <em>your corridor</em> — not a city forecast. Public data only (SI Rule 1): Open-Meteo forecasts +
        National Weather Service alerts.
        {updatedAt ? ` Updated ${new Date(updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` : ""}
        {siEnabled ? " While SI is on it re-checks every 10 minutes, on route changes, and every ~5 miles you roll — silently, until the weather becomes a decision." : " Turn SI on (Driver tab) and it keeps this updated on its own and surfaces only decisions."}
      </p>

      {!pos && !hasRoute && (
        <p className="mt-2.5 rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-sm text-[var(--dim)]" role="status">
          Weather needs a GPS position or a route. Start GPS or plan a route and the corridor fills in — nothing is shown until a feed actually answers for a real place.
        </p>
      )}
      {status === "loading" && (
        <p className="mt-2.5 text-sm text-[var(--dim)]" role="status">Checking the corridor…</p>
      )}
      {status === "unavailable" && (
        <p className="mt-2.5 rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-sm font-semibold" role="status">
          Weather unavailable right now — the public feeds didn't answer, so nothing is guessed. Tap Refresh to try again.
        </p>
      )}

      {status === "ok" && (
        <>
          {!hasRoute && (
            <p className="mt-2.5 rounded-xl bg-amber-900/40 px-3 py-2.5 text-sm font-semibold text-amber-200" role="status">
              No route set — showing weather where you are only. Plan a route and this becomes corridor weather: conditions ahead of the truck, gust warnings, and tonight at your stop.
            </p>
          )}
          {/* Corridor samples */}
          <ul className="mt-2.5 space-y-1.5" aria-label="Weather along your route">
            {corridor.map((p) => (
              <li key={`${p.label}-${p.alongMi}`} className="flex items-center gap-3 rounded-xl bg-[var(--surface2)] px-3 py-2.5">
                <span className="text-2xl" aria-hidden>{CONDITION_ICON[p.condition]}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">
                    {p.label}
                    {p.aheadMi >= 1 ? <span className="text-[var(--dim)]"> · {Math.round(p.aheadMi)} mi ahead</span> : null}
                    {" — "}
                    {CONDITION_LABEL[p.condition]}
                  </span>
                  <span className="block text-xs text-[var(--dim)]">
                    {p.tempF != null ? `${Math.round(p.tempF)}°F · ` : ""}
                    wind {p.windMph != null ? Math.round(p.windMph) : "—"} mph
                    {p.gustMph != null ? (
                      <>
                        {" · gusts "}
                        <strong className={p.gustMph >= threshold ? "text-[var(--danger)]" : undefined}>{Math.round(p.gustMph)} mph</strong>
                        {p.gustMph >= threshold ? " — over your line" : ""}
                      </>
                    ) : null}
                    {p.visibilityMi != null && p.visibilityMi < 3 ? ` · visibility ${p.visibilityMi} mi` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          {hasRoute && (
            <p className="mt-2 text-xs leading-relaxed text-[var(--dim)]">
              Coverage, exactly: point checks at the spots listed above — here, about 25 / 60 / 120 mi ahead where the
              route is long enough, your destination, and tonight's stop — plus National Weather Service alerts for
              the corridor. The stretches between check points are not sampled: a clear list means nothing severe at
              the checked points, not a promise for every mile. Advisory only — official forecasts, road reports, and
              posted signs govern.
            </p>
          )}

          {/* NWS alerts on this corridor */}
          {nwsAlerts.length > 0 && (
            <ul className="mt-2 space-y-1.5" aria-label="National Weather Service alerts on your route">
              {nwsAlerts.map((a) => (
                <li key={a.id} className="rounded-xl border border-red-300/50 bg-[var(--danger)]/15 px-3 py-2.5 text-sm font-bold">
                  🌩️ NWS: {a.event} — {a.area}
                  <span className="block text-xs font-semibold text-[var(--dim)]">Near: {a.nearLabel} · Source: National Weather Service</span>
                </li>
              ))}
            </ul>
          )}

          {/* Decision-grade findings */}
          {decisions.length > 0 && (
            <div className="mt-2.5" aria-label="Decision-grade weather">
              <div className="text-xs font-bold uppercase tracking-wide text-[var(--dim)]">
                Decision-grade — {siEnabled ? "surfaced by SI, once each" : "SI is off, so these stay in this panel only"}
              </div>
              <ul className="mt-1.5 space-y-1.5">
                {decisions.map((d) => (
                  <li key={d.dedupeKey} className="rounded-xl bg-amber-900/40 px-3 py-2.5 text-sm font-semibold text-amber-200" role="alert">
                    ⚠️ {d.title}
                    <span className="mt-0.5 block text-xs font-normal">{d.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Tonight at your stop */}
          {tonightEst && tonightWx && (
            <div className="mt-3 rounded-2xl bg-[var(--surface2)] px-3.5 py-3" aria-label="Tonight at your stop">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-condensed text-lg font-bold leading-tight">🌙 Tonight at your stop</div>
                  <div className="mt-0.5 text-sm font-semibold">{tonightLabel}</div>
                </div>
                <span className="text-3xl" aria-hidden>{CONDITION_ICON[tonightWx.condition]}</span>
              </div>
              <div className="mt-1.5 text-sm">
                {CONDITION_LABEL[tonightWx.condition]}
                {tonightWx.lowF != null && tonightWx.highF != null ? ` · low ${Math.round(tonightWx.lowF)}°F / high ${Math.round(tonightWx.highF)}°F` : tonightWx.lowF != null ? ` · low ${Math.round(tonightWx.lowF)}°F` : ""}
                {tonightWx.precipChancePct != null ? ` · ${Math.round(tonightWx.precipChancePct)}% precip` : ""}
                {tonightWx.gustMaxMph != null ? ` · gusts to ${Math.round(tonightWx.gustMaxMph)} mph` : ""}
              </div>
              <p className="mt-1 text-xs text-[var(--dim)]">
                {tonightEst.basis === "hos_clock"
                  ? "Pinned to where your HOS driving clock runs out on this route — the same reachability estimate the parking planner uses."
                  : tonightEst.basis === "destination"
                    ? "Your destination is tonight's stop on this run (or no HOS log yet, so the destination is the honest pin)."
                    : "No route set — tonight is pinned to where you are."}
              </p>
              {pairedStop && (
                <button
                  type="button"
                  className="btn-press mt-2 w-full rounded-xl border border-[var(--accent)] px-3 py-2.5 text-sm font-bold text-[var(--accent)]"
                  aria-label={`Open the stop card for ${pairedStop.name} — tonight's stop, parking and amenities`}
                  onClick={() => onShowStop(pairedStop)}
                >
                  🅿️ Stop card for tonight's stop — parking &amp; amenities →
                </button>
              )}
            </div>
          )}
          {tonightEst && !tonightWx && status === "ok" && (
            <p className="mt-3 rounded-2xl bg-[var(--surface2)] px-3.5 py-2.5 text-sm text-[var(--dim)]" role="status">
              Tonight's stop is estimated ({tonightEst.label.toLowerCase()}), but its weather didn't answer — not guessed. Refresh to retry.
            </p>
          )}
        </>
      )}

      {/* Gust threshold — the driver's own line */}
      <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-[var(--surface2)] px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-sm font-bold">💨 Wind-gust decision line</div>
          <div className="text-xs text-[var(--dim)]">Gusts at or over this become a decision — flatbed-relevant. Yours to set.</div>
        </div>
        <label className="shrink-0 text-xs font-bold text-[var(--dim)]">
          <span className="sr-only">Wind gust threshold in miles per hour</span>
          <select
            aria-label="Wind gust threshold in miles per hour — gusts at or over this surface as a decision"
            value={threshold}
            onChange={(e) => onGustThresholdChange(clampGustThreshold(Number(e.target.value)))}
            className="rounded-lg bg-[var(--surface)] px-2.5 py-2 text-sm font-bold border border-[var(--border)]"
          >
            {[25, 30, 35, 40, 45, 50].map((v) => (
              <option key={v} value={v}>{v} mph</option>
            ))}
          </select>
        </label>
      </div>

      {/* Radar — same switch as Layers & display */}
      <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-[var(--surface2)] px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-sm font-bold">📡 Weather radar on the map</div>
          <div className="text-xs text-[var(--dim)]">
            {!radarOn
              ? "Off — turn it on and live precipitation draws over the map."
              : radarStatus === "available"
                ? `Live — ${RADAR_SOURCE_LABEL}.`
                : radarStatus === "unavailable"
                  ? "Radar tiles didn't answer — no overlay is shown rather than a fake one. Weather data above is unaffected."
                  : "Checking the radar tiles…"}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={radarOn}
          aria-label="Show weather radar on the map"
          onClick={() => onToggleRadar(!radarOn)}
          className={`h-8 w-14 shrink-0 rounded-full p-1 ${radarOn ? "bg-[var(--ok)]" : "bg-[var(--surface)] border border-[var(--border)]"}`}
        >
          <span className={`block h-6 w-6 rounded-full bg-white ${radarOn ? "translate-x-6" : ""}`} />
        </button>
      </div>
      <p className="mt-2 text-xs text-[var(--dim)]">
        Radar source: {RADAR_SOURCE_LABEL}. Corridor and tonight forecasts: Open-Meteo. Alerts: National Weather Service.
        When a feed is down this panel says “unavailable” — conditions are never invented.
      </p>
    </section>
  );
}
