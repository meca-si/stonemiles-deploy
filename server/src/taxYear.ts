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
 *  whatever the driver confirmed.) */
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
  "other",
] as const;
