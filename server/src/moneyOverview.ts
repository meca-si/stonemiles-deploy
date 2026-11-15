/**
 * MONEY OVERVIEW — pure rules module (owner's build, 2026-11-15).
 *
 * The DrayageIQ-style earnings dashboard at the top of the Money tab:
 * year-to-date at the top, what you kept vs what was taken out,
 * deductions broken into categories, your real rate per mile over
 * your sealed loads, and the week-by-week earnings trend.
 *
 * EVERY number here is computed from the driver's OWN records that
 * already exist in the app — their Pay Book entries (paychecks they
 * logged or accepted) and their sealed loads' miles. Nothing is
 * sampled, estimated silently, or invented: a week with no records is
 * a gap, a year with too little history gets NO projection, and miles
 * only ever come from sealed loads.
 *
 * DEDUCTION CATEGORIES. Pay Book deduction lines are free-text labels
 * the driver (or a stub scan) typed — "Fuel", "Truck payment",
 * "Escrow" — with TYPICAL_DEDUCTION_LABELS as suggestions, never a
 * closed list. This module classifies each label deterministically
 * into the overview's buckets (Fuel / Operations / Insurance /
 * Escrow / Other), plus "Taxes withheld" for the federal + state
 * fields (a W-2 figure — DrayageIQ's lease-op audience has none, but
 * a W-2 driver's withheld tax is a real deduction and it must land
 * somewhere honest). Classification is a pure function of the label,
 * run at read time, so historical entries classify identically
 * forever and no stored category can drift from its label.
 *
 * THE SUM PIN: every recorded deduction dollar lands in exactly one
 * category. Lines classify by label; when an entry's itemized lines
 * sum to less than its otherDeductions total (a legacy lump with no
 * lines, or a partial itemization), the unitemized remainder goes to
 * Other — never dropped, never double-counted. Category amounts
 * therefore always sum EXACTLY to total deductions (unit-pinned).
 *
 * W-2 / 1099 stay separate piles for FILING (summarizePayBook's
 * locked rule) — this overview is a TRACKING view of the driver's
 * whole year, the same standing the Pay Book's combined tracking
 * total already has. It files nothing.
 *
 * Pure functions only (the settlement / credentialAlerts pattern) —
 * the action layer fetches rows and hands them in.
 */

import { fromCents, toCents, type DeductionLine } from "./payBook";

export type DeductionCategory =
  | "Fuel"
  | "Operations"
  | "Insurance"
  | "Escrow"
  | "Taxes withheld"
  | "Other";

/** Display order for the category rows (largest-first is applied on
 *  top of this only for ties — the rows themselves sort by amount). */
export const DEDUCTION_CATEGORIES: readonly DeductionCategory[] = [
  "Fuel",
  "Operations",
  "Insurance",
  "Escrow",
  "Taxes withheld",
  "Other",
];

/**
 * Classify one free-text deduction label into an overview bucket.
 * Deterministic keyword rules, checked in an order that resolves the
 * known collisions first (an "escrow" line is escrow even when it
 * says "maintenance escrow"; "cargo insurance" is insurance, not
 * operations). Anything unrecognized is honestly Other.
 */
export function classifyDeductionLabel(label: string): DeductionCategory {
  const norm = label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const words = norm.split(" ").filter(Boolean);
  const hasWord = (...ws: string[]) => ws.some((w) => words.includes(w));
  const hasPhrase = (...ps: string[]) => ps.some((p) => ` ${norm} `.includes(` ${p} `));
  // Escrow first: "maintenance escrow" / "escrow reserve" are escrow,
  // not operations.
  if (hasWord("escrow") || hasPhrase("reserve fund")) return "Escrow";
  if (
    hasWord("insurance", "bobtail", "liability", "health") ||
    hasPhrase("physical damage", "occ acc", "workers comp", "work comp")
  ) return "Insurance";
  if (hasWord("fuel", "diesel", "gasoline", "def")) return "Fuel";
  if (
    hasWord(
      "truck", "trailer", "lease", "payment", "payments", "quickpay", "fee", "fees",
      "dispatch", "factoring", "toll", "tolls", "scale", "permit", "permits",
      "maintenance", "repair", "repairs", "tire", "tires", "eld", "lumper", "rent",
      "phone", "ifta", "loan", "interest", "registration", "plates",
    ) ||
    hasPhrase("quick pay", "service fee")
  ) return "Operations";
  return "Other";
}

export interface MoneyOverviewEntryLike {
  /** Pay date (ms since epoch) — Pay Book entries are stamped at
   *  local noon, so the UTC calendar reads as the driver's calendar. */
  paidAtMs: number;
  kind: "w2" | "1099";
  /** Year-end form entries never count (the paychecks already did). */
  isForm: boolean;
  gross: number;
  federalWithheld: number;
  stateWithheld: number;
  otherDeductions: number;
  /** Non-taxable per diem, paid separately — never a deduction,
   *  never in gross; reported on its own line. */
  perDiem?: number;
  /** Itemized deduction lines; when present they itemize part or all
   *  of otherDeductions (the action layer keeps the two in step). */
  deductionLines?: readonly DeductionLine[];
}

export interface MoneyOverviewLoadLike {
  /** When the load's POD sealed (ms since epoch). */
  sealedAtMs: number;
  /** Total miles the load ran (loaded + deadhead where recorded). */
  miles: number;
}

export interface CategoryTotal {
  category: DeductionCategory;
  amount: number;
  /** Share of total deductions, 0–100, one decimal. */
  sharePct: number;
}

export interface OverviewWeek {
  /** Monday 00:00 UTC of this week. */
  weekStartMs: number;
  /** Short label, e.g. "Nov 9". */
  label: string;
  gross: number;
  deductions: number;
  net: number;
  miles: number;
  hasData: boolean;
}

export interface MoneyOverview {
  year: number;
  /** True when at least one paycheck is on file for the year. */
  hasData: boolean;
  ytd: {
    gross: number;
    deductions: number;
    /** gross − deductions: what the year's paychecks actually landed. */
    net: number;
    /** Per diem paid separately across the year (not in net). */
    perDiem: number;
    /** net / gross as a percent, one decimal; null when no gross. */
    marginPct: number | null;
    /** Sealed-load miles inside the year. */
    miles: number;
    /** gross / sealed miles; null when no sealed miles on file. */
    grossPerMile: number | null;
    /** net / sealed miles; null when no sealed miles on file. */
    netPerMile: number | null;
    entryCount: number;
  };
  /** The keep-vs-taken-out split of the year's gross. */
  keep: { kept: number; takenOut: number };
  /** Every category with a nonzero amount, largest first; amounts
   *  sum exactly to ytd.deductions. */
  categories: CategoryTotal[];
  milesThisWeek: number;
  milesThisMonth: number;
  /** Week buckets for the year so far (last 26 when the year runs
   *  longer), oldest first. Empty weeks are gaps, never filled in. */
  weeks: OverviewWeek[];
  /** Mean net across the displayed weeks that have data is NOT used —
   *  this is the mean weekly net over all elapsed weeks of the year
   *  (the honest run rate, empty weeks included); null with no data. */
  avgWeeklyNet: number | null;
  /** Full-year projection from the year-to-date weekly run rate.
   *  Present ONLY with at least 4 weeks containing entries —
   *  thinner history gets no projection rather than a guess. */
  projection: {
    annualGross: number;
    annualNet: number;
    weeksElapsed: number;
    weeksWithEntries: number;
  } | null;
}

const DAY_MS = 86400000;

/** Monday 00:00 UTC of the week containing `ms`. */
export function weekStartMs(ms: number): number {
  const d = new Date(ms);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dow = new Date(midnight).getUTCDay(); // 0 = Sunday
  return midnight - ((dow + 6) % 7) * DAY_MS;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function weekLabel(startMs: number): string {
  const d = new Date(startMs);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Categorize one entry's deductions into bucket cents. The withheld
 *  fields are their own bucket; itemized lines classify by label;
 *  any unitemized remainder of otherDeductions lands in Other. */
function categorizeEntry(e: MoneyOverviewEntryLike, into: Map<DeductionCategory, number>): void {
  const add = (c: DeductionCategory, cents: number) => {
    if (cents !== 0) into.set(c, (into.get(c) ?? 0) + cents);
  };
  add("Taxes withheld", toCents(e.federalWithheld) + toCents(e.stateWithheld));
  let itemizedC = 0;
  for (const line of e.deductionLines ?? []) {
    const c = toCents(line.amount);
    if (c <= 0) continue;
    itemizedC += c;
    add(classifyDeductionLabel(line.label), c);
  }
  const otherC = toCents(e.otherDeductions);
  const remainderC = otherC - itemizedC;
  // A remainder only exists when the lines under-itemize the lump;
  // if lines somehow exceed it, the lines are the driver's own
  // itemization and stand (the total below still uses the fields, so
  // the action layer's agreement guarantee is what keeps them equal —
  // the overview never invents a negative Other).
  if (remainderC > 0) add("Other", remainderC);
}

export function computeMoneyOverview(
  entries: readonly MoneyOverviewEntryLike[],
  loads: readonly MoneyOverviewLoadLike[],
  nowMs: number,
): MoneyOverview {
  const year = new Date(nowMs).getUTCFullYear();
  const yearStartMs = Date.UTC(year, 0, 1);
  const yearEndMs = Date.UTC(year + 1, 0, 1);
  const inYear = (ms: number) => ms >= yearStartMs && ms < yearEndMs;

  const checks = entries.filter((e) => !e.isForm && inYear(e.paidAtMs));

  let grossC = 0;
  let deductionsC = 0;
  let perDiemC = 0;
  const catCents = new Map<DeductionCategory, number>();
  for (const e of checks) {
    grossC += toCents(e.gross);
    deductionsC += toCents(e.federalWithheld) + toCents(e.stateWithheld) + toCents(e.otherDeductions);
    perDiemC += toCents(e.perDiem ?? 0);
    categorizeEntry(e, catCents);
  }
  const netC = grossC - deductionsC;

  const yearLoads = loads.filter((l) => inYear(l.sealedAtMs));
  const miles = yearLoads.reduce((s, l) => s + (l.miles > 0 ? l.miles : 0), 0);
  const milesRounded = Math.round(miles * 10) / 10;

  // Week buckets: from the week containing Jan 1 through the week
  // containing now. Totals cover the whole year regardless of how
  // many weeks are displayed.
  const firstWeek = weekStartMs(yearStartMs);
  const currentWeek = weekStartMs(nowMs);
  const elapsedWeeks = Math.floor((currentWeek - firstWeek) / (7 * DAY_MS)) + 1;
  const weekBuckets = new Map<number, { grossC: number; dedC: number; miles: number; has: boolean }>();
  const bucketFor = (ms: number) => {
    const key = weekStartMs(ms);
    let b = weekBuckets.get(key);
    if (!b) {
      b = { grossC: 0, dedC: 0, miles: 0, has: false };
      weekBuckets.set(key, b);
    }
    return b;
  };
  const entryWeeks = new Set<number>();
  for (const e of checks) {
    const b = bucketFor(e.paidAtMs);
    b.grossC += toCents(e.gross);
    b.dedC += toCents(e.federalWithheld) + toCents(e.stateWithheld) + toCents(e.otherDeductions);
    b.has = true;
    entryWeeks.add(weekStartMs(e.paidAtMs));
  }
  for (const l of yearLoads) {
    const b = bucketFor(l.sealedAtMs);
    b.miles += l.miles > 0 ? l.miles : 0;
    if (l.miles > 0) b.has = true;
  }
  const weeksWithEntries = entryWeeks.size;

  const displayStartIdx = Math.max(0, elapsedWeeks - 26);
  const weeks: OverviewWeek[] = [];
  for (let i = displayStartIdx; i < elapsedWeeks; i++) {
    const start = firstWeek + i * 7 * DAY_MS;
    const b = weekBuckets.get(start);
    const g = b ? b.grossC : 0;
    const d = b ? b.dedC : 0;
    weeks.push({
      weekStartMs: start,
      label: weekLabel(start),
      gross: fromCents(g),
      deductions: fromCents(d),
      net: fromCents(g - d),
      miles: Math.round((b?.miles ?? 0) * 10) / 10,
      hasData: b?.has ?? false,
    });
  }

  const nowD = new Date(nowMs);
  const monthStartMs = Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth(), 1);
  const milesThisWeek = yearLoads
    .filter((l) => weekStartMs(l.sealedAtMs) === currentWeek)
    .reduce((s, l) => s + (l.miles > 0 ? l.miles : 0), 0);
  const milesThisMonth = yearLoads
    .filter((l) => l.sealedAtMs >= monthStartMs)
    .reduce((s, l) => s + (l.miles > 0 ? l.miles : 0), 0);

  const categories: CategoryTotal[] = [...catCents.entries()]
    .filter(([, c]) => c !== 0)
    .map(([category, c]) => ({
      category,
      amount: fromCents(c),
      sharePct: deductionsC > 0 ? round1((c / deductionsC) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  const hasData = checks.length > 0;
  return {
    year,
    hasData,
    ytd: {
      gross: fromCents(grossC),
      deductions: fromCents(deductionsC),
      net: fromCents(netC),
      perDiem: fromCents(perDiemC),
      marginPct: grossC > 0 ? round1((netC / grossC) * 100) : null,
      miles: milesRounded,
      grossPerMile: miles > 0 ? Math.round((fromCents(grossC) / miles) * 100) / 100 : null,
      netPerMile: miles > 0 ? Math.round((fromCents(netC) / miles) * 100) / 100 : null,
      entryCount: checks.length,
    },
    keep: { kept: fromCents(netC), takenOut: fromCents(deductionsC) },
    categories,
    milesThisWeek: Math.round(milesThisWeek * 10) / 10,
    milesThisMonth: Math.round(milesThisMonth * 10) / 10,
    weeks,
    avgWeeklyNet: hasData ? fromCents(Math.round(netC / elapsedWeeks)) : null,
    projection:
      hasData && weeksWithEntries >= 4
        ? {
            annualGross: fromCents(Math.round((grossC / elapsedWeeks) * 52)),
            annualNet: fromCents(Math.round((netC / elapsedWeeks) * 52)),
            weeksElapsed: elapsedWeeks,
            weeksWithEntries,
          }
        : null,
  };
}
