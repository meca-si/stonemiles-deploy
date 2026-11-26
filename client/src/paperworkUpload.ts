// paperworkUpload — getting a picked file into a shape the
// paperwork intake accepts, with NO silent failures (x's report,
// 2026-11-25: "Can't upload paperwork" — the old flow staged the
// file behind a raw browser input and a button that stayed grey
// until a read succeeded, and every failure path swallowed its
// error: an unreadable photo, an iPhone HEIC the server refuses,
// an oversized scan — all of them just left the button dead).
//
// The server takes JPG / PNG / PDF only, base64 up to 12,000,000
// chars (fileLoadPaperwork's zod cap). This module's job:
//   - JPG/PNG/PDF small enough → send as picked.
//   - Any other image (HEIC/HEIF from an iPhone library, WebP, a
//     photo with no type at all) → decode it and re-encode as a
//     JPEG in the browser, which is also the shrink path for an
//     oversized JPG/PNG.
//   - A PDF over the cap → a plain refusal; a PDF can't be shrunk
//     in the browser honestly.
//   - Anything else → a plain refusal naming what to use instead.
// Every rejection is an Error with driver-facing words; the caller
// puts it on the banner. Nothing in here swallows a failure.

/** The intake's base64 cap (fileLoadPaperwork zod max). */
export const PAPERWORK_MAX_BASE64_CHARS = 12_000_000;

/** Largest file (bytes) sent as picked. Base64 inflates ~4/3, so
 *  8.5 MB of file stays comfortably under the 12M-char cap. */
export const PAPERWORK_DIRECT_MAX_BYTES = 8_500_000;

/** Longest edge (px) of a converted image — plenty for reading a
 *  rate con or BOL, small enough to land well under the cap. */
export const PAPERWORK_CONVERT_MAX_EDGE_PX = 2200;

export type PaperworkUploadPlan =
  | { kind: "direct" }
  | { kind: "convert-image" }
  | { kind: "too-large"; message: string }
  | { kind: "unsupported"; message: string };

const TOO_LARGE_MESSAGE =
  "That file is too large to file here (over about 8 MB) — try a photo of it, or a smaller scan.";
const UNSUPPORTED_MESSAGE =
  "That file type can't be filed as paperwork — use a photo, a JPG or PNG picture, or a PDF scan.";

export function paperworkUploadPlan(file: { type: string; size: number }): PaperworkUploadPlan {
  const type = (file.type || "").trim().toLowerCase();
  if (type === "application/pdf") {
    return file.size <= PAPERWORK_DIRECT_MAX_BYTES ? { kind: "direct" } : { kind: "too-large", message: TOO_LARGE_MESSAGE };
  }
  if (type === "image/jpeg" || type === "image/png") {
    // A small one goes as picked; a big one takes the convert path,
    // which re-encodes it smaller as a JPEG.
    return file.size <= PAPERWORK_DIRECT_MAX_BYTES ? { kind: "direct" } : { kind: "convert-image" };
  }
  if (type.startsWith("image/") || type === "") {
    // HEIC/HEIF/WebP or an untyped photo: decode + re-encode.
    return { kind: "convert-image" };
  }
  return { kind: "unsupported", message: UNSUPPORTED_MESSAGE };
}

function readAsDataUrl(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("That file couldn't be read — try picking it again."));
    reader.readAsDataURL(f);
  });
}

function base64Of(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

async function decodeImage(f: File): Promise<{ draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(f);
      return {
        draw: (ctx, w, h) => ctx.drawImage(bmp, 0, 0, w, h),
        width: bmp.width,
        height: bmp.height,
        close: () => bmp.close(),
      };
    } catch {
      // Fall through to the <img> path — some browsers refuse
      // createImageBitmap for formats they can still show.
    }
  }
  const url = URL.createObjectURL(f);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode failed"));
      el.src = url;
    });
    return {
      draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
      width: img.naturalWidth,
      height: img.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

async function convertImageToJpeg(f: File): Promise<{ base64: string; mime: string }> {
  let decoded: Awaited<ReturnType<typeof decodeImage>>;
  try {
    decoded = await decodeImage(f);
  } catch {
    throw new Error(
      "That photo's format couldn't be read here — on an iPhone, Settings → Camera → Formats → Most Compatible makes photos JPG; or pick a JPG, PNG, or PDF instead.",
    );
  }
  try {
    const scale = Math.min(1, PAPERWORK_CONVERT_MAX_EDGE_PX / Math.max(decoded.width, decoded.height));
    const w = Math.max(1, Math.round(decoded.width * scale));
    const h = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("That photo couldn't be prepared here — try a JPG, PNG, or PDF instead.");
    // White under the image: a transparent PNG re-encoded straight
    // to JPEG would come out black where the scan should be.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    decoded.draw(ctx, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    const base64 = base64Of(dataUrl);
    if (base64.length > PAPERWORK_MAX_BASE64_CHARS) throw new Error(TOO_LARGE_MESSAGE);
    return { base64, mime: "image/jpeg" };
  } finally {
    decoded.close();
  }
}

/** Prepare a picked file for fileLoadPaperwork. Resolves with the
 *  base64 + mime to send; rejects with a plain-language Error the
 *  caller shows verbatim. Never resolves a file the server would
 *  refuse for type or size when that can be known up front. */
export async function preparePaperworkUpload(f: File): Promise<{ base64: string; mime: string }> {
  const plan = paperworkUploadPlan(f);
  if (plan.kind === "too-large" || plan.kind === "unsupported") throw new Error(plan.message);
  if (plan.kind === "convert-image") return convertImageToJpeg(f);
  const dataUrl = await readAsDataUrl(f);
  const base64 = base64Of(dataUrl);
  if (base64.length > PAPERWORK_MAX_BASE64_CHARS) throw new Error(TOO_LARGE_MESSAGE);
  return { base64, mime: f.type || "image/jpeg" };
}
