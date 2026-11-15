// driverCalendar.test.ts — unit tests for the Driver Calendar
// pure rules (Wave 2 item 10.5): settings validation, the safety
// window, off-duty request validation + approval routing, payday
// projection + paid flipping, credential markers on the 60/30/7
// ladder, and reassignment authority.

import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CALENDAR_SETTINGS,
  canOverrideReassignmentRefusal,
  credentialCalendarMarkers,
  declineCutoffMs,
  dispatchModeOf,
  paydayState,
  projectPaydays,
  reassignmentTargetOk,
  requestNeedsApproval,
  safetyWindowHoursOf,
  validateCalendarSettings,
  validateOffDutyRequest,
  withinSafetyWindow,
} from "./driverCalendar";
import type { CredentialStatus } from "./credentialAlerts";

const DAY = 86_400_000;
const HOUR = 3_600_000;

describe("calendar settings validation", () => {
  test("defaults: offered mode, 24h window, no pay cycle", () => {
    expect(dispatchModeOf(DEFAULT_CALENDAR_SETTINGS)).toBe("offered");
    expect(safetyWindowHoursOf(DEFAULT_CALENDAR_SETTINGS)).toBe(24);
    expect(DEFAULT_CALENDAR_SETTINGS.payCycleKind).toBe("none");
  });

  test("a full valid write passes, cleaned", () => {
    const r = validateCalendarSettings({
      dispatchMode: "assigned",
      safetyWindowHours: 36,
      payCycleKind: "biweekly",
      payWeekday: 5,
      payAnchorOn: "2026-11-20",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.settings.dispatchMode).toBe("assigned");
      expect(r.settings.safetyWindowHours).toBe(36);
      expect(r.settings.payAnchorOn).toBe("2026-11-20");
    }
  });

  test("bad mode / window / cycle refuse whole", () => {
    expect(validateCalendarSettings({ dispatchMode: "forced", safetyWindowHours: 24, payCycleKind: "none", payWeekday: null, payAnchorOn: null }).ok).toBe(false);
    expect(validateCalendarSettings({ dispatchMode: "offered", safetyWindowHours: 0, payCycleKind: "none", payWeekday: null, payAnchorOn: null }).ok).toBe(false);
    expect(validateCalendarSettings({ dispatchMode: "offered", safetyWindowHours: 169, payCycleKind: "none", payWeekday: null, payAnchorOn: null }).ok).toBe(false);
    expect(validateCalendarSettings({ dispatchMode: "offered", safetyWindowHours: 24, payCycleKind: "weekly", payWeekday: null, payAnchorOn: null }).ok).toBe(false);
    expect(validateCalendarSettings({ dispatchMode: "offered", safetyWindowHours: 24, payCycleKind: "biweekly", payWeekday: 5, payAnchorOn: "not-a-date" }).ok).toBe(false);
    expect(validateCalendarSettings({ dispatchMode: "offered", safetyWindowHours: 24, payCycleKind: "biweekly", payWeekday: 5, payAnchorOn: null }).ok).toBe(false);
  });

  test("turning the cycle off clears weekday + anchor", () => {
    const r = validateCalendarSettings({ dispatchMode: "offered", safetyWindowHours: 24, payCycleKind: "none", payWeekday: 5, payAnchorOn: "2026-11-20" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.settings.payWeekday).toBeNull();
      expect(r.settings.payAnchorOn).toBeNull();
    }
  });
});

describe("safety window", () => {
  const pickup = Date.UTC(2026, 10, 20, 14, 0, 0); // Fri Nov 20 2026, 14:00 UTC

  test("cutoff is pickup minus the window", () => {
    expect(declineCutoffMs(pickup, 24)).toBe(pickup - 24 * HOUR);
    expect(withinSafetyWindow(pickup - 25 * HOUR, pickup, 24)).toBe(false);
    expect(withinSafetyWindow(pickup - 24 * HOUR, pickup, 24)).toBe(true);
    expect(withinSafetyWindow(pickup - 1 * HOUR, pickup, 24)).toBe(true);
  });

  test("no pickup appointment → no provable window → never locked", () => {
    expect(declineCutoffMs(null, 24)).toBeNull();
    expect(withinSafetyWindow(Date.now(), null, 24)).toBe(false);
  });
});

describe("off-duty requests", () => {
  const start = Date.UTC(2026, 10, 27, 18, 0, 0);

  test("valid types pass; note is trimmed + capped", () => {
    const r = validateOffDutyRequest({ type: "medical", startsAtMs: start, endsAtMs: start + 4 * HOUR, note: "  DOT physical  " });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.note).toBe("DOT physical");
  });

  test("a reset block under 34 hours is refused", () => {
    expect(validateOffDutyRequest({ type: "reset", startsAtMs: start, endsAtMs: start + 20 * HOUR, note: null }).ok).toBe(false);
    expect(validateOffDutyRequest({ type: "reset", startsAtMs: start, endsAtMs: start + 34 * HOUR, note: null }).ok).toBe(true);
  });

  test("end before start, unknown type, and >60d blocks refuse", () => {
    expect(validateOffDutyRequest({ type: "home_time", startsAtMs: start, endsAtMs: start, note: null }).ok).toBe(false);
    expect(validateOffDutyRequest({ type: "vacation", startsAtMs: start, endsAtMs: start + DAY, note: null }).ok).toBe(false);
    expect(validateOffDutyRequest({ type: "home_time", startsAtMs: start, endsAtMs: start + 61 * DAY, note: null }).ok).toBe(false);
  });

  test("approval routing: only Assigned-fleet company drivers wait", () => {
    expect(requestNeedsApproval({ mode: "assigned", requesterRole: "driver" })).toBe(true);
    expect(requestNeedsApproval({ mode: "assigned", requesterRole: "owner" })).toBe(false);
    expect(requestNeedsApproval({ mode: "offered", requesterRole: "driver" })).toBe(false);
    expect(requestNeedsApproval({ mode: "offered", requesterRole: "owner" })).toBe(false);
  });
});

describe("paydays", () => {
  const from = Date.UTC(2026, 10, 1); // Sun Nov 1 2026
  const to = Date.UTC(2026, 11, 1); // Dec 1 2026

  test("no cycle → no paydays, ever", () => {
    expect(projectPaydays(DEFAULT_CALENDAR_SETTINGS, from, to)).toEqual([]);
  });

  test("weekly Friday paydays project across the window", () => {
    const days = projectPaydays({ ...DEFAULT_CALENDAR_SETTINGS, payCycleKind: "weekly", payWeekday: 5 }, from, to);
    expect(days.map((d) => new Date(d).getUTCDate())).toEqual([6, 13, 20, 27]);
    for (const d of days) expect(new Date(d).getUTCDay()).toBe(5);
  });

  test("biweekly projects anchor ± 14 days only", () => {
    const days = projectPaydays(
      { ...DEFAULT_CALENDAR_SETTINGS, payCycleKind: "biweekly", payWeekday: 5, payAnchorOn: "2026-11-20" },
      from,
      to,
    );
    expect(days.map((d) => new Date(d).getUTCDate())).toEqual([6, 20]);
  });

  test("a payday reads paid only with a recorded payment on its date", () => {
    const payday = Date.UTC(2026, 10, 20);
    expect(paydayState(payday, [])).toBe("expected");
    expect(paydayState(payday, [Date.UTC(2026, 10, 20, 15, 30)])).toBe("paid");
    expect(paydayState(payday, [Date.UTC(2026, 10, 21)])).toBe("expected");
  });
});

describe("credential markers", () => {
  const now = Date.UTC(2026, 10, 15, 12, 0, 0); // Nov 15 2026
  const statuses: CredentialStatus[] = [
    { key: "medical", label: "Medical card", expiresOn: "2026-12-15", daysLeft: 30, threshold: 30, dismissed: false },
    { key: "cdl", label: "CDL", expiresOn: null, daysLeft: null, threshold: null, dismissed: false },
  ];

  test("expiry day + 60/30/7 warnings land on their dates", () => {
    const markers = credentialCalendarMarkers(statuses, Date.UTC(2026, 9, 1), Date.UTC(2027, 0, 31), now);
    // Oct 16 (60d), Nov 15 (30d), Dec 8 (7d), Dec 15 (expiry).
    expect(markers.map((m) => [m.kind, m.daysBefore])).toEqual([
      ["warning", 60],
      ["warning", 30],
      ["warning", 7],
      ["expiry", 0],
    ]);
    expect(markers.every((m) => m.credentialKey === "medical")).toBe(true);
  });

  test("markers outside the window are excluded; no date → no markers", () => {
    const markers = credentialCalendarMarkers(statuses, Date.UTC(2026, 11, 1), Date.UTC(2026, 11, 31), now);
    expect(markers.map((m) => m.daysBefore)).toEqual([7, 0]);
    expect(credentialCalendarMarkers([statuses[1]!], Date.UTC(2026, 9, 1), Date.UTC(2027, 0, 31), now)).toEqual([]);
  });
});

describe("reassignment authority", () => {
  test("only the owner can override a refusal, and only with a reason", () => {
    expect(canOverrideReassignmentRefusal({ actorRole: "owner", reason: "His truck is in the shop" })).toBe(true);
    expect(canOverrideReassignmentRefusal({ actorRole: "owner", reason: "  " })).toBe(false);
    expect(canOverrideReassignmentRefusal({ actorRole: "owner", reason: null })).toBe(false);
    expect(canOverrideReassignmentRefusal({ actorRole: "dispatch", reason: "Coverage" })).toBe(false);
    expect(canOverrideReassignmentRefusal({ actorRole: "driver", reason: "Coverage" })).toBe(false);
  });

  test("targets: a hauling member of the fleet, never dispatch, never self", () => {
    expect(reassignmentTargetOk({ targetRole: "driver", targetUsername: "bob", fromUsername: "amy" })).toBe(true);
    expect(reassignmentTargetOk({ targetRole: "owner", targetUsername: "bob", fromUsername: "amy" })).toBe(true);
    expect(reassignmentTargetOk({ targetRole: "dispatch", targetUsername: "bob", fromUsername: "amy" })).toBe(false);
    expect(reassignmentTargetOk({ targetRole: "driver", targetUsername: "Amy", fromUsername: "amy" })).toBe(false);
    expect(reassignmentTargetOk({ targetRole: null, targetUsername: "bob", fromUsername: "amy" })).toBe(false);
  });
});
