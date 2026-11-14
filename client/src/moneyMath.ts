// moneyMath.ts — the Money & Flow batch's pure logic (no DOM, no
// React), like trailer.ts / loadRate.ts, so every rule here is
// unit-testable (see moneyMath.test.ts). The UI lives in
// MoneyFlow.tsx; persistence lives in the server actions (personal
// docs, load payments, claim events, maintenance services, breakdown
// logs — migrations 0102).
//
// What this module owns:
//  - document-expiry alert tiers (30 / 14 / 7 days out + expired),
//    computed from the expiry dates the DRIVER entered in the vault;
//  - the "Who owes me" board math: what's still owed on a delivered
//    load (freight + sealed claim events − payments the driver
//    recorded), days outstanding, aging buckets, oldest-first order;
//  - the TRUE rate per load: total pay ÷ ALL miles (loaded +
//    deadhead), and net-after-fuel — from fuel LOGGED against the
//    load where it exists, otherwise an estimate built from the
//    driver's own logged fuel purchases' average price and the
//    truck's MPG, labelled an estimate plainly. A fuel cost is never
//    fabricated: with no logged price basis there is no net figure;
//  - the IFTA estimator row math — the same formula the server runs
//    (tax owed = (state miles ÷ MPG) × rate, minus tax already paid
//    on fuel bought in that state), kept here so the panel and the
//    tests share one definition. Rates live server-side from the
//    published IFTA matrix; a jurisdiction with no loaded rate gets
//    nulls and the UI prints "rate not loaded";
//  - maintenance countdown math: miles remaining from the odometer
//    the app already records (fuel / DVIR / daily-log entries) plus
//    driver-set intervals, with due / overdue states;
//  - breakdown downtime + cost totals.
//
// Standing rules held throughout: records only — nothing here moves
// money, sends an invoice, dispatches anyone, or files a tax return.

// ---------- 1) Document expiry wallet ----------------------------------------

export type DocAlertTier = "expired" | "due7" | "due14" | "due30" | "ok" | "no_date";

/** The five documents the expiry wallet tracks, in display order.
 *  Keys match the personal_docs kinds on the server (dot_inspection
 *  was added with this batch). */
export const WALLET_DOC_KINDS = [
  { key: "cdl", label: "CDL" },
  { key: "medical", label: "Medical card" },
  { key: "registration", label: "Vehicle registration" },
  { key: "insurance", label: "Insurance" },
  { key: "dot_inspection", label: "Annual DOT inspection" },
] as const;

export type WalletDocKind = (typeof WALLET_DOC_KINDS)[number]["key"];

/** Alert tier for a document's days-left count (whole days until the
 *  expiry date the driver entered; negative = already expired).
 *  Thresholds are the batch's spec: alerts at 30, 14, and 7 days out,
 *  plus an expired state. Null days (no date entered) never alert. */
export function docAlertTier(daysLeft: number | null): DocAlertTier {
  if (daysLeft == null) return "no_date";
  if (daysLeft < 0) return "expired";
  if (daysLeft <= 7) return "due7";
  if (daysLeft <= 14) return "due14";
  if (daysLeft <= 30) return "due30";
  return "ok";
}

export const DOC_TIER_LABEL: Record<DocAlertTier, string> = {
  expired: "EXPIRED",
  due7: "Due within 7 days",
  due14: "Due within 14 days",
  due30: "Due within 30 days",
  ok: "Current",
  no_date: "No expiry date entered",
};

/** Whole days from `nowMs` until an expiry instant (ceil, matching the
 *  server's listPersonalDocs daysLeft so screen and badge agree). */
export function daysLeftFrom(nowMs: number, expiresAtMs: number): number {
  return Math.ceil((expiresAtMs - nowMs) / 86400000);
}

export type WalletDocLike = { kind: string; label: string; expiresAt: string | null; daysLeft: number | null };

/** The single most urgent document (expired first, then soonest due)
 *  — drives the Driver-tab badge line. Null when nothing is at or
 *  inside the 30-day alert window. */
export function mostUrgentDoc<T extends WalletDocLike>(docs: T[]): { doc: T; tier: DocAlertTier } | null {
  let best: { doc: T; tier: DocAlertTier } | null = null;
  for (const doc of docs) {
    const tier = docAlertTier(doc.daysLeft);
    if (tier === "ok" || tier === "no_date") continue;
    if (!best || (doc.daysLeft ?? Infinity) < (best.doc.daysLeft ?? Infinity)) best = { doc, tier };
  }
  return best;
}

/** How many documents sit inside the alert window (≤30 days or
 *  expired) — the badge count. */
export function docAlertCount(docs: WalletDocLike[]): number {
  return docs.filter((d) => {
    const t = docAlertTier(d.daysLeft);
    return t !== "ok" && t !== "no_date";
  }).length;
}

// ---------- 2) Who owes me ----------------------------------------------------

export type OwedLoadInput = {
  loadId: number;
  /** When the delivery sealed (the moment the money clock started). */
  deliveredAtMs: number;
  /** Freight owed: load rate + additional charges (null = the load
   *  has no rate on file, so no dollar amount can be stated). */
  freight: number | null;
  /** Sealed claim events (TONU / layover / driver assist) on this load. */
  claimsTotal: number;
  /** Payments the driver recorded against this load. */
  paidTotal: number;
};

export type OwedRow = {
  loadId: number;
  deliveredAtMs: number;
  daysOutstanding: number;
  freight: number | null;
  claimsTotal: number;
  /** freight + claims; null when freight itself is unknown. */
  totalOwed: number | null;
  paidTotal: number;
  /** totalOwed − paid; null when totalOwed is unknown. A load leaves
   *  the board when this reaches 0 (within a cent). */
  remaining: number | null;
  aging: "current" | "watch" | "late" | "stale";
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function agingBucket(daysOutstanding: number): OwedRow["aging"] {
  if (daysOutstanding <= 14) return "current";
  if (daysOutstanding <= 30) return "watch";
  if (daysOutstanding <= 60) return "late";
  return "stale";
}

export const AGING_LABEL: Record<OwedRow["aging"], string> = {
  current: "0–14 days",
  watch: "15–30 days",
  late: "31–60 days",
  stale: "60+ days",
};

/** Build the board: delivered loads that still owe money, OLDEST
 *  first. Loads whose freight amount isn't on file ride along with
 *  null amounts (the UI says the amount isn't on file) — they sort
 *  with the rest by delivery date and never contribute to totals. */
export function buildOwedBoard(inputs: OwedLoadInput[], nowMs: number): OwedRow[] {
  const rows: OwedRow[] = [];
  for (const inp of inputs) {
    const totalOwed = inp.freight != null ? round2(inp.freight + inp.claimsTotal) : null;
    const remaining = totalOwed != null ? round2(totalOwed - inp.paidTotal) : null;
    // Paid off (or overpaid): the load leaves the board. A load with
    // no rate on file stays until a payment is recorded against it —
    // any recorded payment settles a load whose amount was never on
    // file (the driver took the money; the board's job is done).
    if (remaining != null && remaining <= 0.005) continue;
    if (remaining == null && inp.paidTotal > 0) continue;
    const daysOutstanding = Math.max(0, Math.floor((nowMs - inp.deliveredAtMs) / 86400000));
    rows.push({
      loadId: inp.loadId,
      deliveredAtMs: inp.deliveredAtMs,
      daysOutstanding,
      freight: inp.freight,
      claimsTotal: round2(inp.claimsTotal),
      totalOwed,
      paidTotal: round2(inp.paidTotal),
      remaining,
      aging: agingBucket(daysOutstanding),
    });
  }
  rows.sort((a, b) => a.deliveredAtMs - b.deliveredAtMs || a.loadId - b.loadId);
  return rows;
}

/** Board totals: dollars still owed across loads whose amount IS on
 *  file, plus how many loads are waiting on an amount. */
export function owedTotals(rows: OwedRow[]): { totalRemaining: number; loadsOwing: number; loadsNoAmount: number; oldestDays: number } {
  let total = 0;
  let noAmount = 0;
  let oldest = 0;
  for (const r of rows) {
    if (r.remaining != null) total += r.remaining;
    else noAmount += 1;
    if (r.daysOutstanding > oldest) oldest = r.daysOutstanding;
  }
  return { totalRemaining: round2(total), loadsOwing: rows.length, loadsNoAmount: noAmount, oldestDays: oldest };
}

// ---------- 3) True rate per load ---------------------------------------------

export type FeeDeductions = {
  /** The percentages applied (clamped 0–100, non-finite → 0). */
  factoringPct: number;
  dispatcherPct: number;
  factoringAmt: number;
  dispatcherAmt: number;
  totalFees: number;
  /** gross − totalFees. */
  netPay: number;
};

/** The driver's OWN factoring / dispatcher deductions on one load's
 *  gross pay — the client twin of server/src/loadFees.ts (same math,
 *  same rounding: each fee rounds to cents on its own line and the
 *  net is gross minus the rounded lines, so displayed lines add up).
 *  These are the DRIVER's costs with THEIR factoring company / THEIR
 *  dispatcher, from the driver's saved settings — never platform
 *  fees, and never invented: a missing percentage is 0. */
export function feeDeductionsFor(
  grossPay: number,
  factoringPct: number | null | undefined,
  dispatcherPct: number | null | undefined,
): FeeDeductions {
  const clamp = (p: number | null | undefined) => (p == null || !Number.isFinite(p) ? 0 : Math.min(100, Math.max(0, p)));
  const fPct = clamp(factoringPct);
  const dPct = clamp(dispatcherPct);
  const factoringAmt = round2((grossPay * fPct) / 100);
  const dispatcherAmt = round2((grossPay * dPct) / 100);
  const totalFees = round2(factoringAmt + dispatcherAmt);
  return { factoringPct: fPct, dispatcherPct: dPct, factoringAmt, dispatcherAmt, totalFees, netPay: round2(grossPay - totalFees) };
}

export type TrueRateInput = {
  /** Total pay for the load (rate + additional charges + claim
   *  amounts the driver logged). Null = no pay on file. */
  totalPay: number | null;
  /** The driver's OWN saved factoring / dispatcher percentages
   *  (Settings → My pay). Omitted / 0 = no fee deduction shown. */
  factoringPct?: number | null;
  dispatcherPct?: number | null;
  loadedMiles: number | null;
  /** Deadhead (empty) miles the driver recorded for this load. */
  deadheadMiles: number | null;
};

export type FuelBasis =
  | { kind: "logged"; fuelCost: number }
  | { kind: "estimate"; fuelCost: number }
  | { kind: "none" };

export type TrueRate = {
  /** loaded + deadhead; null unless loaded miles are on file. */
  totalMiles: number | null;
  /** total pay ÷ ALL miles. Null without pay + miles. */
  grossPerMile: number | null;
  /** (total pay − fuel cost) ÷ ALL miles. Null when no fuel basis. */
  netPerMile: number | null;
  fuel: FuelBasis;
  /** The driver's own factoring / dispatcher deductions on this
   *  load's pay (all zeros when no percentages are saved). */
  fees: FeeDeductions;
  /** (total pay − the driver's own fees) ÷ ALL miles. Null without
   *  pay + miles, and null when both percentages are 0 (the gross
   *  rate already IS the after-fees rate — no fake second figure). */
  netAfterFeesPerMile: number | null;
};

/**
 * Decide the fuel basis for one load, honestly:
 * - "logged": fuel expenses the driver filed AGAINST THIS LOAD
 *   (expenses with this loadId, category fuel) — a real logged cost.
 * - "estimate": no load-linked fuel, but the driver's fuel-purchase
 *   log gives an average $/gal and the truck profile gives an MPG —
 *   fuel ≈ total miles ÷ MPG × average logged price. An ESTIMATE,
 *   and the UI must say so wherever the net figure shows.
 * - "none": neither basis exists — no net figure is shown at all.
 */
export function fuelBasisFor(args: {
  linkedFuelCost: number | null;
  totalMiles: number | null;
  mpg: number | null;
  avgLoggedPricePerGallon: number | null;
}): FuelBasis {
  if (args.linkedFuelCost != null && args.linkedFuelCost > 0) {
    return { kind: "logged", fuelCost: round2(args.linkedFuelCost) };
  }
  if (args.totalMiles != null && args.totalMiles > 0 && args.mpg != null && args.mpg > 0 && args.avgLoggedPricePerGallon != null && args.avgLoggedPricePerGallon > 0) {
    return { kind: "estimate", fuelCost: round2((args.totalMiles / args.mpg) * args.avgLoggedPricePerGallon) };
  }
  return { kind: "none" };
}

/** Average $/gal across the driver's logged fuel purchases (weighted
 *  by gallons — a 100-gal fill counts more than a 10-gal splash).
 *  Null when nothing is logged: no price is ever invented. */
export function avgLoggedFuelPrice(purchases: { gallons: number; total: number }[]): number | null {
  let gal = 0;
  let dollars = 0;
  for (const p of purchases) {
    if (p.gallons > 0 && p.total > 0) {
      gal += p.gallons;
      dollars += p.total;
    }
  }
  if (gal <= 0) return null;
  return Math.round((dollars / gal) * 1000) / 1000;
}

export function trueRateFor(input: TrueRateInput, fuel: FuelBasis): TrueRate {
  const totalMiles =
    input.loadedMiles != null ? Math.round((input.loadedMiles + (input.deadheadMiles ?? 0)) * 10) / 10 : null;
  const grossPerMile =
    input.totalPay != null && totalMiles != null && totalMiles > 0
      ? Math.round((input.totalPay / totalMiles) * 1000) / 1000
      : null;
  const netPerMile =
    grossPerMile != null && fuel.kind !== "none" && totalMiles != null && totalMiles > 0 && input.totalPay != null
      ? Math.round(((input.totalPay - fuel.fuelCost) / totalMiles) * 1000) / 1000
      : null;
  const fees = feeDeductionsFor(input.totalPay ?? 0, input.factoringPct, input.dispatcherPct);
  const netAfterFeesPerMile =
    grossPerMile != null && totalMiles != null && totalMiles > 0 && input.totalPay != null && fees.totalFees > 0
      ? Math.round((fees.netPay / totalMiles) * 1000) / 1000
      : null;
  return { totalMiles, grossPerMile, netPerMile, fuel, fees, netAfterFeesPerMile };
}

// ---------- 4) Claim events (TONU / layover / driver assist) ------------------

export const CLAIM_KINDS = [
  { key: "tonu", label: "TONU — truck ordered, not used" },
  { key: "layover", label: "Layover" },
  { key: "driver_assist", label: "Driver assist" },
] as const;

export type ClaimKind = (typeof CLAIM_KINDS)[number]["key"];

export function claimKindLabel(kind: string): string {
  return CLAIM_KINDS.find((k) => k.key === kind)?.label ?? kind;
}

// ---------- 5) IFTA estimator --------------------------------------------------

export type IftaRowInput = {
  state: string;
  miles: number;
  gallonsBought: number;
  /** The jurisdiction's diesel rate from the loaded IFTA matrix
   *  snapshot; null = rate not loaded for this jurisdiction. */
  rate: number | null;
  fleetMpg: number | null;
};

export type IftaRowCalc = {
  state: string;
  gallonsUsed: number | null;
  taxOwed: number | null;
  taxPaid: number | null;
  net: number | null;
  rateLoaded: boolean;
};

/** One jurisdiction's estimate, exactly the batch's formula:
 *  tax owed = (state miles ÷ MPG) × state rate; tax already paid =
 *  gallons bought in the state × state rate; net = owed − paid.
 *  Null rate → every money figure null ("rate not loaded"); null MPG
 *  → the used/owed figures stay null rather than guessed. */
export function iftaRowCalc(inp: IftaRowInput): IftaRowCalc {
  const gallonsUsed =
    inp.fleetMpg != null && inp.fleetMpg > 0 ? Math.round((inp.miles / inp.fleetMpg) * 100) / 100 : null;
  if (inp.rate == null) {
    return { state: inp.state, gallonsUsed, taxOwed: null, taxPaid: null, net: null, rateLoaded: false };
  }
  const taxPaid = Math.round(inp.gallonsBought * inp.rate * 100) / 100;
  const taxOwed = gallonsUsed != null ? Math.round(gallonsUsed * inp.rate * 100) / 100 : null;
  const net = taxOwed != null ? Math.round((taxOwed - taxPaid) * 100) / 100 : null;
  return { state: inp.state, gallonsUsed, taxOwed, taxPaid, net, rateLoaded: true };
}

// ---------- 6) Maintenance countdown -------------------------------------------

export const MAINTENANCE_ITEMS = [
  { key: "oil", label: "Oil & filters", defaultIntervalMi: 25000 },
  { key: "tires", label: "Tires (steer + drive rotation/replacement check)", defaultIntervalMi: 100000 },
  { key: "brakes", label: "Brakes (pads/shoes + inspection)", defaultIntervalMi: 100000 },
  { key: "dot_inspection", label: "Annual DOT inspection", defaultIntervalMi: 0 },
] as const;

export type MaintenanceItemKey = (typeof MAINTENANCE_ITEMS)[number]["key"];

/** The annual DOT inspection runs on TIME as well as miles: federal
 *  rule is every 12 months. When an interval of 0 is stored for it,
 *  the countdown is date-based (last done + 12 months). */
export const DOT_INSPECTION_MONTHS = 12;

export type MaintenanceStatus = {
  key: string;
  /** Miles until due (negative = overdue by that many). Null when
   *  the countdown can't be figured (no odometer or no baseline). */
  milesRemaining: number | null;
  /** Days until due for the date-based DOT countdown. */
  daysRemaining: number | null;
  state: "ok" | "due_soon" | "due" | "overdue" | "unknown";
};

/** "Due soon" window: within 1,000 miles (or 30 days) of the mark. */
export const MAINTENANCE_DUE_SOON_MI = 1000;
export const MAINTENANCE_DUE_SOON_DAYS = 30;

export function maintenanceStatusFor(args: {
  key: string;
  intervalMi: number;
  lastDoneOdometer: number | null;
  lastDoneAtMs: number | null;
  currentOdometer: number | null;
  nowMs: number;
}): MaintenanceStatus {
  const { key } = args;
  // Date-based countdown (the DOT annual when no mile interval is set).
  if (args.intervalMi <= 0) {
    if (args.lastDoneAtMs == null) return { key, milesRemaining: null, daysRemaining: null, state: "unknown" };
    const dueMs = addMonthsMs(args.lastDoneAtMs, DOT_INSPECTION_MONTHS);
    const daysRemaining = Math.ceil((dueMs - args.nowMs) / 86400000);
    const state = daysRemaining < 0 ? "overdue" : daysRemaining === 0 ? "due" : daysRemaining <= MAINTENANCE_DUE_SOON_DAYS ? "due_soon" : "ok";
    return { key, milesRemaining: null, daysRemaining, state };
  }
  if (args.lastDoneOdometer == null || args.currentOdometer == null) {
    return { key, milesRemaining: null, daysRemaining: null, state: "unknown" };
  }
  const dueAt = args.lastDoneOdometer + args.intervalMi;
  const milesRemaining = Math.round((dueAt - args.currentOdometer) * 10) / 10;
  const state =
    milesRemaining < 0 ? "overdue" : milesRemaining === 0 ? "due" : milesRemaining <= MAINTENANCE_DUE_SOON_MI ? "due_soon" : "ok";
  return { key, milesRemaining, daysRemaining: null, state };
}

function addMonthsMs(ms: number, months: number): number {
  const d = new Date(ms);
  d.setMonth(d.getMonth() + months);
  return d.getTime();
}

/** The current odometer from the readings the app already records:
 *  the highest odometer stamped on a fuel purchase, DVIR, or daily
 *  log (finish miles win over start miles on the same log). Null
 *  when the app holds no odometer reading at all — the panel then
 *  asks the driver to type one rather than guessing. */
export function currentOdometerFrom(readings: (number | null | undefined)[]): number | null {
  let best: number | null = null;
  for (const r of readings) {
    if (r != null && Number.isFinite(r) && r > 0 && (best == null || r > best)) best = r;
  }
  return best;
}

// ---------- 7) Breakdown log ----------------------------------------------------

export type BreakdownCostEntry = { label: string; amount: number };

export function breakdownTotals(args: {
  startedAtMs: number;
  endedAtMs: number | null;
  costs: BreakdownCostEntry[];
  nowMs: number;
}): { downtimeHours: number; totalCost: number; open: boolean } {
  const end = args.endedAtMs ?? args.nowMs;
  const downtimeHours = Math.max(0, Math.round(((end - args.startedAtMs) / 3600000) * 10) / 10);
  const totalCost = round2(args.costs.reduce((s, c) => s + (c.amount > 0 ? c.amount : 0), 0));
  return { downtimeHours, totalCost, open: args.endedAtMs == null };
}

/** Plain-text export for one breakdown record — the warranty/claim
 *  paperwork shape: when it started/ended, how long the truck was
 *  down, every cost line, and the total. */
export function breakdownExportText(args: {
  id: number;
  startedAtIso: string;
  endedAtIso: string | null;
  locationNote: string | null;
  note: string | null;
  costs: BreakdownCostEntry[];
  chainHash: string | null;
  nowMs: number;
}): string {
  const t = breakdownTotals({
    startedAtMs: Date.parse(args.startedAtIso),
    endedAtMs: args.endedAtIso ? Date.parse(args.endedAtIso) : null,
    costs: args.costs,
    nowMs: args.nowMs,
  });
  const lines = [
    `BREAKDOWN RECORD #${args.id} — STONEMILES`,
    `Down: ${new Date(args.startedAtIso).toLocaleString()}`,
    `Back up: ${args.endedAtIso ? new Date(args.endedAtIso).toLocaleString() : "still down (open)"}`,
    `Downtime: ${t.downtimeHours.toFixed(1)} hours${t.open ? " so far" : ""}`,
    ...(args.locationNote ? [`Where: ${args.locationNote}`] : []),
    ...(args.note ? [`What happened: ${args.note}`] : []),
    "",
    "Costs:",
    ...(args.costs.length > 0
      ? args.costs.map((c) => `  ${c.label}: $${c.amount.toFixed(2)}`)
      : ["  (no costs logged)"]),
    `Total cost: $${t.totalCost.toFixed(2)}`,
    "",
    "Logged and sealed in STONEMILES for warranty / claim paperwork. The app logs and locates — it does not dispatch or pay anyone.",
    ...(args.chainHash ? [`Seal (chain hash): ${args.chainHash}`] : []),
  ];
  return lines.join("\n");
}
