import { describe, expect, test } from "bun:test";
import { buildPdf, wrapPdfText } from "./pdfDoc";

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
});
