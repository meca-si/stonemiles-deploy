// credentialAlerts.test.ts — UNIT tests for the credential expiry
// alert rules (credentialAlerts.ts): the 60 / 30 / 7 + expired
// thresholds, per-threshold dismissal matching, and renewal re-arming
// (a dismissal is keyed to the expiry date it was made against, so a
// renewed card alerts again from the top).

import { describe, expect, test } from "bun:test";
import {
  activeCredentialAlerts,
  buildCredentialStatuses,
  credentialDaysLeft,
  credentialThresholdFor,
  dismissalMatches,
  type CredentialLike,
} from "./credentialAlerts";

/** Noon UTC on a date — the same anchor expiryInstantMs uses. */
const noon = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 12, 0, 0);

describe("credentialThresholdFor — 60 / 30 / 7 + expired", () => {
  test("outside the 60-day window there is no alert", () => {
    expect(credentialThresholdFor(null)).toBeNull();
    expect(credentialThresholdFor(61)).toBeNull();
    expect(credentialThresholdFor(365)).toBeNull();
  });

  test("each band lands on its threshold, boundaries included", () => {
    expect(credentialThresholdFor(60)).toBe(60);
    expect(credentialThresholdFor(31)).toBe(60);
    expect(credentialThresholdFor(30)).toBe(30);
    expect(credentialThresholdFor(8)).toBe(30);
    expect(credentialThresholdFor(7)).toBe(7);
    expect(credentialThresholdFor(0)).toBe(7);
  });

  test("past the date is the expired threshold", () => {
    expect(credentialThresholdFor(-1)).toBe(0);
    expect(credentialThresholdFor(-90)).toBe(0);
  });
});

describe("credentialDaysLeft — whole days to the expiry date", () => {
  test("counts down and goes negative after lapse", () => {
    expect(credentialDaysLeft("2027-01-10", noon(2027, 1, 10))).toBe(0);
    expect(credentialDaysLeft("2027-01-10", noon(2027, 1, 9))).toBe(1);
    expect(credentialDaysLeft("2027-01-10", noon(2026, 12, 11))).toBe(30);
    expect(credentialDaysLeft("2027-01-10", noon(2027, 1, 12))).toBe(-2);
  });
});

const CREDS: CredentialLike[] = [
  { key: "cdl", label: "CDL", expiresOn: "2027-03-01" },
  { key: "medical", label: "Medical card", expiresOn: "2027-01-20" },
  { key: "twic", label: "TWIC", expiresOn: null },
];

describe("buildCredentialStatuses + activeCredentialAlerts", () => {
  test("statuses carry days left + threshold; no date = no threshold", () => {
    const now = noon(2027, 1, 1);
    const statuses = buildCredentialStatuses(CREDS, [], now);
    const cdl = statuses.find((s) => s.key === "cdl")!;
    const med = statuses.find((s) => s.key === "medical")!;
    const twic = statuses.find((s) => s.key === "twic")!;
    expect(cdl.daysLeft).toBe(59);
    expect(cdl.threshold).toBe(60);
    expect(med.daysLeft).toBe(19);
    expect(med.threshold).toBe(30);
    expect(twic.daysLeft).toBeNull();
    expect(twic.threshold).toBeNull();
    // Both dated credentials are alerting; soonest first.
    expect(activeCredentialAlerts(statuses).map((s) => s.key)).toEqual(["medical", "cdl"]);
  });

  test("dismissing the current threshold silences only that alert", () => {
    const now = noon(2027, 1, 1);
    const dismissals = [{ credentialKey: "medical", threshold: 30, expiresOn: "2027-01-20" }];
    const statuses = buildCredentialStatuses(CREDS, dismissals, now);
    const med = statuses.find((s) => s.key === "medical")!;
    // The FACT stays on the status; only the nag is silenced.
    expect(med.threshold).toBe(30);
    expect(med.dismissed).toBe(true);
    expect(activeCredentialAlerts(statuses).map((s) => s.key)).toEqual(["cdl"]);
  });

  test("no re-nag: the same threshold stays dismissed on every later load inside the band", () => {
    const dismissals = [{ credentialKey: "medical", threshold: 30, expiresOn: "2027-01-20" }];
    for (const now of [noon(2026, 12, 25), noon(2027, 1, 1), noon(2027, 1, 10)]) {
      const statuses = buildCredentialStatuses(CREDS, dismissals, now);
      expect(activeCredentialAlerts(statuses).some((s) => s.key === "medical")).toBe(false);
    }
  });

  test("crossing into the next threshold fires a fresh alert (the 30-dismissal does not cover the 7)", () => {
    const dismissals = [{ credentialKey: "medical", threshold: 30, expiresOn: "2027-01-20" }];
    const statuses = buildCredentialStatuses(CREDS, dismissals, noon(2027, 1, 15)); // 5 days left
    const med = statuses.find((s) => s.key === "medical")!;
    expect(med.threshold).toBe(7);
    expect(med.dismissed).toBe(false);
    expect(activeCredentialAlerts(statuses).map((s) => s.key)).toContain("medical");
  });

  test("renewal re-arms: a dismissal against the OLD expiry date matches nothing on the new card", () => {
    const dismissals = [{ credentialKey: "medical", threshold: 30, expiresOn: "2027-01-20" }];
    const renewed: CredentialLike[] = [
      { key: "cdl", label: "CDL", expiresOn: "2027-03-01" },
      { key: "medical", label: "Medical card", expiresOn: "2027-02-15" }, // renewed
      { key: "twic", label: "TWIC", expiresOn: null },
    ];
    const statuses = buildCredentialStatuses(renewed, dismissals, noon(2027, 1, 20)); // 26 days left on the new card
    const med = statuses.find((s) => s.key === "medical")!;
    expect(med.threshold).toBe(30);
    expect(med.dismissed).toBe(false);
    expect(activeCredentialAlerts(statuses).map((s) => s.key)).toContain("medical");
  });

  test("expired credentials alert at threshold 0 until dismissed for that date", () => {
    const now = noon(2027, 2, 1); // medical lapsed 12 days ago
    const statuses = buildCredentialStatuses(CREDS, [], now);
    const med = statuses.find((s) => s.key === "medical")!;
    expect(med.threshold).toBe(0);
    expect(activeCredentialAlerts(statuses).map((s) => s.key)).toContain("medical");
    const silenced = buildCredentialStatuses(
      CREDS,
      [{ credentialKey: "medical", threshold: 0, expiresOn: "2027-01-20" }],
      now,
    );
    expect(activeCredentialAlerts(silenced).some((s) => s.key === "medical")).toBe(false);
  });
});

describe("dismissalMatches — all three fields must match", () => {
  const status = { key: "cdl" as const, threshold: 30 as const, expiresOn: "2027-03-01" };
  test("exact match only", () => {
    expect(dismissalMatches({ credentialKey: "cdl", threshold: 30, expiresOn: "2027-03-01" }, status)).toBe(true);
    expect(dismissalMatches({ credentialKey: "medical", threshold: 30, expiresOn: "2027-03-01" }, status)).toBe(false);
    expect(dismissalMatches({ credentialKey: "cdl", threshold: 60, expiresOn: "2027-03-01" }, status)).toBe(false);
    expect(dismissalMatches({ credentialKey: "cdl", threshold: 30, expiresOn: "2028-03-01" }, status)).toBe(false);
    expect(dismissalMatches({ credentialKey: "cdl", threshold: 30, expiresOn: "2027-03-01" }, { ...status, threshold: null })).toBe(false);
  });
});
