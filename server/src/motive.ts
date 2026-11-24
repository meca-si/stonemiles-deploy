/**
 * Motive live-sync client (server-side only).
 *
 * Mirrors geotab.ts exactly: this module talks to Motive's public REST
 * API (https://api.gomotive.com, API key sent in the X-Api-Key header)
 * and maps what it returns into the SAME { feed, payload } batch items
 * the Geotab layer produces for applyEldSyncBatch — hos_logs
 * ({ logs: [{ state, at }] }), hos_clocks, vehicle_stats (flat
 * readings), dvirs ({ dvirs: [...] }), ifta ({ states: [...] }) and
 * identity ({ driver, truck }). Endpoints verified against Motive's
 * official developer documentation (developer.gomotive.com /
 * developer-docs.gomotive.com) 2026-11-24:
 *   GET /v1/vehicles             — fleet vehicles (VIN match)
 *   GET /v1/users                — company users/drivers (identity)
 *   GET /v1/available_time       — per-driver HOS availability (clocks)
 *   GET /v1/logs                 — duty-status logs
 *   GET /v1/vehicle_locations    — current GPS (+ odometer where reported)
 *   GET /v1/inspection_reports   — DVIRs (defects[], vehicle{}, driver{})
 *   GET /v1/ifta/trips           — IFTA trips (jurisdiction detail)
 *   GET /v1/ifta/summary         — IFTA mileage summary (fallback)
 *
 * READ-ONLY FOREVER: every call here is a GET. Nothing in this module
 * can write to Motive, and the API key is used only as the X-Api-Key
 * header — never logged, never echoed into a batch.
 *
 * Motive list responses wrap each item in a singular key
 * ({ vehicles: [{ vehicle: {...} }] }); the mappers accept wrapped or
 * direct items so a shape drift degrades to an honest empty feed, not
 * a crash.
 *
 * Clocks: Motive's /v1/available_time reports each driver's remaining
 * drive/shift/cycle/break in SECONDS — used directly. If no
 * availability row exists for the driver, clocks fall back to the SAME
 * computation from the driver's own duty logs the Geotab mapper uses
 * (imported from geotab.ts, not re-implemented) — null when there are
 * no logs, never zero-filled.
 *
 * IFTA: Motive does not pin the trips/summary distance field names in
 * its public docs, so the mapper accepts the plausible variants and
 * returns null — never a guess — when nothing recognizable comes back.
 *
 * The fetch implementation is injected so unit tests can drive the
 * mappers with recorded payloads and the flow tests can run against a
 * fake server.
 */

import { computeGeotabHosClocks } from "./geotab";

export type MotiveFetchFn = (
  url: string,
  init: { method: string; headers: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export const MOTIVE_API_BASE = "https://api.gomotive.com";

/** Raised when Motive itself refuses a call (bad key, scope block, …). */
export class MotiveApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "MotiveApiError";
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
function secToHours(sec: number): number {
  return round2(sec / 3600);
}

async function motiveGet(
  fetchFn: MotiveFetchFn,
  apiKey: string,
  path: string,
  params: Record<string, string> = {},
): Promise<unknown> {
  const qs = new URLSearchParams(params).toString();
  const url = `${MOTIVE_API_BASE}${path}${qs ? `?${qs}` : ""}`;
  const res = await fetchFn(url, {
    method: "GET",
    headers: { "X-Api-Key": apiKey, Accept: "application/json" },
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const b = asRec(body);
    const msg =
      (typeof b?.error_message === "string" && b.error_message) ||
      (typeof b?.message === "string" && b.message) ||
      `Motive refused the request (HTTP ${res.status}). Check the API key and its scopes.`;
    throw new MotiveApiError(msg, res.status);
  }
  return body;
}

/** Unwrap a Motive list body: { vehicles: [{ vehicle: {...} }] } → records. */
export function unwrapMotiveList(body: unknown, plural: string, singular: string): Rec[] {
  const b = asRec(body);
  const arr = Array.isArray(b?.[plural]) ? (b[plural] as unknown[]) : Array.isArray(body) ? body : [];
  const out: Rec[] = [];
  for (const item of arr) {
    if (!isRec(item)) continue;
    const inner = asRec(item[singular]);
    out.push(inner ?? item);
  }
  return out;
}

/** Paged list fetch (page_no/per_page), bounded. */
async function motiveList(
  fetchFn: MotiveFetchFn,
  apiKey: string,
  path: string,
  plural: string,
  singular: string,
  params: Record<string, string> = {},
  maxPages = 5,
): Promise<Rec[]> {
  const out: Rec[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const body = await motiveGet(fetchFn, apiKey, path, {
      ...params,
      per_page: "100",
      page_no: String(page),
    });
    const rows = unwrapMotiveList(body, plural, singular);
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
}

// ── Vehicle match ────────────────────────────────────────────────────────────

export interface MotiveVehicle {
  id: string;
  number: string;
  vin: string;
  plate: string;
  make: string;
  model: string;
  year: number | null;
  currentDriverId: string;
}

export function mapMotiveVehicle(row: Rec): MotiveVehicle | null {
  const id = row.id != null ? String(row.id) : "";
  if (!id) return null;
  const yr = num(row.year);
  const cur = asRec(row.current_driver);
  return {
    id,
    number: str(row.number),
    vin: str(row.vin).toUpperCase(),
    plate: str(row.license_plate_number ?? row.license_plate ?? row.plate),
    make: str(row.make),
    model: str(row.model),
    year: yr != null && yr > 1900 ? Math.trunc(yr) : null,
    currentDriverId:
      (cur?.id != null ? String(cur.id) : "") ||
      (row.current_driver_id != null ? String(row.current_driver_id) : "") ||
      (row.permanent_driver_id != null ? String(row.permanent_driver_id) : ""),
  };
}

/** VIN match — exact, case-insensitive, the same rule Geotab applies. */
export function findMotiveVehicleByVin(vehicles: MotiveVehicle[], vin: string): MotiveVehicle | null {
  const want = vin.trim().toUpperCase();
  if (!want) return null;
  return vehicles.find((v) => v.vin === want) ?? null;
}

// ── Users (identity source) ──────────────────────────────────────────────────

export function motiveUserName(u: Rec): string {
  const full = `${str(u.first_name)} ${str(u.last_name)}`.trim();
  return full || str(u.name) || str(u.username);
}

// ── HOS logs ─────────────────────────────────────────────────────────────────

const MOTIVE_STATUS_MAP: Record<string, string> = {
  driving: "driving",
  on_duty: "on_duty",
  onduty: "on_duty",
  off_duty: "off_duty",
  offduty: "off_duty",
  sleeper: "sleeper",
  sleeper_berth: "sleeper",
  sleeperberth: "sleeper",
  yard_move: "on_duty",
  yardmove: "on_duty",
  personal_conveyance: "off_duty",
  personalconveyance: "off_duty",
};

export function mapMotiveHosStatus(raw: unknown): string | null {
  const key = str(raw).toLowerCase().replace(/[\s-]+/g, "_");
  return MOTIVE_STATUS_MAP[key] ?? MOTIVE_STATUS_MAP[key.replace(/_/g, "")] ?? null;
}

function motiveLogLocation(raw: Rec): string | undefined {
  const loc = raw.location;
  if (typeof loc === "string" && loc.trim()) return loc.trim();
  const l = asRec(loc);
  if (l) {
    const desc = str(l.description ?? l.name ?? l.address);
    if (desc) return desc;
    const lat = num(l.lat ?? l.latitude);
    const lon = num(l.lon ?? l.lng ?? l.longitude);
    if (lat != null && lon != null && (lat !== 0 || lon !== 0)) return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  }
  const lat = num(raw.latitude ?? raw.lat);
  const lon = num(raw.longitude ?? raw.lon ?? raw.lng);
  if (lat != null && lon != null && (lat !== 0 || lon !== 0)) return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  return undefined;
}

function motiveRowVehicleId(raw: Rec): string {
  if (raw.vehicle_id != null) return String(raw.vehicle_id);
  const v = asRec(raw.vehicle);
  return v?.id != null ? String(v.id) : "";
}

/** The driver id a log row belongs to (for grouping when logs span drivers). */
export function motiveLogDriverId(raw: Rec): string {
  if (raw.user_id != null) return String(raw.user_id);
  if (raw.driver_id != null) return String(raw.driver_id);
  const d = asRec(raw.driver) ?? asRec(raw.user);
  return d?.id != null ? String(d.id) : "";
}

/**
 * Duty logs → hos_logs payload. Motive logs are intervals; the feed
 * contract is a change-of-state log, so each interval becomes one entry
 * at its start. Only OUR vehicle's logs, oldest first, capped at the
 * contract's 500. Logs with an unreadable status or timestamp are
 * dropped — a partial log set is honest, an invented one is not.
 */
export function mapMotiveHosLogs(rows: Rec[], vehicleId: string): { logs: { state: string; at: string; location?: string }[] } {
  const out: { state: string; at: string; location?: string }[] = [];
  for (const raw of rows) {
    if (motiveRowVehicleId(raw) !== vehicleId) continue;
    const state = mapMotiveHosStatus(raw.duty_status ?? raw.status);
    const at = str(raw.start_time ?? raw.start_at ?? raw.log_start_time);
    if (!state || !at || Number.isNaN(Date.parse(at))) continue;
    const location = motiveLogLocation(raw);
    out.push(location ? { state, at, location } : { state, at });
  }
  out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { logs: out.slice(-500) };
}

// ── HOS clocks (native availability, computed fallback) ─────────────────────

export interface MotiveClocks {
  driveRemainH: number;
  windowRemainH: number;
  cycleRemainH: number;
  breakRemainH: number;
}

/**
 * /v1/available_time rows, normalized: Motive nests the availability
 * either inside the user record or beside the { user } wrapper — accept
 * both.
 */
export function motiveAvailabilityRows(body: unknown): Rec[] {
  const b = asRec(body);
  const arr = Array.isArray(b?.users) ? b.users : Array.isArray(body) ? body : [];
  const out: Rec[] = [];
  for (const item of arr) {
    if (!isRec(item)) continue;
    const user = asRec(item.user) ?? asRec(item.driver);
    const avail = asRec(item.available_time) ?? asRec(user?.available_time) ?? asRec(item.availableTime);
    out.push({
      ...(user ?? item),
      ...(avail ? { available_time: avail } : {}),
      user_id: item.user_id ?? user?.id ?? item.id,
    });
  }
  return out;
}

/**
 * Motive /v1/available_time rows carry each driver's remaining time in
 * SECONDS under available_time { drive, shift, cycle, break }. Used
 * exactly as reported; the caller falls back to log computation when
 * absent.
 */
export function mapMotiveAvailableTime(rows: Rec[], driverId: string): MotiveClocks | null {
  const row =
    rows.find((r) => {
      const u = asRec(r.user) ?? asRec(r.driver);
      const id = r.user_id ?? r.driver_id ?? u?.id;
      return driverId !== "" && id != null && String(id) === driverId;
    }) ?? (rows.length === 1 ? rows[0] : null);
  if (!row) return null;
  const at = asRec(row.available_time) ?? asRec(row.availableTime) ?? row;
  const drive = num(at.drive);
  const shift = num(at.shift);
  const cycle = num(at.cycle);
  const brk = num(at.break);
  if (drive == null || shift == null || cycle == null || brk == null) return null;
  return {
    driveRemainH: secToHours(drive),
    windowRemainH: secToHours(shift),
    cycleRemainH: secToHours(cycle),
    breakRemainH: secToHours(brk),
  };
}

// ── Vehicle stats ────────────────────────────────────────────────────────────

/**
 * /v1/vehicle_locations rows → flat vehicle_stats payload (present keys
 * only), or null when the row carries no usable reading. The current
 * location gives GPS; where the gateway also reports an odometer it is
 * carried too. Motive's public docs don't pin the odometer field, so
 * the common variants are accepted and the payload degrades to
 * GPS-only — never an invented reading.
 */
export function mapMotiveVehicleStats(
  rows: Rec[],
  vehicleId: string,
): { odometerMi?: number; lat?: number; lon?: number; engineHours?: number } | null {
  const row = rows.find((r) => motiveRowVehicleId(r) === vehicleId);
  if (!row) return null;
  const out: { odometerMi?: number; lat?: number; lon?: number; engineHours?: number } = {};
  const loc = asRec(row.current_location) ?? asRec(row.location) ?? row;
  const lat = num(loc.lat ?? loc.latitude);
  const lon = num(loc.lon ?? loc.lng ?? loc.longitude);
  if (lat != null && lon != null && (lat !== 0 || lon !== 0)) {
    out.lat = lat;
    out.lon = lon;
  }
  const odoRaw =
    num(row.odometer) ??
    num(asRec(row.odometer)?.value) ??
    num(loc.odometer) ??
    num(row.odometer_miles) ??
    num(row.odometer_mi);
  const odoKm = num(row.odometer_km) ?? num(row.odometer_kilometers);
  if (odoRaw != null && odoRaw > 0) out.odometerMi = round2(odoRaw);
  else if (odoKm != null && odoKm > 0) out.odometerMi = round2(odoKm / 1.609344);
  const engH = num(row.engine_hours) ?? num(asRec(row.engine_hours)?.value) ?? num(row.engineHours);
  const engSec = num(row.engine_seconds) ?? num(row.engine_runtime_seconds);
  if (engH != null && engH > 0) out.engineHours = round2(engH);
  else if (engSec != null && engSec > 0) out.engineHours = secToHours(engSec);
  return Object.keys(out).length > 0 ? out : null;
}

// ── DVIRs ────────────────────────────────────────────────────────────────────

export function mapMotiveDvirs(
  rows: Rec[],
  vehicleId: string,
  vehicleName: string | null,
): { dvirs: { id?: string; inspectedAt?: string; vehicle?: string; status?: string; defects?: { item: string; note?: string; critical?: boolean }[] }[] } {
  const out: { id?: string; inspectedAt?: string; vehicle?: string; status?: string; defects?: { item: string; note?: string; critical?: boolean }[] }[] = [];
  for (const row of rows) {
    const veh = asRec(row.vehicle);
    const vid = motiveRowVehicleId(row);
    // Reports carry vehicle_number even when no id is present; accept a
    // row when it names our vehicle by id OR by unit number, skip
    // foreign rows.
    const vnum = str(row.vehicle_number) || str(veh?.number);
    if (vid !== vehicleId && !(vid === "" && vnum !== "" && vnum === (vehicleName ?? ""))) continue;
    const defects: { item: string; note?: string; critical?: boolean }[] = [];
    const rawDefects = [
      ...(Array.isArray(row.defects) ? row.defects : []),
      ...(Array.isArray(row.inspection_items) ? row.inspection_items : []),
      ...(Array.isArray(row.items) ? row.items : []),
    ].filter(isRec);
    for (const d of rawDefects) {
      const item = str(d.area ?? d.name ?? d.item ?? d.defect_type ?? d.type);
      if (!item) continue;
      const note = str(d.description ?? d.comment ?? d.notes);
      const resolved = d.is_resolved === true || str(d.status).toLowerCase() === "resolved";
      defects.push({
        item,
        ...(note && note !== item ? { note } : {}),
        ...(!resolved && (d.critical === true || str(d.severity).toLowerCase() === "critical") ? { critical: true } : {}),
      });
    }
    const entry: (typeof out)[number] = {};
    const id = row.id != null ? String(row.id) : "";
    if (id) entry.id = id;
    const at = str(row.created_at ?? row.inspection_time ?? row.date ?? row.updated_at);
    if (at && !Number.isNaN(Date.parse(at))) entry.inspectedAt = at;
    if (vnum || vehicleName) entry.vehicle = vnum || vehicleName!;
    const statusRaw = str(row.status).toLowerCase();
    entry.status = defects.length > 0 || statusRaw === "defects_found" ? "defects_found" : "no_defects";
    entry.defects = defects;
    out.push(entry);
  }
  return { dvirs: out.slice(0, 200) };
}

// ── IFTA ─────────────────────────────────────────────────────────────────────

const METERS_PER_MILE = 1609.344;

function motiveMilesFrom(rec: Rec): number | null {
  const miles = [
    rec.miles,
    rec.distance_miles,
    rec.distanceMiles,
    rec.total_miles,
    rec.totalMiles,
    rec.distance_in_miles,
  ];
  for (const v of miles) {
    const n = num(v);
    if (n != null) return n;
  }
  const km = num(rec.distance_km) ?? num(rec.distance_kilometers);
  const meters = [rec.distance_meters, rec.distanceMeters, rec.meters, ...(km != null ? [km * 1000] : [])];
  for (const v of meters) {
    const n = num(v);
    if (n != null) return n / METERS_PER_MILE;
  }
  const d = num(rec.distance);
  if (d != null) {
    // A bare "distance" on an IFTA row is reported in miles by Motive's
    // US product; kilometers only ever arrive under an explicit _km key
    // (handled above).
    return d;
  }
  return null;
}

/**
 * Jurisdiction miles from /v1/ifta/trips (per-trip jurisdiction
 * segments) with /v1/ifta/summary rows as the fallback shape. Both are
 * accepted in flat ({ jurisdiction|state, …miles }) and nested-segment
 * forms. Returns null when no row carries a recognizable jurisdiction
 * + distance.
 */
export function mapMotiveIfta(
  tripRows: Rec[],
  summaryRows: Rec[],
  vehicleId: string,
): { states: { state: string; miles: number }[] } | null {
  const byState = new Map<string, number>();
  const addMiles = (stateRaw: unknown, rec: Rec) => {
    const state = str(stateRaw).toUpperCase();
    if (!/^[A-Z]{2}$/.test(state)) return;
    const miles = motiveMilesFrom(rec);
    if (miles == null || miles < 0) return;
    byState.set(state, (byState.get(state) ?? 0) + miles);
  };
  const walk = (rows: Rec[]) => {
    for (const row of rows) {
      const vid = motiveRowVehicleId(row);
      if (vid !== "" && vid !== vehicleId) continue;
      addMiles(row.jurisdiction ?? row.state ?? row.state_code ?? row.jurisdiction_code, row);
      const segs = row.jurisdictions ?? row.segments ?? row.jurisdiction_breakdown ?? row.states;
      if (Array.isArray(segs)) {
        for (const s of segs) {
          if (isRec(s)) addMiles(s.jurisdiction ?? s.state ?? s.state_code ?? s.jurisdiction_code, s);
        }
      }
    }
  };
  walk(tripRows);
  if (byState.size === 0) walk(summaryRows);
  if (byState.size === 0) return null;
  return {
    states: [...byState.entries()]
      .map(([state, miles]) => ({ state, miles: Math.round(miles * 10) / 10 }))
      .sort((a, b) => a.state.localeCompare(b.state)),
  };
}

// ── Identity ─────────────────────────────────────────────────────────────────

/** User row + vehicle → identity payload. Fields Motive doesn't carry
 *  stay absent — the identity reader renders missing fields as null,
 *  never invented (the Geotab mapper's rule). */
export function mapMotiveIdentity(
  vehicle: MotiveVehicle,
  userRow: Rec | null,
  odometerMi: number | null,
): { driver: Record<string, unknown>; truck: Record<string, unknown> } {
  const driver: Record<string, unknown> = {};
  if (userRow) {
    const name = motiveUserName(userRow);
    if (name) driver.name = name;
    if (userRow.id != null) driver.driverId = String(userRow.id);
    const cdl = str(userRow.license_number ?? userRow.drivers_license_number ?? userRow.cdl_number);
    if (cdl) driver.cdlNumber = cdl;
    const cdlState = str(userRow.license_state ?? userRow.cdl_state).toUpperCase();
    if (cdlState) driver.cdlState = cdlState;
    const terminal = str(userRow.home_terminal);
    if (terminal) driver.homeTerminal = terminal;
  }
  const truck: Record<string, unknown> = {};
  if (vehicle.number) truck.unitNumber = vehicle.number;
  if (vehicle.vin) truck.vin = vehicle.vin;
  if (vehicle.plate) truck.plate = vehicle.plate;
  if (vehicle.make) truck.make = vehicle.make;
  if (vehicle.model) truck.model = vehicle.model;
  if (vehicle.year != null) truck.year = vehicle.year;
  if (odometerMi != null) truck.odometerMi = odometerMi;
  return { driver, truck };
}

// ── Batch fetch ──────────────────────────────────────────────────────────────

export interface MotiveFetchResult {
  batch: { feed: string; payload: unknown }[];
  deviceName: string | null;
  /** Feed names that came back empty/unusable — surfaced honestly upstream. */
  skipped: string[];
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Pull one full sync batch for the truck whose VIN is on the profile.
 * Throws a plain Error when no Motive vehicle carries that VIN (the
 * caller stores nothing in that case), and MotiveApiError when Motive
 * refuses.
 */
export async function fetchMotiveBatch(
  fetchFn: MotiveFetchFn,
  apiKey: string,
  opts: { vin: string; now?: Date },
): Promise<MotiveFetchResult> {
  const now = opts.now ?? new Date();

  const vehicleRows = await motiveList(fetchFn, apiKey, "/v1/vehicles", "vehicles", "vehicle");
  const vehicles = vehicleRows.map(mapMotiveVehicle).filter((v): v is MotiveVehicle => v != null);
  const vehicle = findMotiveVehicleByVin(vehicles, opts.vin);
  if (!vehicle) {
    throw new Error(
      `No Motive vehicle carries VIN ${opts.vin.trim().toUpperCase()} — check the VIN in Settings → Truck against the vehicle list in Motive, then sync again. Nothing was stored.`,
    );
  }

  const batch: { feed: string; payload: unknown }[] = [];
  const skipped: string[] = [];
  const startDate = ymd(new Date(now.getTime() - 8 * 24 * 3600 * 1000));
  const endDate = ymd(now);

  // Users — needed for the driver identity + availability matching.
  let users: Rec[] = [];
  try {
    users = await motiveList(fetchFn, apiKey, "/v1/users", "users", "user");
  } catch {
    users = [];
  }

  // HOS logs (8-day window). Logs can span drivers (team/slip-seat);
  // keep the logs of the vehicle's current driver when known, else the
  // driver with the newest log on this vehicle.
  let rawLogs: Rec[] = [];
  try {
    rawLogs = await motiveList(fetchFn, apiKey, "/v1/logs", "logs", "log", {
      start_date: startDate,
      end_date: endDate,
    });
  } catch {
    rawLogs = [];
  }
  const vehicleLogRows = rawLogs.filter((r) => motiveRowVehicleId(r) === vehicle.id);
  let driverId = vehicle.currentDriverId;
  if (!driverId && vehicleLogRows.length > 0) {
    let newestRow: Rec | null = null;
    let newestTs = -Infinity;
    for (const r of vehicleLogRows) {
      const ts = Date.parse(str(r.start_time ?? r.start_at ?? r.log_start_time));
      if (!Number.isNaN(ts) && ts > newestTs) {
        newestTs = ts;
        newestRow = r;
      }
    }
    if (newestRow) driverId = motiveLogDriverId(newestRow);
  }
  const driverLogRows = driverId
    ? vehicleLogRows.filter((r) => motiveLogDriverId(r) === driverId || motiveLogDriverId(r) === "")
    : vehicleLogRows;
  const hosLogs = mapMotiveHosLogs(driverLogRows, vehicle.id);
  if (hosLogs.logs.length > 0) batch.push({ feed: "hos_logs", payload: hosLogs });
  else skipped.push("hos_logs");

  // HOS clocks — Motive's availability numbers first; the Geotab-style
  // computation from the driver's logs is the fallback; the feed is
  // skipped when neither exists (never zero-filled).
  let clocks: MotiveClocks | null = null;
  try {
    const availRows = motiveAvailabilityRows(await motiveGet(fetchFn, apiKey, "/v1/available_time"));
    clocks = mapMotiveAvailableTime(availRows, driverId);
  } catch {
    clocks = null;
  }
  if (!clocks && hosLogs.logs.length > 0) clocks = computeGeotabHosClocks(hosLogs.logs, now);
  if (clocks) batch.push({ feed: "hos_clocks", payload: clocks });
  else skipped.push("hos_clocks");

  // Vehicle stats — current location (+ odometer where reported).
  let stats: ReturnType<typeof mapMotiveVehicleStats> = null;
  try {
    const locRows = await motiveList(fetchFn, apiKey, "/v1/vehicle_locations", "vehicle_locations", "vehicle_location");
    stats = mapMotiveVehicleStats(locRows, vehicle.id);
  } catch {
    stats = null;
  }
  if (stats) batch.push({ feed: "vehicle_stats", payload: stats });
  else skipped.push("vehicle_stats");

  // DVIRs (same 8-day window).
  try {
    const dvirRows = await motiveList(fetchFn, apiKey, "/v1/inspection_reports", "inspection_reports", "inspection_report", {
      start_date: startDate,
      end_date: endDate,
    });
    const dvirs = mapMotiveDvirs(dvirRows, vehicle.id, vehicle.number || null);
    if (dvirs.dvirs.length > 0) batch.push({ feed: "dvirs", payload: dvirs });
    else skipped.push("dvirs");
  } catch {
    skipped.push("dvirs");
  }

  // IFTA — current quarter to date; trips first, summary as fallback.
  try {
    const year = now.getUTCFullYear();
    const quarter = Math.floor(now.getUTCMonth() / 3) + 1;
    const qStart = ymd(new Date(Date.UTC(year, (quarter - 1) * 3, 1)));
    let tripRows: Rec[] = [];
    let summaryRows: Rec[] = [];
    try {
      tripRows = await motiveList(fetchFn, apiKey, "/v1/ifta/trips", "trips", "trip", {
        start_date: qStart,
        end_date: endDate,
      });
    } catch {
      tripRows = [];
    }
    if (tripRows.length === 0) {
      try {
        summaryRows = await motiveList(fetchFn, apiKey, "/v1/ifta/summary", "summaries", "summary", {
          start_date: qStart,
          end_date: endDate,
        });
      } catch {
        summaryRows = [];
      }
    }
    const ifta = mapMotiveIfta(tripRows, summaryRows, vehicle.id);
    if (ifta) batch.push({ feed: "ifta", payload: ifta });
    else skipped.push("ifta");
  } catch {
    skipped.push("ifta");
  }

  // Identity — the vehicle's driver from the users directory.
  const userRow = driverId ? (users.find((u) => u.id != null && String(u.id) === driverId) ?? null) : null;
  const identity = mapMotiveIdentity(vehicle, userRow, stats?.odometerMi ?? null);
  if (Object.keys(identity.driver).length > 0 || Object.keys(identity.truck).length > 0) {
    batch.push({ feed: "identity", payload: identity });
  } else {
    skipped.push("identity");
  }

  return { batch, deviceName: vehicle.number || null, skipped };
}
