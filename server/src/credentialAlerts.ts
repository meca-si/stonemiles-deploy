/**
 * CREDENTIAL EXPIRY ALERTS — pure rules module (TMS completion queue
 * item 1, approved by x 2026-11-15).
 *
 * The three credentials that can park a driver — CDL, medical card,
 * TWIC — get in-app alerts at 60, 30, and 7 days before they lapse,
 * and an expired alert once they have. The expiry dates themselves
 * already live in the app and are NOT duplicated here:
 *  - CDL + medical card: the driver's own document-vault rows
 *    (personal_docs, kind "cdl" / "medical", soonest expiry wins —
 *    the same rule the expiry wallet has always used);
 *  - TWIC: the profile's holding flag + expiry date (social_users —
 *    the card NUMBER is never stored anywhere, by design).
 *
 * STATEFUL + DISMISSIBLE PER THRESHOLD (the queue spec's rule): a
 * driver can dismiss the alert for the threshold they're in; the
 * dismissal is recorded against (credential, threshold, expiry date)
 * so the same threshold never nags twice for the same card — but the
 * NEXT threshold still fires when it's crossed, and a RENEWED card
 * (a new expiry date) re-arms every threshold. Dismissing is not
 * renewing: the credential's status row keeps showing its real state
 * everywhere; only the nag is silenced for that round.
 *
 * Every rule below is a pure function of its inputs (the
 * pointsLayer2.ts pattern) so thresholds, dismissal matching, and
 * re-arming are unit-tested without a database.
 */

export type CredentialKey = "cdl" | "medical" | "twic";

/** Alert thresholds in days before expiry; 0 is the expired state. */
export type CredentialThreshold = 60 | 30 | 7 | 0;

export const CREDENTIAL_KEYS: readonly CredentialKey[] = ["cdl", "medical", "twic"];

export const CREDENTIAL_LABELS: Record<CredentialKey, string> = {
  cdl: "CDL",
  medical: "Medical card",
  twic: "TWIC",
};

/** One credential's current expiry, as the caller resolved it from
 *  the existing stores. expiresOn is a YYYY-MM-DD date (never a
 *  timestamp) — the dismissal identity rides on it, so a renewal
 *  (new date) is a different credential for alert purposes. */
export interface CredentialLike {
  key: CredentialKey;
  label: string;
  expiresOn: string | null; // YYYY-MM-DD, null = no date on file
}

/** A recorded dismissal. Matches an alert only when ALL THREE fields
 *  match the credential's current state — same credential, same
 *  threshold, same expiry date. */
export interface CredentialDismissalLike {
  credentialKey: string;
  threshold: number;
  expiresOn: string;
}

export interface CredentialStatus {
  key: CredentialKey;
  label: string;
  expiresOn: string | null;
  daysLeft: number | null;
  /** The tightest threshold crossed right now (60 | 30 | 7 | 0), or
   *  null when the credential is outside the 60-day window or has no
   *  date on file. */
  threshold: CredentialThreshold | null;
  /** True when the current threshold's alert was dismissed for the
   *  current expiry date. The status still reports the threshold —
   *  dismissal silences the nag, never the fact. */
  dismissed: boolean;
}

const DAY_MS = 86400000;

/** The expiry instant for a YYYY-MM-DD date: noon UTC of that day
 *  (the same midday anchor the expiry wallet saves dates with, so a
 *  date never flips a day early/late on a timezone edge). */
export function expiryInstantMs(expiresOn: string): number {
  return Date.parse(`${expiresOn}T12:00:00.000Z`);
}

/** Whole days until the expiry date (ceil, matching the standing
 *  listPersonalDocs daysLeft rule). Negative once lapsed. */
export function credentialDaysLeft(expiresOn: string, nowMs: number): number {
  return Math.ceil((expiryInstantMs(expiresOn) - nowMs) / DAY_MS);
}

/** The threshold an expiry is in right now. Outside 60 days (or no
 *  date) → null: no alert, nothing to dismiss. */
export function credentialThresholdFor(daysLeft: number | null): CredentialThreshold | null {
  if (daysLeft == null) return null;
  if (daysLeft < 0) return 0;
  if (daysLeft <= 7) return 7;
  if (daysLeft <= 30) return 30;
  if (daysLeft <= 60) return 60;
  return null;
}

/** True when a dismissal row silences this exact alert: same
 *  credential, same threshold, same expiry date. A dismissal written
 *  against an older expiry date (the card has since been renewed)
 *  matches nothing. */
export function dismissalMatches(
  dismissal: CredentialDismissalLike,
  status: { key: CredentialKey; threshold: CredentialThreshold | null; expiresOn: string | null },
): boolean {
  return (
    status.threshold != null &&
    status.expiresOn != null &&
    dismissal.credentialKey === status.key &&
    dismissal.threshold === status.threshold &&
    dismissal.expiresOn === status.expiresOn
  );
}

/** Every credential's live status: days left, the threshold it's in,
 *  and whether that threshold's alert has been dismissed for the
 *  current expiry date. Input order is preserved (callers pass CDL,
 *  medical, TWIC). */
export function buildCredentialStatuses(
  credentials: readonly CredentialLike[],
  dismissals: readonly CredentialDismissalLike[],
  nowMs: number,
): CredentialStatus[] {
  return credentials.map((c) => {
    const daysLeft = c.expiresOn != null ? credentialDaysLeft(c.expiresOn, nowMs) : null;
    const threshold = credentialThresholdFor(daysLeft);
    const base = { key: c.key, threshold, expiresOn: c.expiresOn };
    return {
      key: c.key,
      label: c.label,
      expiresOn: c.expiresOn,
      daysLeft,
      threshold,
      dismissed: threshold != null && dismissals.some((d) => dismissalMatches(d, base)),
    };
  });
}

/** The alerts that should actually nag right now: in a threshold and
 *  not dismissed for this expiry date. Most urgent first (expired,
 *  then soonest expiry). */
export function activeCredentialAlerts(statuses: readonly CredentialStatus[]): CredentialStatus[] {
  return statuses
    .filter((s) => s.threshold != null && !s.dismissed)
    .sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity));
}
