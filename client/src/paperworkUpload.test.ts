// paperworkUpload plan tests — the pure decision half of the
// intake fix (2026-11-25): which picked files go as-is, which get
// converted to JPEG in the browser, and which are refused with
// plain words instead of failing silently.
import { describe, expect, test } from "bun:test";
import { PAPERWORK_DIRECT_MAX_BYTES, paperworkUploadPlan } from "./paperworkUpload";

const MB = 1_000_000;

describe("paperworkUploadPlan", () => {
  test("a phone-sized JPG, PNG, or PDF goes as picked", () => {
    expect(paperworkUploadPlan({ type: "image/jpeg", size: 3 * MB }).kind).toBe("direct");
    expect(paperworkUploadPlan({ type: "image/png", size: 2 * MB }).kind).toBe("direct");
    expect(paperworkUploadPlan({ type: "application/pdf", size: 4 * MB }).kind).toBe("direct");
  });

  test("an iPhone HEIC photo takes the convert path instead of being refused", () => {
    expect(paperworkUploadPlan({ type: "image/heic", size: 3 * MB }).kind).toBe("convert-image");
    expect(paperworkUploadPlan({ type: "image/heif", size: 3 * MB }).kind).toBe("convert-image");
    expect(paperworkUploadPlan({ type: "image/webp", size: 1 * MB }).kind).toBe("convert-image");
    // A photo the picker hands over with no type at all still gets a chance.
    expect(paperworkUploadPlan({ type: "", size: 3 * MB }).kind).toBe("convert-image");
  });

  test("an oversized JPG/PNG shrinks through the convert path; an oversized PDF is refused plainly", () => {
    expect(paperworkUploadPlan({ type: "image/jpeg", size: PAPERWORK_DIRECT_MAX_BYTES + 1 }).kind).toBe("convert-image");
    const pdf = paperworkUploadPlan({ type: "application/pdf", size: PAPERWORK_DIRECT_MAX_BYTES + 1 });
    expect(pdf.kind).toBe("too-large");
    if (pdf.kind === "too-large") expect(pdf.message).toContain("too large");
  });

  test("a non-document file is refused with the usable types named", () => {
    const plan = paperworkUploadPlan({ type: "text/plain", size: 100 });
    expect(plan.kind).toBe("unsupported");
    if (plan.kind === "unsupported") {
      expect(plan.message).toContain("JPG");
      expect(plan.message).toContain("PDF");
    }
    expect(paperworkUploadPlan({ type: "application/zip", size: 100 }).kind).toBe("unsupported");
  });

  test("type matching is case-insensitive and trims picker noise", () => {
    expect(paperworkUploadPlan({ type: " Image/JPEG ", size: 1 * MB }).kind).toBe("direct");
    expect(paperworkUploadPlan({ type: "APPLICATION/PDF", size: 1 * MB }).kind).toBe("direct");
  });
});
