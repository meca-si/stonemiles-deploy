/**
 * SM Points — REWARDS LAYER 2 + THE ANTI-CHEAT SAFETY NET (locked by
 * x, 2026-11-15; spec: points-rewards-layer2-spec-2026-11-15.md).
 * Layer 2 rides the SAME ledger as Lanes 1–3 (points_log via
 * awardPoints in actions.ts) — no parallel system. Every Layer 2
 * award is an ordinary ledger row whose source starts "layer2_",
 * keyed by a deterministic refKey so the same verified event can
 * never pay twice, and reversible through the same clawback path
 * (reverseLaneAward in actions.ts).
 *
 * THE GATE is the lanes' gate (House Rule 4): only PAYING seats earn
 * — a recorded paid plan AND not a comped fleet-included seat
 * (laneEligibleFor in actions.ts). Basic/comped seats earn zero
 * Layer 2 points, exactly as with the lanes.
 *
 * THE SAFETY NET (x's condition, system-wide): points compute only
 * from records a driver cannot fabricate — sealed trips/seals, the
 * real maintenance schedule state, settled subscription events,
 * corroborated referrals with real usage. Maintenance discipline
 * pays ONLY inside the schedule's due window, once per due cycle,
 * with a receipt attached, and only when the entry's odometer does
 * not contradict the sealed record. Suspected farming never
 * auto-bans: the implicated awards withhold and the pattern opens a
 * points_safety_holds row for the owner (see actions.ts). Proven
 * multi-accounting forfeits stay a MANUAL owner action (House
 * Rule 3) — nothing here forfeits anything automatically.
 *
 * ALL VALUES LIVE HERE, alongside the Lane 1–3 values in
 * pointsLanes.ts — this file is Layer 2's ONE config location.
 * Values sit in the lanes' scale (Lane 1: 25–2,500; Lane 2: 20;
 * Lane 3: 100–500): calendar drops are small and frequent, loyalty
 * and score prizes are the big slow ones. Points are points —
 * nothing here converts them to a token or cash or attaches a
 * dollar value.
 *
 * Pure functions only: no I/O. actions.ts resolves the records
 * (profile, accounts, activity days, trips, chain seals, overspeed
 * events, subscription events, referral rewards, maintenance
 * services + log + attachments, vehicle photos, credential docs)
 * and routes every decision through here. Unit-tested
 * (pointsLayer2.test.ts) + integration-tested against the real
 * handlers (pointsLayer2Flow.test.ts).
 *
 * Calendar math is driver-local (America/Chicago — the same
 * DRIVER_TZ the rest of the points system uses), computed with the
 * noon-probe day-start trick from actions.ts so DST never shifts a
 * birthday or a week boundary.
 */

// ---- Values (THE config) ------------------------------------------------------

/** Calendar — birthday points (month + day on the profile; the year
 *  is never collected). Paid once per year. */
export const LAYER2_BIRTHDAY_POINTS = 100;

/** Calendar — road anniversary: each year on the road with
 *  STONEMILES, paid on the account's anniversary day. */
export const LAYER2_ANNIVERSARY_POINTS = 150;

/** Birthday/anniversary grace: the lazy evaluator runs when the
 *  driver opens their points, so a birthday that fell earlier the
 *  same week still pays — within this many days after the day. */
export const LAYER2_CALENDAR_GRACE_DAYS = 7;

/** Calendar — Driver Appreciation Week (September): the Mon–Sun
 *  week containing September 15, for drivers active that week. */
export const LAYER2_APPRECIATION_WEEK_POINTS = 100;

/** Calendar — holiday drops: Christmas week and Thanksgiving week,
 *  for drivers active that week. Per holiday. */
export const LAYER2_HOLIDAY_POINTS = 50;

/** Score — a perfect-score week: the week's overall score (the same
 *  Reliability/Safety math as the season scores) holds the TOP BAND
 *  (Diamond, ≥ LAYER2_TOP_BAND_MIN_SCORE) for a full Mon–Sun week
 *  with real activity in it. */
export const LAYER2_PERFECT_WEEK_POINTS = 150;

/** The top score band's floor — the Diamond threshold the season
 *  ranks already use (rankOfScore in actions.ts). */
export const LAYER2_TOP_BAND_MIN_SCORE = 92;

/** Score — season-end rank prizes for TOP finishers, on top of the
 *  standing rank-milestone pay: Diamond and Platinum finishes only. */
export const LAYER2_SEASON_RANK_PRIZES: readonly { rank: string; points: number }[] = [
  { rank: "Diamond", points: 300 },
  { rank: "Platinum", points: 150 },
];

/** Score — a no-incident quarter: three consecutive calendar months
 *  with sealed trips and zero overspeed events (the sealed safety
 *  record's incident signal — the same events the Safety score is
 *  built from). */
export const LAYER2_NO_INCIDENT_QUARTER_POINTS = 300;

/** Score — the comeback: a season finished in the Gold band or
 *  better (≥ LAYER2_COMEBACK_TARGET_MIN) after an earlier season
 *  finished low (overall < LAYER2_COMEBACK_LOW_MAX). Once per
 *  recovery season. */
export const LAYER2_COMEBACK_POINTS = 200;
export const LAYER2_COMEBACK_LOW_MAX = 50;
export const LAYER2_COMEBACK_TARGET_MIN = 65;

/** Loyalty — renewal streaks: consecutive subscribed months covered
 *  by settled, non-reversed subscription events (a yearly event
 *  covers its 12 months). */
export const LAYER2_RENEWAL_STREAKS: readonly { months: number; points: number }[] = [
  { months: 6, points: 250 },
  { months: 12, points: 500 },
  { months: 24, points: 1200 },
];

/** Loyalty — referral ladder, on top of per-referral pay: bonuses at
 *  5 / 10 / 25 ACTIVE referrals. ACTIVE means settled (a referral
 *  reward exists and was never clawed back) AND real usage (the
 *  referred account shows at least
 *  LAYER2_REFERRAL_ACTIVE_MIN_ACTIVITY_DAYS distinct activity
 *  days) — raw signups never count. */
export const LAYER2_REFERRAL_LADDER: readonly { active: number; points: number }[] = [
  { active: 5, points: 250 },
  { active: 10, points: 500 },
  { active: 25, points: 1500 },
];
export const LAYER2_REFERRAL_ACTIVE_MIN_ACTIVITY_DAYS = 3;

/** Set-up-right — the complete rig record, one time: truck +
 *  trailer identity filled (year/make/model each), at least one
 *  photo of each, and CDL + medical credentials on file and
 *  current. */
export const LAYER2_RIG_RECORD_POINTS = 250;

/** Set-up-right — maintenance discipline: one award per due cycle
 *  for a service logged when the schedule said it was due, receipt
 *  attached, odometer in agreement with the sealed record. */
export const LAYER2_MAINTENANCE_POINTS = 50;

/** Maintenance backstop cap: at most this many maintenance awards
 *  per driver per calendar year (the due-cycle rule already bounds
 *  them; this is the belt on the suspenders). */
export const LAYER2_MAINTENANCE_ANNUAL_AWARD_CAP = 24;

/** A service counts as DUE when it lands at or after the due point,
 *  or this far BEFORE it (a service done a little early is still the
 *  due service): miles for odometer intervals, days for date dues. */
export const LAYER2_MAINTENANCE_DUE_EARLY_TOLERANCE_MI = 500;
export const LAYER2_MAINTENANCE_DUE_EARLY_TOLERANCE_DAYS = 14;

/** Odometer cross-check tolerance: dash odometers and the app's
 *  recorded odometers (fuel log, DVIRs, daily logs) can disagree by
 *  a few miles honestly; beyond this, the entry contradicts the
 *  sealed record. */
export const LAYER2_MAINTENANCE_ODOMETER_TOLERANCE_MI = 50;

/** Safety-net hold thresholds: at least this many near-duplicate
 *  maintenance copies, or this many odometer-contradicting entries,
 *  opens a hold for the owner and withholds maintenance awards. */
export const LAYER2_HOLD_DUPLICATE_THRESHOLD = 3;
export const LAYER2_HOLD_ODOMETER_THRESHOLD = 2;

// ---- Ledger sources -------------------------------------------------------------

export const LAYER2_BIRTHDAY_SOURCE = "layer2_birthday";
export const LAYER2_ANNIVERSARY_SOURCE = "layer2_anniversary";
export const LAYER2_APPRECIATION_SOURCE = "layer2_appreciation_week";
export const LAYER2_HOLIDAY_SOURCE = "layer2_holiday";
export const LAYER2_PERFECT_WEEK_SOURCE = "layer2_perfect_week";
export const LAYER2_SEASON_RANK_SOURCE = "layer2_season_rank";
export const LAYER2_NO_INCIDENT_SOURCE = "layer2_no_incident_quarter";
export const LAYER2_COMEBACK_SOURCE = "layer2_comeback";
export const LAYER2_RENEWAL_SOURCE = "layer2_renewal_streak";
export const LAYER2_REFERRAL_LADDER_SOURCE = "layer2_referral_ladder";
export const LAYER2_RIG_RECORD_SOURCE = "layer2_rig_record";
export const LAYER2_MAINTENANCE_SOURCE = "layer2_maintenance";

/** True when a ledger source is a Layer 2 source. */
export function isLayer2Source(source: string): boolean {
  return source.startsWith("layer2_");
}

/** The driver-facing "How to earn — Layer 2" list, built from the
 *  values above so the app can never drift from the config. Drafted
 *  from the master rewards document's language. No dollar values —
 *  points are points. */
export function howToEarnLayer2(): { section: string; lines: string[] }[] {
  const streak = (s: { months: number; points: number }) =>
    `${s.months} months — +${s.points.toLocaleString("en-US")} pts`;
  const ladder = (s: { active: number; points: number }) =>
    `${s.active} active referrals — +${s.points.toLocaleString("en-US")} pts`;
  return [
    {
      section: "Calendar",
      lines: [
        `Your birthday — +${LAYER2_BIRTHDAY_POINTS} pts (month and day only — we never ask the year)`,
        `Each year on the road with STONEMILES — +${LAYER2_ANNIVERSARY_POINTS} pts on your anniversary`,
        `Driver Appreciation Week in September: be active that week — +${LAYER2_APPRECIATION_WEEK_POINTS} pts`,
        `Christmas and Thanksgiving weeks: be active that week — +${LAYER2_HOLIDAY_POINTS} pts each`,
      ],
    },
    {
      section: "Score",
      lines: [
        `A perfect-score week — your score holds the top band a full week — +${LAYER2_PERFECT_WEEK_POINTS} pts`,
        `Finish a season at Platinum — +150 pts; at Diamond — +300 pts`,
        `Three clean months in a row, no safety incidents on your sealed record — +${LAYER2_NO_INCIDENT_QUARTER_POINTS} pts`,
        `The comeback: finish a season strong after a low one — +${LAYER2_COMEBACK_POINTS} pts`,
      ],
    },
    {
      section: "Loyalty",
      lines: [
        `Stay subscribed: ${LAYER2_RENEWAL_STREAKS.map(streak).join("; ")}`,
        `Referral ladder: ${LAYER2_REFERRAL_LADDER.map(ladder).join("; ")} — active means subscribed and really driving; signups alone don't count`,
      ],
    },
    {
      section: "Set up right",
      lines: [
        `Complete rig record — truck and trailer filled in, photos up, CDL and medical card current — +${LAYER2_RIG_RECORD_POINTS} pts (one time)`,
        `Maintenance logged when it was actually due, receipt attached — +${LAYER2_MAINTENANCE_POINTS} pts per service`,
        "Early or extra services are fine to log — they just don't earn. The schedule decides, and the same service never earns twice.",
      ],
    },
  ];
}

// ---- Driver-local calendar helpers ----------------------------------------------

const LAYER2_TZ = "America/Chicago";
const DAY_MS = 86400000;

/** Driver-local calendar day (YYYY-MM-DD) in America/Chicago — the
 *  twin of localDayKey in actions.ts. */
export function layer2DayKey(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: LAYER2_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

/** Driver-local {year, month, day} parts for an instant. */
export function layer2DayParts(ms: number): { year: number; month: number; day: number } {
  const [y = 1970, m = 1, d = 1] = layer2DayKey(ms).split("-").map(Number);
  return { year: y, month: m, day: d };
}

/** Start instant (ms) of the driver-local day containing ms
 *  (noon-probe, DST-exact — same trick as localDayStartMs). */
export function layer2DayStartMs(ms: number): number {
  const key = layer2DayKey(ms);
  const { year, month, day } = layer2DayParts(ms);
  const probe = Date.UTC(year, month - 1, day, 12, 0, 0);
  for (let deltaH = -14; deltaH <= 14; deltaH++) {
    const cand = probe + deltaH * 3600000;
    if (layer2DayKey(cand) === key && layer2DayKey(cand - 1) !== key) return cand;
  }
  return probe - 5 * 3600000; // unreachable in practice; CT is UTC-5/-6
}

/** Start instant (ms) of the driver-local day for a (year, month, day). */
function ymdDayStartMs(year: number, month: number, day: number): number {
  return layer2DayStartMs(Date.UTC(year, month - 1, day, 12, 0, 0));
}

/** Weekday (0=Sun … 6=Sat) of a driver-local day starting at dayStartMs. */
function weekdayOfDayStart(dayStartMs: number): number {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: LAYER2_TZ,
    weekday: "short",
  }).format(new Date(dayStartMs + 12 * 3600000));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
}

export interface CalendarWeek {
  /** Monday 00:00 driver-local. */
  startMs: number;
  /** Next Monday 00:00 driver-local. */
  endMs: number;
  /** The Monday's day key — the week's identity. */
  mondayKey: string;
  /** The week's seven day keys, Monday first. */
  dayKeys: string[];
}

function weekFromDayStart(dayStartMs: number): CalendarWeek {
  const wd = weekdayOfDayStart(dayStartMs);
  const back = (wd + 6) % 7; // days since Monday
  const startMs = dayStartMs - back * DAY_MS;
  const dayKeys: string[] = [];
  for (let i = 0; i < 7; i++) dayKeys.push(layer2DayKey(startMs + i * DAY_MS + 12 * 3600000));
  return { startMs, endMs: startMs + 7 * DAY_MS, mondayKey: dayKeys[0]!, dayKeys };
}

/** The Mon–Sun driver-local week containing an instant. */
export function calendarWeekOf(ms: number): CalendarWeek {
  return weekFromDayStart(layer2DayStartMs(ms));
}

/** Driver Appreciation Week: the Mon–Sun week containing Sep 15. */
export function appreciationWeek(year: number): CalendarWeek {
  return weekFromDayStart(ymdDayStartMs(year, 9, 15));
}

/** Christmas week: the Mon–Sun week containing Dec 25. */
export function christmasWeek(year: number): CalendarWeek {
  return weekFromDayStart(ymdDayStartMs(year, 12, 25));
}

/** Thanksgiving week: the Mon–Sun week containing the fourth
 *  Thursday of November. */
export function thanksgivingWeek(year: number): CalendarWeek {
  const nov1 = ymdDayStartMs(year, 11, 1);
  const wd = weekdayOfDayStart(nov1); // 0=Sun … 4=Thu
  const firstThursdayDay = 1 + ((4 - wd + 7) % 7);
  const fourthThursday = ymdDayStartMs(year, 11, firstThursdayDay + 21);
  return weekFromDayStart(fourthThursday);
}

// ---- Calendar awards --------------------------------------------------------------

export interface Layer2Award {
  refKey: string;
  source: string;
  points: number;
  reason: string;
}

/** A valid birthday pair: both set, month 1–12, and a day the month
 *  actually has (February allows 29 — leap babies celebrate on
 *  Feb 28 in common years, see birthdayAwardFor). */
export function validBirthMonthDay(
  month: number | null,
  day: number | null,
): month is number {
  if (month == null || day == null) return false;
  if (!Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1) return false;
  const daysIn = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
  return day <= daysIn;
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** The day-start of (month, day) in a given year, with Feb 29
 *  resolving to Feb 28 in common years. */
function monthDayStartMs(year: number, month: number, day: number): number {
  const d = month === 2 && day === 29 && !isLeapYear(year) ? 28 : day;
  return ymdDayStartMs(year, month, d);
}

/**
 * The birthday award due at `nowMs`, or null. Pays when today is the
 * birthday or within LAYER2_CALENDAR_GRACE_DAYS after it (the
 * evaluator is lazy — it runs when the driver opens their points).
 * Keyed by the birthday's year, so it pays once per year.
 */
export function birthdayAwardFor(
  birth: { month: number; day: number } | null,
  nowMs: number,
): Layer2Award | null {
  if (!birth || !validBirthMonthDay(birth.month, birth.day)) return null;
  const { year } = layer2DayParts(nowMs);
  for (const y of [year, year - 1]) {
    const start = monthDayStartMs(y, birth.month, birth.day);
    if (nowMs >= start && nowMs < start + (1 + LAYER2_CALENDAR_GRACE_DAYS) * DAY_MS) {
      return {
        refKey: `layer2-birthday-${y}`,
        source: LAYER2_BIRTHDAY_SOURCE,
        points: LAYER2_BIRTHDAY_POINTS,
        reason: `Happy birthday — +${LAYER2_BIRTHDAY_POINTS} SM Points for your birthday`,
      };
    }
  }
  return null;
}

/**
 * The road-anniversary award due at `nowMs`, or null: the account's
 * anniversary (same month/day as it was created) with at least one
 * full year elapsed, read on the day or within the grace window.
 * Keyed by the year count, so each anniversary pays once.
 */
export function anniversaryAwardFor(createdMs: number, nowMs: number): Layer2Award | null {
  if (!Number.isFinite(createdMs) || createdMs <= 0 || nowMs <= createdMs) return null;
  const c = layer2DayParts(createdMs);
  const { year } = layer2DayParts(nowMs);
  for (const y of [year, year - 1]) {
    const years = y - c.year;
    if (years < 1) continue;
    const start = monthDayStartMs(y, c.month, c.day);
    if (nowMs >= start && nowMs < start + (1 + LAYER2_CALENDAR_GRACE_DAYS) * DAY_MS) {
      return {
        refKey: `layer2-anniversary-${years}`,
        source: LAYER2_ANNIVERSARY_SOURCE,
        points: LAYER2_ANNIVERSARY_POINTS,
        reason: `Road anniversary — ${years} year${years === 1 ? "" : "s"} on the road with STONEMILES: +${LAYER2_ANNIVERSARY_POINTS} SM Points`,
      };
    }
  }
  return null;
}

/**
 * A calendar-week award (Appreciation Week / a holiday week) when
 * the week is COMPLETE and the driver was active in it — activity
 * being a sealed trip or seal inside the week, or an app activity
 * day stamped with one of the week's day keys.
 */
export function calendarWeekAward(args: {
  kind: "appreciation" | "christmas" | "thanksgiving";
  week: CalendarWeek;
  weekYear: number;
  activityMs: readonly number[];
  activityDayKeys: ReadonlySet<string>;
  nowMs: number;
}): Layer2Award | null {
  if (args.nowMs < args.week.endMs) return null;
  const active =
    args.activityMs.some((t) => t >= args.week.startMs && t < args.week.endMs) ||
    args.week.dayKeys.some((k) => args.activityDayKeys.has(k));
  if (!active) return null;
  if (args.kind === "appreciation") {
    return {
      refKey: `layer2-appreciation-${args.weekYear}`,
      source: LAYER2_APPRECIATION_SOURCE,
      points: LAYER2_APPRECIATION_WEEK_POINTS,
      reason: `Driver Appreciation Week ${args.weekYear} — you were on the road: +${LAYER2_APPRECIATION_WEEK_POINTS} SM Points`,
    };
  }
  const label = args.kind === "christmas" ? "Christmas" : "Thanksgiving";
  return {
    refKey: `layer2-holiday-${args.kind}-${args.weekYear}`,
    source: LAYER2_HOLIDAY_SOURCE,
    points: LAYER2_HOLIDAY_POINTS,
    reason: `${label} week ${args.weekYear} — you were on the road: +${LAYER2_HOLIDAY_POINTS} SM Points`,
  };
}

// ---- Score math (the season-score formulas, shared with getPoints) -----------------

export interface ScoreInputs {
  trips: number;
  seals: number;
  onTimeCounted: number;
  onTime: number;
  /** Overspeed events in the window's final 7 days (for a 7-day
   *  window, the whole window). */
  overspeedFinal7d: number;
  /** Overspeed events anywhere in the window (activity check). */
  overspeedAny: number;
}

/**
 * The overall score for a window, computed with EXACTLY the formulas
 * the season scores use (getDriverStats / the getPoints rank
 * evaluator): safety = 100 − 3 per overspeed event in the final 7
 * days, clamped; reliability = 50 + 2 per seal + 1 per trip + 10
 * when the on-time rate is ≥ 90%, capped at 100; overall = the
 * lower of the two. Null when the window holds no activity at all
 * (no trips, no seals, no overspeed) — an empty window has no score.
 */
export function windowOverallScore(i: ScoreInputs): number | null {
  if (i.trips === 0 && i.seals === 0 && i.overspeedAny === 0) return null;
  const safety = Math.max(0, Math.min(100, 100 - 3 * i.overspeedFinal7d));
  if (i.trips === 0 && i.seals === 0) return safety;
  let reliability = 50 + 2 * i.seals + i.trips;
  if (i.onTimeCounted > 0 && Math.round((i.onTime / i.onTimeCounted) * 100) >= 90) {
    reliability += 10;
  }
  return Math.min(safety, Math.min(100, reliability));
}

/** Rank band for a score — the same bands as rankOfScore in
 *  actions.ts. */
export function rankForScore(score: number): string {
  return score >= 92
    ? "Diamond"
    : score >= 80
      ? "Platinum"
      : score >= 65
        ? "Gold"
        : score >= 50
          ? "Silver"
          : score >= 30
            ? "Bronze"
            : "Rookie";
}

/** Season-end rank prize for a finished season's overall score
 *  (top finishers only — Diamond / Platinum). */
export function seasonRankPrize(seasonNumber: number, overall: number | null): Layer2Award | null {
  if (overall == null) return null;
  const rank = rankForScore(overall);
  const prize = LAYER2_SEASON_RANK_PRIZES.find((p) => p.rank === rank);
  if (!prize) return null;
  return {
    refKey: `layer2-seasonrank-${seasonNumber}`,
    source: LAYER2_SEASON_RANK_SOURCE,
    points: prize.points,
    reason: `Season ${seasonNumber} top finish — you ended at ${rank}: +${prize.points} SM Points`,
  };
}

/**
 * Comeback awards over the driver's finished seasons, in order: a
 * season finished at Gold band or better (≥ target) after ANY
 * earlier season finished low (< low max) pays once, keyed by the
 * recovery season. Empty seasons (overall null) neither count as
 * low nor as recoveries.
 */
export function comebackAwards(
  seasons: readonly { seasonNumber: number; overall: number | null }[],
): Layer2Award[] {
  const out: Layer2Award[] = [];
  let sawLow = false;
  for (const s of [...seasons].sort((a, b) => a.seasonNumber - b.seasonNumber)) {
    if (s.overall == null) continue;
    if (sawLow && s.overall >= LAYER2_COMEBACK_TARGET_MIN) {
      out.push({
        refKey: `layer2-comeback-${s.seasonNumber}`,
        source: LAYER2_COMEBACK_SOURCE,
        points: LAYER2_COMEBACK_POINTS,
        reason: `The comeback — Season ${s.seasonNumber} finished strong after a low season: +${LAYER2_COMEBACK_POINTS} SM Points`,
      });
    }
    if (s.overall < LAYER2_COMEBACK_LOW_MAX) sawLow = true;
  }
  return out;
}

/** A perfect-score week: overall in the top band for a completed
 *  Mon–Sun week. Keyed by the week's Monday. */
export function perfectWeekAward(mondayKey: string, overall: number | null): Layer2Award | null {
  if (overall == null || overall < LAYER2_TOP_BAND_MIN_SCORE) return null;
  return {
    refKey: `layer2-perfectweek-${mondayKey}`,
    source: LAYER2_PERFECT_WEEK_SOURCE,
    points: LAYER2_PERFECT_WEEK_POINTS,
    reason: `Perfect-score week of ${mondayKey} — your score held the top band all week: +${LAYER2_PERFECT_WEEK_POINTS} SM Points`,
  };
}

/**
 * No-incident quarter awards over consecutive calendar months
 * (ascending, every month in the span present): every third
 * consecutive CLEAN month closes a quarter and pays, keyed by the
 * closing month. A month that isn't clean (no sealed trips, or an
 * overspeed event on the sealed record) resets the run.
 */
export function noIncidentQuarterAwards(
  months: readonly { key: string; clean: boolean }[],
): Layer2Award[] {
  const out: Layer2Award[] = [];
  let run = 0;
  for (const m of months) {
    run = m.clean ? run + 1 : 0;
    if (run > 0 && run % 3 === 0) {
      out.push({
        refKey: `layer2-noincident-${m.key}`,
        source: LAYER2_NO_INCIDENT_SOURCE,
        points: LAYER2_NO_INCIDENT_QUARTER_POINTS,
        reason: `No-incident quarter — three clean months through ${m.key}: +${LAYER2_NO_INCIDENT_QUARTER_POINTS} SM Points`,
      });
    }
  }
  return out;
}

// ---- Loyalty: renewal streaks -------------------------------------------------------

/** "YYYY-MM" month key (driver-local) for an instant. */
export function monthKeyOf(ms: number): string {
  return layer2DayKey(ms).slice(0, 7);
}

function nextMonthKey(key: string): string {
  const [y = 1970, m = 1] = key.split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/** The set of calendar months covered by settled subscription
 *  events: a monthly event covers its month; a yearly event covers
 *  its month and the eleven after it. (The caller passes only
 *  non-reversed events — a refunded payment covers nothing.) */
export function coveredMonthKeys(
  events: readonly { createdMs: number; period: "monthly" | "yearly" }[],
): Set<string> {
  const out = new Set<string>();
  for (const e of events) {
    let key = monthKeyOf(e.createdMs);
    const n = e.period === "yearly" ? 12 : 1;
    for (let i = 0; i < n; i++) {
      out.add(key);
      key = nextMonthKey(key);
    }
  }
  return out;
}

/** The longest run of consecutive months in a key set. */
export function longestMonthRun(keys: ReadonlySet<string>): number {
  let best = 0;
  for (const key of keys) {
    // Only measure from run starts (previous month absent).
    const [y = 1970, m = 1] = key.split("-").map(Number);
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    if (keys.has(prev)) continue;
    let run = 0;
    let cur = key;
    while (keys.has(cur)) {
      run++;
      cur = nextMonthKey(cur);
    }
    if (run > best) best = run;
  }
  return best;
}

/** Renewal-streak awards justified by a longest consecutive run. */
export function renewalStreakAwards(longestRun: number): Layer2Award[] {
  return LAYER2_RENEWAL_STREAKS.filter((s) => longestRun >= s.months).map((s) => ({
    refKey: `layer2-renewal-${s.months}`,
    source: LAYER2_RENEWAL_SOURCE,
    points: s.points,
    reason: `Renewal streak — ${s.months} consecutive subscribed months: +${s.points} SM Points`,
  }));
}

/** Referral-ladder awards justified by an ACTIVE referral count. */
export function referralLadderAwards(activeCount: number): Layer2Award[] {
  return LAYER2_REFERRAL_LADDER.filter((s) => activeCount >= s.active).map((s) => ({
    refKey: `layer2-refladder-${s.active}`,
    source: LAYER2_REFERRAL_LADDER_SOURCE,
    points: s.points,
    reason: `Referral ladder — ${s.active} active referrals: +${s.points} SM Points`,
  }));
}

// ---- Set-up-right: the complete rig record -------------------------------------------

/** True when the rig record is complete: truck AND trailer identity
 *  (year + make + model each), at least one photo of each, and the
 *  CDL + medical credentials on file and current. VIN/plate are NOT
 *  required — they are owner-only secrets and never gate a reward. */
export function rigRecordComplete(a: {
  truckYear: number | null;
  truckMake: string | null;
  truckModel: string | null;
  trailerYear: number | null;
  trailerMake: string | null;
  trailerModel: string | null;
  truckPhotos: number;
  trailerPhotos: number;
  cdlCurrent: boolean;
  medicalCurrent: boolean;
}): boolean {
  const filled = (v: string | number | null) =>
    v != null && (typeof v !== "string" || v.trim().length > 0);
  return (
    filled(a.truckYear) &&
    filled(a.truckMake) &&
    filled(a.truckModel) &&
    filled(a.trailerYear) &&
    filled(a.trailerMake) &&
    filled(a.trailerModel) &&
    a.truckPhotos >= 1 &&
    a.trailerPhotos >= 1 &&
    a.cdlCurrent &&
    a.medicalCurrent
  );
}

// ---- Set-up-right: maintenance discipline (the safety net's core) ---------------------

export interface MaintEntryLike {
  id: number;
  category: string;
  performedMs: number;
  odometer: number | null;
  cost: number;
  nextDueMiles: number | null;
  nextDueAtMs: number | null;
  hasReceipt: boolean;
  /** logged | draft | closed — drafts (unconfirmed DVIR write-ups)
   *  are not services yet and never enter the evaluation. */
  status: string;
}

export interface MaintServiceLike {
  item: string; // oil | tires | brakes | dot_inspection
  intervalMiles: number;
  lastDoneOdometer: number | null;
  lastDoneAtMs: number | null;
}

export interface MaintEvaluation {
  awards: { entryId: number; award: Layer2Award }[];
  /** Entries that are extra copies of a near-identical record
   *  (same category + day + odometer + cost) — they earn zero. */
  duplicateEntryIds: number[];
  /** Total extra copies across all duplicate groups. */
  duplicateCopies: number;
  /** Entries whose odometer contradicts the sealed record (past
   *  every odometer the sealed record ever reached, or backwards
   *  against the driver's own earlier entries). */
  odometerContradictionIds: number[];
  /** Due-cycle services that earned nothing, and why. */
  dueButUnpaid: { entryId: number; why: "no_receipt" | "odometer" }[];
}

/** The near-duplicate signature: same category, same driver-local
 *  day, same odometer, same cost. Two entries sharing it are one
 *  record for rewards, however many times they're entered. */
export function maintenanceSignature(e: MaintEntryLike): string {
  return `${e.category}|${layer2DayKey(e.performedMs)}|${e.odometer ?? "null"}|${e.cost}`;
}

function addMonthsMs(ms: number, months: number): number {
  const p = layer2DayParts(ms);
  const total = p.year * 12 + (p.month - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const d = Math.min(p.day, [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!);
  return ymdDayStartMs(y, m, d) + (ms - layer2DayStartMs(ms));
}

/**
 * The maintenance-discipline decision over a driver's whole log.
 *
 * Per countdown category (oil / tires / brakes / dot_inspection —
 * the categories the maintenance schedule tracks), a due chain runs
 * from the schedule row (last done + interval; the DOT annual also
 * runs date-based on the 12-month rule) through each entry's own
 * nextDue values. An entry is the cycle's service when it reaches
 * the due point (within the early tolerances). The first CREDIBLE
 * due entry (its odometer agrees with the sealed record) closes
 * the cycle — whether or not it earns — so a second service in
 * the same cycle can never earn, and a no-receipt service can't
 * be re-logged with a receipt for a second bite (attaching the
 * receipt to the SAME entry later still pays it). An entry whose
 * odometer is missing or contradicts the sealed record is not a
 * credible service: it earns nothing and does not move the
 * schedule at all. The cycle's entry
 * EARNS only when it has a receipt attached AND its odometer agrees
 * with the sealed record (not past the highest odometer the sealed
 * record ever reached, not backwards against earlier TRUSTED
 * entries, and present at all — an unverifiable odometer earns
 * nothing; entries that contradict the sealed record don't raise
 * the trusted line, so a fake high reading can't poison a later
 * honest entry). The award's refKey names the CYCLE (category +
 * due point), never the entry — so one cycle can only ever pay
 * once, even if a backdated copy is inserted into its window
 * later. Categories the schedule doesn't track have no due state
 * and earn nothing. Awards are capped per calendar year as a
 * backstop.
 */
export function evaluateMaintenance(
  entries: readonly MaintEntryLike[],
  services: readonly MaintServiceLike[],
  sealedOdometerMax: number | null,
): MaintEvaluation {
  const usable = entries
    .filter((e) => e.status !== "draft")
    .sort((a, b) => a.performedMs - b.performedMs || a.id - b.id);

  // Near-duplicates: first entry of a signature group is the record;
  // every later copy earns zero and counts toward the hold pattern.
  const seenSignatures = new Set<string>();
  const duplicateEntryIds: number[] = [];
  const canonical: MaintEntryLike[] = [];
  for (const e of usable) {
    const sig = maintenanceSignature(e);
    if (seenSignatures.has(sig)) {
      duplicateEntryIds.push(e.id);
    } else {
      seenSignatures.add(sig);
      canonical.push(e);
    }
  }

  interface Chain {
    intervalMiles: number;
    nextDueOdo: number | null;
    nextDueAt: number | null;
  }
  const chains = new Map<string, Chain>();
  for (const s of services) {
    chains.set(s.item, {
      intervalMiles: s.intervalMiles,
      nextDueOdo:
        s.lastDoneOdometer != null && s.intervalMiles > 0
          ? s.lastDoneOdometer + s.intervalMiles
          : null,
      nextDueAt:
        s.item === "dot_inspection" && s.lastDoneAtMs != null
          ? addMonthsMs(s.lastDoneAtMs, 12)
          : null,
    });
  }

  const awards: { entryId: number; award: Layer2Award }[] = [];
  const odometerContradictionIds: number[] = [];
  const dueButUnpaid: { entryId: number; why: "no_receipt" | "odometer" }[] = [];
  const awardsByYear = new Map<number, number>();
  // The trusted odometer line: the highest reading among entries
  // that agree with the sealed record. Entries past the sealed
  // record are liars for this purpose — they never raise the line.
  let trustedMaxOdo: number | null = null;

  for (const e of canonical) {
    // Odometer agreement with the sealed record, judged for EVERY
    // entry (the hold pattern reads the whole log): past every
    // odometer the sealed record ever reached, or backwards against
    // the driver's own earlier trusted entries, is a contradiction.
    const contradictsSealed =
      e.odometer != null &&
      sealedOdometerMax != null &&
      e.odometer > sealedOdometerMax + LAYER2_MAINTENANCE_ODOMETER_TOLERANCE_MI;
    const contradictsBackward =
      e.odometer != null &&
      trustedMaxOdo != null &&
      e.odometer < trustedMaxOdo - LAYER2_MAINTENANCE_ODOMETER_TOLERANCE_MI;
    const contradicts = contradictsSealed || contradictsBackward;
    if (contradicts) odometerContradictionIds.push(e.id);
    if (e.odometer != null && !contradictsSealed) {
      trustedMaxOdo = trustedMaxOdo == null ? e.odometer : Math.max(trustedMaxOdo, e.odometer);
    }

    const chain = chains.get(e.category);
    if (chain) {
      const dueByOdo =
        chain.nextDueOdo != null &&
        e.odometer != null &&
        e.odometer >= chain.nextDueOdo - LAYER2_MAINTENANCE_DUE_EARLY_TOLERANCE_MI;
      const dueByDate =
        chain.nextDueAt != null &&
        e.performedMs >= chain.nextDueAt - LAYER2_MAINTENANCE_DUE_EARLY_TOLERANCE_DAYS * DAY_MS;
      if (dueByOdo || dueByDate) {
        // The cycle this entry closes — the award is keyed by it,
        // so the cycle can only ever pay once.
        const cycleKey =
          chain.nextDueOdo != null
            ? `m${Math.round(chain.nextDueOdo)}`
            : chain.nextDueAt != null
              ? `d${chain.nextDueAt}`
              : "open";
        const odoBad = e.odometer == null || contradicts;
        if (odoBad) {
          dueButUnpaid.push({ entryId: e.id, why: "odometer" });
          // An entry whose odometer is missing or contradicts the
          // sealed record is not a credible service at all — it
          // does NOT close the cycle or move the schedule (the
          // chain advance below is skipped). The cycle stays open
          // for a credible entry.
        } else if (!e.hasReceipt) {
          dueButUnpaid.push({ entryId: e.id, why: "no_receipt" });
        } else {
          const year = layer2DayParts(e.performedMs).year;
          const used = awardsByYear.get(year) ?? 0;
          if (used < LAYER2_MAINTENANCE_ANNUAL_AWARD_CAP) {
            awardsByYear.set(year, used + 1);
            awards.push({
              entryId: e.id,
              award: {
                refKey: `layer2-maint-${e.category}-${cycleKey}`,
                source: LAYER2_MAINTENANCE_SOURCE,
                points: LAYER2_MAINTENANCE_POINTS,
                reason: `Maintenance discipline — ${e.category.replace(/_/g, " ")} logged when it was due, receipt on file: +${LAYER2_MAINTENANCE_POINTS} SM Points`,
              },
            });
          }
        }
        // A credible due entry (odometer agrees with the sealed
        // record) closes the cycle whether or not it earned; the
        // chain advances from the entry's own next-due values (the
        // spec's "entry's own nextDue chain"), falling back to the
        // schedule's interval.
        if (!odoBad) {
          chain.nextDueOdo =
            e.nextDueMiles ??
            (chain.intervalMiles > 0 && e.odometer != null
              ? e.odometer + chain.intervalMiles
              : chain.nextDueOdo);
          chain.nextDueAt =
            e.nextDueAtMs ??
            (e.category === "dot_inspection" ? addMonthsMs(e.performedMs, 12) : null);
        }
      }
    }
  }

  return {
    awards,
    duplicateEntryIds,
    duplicateCopies: duplicateEntryIds.length,
    odometerContradictionIds,
    dueButUnpaid,
  };
}
