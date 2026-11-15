// faultCodes.ts — predictive maintenance (Research Wave 2
// item 11, Part B). Pure rules: the curated fault-code table,
// code normalization, and the maintenance due-soon computation.
// The actions in actions.ts own the DB rows, the drafts, and
// the chain.
//
// THE HONESTY RULE for the table: it holds only codes whose
// plain-language meaning is well established (standard OBD-II /
// SAE J1939 descriptions). A code that is NOT in the table is
// recorded exactly as reported with "no plain-language entry
// yet" — the app never invents a meaning for a code it doesn't
// know, and never guesses an urgency for one either (urgency
// "unknown", no automatic draft beyond the record itself).
//
// Urgency words are the driver's, not a shop's: stop_now (pull
// over — continuing can destroy the engine or isn't safe),
// service_soon (get it in the shop in the next days, before it
// strands you or derates), watch (note it, keep an eye on it).

export type FaultUrgency = "stop_now" | "service_soon" | "watch" | "unknown";

export interface FaultCodeEntry {
  /** Normalized code key (see normalizeFaultCode). */
  code: string;
  meaning: string;
  urgency: Exclude<FaultUrgency, "unknown">;
  /** The maintenance-log category a draft lands in. */
  category: "engine" | "transmission" | "electrical" | "other";
}

const E = (
  code: string,
  meaning: string,
  urgency: FaultCodeEntry["urgency"],
  category: FaultCodeEntry["category"],
): FaultCodeEntry => ({ code, meaning, urgency, category });

export const FAULT_CODE_TABLE: readonly FaultCodeEntry[] = [
  // -- Stop now: continuing can wreck the engine or isn't safe.
  E("P0217", "Engine overheating — the coolant temperature ran past the safe limit.", "stop_now", "engine"),
  E("P0524", "Engine oil pressure too low.", "stop_now", "engine"),
  E("P0606", "Engine computer (ECM/PCM) processor fault — the engine's own computer reported an internal failure.", "stop_now", "electrical"),

  // -- Service soon: aftertreatment, fuel, ignition, driveline.
  E("P0401", "Exhaust gas recirculation (EGR) flow too low — the EGR system isn't moving enough exhaust gas.", "service_soon", "engine"),
  E("P0402", "Exhaust gas recirculation (EGR) flow too high — the EGR system is moving more exhaust gas than it should.", "service_soon", "engine"),
  E("P2002", "Diesel particulate filter (DPF) efficiency below threshold — the soot filter isn't cleaning as it should.", "service_soon", "engine"),
  E("P2459", "DPF regeneration happening too often — the filter is loading up faster than it should.", "service_soon", "engine"),
  E("P2463", "DPF soot accumulation — the particulate filter is loaded with soot and needs regeneration or service.", "service_soon", "engine"),
  E("P242F", "DPF restriction — ash accumulation in the particulate filter.", "service_soon", "engine"),
  E("P207F", "DEF (reductant) quality problem — the DEF in the tank tested below standard. Bad DEF can start a derate countdown.", "service_soon", "engine"),
  E("P20EE", "SCR NOx catalyst efficiency low — the emissions system isn't converting NOx as it should.", "service_soon", "engine"),
  E("P229F", "NOx sensor circuit range/performance (sensor 2) — an emissions sensor is reading out of its expected range.", "service_soon", "electrical"),
  E("P0087", "Fuel rail pressure too low — the engine isn't getting the fuel pressure it asked for.", "service_soon", "engine"),
  E("P0088", "Fuel rail pressure too high — fuel pressure ran above the expected range.", "service_soon", "engine"),
  E("P0300", "Random / multiple cylinder misfire — the engine is misfiring on more than one cylinder.", "service_soon", "engine"),
  E("P0335", "Crankshaft position sensor circuit — the engine's timing reference signal has a problem.", "service_soon", "electrical"),
  E("P0340", "Camshaft position sensor circuit — a timing sensor signal has a problem.", "service_soon", "electrical"),
  E("P0101", "Mass air flow (MAF) sensor range/performance — the intake air reading is out of its expected range.", "service_soon", "electrical"),
  E("P0500", "Vehicle speed sensor fault — the truck's speed signal has a problem.", "service_soon", "electrical"),
  E("P0562", "System voltage low — charging voltage ran below the expected range.", "service_soon", "electrical"),
  E("P0700", "Transmission control system — the transmission asked for the check-engine light. A transmission code is stored with it.", "service_soon", "transmission"),
  E("P0715", "Transmission input / turbine speed sensor circuit — a transmission speed signal has a problem.", "service_soon", "transmission"),

  // -- Watch: note it, keep an eye on it.
  E("P0113", "Intake air temperature sensor reading high — a sensor circuit is reading out of range.", "watch", "electrical"),
  E("P0463", "Fuel level sensor reading high — the fuel gauge signal is out of range.", "watch", "electrical"),
  E("P0571", "Cruise control / brake switch circuit — the brake switch signal the cruise uses has a problem.", "watch", "electrical"),
  E("P0670", "Glow plug control module circuit — the cold-start aid system reported a problem.", "watch", "electrical"),
  E("P0544", "Exhaust gas temperature sensor circuit (bank 1, sensor 1).", "watch", "electrical"),
  E("P2033", "Exhaust gas temperature sensor reading high (bank 1, sensor 2).", "watch", "electrical"),

  // -- J1939 SPN codes (what many dashes actually show).
  E("SPN3216", "Aftertreatment intake NOx sensor — the emissions sensor at the SCR inlet reported a problem.", "service_soon", "electrical"),
  E("SPN3226", "Aftertreatment outlet NOx sensor — the emissions sensor at the SCR outlet reported a problem.", "service_soon", "electrical"),
  E("SPN3364", "DEF (aftertreatment reductant) quality — the DEF tested below standard. Can start a derate countdown.", "service_soon", "engine"),
  E("SPN4364", "SCR conversion efficiency low — the emissions system isn't converting NOx as it should.", "service_soon", "engine"),
  E("SPN5246", "Aftertreatment SCR operator inducement — the emissions derate countdown is active. This is the code that precedes a speed/power derate.", "service_soon", "engine"),
  E("SPN1761", "DEF tank level — the reductant tank level reading reported a problem or ran low.", "watch", "other"),
  E("SPN168", "Battery / electrical potential — the truck's voltage reading reported a problem.", "watch", "electrical"),
  E("SPN110", "Engine coolant temperature — the coolant temperature parameter reported a problem. Actual overheating is a stop-now condition.", "watch", "engine"),
  E("SPN100", "Engine oil pressure — the oil pressure parameter reported a problem. Genuinely low oil pressure is a stop-now condition.", "watch", "engine"),
  E("SPN102", "Intake manifold pressure — the boost pressure parameter reported a problem.", "watch", "engine"),
];

const TABLE_BY_CODE = new Map(FAULT_CODE_TABLE.map((e) => [e.code, e]));

/** Normalize a code as a driver or a device reports it into the
 *  table's key form: "p0401" → "P0401", "SPN 3216" → "SPN3216",
 *  "SPN 3216 FMI 4" → "SPN3216" (the FMI is failure-mode
 *  dressing; the SPN names the parameter). Unrecognized shapes
 *  normalize to their cleaned selves and simply miss the table. */
export function normalizeFaultCode(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const spn = cleaned.match(/^SPN\s*(\d+)(?:\s+FMI\s*\d+)?$/);
  if (spn) return `SPN${spn[1]}`;
  return cleaned.replace(/ /g, "");
}

export interface FaultCodeLookup {
  code: string;
  known: boolean;
  meaning: string | null;
  urgency: FaultUrgency;
  category: FaultCodeEntry["category"] | null;
  /** The words every surface shows for an unknown code. */
  note: string | null;
}

export function lookupFaultCode(raw: string): FaultCodeLookup {
  const code = normalizeFaultCode(raw);
  const entry = TABLE_BY_CODE.get(code);
  if (!entry) {
    return {
      code,
      known: false,
      meaning: null,
      urgency: "unknown",
      category: null,
      note: "No plain-language entry for this code yet — it's recorded exactly as reported. A shop can read it with a diagnostic tool.",
    };
  }
  return { code, known: true, meaning: entry.meaning, urgency: entry.urgency, category: entry.category, note: null };
}

export const FAULT_URGENCY_LABELS: Record<FaultUrgency, string> = {
  stop_now: "Stop now",
  service_soon: "Service soon",
  watch: "Watch",
  unknown: "Not classified",
};

/** Does this urgency auto-draft a maintenance-log entry? Stop-now
 *  and service-soon do (the DVIR-defect pattern); watch and
 *  unknown are recorded without drafting work nobody asked for. */
export function faultDraftsWorkOrder(urgency: FaultUrgency): boolean {
  return urgency === "stop_now" || urgency === "service_soon";
}

// ---------------------------------------------------------------------
// Maintenance due-soon flags
// ---------------------------------------------------------------------

export interface MaintenanceServiceLike {
  item: string;
  intervalMiles: number;
  lastDoneOdometer: number | null;
  lastDoneAtMs: number | null;
}

export type MaintenanceDueState = "overdue" | "due_soon" | "ok" | "unknown";

export interface MaintenanceDueFlag {
  item: string;
  state: MaintenanceDueState;
  milesLeft: number | null;
  dueAtMs: number | null;
  /** Plain words, always labelled an estimate — the inputs are
   *  the driver's own recorded readings. */
  line: string;
}

export const MAINTENANCE_DUE_SOON_MILES = 1000;
export const MAINTENANCE_DUE_SOON_DAYS = 30;
const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Due-soon flags for the driver's maintenance schedule, computed
 * from sealed-record readings: the newest odometer the app has
 * recorded (fuel log, DVIRs, daily logs, fault reports) against
 * each service's driver-set interval and last-done mark. A
 * service with no usable inputs reads "unknown" — never a
 * guessed date. The DOT annual with interval 0 runs on the
 * standing 12-month date rule.
 */
export function maintenanceDueFlags(args: {
  services: readonly MaintenanceServiceLike[];
  currentOdometer: number | null;
  nowMs: number;
}): MaintenanceDueFlag[] {
  const soonMs = MAINTENANCE_DUE_SOON_DAYS * 24 * 60 * 60 * 1000;
  return args.services.map((s) => {
    const dateDueMs =
      s.item === "dot_inspection" && s.intervalMiles === 0 && s.lastDoneAtMs != null
        ? s.lastDoneAtMs + TWELVE_MONTHS_MS
        : null;
    let milesLeft: number | null = null;
    if (s.intervalMiles > 0 && s.lastDoneOdometer != null && args.currentOdometer != null) {
      milesLeft = Math.round(s.lastDoneOdometer + s.intervalMiles - args.currentOdometer);
    }
    if (milesLeft == null && dateDueMs == null) {
      return {
        item: s.item,
        state: "unknown" as const,
        milesLeft: null,
        dueAtMs: null,
        line: "Not enough recorded readings to place this one yet — it lands once the app has an odometer reading and a last-done mark.",
      };
    }
    if (milesLeft != null) {
      if (milesLeft < 0) {
        return {
          item: s.item,
          state: "overdue" as const,
          milesLeft,
          dueAtMs: dateDueMs,
          line: `About ${Math.abs(milesLeft).toLocaleString("en-US")} miles past its interval by the recorded odometer — an estimate from your own records.`,
        };
      }
      if (milesLeft <= MAINTENANCE_DUE_SOON_MILES) {
        return {
          item: s.item,
          state: "due_soon" as const,
          milesLeft,
          dueAtMs: dateDueMs,
          line: `Due within about ${milesLeft.toLocaleString("en-US")} miles by the recorded odometer — an estimate from your own records.`,
        };
      }
      return {
        item: s.item,
        state: "ok" as const,
        milesLeft,
        dueAtMs: dateDueMs,
        line: `About ${milesLeft.toLocaleString("en-US")} miles of interval left by the recorded odometer — an estimate from your own records.`,
      };
    }
    // Date-rule only (DOT annual, interval 0).
    const msLeft = dateDueMs! - args.nowMs;
    if (msLeft < 0) {
      return {
        item: s.item,
        state: "overdue" as const,
        milesLeft: null,
        dueAtMs: dateDueMs,
        line: "Past its 12-month date by the recorded last-done date — an estimate from your own records.",
      };
    }
    if (msLeft <= soonMs) {
      return {
        item: s.item,
        state: "due_soon" as const,
        milesLeft: null,
        dueAtMs: dateDueMs,
        line: `Due by ${new Date(dateDueMs!).toISOString().slice(0, 10)} on the 12-month rule — an estimate from your own records.`,
      };
    }
    return {
      item: s.item,
      state: "ok" as const,
      milesLeft: null,
      dueAtMs: dateDueMs,
      line: `Due by ${new Date(dateDueMs!).toISOString().slice(0, 10)} on the 12-month rule — an estimate from your own records.`,
    };
  });
}
