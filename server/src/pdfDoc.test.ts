import { describe, expect, test } from "bun:test";
import { buildPdf, jpegDimensions, wrapPdfText } from "./pdfDoc";
import { encodeQr } from "./qrCode";

const dec = (b: Uint8Array) => new TextDecoder().decode(b);

describe("wrapPdfText", () => {
  test("wraps on word boundaries within the budget", () => {
    const lines = wrapPdfText("alpha bravo charlie delta echo foxtrot", 12);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(12);
    expect(lines.join(" ")).toBe("alpha bravo charlie delta echo foxtrot");
  });
  test("hard-splits a token longer than the budget", () => {
    const lines = wrapPdfText("x".repeat(30), 10);
    expect(lines).toEqual(["xxxxxxxxxx", "xxxxxxxxxx", "xxxxxxxxxx"]);
  });
  test("blank input lines stay blank", () => {
    expect(wrapPdfText("a\n\nb", 10)).toEqual(["a", "", "b"]);
  });
});

describe("buildPdf", () => {
  const doc = buildPdf({
    title: "IFTA Q3 2026 - state lines",
    subtitle: "STONEMILES library document",
    sections: [
      { heading: "State lines", lines: ["AL  Miles 1,240.5  Fuel bought 180.25 gal", "TN  Miles 310.0  Fuel bought 0.00 gal"] },
      { heading: "Totals", lines: ["Total miles: 1,550.5"] },
    ],
    footer: "STONEMILES - sealed records",
  });
  const text = dec(doc);

  test("is a well-formed PDF shell", () => {
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("/MediaBox [0 0 612 792]");
    expect(text).toContain("/BaseFont /Helvetica");
  });

  test("carries the document text, escaped", () => {
    expect(text).toContain("(IFTA Q3 2026 - state lines)");
    expect(text).toContain("(State lines)");
    expect(text).toContain("Total miles: 1,550.5");
    const tricky = dec(buildPdf({ title: "Cost (final) \\ draft", sections: [{ lines: ["x"] }], footer: "f" }));
    expect(tricky).toContain("(Cost \\(final\\) \\\\ draft)");
  });

  test("xref offsets point at their objects", () => {
    const startxref = Number(text.match(/startxref\n(\d+)/)?.[1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    const objAt = text.indexOf("1 0 obj");
    const firstEntry = text.slice(startxref).match(/\n(\d{10}) 00000 n /)?.[1];
    expect(Number(firstEntry)).toBe(objAt);
  });

  test("long documents paginate with page numbers", () => {
    const many = Array.from({ length: 220 }, (_, i) => `Line ${i + 1} of the record`);
    const big = dec(buildPdf({ title: "Long record", sections: [{ lines: many }], footer: "f" }));
    const pageCount = (big.match(/\/Type \/Page /g) ?? []).length;
    expect(pageCount).toBeGreaterThanOrEqual(3);
    expect(big).toContain(`(Page ${pageCount} of ${pageCount})`);
  });

  test("is deterministic — same input, same bytes", () => {
    const a = buildPdf({ title: "T", sections: [{ lines: ["one", "two"] }], footer: "f" });
    const b = buildPdf({ title: "T", sections: [{ lines: ["one", "two"] }], footer: "f" });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  test("QR block draws filled module rects in the content stream", () => {
    const qr = encodeQr("https://app.stonervision.io/receive/rcv_0123456789abcdef0123456789abcdef");
    const pdf = dec(buildPdf({ title: "BOL", sections: [{ lines: ["scan to confirm"] }], footer: "f", qr }));
    expect(pdf).toContain(" re f"); // the QR band's filled rects
    const dark = qr.modules.flat().filter(Boolean).length;
    const rectCount = (pdf.match(/ re/g) ?? []).length;
    expect(rectCount).toBeGreaterThan(dark); // one bg rect + merged dark rects
  });

  test("JPEG dimensions parse from the SOF marker; image embeds raw via DCTDecode", () => {
    // Synthetic JPEG framing: SOI + APP0 + SOF0 (height 200, width 600).
    const jpg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0),
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xc8, 0x02, 0x58, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
      0xff, 0xd9,
    ]);
    expect(jpegDimensions(jpg)).toEqual({ width: 600, height: 200 });
    expect(jpegDimensions(new Uint8Array([1, 2, 3]))).toBeNull();
    const pdfBytes = buildPdf({
      title: "Signed POD",
      sections: [{ lines: ["signature below"] }],
      footer: "f",
      image: { jpegBytes: jpg, widthPt: 240, heightPt: 80 },
    });
    const pdf = dec(pdfBytes);
    expect(pdf).toContain("/DCTDecode");
    expect(pdf).toContain("/Width 600 /Height 200");
    expect(pdf).toContain("/Im1");
    // The raw JPEG bytes ride verbatim in the stream.
    const buf = Buffer.from(pdfBytes);
    const soi = buf.indexOf(Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    expect(soi).toBeGreaterThan(0);
    expect(buf.indexOf(Buffer.from([0xff, 0xd9]))).toBeGreaterThan(soi);
  });
});
