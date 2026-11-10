// qrCode.test.ts — pins the QR encoder against independently known
// values: level-M block structure totals, the BCH format-information
// constants published in every QR tutorial, the hand-computable data
// codewords for a one-byte payload, and the matrix's function-pattern
// geometry. (A scanner round-trip isn't available in the test env;
// these constants are the strongest offline checks.)

import { describe, expect, test } from "bun:test";
import { dataCapacityM, encodeDataCodewords, encodeQr, formatBits } from "./qrCode";

describe("qr encoder", () => {
  test("level-M capacities match the standard total-codeword counts", () => {
    // data + ec must equal each version's total modules-derived codewords.
    const totals: Record<number, number> = { 1: 26, 2: 44, 3: 70, 4: 100, 5: 134, 6: 172 };
    const ecPerBlock: Record<number, number> = { 1: 10, 2: 16, 3: 26, 4: 18, 5: 24, 6: 16 };
    const blockCounts: Record<number, number> = { 1: 1, 2: 1, 3: 1, 4: 2, 5: 2, 6: 4 };
    for (let v = 1; v <= 6; v++) {
      expect(dataCapacityM(v) + ecPerBlock[v]! * blockCounts[v]!).toBe(totals[v]!);
    }
  });

  test("format information BCH matches the published constants", () => {
    // (L, mask 0) = 111011111000100 and (M, mask 0) = 101010000010010
    // appear in the QR specification's format table and every tutorial.
    expect(formatBits(0b01, 0).toString(2).padStart(15, "0")).toBe("111011111000100");
    expect(formatBits(0b00, 0).toString(2).padStart(15, "0")).toBe("101010000010010");
    // All 32 (level, mask) values are distinct 15-bit strings.
    const seen = new Set<string>();
    for (const lvl of [0b00, 0b01, 0b10, 0b11])
      for (let mask = 0; mask < 8; mask++) seen.add(formatBits(lvl, mask).toString(2).padStart(15, "0"));
    expect(seen.size).toBe(32);
  });

  test("data codewords for 'A' at version 1-M are the hand-computed bytes", () => {
    // Byte mode: 0100 | count 00000001 | 'A' 01000001 | terminator 0000
    // -> 0x40 0x14 0x10, then alternating 0xEC 0x11 pads to 16 codewords.
    const cw = encodeDataCodewords(new TextEncoder().encode("A"), 1);
    expect(cw.length).toBe(16);
    expect(cw.slice(0, 3)).toEqual([0x40, 0x14, 0x10]);
    expect(cw.slice(3)).toEqual([0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec]);
  });

  test("matrix geometry: size, finders, timing, dark module", () => {
    const qr = encodeQr("https://app.stonervision.io/receive/rcv_0123456789abcdef0123456789abcdef");
    expect(qr.size).toBe(qr.version * 4 + 17);
    const m = qr.modules;
    // Finder corners: dark centers + rings.
    expect(m[0]![0]).toBe(true);
    expect(m[0]![6]).toBe(true);
    expect(m[1]![1]).toBe(false); // finder inner light ring
    expect(m[3]![3]).toBe(true); // finder core
    expect(m[0]![qr.size - 1]).toBe(true);
    expect(m[qr.size - 1]![0]).toBe(true);
    // Timing: alternating, dark on even indices.
    expect(m[6]![8]).toBe(true);
    expect(m[6]![9]).toBe(false);
    expect(m[8]![6]).toBe(true);
    expect(m[9]![6]).toBe(false);
    // Dark module.
    expect(m[qr.size - 8]![8]).toBe(true);
    // Deterministic: same input, same matrix.
    const again = encodeQr("https://app.stonervision.io/receive/rcv_0123456789abcdef0123456789abcdef");
    expect(JSON.stringify(again.modules)).toBe(JSON.stringify(m));
  });

  test("small inputs take version 1; the receive URL fits version 6-M", () => {
    expect(encodeQr("A").version).toBe(1);
    expect(encodeQr("x".repeat(106)).version).toBe(6);
    expect(() => encodeQr("x".repeat(107))).toThrow();
  });
});
