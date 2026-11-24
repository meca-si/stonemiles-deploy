/**
 * GEOTAB PROVIDER FETCH LAYER — the first REAL provider layer in the
 * ELD stack (built 2026-11-24, x's order, after his Gast truck turned
 * out to run a Geotab GO device).
 *
 * Geotab is not like Samsara/Motive: there is no API-token page. A
 * MyGeotab login (server + database + username + password) IS the
 * credential, and the fleet admin controls who gets one. The password
 * is stored in the same vault slot as a token (eld_connections
 * .tokenEnc, PIN-gated reveal, wiped on revoke); the non-secret
 * identifiers (server, database, username) ride in provider_account.
 *
 * This module owns:
 * - the MyGeotab JSON-RPC calls (Authenticate → session, then Get),
 *   with fetch INJECTED so tests never touch the network;
 * - the pure mappers from MyGeotab entity shapes to the STONEMILES
 *   feed contract (eldSync.ts). Mappers are tolerant of the field
 *   variants Geotab returns across versions, and a feed with no
 *   recognizable data is SKIPPED — never estimated, never faked.
 *
 * HOS clocks note, in plain words: Geotab's API serves duty-status
 * logs, not a ready-made clocks object, so the clocks feed is
 * COMPUTED here from the driver's own Geotab duty logs under the
 * standard US federal limits (11h drive / 14h window / 70h-8-day
 * cycle / 30-minute break after 8h driving, 10h reset, 34h restart).
 * The snapshot stores the logs it was computed from (the hos_logs
 * feed), so the derivation is always auditable.
 *
 * Read-only forever: only Authenticate + Get are ever called. There
 * is no Add/Set/Remove anywhere in this file.
 */

export interface GeotabCredentials {
  /** MyGeotab host, e.g. "my.geotab.com" or "my123.geotab.com". */
  server: string;
  database: string;
  username: string;
  password: string;
}

export interface GeotabSession {
  server: string;
  credentials: { database: string; sessionId: string; userName: string };
}

export type GeotabFetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Normalize a user-typed MyGeotab host: strip scheme/trailing slash. */
export function normalizeGeotabServer(raw: string | null | undefined): string {
  const s = (raw ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  return s === "" ? "my.geotab.com" : s;
}

export function parseGeotabAccount(json: string | null | undefined): { server: string; database: string; username: string } | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Record<string, unknown>;
    const database = str(v.database);
    const username = str(v.username);
    if (!database || !username) return null;
    return { server: normalizeGeotabServer(str(v.server) ?? undefined), database, username };
  } catch {
    return null;
  }
}

async function geotabRpc(fetchFn: GeotabFetchFn, server: string, method: string, params: Record<string, unknown>): Promise<unknown> {
  const res = await fetchFn(`https://${server}/apiv1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  if (!res.ok) throw new Error(`Geotab answered HTTP ${res.status} — the sync couldn't run. Nothing was stored.`);
  const body = (await res.json()) as Record<string, unknown>;
  if (isRecord(body.error)) {
    const name = str(body.error.name) ?? "Error";
    // Geotab's messages never carry the password; surface them plainly.
    const message = str(body.error.message) ?? name;
    throw new Error(`Geotab refused the call (${name}): ${message}`);
  }
  return body.result;
}

/** Authenticate against MyGeotab. Returns the session + the host the
 *  session actually lives on (Geotab answers with a `path` when the
 *  database sits on a specific server). Throws with Geotab's own
 *  refusal message on bad credentials — never stores anything. */
export async function geotabAuthenticate(fetchFn: GeotabFetchFn, creds: GeotabCredentials): Promise<GeotabSession> {
  const server = normalizeGeotabServer(creds.server);
  const result = await geotabRpc(fetchFn, server, "Authenticate", {
    database: creds.database,
    userName: creds.username,
    password: creds.password,
  });
  if (!isRecord(result) || !isRecord(result.credentials)) {
    throw new Error("Geotab answered the sign-in without a session — the login may not have API access. Ask the fleet admin to check the MyGeotab user's security clearance.");
  }
  const c = result.credentials;
  const sessionId = str(c.sessionId);
  if (!sessionId) throw new Error("Geotab answered the sign-in without a session id — nothing was stored.");
  const path = str(result.path);
  const sessionServer = path ? normalizeGeotabServer(path) : server;
  return {
    server: sessionServer,
    credentials: {
      database: str(c.database) ?? creds.database,
      sessionId,
      userName: str(c.userName) ?? creds.username,
    },
  };
}

async function geotabGet(
  fetchFn: GeotabFetchFn,
  session: GeotabSession,
  typeName: string,
  search?: Record<string, unknown>,
  resultsLimit?: number,
): Promise<Record<string, unknown>[]> {
  const result = await geotabRpc(fetchFn, session.server, "Get", {
    typeName,
    credentials: session.credentials,
    ...(search ? { search } : {}),
    ...(resultsLimit ? { resultsLimit } : {}),
  });
  if (!Array.isArray(result)) return [];
  return result.filter(isRecord);
}

// ---------------------------------------------------------------------
// Pure mappers — MyGeotab entity shapes → STONEMILES feed contract.
// ---------------------------------------------------------------------

const DUTY_STATUS_MAP: Record<string, string> = {
  D: "driving",
  DR: "driving",
  ON: "on_duty",
  OFF: "off_duty",
  SB: "sleeper",
  SLEEPER: "sleeper",
};

function dutyLocation(log: Record<string, unknown>): string | undefined {
  const loc = log.location;
  if (typeof loc === "string" && loc.trim() !== "") return loc.trim();
  if (isRecord(loc)) {
    const lat = num(loc.latitude) ?? num(loc.y);
    const lon = num(loc.longitude) ?? num(loc.x);
    if (lat != null && lon != null) return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    const name = str(loc.name);
    if (name) return name;
  }
  return undefined;
}

/** DutyStatusLog[] → hos_logs payload, oldest first, capped at the
 *  contract's 500. Logs with an unreadable status or timestamp are
 *  dropped — a partial log set is honest, an invented one is not. */
export function mapGeotabDutyLogs(rawLogs: Record<string, unknown>[]): { logs: { state: string; at: string; location?: string }[] } {
  const out: { state: string; at: string; location?: string }[] = [];
  for (const log of rawLogs) {
    const state = DUTY_STATUS_MAP[(str(log.status) ?? "").toUpperCase()];
    const at = str(log.dateTime);
    if (!state || !at || Number.isNaN(Date.parse(at))) continue;
    const location = dutyLocation(log);
    out.push(location ? { state, at, location } : { state, at });
  }
  out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { logs: out.slice(-500) };
}

const HOUR = 3_600_000;
const DRIVE_LIMIT_H = 11;
const WINDOW_LIMIT_H = 14;
const CYCLE_LIMIT_H = 70;
const CYCLE_SPAN_H = 8 * 24;
const BREAK_AFTER_DRIVE_H = 8;
const BREAK_MIN_H = 0.5;
const RESET_MIN_H = 10;
const RESTART_MIN_H = 34;

/** Compute HOS clocks from mapped duty logs under the standard US
 *  federal limits. Returns null when there are no logs to compute
 *  from — the feed is then skipped, never zero-filled. */
export function computeGeotabHosClocks(
  logs: { state: string; at: string }[],
  now: Date,
): { driveRemainH: number; windowRemainH: number; cycleRemainH: number; breakRemainH: number } | null {
  if (logs.length === 0) return null;
  const sorted = [...logs].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  // Segments: [startMs, endMs, state]; the last runs to `now`.
  const segs: { start: number; end: number; state: string }[] = sorted.map((l, i) => ({
    start: Date.parse(l.at),
    end: i + 1 < sorted.length ? Date.parse(sorted[i + 1]!.at) : now.getTime(),
    state: l.state,
  }));
  const isBreakState = (s: string) => s === "off_duty" || s === "sleeper";
  const isOnDuty = (s: string) => s === "driving" || s === "on_duty";
  const round2 = (h: number) => Math.max(0, Math.round(h * 100) / 100);

  // Merge consecutive same-class segments to find long rest periods.
  const rests: { start: number; end: number }[] = [];
  {
    let cur: { start: number; end: number } | null = null;
    for (const s of segs) {
      if (isBreakState(s.state)) {
        if (cur && cur.end === s.start) cur.end = s.end;
        else {
          if (cur) rests.push(cur);
          cur = { start: s.start, end: s.end };
        }
      } else if (cur) {
        rests.push(cur);
        cur = null;
      }
    }
    if (cur) rests.push(cur);
  }

  const nowMs = now.getTime();
  // Window anchor: end of the last ≥10h rest that ended at/before now
  // (a rest still running past 10h also resets the window).
  let windowStart: number | null = null;
  for (const r of rests) {
    if ((r.end - r.start) / HOUR >= RESET_MIN_H && r.start <= nowMs) {
      windowStart = Math.max(windowStart ?? 0, Math.min(r.end, nowMs));
    }
  }
  if (windowStart == null) windowStart = segs[0]!.start;

  let driveInWindowH = 0;
  for (const s of segs) {
    if (s.state !== "driving") continue;
    const from = Math.max(s.start, windowStart);
    if (s.end > from) driveInWindowH += (s.end - from) / HOUR;
  }

  // Cycle: on-duty hours in the trailing 8 days, or since a ≥34h
  // restart inside that span, whichever anchor is later.
  let cycleAnchor = nowMs - CYCLE_SPAN_H * HOUR;
  for (const r of rests) {
    if ((r.end - r.start) / HOUR >= RESTART_MIN_H && r.end > cycleAnchor && r.end <= nowMs) {
      cycleAnchor = r.end;
    }
  }
  let cycleUsedH = 0;
  for (const s of segs) {
    if (!isOnDuty(s.state)) continue;
    const from = Math.max(s.start, cycleAnchor);
    if (s.end > from) cycleUsedH += (s.end - from) / HOUR;
  }

  // Break clock: driving since the last ≥30-min interruption (any
  // non-driving duty state counts, per the 2020 FMCSA rule).
  let breakAnchor = windowStart;
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i]!;
    if (s.state !== "driving" && (s.end - s.start) / HOUR >= BREAK_MIN_H) {
      breakAnchor = s.end;
      break;
    }
  }
  let driveSinceBreakH = 0;
  for (const s of segs) {
    if (s.state !== "driving") continue;
    const from = Math.max(s.start, breakAnchor);
    if (s.end > from) driveSinceBreakH += (s.end - from) / HOUR;
  }

  return {
    driveRemainH: round2(DRIVE_LIMIT_H - driveInWindowH),
    windowRemainH: round2(WINDOW_LIMIT_H - (nowMs - windowStart) / HOUR),
    cycleRemainH: round2(CYCLE_LIMIT_H - cycleUsedH),
    breakRemainH: round2(BREAK_AFTER_DRIVE_H - driveSinceBreakH),
  };
}

/** DeviceStatusInfo (+ optional engine-hours StatusData) →
 *  vehicle_stats. Geotab odometer arrives in METERS. */
export function mapGeotabVehicleStats(
  statusInfo: Record<string, unknown> | null,
  engineHours: number | null,
): { odometerMi?: number; lat?: number; lon?: number; engineHours?: number } | null {
  if (!statusInfo) return engineHours != null ? { engineHours } : null;
  const out: { odometerMi?: number; lat?: number; lon?: number; engineHours?: number } = {};
  const odoM = num(statusInfo.odometer);
  if (odoM != null && odoM > 0) out.odometerMi = Math.round((odoM / 1609.344) * 10) / 10;
  const lat = num(statusInfo.latitude);
  const lon = num(statusInfo.longitude);
  if (lat != null && lon != null && (lat !== 0 || lon !== 0)) {
    out.lat = lat;
    out.lon = lon;
  }
  if (engineHours != null && engineHours > 0) out.engineHours = engineHours;
  return Object.keys(out).length > 0 ? out : null;
}

/** DVIRLog[] → dvirs payload. */
export function mapGeotabDvirs(
  rawLogs: Record<string, unknown>[],
  deviceName: string | null,
): { dvirs: { id?: string; inspectedAt?: string; vehicle?: string; status?: string; defects?: { item: string; note?: string; critical?: boolean }[] }[] } {
  const out: { id?: string; inspectedAt?: string; vehicle?: string; status?: string; defects?: { item: string; note?: string; critical?: boolean }[] }[] = [];
  for (const log of rawLogs) {
    const unsafe = log.isSafeToOperate === false;
    const defects: { item: string; note?: string; critical?: boolean }[] = [];
    if (Array.isArray(log.defects)) {
      for (const d of log.defects) {
        if (!isRecord(d)) continue;
        const defectEntity = isRecord(d.defect) ? d.defect : null;
        const item = (defectEntity && str(defectEntity.name)) || str(d.name) || "Defect noted";
        const note = str(d.comment) ?? undefined;
        defects.push({ item, ...(note ? { note } : {}), ...(unsafe ? { critical: true } : {}) });
      }
    }
    const entry: (typeof out)[number] = {};
    const id = str(log.id);
    if (id) entry.id = id;
    const at = str(log.dateTime);
    if (at && !Number.isNaN(Date.parse(at))) entry.inspectedAt = at;
    if (deviceName) entry.vehicle = deviceName;
    entry.status = unsafe || defects.length > 0 ? "defects_found" : "no_defects";
    entry.defects = defects;
    out.push(entry);
  }
  return { dvirs: out.slice(0, 200) };
}

/** FuelTaxDetail[] → ifta payload, miles grouped by jurisdiction.
 *  Geotab's IFTA detail rows carry a jurisdiction (stateProvince /
 *  state / jurisdiction across versions) and a distance in km or an
 *  odometer pair in meters. Rows with neither are ignored; if no row
 *  is recognizable the feed is skipped upstream. */
export function mapGeotabIfta(rawDetails: Record<string, unknown>[]): { states: { state: string; miles: number }[] } | null {
  const byState = new Map<string, number>();
  for (const d of rawDetails) {
    const state = (str(d.stateProvince) ?? str(d.state) ?? str(d.jurisdiction) ?? str(d.authority) ?? "").toUpperCase();
    if (!state) continue;
    let miles: number | null = null;
    const distKm = num(d.distanceKm) ?? num(d.distance);
    if (distKm != null) miles = distKm / 1.609344;
    if (miles == null) {
      const start = num(d.odometerStart) ?? num(d.enterOdometer);
      const stop = num(d.odometerStop) ?? num(d.exitOdometer);
      if (start != null && stop != null && stop >= start) miles = (stop - start) / 1609.344;
    }
    if (miles == null || miles < 0) continue;
    byState.set(state, (byState.get(state) ?? 0) + miles);
  }
  if (byState.size === 0) return null;
  return {
    states: [...byState.entries()]
      .map(([state, miles]) => ({ state, miles: Math.round(miles * 10) / 10 }))
      .sort((a, b) => a.state.localeCompare(b.state)),
  };
}

/** User + Device (+ odometer) → identity payload. Fields Geotab
 *  doesn't carry (make/model/year on most GO devices) stay absent —
 *  the identity reader renders missing fields as null, never invented. */
export function mapGeotabIdentity(
  user: Record<string, unknown> | null,
  device: Record<string, unknown> | null,
  odometerMi: number | null,
): { driver: Record<string, unknown>; truck: Record<string, unknown> } {
  const driver: Record<string, unknown> = {};
  if (user) {
    const name = str(user.name) ?? [str(user.firstName), str(user.lastName)].filter(Boolean).join(" ") ?? null;
    if (name) driver.name = name;
    const id = str(user.id);
    if (id) driver.driverId = id;
    const lic = str(user.licenseNumber);
    if (lic) driver.cdlNumber = lic;
    const prov = str(user.licenseProvince) ?? str(user.licenseState);
    if (prov) driver.cdlState = prov;
  }
  const truck: Record<string, unknown> = {};
  if (device) {
    const unit = str(device.name);
    if (unit) truck.unitNumber = unit;
    const vin = str(device.vehicleIdentificationNumber);
    if (vin) truck.vin = vin;
    const plate = str(device.licensePlate);
    if (plate) truck.plate = plate;
    const make = str(device.make);
    if (make) truck.make = make;
    const model = str(device.model);
    if (model) truck.model = model;
    const year = num(device.year) ?? num(device.vehicleYear);
    if (year) truck.year = year;
  }
  if (odometerMi != null) truck.odometerMi = odometerMi;
  return { driver, truck };
}

// ---------------------------------------------------------------------
// Fetch orchestration — one real sync's worth of Geotab reads.
// ---------------------------------------------------------------------

export interface GeotabFetchResult {
  batch: { feed: string; payload: unknown }[];
  deviceName: string | null;
  skipped: string[];
}

/** Pull every feed Geotab can serve for the device whose VIN matches
 *  `vin` (the truck profile's VIN — a fleet database holds many
 *  devices, and syncing the wrong truck would be worse than none).
 *  Throws when the VIN matches no device, with a plain message. */
export async function fetchGeotabBatch(
  fetchFn: GeotabFetchFn,
  creds: GeotabCredentials,
  opts: { vin: string; now: Date },
): Promise<GeotabFetchResult> {
  const session = await geotabAuthenticate(fetchFn, creds);
  const devices = await geotabGet(fetchFn, session, "Device", undefined, 1000);
  const vinWanted = opts.vin.trim().toUpperCase();
  const device = devices.find((d) => (str(d.vehicleIdentificationNumber) ?? "").toUpperCase() === vinWanted);
  if (!device) {
    throw new Error(
      `Geotab signed in, but no device in the "${creds.database}" database carries VIN ${opts.vin}. The VIN in Settings → Truck has to match the Geotab device exactly — check both and sync again.`,
    );
  }
  const deviceId = str(device.id);
  const deviceName = str(device.name);
  const deviceSearch = deviceId ? { deviceSearch: { id: deviceId } } : undefined;
  const nowIso = opts.now.toISOString();
  const eightDaysAgo = new Date(opts.now.getTime() - CYCLE_SPAN_H * HOUR).toISOString();
  const thirtyDaysAgo = new Date(opts.now.getTime() - 30 * 24 * HOUR).toISOString();
  const quarterStart = new Date(Date.UTC(opts.now.getUTCFullYear(), Math.floor(opts.now.getUTCMonth() / 3) * 3, 1)).toISOString();

  const dutyRaw = await geotabGet(fetchFn, session, "DutyStatusLog", { ...deviceSearch, fromDate: eightDaysAgo, toDate: nowIso }, 1000);
  const statusRows = await geotabGet(fetchFn, session, "DeviceStatusInfo", deviceSearch, 1);
  const dvirRaw = await geotabGet(fetchFn, session, "DVIRLog", { ...deviceSearch, fromDate: thirtyDaysAgo, toDate: nowIso }, 200);
  const iftaRaw = await geotabGet(fetchFn, session, "FuelTaxDetail", { ...deviceSearch, fromDate: quarterStart, toDate: nowIso }, 1000);

  // Engine hours ride on StatusData under the engine-hours diagnostic.
  let engineHours: number | null = null;
  try {
    const hoursRows = await geotabGet(
      fetchFn,
      session,
      "StatusData",
      { ...deviceSearch, diagnosticSearch: { id: "DiagnosticEngineHoursId" }, fromDate: thirtyDaysAgo, toDate: nowIso },
      1,
    );
    engineHours = hoursRows.length > 0 ? num(hoursRows[hoursRows.length - 1]!.data) : null;
  } catch {
    engineHours = null; // an absent diagnostic never blocks the sync
  }

  // The driver is whoever the duty logs name most recently.
  let user: Record<string, unknown> | null = null;
  const lastDriverId = [...dutyRaw].reverse().map((l) => (isRecord(l.driver) ? str(l.driver.id) : null)).find(Boolean);
  if (lastDriverId) {
    const users = await geotabGet(fetchFn, session, "User", { id: lastDriverId }, 1).catch(() => []);
    user = users[0] ?? null;
  }

  const batch: { feed: string; payload: unknown }[] = [];
  const skipped: string[] = [];

  const hosLogs = mapGeotabDutyLogs(dutyRaw);
  if (hosLogs.logs.length > 0) {
    batch.push({ feed: "hos_logs", payload: hosLogs });
    const clocks = computeGeotabHosClocks(hosLogs.logs, opts.now);
    if (clocks) batch.push({ feed: "hos_clocks", payload: clocks });
    else skipped.push("hos_clocks");
  } else {
    skipped.push("hos_logs", "hos_clocks");
  }

  const stats = mapGeotabVehicleStats(statusRows[0] ?? null, engineHours);
  if (stats) batch.push({ feed: "vehicle_stats", payload: stats });
  else skipped.push("vehicle_stats");

  if (dvirRaw.length > 0) batch.push({ feed: "dvirs", payload: mapGeotabDvirs(dvirRaw, deviceName) });
  else skipped.push("dvirs");

  const ifta = mapGeotabIfta(iftaRaw);
  if (ifta) batch.push({ feed: "ifta", payload: ifta });
  else skipped.push("ifta");

  const identity = mapGeotabIdentity(user, device, stats?.odometerMi ?? null);
  if (Object.keys(identity.driver).length > 0 || Object.keys(identity.truck).length > 0) {
    batch.push({ feed: "identity", payload: identity });
  } else {
    skipped.push("identity");
  }

  return { batch, deviceName, skipped };
}
