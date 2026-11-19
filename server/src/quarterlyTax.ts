// Quarterly Tax math — pure helpers (no DB, no ctx) for the Pay Book's
// Quarterly Tax card, so the estimate rules are unit-testable in the
// suite's usual style.
//
// x's ask (2026-11-18): "Do the app add up 1099 quarterly taxes?" — the
// Pay Book totalled the 1099 lane by year and the P&L could show a
// calendar quarter's net, but nothing figured the quarterly estimated
// tax itself. This module does, under the codebase's honesty rules:
//
//  - 1099 LANE ONLY. W-2 pay never enters this card — its tax is
//    withheld by the employer, and the lanes law keeps the piles apart
//    everywhere, here included. Form entries never count (the
//    paychecks already counted that money).
//  - The periods are the IRS estimated-tax periods, NOT calendar
//    quarters: P1 Jan–Mar (due Apr 15), P2 Apr–May (due Jun 15),
//    P3 Jun–Aug (due Sep 15), P4 Sep–Dec (due Jan 15 of the next
//    year). Bucketing is by UTC month — Pay Book entries are stamped
//    at local noon, so the UTC month is the driver's month across US
//    timezones, the same basis the Year-to-Date pies use for years.
//  - A period's net mirrors the 1099 packet exactly (summarizePayBook's
//    net1099, per period): 1099 gross − stub deductions − logged
//    expenses − logged fuel purchases. Stub deductions and
//    out-of-pocket expenses are different dollars; each is subtracted
//    exactly once. Per diem never enters — it is non-taxable, paid
//    separately, and never part of a filing gross.
//  - The estimate is a SET-ASIDE figure, built to err high, never low:
//    self-employment tax at the real Schedule SE shape — 15.3% on
//    92.35% of net — figured BEFORE the Social Security wage cap (a
//    driver whose year runs past the cap really owes less; the card
//    says so, and the preparer applies the cap) — plus income tax at
//    the driver's own picked rate on the same net. No state tax is
//    guessed: states differ too much for an honest default.
//  - This is a planning estimate from the driver's own logged
//    records — not tax advice, not a filing. The UI carries that
//    label verbatim.

import { fromCents, toCents } from "./payBook";

export interface QuarterlyPayEntryLike {
  paidAtMs: number;
  kind: "w2" | "1099";
  isForm: boolean;
  gross: number;
  /** The entry's stub deductions total (itemized lines sum into it —
   *  the action layer guarantees the two agree). */
  otherDeductions: number;
}

export interface QuarterlyExpenseLike {
  spentAtMs: number;
  amount: number;
}

export interface QuarterlyFuelLike {
  purchasedAtMs: number;
  total: number;
}

export type DueState = "upcoming" | "open" | "past";

export interface QuarterlyPeriod {
  period: 1 | 2 | 3 | 4;
  /** The IRS period's months, e.g. "Apr – May" (P2 is only two). */
  monthsLabel: string;
  /** Period start / end as YYYY-MM-DD (UTC calendar dates). */
  startIso: string;
  endIso: string;
  /** The IRS due date as YYYY-MM-DD. */
  dueIso: string;
  /** The due date in words, e.g. "Apr 15, 2026". */
  dueLabel: string;
  dueState: DueState;
  gross1099: number;
  stubDeductions: number;
  /** Out-of-pocket expenses from the expense tracker. */
  expenses: number;
  /** Fuel purchases, kept apart from expenses so nothing double-counts. */
  fuel: number;
  /** gross − stub deductions − expenses − fuel. May be negative. */
  net: number;
  /** Self-employment tax estimate on max(0, net). */
  seTax: number;
  /** Income tax estimate at the picked rate on max(0, net). */
  incomeTax: number;
  /** seTax + incomeTax — what to set aside for this period. */
  setAside: number;
  /** 1099 paychecks (non-form) that landed in this period. */
  count: number;
}

export interface QuarterlyTaxSummary {
  year: number;
  incomeRatePct: number;
  periods: QuarterlyPeriod[];
  totals: {
    gross1099: number;
    stubDeductions: number;
    expenses: number;
    fuel: number;
    net: number;
    seTax: number;
    incomeTax: number;
    setAside: number;
    count: number;
  };
  /** Any 1099 paycheck logged in the year at all. */
  hasData: boolean;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** The four IRS estimated-tax periods. Months are 0-based UTC months;
 *  P4's due date falls in January of the NEXT year. */
const PERIOD_DEFS = [
  { period: 1, monthsLabel: "Jan – Mar", startMonth: 0, endMonth: 2, dueMonth: 3, dueDay: 15, dueYearOffset: 0 },
  { period: 2, monthsLabel: "Apr – May", startMonth: 3, endMonth: 4, dueMonth: 5, dueDay: 15, dueYearOffset: 0 },
  { period: 3, monthsLabel: "Jun – Aug", startMonth: 5, endMonth: 7, dueMonth: 8, dueDay: 15, dueYearOffset: 0 },
  { period: 4, monthsLabel: "Sep – Dec", startMonth: 8, endMonth: 11, dueMonth: 0, dueDay: 15, dueYearOffset: 1 },
] as const;

function dateIso(year: number, month0: number, day: number): string {
  return `${year}-${String(month0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function lastDayIso(year: number, month0: number): string {
  // Day 0 of the next month is this month's last day.
  const d = new Date(Date.UTC(year, month0 + 1, 0));
  return dateIso(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Which IRS period (1–4) a UTC month index falls in. */
function periodForMonth(month0: number): 1 | 2 | 3 | 4 {
  if (month0 <= 2) return 1;
  if (month0 <= 4) return 2;
  if (month0 <= 7) return 3;
  return 4;
}

/** The picked income-tax rate, clamped to the sane planning band. */
export function clampIncomeRatePct(rate: number): number {
  if (!Number.isFinite(rate)) return 12;
  return Math.min(40, Math.max(0, Math.round(rate * 10) / 10));
}

/**
 * Add up one year's 1099 lane by IRS estimated-tax period and estimate
 * the set-aside for each. All money math runs in integer cents and
 * converts back at the boundary, like the rest of the Pay Book.
 */
export function summarizeQuarterlyTax(
  entries: QuarterlyPayEntryLike[],
  expenses: QuarterlyExpenseLike[],
  fuel: QuarterlyFuelLike[],
  year: number,
  incomeRatePct: number,
  nowMs: number,
): QuarterlyTaxSummary {
  const rate = clampIncomeRatePct(incomeRatePct);
  const buckets = PERIOD_DEFS.map(() => ({ grossC: 0, stubC: 0, expC: 0, fuelC: 0, count: 0 }));

  for (const e of entries) {
    if (e.kind !== "1099" || e.isForm) continue;
    if (!Number.isFinite(e.paidAtMs)) continue;
    const d = new Date(e.paidAtMs);
    if (d.getUTCFullYear() !== year) continue;
    const b = buckets[periodForMonth(d.getUTCMonth()) - 1]!;
    b.grossC += toCents(e.gross);
    b.stubC += toCents(e.otherDeductions);
    b.count += 1;
  }
  for (const e of expenses) {
    if (!Number.isFinite(e.spentAtMs) || !Number.isFinite(e.amount)) continue;
    const d = new Date(e.spentAtMs);
    if (d.getUTCFullYear() !== year) continue;
    buckets[periodForMonth(d.getUTCMonth()) - 1]!.expC += toCents(e.amount);
  }
  for (const f of fuel) {
    if (!Number.isFinite(f.purchasedAtMs) || !Number.isFinite(f.total)) continue;
    const d = new Date(f.purchasedAtMs);
    if (d.getUTCFullYear() !== year) continue;
    buckets[periodForMonth(d.getUTCMonth()) - 1]!.fuelC += toCents(f.total);
  }

  const periods: QuarterlyPeriod[] = PERIOD_DEFS.map((def, i) => {
    const b = buckets[i]!;
    const netC = b.grossC - b.stubC - b.expC - b.fuelC;
    const taxableC = Math.max(0, netC);
    // Schedule SE shape: 92.35% of net is subject to the 15.3% rate.
    const seTaxC = Math.round(Math.round(taxableC * 0.9235) * 0.153);
    const incomeTaxC = Math.round(taxableC * (rate / 100));
    const startIso = dateIso(year, def.startMonth, 1);
    const dueYear = year + def.dueYearOffset;
    const dueIso = dateIso(dueYear, def.dueMonth, def.dueDay);
    const startMs = Date.parse(`${startIso}T00:00:00Z`);
    const dueEndMs = Date.parse(`${dueIso}T23:59:59.999Z`);
    const dueState: DueState = nowMs < startMs ? "upcoming" : nowMs > dueEndMs ? "past" : "open";
    return {
      period: def.period as 1 | 2 | 3 | 4,
      monthsLabel: def.monthsLabel,
      startIso,
      endIso: lastDayIso(year, def.endMonth),
      dueIso,
      dueLabel: `${MONTH_NAMES[def.dueMonth]!} ${def.dueDay}, ${dueYear}`,
      dueState,
      gross1099: fromCents(b.grossC),
      stubDeductions: fromCents(b.stubC),
      expenses: fromCents(b.expC),
      fuel: fromCents(b.fuelC),
      net: fromCents(netC),
      seTax: fromCents(seTaxC),
      incomeTax: fromCents(incomeTaxC),
      setAside: fromCents(seTaxC + incomeTaxC),
      count: b.count,
    };
  });

  const sum = (pick: (p: QuarterlyPeriod) => number) => fromCents(periods.reduce((s, p) => s + toCents(pick(p)), 0));
  return {
    year,
    incomeRatePct: rate,
    periods,
    totals: {
      gross1099: sum((p) => p.gross1099),
      stubDeductions: sum((p) => p.stubDeductions),
      expenses: sum((p) => p.expenses),
      fuel: sum((p) => p.fuel),
      net: sum((p) => p.net),
      seTax: sum((p) => p.seTax),
      incomeTax: sum((p) => p.incomeTax),
      setAside: sum((p) => p.setAside),
      count: periods.reduce((s, p) => s + p.count, 0),
    },
    hasData: periods.some((p) => p.count > 0),
  };
}
