// Unit tests for PDF document reading (pdfDoc.ts) — the 2026-11-01
// fix for "the PDF rate con attaches but never fills the form": the
// reader only handled JPG/PNG, so every emailed rate con hit the
// type-it-by-hand dead end. These tests pin the pure decisions the
// load flows depend on: which files route to the PDF reader, the
// page cap and render bounds, how per-page reads merge into one
// document read, that extraction runs once per page and stops at
// the Gold gate, and that an unreadable PDF resolves to the honest
// message path (attachment + typed draft preserved) instead of
// throwing or going silent. The DOM/PDF.js rendering itself is
// exercised the same way docImage's decode is — through its pure
// bounds — plus one never-throws failure test.
// Run: bun test client/src/pdfDoc.test.ts

import { describe, expect, test } from "bun:test";
import { DOC_IMAGE_MAX_EDGE, type PreparedDoc } from "./docImage";
import {
  PDF_MAX_PAGES,
  classifyDocFile,
  extractFromPdfPages,
  isBlankProbe,
  mergeExtractResults,
  pdfUnreadableMessage,
  planPdfPages,
  planPdfRenderSize,
  renderPdfPages,
  type LoadExtractResult,
  type PreparedPage,
} from "./pdfDoc";

function foundPage(over: Partial<LoadExtractResult> = {}): LoadExtractResult {
  return {
    locked: false,
    found: true,
    docKind: "rate_con",
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
    ...over,
  };
}

function notFoundPage(): LoadExtractResult {
  return { ...foundPage(), found: false, docKind: null };
}

function fakePreparedPage(): PreparedPage {
  const doc: PreparedDoc = { ok: true, dataBase64: "QUJD", mimeType: "image/jpeg", width: 10, height: 10, downscaled: false };
  if (!doc.ok) throw new Error("unreachable");
  return doc;
}

describe("classifyDocFile", () => {
  test("JPG/PNG route to the photo reader, as before", () => {
    expect(classifyDocFile("image/jpeg", "ratecon.jpg")).toBe("photo");
    expect(classifyDocFile("image/png", "bol.png")).toBe("photo");
  });

  test("PDFs route to the PDF reader", () => {
    expect(classifyDocFile("application/pdf", "ratecon.pdf")).toBe("pdf");
  });

  test("a PDF whose picker reported a generic type still routes by name", () => {
    expect(classifyDocFile("application/octet-stream", "Rate Con.PDF")).toBe("pdf");
    expect(classifyDocFile("", "ratecon.pdf")).toBe("pdf");
  });

  test("anything else attaches unread, as before", () => {
    expect(classifyDocFile("image/heic", "photo.heic")).toBe("file");
    expect(classifyDocFile("text/plain", "notes.txt")).toBe("file");
    expect(classifyDocFile("application/octet-stream", "scan.bin")).toBe("file");
  });
});

describe("planPdfPages", () => {
  test("short documents plan every page", () => {
    expect(planPdfPages(1)).toEqual({ pages: [1], totalPages: 1, truncated: false });
    expect(planPdfPages(3)).toEqual({ pages: [1, 2, 3], totalPages: 3, truncated: false });
    expect(planPdfPages(PDF_MAX_PAGES).truncated).toBe(false);
  });

  test("long documents cap at PDF_MAX_PAGES and say so", () => {
    const plan = planPdfPages(27);
    expect(plan.pages).toEqual([1, 2, 3, 4]);
    expect(plan.totalPages).toBe(27);
    expect(plan.truncated).toBe(true);
  });

  test("a document reporting no pages plans nothing (unreadable upstream)", () => {
    expect(planPdfPages(0).pages).toEqual([]);
    expect(planPdfPages(-2).pages).toEqual([]);
    expect(planPdfPages(Number.NaN).pages).toEqual([]);
  });
});

describe("planPdfRenderSize", () => {
  test("a letter page renders at 2x points, under the doc cap", () => {
    const s = planPdfRenderSize(612, 792);
    expect(s).toEqual({ width: 1224, height: 1584, scale: 2 });
  });

  test("an oversize page is capped on the long edge, aspect kept", () => {
    const s = planPdfRenderSize(2000, 1000);
    expect(s.width).toBe(DOC_IMAGE_MAX_EDGE);
    expect(s.height).toBe(1024);
    expect(s.scale).toBeCloseTo(DOC_IMAGE_MAX_EDGE / 2000);
  });

  test("degenerate page sizes plan to zero instead of NaN", () => {
    expect(planPdfRenderSize(0, 792)).toEqual({ width: 0, height: 0, scale: 0 });
    expect(planPdfRenderSize(612, Number.NaN).height).toBe(0);
  });
});

describe("isBlankProbe", () => {
  test("all near-white pixels are blank", () => {
    expect(isBlankProbe(new Uint8ClampedArray(16 * 16 * 4).fill(255))).toBe(true);
    expect(isBlankProbe([])).toBe(true);
  });

  test("any real ink makes it not blank", () => {
    const px = new Uint8ClampedArray(16 * 16 * 4).fill(255);
    px[40] = 30; // one dark red channel in one pixel
    expect(isBlankProbe(px)).toBe(false);
  });
});

describe("mergeExtractResults", () => {
  test("no input merges to null", () => {
    expect(mergeExtractResults([])).toBeNull();
  });

  test("a single found page passes its fields through", () => {
    const merged = mergeExtractResults([foundPage({ shipper: "Acme Farms", rate: 2400 })]);
    expect(merged?.found).toBe(true);
    expect(merged?.shipper).toBe("Acme Farms");
    expect(merged?.rate).toBe(2400);
    expect(merged?.docKind).toBe("rate_con");
  });

  test("later pages fill gaps; the first page that prints a detail wins it", () => {
    const merged = mergeExtractResults([
      foundPage({ shipper: "Acme Farms", pickupCity: "Dothan" }),
      foundPage({ shipper: "Should Not Win", rate: 2500, deliveryCity: "Mobile", chargesTotal: 150 }),
    ]);
    expect(merged?.shipper).toBe("Acme Farms");
    expect(merged?.pickupCity).toBe("Dothan");
    expect(merged?.rate).toBe(2500);
    expect(merged?.deliveryCity).toBe("Mobile");
    expect(merged?.chargesTotal).toBe(150);
  });

  test("pages with nothing found contribute nothing", () => {
    const stray = { ...notFoundPage(), shipper: "Ghost Shipper", rate: 9999 };
    const merged = mergeExtractResults([stray, foundPage({ shipper: "Real Shipper" })]);
    expect(merged?.shipper).toBe("Real Shipper");
    expect(merged?.rate).toBeNull();
  });

  test("when no page finds anything the merge is an honest not-found", () => {
    const merged = mergeExtractResults([notFoundPage(), notFoundPage()]);
    expect(merged?.found).toBe(false);
    expect(merged?.docKind).toBeNull();
    expect(merged?.shipper).toBeNull();
  });

  test("empty strings do not win over a later page's real value", () => {
    const merged = mergeExtractResults([
      foundPage({ brokerCompany: "" }),
      foundPage({ brokerCompany: "Granted Enterprise" }),
    ]);
    expect(merged?.brokerCompany).toBe("Granted Enterprise");
  });

  test("a locked result passes straight through", () => {
    const locked = { ...foundPage(), locked: true, found: false };
    expect(mergeExtractResults([foundPage({ shipper: "X" }), locked])?.locked).toBe(true);
  });
});

describe("extractFromPdfPages", () => {
  test("invokes extraction once per page, in order, and merges", async () => {
    const pages = [fakePreparedPage(), fakePreparedPage(), fakePreparedPage()];
    const seen: string[] = [];
    const outcome = await extractFromPdfPages(pages, async (page) => {
      seen.push(page.dataBase64);
      return seen.length === 1 ? foundPage({ shipper: "Acme Farms" }) : foundPage({ rate: 2500 });
    });
    expect(seen.length).toBe(3);
    expect(outcome.status).toBe("done");
    if (outcome.status === "done") {
      expect(outcome.result.shipper).toBe("Acme Farms");
      expect(outcome.result.rate).toBe(2500);
    }
  });

  test("stops at the Gold gate without reading the remaining pages", async () => {
    const pages = [fakePreparedPage(), fakePreparedPage(), fakePreparedPage()];
    let calls = 0;
    const outcome = await extractFromPdfPages(pages, async () => {
      calls += 1;
      return { ...foundPage(), locked: true, found: false };
    });
    expect(outcome.status).toBe("locked");
    expect(calls).toBe(1);
  });

  test("a throwing reader propagates so the caller can show the message", async () => {
    await expect(
      extractFromPdfPages([fakePreparedPage()], async () => {
        throw new Error("reader down");
      }),
    ).rejects.toThrow("reader down");
  });
});

describe("unreadable PDF path", () => {
  test("the message keeps the attachment and the typed draft, in both forms' words", () => {
    const solo = pdfUnreadableMessage(false);
    expect(solo).toContain("still attached");
    expect(solo).toContain("seals with the load as proof");
    expect(solo).toContain("everything you've typed is still here");
    const board = pdfUnreadableMessage(true);
    expect(board).toContain("still attached");
    expect(board).toContain("posts with the load");
    expect(board).toContain("everything you've typed is still here");
  });

  test("renderPdfPages never throws on garbage — it resolves unreadable", async () => {
    const junk = new File([new Uint8Array([1, 2, 3, 4, 5])], "ratecon.pdf", { type: "application/pdf" });
    const out = await renderPdfPages(junk);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("unreadable");
  });
});
