/**
 * SETTLEMENT CHECK — pure rules module (owner's build, 2026-11-15).
 *
 * The should-paid vs did-paid checker: what a driver SHOULD have
 * been paid for a settlement period (figured from their own sealed
 * loads under their own My Pay setting — settlement.ts's lines,
 * computed by the action layer) against what a settlement recorded
 * in their Pay Book ACTUALLY paid, with the difference stated
 * plainly: matches / SHORT $X / OVER $X.
 *
 * AUTOMATIC BY DESIGN (x, 2026-11-15: "make it automatic for each
 * settlement"): every Pay Book entry carries its check, computed
 * lazily on read from the current sealed record — nothing stored,
 * nothing sealed, nothing stale. The coverage window is
 * deterministic and PRINTED with every result, never a silent
 * guess, and it NEVER assumes a carrier pays in arrears: each
 * payer has a PAY LAG the driver sets once (0 = same week, 7 = a
 * week in the hole, up to 30; default 0). The window ends at
 * pay date − lag and starts the day after the previous same-payer
 * settlement's window ended, so consecutive settlements chain
 * with no day counted twice and none skipped, whatever the lag.
 * A period recorded on the settlement itself, when one exists,
 * wins over the lag math outright. The window is NEVER fit to the
 * answer — it comes from the payer's setting, full stop; this is
 * an audit tool. The driver can override the window in the
 * detail view when a carrier's period doesn't match.
 *
 * The check runs off the settlement AS RECORDED in the Pay Book —
 * hand-logged or filed from a stub by the existing reader. It does
 * NOT read a carrier statement itself, and no copy anywhere claims
 * it does.
 *
 * HONESTY RULES (the house pattern): a load whose pay can't be
 * figured is listed with its reason and NEVER guessed into the
 * expected total; with no figured lines at all the status is
 * "no_data", never a fake match/short/over against $0. Per diem is
 * reported on its own line and is never gross, never a deduction,
 * never in any net. Deduction categorization reuses the Money
 * Overview classifier (moneyOverview.ts) so a dollar lands in
 * exactly one bucket and the categories reconcile exactly: itemized
 * lines by label, the unitemized remainder of otherDeductions to
 * Other, federal + state withheld shown as Taxes withheld.
 *
 * Pure functions only — the action layer fetches rows and hands
 * them in (the settlement / moneyOverview pattern).
 */

import { classifyDeductionLabel, type DeductionCategory } from "./moneyOverview";
import { fromCents, toCents, type DeductionLine } from "./payBook";

/** Gross difference within this many dollars reads as a match —
 *  settlements round, stubs round, a cent-level chase helps no one. */
export const SETTLEMENT_MATCH_TOLERANCE = 1.0;

const DAY_MS = 86400000;
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface SettlementCheckExpectedLine {
  loadId: number;
  /** Driver-facing lane label, e.g. "Mobile, AL → Dallas, TX". */
  label: string;
  /** When the load's POD sealed (ms since epoch). */
  deliveredAtMs: number;
  /** What this load should have paid the driver; null when it
   *  can't be figured (basisNote says why, plainly). */
  expectedPay: number | null;
  /** How the line was figured, or why it couldn't be. */
  basisNote: string;
}

export interface SettlementCheckActualEntry {
  gross: number;
  federalWithheld: number;
  stateWithheld: number;
  otherDeductions: number;
  /** Itemized deduction lines as recorded; when present they
   *  itemize part or all of otherDeductions. */
  deductionLines?: readonly DeductionLine[];
  /** Non-taxable per diem, paid separately — reported, never math'd. */
  perDiem?: number;
}

export type SettlementCheckStatus = "matches" | "short" | "over" | "no_data";

export interface SettlementCheckCategoryTotal {
  category: DeductionCategory;
  amount: number;
}

export interface SettlementCheck {
  /** Every expected line in the window, figured or not. */
  lines: SettlementCheckExpectedLine[];
  /** Lines whose pay couldn't be figured, with the plain reason. */
  unfigured: { loadId: number; label: string; reason: string }[];
  figuredCount: number;
  /** Sum of the figured lines only — unfigured loads never guess in. */
  expectedTotal: number;
  actualGross: number;
  /** actualGross − expectedTotal. */
  difference: number;
  status: SettlementCheckStatus;
  /** Why the status is no_data; null otherwise. */
  statusReason: string | null;
  shortBy: number;
  overBy: number;
  /** Non-tax deductions (the entry's otherDeductions, reconciled). */
  totalDeductions: number;
  /** Federal + state withheld. */
  withheld: number;
  /** Itemized lines with their category, as recorded. */
  itemizedLines: { label: string; amount: number; category: DeductionCategory }[];
  /** Category totals incl. "Taxes withheld"; amounts sum exactly
   *  to totalDeductions + withheld. */
  deductionBreakdown: SettlementCheckCategoryTotal[];
  /** gross − totalDeductions − withheld. Per diem NOT included. */
  actualNet: number;
  /** expectedTotal − totalDeductions − withheld: what the driver
   *  should have kept after the deductions actually taken. */
  expectedNet: number;
  /** Per diem as recorded — its own line, never in the math. */
  perDiem: number;
  /** Whether the entry's own figures reconcile: its itemized lines
   *  must not claim more than its recorded deductions total. */
  entryMathOk: boolean;
  entryMathNote: string;
  /** True when the driver adjusted this check (window override,
   *  held-out loads, or pulled-in loads) — printed on its face via
   *  adjustmentNotes, so an edited check never masquerades as the
   *  raw automatic one. */
  adjusted: boolean;
  adjustmentNotes: string[];
  /** Loads the driver held out of this check (in the window, not counted). */
  heldOut: { loadId: number; label: string }[];
  /** Loads the driver pulled into this check (outside the window, counted). */
  pulledIn: { loadId: number; label: string }[];
}

/** The driver's verify-and-edit adjustments to one check, as
 *  applied by the action layer (window override is reported via
 *  its flag; load moves arrive already applied to the lines, with
 *  the moved loads named here for the printed notes). */
export interface CheckAdjustments {
  windowAdjusted?: boolean;
  heldOut?: readonly { loadId: number; label: string }[];
  pulledIn?: readonly { loadId: number; label: string }[];
}

export function computeSettlementCheck(
  expectedLines: readonly SettlementCheckExpectedLine[],
  entry: SettlementCheckActualEntry,
  adjustments?: CheckAdjustments,
): SettlementCheck {
  const lines = [...expectedLines];
  const unfigured = lines
    .filter((l) => l.expectedPay == null)
    .map((l) => ({ loadId: l.loadId, label: l.label, reason: l.basisNote }));
  const figured = lines.filter((l) => l.expectedPay != null);
  const expectedTotal = fromCents(figured.reduce((s, l) => s + toCents(l.expectedPay ?? 0), 0));

  const actualGross = round2(entry.gross);
  const difference = round2(actualGross - expectedTotal);

  let status: SettlementCheckStatus;
  let statusReason: string | null = null;
  if (figured.length === 0) {
    status = "no_data";
    statusReason =
      lines.length === 0
        ? "No sealed loads delivered in that window — there's nothing to check this settlement against yet."
        : "None of the sealed loads in that window could be figured — each one says why below, and nothing is guessed in.";
  } else if (Math.abs(difference) <= SETTLEMENT_MATCH_TOLERANCE) {
    status = "matches";
  } else if (difference < 0) {
    status = "short";
  } else {
    status = "over";
  }

  // Deductions: itemized lines classified by label; the unitemized
  // remainder of otherDeductions lands in Other (the Money Overview
  // sum pin — every deduction dollar in exactly one bucket).
  const itemizedLines = (entry.deductionLines ?? [])
    .filter((l) => toCents(l.amount) > 0)
    .map((l) => ({ label: l.label, amount: round2(l.amount), category: classifyDeductionLabel(l.label) }));
  const itemizedC = itemizedLines.reduce((s, l) => s + toCents(l.amount), 0);
  const otherC = toCents(entry.otherDeductions);
  const withheldC = toCents(entry.federalWithheld) + toCents(entry.stateWithheld);
  const catCents = new Map<DeductionCategory, number>();
  const add = (c: DeductionCategory, cents: number) => {
    if (cents !== 0) catCents.set(c, (catCents.get(c) ?? 0) + cents);
  };
  for (const l of itemizedLines) add(l.category, toCents(l.amount));
  const remainderC = otherC - itemizedC;
  if (remainderC > 0) add("Other", remainderC);
  add("Taxes withheld", withheldC);
  const deductionBreakdown: SettlementCheckCategoryTotal[] = [...catCents.entries()]
    .map(([category, c]) => ({ category, amount: fromCents(c) }))
    .sort((a, b) => b.amount - a.amount);

  const totalDeductions = fromCents(otherC);
  const withheld = fromCents(withheldC);
  const actualNet = round2(actualGross - totalDeductions - withheld);
  const expectedNet = round2(expectedTotal - totalDeductions - withheld);

  // The entry's own math: itemized lines itemize the entry's
  // otherDeductions — when they claim MORE than that total, the
  // entry's figures don't reconcile and the check says so plainly.
  const entryMathOk = itemizedC <= otherC;
  const entryMathNote = entryMathOk
    ? "This entry's figures reconcile."
    : "Heads up: this entry's itemized deduction lines add up to more than its recorded deductions total — the entry's own figures don't reconcile. Edit the entry's deductions in the Pay Book to fix the record.";

  // Driver adjustments are labelled on the result's face — an
  // edited check never masquerades as the raw automatic one.
  const heldOut = (adjustments?.heldOut ?? []).map((l) => ({ loadId: l.loadId, label: l.label }));
  const pulledIn = (adjustments?.pulledIn ?? []).map((l) => ({ loadId: l.loadId, label: l.label }));
  const adjustmentNotes: string[] = [];
  if (adjustments?.windowAdjusted) {
    adjustmentNotes.push("Window adjusted by driver — these dates are the driver's, not the automatic window.");
  }
  if (heldOut.length > 0) {
    adjustmentNotes.push(
      `${heldOut.length} load${heldOut.length === 1 ? "" : "s"} held out by driver (${heldOut.map((l) => `Load #${l.loadId}`).join(", ")}) — not counted in the expected total.`,
    );
  }
  if (pulledIn.length > 0) {
    adjustmentNotes.push(
      `${pulledIn.length} load${pulledIn.length === 1 ? "" : "s"} pulled in by driver (${pulledIn.map((l) => `Load #${l.loadId}`).join(", ")}) — counted in the expected total.`,
    );
  }
  const adjusted = adjustmentNotes.length > 0;

  return {
    lines,
    unfigured,
    figuredCount: figured.length,
    expectedTotal,
    actualGross,
    difference,
    status,
    statusReason,
    shortBy: status === "short" ? round2(-difference) : 0,
    overBy: status === "over" ? round2(difference) : 0,
    totalDeductions,
    withheld,
    itemizedLines,
    deductionBreakdown,
    actualNet,
    expectedNet,
    perDiem: round2(entry.perDiem ?? 0),
    entryMathOk,
    entryMathNote,
    adjusted,
    adjustmentNotes,
    heldOut,
    pulledIn,
  };
}

// ---- The automatic coverage window ------------------------------------------

/** Start of the UTC day containing `ms` (Pay Book entries are
 *  stamped at local noon, so the UTC day reads as the driver's day
 *  for US timezones — the getPayBookYtd convention). */
function startOfDayMs(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export interface SettlementWindow {
  fromMs: number;
  toMs: number;
  /** The pay lag the window ran on (0 when a recorded period won). */
  lagDays: number;
  /** True when the settlement's own recorded period set the window. */
  recorded: boolean;
  /** True when the DRIVER overrode this settlement's window —
   *  printed on the result's face, never hidden. */
  adjustedByDriver: boolean;
  /** Printed with every result — the exact window + the lag used. */
  basis: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dayLabel(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** How a lag reads in plain language (printed with every window). */
export function payLagPhrase(lagDays: number): string {
  if (lagDays === 0) return "pays the same week (0-day lag)";
  if (lagDays === 7) return "pays a week in the hole (7-day lag)";
  return `pays ${lagDays} days after the work (${lagDays}-day lag)`;
}

/** The normalized payer key lag settings and window chaining match
 *  on: trimmed, case-insensitive — the same rule
 *  previousSamePayerPaidAt groups by. */
export function payerKeyOf(payer: string): string {
  return payer.trim().toLowerCase();
}

/**
 * The deterministic window for one settlement entry. Anchored ONLY
 * to the entry's actual pay date and the payer's PAY LAG (never
 * assumed — the driver's own setting, default 0); no weekday or
 * cadence is ever assumed, so irregular paydays chain the same way:
 *
 *   windowEnd   = pay date − lagDays
 *   windowStart = the previous same-payer settlement's EFFECTIVE
 *                 window end + 1 ms, when a previous entry exists —
 *                 consecutive settlements chain with no day counted
 *                 twice and none skipped, at any lag; otherwise
 *                 windowEnd − 6 days (a seven-day span).
 *
 * Priority: a period recorded on the settlement itself
 * (`recordedPeriod`, when one is ever recorded) wins outright;
 * then the driver's own per-entry window override
 * (`overrideWindow`) — labelled as driver-adjusted on its face;
 * then the lag math. The lag is clamped to 0–30 here as well as
 * at the settings door.
 */
export function settlementWindowFor(
  payer: string,
  paidAtMs: number,
  prevWindowEndMs: number | null,
  lagDays: number,
  opts?: {
    overrideWindow?: { fromMs: number; toMs: number } | null;
    recordedPeriod?: { fromMs: number; toMs: number } | null;
  },
): SettlementWindow {
  const lag = Math.min(30, Math.max(0, Math.round(lagDays)));
  if (opts?.recordedPeriod) {
    const rp = opts.recordedPeriod;
    return {
      fromMs: rp.fromMs,
      toMs: rp.toMs,
      lagDays: 0,
      recorded: true,
      adjustedByDriver: false,
      basis: `Window: ${dayLabel(rp.fromMs)} – ${dayLabel(rp.toMs)} · the period recorded on this ${payer} settlement itself — a recorded period always wins over pay-lag math.`,
    };
  }
  const endDayStart = startOfDayMs(paidAtMs) - lag * DAY_MS;
  const autoToMs = endDayStart + DAY_MS - 1;
  let autoFromMs: number;
  if (prevWindowEndMs != null) {
    autoFromMs = prevWindowEndMs + 1;
    // Two settlements close together (or a lag change) can push the
    // chained start past this window's end — the window is then
    // that end day itself, never an inverted range.
    if (autoFromMs > endDayStart) autoFromMs = endDayStart;
  } else {
    autoFromMs = endDayStart - 6 * DAY_MS;
  }
  if (opts?.overrideWindow) {
    const ow = opts.overrideWindow;
    return {
      fromMs: ow.fromMs,
      toMs: ow.toMs,
      lagDays: lag,
      recorded: false,
      adjustedByDriver: true,
      basis: `Window: ${dayLabel(ow.fromMs)} – ${dayLabel(ow.toMs)} · adjusted by driver for this settlement. The automatic window would be ${dayLabel(autoFromMs)} – ${dayLabel(endDayStart)} · ${payer} ${payLagPhrase(lag)}.`,
    };
  }
  const chainNote =
    prevWindowEndMs != null
      ? " Starts the day after your previous settlement's window ended, so no day is counted twice or skipped."
      : ` Your first ${payer} settlement on record — the window covers the seven days ending ${dayLabel(endDayStart)}.`;
  return {
    fromMs: autoFromMs,
    toMs: autoToMs,
    lagDays: lag,
    recorded: false,
    adjustedByDriver: false,
    basis: `Window: ${dayLabel(autoFromMs)} – ${dayLabel(endDayStart)} · ${payer} ${payLagPhrase(lag)}.${chainNote}`,
  };
}

/** One settlement's stored per-entry overrides (the driver's own
 *  verify-and-edit layer): a window override plus load
 *  hold-outs / pull-ins. Overrides NEVER touch sealed loads or the
 *  Pay Book entry's own figures — they only steer this check. */
export interface CheckOverride {
  windowFromMs: number | null;
  windowToMs: number | null;
  excludedLoadIds: readonly number[];
  includedLoadIds: readonly number[];
}

export const EMPTY_CHECK_OVERRIDE: CheckOverride = {
  windowFromMs: null,
  windowToMs: null,
  excludedLoadIds: [],
  includedLoadIds: [],
};

/**
 * Apply a check's load overrides: hold OUT loads that sit in the
 * window but belong to another settlement, pull IN loads outside
 * the window that belong to this one. A load named in both lists
 * is held out (exclusion wins — deterministic). Returns the
 * counted lines (newest first), the held-out lines, and the
 * pulled-in lines, so the result can print exactly what the
 * driver changed.
 */
export function applyLoadOverrides(
  windowLines: readonly SettlementCheckExpectedLine[],
  allLines: readonly SettlementCheckExpectedLine[],
  override: CheckOverride,
): {
  lines: SettlementCheckExpectedLine[];
  heldOut: SettlementCheckExpectedLine[];
  pulledIn: SettlementCheckExpectedLine[];
} {
  const excluded = new Set(override.excludedLoadIds);
  const included = new Set(override.includedLoadIds);
  const heldOut = windowLines.filter((l) => excluded.has(l.loadId));
  const kept = windowLines.filter((l) => !excluded.has(l.loadId));
  const inWindow = new Set(windowLines.map((l) => l.loadId));
  const pulledIn = allLines.filter((l) => included.has(l.loadId) && !inWindow.has(l.loadId) && !excluded.has(l.loadId));
  const lines = [...kept, ...pulledIn].sort(
    (a, b) => b.deliveredAtMs - a.deliveredAtMs || b.loadId - a.loadId,
  );
  return { lines, heldOut: [...heldOut], pulledIn: [...pulledIn] };
}

export interface PayerEntryLike {
  id: number;
  payer: string;
  paidAtMs: number;
  isForm: boolean;
}

/**
 * The previous settlement from the same payer for `entry`, among
 * the driver's own entries: greatest pay date strictly before this
 * entry's, ties broken by id. Year-end form entries never count —
 * a form is paperwork, not a settlement. Payer matching is
 * case-insensitive on the trimmed name. Returns its paidAt or null.
 */
export function previousSamePayerPaidAt(
  entries: readonly PayerEntryLike[],
  entry: PayerEntryLike,
): number | null {
  const key = entry.payer.trim().toLowerCase();
  let best: PayerEntryLike | null = null;
  for (const e of entries) {
    if (e.id === entry.id || e.isForm) continue;
    if (e.payer.trim().toLowerCase() !== key) continue;
    if (e.paidAtMs > entry.paidAtMs) continue;
    if (e.paidAtMs === entry.paidAtMs && e.id > entry.id) continue;
    if (!best || e.paidAtMs > best.paidAtMs || (e.paidAtMs === best.paidAtMs && e.id > best.id)) best = e;
  }
  return best ? best.paidAtMs : null;
}
