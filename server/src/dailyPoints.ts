/**
 * SM Points — daily task table v2 + free-tier earning rules (REWARDS
 * REWORK, owner-approved 2026-10-26 with amendments A1/A2; spec:
 * rewards-rework-proposal-2026-10-26.md).
 *
 * The table's PAID-tier values (a perfect paid day still totals the
 * 500-point DAILY_POINTS_CAP):
 * - briefing check-in 25 (UNCHANGED — owner amendment A1)
 * - pre-trip DVIR 50 (unchanged)
 * - post-trip DVIR 25 (unchanged; absorbed by the 500 cap, as before)
 * - trip_sealed 100 → 120
 * - pod_seal (on-time POD) 150 → 165
 * - clean_day 75 (unchanged)
 * - intel 50 → 35
 * - fuel_stop 25 → 10
 * - debrief 25 → 20
 * The lines add to 525; the cap holds a perfect day at exactly 500.
 * The clean-week streak bonus (+200) lives OUTSIDE the daily cap.
 *
 * FREE-TIER RULES (owner amendment A2): a user with no active paid
 * plan (the app's "basic" tier — company/fleet-covered drivers count
 * as paid tier, see awardDailyTask in actions.ts) earns HALF on
 * sealed-work points only: trip_sealed pays 60, pod_seal pays 82
 * (floor of half). Every other daily task pays its full table value
 * on the free tier — EXCEPT fuel_stop, which pays NOTHING on the free
 * tier (fuel route/planner features are paid-tier only). Points
 * already earned are never retroactively changed: the tier is read
 * at award time only.
 *
 * Pure functions only: no I/O, unit-tested (dailyPoints.test.ts).
 * actions.ts resolves the caller's tier and routes EVERY daily award
 * through dailyTaskPoints() below — there is no other award path.
 */

export const DAILY_TASKS = [
  { key: "briefing", label: "Morning Briefing check-in", points: 25 },
  { key: "dvir", label: "Pre-trip DVIR signed", points: 50 },
  { key: "posttrip_dvir", label: "Post-trip DVIR signed", points: 25 },
  { key: "trip_sealed", label: "Trip driven and sealed", points: 120 },
  { key: "pod_seal", label: "On-time delivery — POD sealed", points: 165 },
  { key: "clean_day", label: "Clean driving day (no overspeed)", points: 75 },
  { key: "intel", label: "Road intel confirmed (first of the day)", points: 35 },
  { key: "fuel_stop", label: "Fuel stop logged", points: 10 },
  { key: "debrief", label: "Post-Trip Debrief reviewed", points: 20 },
] as const;

export type DailyTaskKey = (typeof DAILY_TASKS)[number]["key"];

/** Daily cap on daily-task points — unchanged by the rework. */
export const DAILY_POINTS_CAP = 500;

/** Clean-week streak bonus — unchanged, paid outside the daily cap. */
export const CLEAN_WEEK_POINTS = 200;

/** Sealed-work tasks: the only lines the free tier earns at half. */
export const SEALED_WORK_TASKS: readonly DailyTaskKey[] = [
  "trip_sealed",
  "pod_seal",
];

/** Table (paid-tier) points for a task; 0 for an unknown key. */
export function dailyTaskTablePoints(task: DailyTaskKey): number {
  return DAILY_TASKS.find((t) => t.key === task)?.points ?? 0;
}

/**
 * Points a task actually pays for the given tier. Paid tier (any
 * active paid plan, including company/fleet-covered drivers) always
 * earns the full table value. Free tier: sealed work pays floor of
 * half (trip_sealed 60, pod_seal 82), fuel_stop pays 0, and every
 * other task pays its full table value.
 */
export function dailyTaskPoints(task: DailyTaskKey, paidTier: boolean): number {
  const table = dailyTaskTablePoints(task);
  if (paidTier) return table;
  if (task === "fuel_stop") return 0;
  if (SEALED_WORK_TASKS.includes(task)) return Math.floor(table / 2);
  return table;
}
