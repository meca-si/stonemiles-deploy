/**
 * ELD SYNC PIPELINE — pure validation + mapping module
 * (TMS completion queue item 8, approved by x 2026-11-15).
 *
 * The sync pipeline is: provider payload → validate/map against
 * the feed contract (THIS module) → eld_snapshots row (+ an
 * eld_identity row for the identity feed) → the surfaces that
 * already read snapshots (mirrored HOS clocks, IFTA reconciliation,
 * ELD DVIR list, trip miles source) light up from real data.
 *
 * Payloads enter this pipeline already mapped to the STONEMILES
 * feed contract below — the per-vendor field mapping happens in
 * the provider fetch layer. That layer is the one piece that stays
 * staged: it activates when a real ELD device/provider account is
 * wired at go-live. What is NOT staged is everything downstream of
 * it, and the test harness (runEldTestSync in actions.ts) proves
 * it by pushing simulated device payloads through this exact
 * pipeline. Simulated payloads carry `simulated: true` in the
 * stored snapshot itself, and every surface that reports a feed's
 * state says "test sync — simulated" for them: simulated data is
 * never presented as live provider data.
 *
 * Feed contracts (each is the shape an existing reader consumes):
 * - hos_clocks:    { driveRemainH, windowRemainH, cycleRemainH,
 *                    breakRemainH } — finite numbers ≥ 0
 *                    (mirroredEldHos's contract).
 * - hos_logs:      { logs: [{ state, at, location? }] } — state is
 *                    a STONEMILES duty state, at an ISO timestamp.
 * - dvirs:         { dvirs: [{ id?, inspectedAt?, vehicle?,
 *                    status?, defects?: [{ item, note?,
 *                    critical? }] }] } (the ELD DVIR list's shape).
 * - vehicle_stats: { odometerMi?, lat?, lon?, engineHours? } — at
 *                    least one reading (the trip miles source reads
 *                    odometerMi).
 * - ifta:          { states: [{ state, miles }] } (the IFTA
 *                    reconciliation's shape).
 * - identity:      { driver: {...}, truck: {...} } — the
 *                    eld_identity row's shape.
 * - fault_codes:   { faults: [{ code, occurredAt?, odometerMi?,
 *                    engineHours?, id? }] } — diagnostic trouble
 *                    codes the device read off the truck. The
 *                    batch applier materializes these into
 *                    fault_reports rows (faultCodes.ts owns the
 *                    plain-language table); the snapshot still
 *                    stores the payload as received, like every
 *                    feed. NOT in simulatedEldPayloads: the
 *                    simulated set's shape is pinned by tests —
 *                    the test path for faults is the fault
 *                    panel's own simulated entry, stamped
 *                    simulated in the row itself.
 *
 * Pure functions only. Unit-tested in eldSync.test.ts.
 */

export const ELD_SYNC_FEEDS = [
  "hos_clocks",
  "hos_logs",
  "dvirs",
  "vehicle_stats",
  "ifta",
  "identity",
  "fault_codes",
] as const;

export type EldSyncFeed = (typeof ELD_SYNC_FEEDS)[number];

export type EldFeedValidation =
  | { ok: true; normalized: unknown }
  | { ok: false; errors: string[] };

const DUTY_STATES = new Set(["off_duty", "sleeper", "on_duty", "driving"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteNonNegative(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

function validateHosClocks(p: Record<string, unknown>): EldFeedValidation {
  const errors: string[] = [];
  const out: Record<string, number> = {};
  for (const key of ["driveRemainH", "windowRemainH", "cycleRemainH", "breakRemainH"] as const) {
    if (isFiniteNonNegative(p[key])) out[key] = p[key];
    else errors.push(`${key} must be a finite number ≥ 0`);
  }
  if (errors.length > 0) return { ok: false, errors };
  // Extra keys (e.g. the simulated marker) ride along untouched —
  // the snapshot stores the payload as received.
  return { ok: true, normalized: { ...p, ...out } };
}

function validateHosLogs(p: Record<string, unknown>): EldFeedValidation {
  if (!Array.isArray(p.logs)) return { ok: false, errors: ["logs must be an array"] };
  if (p.logs.length > 500) return { ok: false, errors: ["logs is capped at 500 entries per sync"] };
  const errors: string[] = [];
  p.logs.forEach((entry, i) => {
    if (!isRecord(entry)) {
      errors.push(`logs[${i}] must be an object`);
      return;
    }
    if (typeof entry.state !== "string" || !DUTY_STATES.has(entry.state)) {
      errors.push(`logs[${i}].state must be one of ${[...DUTY_STATES].join(", ")}`);
    }
    if (typeof entry.at !== "string" || Number.isNaN(Date.parse(entry.at))) {
      errors.push(`logs[${i}].at must be an ISO timestamp`);
    }
    if (entry.location !== undefined && entry.location !== null && typeof entry.location !== "string") {
      errors.push(`logs[${i}].location must be a string when present`);
    }
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, normalized: p };
}

function validateDvirs(p: Record<string, unknown>): EldFeedValidation {
  if (!Array.isArray(p.dvirs)) return { ok: false, errors: ["dvirs must be an array"] };
  if (p.dvirs.length > 200) return { ok: false, errors: ["dvirs is capped at 200 entries per sync"] };
  const errors: string[] = [];
  p.dvirs.forEach((entry, i) => {
    if (!isRecord(entry)) {
      errors.push(`dvirs[${i}] must be an object`);
      return;
    }
    if (entry.inspectedAt !== undefined && (typeof entry.inspectedAt !== "string" || Number.isNaN(Date.parse(entry.inspectedAt)))) {
      errors.push(`dvirs[${i}].inspectedAt must be an ISO timestamp when present`);
    }
    if (entry.defects !== undefined) {
      if (!Array.isArray(entry.defects)) {
        errors.push(`dvirs[${i}].defects must be an array when present`);
      } else {
        entry.defects.forEach((d, j) => {
          if (!isRecord(d) || typeof d.item !== "string" || d.item.trim() === "") {
            errors.push(`dvirs[${i}].defects[${j}] needs an item name`);
          }
        });
      }
    }
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, normalized: p };
}

function validateVehicleStats(p: Record<string, unknown>): EldFeedValidation {
  const errors: string[] = [];
  let readings = 0;
  if (p.odometerMi !== undefined) {
    if (isFiniteNonNegative(p.odometerMi)) readings++;
    else errors.push("odometerMi must be a finite number ≥ 0");
  }
  if (p.engineHours !== undefined) {
    if (isFiniteNonNegative(p.engineHours)) readings++;
    else errors.push("engineHours must be a finite number ≥ 0");
  }
  if (p.lat !== undefined || p.lon !== undefined) {
    const latOk = typeof p.lat === "number" && p.lat >= -90 && p.lat <= 90;
    const lonOk = typeof p.lon === "number" && p.lon >= -180 && p.lon <= 180;
    if (latOk && lonOk) readings++;
    else errors.push("lat/lon must be a valid coordinate pair");
  }
  if (errors.length === 0 && readings === 0) {
    errors.push("vehicle_stats carries no reading (odometerMi, engineHours, or lat/lon)");
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, normalized: p };
}

function validateIfta(p: Record<string, unknown>): EldFeedValidation {
  if (!Array.isArray(p.states)) return { ok: false, errors: ["states must be an array"] };
  const errors: string[] = [];
  p.states.forEach((entry, i) => {
    if (!isRecord(entry)) {
      errors.push(`states[${i}] must be an object`);
      return;
    }
    if (typeof entry.state !== "string" || !/^[A-Z]{2}$/.test(entry.state)) {
      errors.push(`states[${i}].state must be a 2-letter state code`);
    }
    if (!isFiniteNonNegative(entry.miles)) {
      errors.push(`states[${i}].miles must be a finite number ≥ 0`);
    }
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, normalized: p };
}

// The field names getEldIdentity reads back out of eld_identity —
// the identity feed's real consumer contract.
const IDENTITY_STRING_FIELDS = {
  driver: ["driverId", "name", "cdlNumber", "cdlState", "cdlClass", "cdlEndorsements", "homeTerminal"],
  truck: ["unitNumber", "vin", "make", "model", "plate"],
} as const;

function validateIdentity(p: Record<string, unknown>): EldFeedValidation {
  const errors: string[] = [];
  const normalized: { driver: Record<string, unknown>; truck: Record<string, unknown> } = {
    driver: {},
    truck: {},
  };
  for (const side of ["driver", "truck"] as const) {
    const raw = p[side];
    if (raw !== undefined && !isRecord(raw)) {
      errors.push(`${side} must be an object when present`);
      continue;
    }
    const src = isRecord(raw) ? raw : {};
    for (const field of IDENTITY_STRING_FIELDS[side]) {
      const v = src[field];
      if (v === undefined || v === null) normalized[side][field] = null;
      else if (typeof v === "string") normalized[side][field] = v;
      else errors.push(`${side}.${field} must be a string`);
    }
  }
  const year = isRecord(p.truck) ? p.truck.year : undefined;
  if (year === undefined || year === null) normalized.truck.year = null;
  else if (typeof year === "number" && Number.isInteger(year) && year >= 1950 && year <= 2100) normalized.truck.year = year;
  else errors.push("truck.year must be a whole year when present");
  const odo = isRecord(p.truck) ? p.truck.odometerMi : undefined;
  if (odo === undefined || odo === null) normalized.truck.odometerMi = null;
  else if (isFiniteNonNegative(odo)) normalized.truck.odometerMi = odo;
  else errors.push("truck.odometerMi must be a finite number ≥ 0 when present");
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, normalized };
}

function validateFaultCodes(p: Record<string, unknown>): EldFeedValidation {
  if (!Array.isArray(p.faults)) return { ok: false, errors: ["faults must be an array"] };
  if (p.faults.length > 100) return { ok: false, errors: ["faults is capped at 100 entries per sync"] };
  const errors: string[] = [];
  p.faults.forEach((entry, i) => {
    if (!isRecord(entry)) {
      errors.push(`faults[${i}] must be an object`);
      return;
    }
    if (typeof entry.code !== "string" || entry.code.trim() === "") {
      errors.push(`faults[${i}].code must be a non-empty string`);
    }
    if (entry.occurredAt !== undefined && (typeof entry.occurredAt !== "string" || Number.isNaN(Date.parse(entry.occurredAt)))) {
      errors.push(`faults[${i}].occurredAt must be an ISO timestamp when present`);
    }
    if (entry.odometerMi !== undefined && !isFiniteNonNegative(entry.odometerMi)) {
      errors.push(`faults[${i}].odometerMi must be a finite number ≥ 0 when present`);
    }
    if (entry.engineHours !== undefined && !isFiniteNonNegative(entry.engineHours)) {
      errors.push(`faults[${i}].engineHours must be a finite number ≥ 0 when present`);
    }
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, normalized: p };
}

export interface EldFaultEntry {
  /** The code exactly as the device reported it — normalization
   *  and meaning live in faultCodes.ts, applied at record time. */
  code: string;
  occurredAtIso: string | null;
  odometerMi: number | null;
  engineHours: number | null;
  /** The device's own id for this fault report, when it sends
   *  one — half of the materialization dedupe key. */
  partnerRef: string | null;
}

/** Pull the fault entries out of a VALIDATED fault_codes payload
 *  (call validateEldFeedPayload first). Pure extraction — the
 *  batch applier turns these into fault_reports rows. */
export function faultReportsFromPayload(payload: unknown): EldFaultEntry[] {
  if (!isRecord(payload) || !Array.isArray(payload.faults)) return [];
  const out: EldFaultEntry[] = [];
  for (const entry of payload.faults) {
    if (!isRecord(entry) || typeof entry.code !== "string" || entry.code.trim() === "") continue;
    out.push({
      code: entry.code,
      occurredAtIso:
        typeof entry.occurredAt === "string" && !Number.isNaN(Date.parse(entry.occurredAt))
          ? new Date(entry.occurredAt).toISOString()
          : null,
      odometerMi: isFiniteNonNegative(entry.odometerMi) ? entry.odometerMi : null,
      engineHours: isFiniteNonNegative(entry.engineHours) ? entry.engineHours : null,
      partnerRef: typeof entry.id === "string" && entry.id.trim() !== "" ? entry.id.trim() : null,
    });
  }
  return out;
}

/** Validate one feed payload against its contract. Extra top-level
 * keys are preserved (snapshots store payloads as received); the
 * required shape is enforced strictly. */
export function validateEldFeedPayload(feed: string, payload: unknown): EldFeedValidation {
  if (!(ELD_SYNC_FEEDS as readonly string[]).includes(feed)) {
    return { ok: false, errors: [`unknown feed "${feed}"`] };
  }
  if (!isRecord(payload)) return { ok: false, errors: ["payload must be a JSON object"] };
  switch (feed as EldSyncFeed) {
    case "hos_clocks":
      return validateHosClocks(payload);
    case "hos_logs":
      return validateHosLogs(payload);
    case "dvirs":
      return validateDvirs(payload);
    case "vehicle_stats":
      return validateVehicleStats(payload);
    case "ifta":
      return validateIfta(payload);
    case "identity":
      return validateIdentity(payload);
    case "fault_codes":
      return validateFaultCodes(payload);
  }
}

/** Does a stored snapshot payload carry the simulated marker? The
 * one check every surface uses before calling synced data "live". */
export function snapshotIsSimulated(payloadJson: string): boolean {
  try {
    const p: unknown = JSON.parse(payloadJson);
    return isRecord(p) && p.simulated === true;
  } catch {
    return false;
  }
}

/** The simulated device payload set the test harness pushes through
 * the real pipeline. Deterministic, plausible, and stamped
 * `simulated: true` in every payload — the marker is part of the
 * stored data, not just a label on the button. `now` is injected
 * so tests can pin the timestamps. */
export function simulatedEldPayloads(now: Date): { feed: EldSyncFeed; payload: Record<string, unknown> }[] {
  const iso = (d: Date) => d.toISOString();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
  return [
    {
      feed: "hos_clocks",
      payload: {
        simulated: true,
        driveRemainH: 7.5,
        windowRemainH: 9.25,
        cycleRemainH: 42,
        breakRemainH: 3.5,
      },
    },
    {
      feed: "hos_logs",
      payload: {
        simulated: true,
        logs: [
          { state: "sleeper", at: iso(hoursAgo(10)), location: "Simulated rest stop" },
          { state: "on_duty", at: iso(hoursAgo(2)), location: "Simulated yard" },
          { state: "driving", at: iso(hoursAgo(1.75)) },
        ],
      },
    },
    {
      feed: "dvirs",
      payload: {
        simulated: true,
        dvirs: [
          {
            id: 9001,
            inspectedAt: iso(hoursAgo(2)),
            vehicle: "Simulated unit",
            status: "no_defects",
            defects: [],
          },
        ],
      },
    },
    {
      feed: "vehicle_stats",
      payload: { simulated: true, odometerMi: 512340.5, engineHours: 14822.25, lat: 30.69, lon: -88.04 },
    },
    {
      feed: "ifta",
      payload: {
        simulated: true,
        states: [
          { state: "AL", miles: 412.5 },
          { state: "FL", miles: 188.25 },
          { state: "GA", miles: 96 },
        ],
      },
    },
    {
      feed: "identity",
      payload: {
        simulated: true,
        driver: {
          driverId: "SIM-DRIVER-1",
          name: "Simulated Driver",
          cdlNumber: "SIM0000000",
          cdlState: "AL",
          cdlClass: "A",
          cdlEndorsements: "None (simulated)",
          homeTerminal: "Simulated Terminal",
        },
        truck: {
          unitNumber: "SIM-1",
          vin: "1SIMULATED0000000",
          make: "Simulated",
          model: "Test Rig",
          year: 2024,
          plate: "SIM-000",
          odometerMi: 512340.5,
        },
      },
    },
  ];
}

export interface EldSyncFeedResult {
  feed: string;
  ok: boolean;
  errors: string[];
}

/** Roll a sync batch's per-feed results into the counts + lines the
 * chain event and the hub message carry. */
export function summarizeEldSync(results: EldSyncFeedResult[]): {
  accepted: number;
  rejected: number;
  lines: string[];
} {
  const accepted = results.filter((r) => r.ok).length;
  return {
    accepted,
    rejected: results.length - accepted,
    lines: results.map((r) =>
      r.ok ? `${r.feed}: received` : `${r.feed}: rejected — ${r.errors.join("; ")}`,
    ),
  };
}
