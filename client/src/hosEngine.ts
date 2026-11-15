/**
 * HOS CLOCK ENGINE — the one reckoning behind every hours-of-service
 * surface (regulatory audit fixes A3 + A10, 2026-11-15).
 *
 * Before this module the rules lived as three near-identical inline
 * copies (client computeHos, server hosClocksFor, the DOT packet).
 * The audit found two gaps in all of them:
 *
 *   A3 — 49 CFR 395.3(b): the cycle limit follows the CARRIER's
 *   operating schedule — 60 hours / 7 days for carriers not
 *   operating every day, 70 / 8 for those that do. The clocks were
 *   hard-coded 70/8, which OVERSTATES a 60/7 driver's legal hours.
 *   The engine now takes the cycle type (driver setting, fleet
 *   override — resolved by the caller) and defaults to "70/8",
 *   the pre-fix behaviour.
 *
 *   A10 — 49 CFR 395.1(g): split sleeper. Two qualifying rest
 *   periods — one of at least 7 consecutive hours in the sleeper
 *   berth, the other at least 2 hours off duty / sleeper, the pair
 *   totalling at least 10 hours — pair so that NEITHER period
 *   counts against the 14-hour window, and the shift reckons from
 *   the end of the FIRST period of the pair (driving done between
 *   the two periods counts toward the 11). A full 10-hour rest
 *   still resets everything, exactly as before. An unpaired period
 *   changes nothing — the clocks stay conservative until the pair
 *   completes. The Safety Academy already taught the split; now
 *   the clocks honour it.
 *
 * The 30-minute break (395.3(a)(3)(ii)) is unchanged: driving
 * accumulates since the last ≥30-minute non-driving stretch, and
 * off-duty, sleeper, and on-duty-not-driving all satisfy it.
 *
 * Planning aid only — the certified ELD is the official record.
 * Pure functions only. The server twin (server/src/hosEngine.ts)
 * implements the identical algorithm; hosEngine tests on both
 * sides pin the same scenarios.
 */

export type CycleType = "60/7" | "70/8";

export const CYCLE_LIMITS: Record<CycleType, { hours: number; days: number }> = {
  "60/7": { hours: 60, days: 7 },
  "70/8": { hours: 70, days: 8 },
};

export function cycleTypeOf(v: unknown): CycleType {
  return v === "60/7" ? "60/7" : "70/8";
}

export interface HosEventLike {
  state: string; // off_duty | sleeper | on_duty | driving
  at: string; // ISO timestamp
}

export interface HosClockResult {
  hasData: boolean;
  driveRemainH: number;
  windowRemainH: number;
  cycleRemainH: number;
  breakRemainH: number;
}

const H = 3600000;

interface Seg {
  state: string;
  start: number;
  end: number;
}

function segmentsOf(events: readonly HosEventLike[], nowMs: number): Seg[] {
  const sorted = [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const segs: Seg[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = Date.parse(sorted[i]!.at);
    const end = i + 1 < sorted.length ? Date.parse(sorted[i + 1]!.at) : nowMs;
    if (Number.isFinite(start) && end > start) segs.push({ state: sorted[i]!.state, start, end });
  }
  return segs;
}

interface RestRun {
  start: number;
  end: number;
  /** Longest CONSECUTIVE sleeper-berth stretch inside the run —
   *  the split's "at least 7 in the berth" test reads this, not
   *  the run total (a mixed off/sleeper run can total 7+ without
   *  7 consecutive in the berth). */
  maxSleeperRun: number;
}

function restRunsOf(segs: readonly Seg[]): RestRun[] {
  const runs: RestRun[] = [];
  let cur: RestRun | null = null;
  let sleeperRun = 0;
  for (const s of segs) {
    if (s.state === "off_duty" || s.state === "sleeper") {
      if (!cur) {
        cur = { start: s.start, end: s.end, maxSleeperRun: 0 };
        sleeperRun = 0;
      }
      cur.end = s.end;
      if (s.state === "sleeper") {
        sleeperRun += s.end - s.start;
        cur.maxSleeperRun = Math.max(cur.maxSleeperRun, sleeperRun);
      } else {
        sleeperRun = 0;
      }
    } else {
      if (cur) runs.push(cur);
      cur = null;
      sleeperRun = 0;
    }
  }
  if (cur) runs.push(cur);
  return runs;
}

/** One reckoning epoch: from `completedAt` onward, the shift is
 *  reckoned from `anchor` (driving/window count from there), and
 *  the `excluded` rest periods (the second half of a split pair)
 *  do not count against the 14-hour window. A full 10-hour reset
 *  is an epoch whose anchor is its own completion point, with
 *  nothing excluded. */
export interface HosEpoch {
  completedAt: number;
  anchor: number;
  excluded: { start: number; end: number }[];
}

/** The epoch timeline for a duty history: every completed 10-hour
 *  reset and every completed split pair, in order. The governing
 *  epoch at any moment is the last one completed by then. */
export function hosEpochs(events: readonly HosEventLike[], nowMs: number): HosEpoch[] {
  const segs = segmentsOf(events, nowMs);
  const epochs: HosEpoch[] = [];
  let pending: (RestRun & { isLong: boolean }) | null = null;
  for (const run of restRunsOf(segs)) {
    const dur = run.end - run.start;
    if (dur >= 10 * H) {
      const at = run.start + 10 * H;
      epochs.push({ completedAt: at, anchor: at, excluded: [] });
      pending = null;
      continue;
    }
    const isQP = dur >= 2 * H;
    if (!isQP) continue; // a short rest neither pairs nor breaks a pending pair
    const isLong = run.maxSleeperRun >= 7 * H;
    if (
      pending &&
      (pending.isLong || isLong) &&
      pending.end - pending.start + dur >= 10 * H
    ) {
      epochs.push({
        completedAt: run.end,
        anchor: pending.end,
        excluded: [{ start: run.start, end: run.end }],
      });
    }
    // Rolling pairing: this period can itself be the first half of
    // the NEXT pair (the classic 8/2 then 2/8 roll).
    pending = { ...run, isLong };
  }
  return epochs;
}

/** The governing epoch at a moment: the last epoch completed by
 *  then, or null when no reset/pair has ever completed. */
export function epochAt(epochs: readonly HosEpoch[], atMs: number): HosEpoch | null {
  let best: HosEpoch | null = null;
  for (const e of epochs) {
    if (e.completedAt <= atMs) best = e;
    else break;
  }
  return best;
}

const overlap = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));

/** The four clocks at `nowMs` under the given cycle type. */
export function hosClocksFromEvents(
  events: readonly HosEventLike[],
  nowMs: number,
  cycleType: CycleType = "70/8",
): HosClockResult {
  const cycle = CYCLE_LIMITS[cycleType];
  const segs = segmentsOf(events, nowMs);
  if (segs.length === 0) {
    return { hasData: false, driveRemainH: 11, windowRemainH: 14, cycleRemainH: cycle.hours, breakRemainH: 8 };
  }
  const epoch = epochAt(hosEpochs(events, nowMs), nowMs);
  const anchor = epoch?.anchor ?? 0;
  const excluded = epoch?.excluded ?? [];

  let driving = 0;
  let windowStart: number | null = null;
  for (const s of segs) {
    if (s.end <= anchor) continue;
    const st = Math.max(s.start, anchor);
    if (s.state === "driving") driving += s.end - st;
    if ((s.state === "on_duty" || s.state === "driving") && windowStart === null) windowStart = st;
  }
  const driveRemainH = Math.max(0, 11 - driving / H);
  let windowRemainH = 14;
  if (windowStart !== null) {
    let elapsed = nowMs - windowStart;
    for (const x of excluded) elapsed -= overlap(x.start, x.end, windowStart, nowMs);
    windowRemainH = Math.max(0, 14 - elapsed / H);
  }

  const cycleFrom = nowMs - cycle.days * 24 * H;
  let cycleUsed = 0;
  for (const s of segs) {
    if (s.state !== "on_duty" && s.state !== "driving") continue;
    const st = Math.max(s.start, cycleFrom);
    if (s.end > st) cycleUsed += s.end - st;
  }
  const cycleRemainH = Math.max(0, cycle.hours - cycleUsed / H);

  // 30-min break: driving since the last >=30min non-driving stretch.
  let drivingSinceBreak = 0;
  let nonDriveRun = 0;
  for (const s of segs) {
    if (s.state === "driving") {
      if (nonDriveRun >= 0.5 * H) drivingSinceBreak = 0;
      nonDriveRun = 0;
      drivingSinceBreak += s.end - s.start;
    } else {
      nonDriveRun += s.end - s.start;
    }
  }
  if (nonDriveRun >= 0.5 * H) drivingSinceBreak = 0;
  const breakRemainH = Math.max(0, 8 - drivingSinceBreak / H);

  return { hasData: true, driveRemainH, windowRemainH, cycleRemainH, breakRemainH };
}
