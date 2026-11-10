// qrCode.ts — a compact QR Code encoder (ISO/IEC 18004) covering what
// the receive link needs: BYTE mode, error-correction level M,
// versions 1–6 (up to 106 payload bytes — a receive URL is ~75).
// Everything is computed from the spec's algorithms — GF(256)
// Reed–Solomon over the primitive polynomial 0x11d, BCH format
// information, the standard mask patterns and penalty rules — the
// only constants are the level-M block structure and alignment
// centers, which are cross-checked against each version's total
// codeword count in the tests.
//
// Used to print the per-load receive link as a QR on the BOL PDF.
// Deliberately dependency-free, like the PDF writer.

export interface QrCode {
  version: number;
  size: number;
  /** modules[row][col], true = dark. NO quiet zone — renderers add it. */
  modules: boolean[][];
}

// Level M block structure: [ecCodewordsPerBlock, [[blockCount, dataCodewordsPerBlock], ...]]
const BLOCKS_M: Record<number, [number, [number, number][]]> = {
  1: [10, [[1, 16]]],
  2: [16, [[1, 28]]],
  3: [26, [[1, 44]]],
  4: [18, [[2, 32]]],
  5: [24, [[2, 43]]],
  6: [16, [[4, 27]]],
};
const TOTAL_CODEWORDS: Record<number, number> = { 1: 26, 2: 44, 3: 70, 4: 100, 5: 134, 6: 172 };
const REMAINDER_BITS: Record<number, number> = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7 };
const ALIGNMENT_CENTERS: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
};

export function dataCapacityM(version: number): number {
  const [, groups] = BLOCKS_M[version]!;
  return groups.reduce((s, [count, per]) => s + count * per, 0);
}

// --- GF(256) ---------------------------------------------------------------
const GF_EXP = new Array<number>(512);
const GF_LOG = new Array<number>(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]!;
}
function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!;
}

/** Reed–Solomon generator polynomial coefficients for `degree` (highest degree first, leading 1 omitted in use). */
export function rsGeneratorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] = (next[j] ?? 0) ^ gfMul(poly[j]!, GF_EXP[i]!); // (x - α^i) == (x + α^i) in GF(2)
      next[j + 1] = (next[j + 1] ?? 0) ^ poly[j]!;
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data: number[], degree: number): number[] {
  const gen = rsGeneratorPoly(degree);
  const res = new Array<number>(degree).fill(0);
  for (const b of data) {
    const factor = b ^ res.shift()!;
    res.push(0);
    for (let i = 0; i < degree; i++) res[i] = (res[i] ?? 0) ^ gfMul(gen[i + 1]!, factor);
  }
  return res;
}

// --- data bitstream ----------------------------------------------------------
/** The padded data codewords for `bytes` at `version` (before block split/ECC). Exported for tests. */
export function encodeDataCodewords(bytes: Uint8Array, version: number): number[] {
  const capacity = dataCapacityM(version);
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, 8); // count (versions 1–9: 8 bits in byte mode)
  for (const b of bytes) push(b, 8);
  const capBits = capacity * 8;
  push(0, Math.min(4, capBits - bits.length)); // terminator
  while (bits.length % 8 !== 0) bits.push(0);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]!;
    out.push(v);
  }
  for (let pad = 0xec; out.length < capacity; pad = pad === 0xec ? 0x11 : 0xec) out.push(pad);
  return out;
}

function interleaveWithEcc(data: number[], version: number): number[] {
  const [ecPerBlock, groups] = BLOCKS_M[version]!;
  const blocks: number[][] = [];
  const eccs: number[][] = [];
  let offset = 0;
  for (const [count, per] of groups) {
    for (let i = 0; i < count; i++) {
      const block = data.slice(offset, offset + per);
      offset += per;
      blocks.push(block);
      eccs.push(rsRemainder(block, ecPerBlock));
    }
  }
  const out: number[] = [];
  const maxData = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.length) out.push(b[i]!);
  for (let i = 0; i < ecPerBlock; i++) for (const e of eccs) out.push(e[i]!);
  return out;
}

// --- format information ------------------------------------------------------
/** The 15 format-information bits for an ECC level + mask (BCH + XOR mask), MSB first value. Exported for tests. */
export function formatBits(ecLevelBits: number, mask: number): number {
  const data = (ecLevelBits << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}
const EC_BITS_M = 0b00;

// --- matrix assembly -----------------------------------------------------------
const MASK_FORMULAS: ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function buildMatrix(version: number, codewords: number[]): { modules: boolean[][]; isFunction: boolean[][] } {
  const size = version * 4 + 17;
  const modules: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const isFunction: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const setF = (r: number, c: number, dark: boolean) => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    modules[r]![c] = dark;
    isFunction[r]![c] = true;
  };
  // Timing patterns
  for (let i = 0; i < size; i++) {
    setF(6, i, i % 2 === 0);
    setF(i, 6, i % 2 === 0);
  }
  // Finder patterns + separators
  const finder = (cr: number, cc: number) => {
    for (let dr = -4; dr <= 4; dr++) {
      for (let dc = -4; dc <= 4; dc++) {
        const dist = Math.max(Math.abs(dr), Math.abs(dc));
        setF(cr + dr, cc + dc, dist !== 2 && dist !== 4);
      }
    }
  };
  finder(3, 3);
  finder(3, size - 4);
  finder(size - 4, 3);
  // Alignment patterns
  const centers = ALIGNMENT_CENTERS[version]!;
  for (const r of centers) {
    for (const c of centers) {
      const overlapsFinder = (r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8);
      if (overlapsFinder) continue;
      for (let dr = -2; dr <= 2; dr++)
        for (let dc = -2; dc <= 2; dc++) setF(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
  }
  // Reserve format-information areas (values drawn after mask
  // selection, except the dark module). The strips deliberately skip
  // index 6 — (8,6) and (6,8) are TIMING modules, not format cells.
  for (let i = 0; i <= 5; i++) {
    setF(8, i, false);
    setF(i, 8, false);
  }
  setF(8, 7, false);
  setF(8, 8, false);
  setF(7, 8, false);
  for (let i = 0; i < 8; i++) setF(8, size - 1 - i, false);
  for (let i = 0; i < 7; i++) setF(size - 1 - i, 8, false);
  setF(size - 8, 8, true); // dark module
  // Data placement (zigzag, skipping the timing column)
  let bitsIdx = 0;
  const totalBits = codewords.length * 8 + REMAINDER_BITS[version]!;
  const bitAt = (i: number) => (i < codewords.length * 8 ? (codewords[i >>> 3]! >>> (7 - (i & 7))) & 1 : 0);
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const upward = ((right + 1) & 2) === 0;
        const r = upward ? size - 1 - vert : vert;
        if (!isFunction[r]![c] && bitsIdx < totalBits) {
          modules[r]![c] = bitAt(bitsIdx) === 1;
          bitsIdx++;
        }
      }
    }
  }
  return { modules, isFunction };
}

function applyMask(modules: boolean[][], isFunction: boolean[][], mask: number): boolean[][] {
  const out = modules.map((row) => [...row]);
  const formula = MASK_FORMULAS[mask]!;
  for (let r = 0; r < out.length; r++)
    for (let c = 0; c < out.length; c++) if (!isFunction[r]![c] && formula(r, c)) out[r]![c] = !out[r]![c];
  return out;
}

function drawFormat(modules: boolean[][], mask: number) {
  const size = modules.length;
  const bits = formatBits(EC_BITS_M, mask);
  const get = (i: number) => ((bits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) modules[8]![i] = get(i);
  modules[8]![7] = get(6);
  modules[8]![8] = get(7);
  modules[7]![8] = get(8);
  for (let i = 9; i < 15; i++) modules[14 - i]![8] = get(i);
  for (let i = 0; i < 8; i++) modules[8]![size - 1 - i] = get(i);
  for (let i = 8; i < 15; i++) modules[size - 15 + i]![8] = get(i);
  modules[size - 8]![8] = true;
}

function penaltyScore(m: boolean[][]): number {
  const size = m.length;
  let score = 0;
  const runPenalty = (line: boolean[]) => {
    let s = 0;
    let runColor = line[0]!;
    let runLen = 1;
    for (let i = 1; i <= line.length; i++) {
      if (i < line.length && line[i] === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) s += 3 + (runLen - 5);
        runColor = line[i]!;
        runLen = 1;
      }
    }
    return s;
  };
  for (let r = 0; r < size; r++) score += runPenalty(m[r]!);
  for (let c = 0; c < size; c++) score += runPenalty(m.map((row) => row[c]!));
  for (let r = 0; r < size - 1; r++)
    for (let c = 0; c < size - 1; c++)
      if (m[r]![c] === m[r]![c + 1] && m[r]![c] === m[r + 1]![c] && m[r]![c] === m[r + 1]![c + 1]) score += 3;
  const patterns: boolean[][] = [
    [true, false, true, true, true, false, true, false, false, false, false],
    [false, false, false, false, true, false, true, true, true, false, true],
  ];
  const checkPatterns = (line: boolean[]) => {
    let s = 0;
    for (let i = 0; i + 11 <= line.length; i++)
      for (const p of patterns) if (p.every((v, j) => line[i + j] === v)) s += 40;
    return s;
  };
  for (let r = 0; r < size; r++) score += checkPatterns(m[r]!);
  for (let c = 0; c < size; c++) score += checkPatterns(m.map((row) => row[c]!));
  let dark = 0;
  for (const row of m) for (const v of row) if (v) dark++;
  const total = size * size;
  const k = Math.floor(Math.abs(dark * 20 - total * 10) / total);
  score += k * 10;
  return score;
}

/** Encode text (UTF-8) as a QR matrix. Throws if it exceeds version 6-M capacity. */
export function encodeQr(text: string): QrCode {
  const bytes = new TextEncoder().encode(text);
  let version = 0;
  for (let v = 1; v <= 6; v++) {
    if (bytes.length + 2 <= dataCapacityM(v)) {
      version = v;
      break;
    }
  }
  if (version === 0) throw new Error(`qrCode: ${bytes.length} bytes exceeds version 6-M capacity`);
  const data = encodeDataCodewords(bytes, version);
  const codewords = interleaveWithEcc(data, version);
  if (codewords.length !== TOTAL_CODEWORDS[version]) throw new Error("qrCode: internal codeword count mismatch");
  const { modules, isFunction } = buildMatrix(version, codewords);
  let best: boolean[][] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = applyMask(modules, isFunction, mask);
    drawFormat(candidate, mask);
    const score = penaltyScore(candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return { version, size: modules.length, modules: best! };
}
