/**
 * DRIVER CALENDAR — pure rules module (Research Wave 2 item 10.5,
 * spec settled by x 2026-11-15, concept approved 09:53 CT).
 *
 * One calendar per driver: every bound load (whatever door it came
 * through), home-time / off-duty blocks, reset blocks, paydays, and
 * credential document expiries with renewal warnings ahead of them.
 * The desk sees the same week as a fleet grid; the owner sees the
 * grid PLUS the owner-only levers.
 *
 * THE RULES (written here, enforced here and in actions.ts, pinned
 * by driverCalendar.test.ts + driverCalendarFlow.test.ts):
 * (a) DISPATCH MODE is a per-fleet owner setting: "assigned"
 *     (forced — a posted load lands on the driver's calendar as
 *     committed, driver notified, no decline) or "offered"
 *     (no-force — the load shows as offered/pending until the
 *     driver answers). The DEFAULT is "offered": the pre-calendar
 *     behaviour of the board, so no fleet's world changes until
 *     its owner chooses. Declines are recorded as facts, never
 *     scored against the driver.
 * (b) SAFETY WINDOW: every offered / accepted-ahead load carries a
 *     decline cutoff before pickup — fleet-set hours, default 24.
 *     Before the cutoff a decline is free and the load recycles to
 *     the board it came from. Inside the window the load is LOCKED:
 *     no unilateral decline; the driver sends a release request
 *     and dispatch decides. A load with NO pickup appointment on
 *     file has no provable window — it is never locked on a guess.
 * (c) OFF-DUTY REQUESTS carry a type (home time, medical / doctor
 *     visit incl. DOT physical, family, personal, 34-hour reset)
 *     plus an optional note, so dispatch sees WHY, not just when.
 *     In an Assigned fleet a company driver's request is NOT a
 *     commitment until dispatch or the owner approves it; in an
 *     Offered fleet, and for any owner-operator (who is both
 *     sides of the desk), it takes effect as stated. An approved
 *     request becomes a commitment the item-9 home-time gate
 *     enforces (a by_date shadow at the block's start, stated by
 *     the driver — so item-9 override law is untouched: a
 *     driver-stated term is overridden only by the driver).
 * (d) REASSIGNMENT moves only with the current driver's consent
 *     (the prompt shows dispatch's reason). A refusal leaves the
 *     load where it is and notifies dispatch. ONLY the fleet
 *     owner may override a refusal, and only with a stated
 *     reason — sealed, and shown to the driver. Dispatch can
 *     never override.
 * (e) PAYDAYS ride the calendar from the fleet's pay cycle
 *     (owner-set: weekly on a weekday, or biweekly anchored on a
 *     known payday). A projected payday reads "expected" until a
 *     recorded payment (an accepted pay stub for that date, or
 *     the driver's own pay-book entry) covers it — then it reads
 *     "paid". No cycle on file → no projected paydays; the app
 *     never invents a payday. No amounts ever ride the calendar.
 * (f) CREDENTIAL EXPIRIES (CDL / medical / TWIC) sit on the
 *     calendar on their expiry day as a hard flag, with renewal
 *     warnings in the day cells 60, 30, and 7 days ahead — the
 *     same ladder as the credential alerts (credentialAlerts.ts),
 *     computed from the same statuses, so the two never disagree.
 * (g) ROLE VISIBILITY: a company driver sees ONLY their own
 *     calendar. Dispatch sees the fleet grid. The owner sees the
 *     grid plus the owner-only levers (refusal override, mode
 *     setting, approvals). An owner-operator's calendar IS the
 *     driver calendar.
 * (h) NO RATE / MONEY KEYS ride any calendar payload — the
 *     shaping in actions.ts picks fields explicitly, and the flow
 *     tests pin seeded figures absent.
 *
 * Pure functions only.
 */

import { credentialDaysLeft, expiryInstantMs, type CredentialStatus } from "./credentialAlerts";

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

// ---------------------------------------------------------------------------
// Fleet calendar settings — dispatch mode, safety window, pay cycle.
// ---------------------------------------------------------------------------

export const DISPATCH_MODES = ["assigned", "offered"] as const;
export type DispatchMode = (typeof DISPATCH_MODES)[number];

/** The pre-calendar board behaviour: assignment is an offer the
 * driver answers. A fleet only gets forced dispatch when its
 * owner picks it — never by default. */
export const DEFAULT_DISPATCH_MODE: DispatchMode = "offered";

/** x's spec default for the decline cutoff before pickup. */
export const DEFAULT_SAFETY_WINDOW_HOURS = 24;
export const SAFETY_WINDOW_MIN_HOURS = 1;
export const SAFETY_WINDOW_MAX_HOURS = 168;

export const PAY_CYCLE_KINDS = ["none", "weekly", "biweekly"] as const;
export type PayCycleKind = (typeof PAY_CYCLE_KINDS)[number];

export interface FleetCalendarSettingsLike {
  dispatchMode: string;
  safetyWindowHours: number;
  payCycleKind: string;
  /** 0 = Sunday … 6 = Saturday (UTC), for weekly + biweekly. */
  payWeekday: number | null;
  /** YYYY-MM-DD anchor payday, for biweekly. */
  payAnchorOn: string | null;
}

export const DEFAULT_CALENDAR_SETTINGS: FleetCalendarSettingsLike = {
  dispatchMode: DEFAULT_DISPATCH_MODE,
  safetyWindowHours: DEFAULT_SAFETY_WINDOW_HOURS,
  payCycleKind: "none",
  payWeekday: null,
  payAnchorOn: null,
};

export function dispatchModeOf(settings: FleetCalendarSettingsLike): DispatchMode {
  return settings.dispatchMode === "assigned" ? "assigned" : "offered";
}

export function safetyWindowHoursOf(settings: FleetCalendarSettingsLike): number {
  const h = Math.floor(settings.safetyWindowHours);
  if (!Number.isFinite(h)) return DEFAULT_SAFETY_WINDOW_HOURS;
  return Math.min(SAFETY_WINDOW_MAX_HOURS, Math.max(SAFETY_WINDOW_MIN_HOURS, h));
}

/** Validate + clean a settings write. Every field is the owner's
 * own statement; anything malformed refuses the WHOLE write (a
 * half-saved setting is worse than none). */
export function validateCalendarSettings(input: {
  dispatchMode: unknown;
  safetyWindowHours: unknown;
  payCycleKind: unknown;
  payWeekday: unknown;
  payAnchorOn: unknown;
}): { ok: true; settings: FleetCalendarSettingsLike } | { ok: false; error: string } {
  if (input.dispatchMode !== "assigned" && input.dispatchMode !== "offered") {
    return { ok: false, error: "Dispatch mode is either Assigned (loads land committed) or Offered (drivers answer first)." };
  }
  const hours = typeof input.safetyWindowHours === "number" ? Math.floor(input.safetyWindowHours) : NaN;
  if (!Number.isFinite(hours) || hours < SAFETY_WINDOW_MIN_HOURS || hours > SAFETY_WINDOW_MAX_HOURS) {
    return { ok: false, error: `The safety window is a whole number of hours between ${SAFETY_WINDOW_MIN_HOURS} and ${SAFETY_WINDOW_MAX_HOURS}.` };
  }
  if (input.payCycleKind !== "none" && input.payCycleKind !== "weekly" && input.payCycleKind !== "biweekly") {
    return { ok: false, error: "Pay cycle is weekly, biweekly, or off." };
  }
  const kind = input.payCycleKind as PayCycleKind;
  let weekday: number | null = null;
  let anchorOn: string | null = null;
  if (kind !== "none") {
    const wd = typeof input.payWeekday === "number" ? Math.floor(input.payWeekday) : NaN;
    if (!Number.isFinite(wd) || wd < 0 || wd > 6) {
      return { ok: false, error: "Pick the weekday payday lands on." };
    }
    weekday = wd;
  }
  if (kind === "biweekly") {
    const a = typeof input.payAnchorOn === "string" ? input.payAnchorOn.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !Number.isFinite(Date.parse(`${a}T12:00:00.000Z`))) {
      return { ok: false, error: "A biweekly cycle needs one real payday to anchor on (a date the fleet actually paid)." };
    }
    anchorOn = a;
  }
  return {
    ok: true,
    settings: { dispatchMode: input.dispatchMode, safetyWindowHours: hours, payCycleKind: kind, payWeekday: weekday, payAnchorOn: anchorOn },
  };
}

// ---------------------------------------------------------------------------
// The safety window — the decline cutoff before pickup.
// ---------------------------------------------------------------------------

/** The instant after which a load is locked against unilateral
 * decline: pickup appointment minus the fleet's window. Null when
 * the load carries no pickup appointment — no provable window,
 * never locked on a guess (rule b). */
export function declineCutoffMs(pickupApptAtMs: number | null, windowHours: number): number | null {
  if (pickupApptAtMs == null || !Number.isFinite(pickupApptAtMs)) return null;
  return pickupApptAtMs - windowHours * HOUR_MS;
}

export function withinSafetyWindow(nowMs: number, pickupApptAtMs: number | null, windowHours: number): boolean {
  const cutoff = declineCutoffMs(pickupApptAtMs, windowHours);
  return cutoff != null && nowMs >= cutoff;
}

// ---------------------------------------------------------------------------
// Off-duty requests — types, labels, validation.
// ---------------------------------------------------------------------------

export const OFF_DUTY_REQUEST_TYPES = ["home_time", "medical", "family", "personal", "reset"] as const;
export type OffDutyRequestType = (typeof OFF_DUTY_REQUEST_TYPES)[number];

export const OFF_DUTY_REQUEST_LABELS: Record<OffDutyRequestType, string> = {
  home_time: "Home time",
  medical: "Medical / doctor visit",
  family: "Family",
  personal: "Personal",
  reset: "34-hour reset",
};

/** A reset block is a 34-hour reset — shorter isn't one. */
export const RESET_MIN_MS = 34 * HOUR_MS;
/** No single off-duty block runs longer than 60 days. */
export const OFF_DUTY_MAX_MS = 60 * DAY_MS;

export function validateOffDutyRequest(input: {
  type: unknown;
  startsAtMs: unknown;
  endsAtMs: unknown;
  note: unknown;
}): { ok: true; type: OffDutyRequestType; startsAtMs: number; endsAtMs: number; note: string | null } | { ok: false; error: string } {
  if (typeof input.type !== "string" || !(OFF_DUTY_REQUEST_TYPES as readonly string[]).includes(input.type)) {
    return { ok: false, error: "Pick what the time off is for — home time, medical, family, personal, or a 34-hour reset." };
  }
  const type = input.type as OffDutyRequestType;
  const startsAtMs = typeof input.startsAtMs === "number" ? input.startsAtMs : NaN;
  const endsAtMs = typeof input.endsAtMs === "number" ? input.endsAtMs : NaN;
  if (!Number.isFinite(startsAtMs) || !Number.isFinite(endsAtMs) || endsAtMs <= startsAtMs) {
    return { ok: false, error: "The time off needs a start and a later end." };
  }
  if (endsAtMs - startsAtMs > OFF_DUTY_MAX_MS) {
    return { ok: false, error: "One block of time off can run at most 60 days — split anything longer into separate requests." };
  }
  if (type === "reset" && endsAtMs - startsAtMs < RESET_MIN_MS) {
    return { ok: false, error: "A 34-hour reset block has to span at least 34 hours — that's what makes it a reset." };
  }
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 300) : "";
  return { ok: true, type, startsAtMs, endsAtMs, note: note === "" ? null : note };
}

/** Does a request need the desk's approval before it counts?
 * Only in an Assigned fleet, and only for a company driver — an
 * owner (owner-operator) is both sides of the desk and approves
 * their own by definition; an Offered fleet takes the driver's
 * stated time as stated. */
export function requestNeedsApproval(args: { mode: DispatchMode; requesterRole: string | null }): boolean {
  if (args.mode !== "assigned") return false;
  return args.requesterRole !== "owner";
}

// ---------------------------------------------------------------------------
// Paydays — projected from the fleet's stated cycle, flipped to
// "paid" only by a recorded payment on that date (rule e).
// ---------------------------------------------------------------------------

const utcDayStart = (ms: number): number => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

/** Every payday (UTC day-start ms) the cycle projects inside
 * [fromMs, toMs]. Weekly: the stated weekday. Biweekly: the
 * anchor payday ± 14-day steps (the anchor's weekday rules). */
export function projectPaydays(settings: FleetCalendarSettingsLike, fromMs: number, toMs: number): number[] {
  if (settings.payCycleKind === "none" || settings.payWeekday == null) return [];
  const out: number[] = [];
  if (settings.payCycleKind === "weekly") {
    let t = utcDayStart(fromMs);
    while (new Date(t).getUTCDay() !== settings.payWeekday) t += DAY_MS;
    for (; t < toMs; t += 7 * DAY_MS) out.push(t);
    return out;
  }
  if (settings.payCycleKind === "biweekly") {
    if (!settings.payAnchorOn) return [];
    const anchor = utcDayStart(expiryInstantMs(settings.payAnchorOn));
    if (!Number.isFinite(anchor)) return [];
    const step = 14 * DAY_MS;
    const kMin = Math.ceil((utcDayStart(fromMs) - anchor) / step);
    const kMax = Math.floor((utcDayStart(toMs) - anchor) / step);
    for (let k = kMin; k <= kMax; k++) {
      const t = anchor + k * step;
      if (t >= fromMs && t < toMs) out.push(t);
    }
    return out;
  }
  return out;
}

/** "paid" only when a recorded payment lands on the payday's own
 * UTC date; otherwise the projection stays "expected". */
export function paydayState(paydayMs: number, recordedPaidDayStartsMs: readonly number[]): "paid" | "expected" {
  const day = utcDayStart(paydayMs);
  return recordedPaidDayStartsMs.some((p) => utcDayStart(p) === day) ? "paid" : "expected";
}

// ---------------------------------------------------------------------------
// Credential markers — expiry day + the 60/30/7 warning ladder,
// derived from the SAME statuses the credential alerts use (rule f).
// ---------------------------------------------------------------------------

export const CREDENTIAL_WARNING_DAYS = [60, 30, 7] as const;

export interface CredentialCalendarMarker {
  credentialKey: string;
  label: string;
  /** expiry = the day the document lapses (hard flag);
   * warning = a renewal notice ahead of it. */
  kind: "expiry" | "warning";
  atMs: number;
  /** For warnings: how many days ahead of the expiry this
   * marker sits (60 | 30 | 7). For the expiry itself: 0. */
  daysBefore: number;
  expiresOn: string;
  /** Days left as of `nowMs` (the alert engine's own count). */
  daysLeft: number;
}

export function credentialCalendarMarkers(
  statuses: readonly CredentialStatus[],
  fromMs: number,
  toMs: number,
  nowMs: number,
): CredentialCalendarMarker[] {
  const out: CredentialCalendarMarker[] = [];
  for (const s of statuses) {
    if (s.expiresOn == null) continue;
    const expiryMs = expiryInstantMs(s.expiresOn);
    const daysLeft = credentialDaysLeft(s.expiresOn, nowMs);
    if (expiryMs >= fromMs && expiryMs < toMs) {
      out.push({ credentialKey: s.key, label: s.label, kind: "expiry", atMs: expiryMs, daysBefore: 0, expiresOn: s.expiresOn, daysLeft });
    }
    for (const d of CREDENTIAL_WARNING_DAYS) {
      const atMs = expiryMs - d * DAY_MS;
      if (atMs >= fromMs && atMs < toMs) {
        out.push({ credentialKey: s.key, label: s.label, kind: "warning", atMs, daysBefore: d, expiresOn: s.expiresOn, daysLeft });
      }
    }
  }
  return out.sort((a, b) => a.atMs - b.atMs);
}

// ---------------------------------------------------------------------------
// Reassignment authority (rule d).
// ---------------------------------------------------------------------------

/** Who may override a driver's refusal of a reassignment: the
 * fleet OWNER, and only the owner — dispatch can never force a
 * move over a refusal. A stated reason is required either way. */
export function canOverrideReassignmentRefusal(args: { actorRole: string | null; reason: string | null | undefined }): boolean {
  return args.actorRole === "owner" && (args.reason ?? "").trim() !== "";
}

/** A reassignment proposal can only target a driver in the same
 * fleet who actually hauls (never dispatch, never the driver who
 * already holds the load). */
export function reassignmentTargetOk(args: { targetRole: string | null; targetUsername: string; fromUsername: string }): boolean {
  if (!args.targetRole || args.targetRole === "dispatch") return false;
  return args.targetUsername.trim().toLowerCase() !== args.fromUsername.trim().toLowerCase();
}
