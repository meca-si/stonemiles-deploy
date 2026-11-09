/**
 * MARKET PULSE — weekly spot-rate context (x-approved 2026-11-04 as
 * an exception to the Nov 13 code freeze, same class as the Fuel +
 * Stop Planner exception).
 *
 * What it is: broker-posted spot-rate MARKET DIRECTION by equipment —
 * dry van, reefer, flatbed (the lanes the source indexes), with the
 * lanes it doesn't (oversize / heavy haul, step-deck, tanker, power
 * only, hotshot) named on the card as an explicit no-index list — so
 * a driver judging a load's $/mile has market context for every
 * lane, and an honest gap where no published price exists. It
 * follows the app's EIA-diesel precedent
 * (server/src/eiaDiesel.ts): public context data, clearly labelled,
 * never presented as a price for any specific load.
 *
 * Source: Truckstop.com / FTR's public weekly Spot Market Insights
 * summary. Their data is their product — there is NO scraping here
 * and no licensed feed (a licensed feed is a later money decision by
 * x). The refresh path is MANUAL ENTRY from public summaries through
 * the saveMarketPulseWeek action, so a new week lands with no code
 * change. This module holds the pure rules — ordering, labels,
 * staleness, validation — unit-tested in marketPulse.test.ts;
 * actions.ts owns the DB.
 *
 * HONESTY RULES (owner-locked):
 * - The required label rides every surface: "Broker-posted averages
 *   — market direction, not a quote for any load."
 * - The week is shown plainly (number + ending date + source line)
 *   so stale data never masquerades as live; past ~2 weeks the
 *   record is flagged stale with its age, EIA-card style.
 * - Per-equipment ABSOLUTE $/mi rates are stored and shown ONLY
 *   when the week's full published report carries them (the Week 43
 *   full report does: flatbed $3.31, dry van $2.85, reefer $3.45 —
 *   the summary post x first reviewed carried direction only). A
 *   lane with no published absolute stores null and shows direction
 *   only — a rate is never derived from the change figures.
 * - ALL FREIGHT COVERAGE (x, 2026-11-05: "add oversized load and
 *   all freight market prices"): every freight lane a driver runs
 *   appears on the card. The lanes no weekly index publishes —
 *   step-deck, tanker, power only, hotshot, and oversize / heavy
 *   haul — appear as an explicit NO-INDEX list with the reason and
 *   NO number: neither Truckstop/FTR nor DAT publishes a weekly
 *   average for them (verified 2026-11-05), and oversize is priced
 *   per load (permits, escorts, dimensions), so no honest average
 *   exists. An honest gap beats an invented rate.
 * - FLATBED RIDES FIRST — it's x's lane (step-deck driver).
 */

export const MARKET_PULSE_LABEL =
  "Broker-posted averages — market direction, not a quote for any load.";
export const MARKET_PULSE_SOURCE_NAME = "Truckstop.com / FTR";

export type EquipmentKey = "flatbed" | "dryvan" | "reefer";

export type EquipmentPulse = {
  key: EquipmentKey;
  label: string;
  /**
   * Absolute spot rate, $/mi including fuel — ONLY when the week's
   * published report carries it; null when it doesn't (direction
   * only for that lane that week). Never derived from the changes.
   */
  ratePerMile: number | null;
  /** Week-over-week rate change, in cents (negative = down). */
  changeCents: number;
  /** Rate vs the same week last year, in percent. */
  yoyPct: number;
  /** Load-volume change week over week, in percent. */
  loadsChangePct: number;
};

/**
 * A freight lane NO weekly index publishes a rate for. These ride
 * every week's view as a static, honest coverage list: the lane is
 * named, the reason there's no number is stated, and for step-deck
 * the closest published context (the flatbed index) is named so the
 * card can point at it — labelled as context, never as the lane's
 * own price.
 */
export type NoIndexLane = {
  key: string;
  label: string;
  /** Why no weekly price exists for this lane, in plain words. */
  note: string;
  /** The indexed lane whose rate is the closest published context. */
  contextKey: EquipmentKey | null;
};

/**
 * The all-freight coverage list (x, 2026-11-05). Oversize FIRST —
 * it's the lane x asked for by name and the open-deck family he
 * runs. Verified 2026-11-05: Truckstop/FTR's weekly report covers
 * dry van, reefer, and flatbed only, and DAT's free national
 * averages likewise cover van, reefer, and flatbed only — no
 * sourced public weekly average exists for any lane below.
 */
export const NO_INDEX_LANES: NoIndexLane[] = [
  {
    key: "oversize",
    label: "Oversize / heavy haul",
    note: "No weekly index — every load prices on its own permits, escorts, and dimensions, so no honest average exists.",
    contextKey: "flatbed",
  },
  {
    key: "stepdeck",
    label: "Step-deck",
    note: "No separate weekly index — step-deck runs inside the open-deck family; the flatbed rate above is the closest published context.",
    contextKey: "flatbed",
  },
  {
    key: "tanker",
    label: "Tanker",
    note: "No weekly spot index is published for tanker — rates are set lane by lane, mostly on contract.",
    contextKey: null,
  },
  {
    key: "poweronly",
    label: "Power only",
    note: "No weekly spot index is published for power only — priced per move off the trailer pool and lane.",
    contextKey: null,
  },
  {
    key: "hotshot",
    label: "Hotshot",
    note: "No weekly spot index is published for hotshot — priced per load on urgency, weight, and distance.",
    contextKey: null,
  },
  {
    key: "intermodal",
    label: "Intermodal / drayage",
    note: "No weekly per-mile spot index — container moves price per box, and drayage (the truck leg) prices per move, not per mile.",
    contextKey: null,
  },
];

/**
 * A segment the source DOES publish — but not in the current week's
 * summary. FTR's system tracks a fourth segment, Specialized, and
 * its fuller weekly releases carry its rate; the Week 43 summary
 * (and the narrative reports of it) covered only the three
 * principal types, so no Week 43 Specialized figure could be
 * verified. The card shows the segment with the most recent figure
 * the source published, labelled with ITS OWN week — never blended
 * into the current week's record, never presented as current.
 * Verified figure: Week 39, ending Oct 2, 2026 — Specialized rates
 * rose 0.7% to $3.42/mi, +36.4% vs last year (Truckstop/FTR release
 * via AJOT, Oct 6, 2026; see DATA-PLAN.md).
 */
export type AlsoPublishedSegment = {
  key: string;
  label: string;
  ratePerMile: number;
  /** The segment's own week, plainly labelled. */
  weekLabel: string;
  /** That week's move, in words. */
  moveNote: string;
  /** Why it isn't in the current week's rows. */
  note: string;
};

export const ALSO_PUBLISHED_SEGMENTS: AlsoPublishedSegment[] = [
  {
    key: "specialized",
    label: "Specialized",
    ratePerMile: 3.42,
    weekLabel: "Week 39, ending Oct 2, 2026",
    moveNote: "+0.7% that week · +36.4% vs last year",
    note: "FTR tracks this fourth segment, but the Week 43 summary didn't publish its rate — this is the most recent week the source published for it.",
  },
];

export type MarketPulseRecord = {
  weekNumber: number;
  /** ISO YYYY-MM-DD — the Friday the week ends. */
  weekEnding: string;
  /** Total spot average, $/mi including fuel (published absolute). */
  totalRatePerMile: number;
  totalChangeCents: number;
  totalYoyPct: number;
  totalLoadsChangePct: number;
  /** Market Demand Index note, verbatim from the summary, or null. */
  mdiNote: string | null;
  flatbed: Omit<EquipmentPulse, "key" | "label">;
  dryvan: Omit<EquipmentPulse, "key" | "label">;
  reefer: Omit<EquipmentPulse, "key" | "label">;
  source: string;
};

/**
 * The verified Week 43 figures (Truckstop.com / FTR weekly report,
 * week ending Oct 30, 2026). The direction figures are the ones x
 * handed over 2026-11-04 from the source's summary post; the
 * per-equipment ABSOLUTE rates (flatbed $3.31, dry van $2.85,
 * reefer $3.45) are from the SAME week's full published report
 * (Truckstop/FTR report of Nov 2, 2026, full text verified
 * 2026-11-05 — see DATA-PLAN.md), and they reconcile exactly with
 * the direction figures (each lane's rate minus its change lands
 * on the prior week). This is the initial last-good row before the
 * first manual entry lands a newer week.
 */
export const MARKET_PULSE_SEED: MarketPulseRecord = {
  weekNumber: 43,
  weekEnding: "2026-10-30",
  totalRatePerMile: 3.23,
  totalChangeCents: -1.3,
  totalYoyPct: 41.5,
  totalLoadsChangePct: 8.5,
  mdiNote: "Market Demand Index at a four-week high",
  flatbed: { ratePerMile: 3.31, changeCents: -1.6, yoyPct: 42, loadsChangePct: 11.2 },
  dryvan: { ratePerMile: 2.85, changeCents: -2.5, yoyPct: 48, loadsChangePct: 6.3 },
  reefer: { ratePerMile: 3.45, changeCents: -3.5, yoyPct: 41, loadsChangePct: 4.2 },
  source: MARKET_PULSE_SOURCE_NAME,
};

export const EQUIPMENT_LABELS: Record<EquipmentKey, string> = {
  flatbed: "Flatbed",
  dryvan: "Dry van",
  reefer: "Reefer",
};

/** The card's equipment order — flatbed FIRST (x's lane), always. */
export const EQUIPMENT_ORDER: EquipmentKey[] = ["flatbed", "dryvan", "reefer"];

/** Equipment rows in display order (flatbed first), from any record. */
export function orderedEquipment(rec: MarketPulseRecord): EquipmentPulse[] {
  return EQUIPMENT_ORDER.map((key) => ({
    key,
    label: EQUIPMENT_LABELS[key],
    ...rec[key],
  }));
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2026-10-30" → "Oct 30" (the source-line form, no year). */
export function marketPulseEndingShort(weekEndingIso: string): string {
  const [, m = 1, d = 1] = weekEndingIso.split("-").map(Number);
  return `${MONTHS[(m - 1 + 12) % 12]} ${d}`;
}

/** "2026-10-30", 43 → "Week 43, ending Oct 30, 2026" (plain week label). */
export function marketPulseWeekLabel(weekEndingIso: string, weekNumber: number): string {
  const [y = 1970] = weekEndingIso.split("-").map(Number);
  return `Week ${weekNumber}, ending ${marketPulseEndingShort(weekEndingIso)}, ${y}`;
}

/**
 * The required source line: "Source: Truckstop.com / FTR · Week 43,
 * ending Oct 30" — byte-for-byte the form x approved for Week 43.
 */
export function marketPulseSourceLine(rec: MarketPulseRecord): string {
  return `Source: ${rec.source} · Week ${rec.weekNumber}, ending ${marketPulseEndingShort(rec.weekEnding)}`;
}

/** Whole days between the week's ending date and `now` (never negative). */
export function marketPulseAgeDays(weekEndingIso: string, now: Date): number {
  const ending = new Date(`${weekEndingIso}T00:00:00Z`).getTime();
  if (!Number.isFinite(ending)) return 0;
  return Math.max(0, Math.floor((now.getTime() - ending) / 86_400_000));
}

/**
 * Stale = the week on file is older than ~2 weeks (x's rule: the card
 * says the week it is rather than implying freshness). A weekly
 * series is healthy at 0–14 days; past that a newer week should
 * exist and the card must say so.
 */
export function marketPulseIsStale(weekEndingIso: string, now: Date): boolean {
  return marketPulseAgeDays(weekEndingIso, now) > 14;
}

/** The stale note the card shows instead of implying freshness. */
export function marketPulseStaleNote(rec: MarketPulseRecord, now: Date): string | null {
  if (!marketPulseIsStale(rec.weekEnding, now)) return null;
  const age = marketPulseAgeDays(rec.weekEnding, now);
  return `This is the last week on file (${marketPulseWeekLabel(rec.weekEnding, rec.weekNumber)}, ${age} days old) — a newer week's summary hasn't been entered yet.`;
}

/** "−1.6¢" / "+2.0¢" / "0.0¢" — signed cents, one decimal. */
export function formatChangeCents(cents: number): string {
  const sign = cents > 0 ? "+" : cents < 0 ? "−" : "";
  return `${sign}${Math.abs(cents).toFixed(1)}¢`;
}

/** "+42%" / "−3.5%" — signed percent; whole numbers stay whole. */
export function formatSignedPct(pct: number): string {
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  const abs = Math.abs(pct);
  return `${sign}${Number.isInteger(abs) ? abs.toFixed(0) : abs.toFixed(1)}%`;
}

/**
 * Validate a manual entry before it is stored. Returns an error
 * string, or null when the record is storable. Bounds are generous
 * sanity rails (a typo guard, not a market model): rates and changes
 * must be finite and inside ranges no real weekly summary approaches.
 */
export function validateMarketPulseRecord(rec: MarketPulseRecord): string | null {
  if (!Number.isInteger(rec.weekNumber) || rec.weekNumber < 1 || rec.weekNumber > 53) {
    return "Week number must be a whole number from 1 to 53.";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rec.weekEnding)) {
    return "Week-ending date must be YYYY-MM-DD.";
  }
  const ending = new Date(`${rec.weekEnding}T00:00:00Z`);
  if (!Number.isFinite(ending.getTime()) || ending.toISOString().slice(0, 10) !== rec.weekEnding) {
    return "Week-ending date isn't a real calendar date.";
  }
  if (!Number.isFinite(rec.totalRatePerMile) || rec.totalRatePerMile <= 0 || rec.totalRatePerMile > 20) {
    return "Total spot rate must be a plausible $/mi (above 0, at most 20).";
  }
  const rateFields: Array<[string, number | null]> = [
    ["flatbed rate", rec.flatbed.ratePerMile],
    ["dry van rate", rec.dryvan.ratePerMile],
    ["reefer rate", rec.reefer.ratePerMile],
  ];
  for (const [name, v] of rateFields) {
    if (v != null && (!Number.isFinite(v) || v <= 0 || v > 20)) {
      return `The ${name} looks off — a published $/mi rate or nothing.`;
    }
  }
  const pctFields: Array<[string, number]> = [
    ["total change (cents)", rec.totalChangeCents],
    ["flatbed change (cents)", rec.flatbed.changeCents],
    ["dry van change (cents)", rec.dryvan.changeCents],
    ["reefer change (cents)", rec.reefer.changeCents],
  ];
  for (const [name, v] of pctFields) {
    if (!Number.isFinite(v) || Math.abs(v) > 200) return `The ${name} looks off — check the summary figures.`;
  }
  const yoyFields: Array<[string, number]> = [
    ["total % vs last year", rec.totalYoyPct],
    ["total loads change %", rec.totalLoadsChangePct],
    ["flatbed % vs last year", rec.flatbed.yoyPct],
    ["flatbed loads change %", rec.flatbed.loadsChangePct],
    ["dry van % vs last year", rec.dryvan.yoyPct],
    ["dry van loads change %", rec.dryvan.loadsChangePct],
    ["reefer % vs last year", rec.reefer.yoyPct],
    ["reefer loads change %", rec.reefer.loadsChangePct],
  ];
  for (const [name, v] of yoyFields) {
    if (!Number.isFinite(v) || v < -100 || v > 1000) return `The ${name} looks off — check the summary figures.`;
  }
  if (!rec.source.trim()) return "A source line is required — market context is never unsourced.";
  if (rec.mdiNote != null && rec.mdiNote.length > 300) return "The Market Demand Index note is too long.";
  return null;
}
