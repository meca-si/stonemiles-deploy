/**
 * PAPERWORK INTAKE DOOR — pure rules (Alvys-grab build, x
 * 2026-11-15: the "send it into the load" door that works today).
 *
 * A broker or carrier rarely has a STONEMILES account, so the
 * rate confirmation / BOL / POD for a load arrives the way the
 * receive link already works: a per-load, no-account LINK (token
 * kind "docs" on the receive-link machinery — revocable, and it
 * ends at delivery like the tracking share). What lands through
 * the door enters the EXISTING paperwork pipeline (paperwork.ts):
 * the same load_paperwork row, the same extraction seam, the same
 * driver confirmation. The door changes WHO can hand the paper
 * in, never what the paper must survive.
 *
 * THE RULES:
 * (a) The file type is SNIFFED from the bytes — the uploader's
 *     claimed mime is never trusted (the item-12 rule, held
 *     harder here because the door is public). Only what a rate
 *     con / BOL / POD actually is: PDF, JPEG, PNG. Anything else
 *     is refused before storage.
 * (b) Size is bounded both ways — a stub or an empty file is not
 *     a document, and an unbounded upload is a denial of service
 *     with extra steps.
 * (c) The door's public face shows only that the load exists for
 *     paperwork (lane + date). No rate, no other load data — the
 *     shaping lives in actions.ts and is test-pinned there.
 * (d) Email-in is a SEAM, not a claim: paperworkInboundEmailFromEnv
 *     is the single place the configuration decision lives, and
 *     it returns null until a real inbound provider is wired via
 *     env. Nothing in the app says email-in works until it does —
 *     the LINK is the working door, and the copy says link.
 *
 * Pure functions only — the database half lives in actions.ts.
 */

export type DoorDocMime = "application/pdf" | "image/jpeg" | "image/png";

/** Bounded both ways (the send door's discipline, sized for a
 * scanned rate con / BOL / POD). */
export const DOOR_DOC_MIN_BYTES = 32;
export const DOOR_DOC_MAX_BYTES = 8_000_000;

/** Per-load submission cap through the door, per hour — far above
 * a broker's real pace (a rate con, a BOL, a POD, a correction),
 * far below a flood. Counted from the sealed paperwork_filed
 * events in actions.ts (the house DB-count style). */
export const DOOR_SUBMISSIONS_PER_HOUR = 10;

/** A real JPEG frame header (SOF0/SOF1/SOF2) after the SOI — the
 * signature pad's rule: a magic prefix alone is not an image. */
function jpegFrameOk(bytes: Uint8Array): boolean {
  let i = 2; // past SOI
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) return false;
    const marker = bytes[i + 1]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // standalone markers carry no length
      continue;
    }
    const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (len < 2) return false;
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) return true; // SOF0/1/2
    if (marker === 0xda) return false; // SOS before any frame header — not a real frame
    i += 2 + len;
  }
  return false;
}

/** Sniff a document's real type from its bytes. Returns the
 * SNIFFED mime (never the claimed one), or null when the bytes
 * are not a PDF, JPEG, or PNG document. */
export function sniffDoorDocMime(bytes: Uint8Array): DoorDocMime | null {
  if (bytes.length < DOOR_DOC_MIN_BYTES || bytes.length > DOOR_DOC_MAX_BYTES) return null;
  // PDF: "%PDF-"
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) {
    return "application/pdf";
  }
  // JPEG: SOI + a real frame header.
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && jpegFrameOk(bytes)) {
    return "image/jpeg";
  }
  // PNG: the 8-byte signature + an IHDR chunk first.
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a &&
    bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52
  ) {
    return "image/png";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Door state — derived at read time (the track-share pattern): the
// link row stays "active" until revoked; a delivered load ends
// the door on its own.
// ---------------------------------------------------------------------------

export type DocsDoorState = "live" | "delivered" | "revoked";

export function docsDoorStateFor(args: { linkStatus: string; delivered: boolean }): DocsDoorState {
  if (args.linkStatus === "revoked") return "revoked";
  if (args.delivered) return "delivered";
  return "live";
}

// ---------------------------------------------------------------------------
// The inbound-email seam — env-gated, unconfigured today. A future
// provider (a real inbound-mail webhook) slots in behind this
// shape; until PAPERWORK_INBOUND_EMAIL_ADDRESS and
// PAPERWORK_INBOUND_EMAIL_SECRET are set, there is NO email door
// and nothing in the app claims one.
// ---------------------------------------------------------------------------

export interface PaperworkInboundEmail {
  /** The address brokers would send paperwork to. */
  address: string;
  /** Verify one inbound webhook call's shared secret. */
  verifySecret(candidate: string): boolean;
}

export function paperworkInboundEmailFromEnv(
  env: Record<string, string | undefined>,
): PaperworkInboundEmail | null {
  const address = env.PAPERWORK_INBOUND_EMAIL_ADDRESS?.trim();
  const secret = env.PAPERWORK_INBOUND_EMAIL_SECRET?.trim();
  if (!address || !secret) return null;
  return {
    address,
    verifySecret: (candidate) => candidate.length > 0 && candidate === secret,
  };
}
