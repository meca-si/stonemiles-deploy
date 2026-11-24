/**
 * Samsara live-sync client (server-side only).
 *
 * Mirrors geotab.ts exactly: this module talks to Samsara's public REST
 * API (https://api.samsara.com, Bearer API token) and maps what it
 * returns into the SAME { feed, payload } batch items the Geotab layer
 * produces for applyEldSyncBatch — hos_logs ({ logs: [{ state, at }] }),
 * hos_clocks, vehicle_stats (flat readings), dvirs ({ dvirs: [...] }),
 * ifta ({ states: [...] }) and identity ({ driver, truck }). Endpoints
 * verified against Samsara's official API reference
 * (developer.samsara.com) 2026-11-24:
 *   GET /fleet/vehicles                    — fleet vehicles (VIN match)
 *   GET /fleet/hos/logs                    — HOS duty-status logs
 *   GET /fleet/hos/clocks                  — native HOS clocks (used as-is)
 *   GET /fleet/vehicles/stats              — GPS / odometer / engine stats
 *   GET /fleet/dvirs/history               — DVIR history
 *   GET /fleet/reports/ifta/jurisdiction   — IFTA miles by jurisdiction
 *   GET /fleet/drivers                     — driver directory (identity)
 *
 * READ-ONLY FOREVER: every call here is a GET. Nothing in this module can
 * write to Samsara, and the token is used only as the Authorization
 * header — never logged, never echoed into a batch.
 *
 * Clocks: Samsara computes HOS clocks itself, so the provider clocks are
 * used directly (durations in milliseconds). If the clocks endpoint
 * returns nothing usable for the driver, clocks fall back to the SAME
 * computation from the driver's own duty logs the Geotab mapper uses
 * (imported from geotab.ts, not re-implemented) — null when there are no
 * logs, never zero-filled.
 *
 * IFTA: the jurisdiction report's distance field names are not pinned in
 * Samsara's public docs, so the mapper accepts the documented-shape
 * variants (distanceMiles / totalMiles / miles / distanceMeters …) and
 * returns null — never a guess — when no row carries a recognizable
 * distance.
 *
 * The fetch implementation is injected so unit tests can drive the
 * mappers with recorded payloads and the flow tests can run against a
 * fake server.
 */

import { computeGeotabHosClocks } from "./geotab";

export type SamsaraFetchFn = (
  url: string,
  init: { method: string; headers: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export const SAMSARA_API_BASE = "https://api.samsara.com";

/** Raised when Samsara itself refuses a call (bad token, plan block, …). */
export class SamsaraApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "SamsaraApiError";
    this.status = status;
  }
}

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function asRec(v: unknown): Rec | null {
  return isRec(v) ? v : null;
}
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
function msToHours(ms: number): number {
  return round2(ms / 3_600_000);
}

async function samsaraGet(
  fetchFn: SamsaraFetchFn,
  token: string,
  path: string,
  params: Record<string, string> = {},
): Promise<unknown> {
  const qs = new URLSearchParams(params).toString();
  const url = `${SAMSARA_API_BASE}${path}${qs ? `?${qs}` : ""}`;
  const res = await fetchFn(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const msg =
      (isRec(body) && typeof body.message === "string" && body.message) ||
      `Samsara refused the request (HTTP ${res.status}). Check the API token and that the fleet plan includes the data being requested.`;
    throw new SamsaraApiError(msg, res.status);
  }
  return body;
}

/** One page of a Samsara list response: { data: [...], pagination }. */
function pageData(body: unknown): { rows: Rec[]; endCursor: string | null; hasNext: boolean } {
  const b = asRec(body);
  const rows = (Array.isArray(b?.data) ? b.data : []).filter(isRec);
  const pg = asRec(b?.pagination);
  return {
    rows,
    endCursor: typeof pg?.endCursor === "string" && pg.endCursor ? pg.endCursor : null,
    hasNext: pg?.hasNextPage === true,
  };
}

/** Follow cursor pagination (bounded) and return every row. */
async function samsaraList(
  fetchFn: SamsaraFetchFn,
  token: string,
  path: string,
  params: Record<string, string> = {},
  maxPages = 10,
): Promise<Rec[]> {
  const out: Rec[] = [];
  let after: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const body = await samsaraGet(fetchFn, token, path, after ? { ...params, after } : params);
    const { rows, endCursor, hasNext } = pageData(body);
    out.push(...rows);
    if (!hasNext || !endCursor || rows.length === 0) break;
    after = endCursor;
  }
  return out;
}

// ── Vehicle match ────────────────────────────────────────────────────────────

export interface SamsaraVehicle {
  id: string;
  name: string;
  vin: string;
  plate: string;
  make: string;
  model: string;
  year: number | null;
}

export function mapSamsaraVehicle(row: Rec): SamsaraVehicle | null {
  const id = row.id != null ? String(row.id) : "";
  if (!id) return null;
  const yr = num(row.year);
  return {
    id,
    name: str(row.name),
    vin: str(row.vin).toUpperCase(),
    plate: str(row.licensePlate),
    make: str(row.make),
    model: str(row.model),
    year: yr != null && yr > 1900 ? Math.trunc(yr) : null,
  };
}

/** VIN match — exact, case-insensitive, the same rule Geotab applies. */
export function findSamsaraVehicleByVin(vehicles: SamsaraVehicle[], vin: string): SamsaraVehicle | null {
  const want = vin.trim().toUpperCase();
  if (!want) return null;
  return vehicles.find((v) => v.vin === want) ?? null;
}

// ── HOS logs ─────────────────────────────────────────────────────────────────

const SAMSARA_STATUS_MAP: Record<string, string> = {
  OFFDUTY: "off_duty",
  SLEEPERBED: "sleeper",
  SLEEPERBERTH: "sleeper",
  SLEEPER: "sleeper",
  DRIVING: "driving",
  ONDUTY: "on_duty",
  YARDMOVE: "on_duty",
  PERSONALCONVEYANCE: "off_duty",
};

export function mapSamsaraHosStatus(raw: unknown): string | null {
  const key = str(raw).replace(/[^a-zA-Z]/g, "").toUpperCase();
  return SAMSARA_STATUS_MAP[key] ?? null;
}

export interface SamsaraDriverLogs {
  driverId: string;
  driverName: string;
  /** Contract entries: one per duty-status change, oldest first. */
  logs: { state: string; at: string; location?: string }[];
}

/**
 * Samsara /fleet/hos/logs returns one entry per driver, each carrying
 * that driver's hosLogs[] as intervals (logStartTime → logEndTime). The
 * feed contract is a change-of-state log, so each interval becomes one
 * entry at its start. Only intervals recorded against OUR vehicle are
 * kept, grouped by driver; the caller picks the driver with the newest.
 */
export function mapSamsaraHosLogs(entries: Rec[], vehicleId: string): SamsaraDriverLogs[] {
  const byDriver = new Map<string, SamsaraDriverLogs>();
  for (const entry of entries) {
    const driver = asRec(entry.driver);
    const driverId = driver?.id != null ? String(driver.id) : "";
    const driverName = str(driver?.name);
    const rawLogs = Array.isArray(entry.hosLogs) ? entry.hosLogs : [];
    for (const raw of rawLogs) {
      if (!isRec(raw)) continue;
      const veh = asRec(raw.vehicle);
      if (!veh || veh.id == null || String(veh.id) !== vehicleId) continue;
      const state = mapSamsaraHosStatus(raw.hosStatusType);
      const at = str(raw.logStartTime);
      if (!state || !at || Number.isNaN(Date.parse(at))) continue;
      const loc = asRec(raw.logRecordedLocation);
      const lat = num(loc?.latitude);
      const lon = num(loc?.longitude);
      const location =
        lat != null && lon != null && (lat !== 0 || lon !== 0)
          ? `${lat.toFixed(5)}, ${lon.toFixed(5)}`
          : undefined;
      const key = driverId || driverName;
      if (!key) continue;
      let group = byDriver.get(key);
      if (!group) {
        group = { driverId, driverName, logs: [] };
        byDriver.set(key, group);
      }
      group.logs.push(location ? { state, at, location } : { state, at });
    }
  }
  const groups = [...byDriver.values()];
  for (const g of groups) {
    g.logs.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    g.logs = g.logs.slice(-500);
  }
  return groups;
}

// ── HOS clocks (native provider clocks, computed fallback) ──────────────────

export interface SamsaraClocks {
  driveRemainH: number;
  windowRemainH: number;
  cycleRemainH: number;
  breakRemainH: number;
}

/**
 * Samsara's own clocks for one driver: clocks.{break,cycle,drive,shift}
 * each carry a remaining-duration in milliseconds. Used exactly as the
 * provider reports them — no local recomputation.
 */
export function mapSamsaraHosClocks(entries: Rec[], driverId: string, vehicleId: string): SamsaraClocks | null {
  const entry =
    entries.find((e) => {
      const d = asRec(e.driver);
      return driverId !== "" && d?.id != null && String(d.id) === driverId;
    }) ??
    entries.find((e) => {
      const v = asRec(e.currentVehicle);
      return v?.id != null && String(v.id) === vehicleId;
    }) ??
    null;
  if (!entry) return null;
  const clocks = asRec(entry.clocks);
  if (!clocks) return null;
  const rem = (k: string): number | null => {
    const c = asRec(clocks[k]);
    const ms = num(c?.timeUntilBreakDurationMs) ?? num(c?.remainingDurationMs) ?? num(c?.durationMs);
    return ms != null ? msToHours(ms) : null;
  };
  const drive = rem("drive");
  const shift = rem("shift");
  const cycle = rem("cycle");
  const brk = rem("break");
  if (drive == null || shift == null || cycle == null || brk == null) return null;
  return { driveRemainH: drive, windowRemainH: shift, cycleRemainH: cycle, breakRemainH: brk };
}

// ── Vehicle stats ────────────────────────────────────────────────────────────

/** /fleet/vehicles/stats row → flat vehicle_stats payload (present keys
 *  only), or null when the row carries no usable reading. Samsara's
 *  odometer stat is in meters; engine seconds convert to hours. */
export function mapSamsaraVehicleStats(
  row: Rec | null,
): { odometerMi?: number; lat?: number; lon?: number; engineHours?: number } | null {
  if (!row) return null;
  const out: { odometerMi?: number; lat?: number; lon?: number; engineHours?: number } = {};
  const gps = asRec(row.gps);
  const odo = asRec(row.obdOdometerMeters) ?? asRec(row.odometerMeters);
  const engSec = asRec(row.obdEngineSeconds) ?? asRec(row.engineSeconds);
  const engHrs = asRec(row.engineHours);
  const odoM = num(odo?.value);
  if (odoM != null && odoM > 0) out.odometerMi = Math.round((odoM / 1609.344) * 10) / 10;
  const sec = num(engSec?.value);
  const hrs = num(engHrs?.value);
  if (sec != null && sec > 0) out.engineHours = round2(sec / 3600);
  else if (hrs != null && hrs > 0) out.engineHours = round2(hrs);
  const lat = num(gps?.latitude);
  const lon = num(gps?.longitude);
  if (lat != null && lon != null && (lat !== 0 || lon !== 0)) {
    out.lat = lat;
    out.lon = lon;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// ── DVIRs ────────────────────────────────────────────────────────────────────

export function mapSamsaraDvirs(
  rows: Rec[],
  vehicleId: string,
  vehicleName: string | null,
): { dvirs: { id?: string; inspectedAt?: string; vehicle?: string; status?: string; defects?: { item: string; note?: string; critical?: boolean }[] }[] } {
  const out: { id?: string; inspectedAt?: string; vehicle?: string; status?: string; defects?: { item: string; note?: string; critical?: boolean }[] }[] = [];
  for (const row of rows) {
    const veh = asRec(row.vehicle);
    if (!veh || veh.id == null || String(veh.id) !== vehicleId) continue;
    const unsafe = str(row.safetyStatus) === "unsafe";
    const rawDefects = [
      ...(Array.isArray(row.vehicleDefects) ? row.vehicleDefects : []),
      ...(Array.isArray(row.trailerDefects) ? row.trailerDefects : []),
    ].filter(isRec);
    const defects: { item: string; note?: string; critical?: boolean }[] = [];
    for (const d of rawDefects) {
      const typeRaw = d.defectType;
      const item = typeof typeRaw === "string" ? typeRaw : str(asRec(typeRaw)?.name) || str(d.comment);
      if (!item) continue;
      const note = str(d.comment);
      defects.push({
        item,
        ...(note && note !== item ? { note } : {}),
        ...(unsafe && d.isResolved !== true ? { critical: true } : {}),
      });
    }
    const entry: (typeof out)[number] = {};
    const id = row.id != null ? String(row.id) : "";
    if (id) entry.id = id;
    const at = str(row.startTime) || str(row.endTime) || str(row.createdAt);
    if (at && !Number.isNaN(Date.parse(at))) entry.inspectedAt = at;
    const vname = str(veh.name) || vehicleName;
    if (vname) entry.vehicle = vname;
    entry.status = unsafe || defects.length > 0 ? "defects_found" : "no_defects";
    entry.defects = defects;
    out.push(entry);
  }
  return { dvirs: out.slice(0, 200) };
}

// ── IFTA ─────────────────────────────────────────────────────────────────────

const METERS_PER_MILE = 1609.344;

/** One jurisdiction row's miles, from whichever documented-shape field exists. */
function samsaraRowMiles(row: Rec): number | null {
  const direct = [row.distanceMiles, row.totalDistanceMiles, row.totalMiles, row.miles, row.distanceInMiles];
  for (const v of direct) {
    const n = num(v);
    if (n != null) return n;
  }
  const dist = asRec(row.distance);
  if (dist) {
    const mi = num(dist.miles) ?? num(dist.value);
    if (mi != null) return mi;
    const m = num(dist.meters);
    if (m != null) return m / METERS_PER_MILE;
  }
  const meters = [row.distanceMeters, row.totalDistanceMeters, row.driveDistanceMeters, row.meters];
  for (const v of meters) {
    const n = num(v);
    if (n != null) return n / METERS_PER_MILE;
  }
  return null;
}

/**
 * Samsara's IFTA jurisdiction report rows → miles grouped by
 * jurisdiction. Rows may be flat ({ jurisdiction, …distance }) or grouped
 * under a vehicle with a nested jurisdictions list. Anything without a
 * recognizable jurisdiction + distance is skipped; no rows at all →
 * null (never guessed).
 */
export function mapSamsaraIfta(rows: Rec[]): { states: { state: string; miles: number }[] } | null {
  const byState = new Map<string, number>();
  const addRow = (row: Rec) => {
    const state = str(row.jurisdiction ?? row.state ?? row.jurisdictionCode).toUpperCase();
    if (!/^[A-Z]{2}$/.test(state)) return;
    const miles = samsaraRowMiles(row);
    if (miles == null || miles < 0) return;
    byState.set(state, (byState.get(state) ?? 0) + miles);
  };
  for (const row of rows) {
    addRow(row);
    const nested = row.jurisdictions ?? row.jurisdictionSummaries;
    if (Array.isArray(nested)) for (const n of nested) if (isRec(n)) addRow(n);
  }
  if (byState.size === 0) return null;
  return {
    states: [...byState.entries()]
      .map(([state, miles]) => ({ state, miles: Math.round(miles * 10) / 10 }))
      .sort((a, b) => a.state.localeCompare(b.state)),
  };
}

// ── Identity ─────────────────────────────────────────────────────────────────

/** Driver directory row + vehicle → identity payload. Fields Samsara
 *  doesn't carry stay absent — the identity reader renders missing
 *  fields as null, never invented (the Geotab mapper's rule). */
export function mapSamsaraIdentity(
  vehicle: SamsaraVehicle,
  driverRow: Rec | null,
  driverNameFallback: string,
  odometerMi: number | null,
): { driver: Record<string, unknown>; truck: Record<string, unknown> } {
  const driver: Record<string, unknown> = {};
  const name = str(driverRow?.name) || driverNameFallback;
  if (name) driver.name = name;
  if (driverRow?.id != null) driver.driverId = String(driverRow.id);
  const cdl = str(driverRow?.licenseNumber);
  if (cdl) driver.cdlNumber = cdl;
  const cdlState = str(driverRow?.licenseState).toUpperCase();
  if (cdlState) driver.cdlState = cdlState;
  const truck: Record<string, unknown> = {};
  if (vehicle.name) truck.unitNumber = vehicle.name;
  if (vehicle.vin) truck.vin = vehicle.vin;
  if (vehicle.plate) truck.plate = vehicle.plate;
  if (vehicle.make) truck.make = vehicle.make;
  if (vehicle.model) truck.model = vehicle.model;
  if (vehicle.year != null) truck.year = vehicle.year;
  if (odometerMi != null) truck.odometerMi = odometerMi;
  return { driver, truck };
}

// ── Batch fetch ──────────────────────────────────────────────────────────────

export interface SamsaraFetchResult {
  batch: { feed: string; payload: unknown }[];
  deviceName: string | null;
  /** Feed names that came back empty/unusable — surfaced honestly upstream. */
  skipped: string[];
}

/**
 * Pull one full sync batch for the truck whose VIN is on the profile.
 * Throws a plain Error when no Samsara vehicle carries that VIN (the
 * caller stores nothing in that case), and SamsaraApiError when Samsara
 * refuses.
 */
export async function fetchSamsaraBatch(
  fetchFn: SamsaraFetchFn,
  token: string,
  opts: { vin: string; now?: Date },
): Promise<SamsaraFetchResult> {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();

  const vehicleRows = await samsaraList(fetchFn, token, "/fleet/vehicles");
  const vehicles = vehicleRows.map(mapSamsaraVehicle).filter((v): v is SamsaraVehicle => v != null);
  const vehicle = findSamsaraVehicleByVin(vehicles, opts.vin);
  if (!vehicle) {
    throw new Error(
      `No Samsara vehicle carries VIN ${opts.vin.trim().toUpperCase()} — check the VIN in Settings → Truck against the vehicle list in Samsara, then sync again. Nothing was stored.`,
    );
  }

  const batch: { feed: string; payload: unknown }[] = [];
  const skipped: string[] = [];
  const windowStart = new Date(now.getTime() - 8 * 24 * 3600 * 1000).toISOString();

  // HOS logs (8-day window — enough for clocks + the rolling cycle).
  let groups: SamsaraDriverLogs[] = [];
  try {
    const logEntries = await samsaraList(fetchFn, token, "/fleet/hos/logs", {
      startTime: windowStart,
      endTime: nowIso,
    });
    groups = mapSamsaraHosLogs(logEntries, vehicle.id);
  } catch {
    groups = [];
  }
  // The driver of record for this truck = the driver with the newest log on it.
  let driverGroup: SamsaraDriverLogs | null = null;
  let newest = -Infinity;
  for (const g of groups) {
    const last = g.logs[g.logs.length - 1];
    if (last && Date.parse(last.at) > newest) {
      newest = Date.parse(last.at);
      driverGroup = g;
    }
  }
  if (driverGroup && driverGroup.logs.length > 0) {
    batch.push({ feed: "hos_logs", payload: { logs: driverGroup.logs } });
  } else {
    skipped.push("hos_logs");
  }

  // HOS clocks — Samsara's own numbers first; the Geotab-style
  // computation from the driver's logs is the fallback; the feed is
  // skipped when neither exists (never zero-filled).
  let clocks: SamsaraClocks | null = null;
  try {
    const clockEntries = pageData(await samsaraGet(fetchFn, token, "/fleet/hos/clocks")).rows;
    clocks = mapSamsaraHosClocks(clockEntries, driverGroup?.driverId ?? "", vehicle.id);
  } catch {
    clocks = null;
  }
  if (!clocks && driverGroup) clocks = computeGeotabHosClocks(driverGroup.logs, now);
  if (clocks) batch.push({ feed: "hos_clocks", payload: clocks });
  else skipped.push("hos_clocks");

  // Vehicle stats — one call for GPS + odometer + engine seconds.
  let stats: ReturnType<typeof mapSamsaraVehicleStats> = null;
  try {
    const body = await samsaraGet(fetchFn, token, "/fleet/vehicles/stats", {
      types: "gps,obdOdometerMeters,obdEngineSeconds",
      vehicleIds: vehicle.id,
    });
    const rows = pageData(body).rows;
    const row = rows.find((r) => r.id != null && String(r.id) === vehicle.id) ?? rows[0] ?? null;
    stats = mapSamsaraVehicleStats(row);
  } catch {
    stats = null;
  }
  if (stats) batch.push({ feed: "vehicle_stats", payload: stats });
  else skipped.push("vehicle_stats");

  // DVIR history (same 8-day window).
  try {
    const dvirRows = await samsaraList(fetchFn, token, "/fleet/dvirs/history", {
      startTime: windowStart,
      endTime: nowIso,
    });
    const dvirs = mapSamsaraDvirs(dvirRows, vehicle.id, vehicle.name || null);
    if (dvirs.dvirs.length > 0) batch.push({ feed: "dvirs", payload: dvirs });
    else skipped.push("dvirs");
  } catch {
    skipped.push("dvirs");
  }

  // IFTA — current quarter, filtered to this vehicle by VIN tag.
  try {
    const year = now.getUTCFullYear();
    const quarter = Math.floor(now.getUTCMonth() / 3) + 1;
    const body = await samsaraGet(fetchFn, token, "/fleet/reports/ifta/jurisdiction", {
      year: String(year),
      quarter: `Q${quarter}`,
      vehicleIds: `samsara.vin:${vehicle.vin}`,
    });
    const ifta = mapSamsaraIfta(pageData(body).rows);
    if (ifta) batch.push({ feed: "ifta", payload: ifta });
    else skipped.push("ifta");
  } catch {
    skipped.push("ifta");
  }

  // Identity — driver directory row when the driver is known.
  let driverRow: Rec | null = null;
  if (driverGroup?.driverId) {
    try {
      const drivers = await samsaraList(fetchFn, token, "/fleet/drivers");
      driverRow = drivers.find((d) => d.id != null && String(d.id) === driverGroup.driverId) ?? null;
    } catch {
      driverRow = null;
    }
  }
  const identity = mapSamsaraIdentity(vehicle, driverRow, driverGroup?.driverName ?? "", stats?.odometerMi ?? null);
  if (Object.keys(identity.driver).length > 0 || Object.keys(identity.truck).length > 0) {
    batch.push({ feed: "identity", payload: identity });
  } else {
    skipped.push("identity");
  }

  return { batch, deviceName: vehicle.name || null, skipped };
}
