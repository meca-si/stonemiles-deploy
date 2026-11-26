// rateWatch — the Pay door's "Rate Watch" card (x's build,
// 2026-11-17): two honest rate pictures side by side.
//
// (1) MARKET BENCHMARKS — the week's published spot market, seeded
// from the source's public weekly report (Truckstop.com / FTR,
// broker-posted averages, fuel included). A benchmark is market
// DIRECTION, never a quote for any load, and the card says so.
// Updating to a new week is a one-object edit of
// RATE_WATCH_BENCHMARKS below — every figure in it must come from
// that week's published report; a lane the report gives no clean
// national absolute for shows its change + year-over-year only
// (ratePerMile: null), never an invented number.
//
// (2) STONERVISION RATE INDEX — our own loads' truth: load revenue
// (rate + additional charges — the same load total payRpm divides)
// over LOADED miles, for loads whose delivery sealed inside the
// window, grouped by the load's recorded equipment type. Deadhead
// miles are NOT counted (same rule as payRpm). Privacy/honesty
// gate: a figure shows ONLY when at least MIN_INDEX_LOADS sealed
// loads stand behind it — below that the index is "building" and
// shows the sealed-load count alone. The index is aggregates only:
// no single load's rate, customer, or lane ever leaves this math.

export interface RateWatchBenchmarkRow {
  /** Load equipment value the row speaks for (loads.equipmentType). */
  equipment: string;
  label: string;
  /** Published national $/mi for the week, or null when the week's
   *  report published no clean national absolute for this lane. */
  ratePerMile: number | null;
  /** The week's move, in the source's own terms. */
  weeklyChange: string;
  /** Week-over-week change in posted loads, percent; null if the
   *  report didn't publish one for this lane. */
  loadsChangePct: number | null;
  /** Rate vs the same week last year, percent. */
  vsLastYearPct: number;
  /** A plain note the source itself made about this lane, or null. */
  note: string | null;
}

export interface RateWatchBenchmarks {
  weekLabel: string;
  weekEndingLabel: string;
  source: string;
  /** Total spot average for the week, $/mi, fuel included. */
  totalSpotPerMile: number;
  rows: readonly RateWatchBenchmarkRow[];
}

export const RATE_WATCH_BENCHMARKS: RateWatchBenchmarks = {
  weekLabel: "Week 45",
  weekEndingLabel: "week ending Nov 13, 2026",
  source: "Truckstop.com / FTR — broker-posted spot averages, includes fuel",
  totalSpotPerMile: 3.16,
  rows: [
    {
      equipment: "dry_van",
      label: "Dry van",
      ratePerMile: null, // the Week 45 report published no clean national absolute for dry van — change + YoY only
      weeklyChange: "eased <1¢",
      loadsChangePct: -2.2,
      vsLastYearPct: 48,
      note: null,
    },
    {
      equipment: "reefer",
      label: "Reefer",
      ratePerMile: null,
      weeklyChange: "+3¢",
      loadsChangePct: -1.8,
      vsLastYearPct: 41,
      note: null,
    },
    {
      equipment: "flatbed",
      label: "Flatbed",
      ratePerMile: null,
      weeklyChange: "−7.6¢",
      loadsChangePct: -7.3,
      vsLastYearPct: 39,
      note: "Biggest weekly drop since August",
    },
  ],
};

// ---------------------------------------------------------------------
// NATIONAL RPM BENCHMARKS — the board card's yardstick (x's order,
// 2026-11-25): a load's rate-con price broken down to its rate per
// mile, stood next to the real national average for the load's
// equipment lane. DAT publishes clean national absolutes per
// equipment (broker-to-carrier spot, linehaul + fuel surcharge —
// the same all-in basis as a rate con's total), which the
// Truckstop/FTR summary above does not, so this table carries its
// own source and week and is seeded from DAT's published weekly
// release, copied verbatim. Same honesty rules as the benchmarks
// above: a lane DAT publishes no all-in absolute for gets NO row —
// never derive one from a linehaul figure plus an assumed fuel
// surcharge — and the card shows no comparison for that lane.
// Refreshing is a one-object edit of NATIONAL_RPM_BENCHMARKS when a
// new DAT week publishes.

export interface NationalRpmRow {
  /** Load equipment value the row speaks for (loads.equipmentType). */
  equipment: string;
  label: string;
  /** Published national average spot rate, $/mi, fuel included. */
  ratePerMile: number;
}

export interface NationalRpmBenchmarks {
  /** The DAT 7-day window the figures cover, e.g. "Nov 14–20, 2026". */
  weekLabel: string;
  source: string;
  rows: readonly NationalRpmRow[];
}

export const NATIONAL_RPM_BENCHMARKS: NationalRpmBenchmarks = {
  weekLabel: "Nov 14–20, 2026",
  source:
    "DAT Freight & Analytics — 7-day national average spot rates, broker-to-carrier, linehaul + fuel surcharge (release of Nov 24, 2026)",
  rows: [
    { equipment: "dry_van", label: "Dry van", ratePerMile: 3.11 },
    { equipment: "reefer", label: "Reefer", ratePerMile: 3.73 },
    { equipment: "flatbed", label: "Flatbed", ratePerMile: 3.58 },
  ],
};

/** Equipment labels for the index buckets — the same words the load
 *  form's equipment picker uses. Unknown values keep their raw text. */
export const RATE_INDEX_EQUIPMENT_LABELS: Readonly<Record<string, string>> = {
  flatbed: "Flatbed",
  open_deck: "Open deck",
  rgn: "RGN",
  oversized: "Oversized",
  dry_van: "Dry van",
  reefer: "Reefer",
  container: "Container",
};

/** A rate figure shows only when at least this many sealed loads
 *  stand behind it — below that, the index is still building. */
export const MIN_INDEX_LOADS = 5;

export interface RateWatchLoadLike {
  /** When the load's delivery sealed (ms since epoch). */
  sealedAtMs: number;
  /** Load total (rate + additional charges); null = no rate on file. */
  revenue: number | null;
  /** Loaded miles as recorded on the load; null = not recorded. */
  loadedMiles: number | null;
  /** The load's recorded equipment type; null = not set. */
  equipmentType: string | null;
}

export interface RateIndexBucket {
  /** Equipment value, or "all" for the overall bucket. */
  equipment: string;
  label: string;
  /** Counted loads behind the figure (rate + miles on file). */
  loadCount: number;
  /** revenue / loaded miles, cents-rounded. */
  rpm: number;
}

export interface RateIndex {
  windowDays: number;
  minLoads: number;
  /** Every load sealed inside the window, counted or not. */
  sealedLoadCount: number;
  /** In-window sealed loads with a rate and loaded miles on file —
   *  the loads the index math stands on. */
  countedLoadCount: number;
  /** The overall figure, or null while fewer than minLoads counted
   *  loads stand behind it. */
  overall: RateIndexBucket | null;
  /** Equipment buckets that clear the minLoads gate, most loads
   *  first. Buckets under the gate are not returned at all. */
  byEquipment: RateIndexBucket[];
  /** True when the overall figure shows. */
  hasIndex: boolean;
}

const DAY_MS = 86_400_000;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function computeRateIndex(
  loads: readonly RateWatchLoadLike[],
  nowMs: number,
  windowDays = 90,
  minLoads = MIN_INDEX_LOADS,
): RateIndex {
  const from = nowMs - windowDays * DAY_MS;
  let sealedLoadCount = 0;
  let countedLoadCount = 0;
  let totalRevenue = 0;
  let totalMiles = 0;
  const buckets = new Map<string, { revenue: number; miles: number; count: number }>();
  for (const l of loads) {
    if (!(l.sealedAtMs > from && l.sealedAtMs <= nowMs)) continue;
    sealedLoadCount++;
    if (l.revenue == null || !Number.isFinite(l.revenue)) continue;
    if (l.loadedMiles == null || !(l.loadedMiles > 0)) continue;
    countedLoadCount++;
    totalRevenue += l.revenue;
    totalMiles += l.loadedMiles;
    if (l.equipmentType) {
      const b = buckets.get(l.equipmentType) ?? { revenue: 0, miles: 0, count: 0 };
      b.revenue += l.revenue;
      b.miles += l.loadedMiles;
      b.count++;
      buckets.set(l.equipmentType, b);
    }
  }
  const overall: RateIndexBucket | null =
    countedLoadCount >= minLoads && totalMiles > 0
      ? { equipment: "all", label: "All equipment", loadCount: countedLoadCount, rpm: round2(totalRevenue / totalMiles) }
      : null;
  const byEquipment: RateIndexBucket[] = [];
  for (const [equipment, b] of buckets) {
    if (b.count < minLoads || !(b.miles > 0)) continue;
    byEquipment.push({
      equipment,
      label: RATE_INDEX_EQUIPMENT_LABELS[equipment] ?? equipment,
      loadCount: b.count,
      rpm: round2(b.revenue / b.miles),
    });
  }
  byEquipment.sort((a, b) => b.loadCount - a.loadCount || a.label.localeCompare(b.label));
  return {
    windowDays,
    minLoads,
    sealedLoadCount,
    countedLoadCount,
    overall,
    byEquipment,
    hasIndex: overall != null,
  };
}
