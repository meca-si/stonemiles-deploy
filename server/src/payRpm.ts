// payRpm — the Pay door's headline revenue-per-mile (x's build,
// 2026-11-17, from the TorqueAI comparison: their dashboard leads
// with one RPM number; ours now does too — from the driver's OWN
// sealed loads, not a market figure).
//
// Definition (stated on the card, word for word): load revenue
// (rate + additional charges — the same load total the per-load
// $/mi divides everywhere else in the app) over LOADED miles, for
// loads whose delivery sealed inside the window. Deadhead miles are
// NOT in this figure (they're recorded per load only sometimes, so
// mixing them would make the number incomparable load to load) —
// the card says "loaded miles" plainly. The Money Overview's YTD
// per-mile is a different, Pay-Book-based figure and keeps its own
// home; this one answers "what are my recent loads paying per mile?"
//
// A load with no rate on file contributes nothing (an invoice never
// invents an amount, and neither does this). A load with a rate but
// no loaded miles is counted in loadsSkippedNoMiles and excluded
// from both sums — the RPM is only ever over loads whose miles are
// actually recorded.

export interface PayRpmLoadLike {
  /** When the load's delivery sealed (ms since epoch). */
  sealedAtMs: number;
  /** Load total (rate + additional charges); null = no rate on file. */
  revenue: number | null;
  /** Loaded miles as recorded on the load; null = not recorded. */
  loadedMiles: number | null;
}

export interface PayRpm {
  hasData: boolean;
  windowDays: number;
  /** Revenue summed over the counted loads, cents-rounded. */
  revenue: number;
  /** Loaded miles summed over the counted loads. */
  miles: number;
  /** Loads counted in both sums. */
  loadCount: number;
  /** In-window sealed loads with a rate but no loaded miles. */
  loadsSkippedNoMiles: number;
  /** revenue / miles, cents-rounded; null when no miles counted. */
  rpm: number | null;
}

const DAY_MS = 86_400_000;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function computePayRpm(
  loads: readonly PayRpmLoadLike[],
  nowMs: number,
  windowDays = 30,
): PayRpm {
  const from = nowMs - windowDays * DAY_MS;
  let revenue = 0;
  let miles = 0;
  let loadCount = 0;
  let loadsSkippedNoMiles = 0;
  for (const l of loads) {
    if (!(l.sealedAtMs > from && l.sealedAtMs <= nowMs)) continue;
    if (l.revenue == null || !Number.isFinite(l.revenue)) continue;
    if (l.loadedMiles == null || !(l.loadedMiles > 0)) {
      loadsSkippedNoMiles++;
      continue;
    }
    revenue += l.revenue;
    miles += l.loadedMiles;
    loadCount++;
  }
  revenue = round2(revenue);
  miles = Math.round(miles * 10) / 10;
  return {
    hasData: miles > 0,
    windowDays,
    revenue,
    miles,
    loadCount,
    loadsSkippedNoMiles,
    rpm: miles > 0 ? round2(revenue / miles) : null,
  };
}
