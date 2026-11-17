// uploadArmor.test.ts — the SENTRY upload armor against crafted
// byte headers: real documents/photos pass with their sniffed
// type; executables, scripts, markup, and archives are refused
// whatever they claim to be; strict mode (public doors) also
// refuses a type that doesn't match the claim, while guard mode
// (signed-in flows) lets the claim stand on safe bytes.

import { describe, expect, test } from "bun:test";
import { assessUpload, sniffUpload } from "./uploadArmor";

const enc = (s: string) => new TextEncoder().encode(s);
const bytes = (...parts: (number[] | Uint8Array)[]) => {
  const out: number[] = [];
  for (const p of parts) out.push(...p);
  return new Uint8Array(out);
};

// Crafted headers — just enough of each format's real signature.
const PDF = enc("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF");
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], enc("JFIF\0"), [0x00, 0x01]);
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0, 0, 0, 13], enc("IHDR"));
const WEBP = bytes(enc("RIFF"), [0x24, 0, 0, 0], enc("WEBPVP8 "));
const GIF = enc("GIF89a");
const HEIC = bytes([0, 0, 0, 24], enc("ftypheic"), [0, 0, 0, 0]);
const MP4 = bytes([0, 0, 0, 24], enc("ftypisom"), [0, 0, 0, 0]);
const MOV = bytes([0, 0, 0, 20], enc("ftypqt  "), [0, 0, 0, 0]);
const WEBM = bytes([0x1a, 0x45, 0xdf, 0xa3], [0x93, 0x42, 0x82, 0x88]);
const MZ_EXE = bytes([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00], enc("This program cannot be run in DOS mode"));
const ELF = bytes([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
const MACHO = bytes([0xfe, 0xed, 0xfa, 0xcf, 0x01, 0x00, 0x00, 0x0c]);
const SHEBANG = enc("#!/bin/sh\nrm -rf /\n");
const HTML = enc("<!DOCTYPE html><html><script>alert(1)</script></html>");
const SVG = enc("<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'></svg>");
const ZIP = bytes([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
const TEXT = enc("just some plain text someone typed");

describe("sniffUpload", () => {
  test("recognizes the document and photo formats", () => {
    expect(sniffUpload(PDF)).toEqual({ kind: "pdf", mime: "application/pdf", dangerous: false });
    expect(sniffUpload(JPEG).kind).toBe("jpeg");
    expect(sniffUpload(PNG).kind).toBe("png");
    expect(sniffUpload(WEBP).kind).toBe("webp");
    expect(sniffUpload(GIF).kind).toBe("gif");
    expect(sniffUpload(HEIC).kind).toBe("heic");
    expect(sniffUpload(MP4).kind).toBe("mp4");
    expect(sniffUpload(MOV).kind).toBe("quicktime");
    expect(sniffUpload(WEBM).kind).toBe("webm");
  });

  test("flags programs, scripts, markup, and archives as dangerous", () => {
    expect(sniffUpload(MZ_EXE)).toMatchObject({ kind: "executable", dangerous: true });
    expect(sniffUpload(ELF)).toMatchObject({ kind: "executable", dangerous: true });
    expect(sniffUpload(MACHO)).toMatchObject({ kind: "executable", dangerous: true });
    expect(sniffUpload(SHEBANG)).toMatchObject({ kind: "script", dangerous: true });
    expect(sniffUpload(HTML)).toMatchObject({ kind: "markup", dangerous: true });
    expect(sniffUpload(SVG)).toMatchObject({ kind: "markup", dangerous: true });
    expect(sniffUpload(ZIP)).toMatchObject({ kind: "zip", dangerous: true });
    // Markup hiding behind a BOM and blank lines is still markup.
    const sneaky = bytes([0xef, 0xbb, 0xbf, 0x0a, 0x20], enc("<html><body>x</body></html>"));
    expect(sniffUpload(sneaky)).toMatchObject({ kind: "markup", dangerous: true });
  });

  test("unknown bytes are unknown, not dangerous", () => {
    expect(sniffUpload(TEXT)).toEqual({ kind: "unknown", mime: null, dangerous: false });
    expect(sniffUpload(new Uint8Array(0)).kind).toBe("unknown");
  });
});

describe("assessUpload — strict mode (public doors)", () => {
  test("matching real files pass with the sniffed mime", () => {
    expect(assessUpload(PDF, "application/pdf", { mode: "strict" })).toEqual({ ok: true, mime: "application/pdf", kind: "pdf" });
    expect(assessUpload(JPEG, "image/jpeg", { mode: "strict" }).ok).toBe(true);
    expect(assessUpload(PNG, "image/png", { mode: "strict" }).ok).toBe(true);
    // HEIC/HEIF labels are interchangeable for the same bytes.
    expect(assessUpload(HEIC, "image/heif", { mode: "strict" })).toEqual({ ok: true, mime: "image/heic", kind: "heic" });
    expect(assessUpload(MP4, "video/mp4", { mode: "strict", allowedMimes: ["video/mp4", "video/webm", "video/quicktime", "video/x-m4v"] }).ok).toBe(true);
  });

  test("a disguised executable is refused under any claim", () => {
    for (const claim of ["application/pdf", "image/jpeg", "image/png"]) {
      const r = assessUpload(MZ_EXE, claim, { mode: "strict" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain("program, script, or archive");
    }
    expect(assessUpload(ELF, "application/pdf", { mode: "strict" }).ok).toBe(false);
    expect(assessUpload(SHEBANG, "image/png", { mode: "strict" }).ok).toBe(false);
    expect(assessUpload(HTML, "application/pdf", { mode: "strict" }).ok).toBe(false);
    expect(assessUpload(SVG, "image/png", { mode: "strict" }).ok).toBe(false);
    expect(assessUpload(ZIP, "application/pdf", { mode: "strict" }).ok).toBe(false);
  });

  test("a type that doesn't match the claim is refused", () => {
    const r = assessUpload(PDF, "image/png", { mode: "strict" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("doesn't match");
    expect(assessUpload(JPEG, "application/pdf", { mode: "strict" }).ok).toBe(false);
    // A real photo outside the caller's allowlist is refused too.
    expect(
      assessUpload(WEBP, "image/webp", { mode: "strict", allowedMimes: ["application/pdf", "image/jpeg", "image/png"] }).ok,
    ).toBe(false);
  });

  test("unverifiable bytes are refused", () => {
    const r = assessUpload(TEXT, "application/pdf", { mode: "strict" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("couldn't be verified");
  });
});

describe("assessUpload — guard mode (signed-in flows)", () => {
  test("dangerous bytes are refused here too", () => {
    expect(assessUpload(MZ_EXE, "image/jpeg", { mode: "guard" }).ok).toBe(false);
    expect(assessUpload(ZIP, "application/pdf", { mode: "guard" }).ok).toBe(false);
    expect(assessUpload(HTML, "image/png", { mode: "guard" }).ok).toBe(false);
  });

  test("safe bytes keep the caller's claimed type — even a loose one", () => {
    // The app's own paperwork fixtures file placeholder bytes
    // under an image type; guard mode is deliberately only about
    // malware, not about policing that claim.
    expect(assessUpload(TEXT, "image/jpeg", { mode: "guard" })).toEqual({ ok: true, mime: "image/jpeg", kind: "unknown" });
    expect(assessUpload(PDF, "application/pdf", { mode: "guard" }).ok).toBe(true);
  });
});
