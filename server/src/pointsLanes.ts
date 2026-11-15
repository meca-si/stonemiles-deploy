/**
 * SM Points — the THREE EARNING LANES (locked by x, 2026-11-15; spec:
 * points-earning-lanes-spec-2026-11-15.md). These ride ON TOP of the
 * existing points ledger (points_log via awardPoints in actions.ts) —
 * there is no parallel system. Every lane award is an ordinary ledger
 * row whose source names its lane, with a deterministic refKey so the
 * same verified event can never pay twice, and every award is
 * reversible through the House Rule 1 clawback path (a compensating
 * negative "clawback" row — see reverseLaneAward in actions.ts).
 *
 * THE GATE (House Rule 4, mirroring recordSubscriptionRewards): only
 * PAYING seats earn lane points — a recorded paid plan (Gold /
 * Diamond / Owner) AND not a comped fleet-included seat
 * (isCompedFleetDriver). Points are points: nothing in this module
 * converts them to a token or cash, and no dollar value is attached
 * to a point anywhere.
 *
 * ALL VALUES LIVE HERE — this is the ONE config location. x can
 * retune any number by editing this file alone; nothing else in the
 * codebase hardcodes a lane value. Values are conservative starting
 * defaults (the daily table pays up to 500/day; a lane award is a
 * bonus on top of real verified work, not a second daily table).
 *
 * Pure functions only: no I/O. actions.ts resolves the sealed records
 * (trips, loads + chain seals, daily logs, duty timeline, intel and
 * fuel reports, poster referrals) and routes every decision through
 * here. Unit-tested (pointsLanes.test.ts) + integration-tested
 * against the real handlers (pointsLanesFlow.test.ts).
 */

// ---- Values (THE config) ----------------------------------------------------

/** Lane 1 — lifetime sealed-miles milestones (one-time each). */
export const LANE1_MILES_MILESTONES: readonly { miles: number; points: number }[] = [
  { miles: 10_000, points: 250 },
  { miles: 50_000, points: 1_000 },
  { miles: 100_000, points: 2_500 },
];

/** Lane 1 — on-time streak: points per completed block of consecutive
 *  on-time sealed loads. */
export const LANE1_ONTIME_BLOCK_SIZE = 5;
export const LANE1_ONTIME_BLOCK_POINTS = 100;

/** Lane 1 — a sealed daily log whose pre-trip inspection passed with
 *  zero defects (the app's sealed inspection record). */
export const LANE1_CLEAN_INSPECTION_POINTS = 25;

/** Lane 1 — a completed Mon–Sun week with zero HOS violations in the
 *  sealed duty timeline. */
export const LANE1_HOS_CLEAN_WEEK_POINTS = 150;

/** Lane 2 — a map report (road intel or fuel price) corroborated by
 *  another driver. One award per report, ever. */
export const LANE2_REPORT_POINTS = 20;

/** Lane 2 anti-farm cap: at most this many Lane 2 awards per driver
 *  per driver-local day (so at most 5 × 20 = 100 Lane 2 points/day). */
export const LANE2_DAILY_AWARD_CAP = 5;

/** Lane 2 corroboration window: two reports corroborate each other
 *  only when filed within this window of each other (4 hours — the
 *  same staleness horizon weigh-station status uses in
 *  weighStation.ts). */
export const LANE2_CORROBORATION_WINDOW_MS = 4 * 3600000;

/** Lane 2 corroboration radius: reports must be about the same spot —
 *  the same quarter-mile radius the intel GPS-confirm uses. */
export const LANE2_CORROBORATION_RADIUS_MI = 0.25;

/** Lane 2 fuel prices: two reports agree when their prices are within
 *  this many dollars per gallon; they clearly contradict when they
 *  differ by more than the contradiction threshold. Between the two,
 *  neither corroborates nor contradicts (pump prices drift). */
export const LANE2_FUEL_AGREE_USD = 0.15;
export const LANE2_FUEL_CONTRADICT_USD = 0.5;

/** Lane 3 — a broker/shipper the driver brought in posts/releases
 *  their first load on the board. Bigger than a driver referral
 *  (which pays $STONER from the reward wallet on first subscription);
 *  this is the points-side growth award. */
export const LANE3_POSTER_REFERRAL_POINTS = 500;

/** Lane 3 — first sealed load on an origin→destination lane nobody
 *  has ever logged. */
export const LANE3_FIRST_LANE_POINTS = 100;

/** Lane 3 — Founding Tester completion (activity on ≥10 of the first
 *  14 days after a tester invite is accepted). */
export const LANE3_FOUNDING_TESTER_POINTS = 250;

// ---- Ledger sources -----------------------------------------------------------

export const LANE1_MILES_SOURCE = "lane1_miles_milestone";
export const LANE1_ONTIME_SOURCE = "lane1_ontime_streak";
export const LANE1_INSPECTION_SOURCE = "lane1_clean_inspection";
export const LANE1_HOS_SOURCE = "lane1_hos_week";
export const LANE2_INTEL_SOURCE = "lane2_intel_report";
export const LANE2_FUEL_SOURCE = "lane2_fuel_report";
export const LANE3_POSTER_SOURCE = "lane3_poster_referral";
export const LANE3_FIRST_LANE_SOURCE = "lane3_first_lane";
export const LANE3_FOUNDING_SOURCE = "lane3_founding_tester";

export type PointsLane = "lane1" | "lane2" | "lane3";

/** Which lane a ledger source belongs to (null for non-lane rows). */
export function laneForSource(source: string): PointsLane | null {
  if (source.startsWith("lane1_")) return "lane1";
  if (source.startsWith("lane2_")) return "lane2";
  if (source.startsWith("lane3_")) return "lane3";
  return null;
}

/** The driver-facing "How to earn" list, built from the values above
 *  so the app can never drift from the config. No dollar values —
 *  points are points. */
export function howToEarnLanes(): {
  lane: PointsLane;
  title: string;
  lines: string[];
}[] {
  return [
    {
      lane: "lane1",
      title: "Drive well",
      lines: [
        ...LANE1_MILES_MILESTONES.map(
          (m) => `${m.miles.toLocaleString("en-US")} lifetime sealed miles — +${m.points} pts (one time)`,
        ),
        `Every ${LANE1_ONTIME_BLOCK_SIZE} sealed loads delivered on time in a row — +${LANE1_ONTIME_BLOCK_POINTS} pts`,
        `A day logged with a clean pre-trip inspection (no defects) — +${LANE1_CLEAN_INSPECTION_POINTS} pts`,
        `A full week with zero hours-of-service violations in your sealed log — +${LANE1_HOS_CLEAN_WEEK_POINTS} pts`,
      ],
    },
    {
      lane: "lane2",
      title: "Feed the map",
      lines: [
        `A road report (parking, scale open/closed, hazard, closure) another driver confirms — +${LANE2_REPORT_POINTS} pts`,
        `A fuel price report another driver matches at the same station — +${LANE2_REPORT_POINTS} pts`,
        "Unconfirmed reports earn nothing — a second driver has to back it up.",
      ],
    },
    {
      lane: "lane3",
      title: "Grow it",
      lines: [
        `Bring a broker or shipper to the load board — +${LANE3_POSTER_REFERRAL_POINTS} pts when their first load posts`,
        `First driver ever to seal a load on a lane (city to city) — +${LANE3_FIRST_LANE_POINTS} pts`,
        `Founding Testers: active on 10 of your first 14 days — +${LANE3_FOUNDING_TESTER_POINTS} pts`,
      ],
    },
  ];
}

// ---- Lane 1: sealed miles milestones ------------------------------------------

/** Milestone tiers a lifetime sealed-miles total has crossed. */
export function milesMilestonesCrossed(
  totalSealedMiles: number,
): { miles: number; points: number }[] {
  if (!Number.isFinite(totalSealedMiles) || totalSealedMiles <= 0) return [];
  return LANE1_MILES_MILESTONES.filter((m) => totalSealedMiles >= m.miles);
}

// ---- Lane 1: on-time streaks ----------------------------------------------------

export interface SealedLoadTiming {
  loadId: number;
  /** POD seal time (ms epoch). */
  sealMs: number;
  /** Delivery appointment (ms epoch), or null when the load carries
   *  no readable appointment — such loads neither extend nor break a
   *  streak (on-time is undefined for them). */
  apptMs: number | null;
  /** True when the seal landed inside the appointment + grace. */
  onTime: boolean;
}

export interface OnTimeBlockAward {
  refKey: string;
  runStartLoadId: number;
  block: number;
  points: number;
}

/**
 * Completed on-time blocks over a driver's sealed loads, in seal
 * order. A run is a maximal run of consecutive on-time loads (loads
 * with no appointment are skipped entirely — they neither extend nor
 * break a run; a late load ends the run). Every completed block of
 * LANE1_ONTIME_BLOCK_SIZE inside a run earns once, keyed by the run's
 * first load + block index, so recomputation is idempotent and a
 * voided seal honestly un-justifies the blocks it held up (the
 * evaluator reverses awards whose refKey is no longer justified).
 */
export function onTimeBlockAwards(
  loads: readonly SealedLoadTiming[],
): OnTimeBlockAward[] {
  const ordered = [...loads]
    .filter((l) => l.apptMs != null)
    .sort((a, b) => a.sealMs - b.sealMs || a.loadId - b.loadId);
  const out: OnTimeBlockAward[] = [];
  let runStart: number | null = null;
  let runLen = 0;
  const flush = () => {
    if (runStart == null) return;
    const blocks = Math.floor(runLen / LANE1_ONTIME_BLOCK_SIZE);
    for (let b = 1; b <= blocks; b++) {
      out.push({
        refKey: `lane1-ontime-${runStart}-${b}`,
        runStartLoadId: runStart,
        block: b,
        points: LANE1_ONTIME_BLOCK_POINTS,
      });
    }
  };
  for (const l of ordered) {
    if (l.onTime) {
      if (runStart == null) runStart = l.loadId;
      runLen++;
    } else {
      flush();
      runStart = null;
      runLen = 0;
    }
  }
  flush();
  return out;
}

// ---- Lane 1: HOS violations from the sealed duty timeline ----------------------

export interface DutyEventLike {
  state: string; // off_duty | sleeper | on_duty | driving
  at: string; // ISO timestamp
}

const H = 3600000;

/**
 * HOS violations inside [startMs, endMs), computed by replaying the
 * sealed duty timeline with the SAME rules the in-app clocks use
 * (computeHos in App.tsx / the DOT packet in actions.ts): 11h driving
 * after a 10h reset, 14h duty window from the first on-duty/driving
 * segment after the reset, 70h on-duty+driving in the trailing 8
 * days, 30-minute break after 8h of driving. A violation is counted
 * when a DRIVING segment that overlaps the window pushes any clock
 * past its limit (the raw used hours are compared — the display
 * clocks clamp at zero, the replay does not). Returns one entry per
 * violated rule per offending segment; an empty list means the week
 * was clean. History before the window still feeds the clocks (a
 * reset or cycle debt earned earlier counts), exactly like the live
 * clocks.
 */
export function hosViolationsInWindow(
  events: readonly DutyEventLike[],
  startMs: number,
  endMs: number,
): { kind: "drive" | "window" | "cycle" | "break"; at: number }[] {
  const sorted = [...events]
    .map((e) => ({ state: e.state, start: Date.parse(e.at) }))
    .filter((e) => Number.isFinite(e.start))
    .sort((a, b) => a.start - b.start);
  const violations: { kind: "drive" | "window" | "cycle" | "break"; at: number }[] = [];
  if (sorted.length === 0) return violations;

  // Replay state, mirroring computeHos.
  let resetAt = 0;
  let offRun = 0;
  let offRunStart = 0;
  let drivingSinceReset = 0;
  let windowStart: number | null = null;
  let drivingSinceBreak = 0;
  let nonDriveRun = 0;
  // Trailing-8-day duty segments (for the cycle clock).
  const dutySegs: { start: number; end: number }[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const segStart = sorted[i]!.start;
    const segEnd = i + 1 < sorted.length ? sorted[i + 1]!.start : endMs;
    if (segEnd <= segStart) continue;
    const state = sorted[i]!.state;

    if (state === "off_duty" || state === "sleeper") {
      if (offRun === 0) offRunStart = segStart;
      offRun += segEnd - segStart;
      if (offRun >= 10 * H && resetAt < offRunStart + 10 * H) {
        resetAt = offRunStart + 10 * H;
        drivingSinceReset = 0;
        windowStart = null;
      }
      nonDriveRun += segEnd - segStart;
      if (nonDriveRun >= 0.5 * H) drivingSinceBreak = 0;
      continue;
    }
    // Any duty segment ends the off-duty run (the server's own HOS
    // replay does the same: `else offRun = 0`).
    offRun = 0;
    if (state === "driving") {
      nonDriveRun = 0;
    } else {
      // On-duty-not-driving counts toward the 30-minute break
      // interruption — 49 CFR 395.3(a)(3)(ii): after 8 cumulative
      // hours of DRIVING, the interruption can be off-duty, sleeper,
      // or on-duty-not-driving, in any mix, so long as 30 consecutive
      // minutes pass with no driving. The clocks (computeHos /
      // hosClocksFor) have always accumulated every non-driving
      // segment this way; zeroing the run on an on-duty segment (the
      // old line here) invented break violations the clocks never
      // showed — e.g. 8h driving, 30 min fueling on duty, then
      // driving on was judged a break violation. Fixed 2026-11-15.
      nonDriveRun += segEnd - segStart;
      if (nonDriveRun >= 0.5 * H) drivingSinceBreak = 0;
    }
    const effStart = Math.max(segStart, resetAt);
    if (state === "on_duty" || state === "driving") {
      if (windowStart === null && segEnd > resetAt) windowStart = effStart;
      dutySegs.push({ start: effStart, end: segEnd });
    }
    if (state !== "driving") continue;

    // A driving segment: advance the clocks over it, then judge.
    const driveMs = Math.max(0, segEnd - effStart);
    drivingSinceReset += driveMs;
    drivingSinceBreak += driveMs;
    const overlapsWindow = segEnd > startMs && segStart < endMs;
    if (!overlapsWindow) continue;
    const judgeAt = Math.min(segEnd, endMs);
    if (drivingSinceReset > 11 * H + 60000) {
      violations.push({ kind: "drive", at: judgeAt });
    }
    if (windowStart !== null && judgeAt - windowStart > 14 * H + 60000) {
      violations.push({ kind: "window", at: judgeAt });
    }
    if (drivingSinceBreak > 8 * H + 60000) {
      violations.push({ kind: "break", at: judgeAt });
    }
    const cycleFrom = judgeAt - 8 * 24 * H;
    let cycle = 0;
    for (const d of dutySegs) {
      const st = Math.max(d.start, cycleFrom);
      if (d.end > st) cycle += Math.min(d.end, judgeAt) - st;
    }
    if (cycle > 70 * H + 60000) {
      violations.push({ kind: "cycle", at: judgeAt });
    }
  }
  return violations;
}

// ---- Lane 2: corroboration -------------------------------------------------------

/** Great-circle distance in miles (the pure twin of the server's
 *  haversineMiServer — same formula, so both agree). */
export function haversineMi(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Intel kinds that directly contradict each other at the same spot. */
const INTEL_OPPOSITES: Record<string, string> = {
  parking_open: "parking_full",
  parking_full: "parking_open",
  weigh_open: "weigh_closed",
  weigh_closed: "weigh_open",
};

export type IntelRelation = "consistent" | "contradicted" | "unrelated";

/**
 * How two intel reports at (nearly) the same place and time relate:
 * same kind = consistent (they corroborate); opposite kinds
 * (parking open vs full, scale open vs closed) = contradicted;
 * anything else = unrelated. Distance and window are the caller's to
 * check with LANE2_CORROBORATION_RADIUS_MI / _WINDOW_MS.
 */
export function intelRelation(kindA: string, kindB: string): IntelRelation {
  if (kindA === kindB) return "consistent";
  if (INTEL_OPPOSITES[kindA] === kindB) return "contradicted";
  return "unrelated";
}

export type FuelRelation = "consistent" | "contradicted" | "unrelated";

/** How two fuel price reports relate: within LANE2_FUEL_AGREE_USD =
 *  consistent; more than LANE2_FUEL_CONTRADICT_USD apart = clearly
 *  contradicted; in between = unrelated (prices drift). */
export function fuelRelation(priceA: number, priceB: number): FuelRelation {
  const diff = Math.abs(priceA - priceB);
  if (diff <= LANE2_FUEL_AGREE_USD) return "consistent";
  if (diff > LANE2_FUEL_CONTRADICT_USD) return "contradicted";
  return "unrelated";
}

// ---- Lane 3: lane keys -----------------------------------------------------------

/** The normalized origin→destination key for the first-lane award:
 *  "CITY,ST->CITY,ST", upper-cased and trimmed. Null when any side is
 *  incomplete — a lane is only a lane with both ends named. */
export function laneKeyFor(
  pickupCity: string | null,
  pickupState: string | null,
  deliveryCity: string | null,
  deliveryState: string | null,
): string | null {
  const norm = (s: string | null) => (s ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  const pc = norm(pickupCity);
  const ps = norm(pickupState);
  const dc = norm(deliveryCity);
  const ds = norm(deliveryState);
  if (!pc || !ps || !dc || !ds) return null;
  return `${pc},${ps}->${dc},${ds}`;
}

/** The driver-facing lane label for a key ("MOBILE,AL->DALLAS,TX" →
 *  "Mobile, AL → Dallas, TX" is the client's typographic choice; the
 *  ledger reason uses this plain form). */
export function laneLabelForKey(laneKey: string): string {
  return laneKey.replace("->", " → ");
}
