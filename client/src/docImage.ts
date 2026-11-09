// Document-photo preparation — downscale before base64 (pure logic
// split from the DOM work, like routePersistence.ts, so the sizing
// and cap decisions are unit-testable; see docImage.test.ts).
//
// Why this module exists (driver report, 2026-11-01): "Tried to add
// a load but wouldn't work — I upload, it blinks, then disappears."
// handleLoadFile base64-encoded the FULL-RES phone photo (12MP+)
// untouched. That string is ~15–25 MB of base64 held in JS memory on
// top of the decoded bitmap — in a backgrounded iOS WKWebView that
// spike gets the content process killed, the shell reloads, and the
// in-memory form (and the upload) vanish with no error anywhere.
// The same oversize string would ALSO be rejected at save time: the
// server caps docDataBase64 at 14,000,000 chars.
//
// The fix: decode the photo, cap the long edge at 2048px (plenty for
// reading a rate con / BOL), re-encode as JPEG, and only then base64.
// Both the memory spike and the cap rejections go away. Anything
// that STILL doesn't fit fails loudly in the form (see
// docTooLargeMessage) instead of silently.

/** Server cap on a document's dataBase64 (zod max in actions.ts). */
export const DOC_BASE64_MAX = 14_000_000;

/** Long-edge cap for a re-encoded document photo, in pixels. */
export const DOC_IMAGE_MAX_EDGE = 2048;

/** JPEG qualities tried in order until the base64 fits the cap. */
export const DOC_JPEG_QUALITIES = [0.85, 0.7, 0.55] as const;

/** Base64 length for a raw byte count (4 chars per 3 bytes, padded). */
export function base64LengthForBytes(byteCount: number): number {
  if (!(byteCount > 0)) return 0;
  return Math.ceil(byteCount / 3) * 4;
}

/** True when a base64 string fits the server document cap. */
export function base64FitsCap(dataBase64: string): boolean {
  return dataBase64.length <= DOC_BASE64_MAX;
}

/** True when a file of this byte size can fit the cap once base64'd.
 *  Used to refuse an oversize PDF/file BEFORE reading it into memory. */
export function fileBytesFitCap(sizeBytes: number): boolean {
  return base64LengthForBytes(sizeBytes) <= DOC_BASE64_MAX;
}

/** The largest raw byte count whose base64 still fits the cap. */
export function maxRawBytesForCap(): number {
  return Math.floor(DOC_BASE64_MAX / 4) * 3;
}

/** Target dimensions for the re-encode: long edge capped at
 *  maxEdge, aspect preserved, never upscaled. Non-positive or
 *  non-finite inputs come back unchanged (decode will fail loudly
 *  downstream rather than this function guessing). */
export function planDownscale(
  width: number,
  height: number,
  maxEdge: number = DOC_IMAGE_MAX_EDGE,
): { width: number; height: number; scaled: boolean } {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return { width, height, scaled: false };
  }
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) return { width, height, scaled: false };
  const ratio = maxEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
    scaled: true,
  };
}

/** The plain-language message the form shows when a photo or file
 *  still exceeds the cap after downscaling. The draft the driver
 *  already typed stays put — this copy says so. */
export function docTooLargeMessage(kind: "photo" | "file"): string {
  return kind === "photo"
    ? "That photo is too large — try a screenshot or a smaller copy. Everything you've typed so far is still here; nothing was lost."
    : "That file is too large — try a screenshot or a smaller copy of it (photos of the pages work too). Everything you've typed so far is still here; nothing was lost.";
}

export type PreparedDoc =
  | {
      ok: true;
      dataBase64: string;
      mimeType: "image/jpeg";
      width: number;
      height: number;
      downscaled: boolean;
    }
  | { ok: false; reason: "too_large" | "unreadable" };

/** Final cap gate for an encoded image — pure, so the too-large
 *  path is testable without a DOM. The DOM path below routes every
 *  candidate encoding through here. */
export function finalizeImageBase64(
  dataBase64: string,
  dims: { width: number; height: number },
  downscaled: boolean,
): PreparedDoc {
  if (!base64FitsCap(dataBase64)) return { ok: false, reason: "too_large" };
  return {
    ok: true,
    dataBase64,
    mimeType: "image/jpeg",
    width: dims.width,
    height: dims.height,
    downscaled,
  };
}

function blobToBase64(blob: Blob): Promise<string> {
  // Build validation (2026-11-01): never SPREAD a byte array into
  // String.fromCharCode(...) — each byte becomes a call argument and
  // multi-megabyte inputs blow the call stack. The bounded-chunk
  // .apply form below passes at most 32 KB per call, the same
  // technique the SDK's own bytesToBase64 fallback uses.
  return blob.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf);
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
    }
    return btoa(bin);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      try {
        return await createImageBitmap(file);
      } catch {
        /* fall through to the <img> path */
      }
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "sync";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // The bitmap is already decoded by img.decode(); the URL can go.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** Encode a prepared canvas as JPEG under the server cap, stepping
 *  quality down until it fits. Shared by the photo path and the PDF
 *  page path (pdfDoc.ts) so every document image the reader sees
 *  went through the exact same sizing and cap discipline. */
async function encodeCanvasDoc(
  canvas: HTMLCanvasElement,
  dims: { width: number; height: number },
  downscaled: boolean,
): Promise<PreparedDoc> {
  for (const quality of DOC_JPEG_QUALITIES) {
    const blob = await canvasToBlob(canvas, quality);
    if (!blob) continue;
    const dataBase64 = await blobToBase64(blob);
    const out = finalizeImageBase64(dataBase64, dims, downscaled || quality !== DOC_JPEG_QUALITIES[0]);
    if (out.ok) return out;
  }
  return { ok: false, reason: "too_large" };
}

/** Decode a photo, downscale it to the long-edge cap, re-encode as
 *  JPEG (stepping quality down if needed), and base64 it — checking
 *  the server cap before anything is handed back. Never throws:
 *  failures come back as a reason the caller turns into a visible
 *  form message. */
export async function prepareDocImage(file: File): Promise<PreparedDoc> {
  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await decodeImage(file);
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  try {
    const srcW = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
    const srcH = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
    const plan = planDownscale(srcW, srcH);
    if (!(plan.width > 0) || !(plan.height > 0)) return { ok: false, reason: "unreadable" };
    const canvas = document.createElement("canvas");
    canvas.width = plan.width;
    canvas.height = plan.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ok: false, reason: "unreadable" };
    // JPEG has no alpha — lay white down first so a transparent PNG
    // document doesn't re-encode onto black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, plan.width, plan.height);
    ctx.drawImage(source, 0, 0, plan.width, plan.height);
    if (source instanceof ImageBitmap) source.close();
    return await encodeCanvasDoc(canvas, plan, plan.scaled);
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

/** Prepare an already-rendered canvas — a PDF page rendered by
 *  pdfDoc.ts — exactly the way a photo is prepared: composited over
 *  white, downscaled to the long-edge cap, JPEG-encoded under the
 *  server cap. Never throws; failures come back as a reason. */
export async function prepareCanvasDoc(source: HTMLCanvasElement): Promise<PreparedDoc> {
  try {
    const plan = planDownscale(source.width, source.height);
    if (!(plan.width > 0) || !(plan.height > 0)) return { ok: false, reason: "unreadable" };
    const canvas = document.createElement("canvas");
    canvas.width = plan.width;
    canvas.height = plan.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ok: false, reason: "unreadable" };
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, plan.width, plan.height);
    ctx.drawImage(source, 0, 0, plan.width, plan.height);
    return await encodeCanvasDoc(canvas, plan, plan.scaled);
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}
