/**
 * Detention timer (x's build order 2026-11-15; spec:
 * dvir-detention-spec-2026-11-15.md). The sealed dock clock: a driver
 * taps ARRIVE at a facility, taps DONE when the dock releases them,
 * and the pair seals into the record chain as proof of the wait.
 *
 * The app proves TIME, never money: detention rates live in the
 * driver's own agreement with the broker/shipper, so no action,
 * export, or proof text in this feature ever carries a rate or a
 * dollar figure. (The older per-load card tracker keeps its own
 * local estimate; this record system is the claim-grade one.)
 *
 * Pure functions only — actions.ts resolves the rows and routes the
 * math through here. Unit-tested in dvirDetention.test.ts.
 */

// ---- Values (THE config) ------------------------------------------------------

/** Free/grace time at a dock before detention starts counting, in
 *  minutes. THE default — a record can carry its own per-load grace
 *  (the driver's agreement rules), set at ARRIVE time; this constant
 *  is the only place the default lives. */
export const DETENTION_DEFAULT_GRACE_MINUTES = 120;

/** Bounds for a per-record grace override (0 = detention from the
 *  first minute; 12 h = the most generous agreement seen in the wild). */
export const DETENTION_GRACE_MIN_MINUTES = 0;
export const DETENTION_GRACE_MAX_MINUTES = 720;

// ---- The clock math -------------------------------------------------------------

/**
 * Wait + billable minutes for one detention visit. Billable is the
 * part of the wait PAST the grace period — never negative, and an
 * unfinished visit (departedMs null) reports nulls rather than a
 * live-guessed total.
 */
export function detentionTimes(
  arrivedMs: number,
  departedMs: number | null,
  graceMinutes: number,
): { waitMinutes: number | null; billableMinutes: number | null } {
  if (departedMs == null || !Number.isFinite(departedMs)) {
    return { waitMinutes: null, billableMinutes: null };
  }
  const wait = Math.max(0, Math.round((departedMs - arrivedMs) / 60000));
  const billable = Math.max(0, wait - Math.max(0, Math.round(graceMinutes)));
  return { waitMinutes: wait, billableMinutes: billable };
}

/** "3 h 25 min" / "45 min" / "2 h" — the only way detention totals
 *  are ever rendered: as time. */
export function formatDurationMinutes(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h === 0) return `${rem} min`;
  if (rem === 0) return `${h} h`;
  return `${h} h ${rem} min`;
}

// ---- On-time fairness (Lane 1) ----------------------------------------------------

/**
 * How much of a load's lateness the shipper's dock caused, in ms:
 * the total overlap of the load's SEALED detention windows at the
 * destination with [appointment, POD seal]. A detention window can
 * only excuse time inside itself, only after the appointment (a
 * driver who arrives early and waits for their own appointment is
 * not detained past it), and only up to the seal.
 *
 * The Lane 1 on-time rule (seal ≤ appointment + 60 min) judges
 * `sealMs - detentionDelayMs(...)` instead of the raw seal, so a
 * load held at the dock past its appointment is not marked late for
 * the detention span. Windows are merged by simple summation of
 * per-window overlaps; overlapping windows for the same load are
 * not expected (one open clock per load+site) and would only ever
 * excuse time the driver provably spent at the dock.
 */
export function detentionDelayMs(
  windows: readonly { arrivedMs: number; departedMs: number }[],
  apptMs: number,
  sealMs: number,
): number {
  let total = 0;
  for (const w of windows) {
    const start = Math.max(w.arrivedMs, apptMs);
    const end = Math.min(w.departedMs, sealMs);
    if (end > start) total += end - start;
  }
  return Math.min(total, Math.max(0, sealMs - apptMs));
}

// ---- The shareable proof -----------------------------------------------------------

export interface DetentionProofInput {
  /** Facility / place label the driver recorded (or a load label). */
  place: string;
  /** pickup | delivery | stop */
  site: string;
  apptAtIso: string | null;
  arrivedAtIso: string;
  departedAtIso: string;
  graceMinutes: number;
  /** Chain seal hash of the departure event, when sealed. */
  chainHash: string | null;
}

const SITE_LABEL: Record<string, string> = {
  pickup: "Pickup",
  delivery: "Delivery",
  stop: "Stop",
};

/**
 * The receiver-copy proof: times and place ONLY. It deliberately
 * contains no rate, no dollar amount, and no money word — the
 * driver's agreement prices the time; this document proves it.
 * Mirrors the tone of the app's other sealed exports.
 */
export function detentionProofText(r: DetentionProofInput): string {
  const arrivedMs = Date.parse(r.arrivedAtIso);
  const departedMs = Date.parse(r.departedAtIso);
  const { waitMinutes, billableMinutes } = detentionTimes(arrivedMs, departedMs, r.graceMinutes);
  const when = (iso: string) =>
    new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    }) + " UTC";
  const lines = [
    "STONEMILES — DETENTION TIME RECORD",
    "Sealed arrival / departure stamps from the driver's own record.",
    "",
    `Place: ${r.place}`,
    `Site: ${SITE_LABEL[r.site] ?? "Stop"}`,
    ...(r.apptAtIso ? [`Appointment: ${when(r.apptAtIso)}`] : []),
    `Arrived: ${when(r.arrivedAtIso)}`,
    `Departed: ${when(r.departedAtIso)}`,
    `Total wait: ${waitMinutes != null ? formatDurationMinutes(waitMinutes) : "—"}`,
    `Free time allowed: ${formatDurationMinutes(r.graceMinutes)}`,
    `Time past free time: ${billableMinutes != null ? formatDurationMinutes(billableMinutes) : "—"}`,
    "",
    "This record proves time only. Detention pay, if any, is priced by the",
    "driver's agreement with the broker or shipper — no rate is stated here.",
    ...(r.chainHash ? [`Seal (chain hash): ${r.chainHash}`] : []),
  ];
  return lines.join("\n");
}
