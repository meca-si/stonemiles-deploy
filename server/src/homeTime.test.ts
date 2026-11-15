/**
 * Home-time guarantee + retention — pure rules unit tests
 * (Wave 2 item 9). Pins the guardrails of homeTime.ts: the
 * deadline series (by_date / every_n_days / weekends), the
 * planning conflict math (delivery + return allowance vs the
 * deadline), override authority, outcome derivation from sealed
 * facts only (kept / missed / overridden / no_home_record —
 * never a guess), retention-signal thresholds, pulse answer
 * validation, and the aggregation privacy rule (averages only
 * at 3+ respondents).
 */
import { describe, expect, test } from "bun:test";
import {
  DAY_MS,
  aggregatePulse,
  canOverrideHomeTime,
  checkHomeTimeConflict,
  commitmentDeadlines,
  describeCommitment,
  evaluateHomeOutcomes,
  locationReadsHome,
  nextHomeDeadline,
  nextPulseAt,
  pulseEpisodeKey,
  pulseEpisodeStartMs,
  retentionSignals,
  summarizeHomeOutcomes,
  validatePulseAnswers,
  type HomeTimeCommitmentLike,
} from "./homeTime";

const T = (iso: string) => Date.parse(iso);
const iso = (t: number) => new Date(t).toISOString();

function commitment(patch: Partial<HomeTimeCommitmentLike>): HomeTimeCommitmentLike {
  return {
    id: 1,
    kind: "by_date",
    homeByAt: null,
    everyNDays: null,
    anchorAt: null,
    setBy: "driver",
    createdBy: "driver1",
    note: null,
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: null,
    voidedAt: null,
    ...patch,
  };
}

describe("commitment deadlines", () => {
  test("by_date produces its single deadline inside the window only", () => {
    const c = commitment({ homeByAt: "2026-11-20T18:00:00.000Z" });
    expect(commitmentDeadlines(c, T("2026-11-01T00:00:00Z"), T("2026-12-01T00:00:00Z"))).toEqual([T("2026-11-20T18:00:00.000Z")]);
    expect(commitmentDeadlines(c, T("2026-12-01T00:00:00Z"), T("2027-01-01T00:00:00Z"))).toEqual([]);
  });

  test("every_n_days walks the series both ways from the anchor", () => {
    const c = commitment({ kind: "every_n_days", everyNDays: 14, anchorAt: "2026-11-14T00:00:00.000Z" });
    const ds = commitmentDeadlines(c, T("2026-10-01T00:00:00Z"), T("2026-12-15T00:00:00Z")).map(iso);
    expect(ds).toEqual([
      "2026-10-03T00:00:00.000Z",
      "2026-10-17T00:00:00.000Z",
      "2026-10-31T00:00:00.000Z",
      "2026-11-14T00:00:00.000Z",
      "2026-11-28T00:00:00.000Z",
      "2026-12-12T00:00:00.000Z",
    ]);
  });

  test("weekends land on Saturday 00:00 UTC", () => {
    const c = commitment({ kind: "weekends" });
    const ds = commitmentDeadlines(c, T("2026-11-09T00:00:00Z"), T("2026-11-30T00:00:00Z")).map(iso);
    // Nov 14, 21, 28 2026 are Saturdays.
    expect(ds).toEqual(["2026-11-14T00:00:00.000Z", "2026-11-21T00:00:00.000Z", "2026-11-28T00:00:00.000Z"]);
  });

  test("a voided commitment produces no deadlines at or after the void", () => {
    const c = commitment({ kind: "weekends", voidedAt: "2026-11-20T00:00:00.000Z" });
    const ds = commitmentDeadlines(c, T("2026-11-09T00:00:00Z"), T("2026-11-30T00:00:00Z")).map(iso);
    expect(ds).toEqual(["2026-11-14T00:00:00.000Z"]);
  });

  test("an ended (effectiveTo) commitment stops producing deadlines", () => {
    const c = commitment({ kind: "weekends", effectiveTo: "2026-11-15T00:00:00.000Z" });
    const ds = commitmentDeadlines(c, T("2026-11-09T00:00:00Z"), T("2026-11-30T00:00:00Z")).map(iso);
    expect(ds).toEqual(["2026-11-14T00:00:00.000Z"]);
  });

  test("nextHomeDeadline picks the earliest across commitments", () => {
    const a = commitment({ id: 1, homeByAt: "2026-11-25T00:00:00.000Z" });
    const b = commitment({ id: 2, kind: "weekends" });
    const next = nextHomeDeadline([a, b], T("2026-11-16T12:00:00Z"));
    expect(next).toEqual({ commitmentId: 2, deadlineAt: T("2026-11-21T00:00:00.000Z") });
  });

  test("describeCommitment words each kind plainly", () => {
    expect(describeCommitment(commitment({ kind: "weekends" }))).toContain("weekend");
    expect(describeCommitment(commitment({ kind: "every_n_days", everyNDays: 21 }))).toContain("21 days");
    expect(describeCommitment(commitment({ homeByAt: "2026-11-20T18:00:00.000Z" }))).toContain("Home by");
  });
});

describe("planning conflict math", () => {
  const now = T("2026-11-16T12:00:00Z");
  const byDate = commitment({ homeByAt: "2026-11-20T18:00:00.000Z" });

  test("no delivery appointment → no provable conflict", () => {
    expect(checkHomeTimeConflict({ commitments: [byDate], deliveryApptAtMs: null, deliveryState: "TX", homeState: "AL", nowMs: now })).toBeNull();
  });

  test("delivery + out-of-state allowance past the deadline conflicts", () => {
    const c = checkHomeTimeConflict({
      commitments: [byDate],
      deliveryApptAtMs: T("2026-11-20T08:00:00Z"),
      deliveryState: "TX",
      homeState: "AL",
      nowMs: now,
    });
    expect(c).not.toBeNull();
    expect(c!.allowanceHours).toBe(24);
    expect(c!.homeEtaAt).toBe(T("2026-11-21T08:00:00Z"));
    expect(c!.deadlineAt).toBe(T("2026-11-20T18:00:00.000Z"));
  });

  test("same-state delivery uses the 6h allowance and can fit", () => {
    const c = checkHomeTimeConflict({
      commitments: [byDate],
      deliveryApptAtMs: T("2026-11-20T08:00:00Z"),
      deliveryState: "AL",
      homeState: "AL",
      nowMs: now,
    });
    expect(c).toBeNull(); // home by 14:00, deadline 18:00
  });

  test("same-state delivery that still misses conflicts with 6h", () => {
    const c = checkHomeTimeConflict({
      commitments: [byDate],
      deliveryApptAtMs: T("2026-11-20T14:00:00Z"),
      deliveryState: "al",
      homeState: "AL",
      nowMs: now,
    });
    expect(c).not.toBeNull();
    expect(c!.allowanceHours).toBe(6);
  });

  test("unknown home state falls back to the conservative 24h", () => {
    const c = checkHomeTimeConflict({
      commitments: [byDate],
      deliveryApptAtMs: T("2026-11-20T08:00:00Z"),
      deliveryState: "AL",
      homeState: null,
      nowMs: now,
    });
    expect(c).not.toBeNull();
    expect(c!.allowanceHours).toBe(24);
  });

  test("a comfortable load does not conflict", () => {
    expect(
      checkHomeTimeConflict({ commitments: [byDate], deliveryApptAtMs: T("2026-11-18T08:00:00Z"), deliveryState: "TX", homeState: "AL", nowMs: now }),
    ).toBeNull();
  });

  test("a just-passed deadline (within the lookback) still warns", () => {
    const late = commitment({ homeByAt: "2026-11-16T06:00:00.000Z" }); // 6h before now
    const c = checkHomeTimeConflict({
      commitments: [late],
      deliveryApptAtMs: T("2026-11-17T08:00:00Z"),
      deliveryState: "TX",
      homeState: "AL",
      nowMs: now,
    });
    expect(c).not.toBeNull();
    expect(c!.deadlineAt).toBe(T("2026-11-16T06:00:00.000Z"));
  });

  test("no commitments → no conflict", () => {
    expect(
      checkHomeTimeConflict({ commitments: [], deliveryApptAtMs: T("2026-11-20T08:00:00Z"), deliveryState: "TX", homeState: "AL", nowMs: now }),
    ).toBeNull();
  });
});

describe("override authority", () => {
  test("the driver can always override their own binding", () => {
    expect(canOverrideHomeTime({ setBy: "driver", actor: "d1", driverUsername: "d1", actorIsDesk: false })).toBe(true);
    expect(canOverrideHomeTime({ setBy: "fleet", actor: "d1", driverUsername: "d1", actorIsDesk: false })).toBe(true);
  });

  test("the desk can override a fleet-stated term, never a driver-stated one", () => {
    expect(canOverrideHomeTime({ setBy: "fleet", actor: "owner1", driverUsername: "d1", actorIsDesk: true })).toBe(true);
    expect(canOverrideHomeTime({ setBy: "driver", actor: "owner1", driverUsername: "d1", actorIsDesk: true })).toBe(false);
  });

  test("a fellow driver can never override someone else's term", () => {
    expect(canOverrideHomeTime({ setBy: "fleet", actor: "d2", driverUsername: "d1", actorIsDesk: false })).toBe(false);
  });
});

describe("outcome derivation — sealed facts only", () => {
  const D = T("2026-11-14T00:00:00Z"); // a Saturday deadline
  const base = {
    deadlines: [{ commitmentId: 1, deadlineAt: D }],
    homeCity: "Mobile",
    homeState: "AL",
    overrideDeadlinesMs: [] as number[],
    deliverySealsMs: [] as number[],
  };

  test("kept: an off-duty spell at home covers the deadline", () => {
    const out = evaluateHomeOutcomes({
      ...base,
      dutyEvents: [
        { state: "off_duty", atMs: D - DAY_MS, location: "Mobile, AL" },
        { state: "driving", atMs: D + 2 * DAY_MS, location: "Mobile, AL" },
      ],
    });
    expect(out[0]!.outcome).toBe("kept");
  });

  test("kept: a sleeper spell at home counts too", () => {
    const out = evaluateHomeOutcomes({
      ...base,
      dutyEvents: [{ state: "sleeper", atMs: D - 6 * 3_600_000, location: "mobile, al" }],
    });
    expect(out[0]!.outcome).toBe("kept");
  });

  test("an off-duty spell AWAY from home is not kept", () => {
    const out = evaluateHomeOutcomes({
      ...base,
      dutyEvents: [{ state: "off_duty", atMs: D - DAY_MS, location: "Dallas, TX" }],
    });
    expect(out[0]!.outcome).toBe("no_home_record");
  });

  test("missed: a driving event after the deadline proves still out", () => {
    const out = evaluateHomeOutcomes({
      ...base,
      dutyEvents: [
        { state: "off_duty", atMs: D - 3 * DAY_MS, location: "Dallas, TX" },
        { state: "driving", atMs: D + 5 * 3_600_000, location: "Dallas, TX" },
      ],
    });
    expect(out[0]!.outcome).toBe("missed");
  });

  test("missed: a delivery seal after the deadline proves still out", () => {
    const out = evaluateHomeOutcomes({ ...base, dutyEvents: [], deliverySealsMs: [D + 10 * 3_600_000] });
    expect(out[0]!.outcome).toBe("missed");
  });

  test("overridden beats every other reading", () => {
    const out = evaluateHomeOutcomes({
      ...base,
      overrideDeadlinesMs: [D],
      dutyEvents: [{ state: "off_duty", atMs: D - DAY_MS, location: "Mobile, AL" }],
    });
    expect(out[0]!.outcome).toBe("overridden");
  });

  test("no evidence at all → no_home_record, never a guess", () => {
    const out = evaluateHomeOutcomes({ ...base, dutyEvents: [] });
    expect(out[0]!.outcome).toBe("no_home_record");
    expect(out[0]!.detail).toContain("can't prove");
  });

  test("no home place on file → no home evidence can exist", () => {
    const out = evaluateHomeOutcomes({
      ...base,
      homeCity: null,
      homeState: null,
      dutyEvents: [{ state: "off_duty", atMs: D - DAY_MS, location: "Mobile, AL" }],
    });
    expect(out[0]!.outcome).toBe("no_home_record");
  });

  test("evidence after the NEXT deadline does not leak backwards", () => {
    const D2 = D + 7 * DAY_MS;
    const out = evaluateHomeOutcomes({
      ...base,
      deadlines: [
        { commitmentId: 1, deadlineAt: D },
        { commitmentId: 1, deadlineAt: D2 },
      ],
      dutyEvents: [{ state: "driving", atMs: D2 + 3_600_000, location: "Dallas, TX" }],
    });
    expect(out[0]!.outcome).toBe("no_home_record");
    expect(out[1]!.outcome).toBe("missed");
  });

  test("summarize counts decided vs unprovable", () => {
    const s = summarizeHomeOutcomes([
      { commitmentId: 1, deadlineAt: 1, outcome: "kept", detail: "" },
      { commitmentId: 1, deadlineAt: 2, outcome: "missed", detail: "" },
      { commitmentId: 1, deadlineAt: 3, outcome: "overridden", detail: "" },
      { commitmentId: 1, deadlineAt: 4, outcome: "no_home_record", detail: "" },
    ]);
    expect(s).toEqual({ kept: 1, missed: 1, overridden: 1, noHomeRecord: 1, decided: 3, total: 4 });
  });

  test("locationReadsHome matches city+state inside free text", () => {
    expect(locationReadsHome("Mobile, AL", "Mobile", "AL")).toBe(true);
    expect(locationReadsHome("Mobile, Alabama", "Mobile", "AL")).toBe(false); // state must read as recorded
    expect(locationReadsHome("Dallas, TX", "Mobile", "AL")).toBe(false);
    expect(locationReadsHome(null, "Mobile", "AL")).toBe(false);
    expect(locationReadsHome("Mobile, AL", null, null)).toBe(false);
  });
});

describe("retention signals — facts, thresholds, no scores", () => {
  test("below every threshold → no signals", () => {
    expect(retentionSignals({ missed90: 1, detentionOverruns90: 2, milesRecent30: 900, milesPrior30: 1000 })).toEqual([]);
  });

  test("two missed commitments signal", () => {
    const s = retentionSignals({ missed90: 2, detentionOverruns90: 0, milesRecent30: 0, milesPrior30: 0 });
    expect(s.map((x) => x.key)).toEqual(["missed_home_time"]);
    expect(s[0]!.detail).toContain("2 home-time commitments missed");
  });

  test("three detention overruns signal", () => {
    const s = retentionSignals({ missed90: 0, detentionOverruns90: 3, milesRecent30: 0, milesPrior30: 0 });
    expect(s.map((x) => x.key)).toEqual(["detention_overruns"]);
  });

  test("miles signal needs a real prior base and a >50% fall", () => {
    expect(retentionSignals({ missed90: 0, detentionOverruns90: 0, milesRecent30: 100, milesPrior30: 400 })).toEqual([]);
    const s = retentionSignals({ missed90: 0, detentionOverruns90: 0, milesRecent30: 400, milesPrior30: 1200 });
    expect(s.map((x) => x.key)).toEqual(["miles_down"]);
    expect(s[0]!.detail).toContain("1,200");
  });
});

describe("pulse — validation, episodes, aggregation privacy", () => {
  test("answers must cover every question with integers 1–5", () => {
    expect(validatePulseAnswers({ home_time: 4, workload: 3, staying: 5 })).toEqual({ home_time: 4, workload: 3, staying: 5 });
    expect(validatePulseAnswers({ home_time: 4, workload: 3 })).toBeNull();
    expect(validatePulseAnswers({ home_time: 0, workload: 3, staying: 5 })).toBeNull();
    expect(validatePulseAnswers({ home_time: 6, workload: 3, staying: 5 })).toBeNull();
    expect(validatePulseAnswers({ home_time: 2.5, workload: 3, staying: 5 })).toBeNull();
    expect(validatePulseAnswers("nope")).toBeNull();
  });

  test("episodes are 14-day buckets", () => {
    const t = T("2026-11-15T08:00:00Z");
    const start = pulseEpisodeStartMs(pulseEpisodeKey(t))!;
    expect(t - start).toBeGreaterThanOrEqual(0);
    expect(t - start).toBeLessThan(14 * DAY_MS);
    expect(pulseEpisodeKey(start + 13 * DAY_MS)).toBe(pulseEpisodeKey(t));
    const next = nextPulseAt(t);
    expect(next).toBe(start + 14 * DAY_MS);
    expect(pulseEpisodeKey(next)).not.toBe(pulseEpisodeKey(t));
  });

  test("below 3 respondents: counts only, averages null", () => {
    const agg = aggregatePulse(
      [
        { driverUsername: "a", answers: { home_time: 1, workload: 1, staying: 1 } },
        { driverUsername: "b", answers: { home_time: 5, workload: 5, staying: 5 } },
      ],
      4,
    );
    expect(agg.respondentCount).toBe(2);
    expect(agg.averages).toBeNull();
  });

  test("at 3 respondents: averages appear, rounded to a tenth", () => {
    const agg = aggregatePulse(
      [
        { driverUsername: "a", answers: { home_time: 2, workload: 3, staying: 4 } },
        { driverUsername: "b", answers: { home_time: 4, workload: 3, staying: 4 } },
        { driverUsername: "c", answers: { home_time: 4, workload: 5, staying: 5 } },
      ],
      5,
    );
    expect(agg.respondentCount).toBe(3);
    expect(agg.averages).toEqual({ home_time: 3.3, workload: 3.7, staying: 4.3 });
  });

  test("a driver answering twice in the window counts once (latest set)", () => {
    const agg = aggregatePulse(
      [
        { driverUsername: "a", answers: { home_time: 1, workload: 1, staying: 1 } },
        { driverUsername: "a", answers: { home_time: 5, workload: 5, staying: 5 } },
        { driverUsername: "b", answers: { home_time: 5, workload: 5, staying: 5 } },
        { driverUsername: "c", answers: { home_time: 5, workload: 5, staying: 5 } },
      ],
      3,
    );
    expect(agg.respondentCount).toBe(3);
    expect(agg.averages).toEqual({ home_time: 5, workload: 5, staying: 5 });
  });
});
