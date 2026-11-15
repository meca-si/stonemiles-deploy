/**
 * INVOICING + P&L — pure rules module (TMS completion queue item 3,
 * approved by x 2026-11-15; gap-tools-spec item 1).
 *
 * INVOICING: a branded invoice generated off a SEALED load. The
 * invoice is the who-owes-me board entry wearing a suit — its amount
 * is exactly the board's freight + claims figure for that load:
 *   freight = rate + additional charges (only ever off a real rate —
 *   a load with no rate on file cannot be invoiced, and this module
 *   returns a null amount rather than inventing one)
 *   claims  = the load's sealed claim events (TONU / layover /
 *   driver assist), grouped by kind on the bill.
 *
 * RATE LAW (unchanged, and the reason this module exists in this
 * shape): the load's rate appears ONLY on the invoice itself — the
 * bill the payer receives. Nothing here feeds a share link, a
 * receive page, or any public surface; the invoice document resolves
 * only through the owner's own Library scope.
 *
 * P&L: a rollup per load / month / quarter / year from the records
 * already in the app — sealed loads (income), claim events (income),
 * the expense tracker (costs, by the driver's own confirmed
 * category), fuel purchases (their own line, kept separate from any
 * fuel logged as an expense — the Tax Worksheet's two-block honesty,
 * so nothing double-counts), and the maintenance log (its own line).
 * Per-load lines carry the expenses FILED ON that load inside the
 * same period, so the load lines and the period totals reconcile:
 * period expenses = Σ per-load tagged + unassigned.
 *
 * Every rule is a pure function of its inputs (the settlement.ts /
 * taxYear.ts pattern) so the math is unit-tested without a database.
 * Records only: nothing here moves money.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

// ---------------------------------------------------------------------------
// Invoice construction
// ---------------------------------------------------------------------------

export interface InvoiceClaimLike {
  kind: string; // tonu | layover | driver_assist
  amount: number;
}

export interface InvoiceLoadLike {
  rate: number | null;
  extraCharges: number;
  extraChargesNote: string | null;
}

export interface InvoiceLine {
  label: string;
  amount: number;
}

export const CLAIM_KIND_LABELS: Record<string, string> = {
  tonu: "TONU (truck ordered, not used)",
  layover: "Layover",
  driver_assist: "Driver assist",
};

export function claimKindLabel(kind: string): string {
  return CLAIM_KIND_LABELS[kind] ?? kind;
}

/** The bill's lines for one sealed load: freight, additional
 *  charges (when any), then one line per claim kind present.
 *  `amount` is null when the load has no rate on file — an invoice
 *  is never figured off an invented rate. */
export function invoiceLinesFor(
  load: InvoiceLoadLike,
  claims: readonly InvoiceClaimLike[],
): { lines: InvoiceLine[]; freight: number | null; claimsTotal: number; amount: number | null } {
  const freight = load.rate != null ? round2(load.rate + (load.extraCharges ?? 0)) : null;
  const lines: InvoiceLine[] = [];
  if (freight != null) {
    lines.push({ label: "Freight", amount: round2(load.rate!) });
    if ((load.extraCharges ?? 0) > 0) {
      lines.push({
        label: `Additional charges${load.extraChargesNote ? ` — ${load.extraChargesNote}` : ""}`,
        amount: round2(load.extraCharges),
      });
    }
  }
  const byKind = new Map<string, number>();
  for (const c of claims) {
    if (!Number.isFinite(c.amount)) continue;
    byKind.set(c.kind, round2((byKind.get(c.kind) ?? 0) + c.amount));
  }
  let claimsTotal = 0;
  for (const [kind, amt] of byKind) {
    if (amt === 0) continue;
    lines.push({ label: claimKindLabel(kind), amount: amt });
    claimsTotal += amt;
  }
  claimsTotal = round2(claimsTotal);
  const amount = freight != null ? round2(freight + claimsTotal) : null;
  return { lines, freight, claimsTotal, amount };
}

/** Invoice numbers are per-driver sequential within the year:
 *  INV-2026-0001, INV-2026-0002, … The action counts the driver's
 *  existing numbers for the year and passes the next sequence. */
export function formatInvoiceNumber(year: number, seq: number): string {
  return `INV-${year}-${String(Math.max(1, Math.floor(seq))).padStart(4, "0")}`;
}

export type InvoiceStoredStatus = "draft" | "issued" | "paid";
export type InvoiceDisplayStatus = InvoiceStoredStatus | "overdue";

/** The status the driver sees: the stored lifecycle state, with
 *  "overdue" DERIVED from the due date (an issued invoice past its
 *  due date) — never a stored flag that could drift from the dates. */
export function invoiceDisplayStatus(
  inv: { status: string; dueAtMs: number | null },
  nowMs: number,
): InvoiceDisplayStatus {
  if (inv.status === "paid") return "paid";
  if (inv.status === "issued" && inv.dueAtMs != null && inv.dueAtMs < nowMs) return "overdue";
  return inv.status === "issued" ? "issued" : "draft";
}

/** Default payment terms when the driver doesn't pick: Net 30. */
export const DEFAULT_DUE_DAYS = 30;

// ---------------------------------------------------------------------------
// Profit & loss
// ---------------------------------------------------------------------------

export type PlPeriodKind = "month" | "quarter" | "year";

export interface PlPeriod {
  kind: PlPeriodKind;
  year: number;
  /** Month 1–12 for kind "month", quarter 1–4 for "quarter", 1 for "year". */
  index: number;
  startMs: number;
  endMs: number;
  /** Ref-safe key, e.g. "month:2026:11". */
  key: string;
  label: string;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** The UTC period range for a month / quarter / year. Periods are
 *  UTC like the Tax Worksheet's counts, so a statement reads the
 *  same on every device in every timezone the driver crosses. */
export function plPeriodRange(kind: PlPeriodKind, year: number, index: number): PlPeriod {
  const y = Math.min(2100, Math.max(2020, Math.floor(year) || 2020));
  if (kind === "month") {
    const m = Math.min(12, Math.max(1, Math.floor(index) || 1));
    return {
      kind, year: y, index: m,
      startMs: Date.UTC(y, m - 1, 1),
      endMs: Date.UTC(y, m, 1),
      key: `month:${y}:${m}`,
      label: `${MONTH_NAMES[m - 1]} ${y}`,
    };
  }
  if (kind === "quarter") {
    const q = Math.min(4, Math.max(1, Math.floor(index) || 1));
    return {
      kind, year: y, index: q,
      startMs: Date.UTC(y, (q - 1) * 3, 1),
      endMs: Date.UTC(y, q * 3, 1),
      key: `quarter:${y}:${q}`,
      label: `Q${q} ${y}`,
    };
  }
  return {
    kind: "year", year: y, index: 1,
    startMs: Date.UTC(y, 0, 1),
    endMs: Date.UTC(y + 1, 0, 1),
    key: `year:${y}:1`,
    label: `${y}`,
  };
}

export interface PlLoadLike {
  loadId: number;
  /** POD-sealed (delivery) time — the load's income lands in the
   *  period it was delivered, like the owed board's aging. */
  deliveredAtMs: number;
  /** rate + additional charges; null = no rate on file (the load
   *  still lists, with null income — never invented). */
  gross: number | null;
  claimsTotal: number;
}

export interface PlExpenseLike {
  spentAtMs: number;
  category: string;
  amount: number;
  loadId: number | null;
}

export interface PlFuelLike {
  purchasedAtMs: number;
  total: number;
}

export interface PlMaintenanceLike {
  performedAtMs: number;
  cost: number;
}

export interface PlCostLine {
  key: string;
  label: string;
  amount: number;
}

export interface PlLoadLine {
  loadId: number;
  income: number | null;
  costs: number;
  net: number | null;
}

export interface ProfitLoss {
  period: PlPeriod;
  incomeFreight: number;
  incomeClaims: number;
  incomeTotal: number;
  /** Loads delivered in the period whose income couldn't be figured
   *  (no rate on file) — counted, never silently dropped. */
  unfiguredLoads: number;
  costLines: PlCostLine[];
  costsTotal: number;
  net: number;
  perLoad: PlLoadLine[];
  /** Expenses spent in the period that no load claims — with the
   *  per-load tagged costs, they reconcile the period expense total. */
  unassignedExpenses: number;
}

/** Expense-category display labels for the statement (the records
 *  keep the driver's confirmed category; only the label is dressed). */
export const PL_EXPENSE_LABELS: Record<string, string> = {
  fuel: "Fuel (logged as an expense)",
  maintenance: "Maintenance (expense tracker)",
  repairs: "Repairs (expense tracker)",
  tolls: "Tolls",
  lumper: "Lumper fees",
  insurance: "Insurance",
  scale: "Scale tickets",
  parking: "Parking",
  permits: "Permits",
  meals: "Meals",
  supplies: "Supplies & equipment",
  dot_testing: "DOT testing / physical",
  licensing: "Licensing & fees",
  software: "Software & satellite",
  other: "Other expenses",
};

const inPeriod = (ms: number, p: PlPeriod) => Number.isFinite(ms) && ms >= p.startMs && ms < p.endMs;

/** Assemble one period's profit & loss from the driver's own
 *  records. Income: sealed loads delivered in the period (freight +
 *  their claim events). Costs: fuel purchases in the period (their
 *  own line), expenses spent in the period by confirmed category,
 *  maintenance log costs performed in the period (their own line). */
export function buildProfitLoss(input: {
  loads: readonly PlLoadLike[];
  expenses: readonly PlExpenseLike[];
  fuelPurchases: readonly PlFuelLike[];
  maintenance: readonly PlMaintenanceLike[];
  period: PlPeriod;
}): ProfitLoss {
  const { period } = input;

  // Income — loads delivered in the period.
  const loadsIn = input.loads.filter((l) => inPeriod(l.deliveredAtMs, period));
  let incomeFreight = 0;
  let incomeClaims = 0;
  let unfiguredLoads = 0;
  const incomeByLoad = new Map<number, number | null>();
  for (const l of loadsIn) {
    incomeClaims += l.claimsTotal;
    if (l.gross == null) {
      unfiguredLoads++;
      incomeByLoad.set(l.loadId, null);
    } else {
      incomeFreight += l.gross;
      incomeByLoad.set(l.loadId, round2(l.gross + l.claimsTotal));
    }
  }
  incomeFreight = round2(incomeFreight);
  incomeClaims = round2(incomeClaims);

  // Costs — expenses spent in the period, split per load / unassigned.
  const taggedByLoad = new Map<number, number>();
  const byCategory = new Map<string, number>();
  let unassignedExpenses = 0;
  let expenseTotal = 0;
  for (const e of input.expenses) {
    if (!inPeriod(e.spentAtMs, period) || !Number.isFinite(e.amount)) continue;
    expenseTotal += e.amount;
    byCategory.set(e.category, round2((byCategory.get(e.category) ?? 0) + e.amount));
    if (e.loadId != null && loadsIn.some((l) => l.loadId === e.loadId)) {
      taggedByLoad.set(e.loadId, round2((taggedByLoad.get(e.loadId) ?? 0) + e.amount));
    } else {
      unassignedExpenses += e.amount;
    }
  }
  expenseTotal = round2(expenseTotal);
  unassignedExpenses = round2(unassignedExpenses);

  const fuelTotal = round2(
    input.fuelPurchases.filter((f) => inPeriod(f.purchasedAtMs, period)).reduce((s, f) => s + (Number.isFinite(f.total) ? f.total : 0), 0),
  );
  const maintTotal = round2(
    input.maintenance.filter((m) => inPeriod(m.performedAtMs, period)).reduce((s, m) => s + (Number.isFinite(m.cost) ? m.cost : 0), 0),
  );

  const costLines: PlCostLine[] = [];
  if (fuelTotal > 0) costLines.push({ key: "fuel_purchases", label: "Fuel purchases", amount: fuelTotal });
  const catLines = [...byCategory.entries()]
    .map(([category, amount]) => ({ key: `expense:${category}`, label: PL_EXPENSE_LABELS[category] ?? category, amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
  costLines.push(...catLines);
  if (maintTotal > 0) costLines.push({ key: "maintenance_log", label: "Maintenance log", amount: maintTotal });

  const costsTotal = round2(costLines.reduce((s, l) => s + l.amount, 0));
  const incomeTotal = round2(incomeFreight + incomeClaims);

  const perLoad: PlLoadLine[] = loadsIn
    .map((l) => {
      const income = incomeByLoad.get(l.loadId) ?? null;
      const costs = taggedByLoad.get(l.loadId) ?? 0;
      return { loadId: l.loadId, income, costs, net: income != null ? round2(income - costs) : null };
    })
    .sort((a, b) => a.loadId - b.loadId);

  return {
    period,
    incomeFreight,
    incomeClaims,
    incomeTotal,
    unfiguredLoads,
    costLines,
    costsTotal,
    net: round2(incomeTotal - costsTotal),
    perLoad,
    unassignedExpenses,
  };
}

/** One money line for documents (invoice / statement PDFs). */
export function moneyLine(label: string, amount: number): string {
  return `${label}: ${money(amount)}`;
}
