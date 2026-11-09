import { describe, expect, test } from "bun:test";
import {
PER_DIEM_PACKET_LABEL,
aggregateDeductionLines,
normalizeDeductionLines,
parseDeductionLines,
payBookPeriodStart,
payBookYtdSlices,
perDiemPacketLine,
sumDeductionLines,
summarizePayBook,
type PayEntryLike,
} from "./payBook";

const check = (partial: Partial<PayEntryLike>): PayEntryLike => ({
  kind: "w2",
  isForm: false,
  payer: "RUGGS LOGISTICS",
  taxYear: null,
  gross: 0,
  federalWithheld: 0,
  stateWithheld: 0,
  otherDeductions: 0,
  perDiem: 0,
  ...partial,
});

// Synthetic per-mile stub fixture (NO real person's figures): the
// driver ran 2,000 miles at $0.55/mi = $1,100.00 miles pay, plus
// $50.00 of extras (drop pay), and the carrier took a $280.00 per
// diem out before printing gross — so the stub's printed "Gross
// Earnings" is the TAXABLE $870.00, and the $280.00 per diem arrives
// on a separate non-taxable check.
const MILES_PAY = 2000 * 0.55; // 1100
const EXTRAS = 50;
const PER_DIEM = 280;
const TAXABLE_GROSS = MILES_PAY + EXTRAS - PER_DIEM; // 870
const syntheticStub = (partial: Partial<PayEntryLike> = {}): PayEntryLike =>
  check({
    gross: TAXABLE_GROSS,
    federalWithheld: 87,
    stateWithheld: 26.1,
    otherDeductions: 14.9,
    perDiem: PER_DIEM,
    ...partial,
  });

describe("Pay Book — W-2 only", () => {
  const s = summarizePayBook(
    [
      check({ gross: 2000, federalWithheld: 220, stateWithheld: 80, otherDeductions: 50 }),
      check({ gross: 2000, federalWithheld: 220, stateWithheld: 80 }),
    ],
    [],
    0,
  );
  test("gross, withholding sums, and net paid", () => {
    expect(s.w2.gross).toBe(4000);
    expect(s.w2.federalWithheld).toBe(440);
    expect(s.w2.stateWithheld).toBe(160);
    expect(s.w2.totalWithheld).toBe(600);
    expect(s.w2.otherDeductions).toBe(50);
    expect(s.w2.netPaid).toBe(3350);
    expect(s.w2.count).toBe(2);
  });
  test("1099 pile is empty and combined equals the W-2 gross", () => {
    expect(s.ten99.gross).toBe(0);
    expect(s.ten99.count).toBe(0);
    expect(s.combinedGross).toBe(4000);
  });
});

describe("Pay Book — 1099 only, expenses on the 1099 side", () => {
  const s = summarizePayBook(
    [check({ kind: "1099", payer: "Granted Enterprise", gross: 5500 })],
    [
      { category: "maintenance", amount: 300 },
      { category: "tolls", amount: 45.5 },
    ],
    800,
  );
  test("gross and net after expenses + fuel", () => {
    expect(s.ten99.gross).toBe(5500);
    expect(s.combinedGross).toBe(5500);
    expect(s.expenses.total).toBe(345.5);
    expect(s.expenses.fuelTotal).toBe(800);
    expect(s.net1099).toBe(4354.5);
  });
  test("categories totalled separately", () => {
    expect(s.expenses.byCategory).toEqual([
      { category: "maintenance", amount: 300 },
      { category: "tolls", amount: 45.5 },
    ]);
  });
});

describe("Pay Book — mixed piles stay separate under one tracking total", () => {
  const s = summarizePayBook(
    [
      check({ payer: "Employer A", gross: 3000, federalWithheld: 300, stateWithheld: 100 }),
      check({ payer: "Employer B", gross: 1000, federalWithheld: 90, stateWithheld: 30 }),
      check({ kind: "1099", payer: "Payer C", gross: 2500 }),
      check({ kind: "1099", payer: "Payer C", gross: 500 }),
      check({ kind: "1099", payer: "Payer D", gross: 700 }),
    ],
    [],
    0,
  );
  test("combined = W-2 gross + 1099 gross, piles unmixed", () => {
    expect(s.w2.gross).toBe(4000);
    expect(s.ten99.gross).toBe(3700);
    expect(s.combinedGross).toBe(7700);
    // Withholding belongs to the W-2 pile only — never netted off 1099.
    expect(s.w2.totalWithheld).toBe(520);
    expect(s.net1099).toBe(3700);
  });
  test("per-payer breakdown per pile", () => {
    expect(s.w2.byPayer.map((p) => [p.payer, p.gross])).toEqual([
      ["Employer A", 3000],
      ["Employer B", 1000],
    ]);
    expect(s.ten99.byPayer.map((p) => [p.payer, p.gross, p.count])).toEqual([
      ["Payer C", 3000, 2],
      ["Payer D", 700, 1],
    ]);
  });
});

describe("Pay Book — cents-safe math", () => {
  test("repeated fractional amounts sum exactly", () => {
    const entries = Array.from({ length: 10 }, () =>
      check({ kind: "1099", payer: "P", gross: 0.1, federalWithheld: 0 }),
    );
    entries.push(check({ gross: 1234.56, federalWithheld: 0.07, stateWithheld: 0.03 }));
    const s = summarizePayBook(entries, [{ category: "other", amount: 0.07 }], 0.03);
    expect(s.ten99.gross).toBe(1);
    expect(s.w2.gross).toBe(1234.56);
    expect(s.w2.totalWithheld).toBe(0.1);
    expect(s.net1099).toBe(0.9);
  });
});

describe("Pay Book — year-end form entries tie to piles but never double-count", () => {
  const s = summarizePayBook(
    [
      check({ gross: 40000, federalWithheld: 4000, stateWithheld: 1500 }),
      check({ isForm: true, taxYear: 2026, gross: 40000, federalWithheld: 4000, stateWithheld: 1500 }),
      check({ kind: "1099", isForm: true, payer: "Payer C", taxYear: 2026, gross: 12000 }),
    ],
    [],
    0,
  );
  test("form gross is listed separately, piles count paychecks only", () => {
    expect(s.w2.gross).toBe(40000);
    expect(s.w2.count).toBe(1);
    expect(s.ten99.gross).toBe(0);
    expect(s.combinedGross).toBe(40000);
    expect(s.forms.w2).toEqual([{ payer: "RUGGS LOGISTICS", taxYear: 2026, gross: 40000 }]);
    expect(s.forms.w2Gross).toBe(40000);
    expect(s.forms.gross1099).toBe(12000);
  });
});

describe("Pay Book — per diem (non-taxable, paid separately)", () => {
  test("the synthetic fixture reconciles: miles pay + extras − per diem = taxable gross", () => {
    expect(MILES_PAY).toBe(1100);
    expect(TAXABLE_GROSS).toBe(870);
  });
  test("taxable subtotals are unchanged by per diem", () => {
    const withPd = summarizePayBook([syntheticStub()], [], 0);
    const withoutPd = summarizePayBook([syntheticStub({ perDiem: 0 })], [], 0);
    expect(withPd.w2.gross).toBe(withoutPd.w2.gross);
    expect(withPd.w2.gross).toBe(TAXABLE_GROSS);
    expect(withPd.w2.federalWithheld).toBe(withoutPd.w2.federalWithheld);
    expect(withPd.w2.stateWithheld).toBe(withoutPd.w2.stateWithheld);
    expect(withPd.w2.totalWithheld).toBe(withoutPd.w2.totalWithheld);
    expect(withPd.w2.otherDeductions).toBe(withoutPd.w2.otherDeductions);
    expect(withPd.w2.netPaid).toBe(withoutPd.w2.netPaid);
    expect(withPd.combinedGross).toBe(withoutPd.combinedGross);
    // …while the per-diem-aware numbers are the only ones that move.
    expect(withPd.w2.perDiemTotal).toBe(PER_DIEM);
    expect(withoutPd.w2.perDiemTotal).toBe(0);
  });
  test("total received is exact to the cent: (gross − fed − state − other) + per diem", () => {
    const s = summarizePayBook([syntheticStub()], [], 0);
    expect(s.w2.netPaid).toBe(742); // 870 − 87 − 26.10 − 14.90
    expect(s.w2.totalReceived).toBe(1022); // 742 + 280
    const frac = summarizePayBook(
      [check({ gross: 1000.1, federalWithheld: 100.02, stateWithheld: 30.03, otherDeductions: 5.05, perDiem: 280.07 })],
      [],
      0,
    );
    expect(frac.w2.netPaid).toBe(865);
    expect(frac.w2.totalReceived).toBe(1145.07);
    expect(frac.combinedTotalReceived).toBe(1145.07);
  });
  test("per diem sums per pile separately — W-2 and 1099 never mixed", () => {
    const s = summarizePayBook(
      [
        syntheticStub(),
        syntheticStub({ payer: "Employer B", gross: 500, federalWithheld: 50, stateWithheld: 15, otherDeductions: 0, perDiem: 140 }),
        check({ kind: "1099", payer: "Payer C", gross: 900, perDiem: 210 }),
      ],
      [],
      0,
    );
    expect(s.w2.perDiemTotal).toBe(420);
    expect(s.ten99.perDiemTotal).toBe(210);
    expect(s.combinedPerDiem).toBe(630);
    expect(s.w2.totalReceived).toBe(742 + (500 - 50 - 15) + 420);
    expect(s.ten99.totalReceived).toBe(900 + 210);
    expect(s.combinedTotalReceived).toBe(s.w2.totalReceived + s.ten99.totalReceived);
    // Filing figures stay taxable-only on both piles.
    expect(s.w2.gross).toBe(1370);
    expect(s.ten99.gross).toBe(900);
    expect(s.combinedGross).toBe(2270);
    const w2Payer = s.w2.byPayer.find((p) => p.payer === "RUGGS LOGISTICS");
    expect(w2Payer?.perDiem).toBe(280);
  });
  test("both packets exclude per diem from filing gross but list the labelled line", () => {
    const s = summarizePayBook(
      [syntheticStub(), check({ kind: "1099", payer: "Payer C", gross: 900, perDiem: 210 })],
      [],
      0,
    );
    // The packet builders print filing totals from the pile gross
    // (taxable only) and append perDiemPacketLine as its own line.
    const w2TotalsLine = `W-2 TOTALS — gross ${s.w2.gross.toFixed(2)} · per diem total ${s.w2.perDiemTotal.toFixed(2)}`;
    const w2Line = perDiemPacketLine(s.w2.perDiemTotal);
    const n99Line = perDiemPacketLine(s.ten99.perDiemTotal);
    expect(w2Line).toBe(`${PER_DIEM_PACKET_LABEL}: $280.00`);
    expect(n99Line).toBe(`${PER_DIEM_PACKET_LABEL}: $210.00`);
    expect(PER_DIEM_PACKET_LABEL).toContain("not included in filing gross");
    expect(s.w2.gross).toBe(TAXABLE_GROSS); // NOT 870 + 280
    expect(s.ten99.gross).toBe(900); // NOT 900 + 210
    expect(w2TotalsLine).toContain("gross 870.00");
    // No per diem in the period → no line in the packet at all.
    expect(perDiemPacketLine(0)).toBeNull();
  });
  test("form entries never count per diem, even when a value is present", () => {
    const s = summarizePayBook(
      [
        syntheticStub(),
        check({ isForm: true, taxYear: 2026, gross: 40000, perDiem: 9999 }),
        check({ kind: "1099", isForm: true, payer: "Payer C", taxYear: 2026, gross: 12000, perDiem: 8888 }),
      ],
      [],
      0,
    );
    expect(s.w2.perDiemTotal).toBe(PER_DIEM);
    expect(s.ten99.perDiemTotal).toBe(0);
    expect(s.combinedPerDiem).toBe(PER_DIEM);
    expect(s.w2.totalReceived).toBe(1022);
    expect(s.forms.w2Gross).toBe(40000);
  });
  test("deleting an entry recomputes the per diem totals", () => {
    const entries = [
      syntheticStub(),
      syntheticStub({ payer: "Employer B", gross: 500, federalWithheld: 50, stateWithheld: 15, otherDeductions: 0, perDiem: 140 }),
    ];
    const before = summarizePayBook(entries, [], 0);
    expect(before.w2.perDiemTotal).toBe(420);
    // The delete path removes the row; the summary is recomputed from
    // what remains (getPayBook re-reads the table on every call).
    const after = summarizePayBook(entries.slice(0, 1), [], 0);
    expect(after.w2.perDiemTotal).toBe(280);
    expect(after.w2.gross).toBe(TAXABLE_GROSS);
    expect(after.w2.totalReceived).toBe(1022);
    expect(after.w2.count).toBe(1);
  });
});

describe("Pay Book — itemized 1099 deduction lines (never tax)", () => {
  const lines = [
    { label: "Fuel", amount: 412.35 },
    { label: "Truck payment", amount: 650 },
    { label: "Insurance", amount: 188.5 },
    { label: "Escrow", amount: 100 },
    { label: "Quickpay fee", amount: 39.6 },
  ];
  test("lines normalize, sum cents-exact, and round-trip through storage JSON", () => {
    expect(normalizeDeductionLines([{ label: "  Fuel ", amount: 10.005 }, { label: "", amount: 5 }, { label: "Escrow", amount: 0 }])).toEqual([
      { label: "Fuel", amount: 10.01 },
    ]);
    expect(sumDeductionLines(lines)).toBe(1390.45);
    expect(parseDeductionLines(JSON.stringify(lines))).toEqual(lines);
    expect(parseDeductionLines(null)).toEqual([]);
    expect(parseDeductionLines("not json")).toEqual([]);
  });
  test("the lines' sum IS the pile's deductions total, aggregated by label", () => {
    const s = summarizePayBook(
      [
        check({ kind: "1099", payer: "Broker A", gross: 4000, otherDeductions: sumDeductionLines(lines), deductionLines: lines }),
        check({ kind: "1099", payer: "Broker A", gross: 2000, otherDeductions: 200, deductionLines: [{ label: "fuel", amount: 200 }] }),
      ],
      [],
      0,
    );
    expect(s.ten99.otherDeductions).toBe(1590.45);
    // "Fuel" and "fuel" are one label in the packet's itemized view.
    expect(s.ten99.deductionLines.find((l) => l.label === "Fuel")).toEqual({ label: "Fuel", amount: 612.35 });
    expect(s.ten99.deductionLines[0]).toEqual({ label: "Truck payment", amount: 650 });
    expect(s.ten99.deductionLines.reduce((a, l) => a + l.amount, 0)).toBeCloseTo(1590.45, 2);
    expect(aggregateDeductionLines([{ deductionLines: lines }])).toHaveLength(5);
  });
  test("net1099 nets stub deductions ONCE, then expenses and fuel once each — no double counting", () => {
    const s = summarizePayBook(
      [check({ kind: "1099", payer: "Broker A", gross: 4000, otherDeductions: sumDeductionLines(lines), deductionLines: lines })],
      [{ category: "maintenance", amount: 300 }],
      500,
    );
    // 4000 − 1390.45 (stub lines) − 300 (out-of-pocket expense) − 500 (fuel purchases)
    expect(s.net1099).toBe(1809.55);
    // Total received is the money that landed: gross − stub deductions.
    expect(s.ten99.totalReceived).toBe(2609.55);
    // No tax is ever withheld from the 1099 pile.
    expect(s.ten99.federalWithheld).toBe(0);
    expect(s.ten99.stateWithheld).toBe(0);
  });
  test("a 1099 entry with no lines keeps the old net (deductions 0)", () => {
    const s = summarizePayBook([check({ kind: "1099", payer: "P", gross: 5500 })], [{ category: "tolls", amount: 45.5 }], 800);
    expect(s.net1099).toBe(4654.5);
    expect(s.ten99.deductionLines).toEqual([]);
  });
});

describe("Pay Book — YTD lane pies (W-2 & 1099 separate lanes, never mixed)", () => {
  const s = summarizePayBook(
    [
      check({ gross: 1000, federalWithheld: 100, stateWithheld: 50, otherDeductions: 25, perDiem: 80 }),
      check({ kind: "1099", payer: "Payer C", gross: 2000, otherDeductions: 300, perDiem: 20 }),
    ],
    [],
    0,
  );
  const y = payBookYtdSlices(s);
  test("each lane's slices come from its own pile only", () => {
    expect(y.w2).toEqual({ gross: 1000, perDiem: 80, deductions: 175, total: 1255 });
    expect(y.ten99).toEqual({ gross: 2000, perDiem: 20, deductions: 300, total: 2320 });
  });
  test("per diem stays in its own lane — never pooled across lanes", () => {
    expect(y.w2.perDiem).toBe(80);
    expect(y.ten99.perDiem).toBe(20);
  });
  test("the shape carries NO combined cross-lane total", () => {
    expect(Object.keys(y).sort()).toEqual(["ten99", "w2"]);
    expect(JSON.stringify(y)).not.toContain("3575");
  });
  test("an empty lane is an honest zero pie", () => {
    const only = payBookYtdSlices(summarizePayBook([check({ gross: 500 })], [], 0));
    expect(only.ten99).toEqual({ gross: 0, perDiem: 0, deductions: 0, total: 0 });
    expect(only.w2.total).toBe(500);
  });
});

describe("Pay Book — empty and period starts", () => {
  test("nothing logged is an honest zero", () => {
    const s = summarizePayBook([], [], 0);
    expect(s.hasData).toBe(false);
    expect(s.combinedGross).toBe(0);
  });
  test("period windows mirror Money Truth, year starts Jan 1 local", () => {
    const now = new Date(2026, 9, 27, 12, 0, 0).getTime();
    expect(payBookPeriodStart("week", now)).toBe(now - 7 * 86400000);
    expect(payBookPeriodStart("month", now)).toBe(now - 30 * 86400000);
    expect(payBookPeriodStart("quarter", now)).toBe(now - 92 * 86400000);
    expect(payBookPeriodStart("all", now)).toBe(0);
    expect(payBookPeriodStart("year", now)).toBe(new Date(2026, 0, 1).getTime());
  });
});
