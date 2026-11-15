// trailerTelemetry.ts — smart trailer (Research Wave 2
// item 11, Part C). Pure logic + the partner seam; the actions
// in actions.ts wire these to the DB and the chain.
//
// The trailer device (a telematics puck on the trailer — GPS +
// reefer temperature) belongs to a partner; STONEMILES builds no
// hardware and no second trailer registry: readings tie to the
// driver's existing My Trailer record by belonging to the
// driver, and reefer readings tie to the sealed load they were
// taken under. The seam is env-gated in the house style: with no
// TRAILER_PARTNER_API_KEY (+ base URL) configured, the panel
// says plainly that no trailer device is connected, and the only
// readings that can exist are the simulated test path's —
// stamped simulated in the data itself.
//
// FRESHNESS LAW (same as fleet visibility): a position is shown
// with its age, always — last-seen is a fact with a timestamp,
// never quietly upgraded to "current".

export const TRAILER_FRESH_MAX_MIN = 15;
export const TRAILER_RECENT_MAX_MIN = 120;

/** Mirrors client/src/trailer.ts REEFER_DEFAULT_BAND_F — the
 *  band a reefer judgement uses when a load carries a setpoint
 *  but no explicit band. */
export const REEFER_TELEMETRY_DEFAULT_BAND_F = 5;

// ---------------------------------------------------------------------
// Partner seam
// ---------------------------------------------------------------------

export interface TrailerReadingRequest {
  /** The partner's device reference for this trailer. */
  deviceRef: string;
  sinceIso: string;
}

export interface TrailerPartner {
  name: string;
  /** Pull readings for one device since a point in time. The
   *  partner answers with raw reading objects; the actions run
   *  them through validateTrailerReading before anything is
   *  stored — a partner's word is never stored unvalidated. */
  fetchReadings(req: TrailerReadingRequest): Promise<unknown[]>;
}

export type TrailerFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * The trailer telematics partner, when one is configured. Needs
 * BOTH TRAILER_PARTNER_API_KEY and TRAILER_PARTNER_BASE_URL — a
 * key alone names no partner to call. The transport defaults to
 * the global fetch; actions.ts passes none, so production is
 * unconfigured until a partner agreement + credentials exist.
 * Returns null when unconfigured.
 */
export function trailerPartnerFromEnv(
  env: Record<string, string | undefined>,
  transport?: TrailerFetch,
): TrailerPartner | null {
  const apiKey = env.TRAILER_PARTNER_API_KEY?.trim();
  const baseUrl = env.TRAILER_PARTNER_BASE_URL?.trim();
  if (!apiKey || !baseUrl) return null;
  const name = env.TRAILER_PARTNER_NAME?.trim() || "Trailer partner";
  const fetchFn: TrailerFetch =
    transport ??
    (async (url, init) => {
      const r = await fetch(url, init);
      return { ok: r.ok, status: r.status, json: () => r.json() as Promise<unknown> };
    });
  return {
    name,
    async fetchReadings(req) {
      const url = `${baseUrl.replace(/\/+$/, "")}/readings?device=${encodeURIComponent(req.deviceRef)}&since=${encodeURIComponent(req.sinceIso)}`;
      const r = await fetchFn(url, {
        method: "GET",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      });
      if (!r.ok) throw new Error(`trailer partner answered ${r.status}`);
      const out = (await r.json()) as { readings?: unknown };
      return Array.isArray(out) ? out : Array.isArray(out?.readings) ? (out.readings as unknown[]) : [];
    },
  };
}

// ---------------------------------------------------------------------
// Reading validation
// ---------------------------------------------------------------------

export type TrailerReadingKind = "position" | "reefer_temp";

export interface TrailerReading {
  kind: TrailerReadingKind;
  lat: number | null;
  lon: number | null;
  tempF: number | null;
  /** ISO timestamp of when the device took the reading. */
  recordedAt: string;
  /** The partner's reference for the load the reading belongs
   *  to, when it sends one. Informational — app load ties are
   *  made by the ingest path's own load id, never by trusting a
   *  partner reference to name a sealed record. */
  loadRef: string | null;
}

export type TrailerReadingValidation =
  | { ok: true; reading: TrailerReading }
  | { ok: false; errors: string[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function numIn(v: unknown, min: number, max: number): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;
}

/** Validate one raw reading from any source (partner pull or the
 *  simulated generator). A position reading needs a valid
 *  coordinate pair; a reefer reading needs a plausible
 *  temperature; both need a real timestamp. */
export function validateTrailerReading(raw: unknown): TrailerReadingValidation {
  if (!isRecord(raw)) return { ok: false, errors: ["reading must be a JSON object"] };
  const errors: string[] = [];
  const kindRaw = typeof raw.kind === "string" ? raw.kind : "";
  const kind: TrailerReadingKind | null =
    kindRaw === "position" || kindRaw === "reefer_temp" ? kindRaw : null;
  if (!kind) errors.push("kind must be position or reefer_temp");
  const recordedAtRaw = typeof raw.recordedAt === "string" ? raw.recordedAt : typeof raw.timestamp === "string" ? raw.timestamp : "";
  if (!recordedAtRaw || Number.isNaN(Date.parse(recordedAtRaw))) {
    errors.push("recordedAt must be an ISO timestamp");
  }
  let lat: number | null = null;
  let lon: number | null = null;
  let tempF: number | null = null;
  if (kind === "position") {
    lat = numIn(raw.lat, -90, 90);
    lon = numIn(raw.lon, -180, 180);
    if (lat == null || lon == null) errors.push("a position reading needs a valid lat/lon pair");
  }
  if (kind === "reefer_temp") {
    tempF = numIn(raw.tempF, -80, 160);
    if (tempF == null) errors.push("a reefer reading needs a plausible tempF");
    // A reefer reading may carry where it was taken; keep it when valid.
    const la = numIn(raw.lat, -90, 90);
    const lo = numIn(raw.lon, -180, 180);
    if (la != null && lo != null) {
      lat = la;
      lon = lo;
    }
  }
  if (errors.length > 0 || !kind) return { ok: false, errors };
  return {
    ok: true,
    reading: {
      kind,
      lat,
      lon,
      tempF,
      recordedAt: new Date(recordedAtRaw).toISOString(),
      loadRef: typeof raw.loadRef === "string" && raw.loadRef.trim() !== "" ? raw.loadRef.trim() : null,
    },
  };
}

// ---------------------------------------------------------------------
// Freshness + reefer judgement
// ---------------------------------------------------------------------

export type TrailerFreshness = "fresh" | "recent" | "stale";

export function trailerFreshness(recordedAtMs: number, nowMs: number): { ageMinutes: number; freshness: TrailerFreshness; line: string } {
  const ageMinutes = Math.max(0, Math.round((nowMs - recordedAtMs) / 60000));
  const freshness: TrailerFreshness =
    ageMinutes <= TRAILER_FRESH_MAX_MIN ? "fresh" : ageMinutes <= TRAILER_RECENT_MAX_MIN ? "recent" : "stale";
  const when =
    ageMinutes < 1 ? "just now" : ageMinutes < 60 ? `${ageMinutes} min ago` : `${Math.floor(ageMinutes / 60)} h ${ageMinutes % 60} min ago`;
  return {
    ageMinutes,
    freshness,
    line: `Last seen ${when} — the device reported then; this is not a live position.`,
  };
}

export interface ReeferRange {
  minF: number;
  maxF: number;
  setpointF: number;
  bandF: number;
}

/** The range a load's readings are judged against, from the
 *  load's own driver-set setpoint/band (the same pair the
 *  driver-entered reefer checks use). No setpoint on the load →
 *  no range, and readings are logged without judgement. */
export function reeferRangeForLoad(load: { reeferSetpointF: number | null; reeferBandF: number | null }): ReeferRange | null {
  if (load.reeferSetpointF == null || !Number.isFinite(load.reeferSetpointF)) return null;
  const band = load.reeferBandF != null && Number.isFinite(load.reeferBandF) && load.reeferBandF >= 0 ? load.reeferBandF : REEFER_TELEMETRY_DEFAULT_BAND_F;
  return {
    setpointF: load.reeferSetpointF,
    bandF: band,
    minF: Math.round((load.reeferSetpointF - band) * 10) / 10,
    maxF: Math.round((load.reeferSetpointF + band) * 10) / 10,
  };
}

export function reeferTempVerdict(tempF: number, range: ReeferRange): "in_range" | "out_of_range" {
  return tempF < range.minF || tempF > range.maxF ? "out_of_range" : "in_range";
}

// ---------------------------------------------------------------------
// Simulated readings
// ---------------------------------------------------------------------

/** The simulated device's readings. Plausible, deterministic
 *  given `now`, and stamped simulated by the caller in the
 *  stored rows themselves. */
export function simulatedTrailerReadings(now: Date): TrailerReading[] {
  const minsAgo = (m: number) => new Date(now.getTime() - m * 60000).toISOString();
  return [
    { kind: "position", lat: 30.69, lon: -88.04, tempF: null, recordedAt: minsAgo(4), loadRef: null },
    { kind: "reefer_temp", lat: 30.69, lon: -88.04, tempF: 34.5, recordedAt: minsAgo(4), loadRef: null },
  ];
}
