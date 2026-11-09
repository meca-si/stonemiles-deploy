// PDF document reading for the load scan flows — render a PDF's
// pages to images and run them through the SAME extraction photos
// use, so a PDF rate con auto-fills the form instead of hitting the
// "type it by hand" dead end (driver report, 2026-11-01: a PDF rate
// con attached and sealed fine, but the reader only handled JPG/PNG
// and the details never filled).
//
// How rendering works on this platform: the SDK's pdf bundle
// (@hatch/space-sdk/pdf — already in the app for PdfViewer) loads
// PDF.js's worker handler onto globalThis.pdfjsWorker, and PDF.js
// itself detects that and runs its main-thread ("fake worker")
// fallback, so no worker file or workerSrc is needed here. The
// library is pdfjs-dist 5.4.624 — the exact version the SDK vendors
// runtime assets for (cmaps / standard fonts / wasm, copied into
// ./assets/pdfjs/5.4.624/ at build time when the bundle references
// the ./assets/pdfjs/ prefix). Both imports are dynamic, inside
// renderPdfPages, so nothing here executes until a driver actually
// attaches a PDF.
//
// The original PDF is never replaced: the caller attaches and seals
// it as the load's proof document exactly as before. These page
// images are a reading aid only, produced under the same downscale
// and size-cap discipline as photos (docImage.ts).
//
// Pure logic (page planning, render sizing, result merging, blank
// detection, routing) is split from the DOM/PDF.js work so it is
// unit-testable; see pdfDoc.test.ts.

import type { api, ApiResponse } from "./api";
import { DOC_IMAGE_MAX_EDGE, planDownscale, prepareCanvasDoc, type PreparedDoc } from "./docImage";

/** The extraction result shape both load flows already consume. */
export type LoadExtractResult = ApiResponse<typeof api, "extractLoad">;

/** A successfully prepared document image (the ok half of
 *  docImage's PreparedDoc) — all a rendered PDF page ever is by
 *  the time the reader sees it. */
export type PreparedPage = Extract<PreparedDoc, { ok: true }>;

/** Pages of a PDF the reader will render and read, at most. Rate
 *  cons run 1–3 pages; the cap keeps a 90-page packet from turning
 *  into 90 reader calls while covering every real document. */
export const PDF_MAX_PAGES = 4;

/** Render resolution multiplier over PDF points (612×792pt letter
 *  page → 1224×1584px before the docImage cap trims it further). */
export const PDF_RENDER_SCALE = 2;

const PDFJS_VERSION = "5.4.624";
const PDFJS_CMAP_URL = `./assets/pdfjs/${PDFJS_VERSION}/cmaps/`;
const PDFJS_FONTS_URL = `./assets/pdfjs/${PDFJS_VERSION}/standard_fonts/`;
const PDFJS_WASM_URL = `./assets/pdfjs/${PDFJS_VERSION}/wasm/`;

/** Which reader path an attached file takes: photos and PDFs are
 *  read for automatic fill; anything else attaches as-is. A PDF
 *  whose picker reported no/generic MIME type still routes to the
 *  reader on its .pdf name. Mirrors the branch guards the load
 *  flows used before (JPG/PNG read, everything else attached). */
export function classifyDocFile(mime: string, name: string): "photo" | "pdf" | "file" {
  if (mime === "image/jpeg" || mime === "image/png") return "photo";
  if (mime === "application/pdf") return "pdf";
  if ((mime === "" || mime === "application/octet-stream") && /\.pdf$/i.test(name)) return "pdf";
  return "file";
}

/** The 1-based page numbers to render out of a document, capped at
 *  PDF_MAX_PAGES. A document reporting no pages plans nothing —
 *  the caller treats that as unreadable, loudly. */
export function planPdfPages(totalPages: number): { pages: number[]; totalPages: number; truncated: boolean } {
  if (!Number.isFinite(totalPages) || totalPages <= 0) {
    return { pages: [], totalPages: 0, truncated: false };
  }
  const total = Math.floor(totalPages);
  const count = Math.min(total, PDF_MAX_PAGES);
  return {
    pages: Array.from({ length: count }, (_, i) => i + 1),
    totalPages: total,
    truncated: total > PDF_MAX_PAGES,
  };
}

/** Pixel size a page renders at: PDF_RENDER_SCALE over its point
 *  size, run through the same long-edge cap as photos so a huge
 *  page can't blow the webview's memory before docImage even sees
 *  it. `scale` is what the renderer multiplies the point viewport
 *  by to land exactly on these pixels. */
export function planPdfRenderSize(
  pageWidthPt: number,
  pageHeightPt: number,
): { width: number; height: number; scale: number } {
  if (!(pageWidthPt > 0) || !(pageHeightPt > 0) || !Number.isFinite(pageWidthPt) || !Number.isFinite(pageHeightPt)) {
    return { width: 0, height: 0, scale: 0 };
  }
  const plan = planDownscale(Math.round(pageWidthPt * PDF_RENDER_SCALE), Math.round(pageHeightPt * PDF_RENDER_SCALE), DOC_IMAGE_MAX_EDGE);
  return { width: plan.width, height: plan.height, scale: plan.width / pageWidthPt };
}

/** Blank-page test over RGBA probe pixels (a tiny downscaled copy
 *  of the rendered page): blank when nothing darker than near-white
 *  was laid down. An empty sample counts as blank — nothing was
 *  rendered. Used to skip truly empty pages before spending a
 *  reader call on them, and to call an all-blank PDF blank. */
export function isBlankProbe(pixels: ArrayLike<number>): boolean {
  if (pixels.length < 4) return true;
  for (let i = 0; i + 2 < pixels.length; i += 4) {
    if (pixels[i]! < 250 || pixels[i + 1]! < 250 || pixels[i + 2]! < 250) return false;
  }
  return true;
}

/** The plain-language message for a PDF that could not be read.
 *  The PDF stays attached as the proof document and the typed
 *  draft stays put — this copy says so, same honesty rule as
 *  docImage.docTooLargeMessage. */
export function pdfUnreadableMessage(board: boolean): string {
  return board
    ? "Couldn't read that PDF — it may be damaged or password-protected. It's still attached and posts with the load, and everything you've typed is still here. Type the details below, or try a photo of the pages instead."
    : "Couldn't read that PDF — it may be damaged or password-protected. It's still attached and seals with the load as proof, and everything you've typed is still here. Type the details below, or try a photo of the pages instead.";
}

function emptyExtractResult(): LoadExtractResult {
  return {
    locked: false,
    found: false,
    docKind: null,
    shipper: null,
    brokerCompany: null,
    brokerName: null,
    brokerMc: null,
    pickupCity: null,
    pickupState: null,
    pickupAddress: null,
    deliveryCity: null,
    deliveryState: null,
    deliveryAddress: null,
    pickupText: null,
    deliveryText: null,
    rate: null,
    miles: null,
    weightLbs: null,
    commodity: null,
    pieces: null,
    sealNumber: null,
    loadNumber: null,
    poNumber: null,
    proNumber: null,
    chargesFuelSurcharge: null,
    chargesDetention: null,
    chargesLumper: null,
    chargesOther: null,
    chargesTotal: null,
    totalPay: null,
  };
}

/** Merge per-page extraction results into one, the way a multi-page
 *  document reads as a single document: in page order, the first
 *  page that prints a detail wins it, later pages only fill gaps.
 *  Pages the reader found nothing on contribute nothing. A locked
 *  result (the Gold gate) passes straight through. Null on no
 *  input. */
export function mergeExtractResults(results: LoadExtractResult[]): LoadExtractResult | null {
  if (results.length === 0) return null;
  const locked = results.find((r) => r.locked);
  if (locked) return locked;
  const foundPages = results.filter((r) => r.found);
  const out = emptyExtractResult();
  if (foundPages.length === 0) return out;
  out.found = true;
  const str = (get: (r: LoadExtractResult) => string | null): string | null => {
    for (const r of foundPages) {
      const v = get(r);
      if (v != null && v !== "") return v;
    }
    return null;
  };
  const num = (get: (r: LoadExtractResult) => number | null): number | null => {
    for (const r of foundPages) {
      const v = get(r);
      if (v != null) return v;
    }
    return null;
  };
  out.docKind = foundPages.find((r) => r.docKind != null)?.docKind ?? null;
  out.shipper = str((r) => r.shipper);
  out.brokerCompany = str((r) => r.brokerCompany);
  out.brokerName = str((r) => r.brokerName);
  out.brokerMc = str((r) => r.brokerMc);
  out.pickupCity = str((r) => r.pickupCity);
  out.pickupState = str((r) => r.pickupState);
  out.pickupAddress = str((r) => r.pickupAddress);
  out.deliveryCity = str((r) => r.deliveryCity);
  out.deliveryState = str((r) => r.deliveryState);
  out.deliveryAddress = str((r) => r.deliveryAddress);
  out.pickupText = str((r) => r.pickupText);
  out.deliveryText = str((r) => r.deliveryText);
  out.rate = num((r) => r.rate);
  out.miles = num((r) => r.miles);
  out.weightLbs = num((r) => r.weightLbs);
  out.commodity = str((r) => r.commodity);
  out.pieces = num((r) => r.pieces);
  out.sealNumber = str((r) => r.sealNumber);
  out.loadNumber = str((r) => r.loadNumber);
  out.poNumber = str((r) => r.poNumber);
  out.proNumber = str((r) => r.proNumber);
  out.chargesFuelSurcharge = num((r) => r.chargesFuelSurcharge);
  out.chargesDetention = num((r) => r.chargesDetention);
  out.chargesLumper = num((r) => r.chargesLumper);
  out.chargesOther = num((r) => r.chargesOther);
  out.chargesTotal = num((r) => r.chargesTotal);
  out.totalPay = num((r) => r.totalPay);
  return out;
}

/** Run the reader over rendered PDF pages in order and merge the
 *  results — the same calls a photo makes, once per page. Stops at
 *  the Gold gate: a locked page ends the run immediately (the gate
 *  answer cannot differ by page, and the driver shouldn't wait out
 *  the remaining renders' reads). A throwing reader propagates —
 *  the caller turns it into the plain couldn't-read message. */
export async function extractFromPdfPages(
  pages: PreparedPage[],
  extract: (page: PreparedPage) => Promise<LoadExtractResult>,
): Promise<{ status: "locked" } | { status: "done"; result: LoadExtractResult }> {
  let merged: LoadExtractResult | null = null;
  for (const page of pages) {
    const r = await extract(page);
    if (r.locked) return { status: "locked" };
    merged = mergeExtractResults(merged ? [merged, r] : [r]);
  }
  return { status: "done", result: merged ?? emptyExtractResult() };
}

export type RenderedPdfPages =
  | { ok: true; pages: PreparedPage[]; totalPages: number; readPages: number }
  | { ok: false; reason: "unreadable" | "blank" };

/** Render a PDF's planned pages to prepared document images.
 *  Contract: the caller has already size-checked the file against
 *  the document cap (fileBytesFitCap), as the photo path does.
 *  Never throws: an unparseable / password-protected / corrupt PDF
 *  comes back "unreadable"; a PDF whose planned pages all render
 *  blank comes back "blank". Pages that render blank are skipped,
 *  and a page whose image can't be prepared is skipped too — if
 *  that leaves nothing readable the result is "unreadable". */
export async function renderPdfPages(file: File): Promise<RenderedPdfPages> {
  try {
    // Make sure the SDK's pdf bundle has run: it places PDF.js's
    // worker handler on globalThis.pdfjsWorker, which is what lets
    // the library run its main-thread fallback with no worker file.
    // In the app this module is already loaded (PdfViewer); the
    // dynamic import just guarantees it from here too.
    await import("@hatch/space-sdk/pdf");
    // Standard (non-legacy) build (build fix, 2026-11-01): the
    // legacy bundle's webpack/core-js shims call the global
    // Function() constructor, which the artifact's closed-bundle
    // build rejects outright. The standard build of the same
    // 5.4.624 carries no such call and the app already requires a
    // modern webview (MapLibre GL), so nothing is lost.
    const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
    const data = new Uint8Array(await file.arrayBuffer());
    const loadingTask = pdfjs.getDocument({
      data,
      cMapUrl: PDFJS_CMAP_URL,
      cMapPacked: true,
      standardFontDataUrl: PDFJS_FONTS_URL,
      wasmUrl: PDFJS_WASM_URL,
      // Same posture as the SDK's viewer: PDF JavaScript never runs.
      isEvalSupported: false,
    });
    const doc = await loadingTask.promise;
    try {
      const plan = planPdfPages(doc.numPages);
      if (plan.pages.length === 0) return { ok: false, reason: "unreadable" };
      const pages: PreparedPage[] = [];
      let sawNonBlank = false;
      for (const pageNum of plan.pages) {
        const page = await doc.getPage(pageNum);
        try {
          const base = page.getViewport({ scale: 1 });
          const size = planPdfRenderSize(base.width, base.height);
          if (!(size.width > 0) || !(size.height > 0) || !(size.scale > 0)) continue;
          const viewport = page.getViewport({ scale: size.scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(viewport.width));
          canvas.height = Math.max(1, Math.round(viewport.height));
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await page.render({ canvas, canvasContext: ctx, viewport, background: "#ffffff" }).promise;
          // Blank check on a thumbnail probe before spending
          // anything on this page.
          const probe = document.createElement("canvas");
          probe.width = 16;
          probe.height = 16;
          const probeCtx = probe.getContext("2d");
          if (!probeCtx) continue;
          probeCtx.drawImage(canvas, 0, 0, 16, 16);
          const pixels = probeCtx.getImageData(0, 0, 16, 16).data;
          if (isBlankProbe(pixels)) continue;
          sawNonBlank = true;
          const prepared = await prepareCanvasDoc(canvas);
          if (prepared.ok) pages.push(prepared);
        } finally {
          page.cleanup();
        }
      }
      if (pages.length === 0) {
        return { ok: false, reason: sawNonBlank ? "unreadable" : "blank" };
      }
      return { ok: true, pages, totalPages: plan.totalPages, readPages: pages.length };
    } finally {
      await doc.destroy();
    }
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}
