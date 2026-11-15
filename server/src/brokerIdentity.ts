/**
 * BROKER-GRADE IDENTITY + CONTINUOUS MONITORING — pure rules module
 * (Research Wave 2 item 3, approved by x 2026-11-15).
 *
 * A carrier deciding whether to haul for a broker needs the same
 * facts a vetting service checks: who the broker legally is (legal
 * name + MC), whether their BMC-84 bond is real and current, and
 * whether their authority stands. This module is the rules half:
 * the identity record's derived status, the tender re-screen, the
 * bond-expiry alerts, the carrier-facing trust summary, the
 * anti-double-brokering match, and the carrier-of-record guard.
 * The database half (record writes, screens at tender, exception
 * rows, the 371.3 record file) lives in actions.ts.
 *
 * THE GUARDRAILS (written here, enforced here and in actions.ts,
 * pinned by brokerIdentity.test.ts + brokerIdentityFlow.test.ts):
 * (a) NOTHING reads "verified" without a source check. The
 *     verification seam (brokerIdentityVerifierFromEnv) is honest
 *     in the pushSenderFromEnv / paperworkExtractorFromEnv style:
 *     no provider transport connected → NO verifier (null), the
 *     status reads "on file", and monitoring NEVER blocks a tender
 *     over an unconfigured seam or an unchecked record. A check
 *     stamps only when the provider actually answered.
 * (b) The tender screen stands on the RECORDED record alone:
 *     missing identity fields, an expired bond, a bond below the
 *     $75,000 federal minimum, or authority recorded revoked /
 *     inactive. Every block states its plain reason; the screen
 *     fabricates nothing and invents no status.
 * (c) The carrier-facing trust summary NEVER carries the bond
 *     amount or any internal figure — status + expiry month only.
 *     The amount lives on the broker's own record (and in their
 *     own 371.3 file), nowhere else.
 * (d) Anti-double-brokering: a load a carrier accepted from the
 *     board cannot be posted back onto the board by that carrier's
 *     account — the same load (same reference number) or a clone
 *     (same lane at the same rate). A broker re-posting their OWN
 *     load never passes through this check (different door).
 *
 * Pure functions only.
 */

import { credentialDaysLeft, credentialThresholdFor } from "./credentialAlerts";

// ---------------------------------------------------------------------------
// The identity record — as stored on broker_accounts (migration 0131).
// ---------------------------------------------------------------------------

export interface BrokerIdentityLike {
  legalName: string | null;
  mcNumber: string | null;
  bondCarrier: string | null;
  /** The broker's OWN bond figure, on their own record only —
   * never in the trust summary (guardrail c). */
  bondAmount: number | null;
  /** YYYY-MM-DD, the credential-alert convention: the dismissal
   * identity and the threshold math ride on the date itself. */
  bondExpiresOn: string | null;
  /** As recorded by the broker / desk: active | inactive |
   * revoked | not_recorded. A record, never a computed claim. */
  authorityStatus: string;
  /** ISO instant of the last completed source check, null = never
   * checked. Only a returned check writes this (guardrail a). */
  identityVerifiedAt: string | null;
  identitySource: string | null;
}

/** The federal BMC-84 minimum for broker authority — public
 * regulatory fact (49 CFR part 387), not a house number. */
export const BOND_MINIMUM_USD = 75_000;

/** A source check older than this counts as stale, not verified. */
export const IDENTITY_FRESH_DAYS = 30;

/** Bond expiry within this many days reads "expiring soon" on the
 * trust summary — the same 60-day outer window as the alerts. */
export const BOND_EXPIRING_SOON_DAYS = 60;

const clean = (s: string | null | undefined): string | null => (s != null && s.trim() !== "" ? s.trim() : null);

// ---------------------------------------------------------------------------
// Identity status — verified only ever means a source answered.
// ---------------------------------------------------------------------------

export type BrokerIdentityState = "verified" | "stale" | "on_file";

export interface BrokerIdentityStatus {
  state: BrokerIdentityState;
  label: string;
  verifiedAt: string | null;
  source: string | null;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

export function brokerIdentityStatus(
  identity: BrokerIdentityLike,
  opts: { seamConfigured: boolean; nowMs: number },
): BrokerIdentityStatus {
  const verifiedAt = identity.identityVerifiedAt;
  if (!verifiedAt) {
    return {
      state: "on_file",
      label: opts.seamConfigured
        ? "Identity on file — not checked against the verification source yet"
        : "Identity on file — verification source not connected",
      verifiedAt: null,
      source: identity.identitySource ?? null,
    };
  }
  const ageMs = opts.nowMs - new Date(verifiedAt).getTime();
  const fresh = Number.isFinite(ageMs) && ageMs <= IDENTITY_FRESH_DAYS * 86_400_000;
  return {
    state: fresh ? "verified" : "stale",
    label: fresh
      ? `Identity checked against ${identity.identitySource ?? "the verification source"} on ${shortDate(verifiedAt)}`
      : `Identity last checked ${shortDate(verifiedAt)} — older than ${IDENTITY_FRESH_DAYS} days, so it counts as stale`,
    verifiedAt,
    source: identity.identitySource ?? null,
  };
}

// ---------------------------------------------------------------------------
// The tender re-screen — run every time a broker posts/tenders.
// Stands on the recorded record alone (guardrail b).
// ---------------------------------------------------------------------------

export interface TenderScreenReason {
  code: "missing_fields" | "bond_expired" | "bond_below_minimum" | "authority_revoked" | "authority_inactive";
  detail: string;
}

/** The facts a clean screen stamps onto the load's record: what
 * was screened, as it stood at screen time. */
export interface TenderScreenFacts {
  screenedAt: string;
  legalName: string | null;
  mcNumber: string | null;
  bondCarrier: string | null;
  bondAmount: number | null;
  bondExpiresOn: string | null;
  authorityStatus: string;
  identityState: BrokerIdentityState;
}

export interface TenderScreen {
  ok: boolean;
  reasons: TenderScreenReason[];
  /** Episode fingerprint: the reason codes, joined — a dismissed
   * block stays dismissed while the SAME failure continues. */
  fingerprint: string;
  facts: TenderScreenFacts;
}

export function screenBrokerIdentity(
  identity: BrokerIdentityLike,
  opts: { seamConfigured: boolean; now: Date },
): TenderScreen {
  const reasons: TenderScreenReason[] = [];
  const missing: string[] = [];
  if (!clean(identity.legalName)) missing.push("legal business name");
  if (!clean(identity.mcNumber)) missing.push("MC number");
  if (!clean(identity.bondCarrier)) missing.push("BMC-84 bond carrier");
  if (identity.bondAmount == null) missing.push("BMC-84 bond amount");
  if (!clean(identity.bondExpiresOn)) missing.push("BMC-84 bond expiry date");
  if (!identity.authorityStatus || identity.authorityStatus === "not_recorded") missing.push("authority status");
  if (missing.length > 0) {
    reasons.push({
      code: "missing_fields",
      detail: `The broker identity record is incomplete — missing: ${missing.join(", ")}.`,
    });
  }
  if (identity.bondExpiresOn) {
    const daysLeft = credentialDaysLeft(identity.bondExpiresOn, opts.now.getTime());
    if (daysLeft < 0) {
      reasons.push({
        code: "bond_expired",
        detail: `The BMC-84 bond on file expired on ${identity.bondExpiresOn}.`,
      });
    }
  }
  if (identity.bondAmount != null && identity.bondAmount < BOND_MINIMUM_USD) {
    reasons.push({
      code: "bond_below_minimum",
      detail: `The BMC-84 bond on file is $${identity.bondAmount.toLocaleString("en-US")} — below the $${BOND_MINIMUM_USD.toLocaleString("en-US")} federal minimum for broker authority.`,
    });
  }
  if (identity.authorityStatus === "revoked") {
    reasons.push({
      code: "authority_revoked",
      detail: "Broker authority is recorded as REVOKED on the identity record.",
    });
  } else if (identity.authorityStatus === "inactive") {
    reasons.push({
      code: "authority_inactive",
      detail: "Broker authority is recorded as INACTIVE on the identity record.",
    });
  }
  const status = brokerIdentityStatus(identity, { seamConfigured: opts.seamConfigured, nowMs: opts.now.getTime() });
  return {
    ok: reasons.length === 0,
    reasons,
    fingerprint: reasons.map((r) => r.code).join("+") || "clean",
    facts: {
      screenedAt: opts.now.toISOString(),
      legalName: clean(identity.legalName),
      mcNumber: clean(identity.mcNumber),
      bondCarrier: clean(identity.bondCarrier),
      bondAmount: identity.bondAmount ?? null,
      bondExpiresOn: clean(identity.bondExpiresOn),
      authorityStatus: identity.authorityStatus || "not_recorded",
      identityState: status.state,
    },
  };
}

/** The one-line plain reason a blocked tender shows. */
export function tenderBlockSummary(screen: TenderScreen): string {
  return screen.reasons.map((r) => r.detail).join(" ");
}

// ---------------------------------------------------------------------------
// BMC-84 bond alerts — the credential-alert pattern (60 / 30 / 7 /
// expired), dismissal keyed on (threshold, expiry date): a
// dismissal silences one threshold for the CURRENT bond only; the
// next threshold still fires; a renewed bond re-arms everything.
// ---------------------------------------------------------------------------

export interface BondDismissalLike {
  threshold: number;
  expiresOn: string;
}

export interface BondAlertStatus {
  expiresOn: string | null;
  daysLeft: number | null;
  /** 60 | 30 | 7 | 0 (expired) | null — outside the window. */
  threshold: number | null;
  dismissed: boolean;
}

export function bondAlertStatus(
  identity: BrokerIdentityLike,
  dismissals: readonly BondDismissalLike[],
  nowMs: number,
): BondAlertStatus {
  const expiresOn = clean(identity.bondExpiresOn);
  if (!expiresOn) return { expiresOn: null, daysLeft: null, threshold: null, dismissed: false };
  const daysLeft = credentialDaysLeft(expiresOn, nowMs);
  const threshold = credentialThresholdFor(daysLeft);
  return {
    expiresOn,
    daysLeft,
    threshold,
    dismissed:
      threshold != null && dismissals.some((d) => d.threshold === threshold && d.expiresOn === expiresOn),
  };
}

/** Notification-center copy for a bond alert (in-app only — bond
 * alerts never become email). */
export function bondNotification(args: { threshold: number; daysLeft: number | null; expiresOn: string | null }): {
  title: string;
  body: string;
} {
  if (args.threshold === 0) {
    return {
      title: "BMC-84 bond expired",
      body: `Your BMC-84 broker bond expired${args.expiresOn ? ` on ${args.expiresOn}` : ""} — tenders are held until a current bond is on file. Update the bond on your broker identity and send again.`,
    };
  }
  const days = args.daysLeft ?? args.threshold;
  return {
    title: `BMC-84 bond expires in ${days} day${days === 1 ? "" : "s"}`,
    body: `Your BMC-84 broker bond expires${args.expiresOn ? ` on ${args.expiresOn}` : ""} — ${days} day${days === 1 ? "" : "s"} left. Renew it and update the expiry date on your broker identity before tenders are held.`,
  };
}

// ---------------------------------------------------------------------------
// Carrier-facing trust summary — what a carrier sees on a board
// load before claiming. Status + expiry month only: NO bond
// amount, NO internal figure (guardrail c).
// ---------------------------------------------------------------------------

export type BondTrustStatus = "active" | "expiring_soon" | "expired" | "not_on_file";

export interface BrokerTrustSummary {
  legalName: string | null;
  mc: string | null;
  bondStatus: BondTrustStatus;
  bondStatusLabel: string;
  /** "Mar 2027" — month + year only, by design. */
  bondExpiresMonth: string | null;
  verificationStatus: BrokerIdentityState;
  verificationLabel: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthYearOf(yyyyMmDd: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyyMmDd.trim());
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return null;
  return `${month} ${m[1]}`;
}

export function brokerTrustSummary(
  identity: BrokerIdentityLike,
  opts: { seamConfigured: boolean; nowMs: number },
): BrokerTrustSummary {
  const status = brokerIdentityStatus(identity, opts);
  const expiresOn = clean(identity.bondExpiresOn);
  const month = expiresOn ? monthYearOf(expiresOn) : null;
  let bondStatus: BondTrustStatus = "not_on_file";
  let bondStatusLabel = "No bond on file";
  if (expiresOn) {
    const daysLeft = credentialDaysLeft(expiresOn, opts.nowMs);
    if (daysLeft < 0) {
      bondStatus = "expired";
      bondStatusLabel = month ? `Bond expired ${month}` : "Bond expired";
    } else if (daysLeft <= BOND_EXPIRING_SOON_DAYS) {
      bondStatus = "expiring_soon";
      bondStatusLabel = month ? `Bond on file — expires ${month}` : "Bond on file — expiring soon";
    } else {
      bondStatus = "active";
      bondStatusLabel = month ? `Bond on file — expires ${month}` : "Bond on file";
    }
  }
  return {
    legalName: clean(identity.legalName),
    mc: clean(identity.mcNumber),
    bondStatus,
    bondStatusLabel,
    bondExpiresMonth: month,
    verificationStatus: status.state,
    verificationLabel: status.label,
  };
}

// ---------------------------------------------------------------------------
// The verification seam — in the style of pushSenderFromEnv /
// paperworkExtractorFromEnv. The provider transport is injected;
// the ENV decision lives here and nowhere else. No transport is
// connected in this build, so the factory returns null and every
// status honestly reads "on file" — an env key alone does not
// conjure a feed, and nothing is ever stamped verified off one.
// ---------------------------------------------------------------------------

export interface BrokerIdentityCheck {
  authorityStatus: string; // active | inactive | revoked — as the source reports
  bondCarrier: string | null;
  bondAmount: number | null;
  bondExpiresOn: string | null; // YYYY-MM-DD
  source: string;
  checkedAt: string; // ISO
}

/** The provider call itself (an FMCSA / Motus-class lookup). A
 * provider agreement wires the real one in; until then the action
 * passes none and the seam stays unconfigured. */
export type BrokerIdentityTransport = (args: {
  mcNumber: string | null;
  legalName: string | null;
}) => Promise<BrokerIdentityCheck | null>;

export interface BrokerIdentityVerifier {
  source: string;
  check(args: { mcNumber: string | null; legalName: string | null }): Promise<BrokerIdentityCheck | null>;
}

export function brokerIdentityVerifierFromEnv(
  env: Record<string, string | undefined>,
  transport?: BrokerIdentityTransport,
): BrokerIdentityVerifier | null {
  if (!env.BROKER_IDENTITY_API_KEY || !transport) return null;
  return {
    source: "fmcsa-provider",
    check: (args) => transport(args),
  };
}

/** Where a returned check DISAGREES with the recorded record —
 * plain strings for the broker/desk to reconcile. An empty list
 * means the source's facts agree with what's on file. The check
 * never silently rewrites the record: differences are reported,
 * the humans fix the record. */
export function identityCheckDifferences(identity: BrokerIdentityLike, check: BrokerIdentityCheck): string[] {
  const out: string[] = [];
  if (identity.authorityStatus && identity.authorityStatus !== "not_recorded" && check.authorityStatus !== identity.authorityStatus) {
    out.push(`Authority: the record says ${identity.authorityStatus}, the source reports ${check.authorityStatus}.`);
  }
  if (clean(identity.bondCarrier) && clean(check.bondCarrier) && clean(identity.bondCarrier)!.toLowerCase() !== clean(check.bondCarrier)!.toLowerCase()) {
    out.push(`Bond carrier: the record says ${identity.bondCarrier}, the source reports ${check.bondCarrier}.`);
  }
  if (identity.bondAmount != null && check.bondAmount != null && identity.bondAmount !== check.bondAmount) {
    out.push(`Bond amount: the record says $${identity.bondAmount.toLocaleString("en-US")}, the source reports $${check.bondAmount.toLocaleString("en-US")}.`);
  }
  if (clean(identity.bondExpiresOn) && clean(check.bondExpiresOn) && identity.bondExpiresOn !== check.bondExpiresOn) {
    out.push(`Bond expiry: the record says ${identity.bondExpiresOn}, the source reports ${check.bondExpiresOn}.`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Anti-double-brokering — a load accepted from the board cannot be
// posted back onto it by the accepting carrier's account. A clone
// is the same reference number, or the same lane at the same rate
// (guardrail d).
// ---------------------------------------------------------------------------

export interface AcceptedLoadLike {
  boardLoadId: number;
  referenceNumber: string | null;
  pickupCity: string | null;
  pickupState: string | null;
  deliveryCity: string | null;
  deliveryState: string | null;
  rate: number | null;
}

export interface BoardPostCandidate {
  referenceNumber: string | null;
  pickupCity: string | null;
  pickupState: string | null;
  deliveryCity: string | null;
  deliveryState: string | null;
  rate: number | null;
}

function normPlace(city: string | null, state: string | null): string | null {
  const c = (city ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const s = (state ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!c && !s) return null;
  return `${c},${s}`;
}

function normReference(ref: string | null): string | null {
  const r = (ref ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return r === "" ? null : r;
}

function laneOf(l: { pickupCity: string | null; pickupState: string | null; deliveryCity: string | null; deliveryState: string | null }): string | null {
  const p = normPlace(l.pickupCity, l.pickupState);
  const d = normPlace(l.deliveryCity, l.deliveryState);
  if (!p || !d) return null;
  return `${p}->${d}`;
}

export interface DoubleBrokerMatch {
  boardLoadId: number;
  basis: "reference" | "lane_and_rate";
}

/** Find the accepted load a new board post clones, if any.
 * Reference matches win over lane+rate matches (the stronger
 * fingerprint first). */
export function findDoubleBrokerMatch(
  candidate: BoardPostCandidate,
  accepted: readonly AcceptedLoadLike[],
): DoubleBrokerMatch | null {
  const candRef = normReference(candidate.referenceNumber);
  if (candRef) {
    for (const a of accepted) {
      if (normReference(a.referenceNumber) === candRef) return { boardLoadId: a.boardLoadId, basis: "reference" };
    }
  }
  const candLane = laneOf(candidate);
  if (candLane && candidate.rate != null) {
    for (const a of accepted) {
      if (a.rate != null && Math.round(a.rate * 100) === Math.round(candidate.rate * 100) && laneOf(a) === candLane) {
        return { boardLoadId: a.boardLoadId, basis: "lane_and_rate" };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Carrier of record — the account that accepted a load is bound to
// it; a different account moving it is a conflict, refused and
// flagged (enforced in actions.ts at the take/accept funnels).
// ---------------------------------------------------------------------------

export function carrierOfRecordConflict(carrierOfRecord: string | null, actor: string): boolean {
  return carrierOfRecord != null && carrierOfRecord.trim() !== "" && carrierOfRecord !== actor;
}
