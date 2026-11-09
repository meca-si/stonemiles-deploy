import { describe, expect, test } from "bun:test";
import {
  b64urlDecode,
  b64urlEncode,
  biometricOffer,
  parseStoredCredentialId,
} from "./biometric";

/**
 * BIOMETRIC UNLOCK pure helpers (round 2). The WebAuthn calls
 * themselves need a real device authenticator and are not unit
 * tested; what IS tested is every decision around them: what counts
 * as an enrollment, when the biometric button is offered, and the
 * base64url coding the credential id round-trips through. The
 * standing rule these encode: biometrics are offered ONLY where the
 * platform supports them and the device enrolled — and the PIN path
 * exists regardless (covered by the lock/sign-in surfaces, which
 * render the PIN field unconditionally when a PIN is set).
 */

describe("stored credential id parsing", () => {
  test("a base64url credential id parses", () => {
    expect(parseStoredCredentialId("Ab3dEf6-HijKlMn_OpQrStUv")).toBe("Ab3dEf6-HijKlMn_OpQrStUv");
  });

  test("empty, missing, and junk values mean no enrollment", () => {
    expect(parseStoredCredentialId(null)).toBeNull();
    expect(parseStoredCredentialId("")).toBeNull();
    expect(parseStoredCredentialId("   ")).toBeNull();
    expect(parseStoredCredentialId("short")).toBeNull();
    expect(parseStoredCredentialId("has spaces in it........")).toBeNull();
    expect(parseStoredCredentialId("plus+and/slash=")).toBeNull();
  });

  test("surrounding whitespace is trimmed", () => {
    expect(parseStoredCredentialId("  Ab3dEf6-HijKlMn_OpQrStUv  ")).toBe("Ab3dEf6-HijKlMn_OpQrStUv");
  });
});

describe("the biometric offer", () => {
  test("offered only when the platform supports it AND the device enrolled", () => {
    expect(biometricOffer({ platformAvailable: true, enrolled: true })).toBe(true);
    expect(biometricOffer({ platformAvailable: true, enrolled: false })).toBe(false);
    expect(biometricOffer({ platformAvailable: false, enrolled: true })).toBe(false);
    expect(biometricOffer({ platformAvailable: false, enrolled: false })).toBe(false);
  });
});

describe("base64url round-trip", () => {
  test("bytes survive encode → decode, including url-unsafe values", () => {
    const bytes = new Uint8Array([0, 1, 62, 63, 250, 251, 252, 253, 254, 255, 10, 200]);
    const encoded = b64urlEncode(bytes);
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
    expect(Array.from(b64urlDecode(encoded))).toEqual(Array.from(bytes));
  });

  test("empty input round-trips", () => {
    expect(b64urlEncode(new Uint8Array([]))).toBe("");
    expect(b64urlDecode("").length).toBe(0);
  });
});
