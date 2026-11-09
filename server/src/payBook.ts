// Pay Book math — pure helpers (no DB, no ctx) so the summary rules are
// unit-testable in the suite's usual style.
//
// x's locked rule (2026-10-27): W-2 pay and 1099 pay are TRACKED together —
// one combined year-to-date total for keeping up — but FILED separately.
// The combined total is a dashboard/keep-up number only; it is never a
// filing figure. The two piles are always summed apart first, and the
// combined total is exactly w2Gross + gross1099, nothing else.
//
// All money math runs in integer cents internally and converts back to
// dollars at the boundary — the same round-to-cents discipline the rest
// of the codebase uses, without float drift on long lists.
//
// PER DIEM (x, 2026-10-27, after real-world stub-format testing): on
// per-mile W-2 stubs the printed "Gross Earnings" is commonly the
// TAXABLE gross AFTER a fixed per diem has been taken out, and that
// per diem is paid to the driver on a separate check — non-taxable,
// never taxed, never deducted again. So per diem is summed PER PILE
// alongside the taxable figures but is NEVER added into any filing
// gross: filing gross stays taxable-only in both tax packets, where
// per diem appears only as its own labelled line. What per diem DOES
// feed is "total received" — (taxable gross − federal − state −
// other deductions) + per diem — the real money the driver got, and
// the combined TRACKING view of real earnings. Form entries never
// count per diem anywhere.

export type PayKind = "w2" | "1099";

// ---- Itemized deduction lines (x, 2026-10-27; both lanes 2026-10-30) -------
// A real settlement stub carries NAMED deductions that came off
// before the pay landed: fuel, truck payment, insurance, escrow,
// quickpay fee, service fee. Never tax — no tax is ever withheld
// from 1099 pay, and on a W-2 stub the lines itemize only the OTHER
// deductions (federal/state withholding keeps its own fields).
// Since 2026-10-30 the lines live on non-form entries in EITHER lane
// — filed by a stub scan or by the driver's own edit of the entry —
// always in the entry's own lane, never crossing lanes. The lines
// sum EXACTLY into the entry's otherDeductions total, so the entry
// can mirror the stub line by line. Out-of-pocket owner expenses are
// a different thing: they stay in the expense tracker and net in the
// packet separately — the same dollar is never counted in both
// places.

export interface DeductionLine {
  label: string;
  amount: number;
}

/** Typical labels printed on a settlement stub — offered as
 *  pick-or-type suggestions in the forms, never a closed list. */
export const TYPICAL_DEDUCTION_LABELS = [
  "Fuel",
  "Truck payment",
  "Insurance",
  "Escrow",
  "Quickpay fee",
  "Service fee",
] as const;

/** Clean a raw line list: trimmed non-empty labels, positive amounts
 *  rounded to cents, capped at 30 lines. Anything else is dropped. */
export function normalizeDeductionLines(lines: readonly DeductionLine[] | null | undefined): DeductionLine[] {
  if (!lines) return [];
  const out: DeductionLine[] = [];
  for (const l of lines) {
    const label = (l?.label ?? "").trim().slice(0, 80);
    const amount = fromCents(toCents(Number(l?.amount ?? 0)));
    if (!label || !(amount > 0)) continue;
    out.push({ label, amount });
    if (out.length >= 30) break;
  }
  return out;
}

/** The lines' total, cents-exact. When an entry carries lines, this
 *  IS the entry's other-deductions total (either lane) — never a
 *  second, separate number. */
export function sumDeductionLines(lines: readonly DeductionLine[]): number {
  return fromCents(lines.reduce((s, l) => s + toCents(l.amount), 0));
}

/** Parse the stored JSON column back into lines; a missing or
 *  unreadable value reads as no lines (legacy rows predate the
 *  column, and their lump otherDeductions figure still stands). */
export function parseDeductionLines(raw: string | null | undefined): DeductionLine[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeDeductionLines(parsed as DeductionLine[]);
  } catch {
    return [];
  }
}

/** Aggregate lines across entries by label (case-insensitive match,
 *  first-seen label wins the display), largest first — the packet's
 *  itemized view of everything that came off the stubs. */
export function aggregateDeductionLines(entries: readonly { deductionLines?: readonly DeductionLine[] }[]): DeductionLine[] {
  const map = new Map<string, { label: string; cents: number }>();
  for (const e of entries) {
    for (const l of e.deductionLines ?? []) {
      const key = l.label.trim().toLowerCase();
      const cur = map.get(key) ?? { label: l.label.trim(), cents: 0 };
      cur.cents += toCents(l.amount);
      map.set(key, cur);
    }
  }
  return [...map.values()]
    .map((v) => ({ label: v.label, amount: fromCents(v.cents) }))
    .sort((a, b) => b.amount - a.amount);
}

/** The labelled per-diem line both tax packets carry. Filing gross in
 *  either packet is taxable gross ONLY — this line is informational
 *  and is never added into a filing total. */
export const PER_DIEM_PACKET_LABEL =
  "Per diem (non-taxable, paid separately) — not included in filing gross";

/** Packet line for a pile's per-diem total, or null when there is no
 *  per diem to report (the packet then omits the line entirely). */
export function perDiemPacketLine(perDiemTotal: number): string | null {
  if (!(perDiemTotal > 0)) return null;
  const dollars = perDiemTotal.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${PER_DIEM_PACKET_LABEL}: $${dollars}`;
}

export interface PayEntryLike {
  kind: PayKind;
  // A year-end form entry records the W-2 / 1099 form itself as received
  // in January (payer + tax year + gross as printed). Form entries are
  // NEVER counted in the pay piles — the paychecks already counted that
  // money; the form is the paperwork that ties to the pile.
  isForm: boolean;
  payer: string;
  taxYear: number | null;
  gross: number;
  federalWithheld: number;
  stateWithheld: number;
  otherDeductions: number;
  /** Non-taxable per diem paid separately (see header). Optional so
   *  older callers/fixtures without the field read as 0. Form entries
   *  never count it even when a value is present. */
  perDiem?: number;
  /** Itemized deduction lines (either lane's stubs, since
   *  2026-10-30). Optional so older callers/fixtures read as none;
   *  when present on a check they sum into otherDeductions (the
   *  action layer guarantees the two agree). The 1099 packet lists
   *  the 1099 pile's lines aggregated; the W-2 packet lists each
   *  W-2 check's lines on its own line. */
  deductionLines?: DeductionLine[];
}

export interface ExpenseLike {
  category: string;
  amount: number;
}

export function toCents(n: number): number {
  return Math.round(n * 100);
}

export function fromCents(c: number): number {
  return c / 100;
}

export interface PayerTotal {
  payer: string;
  gross: number;
  federalWithheld: number;
  stateWithheld: number;
  perDiem: number;
  count: number;
}

export interface PayFormTotal {
  payer: string;
  taxYear: number | null;
  gross: number;
}

export interface PayBookSummary {
  w2: {
    /** Taxable gross — the filing figure. Per diem is NEVER in here. */
    gross: number;
    federalWithheld: number;
    stateWithheld: number;
    totalWithheld: number;
    otherDeductions: number;
    /** Gross − withholding − other deductions: what the taxable
     *  paycheck itself landed. Per diem is not in here either. */
    netPaid: number;
    /** Non-taxable per diem total for this pile, paid separately. */
    perDiemTotal: number;
    /** netPaid + per diem: everything the driver actually received. */
    totalReceived: number;
    count: number;
    byPayer: PayerTotal[];
  };
  ten99: {
    /** Taxable gross — the filing figure. Per diem is NEVER in here. */
    gross: number;
    federalWithheld: number;
    stateWithheld: number;
    otherDeductions: number;
    /** Itemized deduction lines aggregated across the pile's checks
     *  by label — the packet lists these and nets their total (which
     *  is otherDeductions) once against gross. */
    deductionLines: DeductionLine[];
    /** Non-taxable per diem total for this pile, paid separately. */
    perDiemTotal: number;
    /** (Gross − federal − state − other deductions) + per diem. */
    totalReceived: number;
    count: number;
    byPayer: PayerTotal[];
  };
  /** TRACKING ONLY — W-2 gross + 1099 gross (taxable). Never a filing number. */
  combinedGross: number;
  /** TRACKING ONLY — per diem across both piles, summed apart first. */
  combinedPerDiem: number;
  /** TRACKING ONLY — total received across both piles: the real
   *  earnings view, per diem included. Never a filing number. */
  combinedTotalReceived: number;
  forms: {
    w2: PayFormTotal[];
    ten99: PayFormTotal[];
    w2Gross: number;
    gross1099: number;
  };
  /** Expenses live on the 1099 / self-employment side. */
  expenses: {
    total: number;
    fuelTotal: number;
    byCategory: { category: string; amount: number }[];
  };
  /** 1099 gross − stub deductions (netted ONCE, from the itemized
   *  lines' total) − logged expenses − logged fuel purchases. A prep
   *  number for the 1099 packet, computed only from the driver's own
   *  logged records. Stub deductions and out-of-pocket expenses are
   *  different dollars — each is subtracted exactly once. */
  net1099: number;
  hasData: boolean;
}

function payerTotals(entries: PayEntryLike[]): PayerTotal[] {
  const map = new Map<string, { gross: number; fed: number; st: number; perDiem: number; count: number }>();
  for (const e of entries) {
    const cur = map.get(e.payer) ?? { gross: 0, fed: 0, st: 0, perDiem: 0, count: 0 };
    cur.gross += toCents(e.gross);
    cur.fed += toCents(e.federalWithheld);
    cur.st += toCents(e.stateWithheld);
    cur.perDiem += toCents(e.perDiem ?? 0);
    cur.count += 1;
    map.set(e.payer, cur);
  }
  return [...map.entries()]
    .map(([payer, v]) => ({
      payer,
      gross: fromCents(v.gross),
      federalWithheld: fromCents(v.fed),
      stateWithheld: fromCents(v.st),
      perDiem: fromCents(v.perDiem),
      count: v.count,
    }))
    .sort((a, b) => b.gross - a.gross);
}

export function summarizePayBook(
  entries: PayEntryLike[],
  expenseRows: ExpenseLike[],
  fuelTotal: number,
): PayBookSummary {
  const checks = entries.filter((e) => !e.isForm);
  const w2Checks = checks.filter((e) => e.kind === "w2");
  const n99Checks = checks.filter((e) => e.kind === "1099");

  const w2GrossC = w2Checks.reduce((s, e) => s + toCents(e.gross), 0);
  const w2FedC = w2Checks.reduce((s, e) => s + toCents(e.federalWithheld), 0);
  const w2StateC = w2Checks.reduce((s, e) => s + toCents(e.stateWithheld), 0);
  const w2OtherC = w2Checks.reduce((s, e) => s + toCents(e.otherDeductions), 0);
  // Per diem sums come from `checks` only — form entries are already
  // excluded above, so a form's per diem is never counted anywhere.
  const w2PerDiemC = w2Checks.reduce((s, e) => s + toCents(e.perDiem ?? 0), 0);
  const n99GrossC = n99Checks.reduce((s, e) => s + toCents(e.gross), 0);
  const n99FedC = n99Checks.reduce((s, e) => s + toCents(e.federalWithheld), 0);
  const n99StateC = n99Checks.reduce((s, e) => s + toCents(e.stateWithheld), 0);
  const n99OtherC = n99Checks.reduce((s, e) => s + toCents(e.otherDeductions), 0);
  const n99PerDiemC = n99Checks.reduce((s, e) => s + toCents(e.perDiem ?? 0), 0);
  const w2NetC = w2GrossC - w2FedC - w2StateC - w2OtherC;
  const n99ReceivedC = n99GrossC - n99FedC - n99StateC - n99OtherC + n99PerDiemC;

  const catMap = new Map<string, number>();
  for (const e of expenseRows) catMap.set(e.category, (catMap.get(e.category) ?? 0) + toCents(e.amount));
  const expenseTotalC = expenseRows.reduce((s, e) => s + toCents(e.amount), 0);
  const fuelC = toCents(fuelTotal);

  const formRows = entries.filter((e) => e.isForm);
  const formList = (kind: PayKind): PayFormTotal[] =>
    formRows
      .filter((e) => e.kind === kind)
      .map((e) => ({ payer: e.payer, taxYear: e.taxYear, gross: fromCents(toCents(e.gross)) }))
      .sort((a, b) => b.gross - a.gross);

  return {
    w2: {
      gross: fromCents(w2GrossC),
      federalWithheld: fromCents(w2FedC),
      stateWithheld: fromCents(w2StateC),
      totalWithheld: fromCents(w2FedC + w2StateC),
      otherDeductions: fromCents(w2OtherC),
      netPaid: fromCents(w2NetC),
      perDiemTotal: fromCents(w2PerDiemC),
      totalReceived: fromCents(w2NetC + w2PerDiemC),
      count: w2Checks.length,
      byPayer: payerTotals(w2Checks),
    },
    ten99: {
      gross: fromCents(n99GrossC),
      federalWithheld: fromCents(n99FedC),
      stateWithheld: fromCents(n99StateC),
      otherDeductions: fromCents(n99OtherC),
      deductionLines: aggregateDeductionLines(n99Checks),
      perDiemTotal: fromCents(n99PerDiemC),
      totalReceived: fromCents(n99ReceivedC),
      count: n99Checks.length,
      byPayer: payerTotals(n99Checks),
    },
    combinedGross: fromCents(w2GrossC + n99GrossC),
    combinedPerDiem: fromCents(w2PerDiemC + n99PerDiemC),
    combinedTotalReceived: fromCents(w2NetC + w2PerDiemC + n99ReceivedC),
    forms: {
      w2: formList("w2"),
      ten99: formList("1099"),
      w2Gross: fromCents(formRows.filter((e) => e.kind === "w2").reduce((s, e) => s + toCents(e.gross), 0)),
      gross1099: fromCents(formRows.filter((e) => e.kind === "1099").reduce((s, e) => s + toCents(e.gross), 0)),
    },
    expenses: {
      total: fromCents(expenseTotalC),
      fuelTotal: fromCents(fuelC),
      byCategory: [...catMap.entries()]
        .map(([category, c]) => ({ category, amount: fromCents(c) }))
        .sort((a, b) => b.amount - a.amount),
    },
    net1099: fromCents(n99GrossC - n99OtherC - expenseTotalC - fuelC),
    hasData: entries.length > 0,
  };
}

/** The Pay Book's Year-to-Date pies (x, 2026-10-30) — TWO separate
 *  lane pies, never one combined pie: "Keep W-2 & 1099 separate
 *  lanes. Don't mix." Each lane gets its own pie with three slices —
 *  that lane's gross, that lane's per diem (non-taxable, paid
 *  separately, on its own slice), and that lane's deductions. The
 *  slices are computed from the two piles summed APART (via
 *  summarizePayBook) and each lane's total is that lane's own pie
 *  denominator ONLY — there is deliberately NO combined total across
 *  the lanes anywhere in this shape, in the action, or in the UI.
 *  Tracking view only: no slice enters either tax packet, and the
 *  piles underneath stay separate for filing. Honest shape note (the
 *  UI states it beside each pie): a lane's deductions dollars already
 *  came out of that lane's gross, and its per diem was paid on top —
 *  so a lane pie's total is the sum of its three slices as drawn (a
 *  comparison total for that lane), not a filing figure. */
export interface PayBookYtdLaneSlices {
  /** The lane's taxable gross — the filing figure for that pile. */
  gross: number;
  /** The lane's own per diem — non-taxable, paid separately. */
  perDiem: number;
  /** Everything taken off that lane's pay before it landed. W-2 lane:
   *  federal + state withheld + other deductions. 1099 lane: the
   *  itemized stub deductions (a 1099 entry's federal/state are 0 by
   *  the filing rule; summed anyway so a legacy row can never hide a
   *  dollar in this lane). */
  deductions: number;
  /** Sum of THIS lane's three slices as drawn — this pie's own
   *  denominator. Never added to the other lane's total. */
  total: number;
}

export interface PayBookYtdSlices {
  w2: PayBookYtdLaneSlices;
  ten99: PayBookYtdLaneSlices;
}

function ytdLaneSlices(
  gross: number,
  perDiemTotal: number,
  federalWithheld: number,
  stateWithheld: number,
  otherDeductions: number,
): PayBookYtdLaneSlices {
  const grossC = toCents(gross);
  const perDiemC = toCents(perDiemTotal);
  const deductionsC = toCents(federalWithheld) + toCents(stateWithheld) + toCents(otherDeductions);
  return {
    gross: fromCents(grossC),
    perDiem: fromCents(perDiemC),
    deductions: fromCents(deductionsC),
    total: fromCents(grossC + perDiemC + deductionsC),
  };
}

export function payBookYtdSlices(s: PayBookSummary): PayBookYtdSlices {
  return {
    w2: ytdLaneSlices(s.w2.gross, s.w2.perDiemTotal, s.w2.federalWithheld, s.w2.stateWithheld, s.w2.otherDeductions),
    ten99: ytdLaneSlices(
      s.ten99.gross,
      s.ten99.perDiemTotal,
      s.ten99.federalWithheld,
      s.ten99.stateWithheld,
      s.ten99.otherDeductions,
    ),
  };
}

/** Rolling-window start (ms) for a Pay Book period, mirroring
 *  getMoneyTruth's windows and adding "year" (Jan 1 local) and "all". */
export function payBookPeriodStart(period: "week" | "month" | "quarter" | "year" | "all", nowMs: number): number {
  switch (period) {
    case "week":
      return nowMs - 7 * 86400000;
    case "month":
      return nowMs - 30 * 86400000;
    case "quarter":
      return nowMs - 92 * 86400000;
    case "year": {
      const d = new Date(nowMs);
      return new Date(d.getFullYear(), 0, 1).getTime();
    }
    case "all":
      return 0;
  }
}
