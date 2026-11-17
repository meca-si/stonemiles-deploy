/**
 * UPLOAD ARMOR — malware prevention for every file intake
 * (STONEMILES SENTRY, 2026-11-17).
 *
 * The rule the paperwork door already lives by, generalized: an
 * upload's type is what its BYTES say it is, never what the
 * uploader claims. Every intake that stores a file runs the bytes
 * through here first:
 *
 *   - Executables and scripts are refused outright, whatever the
 *     claimed type: Windows PE (MZ), ELF, Mach-O, and shebang
 *     scripts are programs, not documents — nothing in this app
 *     ever legitimately receives one.
 *   - Scriptable markup (HTML / SVG / XML carrying script) is
 *     refused as a document or photo: it is the stored-XSS and
 *     drive-by vector, and the blob route's attachment discipline
 *     is the second wall, not a reason to let it in.
 *   - Archives (ZIP family) are refused at document intakes: a
 *     rate con / BOL / POD / photo is never an archive, and an
 *     archive is how a disguised executable arrives.
 *   - In STRICT mode (the public doors, where the uploader is a
 *     stranger) the sniffed type must exist and must MATCH the
 *     claimed type — a renamed file fails.
 *   - In GUARD mode (signed-in flows whose callers already passed
 *     a claimed-type allowlist) only the dangerous/archive verdicts
 *     refuse; a type mismatch is the caller's existing business.
 *     (The app's own paperwork test fixtures file placeholder
 *     bytes under an image type — guard mode keeps that door
 *     exactly as it was while still stopping real malware.)
 *
 * Pure functions only — callers own storage and error shaping.
 */

export type UploadKind =
  | "pdf"
  | "jpeg"
  | "png"
  | "webp"
  | "gif"
  | "heic"
  | "heif"
  | "mp4"
  | "quicktime"
  | "webm"
  | "zip"
  | "executable"
  | "script"
  | "markup"
  | "unknown";

export type SniffResult = {
  kind: UploadKind;
  /** The canonical mime for the sniffed kind, or null. */
  mime: string | null;
  /** True when the bytes are a program/script/archive — refused
   *  at every document intake in every mode. */
  dangerous: boolean;
};

const KIND_MIME: Partial<Record<UploadKind, string>> = {
  pdf: "application/pdf",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  quicktime: "video/quicktime",
  webm: "video/webm",
  zip: "application/zip",
};

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (bytes[offset + i] !== sig[i]) return false;
  }
  return true;
}

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
  if (bytes.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/** First non-whitespace, non-BOM byte offset (markup detection
 *  must see past a BOM / leading blank lines). */
function markupStart(bytes: Uint8Array): number {
  let i = 0;
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) i = 3; // UTF-8 BOM
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
  return i;
}

function sniffMarkup(bytes: Uint8Array): boolean {
  const i = markupStart(bytes);
  if (bytes[i] !== 0x3c) return false; // '<'
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(i, Math.min(bytes.length, i + 512)))
    .toLowerCase();
  return (
    head.startsWith("<!doctype html") ||
    head.startsWith("<html") ||
    head.startsWith("<svg") ||
    head.startsWith("<script") ||
    head.startsWith("<?xml") ||
    head.startsWith("<body") ||
    head.startsWith("<head")
  );
}

/** ISO-BMFF brand sniff (HEIC/HEIF/MP4/MOV/M4V all share the ftyp
 *  box; the major brand decides). */
function sniffFtyp(bytes: Uint8Array): UploadKind | null {
  if (bytes.length < 12) return null;
  if (!asciiAt(bytes, 4, "ftyp")) return null;
  const brand = new TextDecoder().decode(bytes.subarray(8, 12));
  if (brand === "heic" || brand === "heix" || brand === "heim" || brand === "heis" || brand === "mif1" || brand === "msf1") {
    // mif1/msf1 are the generic HEIF brands — iPhones write heic,
    // but a generic-brand HEIF is still a photo, never a document.
    return brand === "mif1" || brand === "msf1" ? "heif" : "heic";
  }
  if (brand === "heif" || brand === "hevc") return "heif";
  if (brand === "qt  ") return "quicktime";
  if (brand === "M4V " || brand === "M4VH" || brand === "M4VP") return "mp4";
  if (
    brand === "isom" || brand === "iso2" || brand === "iso5" || brand === "iso6" ||
    brand === "mp41" || brand === "mp42" || brand === "avc1" || brand === "dash"
  ) {
    return "mp4";
  }
  return null;
}

/** Sniff an upload's real type from its leading bytes. */
export function sniffUpload(bytes: Uint8Array): SniffResult {
  const done = (kind: UploadKind, dangerous = false): SniffResult => ({
    kind,
    mime: KIND_MIME[kind] ?? null,
    dangerous,
  });

  if (bytes.length === 0) return done("unknown");

  // --- Dangerous first: programs and scripts --------------------
  if (startsWith(bytes, [0x4d, 0x5a])) return done("executable", true); // MZ — DOS/Windows PE
  if (startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) return done("executable", true); // ELF
  if (
    startsWith(bytes, [0xfe, 0xed, 0xfa, 0xce]) || startsWith(bytes, [0xfe, 0xed, 0xfa, 0xcf]) || // Mach-O
    startsWith(bytes, [0xce, 0xfa, 0xed, 0xfe]) || startsWith(bytes, [0xcf, 0xfa, 0xed, 0xfe]) ||
    startsWith(bytes, [0xca, 0xfe, 0xba, 0xbe]) // Mach-O fat / Java class
  ) {
    return done("executable", true);
  }
  if (startsWith(bytes, [0x23, 0x21])) return done("script", true); // "#!" shebang
  if (sniffMarkup(bytes)) return done("markup", true);
  // ZIP family (incl. docx/xlsx/jar/apk riding the same magic):
  // an archive is never a document/photo at these intakes.
  if (
    startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])
  ) {
    return done("zip", true);
  }
  if (startsWith(bytes, [0x52, 0x61, 0x72, 0x21])) return done("zip", true); // RAR

  // --- Documents and photos --------------------------------------
  if (asciiAt(bytes, 0, "%PDF-")) return done("pdf");
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return done("jpeg");
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return done("png");
  if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP")) return done("webp");
  if (asciiAt(bytes, 0, "GIF87a") || asciiAt(bytes, 0, "GIF89a")) return done("gif");
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return done("webm"); // EBML (WebM/Matroska)
  const ftyp = sniffFtyp(bytes);
  if (ftyp) return done(ftyp);

  return done("unknown");
}

export type UploadAssessment =
  | { ok: true; mime: string; kind: UploadKind }
  | { ok: false; error: string; kind: UploadKind };

/** Claimed types that name the same bytes (phone cameras and
 *  browsers disagree on these labels; the sniff is the truth). */
const MIME_FAMILY: Record<string, string[]> = {
  "image/heic": ["image/heic", "image/heif"],
  "image/heif": ["image/heic", "image/heif"],
  "video/mp4": ["video/mp4", "video/x-m4v"],
  "video/x-m4v": ["video/mp4", "video/x-m4v"],
};

export const UPLOAD_DANGEROUS_ERROR =
  "That file is a program, script, or archive — not a document or photo, so it can't be accepted.";
export const UPLOAD_MISMATCH_ERROR =
  "That file doesn't match the type it claims to be — nothing was stored. Send the document as it really is (PDF or a photo).";
export const UPLOAD_UNKNOWN_ERROR =
  "That file's type couldn't be verified from its contents — nothing was stored. Send a PDF or a photo instead.";

/**
 * Assess one upload.
 *   mode "strict": the sniffed type must exist, be safe, and
 *     match the claimed type (family-aware). For public doors.
 *   mode "guard": only dangerous/archive bytes refuse; the
 *     claimed type stands otherwise. For signed-in flows.
 * `allowedMimes` (strict mode): when given, the SNIFFED mime must
 * also be on the caller's allowlist.
 */
export function assessUpload(
  bytes: Uint8Array,
  claimedMime: string,
  opts: { mode: "strict" | "guard"; allowedMimes?: readonly string[] },
): UploadAssessment {
  const sniff = sniffUpload(bytes);
  if (sniff.dangerous) {
    return { ok: false, error: UPLOAD_DANGEROUS_ERROR, kind: sniff.kind };
  }
  if (opts.mode === "guard") {
    return { ok: true, mime: claimedMime, kind: sniff.kind };
  }
  // strict
  if (!sniff.mime) {
    return { ok: false, error: UPLOAD_UNKNOWN_ERROR, kind: sniff.kind };
  }
  const claimed = claimedMime.trim().toLowerCase();
  const family = MIME_FAMILY[claimed] ?? [claimed];
  if (!family.includes(sniff.mime)) {
    return { ok: false, error: UPLOAD_MISMATCH_ERROR, kind: sniff.kind };
  }
  if (opts.allowedMimes && !opts.allowedMimes.includes(sniff.mime)) {
    return { ok: false, error: UPLOAD_MISMATCH_ERROR, kind: sniff.kind };
  }
  return { ok: true, mime: sniff.mime, kind: sniff.kind };
}
