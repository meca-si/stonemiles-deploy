/**
 * Release-grade POD seal evaluation (Instant Pay Phase 0/1 groundwork).
 *
 * The app's original POD seal is a PROOF seal: it always lands, and it
 * classifies the seal position against a 3-mile geofence for points
 * purposes only. That is right for proof and wrong for money — a seal
 * that never blocks cannot guard an escrow release (full check finding
 * C4). This module defines the stricter grade the Phase 1 release
 * triggers will require. Nothing consumes the grade yet — escrow is a
 * later phase — but every POD seal now records its grade and the
 * per-criterion results on the sealed record, so the evidence exists
 * and is auditable from day one.
 *
 * A seal is RELEASE-GRADE only when ALL four hold:
 *  (a) the POD was signed inside a TIGHT delivery geofence
 *      (RELEASE_GRADE_GEOFENCE_MI — materially tighter than the
 *      3-mile points radius), with the measured distance recorded;
 *  (b) a BOL photo/scan is attached AND fingerprinted (the pickup BOL
 *      slot's SHA-256, camera-sealed at pickup);
 *  (c) no open exception flag on the load — the app's load-level
 *      exception flags are a pickup seal-number mismatch AND any
 *      open rate-con / BOL cross-verification exception (a field the
 *      two documents disagree on, from docVerify.ts; the caller
 *      passes the open exceptions' detail lines in). Coded
 *      damage/shortage/refusal flags join this set when the Phase 1
 *      dispute coding lands;
 *  (d) the trip's GPS fix quality meets the app's good-fix standard:
 *      the fix filter's good-fix radius is 65 m (GPS_ACCURACY_LIMIT_M
 *      in client/src/gpsFilter.ts), so at least half of the trip's raw
 *      fixes must sit inside that radius and at least one fix must
 *      have been accepted. Fix-quality tallies live on the sealed
 *      trip sheet (trips.fix_quality); with no sheet, the criterion
 *      is unproven and fails.
 *
 * Anything else is PROOF-GRADE — the original behaviour, unchanged for
 * every existing flow. Pure function: no I/O, unit-tested.
 */

export const RELEASE_GRADE_GEOFENCE_MI = 0.25;

/** The fix filter's good-fix accuracy radius, in metres. Mirrors
 *  GPS_ACCURACY_LIMIT_M in client/src/gpsFilter.ts — a fix coarser
 *  than this never moves the recorded position. */
export const GOOD_FIX_ACCURACY_M = 65;

/** Minimum share of a trip's raw fixes that must meet the good-fix
 *  radius for the trip's fix quality to count as good. */
export const GOOD_FIX_MIN_GOOD_SHARE = 0.5;

export interface FixQualityTallies {
  accepted: number;
  rejAccuracy: number;
  rejJump: number;
  rejTime: number;
  accLe10: number;
  accLe25: number;
  accLe50: number;
  accLe65: number;
  accGt65: number;
  accNone: number;
}

export interface SealGradeCriteria {
  tightGeofence: { pass: boolean; distanceMi: number | null; radiusMi: number };
  bolFingerprinted: { pass: boolean; sha256: string | null };
  noOpenExceptions: { pass: boolean; detail: string };
  gpsFixQuality: {
    pass: boolean;
    detail: string;
    accepted: number | null;
    goodShare: number | null;
  };
}

export interface SealGradeResult {
  grade: "release_grade" | "proof_grade";
  criteria: SealGradeCriteria;
}

export function evaluateSealGrade(input: {
  /** Measured seal-to-delivery-spot distance in miles; null when the
   *  load has no delivery spot on record (distance unmeasured). */
  distanceMi: number | null;
  /** SHA-256 of the fingerprinted BOL (pickup BOL slot), or null. */
  bolSha256: string | null;
  /** The load's open exception flag: pickup seal-number mismatch. */
  sealMismatch: boolean;
  /** Open rate-con / BOL cross-verification exceptions on the load,
   *  as detail lines (one per mismatching field). Optional: callers
   *  that don't run the document check pass nothing and the original
   *  seal-mismatch-only semantics hold exactly. */
  openExceptionDetails?: string[];
  /** The hauling trip's fix-quality tallies, or null when no sealed
   *  trip sheet exists for the load yet. */
  fixQuality: FixQualityTallies | null;
}): SealGradeResult {
  const tightGeofence = {
    pass: input.distanceMi != null && input.distanceMi <= RELEASE_GRADE_GEOFENCE_MI,
    distanceMi: input.distanceMi,
    radiusMi: RELEASE_GRADE_GEOFENCE_MI,
  };
  const bolFingerprinted = {
    pass: typeof input.bolSha256 === "string" && input.bolSha256.length > 0,
    sha256: input.bolSha256 ?? null,
  };
  const docExceptions = input.openExceptionDetails ?? [];
  const exceptionDetails: string[] = [];
  if (input.sealMismatch) {
    exceptionDetails.push(
      "the entered pickup seal number did not match the BOL seal number (seal mismatch on record)",
    );
  }
  for (const d of docExceptions) exceptionDetails.push(d);
  const noOpenExceptions = {
    pass: exceptionDetails.length === 0,
    detail:
      exceptionDetails.length === 0
        ? "No open exception flag on the load."
        : `Open exception${exceptionDetails.length === 1 ? "" : "s"}: ${exceptionDetails.join(" · ")}.`,
  };

  let gpsFixQuality: SealGradeCriteria["gpsFixQuality"];
  if (!input.fixQuality) {
    gpsFixQuality = {
      pass: false,
      detail:
        "No sealed trip sheet with GPS fix-quality tallies for this load yet — fix quality unproven.",
      accepted: null,
      goodShare: null,
    };
  } else {
    const fq = input.fixQuality;
    const totalRaw =
      fq.accLe10 + fq.accLe25 + fq.accLe50 + fq.accLe65 + fq.accGt65 + fq.accNone;
    const good = totalRaw - fq.accGt65 - fq.accNone; // fixes inside the 65 m radius
    const goodShare = totalRaw > 0 ? Math.round((good / totalRaw) * 1000) / 1000 : 0;
    if (fq.accepted < 1) {
      gpsFixQuality = {
        pass: false,
        detail: "The trip's GPS filter accepted no fixes — fix quality unproven.",
        accepted: fq.accepted,
        goodShare,
      };
    } else if (goodShare < GOOD_FIX_MIN_GOOD_SHARE) {
      gpsFixQuality = {
        pass: false,
        detail: `Only ${Math.round(goodShare * 100)}% of the trip's GPS fixes met the ${GOOD_FIX_ACCURACY_M} m good-fix standard (needs at least ${Math.round(GOOD_FIX_MIN_GOOD_SHARE * 100)}%).`,
        accepted: fq.accepted,
        goodShare,
      };
    } else {
      gpsFixQuality = {
        pass: true,
        detail: `${Math.round(goodShare * 100)}% of the trip's GPS fixes met the ${GOOD_FIX_ACCURACY_M} m good-fix standard; ${fq.accepted} fixes accepted.`,
        accepted: fq.accepted,
        goodShare,
      };
    }
  }

  const criteria: SealGradeCriteria = {
    tightGeofence,
    bolFingerprinted,
    noOpenExceptions,
    gpsFixQuality,
  };
  const allPass =
    criteria.tightGeofence.pass &&
    criteria.bolFingerprinted.pass &&
    criteria.noOpenExceptions.pass &&
    criteria.gpsFixQuality.pass;
  return { grade: allPass ? "release_grade" : "proof_grade", criteria };
}
