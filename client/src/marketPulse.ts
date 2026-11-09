/**
 * MARKET PULSE — client view model (x-approved 2026-11-04;
 * all-freight coverage added 2026-11-05).
 *
 * Pure builders for the MarketPulseCard: they take the
 * getMarketPulse action's view (server/src/marketPulse.ts owns the
 * data rules — seed, labels, staleness) and shape exactly what the
 * card renders. Kept pure and unit-tested (marketPulse.test.ts) so
 * the card's contract is pinned without a DOM: flatbed FIRST, the
 * required labelling present, the week shown plainly, per-equipment
 * $/mi ONLY where the week's published report carries it (Week 43:
 * flatbed $3.31, dry van $2.85, reefer $3.45), and the no-index
 * lanes (oversize first) rendered with their reason and NO number.
 */

export type MarketPulseEquipmentView = {
  key: string;
  label: string;
  ratePerMile: number | null;
  changeCents: number;
  yoyPct: number;
  loadsChangePct: number;
};

export type MarketPulseNoIndexLaneView = {
  key: string;
  label: string;
  note: string;
  contextKey: string | null;
  contextLabel: string | null;
};

export type MarketPulseAlsoPublishedView = {
  key: string;
  label: string;
  ratePerMile: number;
  weekLabel: string;
  moveNote: string;
  note: string;
};

export type MarketPulseView = {
  weekNumber: number;
  weekEnding: string;
  weekLabel: string;
  totalRatePerMile: number;
  totalChangeCents: number;
  totalYoyPct: number;
  totalLoadsChangePct: number;
  mdiNote: string | null;
  equipment: MarketPulseEquipmentView[];
  noIndexLanes: MarketPulseNoIndexLaneView[];
  alsoPublished: MarketPulseAlsoPublishedView[];
  label: string;
  source: string;
  sourceLine: string;
  stale: boolean;
  ageDays: number;
  staleNote: string | null;
};

export type MarketPulseCardModel = {
  heading: string;
  weekLabel: string;
  /** "$3.23/mi" — the total spot average, the card's only $/mi figure. */
  totalRateLabel: string;
  totalChangeLabel: string;
  totalYoyLabel: string;
  totalLoadsLabel: string;
  mdiNote: string | null;
  rows: Array<{
    key: string;
    label: string;
    /** "$3.31/mi" when the week's report published the lane's rate, else null. */
    rateLabel: string | null;
    changeLabel: string;
    yoyLabel: string;
    loadsLabel: string;
  }>;
  /** Lanes with no published weekly index — named, reasoned, unpriced. */
  noIndexRows: Array<{
    key: string;
    label: string;
    note: string;
    /** "Closest published context: Flatbed $3.31/mi" or null. */
    contextLabel: string | null;
  }>;
  /** Source segments from an earlier week, each with its own week label. */
  alsoPublishedRows: Array<{
    key: string;
    label: string;
    /** "$3.42/mi" — the segment's rate in ITS week, never the current one. */
    rateLabel: string;
    weekLabel: string;
    moveNote: string;
    note: string;
  }>;
  /** The required context label, verbatim from the server view. */
  label: string;
  /** The required source line, verbatim from the server view. */
  sourceLine: string;
  stale: boolean;
  staleNote: string | null;
};

const EQUIPMENT_ORDER = ["flatbed", "dryvan", "reefer"];

/** Flatbed first (x's lane), then dry van, then reefer — always. */
export function orderEquipmentRows(
  equipment: MarketPulseEquipmentView[],
): MarketPulseEquipmentView[] {
  const rank = (key: string) => {
    const i = EQUIPMENT_ORDER.indexOf(key);
    return i < 0 ? EQUIPMENT_ORDER.length : i;
  };
  return [...equipment].sort((a, b) => rank(a.key) - rank(b.key));
}

function formatChangeCents(cents: number): string {
  const sign = cents > 0 ? "+" : cents < 0 ? "−" : "";
  return `${sign}${Math.abs(cents).toFixed(1)}¢ this week`;
}

function formatSignedPct(pct: number): string {
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  const abs = Math.abs(pct);
  return `${sign}${Number.isInteger(abs) ? abs.toFixed(0) : abs.toFixed(1)}%`;
}

export function buildMarketPulseCardModel(pulse: MarketPulseView): MarketPulseCardModel {
  const ordered = orderEquipmentRows(pulse.equipment);
  const rateByKey = new Map(ordered.map((eq) => [eq.key, eq.ratePerMile]));
  return {
    heading: "Market Pulse",
    weekLabel: pulse.weekLabel,
    totalRateLabel: `$${pulse.totalRatePerMile.toFixed(2)}/mi`,
    totalChangeLabel: formatChangeCents(pulse.totalChangeCents),
    totalYoyLabel: `${formatSignedPct(pulse.totalYoyPct)} vs last year`,
    totalLoadsLabel: `Loads ${formatSignedPct(pulse.totalLoadsChangePct)}`,
    mdiNote: pulse.mdiNote,
    rows: ordered.map((eq) => ({
      key: eq.key,
      label: eq.label,
      rateLabel: eq.ratePerMile != null ? `$${eq.ratePerMile.toFixed(2)}/mi` : null,
      changeLabel: formatChangeCents(eq.changeCents),
      yoyLabel: `${formatSignedPct(eq.yoyPct)} vs last year`,
      loadsLabel: `Loads ${formatSignedPct(eq.loadsChangePct)}`,
    })),
    alsoPublishedRows: (pulse.alsoPublished ?? []).map((seg) => ({
      key: seg.key,
      label: seg.label,
      rateLabel: `$${seg.ratePerMile.toFixed(2)}/mi`,
      weekLabel: seg.weekLabel,
      moveNote: seg.moveNote,
      note: seg.note,
    })),
    noIndexRows: (pulse.noIndexLanes ?? []).map((lane) => {
      const ctxRate =
        lane.contextKey != null ? rateByKey.get(lane.contextKey) : undefined;
      return {
        key: lane.key,
        label: lane.label,
        note: lane.note,
        contextLabel:
          lane.contextLabel != null && ctxRate != null
            ? `Closest published context: ${lane.contextLabel} $${ctxRate.toFixed(2)}/mi`
            : null,
      };
    }),
    label: pulse.label,
    sourceLine: pulse.sourceLine,
    stale: pulse.stale,
    staleNote: pulse.staleNote,
  };
}
