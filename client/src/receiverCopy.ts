// receiverCopy.ts — the receiver's-own-copy handoffs (2026-11-10).
//
// The owner ruled: NO server SMS (no provider, no monthly service).
// The copy text goes from the DRIVER'S own phone and plan: the
// receiver types their number at the dock (that's the opt-in), the
// app builds an sms: handoff with the body pre-filled, and the driver
// taps send in his own Messages app. The share sheet is the fallback
// where a direct sms: handoff isn't available. Only the view-only
// COPY link ever travels in that text — the action-capable receive
// token never leaves the BOL.

export interface SmsHandoff {
  /** The exact message body the driver sends. */
  body: string;
  /** sms: URL for the device handoff. */
  href: string;
  /** Digits-only number the handoff addresses. */
  digits: string;
}

export function normalizePhoneDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function isPlausibleMobile(phone: string): boolean {
  const d = normalizePhoneDigits(phone);
  return d.length >= 7 && d.length <= 15;
}

/** Masked form for audit logs/display — never the full number. */
export function maskPhone(phone: string): string {
  const d = normalizePhoneDigits(phone);
  if (d.length < 2) return "***";
  return `***-***-${d.slice(-2)}`;
}

export function buildSmsHandoff(args: { phone: string; fleetName: string; copyUrl: string }): SmsHandoff {
  const digits = normalizePhoneDigits(args.phone);
  const body = `Your signed delivery copy from ${args.fleetName}: ${args.copyUrl}`;
  // "?&body=" is the form both iOS Messages and Android accept.
  const href = `sms:${digits}?&body=${encodeURIComponent(body)}`;
  return { body, href, digits };
}

/** True when a URL carries an ACTION-capable receive token (rcv_) —
 *  used by tests/guards to prove handoffs only ever carry copy links. */
export function carriesActionToken(url: string): boolean {
  return /\/receive\/rcv_/.test(url);
}
