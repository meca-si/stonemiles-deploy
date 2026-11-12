// taxYear.ts — Final Extras batch (2026-11-06): pure logic for the
// tax-ready year summary and the per-diem day counter. No I/O, no
// DB — the actions feed it rows and it returns numbers, so the exact
// production behaviour is unit-testable (taxYear.test.ts).
//
// HONESTY RULES baked in here:
//  - Per-diem days are counted ONLY from the driver's own sealed
//    trip records: every calendar day a sealed trip was on the road
//    (start day through end day, inclusive) counts once, however
//    many trips touched it. A day with no sealed trip never counts —
//    nothing is estimated, padded, or back-filled.
//  - Days are counted on UTC calendar dates so the count is the
//    same on every device and in every timezone the driver crosses;
//    the UI labels the basis in plain words.
//  - Expense totals group by the category the DRIVER confirmed on
//    each expense — the summary never re-categorises a record.
//  - This is a record for tax prep, not tax advice: per-diem is an
//    owner-operator / 1099 deduction; W-2 company drivers have not
//    been able to claim it since the 2017 tax law change. The UI
//    carries that label verbatim; nothing here computes a deduction
//    amount (no rate is assumed — rates change and are the tax
//    preparer's call).

export type TripSpan = { startedAtMs: number; endedAtMs: number };

const DAY_MS = 86_400_000;

function utcDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Every UTC calendar date (YYYY-MM-DD) touched by at least one
 *  trip span, restricted to the given year, sorted ascending. A
 *  span with end before start contributes only its start day. */
export function perDiemDates(trips: TripSpan[], year: number): string[] {
  const days = new Set<string>();
  for (const t of trips) {
    if (!Number.isFinite(t.startedAtMs)) continue;
    const startDay = Math.floor(t.startedAtMs / DAY_MS) * DAY_MS;
    const endMs = Number.isFinite(t.endedAtMs) && t.endedAtMs >= t.startedAtMs ? t.endedAtMs : t.startedAtMs;
    const endDay = Math.floor(endMs / DAY_MS) * DAY_MS;
    // A single trip can span at most a year of days in practice;
    // the loop is bounded by the span itself.
    for (let d = startDay; d <= endDay; d += DAY_MS) {
      const key = utcDateKey(d);
      if (Number(key.slice(0, 4)) === year) days.add(key);
    }
  }
  return [...days].sort();
}

/** How many per-diem days the sealed trip records support for a year. */
export function perDiemDayCount(trips: TripSpan[], year: number): number {
  return perDiemDates(trips, year).length;
}

export type ExpenseLike = { spentAtMs: number; category: string; amount: number };

export type CategoryTotal = { category: string; total: number; count: number };

/** Expense totals for one calendar year (UTC), grouped by the
 *  driver-confirmed category, biggest first. Amounts are rounded
 *  to cents so float dust never reaches the summary. */
export function expenseTotalsForYear(expenses: ExpenseLike[], year: number): { byCategory: CategoryTotal[]; total: number; count: number } {
  const map = new Map<string, CategoryTotal>();
  let total = 0;
  let count = 0;
  for (const e of expenses) {
    if (!Number.isFinite(e.spentAtMs) || !Number.isFinite(e.amount)) continue;
    if (new Date(e.spentAtMs).getUTCFullYear() !== year) continue;
    const cur = map.get(e.category) ?? { category: e.category, total: 0, count: 0 };
    cur.total += e.amount;
    cur.count += 1;
    map.set(e.category, cur);
    total += e.amount;
    count += 1;
  }
  const byCategory = [...map.values()]
    .map((c) => ({ ...c, total: Math.round(c.total * 100) / 100 }))
    .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category));
  return { byCategory, total: Math.round(total * 100) / 100, count };
}

/** The tax categories the expense form offers, in the order the
 *  brief fixed: the working set a driver sorts receipts into.
 *  (lumper / insurance / scale / permits predate the batch and stay
 *  valid — old records keep their category; the summary groups by
 *  whatever the driver confirmed.)
 *  Tax Worksheet batch (2026-11-12): the paper worksheet's lines
 *  that had no home of their own join the set — "repairs" (kept
 *  distinct from "maintenance" on the record; the worksheet VIEW
 *  shows the two as one "Maintenance & repairs" line), "dot_testing"
 *  (DOT testing / physical), "licensing" (licensing & fees) and
 *  "software" (software & satellite). Nothing is renamed or
 *  migrated — old records keep the category the driver confirmed. */
export const TAX_EXPENSE_CATEGORIES = [
  "fuel",
  "maintenance",
  "tolls",
  "parking",
  "meals",
  "supplies",
  "lumper",
  "insurance",
  "scale",
  "permits",
  "repairs",
  "dot_testing",
  "licensing",
  "software",
  "other",
] as const;

// ---------------------------------------------------------------------------
// Tax Worksheet (2026-11-12) — the paper "Tax Deduction Worksheet for
// Truck Driver Operators" as a VIEW over the records the driver
// already keeps: Pay Book income, the expense tracker, the fuel log
// and sealed trips. Pure assembly, no I/O — the actions feed it rows.
//
// HONESTY RULES (the same ones the year summary lives by):
//  - W-2 and 1099 stay SEPARATE lanes everywhere: rows carry their
//    lane, subtotals are per lane, and there is deliberately NO
//    combined filing total anywhere in the worksheet.
//  - Year-end FORM entries (isForm) never appear as income rows —
//    the paychecks already counted that money (the Pay Book YTD
//    rule); a form would double it.
//  - Miles ride a row ONLY where the record itself carries them.
//    Pay Book entries carry no miles, so their rows read null and
//    the screen prints "—" — miles are never borrowed from a trip
//    to dress up a pay row. The year's sealed trip miles stand as
//    their own labelled total instead.
//  - Expense lines group by the driver-confirmed category. The one
//    display merge: "maintenance" + "repairs" show as a single
//    "Maintenance & repairs" worksheet line (the records underneath
//    keep their own categories). Any category with no worksheet
//    line of its own falls into "Other expenses" — a logged dollar
//    is never dropped from the worksheet.
//  - Fuel purchases stay their own block (the actions pass them in
//    separately), exactly as the year summary keeps them out of the
//    expense categories so nothing double-counts.
//  - No deduction amount is figured and no rate is assumed: this is
//    a record for tax prep, not tax advice.

export type WorksheetIncomeLike = {
  paidAtMs: number;
  kind: string; // "w2" | "1099"
  isForm: boolean;
  payer: string;
  gross: number;
  miles?: number | null;
};

export type WorksheetIncomeRow = {
  dateIso: string;
  payer: string;
  lane: "w2" | "1099";
  miles: number | null;
  gross: number;
};

export type WorksheetLine = {
  key: string;
  label: string;
  categories: string[];
  total: number;
  count: number;
};

export type WorksheetSection = {
  key: "vehicle" | "equipment";
  title: string;
  lines: WorksheetLine[];
  subtotal: number;
};

export type TaxWorksheet = {
  year: number;
  incomeRows: WorksheetIncomeRow[];
  w2: { gross: number; count: number };
  ten99: { gross: number; count: number };
  sections: WorksheetSection[];
  expenseTotal: number;
  expenseCount: number;
};

/** The worksheet's expense lines, in paper order: which confirmed
 *  categories feed each displayed line. */
const WORKSHEET_SECTIONS: { key: WorksheetSection["key"]; title: string; lines: { key: string; label: string; categories: string[] }[] }[] = [
  {
    key: "vehicle",
    title: "Vehicle & operating expenses",
    lines: [
      { key: "maintenance_repairs", label: "Maintenance & repairs", categories: ["maintenance", "repairs"] },
      { key: "insurance", label: "Insurance", categories: ["insurance"] },
      { key: "licensing", label: "Licensing & fees", categories: ["licensing"] },
      { key: "dot_testing", label: "DOT testing / physical", categories: ["dot_testing"] },
      { key: "tolls", label: "Tolls", categories: ["tolls"] },
      { key: "scale", label: "Scale tickets", categories: ["scale"] },
      { key: "permits", label: "Permits", categories: ["permits"] },
      { key: "parking", label: "Parking", categories: ["parking"] },
      { key: "lumper", label: "Lumper fees", categories: ["lumper"] },
      { key: "meals", label: "Meals", categories: ["meals"] },
      { key: "fuel_expenses", label: "Fuel (logged as an expense)", categories: ["fuel"] },
      { key: "other", label: "Other expenses", categories: ["other"] },
    ],
  },
  {
    key: "equipment",
    title: "Equipment & supplies",
    lines: [
      { key: "supplies", label: "Supplies & equipment", categories: ["supplies"] },
      { key: "software", label: "Software & satellite", categories: ["software"] },
    ],
  },
];

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Assemble one year's worksheet from the driver's own records. */
export function buildTaxWorksheet(input: { income: WorksheetIncomeLike[]; expenses: ExpenseLike[]; year: number }): TaxWorksheet {
  const { year } = input;

  // Income tracker — paychecks only (forms excluded), oldest first,
  // each row in its own lane; subtotals per lane, never combined.
  const rows: (WorksheetIncomeRow & { paidAtMs: number })[] = [];
  const w2 = { gross: 0, count: 0 };
  const ten99 = { gross: 0, count: 0 };
  for (const e of input.income) {
    if (e.isForm) continue;
    if (!Number.isFinite(e.paidAtMs) || !Number.isFinite(e.gross)) continue;
    if (new Date(e.paidAtMs).getUTCFullYear() !== year) continue;
    const lane: "w2" | "1099" = e.kind === "1099" ? "1099" : "w2";
    rows.push({
      paidAtMs: e.paidAtMs,
      dateIso: new Date(e.paidAtMs).toISOString().slice(0, 10),
      payer: e.payer,
      lane,
      miles: typeof e.miles === "number" && Number.isFinite(e.miles) ? e.miles : null,
      gross: round2(e.gross),
    });
    const bucket = lane === "1099" ? ten99 : w2;
    bucket.gross += e.gross;
    bucket.count += 1;
  }
  rows.sort((a, b) => a.paidAtMs - b.paidAtMs);
  w2.gross = round2(w2.gross);
  ten99.gross = round2(ten99.gross);

  // Expense sections — the year summary's per-category totals,
  // folded into the worksheet's lines. Unmapped categories land in
  // the "Other expenses" line so the section math always reconciles
  // with expenseTotalsForYear's total.
  const totals = expenseTotalsForYear(input.expenses, year);
  const byCategory = new Map(totals.byCategory.map((c) => [c.category, c]));
  const mapped = new Set<string>();
  const sections: WorksheetSection[] = WORKSHEET_SECTIONS.map((def) => {
    const lines: WorksheetLine[] = def.lines.map((lineDef) => {
      let total = 0;
      let count = 0;
      for (const cat of lineDef.categories) {
        const c = byCategory.get(cat);
        if (c) {
          total += c.total;
          count += c.count;
          mapped.add(cat);
        }
      }
      return { key: lineDef.key, label: lineDef.label, categories: lineDef.categories, total: round2(total), count };
    });
    return { key: def.key, title: def.title, lines, subtotal: round2(lines.reduce((s, l) => s + l.total, 0)) };
  });
  const unmapped = totals.byCategory.filter((c) => !mapped.has(c.category));
  if (unmapped.length) {
    const other = sections[0]!.lines.find((l) => l.key === "other")!;
    for (const c of unmapped) {
      other.total = round2(other.total + c.total);
      other.count += c.count;
      if (!other.categories.includes(c.category)) other.categories = [...other.categories, c.category];
    }
    sections[0]!.subtotal = round2(sections[0]!.lines.reduce((s, l) => s + l.total, 0));
  }

  return {
    year,
    incomeRows: rows.map(({ paidAtMs: _paidAtMs, ...r }) => r),
    w2,
    ten99,
    sections,
    expenseTotal: totals.total,
    expenseCount: totals.count,
  };
}
