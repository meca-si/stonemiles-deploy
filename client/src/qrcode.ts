// Minimal QR encoder (byte mode, error-correction level M, versions 1–10)
// — enough to render real, scannable Verify-Anywhere codes fully offline,
// with no external service and no hotlinked images. Follows ISO/IEC 18004:
// data bitstream → Reed–Solomon over GF(256) → module placement → mask
// selection by penalty score → format/version information.

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
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255] ?? 0;
}
function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[(GF_LOG[a] ?? 0) + (GF_LOG[b] ?? 0)] ?? 0;
}
function rsGenerator(deg: number): number[] {
  let poly = [1];
  for (let i = 0; i < deg; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] = (next[j] ?? 0) ^ gfMul(poly[j] ?? 0, GF_EXP[i] ?? 1);
      next[j + 1] = (next[j + 1] ?? 0) ^ (poly[j] ?? 0);
    }
    poly = next;
  }
  return poly;
}
function rsEncode(data: number[], ecLen: number): number[] {
  const gen = rsGenerator(ecLen);
  const res = new Array<number>(ecLen).fill(0);
  for (const d of data) {
    const factor = d ^ (res.shift() ?? 0);
    res.push(0);
    for (let i = 0; i < ecLen; i++) {
      res[i] = (res[i] ?? 0) ^ gfMul(gen[i + 1] ?? 0, factor);
    }
  }
  return res;
}

// version: [dataCodewordsTotal, ecPerBlock, [[blocks, dataPerBlock], ...]]
const VERSIONS: Record<number, { data: number; ec: number; groups: [number, number][]; align: number[]; remainder: number }> = {
  1: { data: 16, ec: 10, groups: [[1, 16]], align: [], remainder: 0 },
  2: { data: 28, ec: 16, groups: [[1, 28]], align: [6, 18], remainder: 7 },
  3: { data: 44, ec: 26, groups: [[1, 44]], align: [6, 22], remainder: 7 },
  4: { data: 64, ec: 18, groups: [[2, 32]], align: [6, 26], remainder: 7 },
  5: { data: 86, ec: 24, groups: [[2, 43]], align: [6, 30], remainder: 7 },
  6: { data: 108, ec: 16, groups: [[4, 27]], align: [6, 34], remainder: 7 },
  7: { data: 124, ec: 18, groups: [[4, 31]], align: [6, 22, 38], remainder: 0 },
  8: { data: 154, ec: 22, groups: [[2, 38], [2, 39]], align: [6, 24, 42], remainder: 0 },
  9: { data: 182, ec: 22, groups: [[3, 36], [2, 37]], align: [6, 26, 46], remainder: 0 },
  10: { data: 216, ec: 26, groups: [[4, 43], [1, 44]], align: [6, 28, 50], remainder: 0 },
};

function buildDataCodewords(text: string, version: number): number[] {
  const spec = VERSIONS[version];
  if (!spec) throw new Error("bad version");
  const bytes = [...new TextEncoder().encode(text)];
  const bits: number[] = [];
  const push = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, version >= 10 ? 16 : 8);
  for (const b of bytes) push(b, 8);
  const cap = spec.data * 8;
  push(0, Math.min(4, cap - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | (bits[i + j] ?? 0);
    codewords.push(v);
  }
  const pads = [0xec, 0x11];
  let p = 0;
  while (codewords.length < spec.data) codewords.push(pads[p++ % 2] ?? 0xec);
  return codewords;
}

function interleave(data: number[], version: number): number[] {
  const spec = VERSIONS[version];
  if (!spec) throw new Error("bad version");
  const blocks: { data: number[]; ec: number[] }[] = [];
  let offset = 0;
  for (const [count, perBlock] of spec.groups) {
    for (let i = 0; i < count; i++) {
      const slice = data.slice(offset, offset + perBlock);
      offset += perBlock;
      blocks.push({ data: slice, ec: rsEncode(slice, spec.ec) });
    }
  }
  const out: number[] = [];
  const maxData = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < maxData; i++) {
    for (const b of blocks) if (i < b.data.length) out.push(b.data[i] ?? 0);
  }
  for (let i = 0; i < spec.ec; i++) {
    for (const b of blocks) out.push(b.ec[i] ?? 0);
  }
  return out;
}

type Grid = (boolean | null)[][];

function baseGrid(version: number): { grid: Grid; size: number } {
  const size = 17 + 4 * version;
  const grid: Grid = Array.from({ length: size }, () => new Array<boolean | null>(size).fill(null));
  const set = (x: number, y: number, v: boolean) => {
    if (x >= 0 && x < size && y >= 0 && y < size) grid[y]![x] = v;
  };
  const finder = (fx: number, fy: number) => {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const x = fx + dx;
        const y = fy + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const inRing = dx >= 0 && dx <= 6 && (dy === 0 || dy === 6);
        const inCol = dy >= 0 && dy <= 6 && (dx === 0 || dx === 6);
        const inCore = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
        set(x, y, inRing || inCol || inCore);
      }
    }
  };
  finder(0, 0);
  finder(size - 7, 0);
  finder(0, size - 7);
  // Timing
  for (let i = 8; i < size - 8; i++) {
    set(i, 6, i % 2 === 0);
    set(6, i, i % 2 === 0);
  }
  // Alignment patterns
  const spec = VERSIONS[version];
  if (spec) {
    for (const cy of spec.align) {
      for (const cx of spec.align) {
        if (grid[cy]![cx] !== null) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
          }
        }
      }
    }
  }
  // Dark module + reserved format areas
  set(8, size - 8, true);
  for (let i = 0; i < 9; i++) {
    if (grid[8]![i] === null) grid[8]![i] = false;
    if (grid[i]![8] === null) grid[i]![8] = false;
  }
  for (let i = 0; i < 8; i++) {
    if (grid[8]![size - 1 - i] === null) grid[8]![size - 1 - i] = false;
    if (grid[size - 1 - i]![8] === null) grid[size - 1 - i]![8] = false;
  }
  grid[8]![8] = grid[8]![8] ?? false;
  // Version info areas (v >= 7)
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        grid[i]![size - 11 + j] = false;
        grid[size - 11 + j]![i] = false;
      }
    }
  }
  return { grid, size };
}

function placeData(grid: Grid, size: number, codewords: number[], version: number): void {
  const bits: number[] = [];
  for (const cw of codewords) for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1);
  const spec = VERSIONS[version];
  for (let i = 0; i < (spec?.remainder ?? 0); i++) bits.push(0);
  let idx = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const y = upward ? size - 1 - vert : vert;
      for (const x of [right, right - 1]) {
        if (grid[y]![x] === null) {
          grid[y]![x] = idx < bits.length ? bits[idx] === 1 : false;
          idx++;
        }
      }
    }
    upward = !upward;
  }
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(grid: Grid, size: number, version: number, mask: number): Grid {
  const out = grid.map((row) => [...row]);
  const fn = MASKS[mask];
  if (!fn) return out;
  // Function-module map, built once per version (not per cell).
  const { grid: base } = baseGrid(version);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (base[y]![x] === null && fn(x, y)) {
        out[y]![x] = !(out[y]![x] ?? false);
      }
    }
  }
  return out;
}

function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask; // EC level M = 00
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function drawFormat(grid: Grid, size: number, mask: number): void {
  // Placement per ISO 18004 (same mapping as the reference implementations):
  // bit i is the i-th least significant bit of the 15-bit format value.
  const bits = formatBits(mask);
  const bit = (i: number) => ((bits >> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) grid[i]![8] = bit(i);
  grid[7]![8] = bit(6);
  grid[8]![8] = bit(7);
  grid[8]![7] = bit(8);
  for (let i = 9; i < 15; i++) grid[8]![14 - i] = bit(i);
  for (let i = 0; i < 8; i++) grid[8]![size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) grid[size - 15 + i]![8] = bit(i);
  grid[size - 8]![8] = true; // dark module
}

function drawVersion(grid: Grid, size: number, version: number): void {
  if (version < 7) return;
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
  const bits = (version << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const v = ((bits >> i) & 1) === 1;
    grid[Math.floor(i / 3)]![size - 11 + (i % 3)] = v;
    grid[size - 11 + (i % 3)]![Math.floor(i / 3)] = v;
  }
}

function penalty(grid: Grid, size: number): number {
  let score = 0;
  const get = (x: number, y: number) => grid[y]![x] === true;
  // Rule 1: runs
  for (let y = 0; y < size; y++) {
    let runVal = get(0, y);
    let runLen = 1;
    for (let x = 1; x < size; x++) {
      if (get(x, y) === runVal) runLen++;
      else { if (runLen >= 5) score += runLen - 2; runVal = get(x, y); runLen = 1; }
    }
    if (runLen >= 5) score += runLen - 2;
  }
  for (let x = 0; x < size; x++) {
    let runVal = get(x, 0);
    let runLen = 1;
    for (let y = 1; y < size; y++) {
      if (get(x, y) === runVal) runLen++;
      else { if (runLen >= 5) score += runLen - 2; runVal = get(x, y); runLen = 1; }
    }
    if (runLen >= 5) score += runLen - 2;
  }
  // Rule 2: 2x2 blocks
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const v = get(x, y);
      if (v === get(x + 1, y) && v === get(x, y + 1) && v === get(x + 1, y + 1)) score += 3;
    }
  }
  // Rule 3: finder-like patterns
  const pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const matches = (seq: boolean[], pat: number[]) => pat.every((p, i) => seq[i] === (p === 1));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x + 11 <= size; x++) {
      const seq = Array.from({ length: 11 }, (_, i) => get(x + i, y));
      if (matches(seq, pat1) || matches(seq, pat2)) score += 40;
    }
  }
  for (let x = 0; x < size; x++) {
    for (let y = 0; y + 11 <= size; y++) {
      const seq = Array.from({ length: 11 }, (_, i) => get(x, y + i));
      if (matches(seq, pat1) || matches(seq, pat2)) score += 40;
    }
  }
  // Rule 4: dark proportion
  let dark = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (get(x, y)) dark++;
  const pct = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return score;
}

/** Returns the module grid (true = dark) for the text, or null if too long. */
export function qrGrid(text: string): boolean[][] | null {
  const byteLen = new TextEncoder().encode(text).length;
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const spec = VERSIONS[v];
    if (!spec) continue;
    const capBits = spec.data * 8 - (v >= 10 ? 20 : 12);
    if (byteLen * 8 <= capBits) { version = v; break; }
  }
  if (version === 0) return null;
  const data = buildDataCodewords(text, version);
  const codewords = interleave(data, version);
  let best: Grid | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const { grid, size } = baseGrid(version);
    placeData(grid, size, codewords, version);
    const masked = applyMask(grid, size, version, mask);
    drawFormat(masked, size, mask);
    drawVersion(masked, size, version);
    const s = penalty(masked, size);
    if (s < bestScore) { bestScore = s; best = masked; }
  }
  if (!best) return null;
  return best.map((row) => row.map((c) => c === true));
}
