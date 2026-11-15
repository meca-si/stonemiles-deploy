/**
 * DRIVER QUALIFICATION FILE (DQF) MANAGER — pure rules module
 * (Research Wave 2 item 6, approved by x 2026-11-15).
 *
 * 49 CFR 391.51 names what a carrier must keep on file for every
 * driver it dispatches: the driver's application, their CDL, the
 * medical examiner's certificate, the road-test certificate, the
 * annual MVR review, and — under 49 CFR 382.701 / 391.23 — the
 * FMCSA Clearinghouse query record. This module is the rules half:
 * the entry model, the qualification evaluator, the medical
 * electronic-verification status + seam, and the fleet expiry
 * alerts. The database half (record writes, the dispatch block,
 * exception rows, the audit packet) lives in actions.ts.
 *
 * THE GUARDRAILS (written here, enforced here and in actions.ts,
 * pinned by dqf.test.ts + dqfFlow.test.ts):
 * (a) EVERYTHING stands on recorded facts. The evaluator reads
 *     entries the fleet (or the driver) recorded — a Clearinghouse
 *     entry is the fleet's record of a query THEY ran at FMCSA,
 *     labelled as such; the app never fabricates an FMCSA result.
 *     A medical verification stamps only when a verification
 *     source actually answered through the seam.
 * (b) A paper medical certificate is NOT proof of medical status
 *     (NRII: electronic verification is the proof). The file shows
 *     the certificate's dates AND its verification state, and the
 *     state reads "on file — electronic verification not
 *     connected" until a source is connected and answers. Only
 *     EXPIRY disqualifies on the medical line — the verification
 *     state is displayed, never invented, and never silently
 *     upgraded.
 * (c) The evaluator is a pure function of (entries, as-of date):
 *     the same function answers "qualified today?" for the
 *     dispatch block and "qualified on 2026-03-01?" for the audit
 *     packet. Entries recorded after the as-of date do not exist
 *     for that date; an entry voided as a correction never counts.
 * (d) No file at all is a block, stated plainly: "No qualification
 *     file on record." The system never silently allows a driver
 *     it knows nothing about.
 *
 * Pure functions only.
 */

import { credentialDaysLeft, credentialThresholdFor } from "./credentialAlerts";

// ---------------------------------------------------------------------------
// The entry model — one row per recorded fact in dqf_entries.
// entryDate is the date the fact is ABOUT (the query date, the
// review date, the certificate's issue date); expiresOn is set
// only where the fact itself expires (CDL, medical certificate).
// ---------------------------------------------------------------------------

export const DQF_ENTRY_KINDS = [
  "application",
  "employment_history",
  "cdl",
  "medical",
  "medical_verification",
  "road_test",
  "mvr_review",
  "clearinghouse_query",
  "violation_record",
  "training",
] as const;

export type DqfEntryKind = (typeof DQF_ENTRY_KINDS)[number];

export const DQF_ENTRY_LABELS: Record<DqfEntryKind, string> = {
  application: "Driver application",
  employment_history: "Employment history",
  cdl: "CDL record",
  medical: "Medical certificate",
  medical_verification: "Medical verification check",
  road_test: "Road test certificate",
  mvr_review: "MVR review",
  clearinghouse_query: "Clearinghouse query",
  violation_record: "Violations record",
  training: "Training record",
};

export interface DqfEntryLike {
  id: number;
  kind: string;
  /** YYYY-MM-DD — the date the recorded fact is about. */
  entryDate: string;
  /** YYYY-MM-DD — set for CDL + medical entries only. */
  expiresOn: string | null;
  /** Kind-specific recorded facts (see the payload readers below). */
  payload: Record<string, unknown>;
  recordedBy: string;
  /** ISO instant the entry was recorded in the app. */
  recordedAt: string;
  voided: boolean;
  hasDoc: boolean;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** Payload readers — the recorded facts per kind, read defensively
 * (a payload is fleet-entered JSON; a missing field reads null,
 * never a guess). */
export const dqfPayload = {
  employer: (e: DqfEntryLike) => str(e.payload.employer),
  cdlState: (e: DqfEntryLike) => str(e.payload.state),
  cdlClass: (e: DqfEntryLike) => str(e.payload.licenseClass),
  examinerName: (e: DqfEntryLike) => str(e.payload.examinerName),
  registryNumber: (e: DqfEntryLike) => str(e.payload.registryNumber),
  reviewOutcome: (e: DqfEntryLike) => str(e.payload.outcome), // acceptable | violations_noted
  queryType: (e: DqfEntryLike) => str(e.payload.queryType), // pre_employment | annual | limited | full
  queryResult: (e: DqfEntryLike) => str(e.payload.result), // clear | prohibited | no_record
  verifyOutcome: (e: DqfEntryLike) => str(e.payload.outcome), // verified | not_found | mismatch
  verifySource: (e: DqfEntryLike) => str(e.payload.source),
  topic: (e: DqfEntryLike) => str(e.payload.topic),
  description: (e: DqfEntryLike) => str(e.payload.description),
};

// ---------------------------------------------------------------------------
// Date helpers — everything in this module speaks YYYY-MM-DD.
// ---------------------------------------------------------------------------

export function isYmd(s: string | null | undefined): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00.000Z`));
}

/** Add whole months to a YYYY-MM-DD date (clamped to the target
 * month's last day). Used for the MVR annual-review due date. */
export function addMonthsYmd(ymd: string, months: number): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${ny}-${pad(nm)}-${pad(nd)}`;
}

/** The entries in force on a date: recorded, not voided, and the
 * fact's own date is not after the as-of date. */
export function entriesEffectiveAt(entries: readonly DqfEntryLike[], asOf: string): DqfEntryLike[] {
  return entries.filter((e) => !e.voided && e.entryDate <= asOf);
}

/** The latest entry of a kind in a set (by fact date, then by id —
 * a later-recorded correction of the same date wins). */
export function latestEntry(entries: readonly DqfEntryLike[], kind: DqfEntryKind): DqfEntryLike | null {
  let best: DqfEntryLike | null = null;
  for (const e of entries) {
    if (e.kind !== kind) continue;
    if (!best || e.entryDate > best.entryDate || (e.entryDate === best.entryDate && e.id > best.id)) best = e;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Medical electronic verification — the seam + the status it feeds.
// ---------------------------------------------------------------------------

export type MedicalVerificationState = "verified" | "on_file" | "not_found" | "mismatch";

export interface MedicalVerificationStatus {
  state: MedicalVerificationState;
  label: string;
  checkedOn: string | null;
  source: string | null;
}

/** The verification state of the CURRENT medical certificate: a
 * check counts only when it was run against the certificate now
 * on file (check date on/after the certificate's issue date).
 * Nothing reads "verified" without a recorded source answer
 * (guardrail b). */
export function medicalVerificationStatus(
  entries: readonly DqfEntryLike[],
  asOf: string,
  opts: { seamConfigured: boolean },
): MedicalVerificationStatus {
  const effective = entriesEffectiveAt(entries, asOf);
  const med = latestEntry(effective, "medical");
  if (!med) {
    return { state: "on_file", label: "No medical certificate on file", checkedOn: null, source: null };
  }
  const checks = effective.filter((e) => e.kind === "medical_verification" && e.entryDate >= med.entryDate);
  const latest = latestEntry(checks, "medical_verification");
  if (!latest) {
    return {
      state: "on_file",
      label: opts.seamConfigured
        ? "Medical certificate on file — not checked against the verification source yet"
        : "Medical certificate on file — electronic verification not connected",
      checkedOn: null,
      source: null,
    };
  }
  const outcome = dqfPayload.verifyOutcome(latest);
  const source = dqfPayload.verifySource(latest);
  if (outcome === "verified") {
    return {
      state: "verified",
      label: `Medical status verified electronically${source ? ` via ${source}` : ""} on ${latest.entryDate}`,
      checkedOn: latest.entryDate,
      source,
    };
  }
  if (outcome === "not_found") {
    return {
      state: "not_found",
      label: `Electronic verification on ${latest.entryDate} found no matching medical record — check the certificate details`,
      checkedOn: latest.entryDate,
      source,
    };
  }
  if (outcome === "mismatch") {
    return {
      state: "mismatch",
      label: `Electronic verification on ${latest.entryDate} disagrees with the certificate on file — reconcile the record`,
      checkedOn: latest.entryDate,
      source,
    };
  }
  return { state: "on_file", label: "Medical certificate on file — electronic verification not connected", checkedOn: null, source: null };
}

// ---------------------------------------------------------------------------
// The verification seam — in the style of brokerIdentityVerifierFromEnv /
// pushSenderFromEnv. The provider transport is injected; the ENV
// decision lives here and nowhere else. No transport is connected
// in this build, so the factory returns null and verification
// honestly reads "on file" — an env key alone conjures no feed.
// ---------------------------------------------------------------------------

export interface MedicalVerificationCheck {
  outcome: "verified" | "not_found" | "mismatch";
  source: string;
  checkedAt: string; // ISO
}

/** The provider call itself (a National Registry / state-CDLIS-class
 * lookup). A provider agreement wires the real one in; until then
 * the action passes none and the seam stays unconfigured. */
export type MedicalVerifierTransport = (args: {
  registryNumber: string | null;
  examinerName: string | null;
  expiresOn: string | null;
}) => Promise<MedicalVerificationCheck | null>;

export interface MedicalVerifier {
  source: string;
  check(args: {
    registryNumber: string | null;
    examinerName: string | null;
    expiresOn: string | null;
  }): Promise<MedicalVerificationCheck | null>;
}

export function medicalVerifierFromEnv(
  env: Record<string, string | undefined>,
  transport?: MedicalVerifierTransport,
): MedicalVerifier | null {
  if (!env.MEDICAL_VERIFY_API_KEY || !transport) return null;
  return {
    source: "medical-registry-provider",
    check: (args) => transport(args),
  };
}

// ---------------------------------------------------------------------------
// The qualification evaluator — 49 CFR 391.51 (+ 382.701) as a pure
// function of the recorded entries and an as-of date.
// ---------------------------------------------------------------------------

export type DqfCheckKey =
  | "application" | "cdl" | "medical" | "road_test" | "mvr_review" | "clearinghouse"
  | "employment_history" | "violations";
export type DqfCheckStatus = "ok" | "missing" | "expired" | "overdue" | "prohibited";

export interface DqfCheck {
  key: DqfCheckKey;
  label: string;
  status: DqfCheckStatus;
  detail: string;
  /** The date this check stands on (expiry / review / query date). */
  date: string | null;
}

export interface DqfReason {
  code:
    | "no_file"
    | "missing_application"
    | "missing_cdl"
    | "cdl_expired"
    | "missing_medical"
    | "medical_expired"
    | "missing_road_test"
    | "missing_mvr"
    | "mvr_overdue"
    | "missing_clearinghouse"
    | "clearinghouse_prohibited"
    | "clearinghouse_overdue"
    | "missing_employment_history"
    | "missing_violations"
    | "violations_overdue";
  detail: string;
}

export interface DqfEvaluation {
  qualified: boolean;
  reasons: DqfReason[];
  checks: DqfCheck[];
  /** Episode fingerprint: the reason codes, joined — a dismissed
   * block stays dismissed while the SAME failure continues. */
  fingerprint: string;
}

const CFR = "49 CFR 391.51";

export function evaluateDqf(entries: readonly DqfEntryLike[], asOf: string): DqfEvaluation {
  const effective = entriesEffectiveAt(entries, asOf);
  const reasons: DqfReason[] = [];
  const checks: DqfCheck[] = [];

  if (effective.length === 0) {
    reasons.push({ code: "no_file", detail: "No qualification file on record for this driver." });
    const missing = (key: DqfCheckKey, label: string): DqfCheck => ({
      key,
      label,
      status: "missing",
      detail: "Nothing on file.",
      date: null,
    });
    checks.push(
      missing("application", "Driver application"),
      missing("cdl", "CDL"),
      missing("medical", "Medical certificate"),
      missing("road_test", "Road test"),
      missing("mvr_review", "MVR review"),
      missing("clearinghouse", "Clearinghouse query"),
      missing("employment_history", "Employment history"),
      missing("violations", "Annual violations list"),
    );
    return { qualified: false, reasons, checks, fingerprint: "no_file" };
  }

  // -- Application (391.51(b)(1)) -------------------------------------------
  const application = latestEntry(effective, "application");
  if (application) {
    checks.push({ key: "application", label: "Driver application", status: "ok", detail: `Application on file since ${application.entryDate}.`, date: application.entryDate });
  } else {
    checks.push({ key: "application", label: "Driver application", status: "missing", detail: "No driver application on file.", date: null });
    reasons.push({ code: "missing_application", detail: `No driver application on file (${CFR}).` });
  }

  // -- CDL (391.51(b)(6) — a copy of the license / its record) --------------
  const cdl = latestEntry(effective, "cdl");
  if (!cdl) {
    checks.push({ key: "cdl", label: "CDL", status: "missing", detail: "No CDL record on file.", date: null });
    reasons.push({ code: "missing_cdl", detail: `No CDL record on file (${CFR}).` });
  } else if (!cdl.expiresOn) {
    checks.push({ key: "cdl", label: "CDL", status: "missing", detail: "The CDL record on file has no expiry date — its validity can't be shown.", date: cdl.entryDate });
    reasons.push({ code: "missing_cdl", detail: "The CDL record on file has no expiry date — validity can't be shown." });
  } else if (cdl.expiresOn < asOf) {
    checks.push({ key: "cdl", label: "CDL", status: "expired", detail: `CDL expired on ${cdl.expiresOn}.`, date: cdl.expiresOn });
    reasons.push({ code: "cdl_expired", detail: `CDL expired on ${cdl.expiresOn}.` });
  } else {
    checks.push({ key: "cdl", label: "CDL", status: "ok", detail: `CDL on file — expires ${cdl.expiresOn}.`, date: cdl.expiresOn });
  }

  // -- Medical certificate (391.51(b)(7)) ------------------------------------
  const med = latestEntry(effective, "medical");
  if (!med) {
    checks.push({ key: "medical", label: "Medical certificate", status: "missing", detail: "No medical certificate on file.", date: null });
    reasons.push({ code: "missing_medical", detail: `No medical certificate on file (${CFR}).` });
  } else if (!med.expiresOn) {
    checks.push({ key: "medical", label: "Medical certificate", status: "missing", detail: "The medical certificate on file has no expiry date — its validity can't be shown.", date: med.entryDate });
    reasons.push({ code: "missing_medical", detail: "The medical certificate on file has no expiry date — validity can't be shown." });
  } else if (med.expiresOn < asOf) {
    checks.push({ key: "medical", label: "Medical certificate", status: "expired", detail: `Medical certificate expired on ${med.expiresOn}.`, date: med.expiresOn });
    reasons.push({ code: "medical_expired", detail: `Medical certificate expired on ${med.expiresOn}.` });
  } else {
    checks.push({ key: "medical", label: "Medical certificate", status: "ok", detail: `Medical certificate on file — expires ${med.expiresOn}.`, date: med.expiresOn });
  }

  // -- Road test certificate (391.51(b)(5)) ----------------------------------
  const roadTest = latestEntry(effective, "road_test");
  if (roadTest) {
    checks.push({ key: "road_test", label: "Road test", status: "ok", detail: `Road test certificate on file — ${roadTest.entryDate}.`, date: roadTest.entryDate });
  } else {
    checks.push({ key: "road_test", label: "Road test", status: "missing", detail: "No road test certificate on file.", date: null });
    reasons.push({ code: "missing_road_test", detail: `No road test certificate on file (${CFR}).` });
  }

  // -- Annual MVR review (391.51(b)(2) / 391.25 — within 12 months) ---------
  const mvr = latestEntry(effective, "mvr_review");
  if (!mvr) {
    checks.push({ key: "mvr_review", label: "MVR review", status: "missing", detail: "No MVR review on file.", date: null });
    reasons.push({ code: "missing_mvr", detail: `No MVR review on file (${CFR}).` });
  } else {
    const dueOn = addMonthsYmd(mvr.entryDate, 12);
    if (dueOn < asOf) {
      checks.push({ key: "mvr_review", label: "MVR review", status: "overdue", detail: `Last MVR review ${mvr.entryDate} — the annual review came due ${dueOn}.`, date: mvr.entryDate });
      reasons.push({ code: "mvr_overdue", detail: `Annual MVR review overdue — last review ${mvr.entryDate}, due ${dueOn}.` });
    } else {
      checks.push({ key: "mvr_review", label: "MVR review", status: "ok", detail: `MVR reviewed ${mvr.entryDate} — next due ${dueOn}.`, date: mvr.entryDate });
    }
  }

  // -- Clearinghouse (382.701 / 391.23 — latest recorded query rules) -------
  const query = latestEntry(effective, "clearinghouse_query");
  if (!query) {
    checks.push({ key: "clearinghouse", label: "Clearinghouse query", status: "missing", detail: "No Clearinghouse query on file.", date: null });
    reasons.push({ code: "missing_clearinghouse", detail: "No Clearinghouse query on file (49 CFR 382.701)." });
  } else if (dqfPayload.queryResult(query) === "prohibited") {
    checks.push({
      key: "clearinghouse",
      label: "Clearinghouse query",
      status: "prohibited",
      detail: `The Clearinghouse query recorded ${query.entryDate} shows this driver PROHIBITED.`,
      date: query.entryDate,
    });
    reasons.push({
      code: "clearinghouse_prohibited",
      detail: `Clearinghouse shows this driver PROHIBITED (query recorded ${query.entryDate}).`,
    });
  } else {
    // Annual cadence (audit A6 — 49 CFR 382.701(b)): a query, however
    // clean, only stands for 12 months; the annual limited query is
    // due on the same rhythm as the MVR review above. A years-old
    // "clear" no longer reads OK forever.
    const dueOn = addMonthsYmd(query.entryDate, 12);
    if (dueOn < asOf) {
      checks.push({
        key: "clearinghouse",
        label: "Clearinghouse query",
        status: "overdue",
        detail: `Last Clearinghouse query ${query.entryDate} — the annual query came due ${dueOn}.`,
        date: query.entryDate,
      });
      reasons.push({
        code: "clearinghouse_overdue",
        detail: `Annual Clearinghouse query overdue — last query ${query.entryDate}, due ${dueOn} (49 CFR 382.701).`,
      });
    } else {
      const result = dqfPayload.queryResult(query);
      checks.push({
        key: "clearinghouse",
        label: "Clearinghouse query",
        status: "ok",
        detail:
          result === "no_record"
            ? `Clearinghouse query recorded ${query.entryDate} — no record found, not prohibited. Annual query next due ${dueOn}.`
            : `Clearinghouse query recorded ${query.entryDate} — clear. Annual query next due ${dueOn}.`,
        date: query.entryDate,
      });
    }
  }

  // -- Employment history inquiries (391.23(c) / 391.51(b)(1)) -------------
  // The safety-performance-history inquiries to prior employers (3
  // years) are part of the file §391.51 requires. The entry kind has
  // existed since the DQF shipped; the evaluator never required it
  // (audit A7). Presence is the requirement — the inquiries are a
  // hire-time record, not an annual one.
  const empHist = latestEntry(effective, "employment_history");
  if (empHist) {
    checks.push({ key: "employment_history", label: "Employment history", status: "ok", detail: `Employment-history inquiries on file since ${empHist.entryDate}.`, date: empHist.entryDate });
  } else {
    checks.push({ key: "employment_history", label: "Employment history", status: "missing", detail: "No employment-history inquiries on file.", date: null });
    reasons.push({ code: "missing_employment_history", detail: `No employment-history inquiries on file (49 CFR 391.23(c)).` });
  }

  // -- Annual list of violations (391.27 / 391.51(b)(3)) -------------------
  // The driver's annual list of violations (or their certification
  // of none), refreshed every 12 months on the MVR rhythm (audit A7).
  const viol = latestEntry(effective, "violation_record");
  if (!viol) {
    checks.push({ key: "violations", label: "Annual violations list", status: "missing", detail: "No annual violations list on file.", date: null });
    reasons.push({ code: "missing_violations", detail: `No annual list of violations on file (49 CFR 391.27).` });
  } else {
    const dueOn = addMonthsYmd(viol.entryDate, 12);
    if (dueOn < asOf) {
      checks.push({ key: "violations", label: "Annual violations list", status: "overdue", detail: `Last violations list ${viol.entryDate} — the annual list came due ${dueOn}.`, date: viol.entryDate });
      reasons.push({ code: "violations_overdue", detail: `Annual list of violations overdue — last list ${viol.entryDate}, due ${dueOn} (49 CFR 391.27).` });
    } else {
      checks.push({ key: "violations", label: "Annual violations list", status: "ok", detail: `Violations list on file — ${viol.entryDate}; next due ${dueOn}.`, date: viol.entryDate });
    }
  }

  return {
    qualified: reasons.length === 0,
    reasons,
    checks,
    fingerprint: reasons.map((r) => r.code).join("+") || "clean",
  };
}

/** The one-paragraph plain summary a blocked dispatch shows. */
export function dqBlockSummary(evaluation: DqfEvaluation): string {
  return evaluation.reasons.map((r) => r.detail).join(" ");
}

/** Notification-center copy for a held dispatch (in-app only). */
export function dqBlockNotification(args: { driverUsername: string; summary: string }): { title: string; body: string } {
  return {
    title: `Dispatch held — @${args.driverUsername} is not qualified`,
    body: `${args.summary} The load was not assigned. Fix the qualification file and try again — the hold clears itself once the file checks out.`,
  };
}

// ---------------------------------------------------------------------------
// Fleet expiry alerts — the credential-alert pattern (60 / 30 / 7 /
// expired) carried to the fleet side: the owner/dispatch see every
// driver's CDL + medical expiry and MVR annual-review due date.
// Dismissal keyed on (item, threshold, date): silences one
// threshold for the CURRENT date; the next threshold still fires;
// a renewal (new date) re-arms everything.
// ---------------------------------------------------------------------------

export type DqfAlertItemKey = "cdl" | "medical" | "mvr_review" | "clearinghouse" | "violations";

export const DQF_ALERT_LABELS: Record<DqfAlertItemKey, string> = {
  cdl: "CDL",
  medical: "Medical certificate",
  mvr_review: "MVR annual review",
  clearinghouse: "Clearinghouse annual query",
  violations: "Annual violations list",
};

export interface DqfAlertStatus {
  itemKey: DqfAlertItemKey;
  label: string;
  /** The date the threshold math stands on: the credential's
   * expiry, or the MVR review's due date. */
  expiresOn: string | null;
  daysLeft: number | null;
  /** 60 | 30 | 7 | 0 (past due) | null — outside the window. */
  threshold: number | null;
  dismissed: boolean;
}

export interface DqfDismissalLike {
  itemKey: string;
  threshold: number;
  expiresOn: string;
}

/** The alert dates a driver's file currently carries, from the
 * same entries the evaluator reads: latest CDL expiry, latest
 * medical expiry, and the MVR review's due date (last review +
 * 12 months; no review on file → no date — the evaluator already
 * flags the missing review itself). */
export function dqfAlertDates(entries: readonly DqfEntryLike[], asOf: string): Record<DqfAlertItemKey, string | null> {
  const effective = entriesEffectiveAt(entries, asOf);
  const cdl = latestEntry(effective, "cdl");
  const med = latestEntry(effective, "medical");
  const mvr = latestEntry(effective, "mvr_review");
  const query = latestEntry(effective, "clearinghouse_query");
  const viol = latestEntry(effective, "violation_record");
  return {
    cdl: cdl?.expiresOn ?? null,
    medical: med?.expiresOn ?? null,
    mvr_review: mvr ? addMonthsYmd(mvr.entryDate, 12) : null,
    // The annual cadences (audit A6/A7): the Clearinghouse query
    // and the violations list come due 12 months after the last
    // one on file — the same due-date shape as the MVR review.
    clearinghouse: query ? addMonthsYmd(query.entryDate, 12) : null,
    violations: viol ? addMonthsYmd(viol.entryDate, 12) : null,
  };
}

export function buildDqfAlertStatuses(
  entries: readonly DqfEntryLike[],
  dismissals: readonly DqfDismissalLike[],
  nowMs: number,
): DqfAlertStatus[] {
  const asOf = new Date(nowMs).toISOString().slice(0, 10);
  const dates = dqfAlertDates(entries, asOf);
  const keys: DqfAlertItemKey[] = ["cdl", "medical", "mvr_review", "clearinghouse", "violations"];
  return keys.map((itemKey) => {
    const expiresOn = dates[itemKey];
    const daysLeft = expiresOn != null ? credentialDaysLeft(expiresOn, nowMs) : null;
    const threshold = credentialThresholdFor(daysLeft);
    return {
      itemKey,
      label: DQF_ALERT_LABELS[itemKey],
      expiresOn,
      daysLeft,
      threshold,
      dismissed:
        threshold != null &&
        expiresOn != null &&
        dismissals.some((d) => d.itemKey === itemKey && d.threshold === threshold && d.expiresOn === expiresOn),
    };
  });
}

/** The alerts that should actually nag right now: in a threshold
 * and not dismissed for this date. Most urgent first. */
export function activeDqfAlerts(statuses: readonly DqfAlertStatus[]): DqfAlertStatus[] {
  return statuses
    .filter((s) => s.threshold != null && !s.dismissed)
    .sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity));
}

/** Notification-center copy for a fleet DQF alert (in-app only —
 * these alerts never become email). */
export function dqfAlertNotification(args: {
  driverUsername: string;
  label: string;
  threshold: number;
  daysLeft: number | null;
  expiresOn: string | null;
}): { title: string; body: string } {
  if (args.threshold === 0) {
    return {
      title: `@${args.driverUsername} — ${args.label} is past due`,
      body: `${args.label} for @${args.driverUsername} came due${args.expiresOn ? ` on ${args.expiresOn}` : ""} and is past due — dispatch holds this driver until the qualification file is fixed.`,
    };
  }
  const days = args.daysLeft ?? args.threshold;
  return {
    title: `@${args.driverUsername} — ${args.label} due in ${days} day${days === 1 ? "" : "s"}`,
    body: `${args.label} for @${args.driverUsername} comes due${args.expiresOn ? ` on ${args.expiresOn}` : ""} — ${days} day${days === 1 ? "" : "s"} left. Renew it and record the new date in the qualification file before dispatch holds the driver.`,
  };
}
