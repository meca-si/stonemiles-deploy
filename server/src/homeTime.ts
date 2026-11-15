/**
 * HOME-TIME GUARANTEE + RETENTION — pure rules module
 * (Research Wave 2 item 9, approved by x 2026-11-15).
 *
 * Home time is the top quit reason in trucking, and a driver
 * replacement costs a fleet five figures — so a home-time
 * commitment is treated here the way the DQF treats a
 * qualification: a recorded term, checked at the moment a load
 * would break it, with every knowing break on the record.
 *
 * THE GUARDRAILS (written here, enforced here and in actions.ts,
 * pinned by homeTime.test.ts + homeTimeFlow.test.ts):
 * (a) A commitment is a term the DRIVER stated, or their fleet
 *     stated for them — never a term the app invents. Kinds:
 *     by_date (home by one instant), every_n_days (a cadence
 *     anchored on a known home deadline), weekends (home by
 *     Saturday 00:00 UTC).
 * (b) Enforcement WARNS, it does not silently pass and does not
 *     hard-block: a load whose delivery appointment + the drive
 *     home lands past a deadline stops BEFORE binding until a
 *     named person overrides with a stated reason. The override
 *     is chain-sealed with the math that was shown. Authority
 *     follows who stated the term: a driver-stated commitment is
 *     overridden only by the driver; a fleet-stated one by the
 *     desk or the driver (the driver is notified either way when
 *     someone else overrides).
 * (c) Outcomes are DERIVED, never stored as claims: kept = a
 *     sealed off-duty/sleeper spell at the driver's home location
 *     covers the deadline; overridden = a sealed override names
 *     the deadline; missed = sealed records prove the driver was
 *     still out (a driving/on-duty event or a delivery seal)
 *     after it; anything else reads "no home record" — the app
 *     never guesses a driver home or away.
 * (d) Pulse answers are the DRIVER's record. The fleet sees
 *     aggregates only when 3+ drivers answered in the window;
 *     below that it sees counts only (a small fleet makes any
 *     average an attribution). Notes never surface to the fleet
 *     at any count.
 * (e) Retention "signals" are objective sealed facts — missed
 *     commitments, a falling sealed-miles trend, repeated
 *     detention overruns — worded as facts worth a check-in,
 *     never as a verdict on a person, and never a composite
 *     score.
 * (f) Sourcing follows the app's profile-scope rule: duty
 *     events, delivery seals, commitments, and overrides are
 *     chain/company records, computed live and identically in
 *     the driver's view and the fleet's. Detention waits and
 *     trip miles live in profile-scoped tables only the
 *     driver's own session can read, so the driver's session
 *     snapshots those two counts (home_time_fact_snapshots,
 *     stamped with when they were computed) and the fleet board
 *     reads the snapshot with its date showing — never the
 *     desk's own records dressed as the driver's.
 *
 * Pure functions only.
 */

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

/** The planning allowance for the drive home, added to the
 * delivery appointment before comparing against a deadline.
 * Two constants, printed wherever the math is shown: 6 hours
 * when the delivery is in the driver's home state, 24 hours
 * from anywhere else (or when a state is unknown — the
 * conservative side). An allowance, not a measurement. */
export const RETURN_ALLOWANCE_SAME_STATE_MS = 6 * HOUR_MS;
export const RETURN_ALLOWANCE_OUT_OF_STATE_MS = 24 * HOUR_MS;

/** A deadline this far in the past still counts as "the
 * commitment on the table" for a new binding — a driver who is
 * already hours late getting home should see the warning on
 * the next load too, not just the one that made them late. */
export const DEADLINE_LOOKBACK_MS = 12 * HOUR_MS;

/** After a deadline, how long the report keeps looking for
 * proof the driver was still out (capped at the next deadline)
 * before the outcome settles as "no home record". */
export const OUTCOME_EVIDENCE_WINDOW_MS = 72 * HOUR_MS;

// ---------------------------------------------------------------------------
// The commitment model — one row per stated term in
// home_time_commitments. Instants ride as ISO strings in this
// module (the DB half converts its timestamp_ms Dates).
// ---------------------------------------------------------------------------

export const HOME_TIME_KINDS = ["by_date", "every_n_days", "weekends"] as const;
export type HomeTimeKind = (typeof HOME_TIME_KINDS)[number];

export const HOME_TIME_KIND_LABELS: Record<HomeTimeKind, string> = {
  by_date: "Home by a date",
  every_n_days: "Home every N days",
  weekends: "Home every weekend",
};

export interface HomeTimeCommitmentLike {
  id: number;
  kind: string;
  /** by_date: the home-by instant (ISO). */
  homeByAt: string | null;
  /** every_n_days: the cadence in days. */
  everyNDays: number | null;
  /** every_n_days: one known deadline instant (ISO) the series anchors on. */
  anchorAt: string | null;
  /** driver | fleet — who stated the term. */
  setBy: string;
  createdBy: string;
  note: string | null;
  effectiveFrom: string; // ISO
  effectiveTo: string | null; // ISO
  voidedAt: string | null; // ISO
}

const ms = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** Was this commitment live at an instant? (Stated by then, not
 * yet ended, not yet voided.) The as-of rule every reader uses,
 * so history never rewrites itself. */
export function commitmentLiveAt(c: HomeTimeCommitmentLike, atMs: number): boolean {
  const from = ms(c.effectiveFrom);
  if (from == null || atMs < from) return false;
  const to = ms(c.effectiveTo);
  if (to != null && atMs > to) return false;
  const voided = ms(c.voidedAt);
  if (voided != null && atMs >= voided) return false;
  return true;
}

/** Every deadline instant one commitment produces inside
 * [fromMs, toMs), keeping only deadlines the commitment was
 * live at. Sorted ascending. */
export function commitmentDeadlines(c: HomeTimeCommitmentLike, fromMs: number, toMs: number): number[] {
  const out: number[] = [];
  const push = (t: number) => {
    if (t >= fromMs && t < toMs && commitmentLiveAt(c, t)) out.push(t);
  };
  if (c.kind === "by_date") {
    const t = ms(c.homeByAt);
    if (t != null) push(t);
  } else if (c.kind === "every_n_days") {
    const anchor = ms(c.anchorAt);
    const n = c.everyNDays;
    if (anchor != null && n != null && Number.isFinite(n) && n >= 1) {
      const step = Math.floor(n) * DAY_MS;
      // Walk the series both ways from the anchor.
      const kMin = Math.ceil((fromMs - anchor) / step);
      const kMax = Math.floor((toMs - 1 - anchor) / step);
      for (let k = kMin; k <= kMax; k++) push(anchor + k * step);
    }
  } else if (c.kind === "weekends") {
    // Home by Saturday 00:00 UTC. Find the first Saturday
    // midnight at or after fromMs, then step weekly.
    const d = new Date(fromMs);
    d.setUTCHours(0, 0, 0, 0);
    let t = d.getTime();
    while (new Date(t).getUTCDay() !== 6) t += DAY_MS;
    if (t < fromMs) t += 7 * DAY_MS;
    for (; t < toMs; t += 7 * DAY_MS) push(t);
  }
  return out.sort((a, b) => a - b);
}

/** All deadlines from a set of commitments inside a window,
 * tagged with the commitment that produced them. */
export function allDeadlines(
  commitments: readonly HomeTimeCommitmentLike[],
  fromMs: number,
  toMs: number,
): { commitmentId: number; deadlineAt: number }[] {
  const out: { commitmentId: number; deadlineAt: number }[] = [];
  for (const c of commitments) {
    for (const t of commitmentDeadlines(c, fromMs, toMs)) out.push({ commitmentId: c.id, deadlineAt: t });
  }
  return out.sort((a, b) => a.deadlineAt - b.deadlineAt);
}

/** The next deadline on the table at `nowMs` — searching from a
 * short lookback (a just-passed deadline the driver is already
 * late on still counts) out a full year. */
export function nextHomeDeadline(
  commitments: readonly HomeTimeCommitmentLike[],
  nowMs: number,
): { commitmentId: number; deadlineAt: number } | null {
  const all = allDeadlines(commitments, nowMs - DEADLINE_LOOKBACK_MS, nowMs + 366 * DAY_MS);
  return all[0] ?? null;
}

/** A plain-words description of one commitment's term. */
export function describeCommitment(c: HomeTimeCommitmentLike): string {
  if (c.kind === "by_date") {
    const t = ms(c.homeByAt);
    return t != null ? `Home by ${new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" })} UTC` : "Home by a date";
  }
  if (c.kind === "every_n_days") {
    return c.everyNDays != null ? `Home every ${c.everyNDays} days` : "Home on a repeating cadence";
  }
  if (c.kind === "weekends") return "Home every weekend (by Saturday)";
  return "Home-time commitment";
}

// ---------------------------------------------------------------------------
// The planning check — delivery appointment + the drive home vs
// the deadlines on the table.
// ---------------------------------------------------------------------------

export interface HomeTimeConflict {
  commitmentId: number;
  /** Who stated the term the load would break: driver | fleet. */
  setBy: string;
  deadlineAt: number;
  deliveryAt: number;
  /** Delivery + the return allowance — the earliest the driver
   * could be home if they took this load. */
  homeEtaAt: number;
  allowanceHours: number;
  sameState: boolean;
}

const normState = (s: string | null | undefined): string | null => {
  const t = (s ?? "").trim().toUpperCase();
  return t === "" ? null : t;
};

/** Would binding this load break a home-time commitment?
 * Stands on the load's delivery appointment alone: with no
 * appointment there is no delivery date to check, and the
 * answer is no provable conflict (null) — never a guess.
 * Returns the EARLIEST deadline the load would break. */
export function checkHomeTimeConflict(args: {
  commitments: readonly HomeTimeCommitmentLike[];
  deliveryApptAtMs: number | null;
  deliveryState: string | null;
  homeState: string | null;
  nowMs: number;
}): HomeTimeConflict | null {
  if (args.deliveryApptAtMs == null || !Number.isFinite(args.deliveryApptAtMs)) return null;
  const dState = normState(args.deliveryState);
  const hState = normState(args.homeState);
  const sameState = dState != null && hState != null && dState === hState;
  const allowance = sameState ? RETURN_ALLOWANCE_SAME_STATE_MS : RETURN_ALLOWANCE_OUT_OF_STATE_MS;
  const homeEtaAt = args.deliveryApptAtMs + allowance;
  const deadlines = allDeadlines(args.commitments, args.nowMs - DEADLINE_LOOKBACK_MS, homeEtaAt + 1);
  for (const d of deadlines) {
    if (homeEtaAt > d.deadlineAt) {
      const c = args.commitments.find((x) => x.id === d.commitmentId);
      return {
        commitmentId: d.commitmentId,
        setBy: c?.setBy ?? "driver",
        deadlineAt: d.deadlineAt,
        deliveryAt: args.deliveryApptAtMs,
        homeEtaAt,
        allowanceHours: allowance / HOUR_MS,
        sameState,
      };
    }
  }
  return null;
}

const fmtWhen = (t: number): string =>
  new Date(t).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });

/** The warning copy the binding funnel shows BEFORE anything is
 * bound — the plain math, nothing else. */
export function homeTimeConflictWarning(conflict: HomeTimeConflict, lane: string | null): { summary: string; detail: string } {
  const summary = `This load breaks a home-time commitment — it delivers ${fmtWhen(conflict.deliveryAt)} UTC, and with the drive home (${conflict.allowanceHours}h allowed${conflict.sameState ? ", same state" : ""}) the driver is home ${fmtWhen(conflict.homeEtaAt)} UTC at the earliest, past the ${fmtWhen(conflict.deadlineAt)} UTC home-by deadline.`;
  const detail = `${lane ? `${lane}: ` : ""}${summary} Binding it anyway takes an override with a reason, sealed on the record.`;
  return { summary, detail };
}

/** Who may override a conflict: a driver-stated term — only the
 * driver. A fleet-stated term — the driver, or the desk acting
 * for the fleet (owner/dispatch). */
export function canOverrideHomeTime(args: { setBy: string; actor: string; driverUsername: string; actorIsDesk: boolean }): boolean {
  if (args.actor === args.driverUsername) return true;
  if (args.setBy === "fleet" && args.actorIsDesk) return true;
  return false;
}

/** Notification copy when someone overrides (in-app only). */
export function homeTimeOverrideNotification(args: {
  driverUsername: string;
  overriddenBy: string;
  selfOverride: boolean;
  conflict: HomeTimeConflict;
}): { title: string; body: string } {
  if (args.selfOverride) {
    return {
      title: "Home-time commitment overridden",
      body: `@${args.driverUsername} overrode their own home-time commitment (home by ${fmtWhen(args.conflict.deadlineAt)} UTC) for a load delivering ${fmtWhen(args.conflict.deliveryAt)} UTC. The reason is on the sealed record.`,
    };
  }
  return {
    title: "Your home-time commitment was overridden",
    body: `@${args.overriddenBy} bound a load that breaks your home-by deadline of ${fmtWhen(args.conflict.deadlineAt)} UTC — it delivers ${fmtWhen(args.conflict.deliveryAt)} UTC. The reason they gave is on the sealed record.`,
  };
}

// ---------------------------------------------------------------------------
// Hit-rate outcomes — derived per deadline from the sealed
// record (guardrail c).
// ---------------------------------------------------------------------------

export interface DutyEventLike {
  state: string; // off_duty | sleeper | on_duty | driving
  atMs: number;
  location: string | null;
}

export type HomeOutcomeKind = "kept" | "missed" | "overridden" | "no_home_record";

export interface HomeOutcome {
  commitmentId: number;
  deadlineAt: number;
  outcome: HomeOutcomeKind;
  detail: string;
}

const normText = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Does a duty location read as the driver's home? Matches the
 * recorded home city (and state, when both are on file) inside
 * the free-text duty location ("Mobile, AL"). With no home
 * place on file, nothing matches — no home evidence can exist,
 * and outcomes say so instead of guessing. */
export function locationReadsHome(location: string | null, homeCity: string | null, homeState: string | null): boolean {
  const loc = normText(location);
  if (loc === "") return false;
  const city = normText(homeCity);
  const state = normText(homeState);
  // City matches as a phrase inside the free text. State matches
  // as a whole TOKEN when it is a code ("al" must not match
  // inside "dallas" or "alabama"); a spelled-out state name
  // matches as a phrase.
  const tokens = loc.split(/[^a-z0-9]+/).filter((t) => t !== "");
  const stateOk = state === "" || (state.length <= 2 ? tokens.includes(state) : loc.includes(state));
  const cityOk = city === "" || loc.includes(city);
  if (city !== "" && state !== "") return cityOk && stateOk;
  if (city !== "") return cityOk;
  if (state !== "") return stateOk;
  return false;
}

/** Derive the outcome of every deadline in a set. Inputs are
 * the driver's sealed facts only: their duty events (sorted),
 * their delivery-seal instants, and the deadline instants an
 * override names. Precedence: overridden > kept > missed >
 * no_home_record. */
export function evaluateHomeOutcomes(args: {
  deadlines: { commitmentId: number; deadlineAt: number }[];
  dutyEvents: readonly DutyEventLike[];
  homeCity: string | null;
  homeState: string | null;
  overrideDeadlinesMs: readonly number[];
  deliverySealsMs: readonly number[];
}): HomeOutcome[] {
  const events = [...args.dutyEvents].sort((a, b) => a.atMs - b.atMs);
  const overrides = new Set(args.overrideDeadlinesMs);
  const sorted = [...args.deadlines].sort((a, b) => a.deadlineAt - b.deadlineAt);
  return sorted.map((d, i) => {
    const nextDeadline = i + 1 < sorted.length ? sorted[i + 1]!.deadlineAt : Number.POSITIVE_INFINITY;
    if (overrides.has(d.deadlineAt)) {
      return {
        commitmentId: d.commitmentId,
        deadlineAt: d.deadlineAt,
        outcome: "overridden" as const,
        detail: "A load was bound over this deadline with a sealed override.",
      };
    }
    // Kept: an off-duty / sleeper spell AT HOME covers the
    // deadline instant (spell = from its duty event until the
    // driver's next duty event, or open-ended).
    for (let j = 0; j < events.length; j++) {
      const ev = events[j]!;
      if (ev.state !== "off_duty" && ev.state !== "sleeper") continue;
      if (!locationReadsHome(ev.location, args.homeCity, args.homeState)) continue;
      const spellEnd = j + 1 < events.length ? events[j + 1]!.atMs : Number.POSITIVE_INFINITY;
      if (ev.atMs <= d.deadlineAt && d.deadlineAt < spellEnd) {
        return {
          commitmentId: d.commitmentId,
          deadlineAt: d.deadlineAt,
          outcome: "kept" as const,
          detail: "Sealed record shows the driver off duty at home over the deadline.",
        };
      }
    }
    // Missed: sealed proof the driver was still out after the
    // deadline — a driving / on-duty event, or a delivery seal,
    // inside the evidence window.
    const windowEnd = Math.min(d.deadlineAt + OUTCOME_EVIDENCE_WINDOW_MS, nextDeadline);
    const awayDuty = events.some(
      (ev) => (ev.state === "driving" || ev.state === "on_duty") && ev.atMs > d.deadlineAt && ev.atMs < windowEnd,
    );
    const awaySeal = args.deliverySealsMs.some((t) => t > d.deadlineAt && t < windowEnd);
    if (awayDuty || awaySeal) {
      return {
        commitmentId: d.commitmentId,
        deadlineAt: d.deadlineAt,
        outcome: "missed" as const,
        detail: "Sealed record shows the driver still out after the deadline, with no home spell over it.",
      };
    }
    return {
      commitmentId: d.commitmentId,
      deadlineAt: d.deadlineAt,
      outcome: "no_home_record" as const,
      detail: "No sealed home record covers this deadline — the app can't prove the driver home or away.",
    };
  });
}

export interface HomeHitRate {
  kept: number;
  missed: number;
  overridden: number;
  noHomeRecord: number;
  /** Deadlines with a provable outcome (kept + missed + overridden). */
  decided: number;
  total: number;
}

export function summarizeHomeOutcomes(outcomes: readonly HomeOutcome[]): HomeHitRate {
  const r: HomeHitRate = { kept: 0, missed: 0, overridden: 0, noHomeRecord: 0, decided: 0, total: outcomes.length };
  for (const o of outcomes) {
    if (o.outcome === "kept") r.kept++;
    else if (o.outcome === "missed") r.missed++;
    else if (o.outcome === "overridden") r.overridden++;
    else r.noHomeRecord++;
  }
  r.decided = r.kept + r.missed + r.overridden;
  return r;
}

// ---------------------------------------------------------------------------
// Retention signals — objective sealed facts, worded as facts
// (guardrail e). The fleet surface frames them as "worth a
// check-in"; the driver's own surface shows the same facts
// without that framing. No composite score, ever.
// ---------------------------------------------------------------------------

export const CHURN_MISSED_MIN = 2;
export const CHURN_DETENTION_MIN = 3;
export const CHURN_MILES_PRIOR_MIN = 500;
export const CHURN_MILES_DROP_RATIO = 0.5;

export interface RetentionFacts {
  missed90: number;
  detentionOverruns90: number;
  milesRecent30: number;
  milesPrior30: number;
}

export interface RetentionSignal {
  key: "missed_home_time" | "detention_overruns" | "miles_down";
  detail: string;
}

export function retentionSignals(f: RetentionFacts): RetentionSignal[] {
  const out: RetentionSignal[] = [];
  if (f.missed90 >= CHURN_MISSED_MIN) {
    out.push({
      key: "missed_home_time",
      detail: `${f.missed90} home-time commitments missed in the last 90 days — sealed records show the driver still out past the deadline, with no override on file.`,
    });
  }
  if (f.detentionOverruns90 >= CHURN_DETENTION_MIN) {
    out.push({
      key: "detention_overruns",
      detail: `${f.detentionOverruns90} detention waits ran past the free time in the last 90 days.`,
    });
  }
  if (f.milesPrior30 >= CHURN_MILES_PRIOR_MIN && f.milesRecent30 < f.milesPrior30 * CHURN_MILES_DROP_RATIO) {
    out.push({
      key: "miles_down",
      detail: `Sealed trip miles fell from ${Math.round(f.milesPrior30).toLocaleString("en-US")} in the prior 30 days to ${Math.round(f.milesRecent30).toLocaleString("en-US")} in the last 30 days.`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pulse surveys — fixed questions, 14-day episodes, and the
// aggregation privacy rule (guardrail d).
// ---------------------------------------------------------------------------

export const PULSE_EPISODE_MS = 14 * DAY_MS;
export const PULSE_MIN_RESPONDENTS = 3;

export const PULSE_QUESTIONS = [
  { key: "home_time", label: "How is home time holding up lately?", low: "Rough", high: "Great" },
  { key: "workload", label: "How is the workload feeling?", low: "Too much", high: "About right" },
  { key: "staying", label: "How likely are you to still be driving here in six months?", low: "Not likely", high: "Very likely" },
] as const;

export type PulseQuestionKey = (typeof PULSE_QUESTIONS)[number]["key"];

export function pulseEpisodeKey(nowMs: number): string {
  return `pulse-${Math.floor(nowMs / PULSE_EPISODE_MS)}`;
}

export function pulseEpisodeStartMs(episodeKey: string): number | null {
  const m = /^pulse-(\d+)$/.exec(episodeKey);
  if (!m) return null;
  return Number(m[1]) * PULSE_EPISODE_MS;
}

/** The instant the NEXT episode opens (when a driver who has
 * answered / dismissed this episode can be prompted again). */
export function nextPulseAt(nowMs: number): number {
  return (Math.floor(nowMs / PULSE_EPISODE_MS) + 1) * PULSE_EPISODE_MS;
}

/** Validate a submitted answer set: every fixed question, an
 * integer 1–5. Anything else is refused whole — a partial or
 * out-of-range set is never stored. */
export function validatePulseAnswers(raw: unknown): Record<PulseQuestionKey, number> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const out = {} as Record<PulseQuestionKey, number>;
  for (const q of PULSE_QUESTIONS) {
    const v = rec[q.key];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 5) return null;
    out[q.key] = v;
  }
  return out;
}

export interface PulseAggregate {
  /** Distinct drivers who ANSWERED in the window. */
  respondentCount: number;
  /** Drivers in the fleet (the denominator the count stands against). */
  driverCount: number;
  /** Per-question averages — present ONLY at 3+ respondents
   * (guardrail d). Below that: counts only, averages null. */
  averages: Record<PulseQuestionKey, number> | null;
}

/** Aggregate a window of answered rows. Rows are answer sets
 * only — notes never enter this function, so they can never
 * surface to the fleet. One driver answering twice in the
 * window counts once (their latest set). */
export function aggregatePulse(
  rows: readonly { driverUsername: string; answers: Record<string, number> }[],
  driverCount: number,
): PulseAggregate {
  const latest = new Map<string, Record<string, number>>();
  for (const r of rows) latest.set(r.driverUsername, r.answers);
  const respondentCount = latest.size;
  if (respondentCount < PULSE_MIN_RESPONDENTS) {
    return { respondentCount, driverCount, averages: null };
  }
  const sums = {} as Record<PulseQuestionKey, number>;
  for (const q of PULSE_QUESTIONS) sums[q.key] = 0;
  for (const answers of latest.values()) {
    for (const q of PULSE_QUESTIONS) {
      const v = answers[q.key];
      if (typeof v === "number" && Number.isFinite(v)) sums[q.key] += v;
    }
  }
  const averages = {} as Record<PulseQuestionKey, number>;
  for (const q of PULSE_QUESTIONS) averages[q.key] = Math.round((sums[q.key] / respondentCount) * 10) / 10;
  return { respondentCount, driverCount, averages };
}
