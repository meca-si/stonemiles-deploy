// Unit tests for document-photo preparation (docImage.ts) — the
// downscale + cap logic behind the 2026-11-01 fix: "I upload, it
// blinks, then disappears." handleLoadFile used to base64 the
// FULL-RES phone photo untouched; these tests pin the bounds that
// keep the encoded document small enough for the webview's memory
// and under the server's 14,000,000-char dataBase64 cap, plus the
// explicit too-large path that replaced the silent failure.
// Run: bun test client/src/docImage.test.ts

import { describe, expect, test } from "bun:test";
import {
  DOC_BASE64_MAX,
  DOC_IMAGE_MAX_EDGE,
  base64FitsCap,
  base64LengthForBytes,
  docTooLargeMessage,
  fileBytesFitCap,
  finalizeImageBase64,
  maxRawBytesForCap,
  planDownscale,
} from "./docImage";

describe("planDownscale", () => {
  test("a full-res phone photo (4032×3024) caps the long edge at 2048, aspect kept", () => {
    const p = planDownscale(4032, 3024);
    expect(p.scaled).toBe(true);
    expect(p.width).toBe(2048);
    expect(p.height).toBe(1536);
    expect(Math.max(p.width, p.height)).toBeLessThanOrEqual(DOC_IMAGE_MAX_EDGE);
  });

  test("a 48MP shot (8000×6000) still lands on the cap", () => {
    const p = planDownscale(8000, 6000);
    expect(p).toEqual({ width: 2048, height: 1536, scaled: true });
  });

  test("portrait pages cap on height", () => {
    const p = planDownscale(3024, 4032);
    expect(p).toEqual({ width: 1536, height: 2048, scaled: true });
  });

  test("an already-small screenshot is never upscaled or touched", () => {
    expect(planDownscale(1170, 2532)).toEqual({ width: 946, height: 2048, scaled: true });
    expect(planDownscale(1000, 800)).toEqual({ width: 1000, height: 800, scaled: false });
    expect(planDownscale(2048, 2048)).toEqual({ width: 2048, height: 2048, scaled: false });
  });

  test("degenerate dimensions pass through for the decoder to reject loudly", () => {
    expect(planDownscale(0, 1200).scaled).toBe(false);
    expect(planDownscale(-5, 100).scaled).toBe(false);
  });
});

describe("base64 cap math", () => {
  test("base64 length is 4 chars per 3 bytes, padded", () => {
    expect(base64LengthForBytes(0)).toBe(0);
    expect(base64LengthForBytes(1)).toBe(4);
    expect(base64LengthForBytes(3)).toBe(4);
    expect(base64LengthForBytes(4)).toBe(8);
    expect(base64LengthForBytes(300)).toBe(400);
  });

  test("the cap boundary is exact: 10,500,000 raw bytes fit, one more doesn't", () => {
    expect(maxRawBytesForCap()).toBe(10_500_000);
    expect(base64LengthForBytes(maxRawBytesForCap())).toBe(DOC_BASE64_MAX);
    expect(fileBytesFitCap(maxRawBytesForCap())).toBe(true);
    expect(fileBytesFitCap(maxRawBytesForCap() + 1)).toBe(false);
  });

  test("a typical phone JPEG fits; a full-res PNG screenshot of a photo may not", () => {
    expect(fileBytesFitCap(4_500_000)).toBe(true); // ~4.5 MB camera JPEG
    expect(fileBytesFitCap(18_000_000)).toBe(false); // ~18 MB — refused before the read
  });

  test("base64FitsCap measures the string itself", () => {
    expect(base64FitsCap("A".repeat(DOC_BASE64_MAX))).toBe(true);
    expect(base64FitsCap("A".repeat(DOC_BASE64_MAX + 1))).toBe(false);
  });
});

describe("finalizeImageBase64 — the too-large gate", () => {
  test("an in-cap encoding comes back ready with its dimensions", () => {
    const out = finalizeImageBase64("aGVsbG8=", { width: 2048, height: 1536 }, true);
    expect(out).toEqual({
      ok: true,
      dataBase64: "aGVsbG8=",
      mimeType: "image/jpeg",
      width: 2048,
      height: 1536,
      downscaled: true,
    });
  });

  test("an encoding still over the cap after downscaling is refused as too_large — never handed to the form", () => {
    const huge = "A".repeat(DOC_BASE64_MAX + 4);
    const out = finalizeImageBase64(huge, { width: 2048, height: 1536 }, true);
    expect(out).toEqual({ ok: false, reason: "too_large" });
  });

  test("a large synthetic image's downscale plan keeps its encoded size in range", () => {
    // A 48MP synthetic frame downscales to 2048×1536; even a noisy
    // worst-case JPEG at that size stays far below the raw-byte cap
    // the string is gated against — the plan is what guarantees it.
    const plan = planDownscale(8000, 6000);
    expect(plan.width * plan.height).toBeLessThanOrEqual(2048 * 1536);
    // 2048×1536 at even 3 bytes/pixel raw would still fit the cap.
    expect(fileBytesFitCap(plan.width * plan.height * 3)).toBe(true);
  });
});

describe("docTooLargeMessage — the explicit message", () => {
  test("names the problem and the fix, in plain words", () => {
    for (const kind of ["photo", "file"] as const) {
      const msg = docTooLargeMessage(kind);
      expect(msg).toContain("too large");
      expect(msg).toContain("try a screenshot or a smaller copy");
      expect(msg).toContain("nothing was lost");
    }
  });
});
