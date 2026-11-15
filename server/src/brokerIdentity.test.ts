// brokerIdentity.test.ts — PURE-RULE tests for broker-grade
// identity + continuous monitoring (Research Wave 2 item 3,
// migration 0131). No database: status derivation, the tender
// screen, bond alert thresholds + dismissals, the trust summary
// (rate-law: no bond amount), the verification seam's honesty, the
// double-broker match, and the carrier-of-record conflict.
//
// The standing guardrails pinned here:
//   - nothing reads "verified" without a source check on file;
//   - an unconfigured seam never blocks and never verifies;
//   - the trust summary carries NO bond amount anywhere;
//   - a blocked tender names recorded facts only.

import { describe, expect, test } from "bun:test";
import {
  bondAlertStatus,
  bondNotification,
  brokerIdentityStatus,
  brokerIdentityVerifierFromEnv,
  brokerTrustSummary,
  carrierOfRecordConflict,
  findDoubleBrokerMatch,
  identityCheckDifferences,
  screenBrokerIdentity,
  type BrokerIdentityLike,
} from "./brokerIdentity";

const NOW = new Date("2026-11-15T12:00:00Z");
const NOW_MS = NOW.getTime();
const DAY = 86_400_000;

const complete: BrokerIdentityLike = {
  legalName: "Apex Freight Brokers LLC",
  mcNumber: "MC-123456",
  bondCarrier: "Surety One",
  bondAmount: 100_000,
  bondExpiresOn: "2027-06-01",
  authorityStatus: "active",
  identityVerifiedAt: null,
  identitySource: null,
};

describe("brokerIdentityStatus — verified only follows a check", () => {
  test("no check on file + seam unconfigured: on file, not-connected label", () => {
    const s = brokerIdentityStatus(complete, { seamConfigured: false, nowMs: NOW_MS });
    expect(s.state).toBe("on_file");
    expect(s.label).toContain("verification source not connected");
  });

  test("no check on file + seam configured: on file, not-checked label", () => {
    const s = brokerIdentityStatus(complete, { seamConfigured: true, nowMs: NOW_MS });
    expect(s.state).toBe("on_file");
    expect(s.label).toContain("not checked against the verification source yet");
  });

  test("a fresh check reads verified and names the source", () => {
    const s = brokerIdentityStatus(
      { ...complete, identityVerifiedAt: new Date(NOW_MS - 5 * DAY).toISOString(), identitySource: "FMCSA lookup" },
      { seamConfigured: true, nowMs: NOW_MS },
    );
    expect(s.state).toBe("verified");
    expect(s.label).toContain("FMCSA lookup");
  });

  test("a check exactly 30 days old is still fresh; 31 days is stale", () => {
    const at30 = brokerIdentityStatus(
      { ...complete, identityVerifiedAt: new Date(NOW_MS - 30 * DAY).toISOString(), identitySource: "FMCSA lookup" },
      { seamConfigured: true, nowMs: NOW_MS },
    );
    expect(at30.state).toBe("verified");
    const at31 = brokerIdentityStatus(
      { ...complete, identityVerifiedAt: new Date(NOW_MS - 31 * DAY).toISOString(), identitySource: "FMCSA lookup" },
      { seamConfigured: true, nowMs: NOW_MS },
    );
    expect(at31.state).toBe("stale");
    expect(at31.label).toContain("counts as stale");
  });
});

describe("screenBrokerIdentity — the tender re-screen", () => {
  test("a complete, current record passes and snapshots the facts", () => {
    const r = screenBrokerIdentity(complete, { seamConfigured: false, now: NOW });
    expect(r.ok).toBe(true);
    expect(r.fingerprint).toBe("clean");
    expect(r.facts.legalName).toBe("Apex Freight Brokers LLC");
    expect(r.facts.bondAmount).toBe(100_000);
    expect(r.facts.identityState).toBe("on_file");
    expect(r.facts.screenedAt).toBe(NOW.toISOString());
  });

  test("every missing field is named, in one reason", () => {
    const r = screenBrokerIdentity(
      { legalName: null, mcNumber: null, bondCarrier: null, bondAmount: null, bondExpiresOn: null, authorityStatus: "not_recorded", identityVerifiedAt: null, identitySource: null },
      { seamConfigured: false, now: NOW },
    );
    expect(r.ok).toBe(false);
    const missing = r.reasons.find((x) => x.code === "missing_fields");
    expect(missing).toBeDefined();
    for (const label of ["legal business name", "MC number", "BMC-84 bond carrier", "BMC-84 bond amount", "BMC-84 bond expiry date", "authority status"]) {
      expect(missing!.detail).toContain(label);
    }
  });

  test("an expired bond blocks; a bond expiring today does not", () => {
    const expired = screenBrokerIdentity({ ...complete, bondExpiresOn: "2026-11-14" }, { seamConfigured: false, now: NOW });
    expect(expired.ok).toBe(false);
    expect(expired.reasons.map((x) => x.code)).toContain("bond_expired");
    const today = screenBrokerIdentity({ ...complete, bondExpiresOn: "2026-11-15" }, { seamConfigured: false, now: NOW });
    expect(today.ok).toBe(true);
  });

  test("a bond under the $75,000 federal minimum blocks; exactly at it passes", () => {
    const under = screenBrokerIdentity({ ...complete, bondAmount: 74_999 }, { seamConfigured: false, now: NOW });
    expect(under.ok).toBe(false);
    const reason = under.reasons.find((x) => x.code === "bond_below_minimum");
    expect(reason!.detail).toContain("75,000");
    expect(reason!.detail).toContain("74,999");
    const at = screenBrokerIdentity({ ...complete, bondAmount: 75_000 }, { seamConfigured: false, now: NOW });
    expect(at.ok).toBe(true);
  });

  test("revoked and inactive authority block, each named plainly", () => {
    const revoked = screenBrokerIdentity({ ...complete, authorityStatus: "revoked" }, { seamConfigured: false, now: NOW });
    expect(revoked.reasons.map((x) => x.code)).toContain("authority_revoked");
    const inactive = screenBrokerIdentity({ ...complete, authorityStatus: "inactive" }, { seamConfigured: false, now: NOW });
    expect(inactive.reasons.map((x) => x.code)).toContain("authority_inactive");
  });

  test("the fingerprint is stable for the same failure set", () => {
    const a = screenBrokerIdentity({ ...complete, bondExpiresOn: "2026-01-01", authorityStatus: "revoked" }, { seamConfigured: false, now: NOW });
    const b = screenBrokerIdentity({ ...complete, bondExpiresOn: "2026-02-02", authorityStatus: "revoked" }, { seamConfigured: false, now: NOW });
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).toContain("bond_expired");
    expect(a.fingerprint).toContain("authority_revoked");
  });

  test("an unconfigured seam never blocks by itself — a complete record passes either way", () => {
    expect(screenBrokerIdentity(complete, { seamConfigured: false, now: NOW }).ok).toBe(true);
    expect(screenBrokerIdentity(complete, { seamConfigured: true, now: NOW }).ok).toBe(true);
  });
});

describe("bondAlertStatus — credential-style thresholds + dismissals", () => {
  const at = (expiresOn: string, dismissals: Array<{ threshold: number; expiresOn: string }> = []) =>
    bondAlertStatus({ ...complete, bondExpiresOn: expiresOn }, dismissals, NOW_MS);

  test("no bond on file → no alert", () => {
    expect(bondAlertStatus({ ...complete, bondExpiresOn: null }, [], NOW_MS).threshold).toBeNull();
  });

  test("thresholds land at 60 / 30 / 7 / expired", () => {
    expect(at("2027-01-14").threshold).toBe(60); // 60 days out
    expect(at("2026-12-15").threshold).toBe(30); // 30 days out
    expect(at("2026-11-20").threshold).toBe(7); // 5 days out
    expect(at("2026-11-14").threshold).toBe(0); // yesterday
    expect(at("2027-06-01").threshold).toBeNull(); // far future
  });

  test("a dismissal silences exactly its threshold for exactly its date", () => {
    const d = [{ threshold: 30, expiresOn: "2026-12-15" }];
    expect(at("2026-12-15", d).dismissed).toBe(true);
    // A different expiry date (a renewed bond) re-arms everything.
    expect(at("2026-12-16", d).dismissed).toBe(false);
    // The NEXT threshold on the same date still fires.
    expect(at("2026-11-20", [{ threshold: 30, expiresOn: "2026-11-20" }]).dismissed).toBe(false);
  });

  test("notification copy names the date and the days left", () => {
    const soon = bondNotification({ threshold: 30, daysLeft: 30, expiresOn: "2026-12-15" });
    expect(soon.title).toContain("30 days");
    expect(soon.body).toContain("2026-12-15");
    const gone = bondNotification({ threshold: 0, daysLeft: -1, expiresOn: "2026-11-14" });
    expect(gone.title).toContain("expired");
  });
});

describe("brokerTrustSummary — what a carrier may see", () => {
  test("active bond, expiry month, on-file verification", () => {
    const t = brokerTrustSummary(complete, { seamConfigured: false, nowMs: NOW_MS });
    expect(t.legalName).toBe("Apex Freight Brokers LLC");
    expect(t.mc).toBe("MC-123456");
    expect(t.bondStatus).toBe("active");
    expect(t.bondExpiresMonth).toBe("Jun 2027");
    expect(t.verificationStatus).toBe("on_file");
  });

  test("expiring soon and expired read plainly", () => {
    expect(brokerTrustSummary({ ...complete, bondExpiresOn: "2026-12-20" }, { seamConfigured: false, nowMs: NOW_MS }).bondStatus).toBe("expiring_soon");
    expect(brokerTrustSummary({ ...complete, bondExpiresOn: "2026-11-01" }, { seamConfigured: false, nowMs: NOW_MS }).bondStatus).toBe("expired");
    expect(brokerTrustSummary({ ...complete, bondCarrier: null, bondExpiresOn: null }, { seamConfigured: false, nowMs: NOW_MS }).bondStatus).toBe("not_on_file");
  });

  test("RATE LAW: the summary carries no bond amount anywhere", () => {
    const t = brokerTrustSummary(complete, { seamConfigured: false, nowMs: NOW_MS });
    const text = JSON.stringify(t);
    expect(text).not.toContain("100000");
    expect(text).not.toContain("bondAmount");
    expect(text.toLowerCase()).not.toContain("amount");
  });
});

describe("the verification seam — honesty", () => {
  test("no API key → unconfigured, even with a transport", async () => {
    const v = brokerIdentityVerifierFromEnv({}, async () => null);
    expect(v).toBeNull();
  });

  test("a key without a transport is still unconfigured (nothing to call)", () => {
    expect(brokerIdentityVerifierFromEnv({ BROKER_IDENTITY_API_KEY: "k" })).toBeNull();
  });

  test("key + transport → the check runs and carries its source", async () => {
    const v = brokerIdentityVerifierFromEnv({ BROKER_IDENTITY_API_KEY: "k" }, async () => ({
      authorityStatus: "active",
      bondCarrier: "Surety One",
      bondAmount: 100_000,
      bondExpiresOn: "2027-06-01",
      source: "FMCSA lookup",
      checkedAt: NOW.toISOString(),
    }));
    expect(v).not.toBeNull();
    const check = await v!.check({ mcNumber: "MC-123456", legalName: "Apex" });
    expect(check?.source).toBe("FMCSA lookup");
  });

  test("differences are named field by field; a match names none", () => {
    const check = {
      authorityStatus: "revoked" as const,
      bondCarrier: "Other Surety",
      bondAmount: 75_000,
      bondExpiresOn: "2027-01-01",
      source: "FMCSA lookup",
      checkedAt: NOW.toISOString(),
    };
    const diffs = identityCheckDifferences(complete, check);
    expect(diffs.length).toBe(4);
    expect(diffs.join(" ")).toContain("Authority:");
    expect(diffs.join(" ")).toContain("Bond amount:");
    const same = identityCheckDifferences(complete, { ...check, authorityStatus: "active", bondCarrier: "Surety One", bondAmount: 100_000, bondExpiresOn: "2027-06-01" });
    expect(same).toEqual([]);
  });
});

describe("findDoubleBrokerMatch — the re-post fingerprint", () => {
  const accepted = [
    { boardLoadId: 7, referenceNumber: "REF-100", pickupCity: "Mobile", pickupState: "AL", deliveryCity: "Dallas", deliveryState: "TX", rate: 2400 },
    { boardLoadId: 9, referenceNumber: null, pickupCity: "Birmingham", pickupState: "AL", deliveryCity: "Atlanta", deliveryState: "GA", rate: 1800 },
  ];

  test("the same reference matches, case and punctuation aside", () => {
    const m = findDoubleBrokerMatch(
      { referenceNumber: "ref 100", pickupCity: null, pickupState: null, deliveryCity: null, deliveryState: null, rate: null },
      accepted,
    );
    expect(m).toEqual({ boardLoadId: 7, basis: "reference" });
  });

  test("a clone with no reference matches on lane + rate", () => {
    const m = findDoubleBrokerMatch(
      { referenceNumber: null, pickupCity: " birmingham ", pickupState: "al", deliveryCity: "Atlanta", deliveryState: "GA", rate: 1800 },
      accepted,
    );
    expect(m).toEqual({ boardLoadId: 9, basis: "lane_and_rate" });
  });

  test("same lane at a different rate is a different load", () => {
    const m = findDoubleBrokerMatch(
      { referenceNumber: null, pickupCity: "Birmingham", pickupState: "AL", deliveryCity: "Atlanta", deliveryState: "GA", rate: 1850 },
      accepted,
    );
    expect(m).toBeNull();
  });

  test("an unrelated load matches nothing", () => {
    const m = findDoubleBrokerMatch(
      { referenceNumber: "OTHER-1", pickupCity: "Memphis", pickupState: "TN", deliveryCity: "Nashville", deliveryState: "TN", rate: 900 },
      accepted,
    );
    expect(m).toBeNull();
  });
});

describe("carrierOfRecordConflict", () => {
  test("no name on the record → no conflict", () => {
    expect(carrierOfRecordConflict(null, "anyone")).toBe(false);
  });
  test("the named carrier themselves → no conflict", () => {
    expect(carrierOfRecordConflict("driver1", "driver1")).toBe(false);
  });
  test("a different account → conflict", () => {
    expect(carrierOfRecordConflict("driver1", "driver2")).toBe(true);
  });
});
