// pointsLayer2.test.ts — UNIT tests for Rewards Layer 2 + the
// safety net's pure decisions (pointsLayer2.ts): calendar awards
// (birthday with NO year, anniversary, appreciation/holiday weeks),
// the season-score math (perfect weeks, season-end prizes,
// comebacks, no-incident quarters), loyalty (renewal streaks,
// referral ladder), the rig record, and the maintenance-discipline
// safety net (due window only, one award per due cycle, receipt
// required, odometer cross-check, near-duplicates count once).

import { describe, expect, test } from "bun:test";
import {
  anniversaryAwardFor,
  appreciationWeek,
  birthdayAwardFor,
  calendarWeekAward,
  christmasWeek,
  comebackAwards,
  coveredMonthKeys,
  evaluateMaintenance,
  layer2DayKey,
  longestMonthRun,
  noIncidentQuarterAwards,
  perfectWeekAward,
  rankForScore,
  referralLadderAwards,
  renewalStreakAwards,
  rigRecordComplete,
  seasonRankPrize,
  thanksgivingWeek,
  validBirthMonthDay,
  windowOverallScore,
  type MaintEntryLike,
} from "./pointsLayer2";

/** Noon UTC on a date — safely inside the same Chicago day. */
const noon = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 12, 0, 0);

// ---- Birthday: month + day only ------------------------------------------------

describe("birthday (month/day only — a year is never stored)", () => {
  test("valid pairs validate; impossible days refuse", () => {
    expect(validBirthMonthDay(2, 29)).toBe(true);
    expect(validBirthMonthDay(2, 30)).toBe(false);
    expect(validBirthMonthDay(4, 31)).toBe(false);
    expect(validBirthMonthDay(13, 1)).toBe(false);
    expect(validBirthMonthDay(null, 5)).toBe(false);
    expect(validBirthMonthDay(6, null)).toBe(false);
  });

  test("pays on the day, and within the grace window after it", () => {
    const onDay = birthdayAwardFor({ month: 6, day: 15 }, noon(2026, 6, 15));
    expect(onDay?.points).toBe(100);
    expect(onDay?.refKey).toBe("layer2-birthday-2026");
    const inGrace = birthdayAwardFor({ month: 6, day: 10 }, noon(2026, 6, 15));
    expect(inGrace?.refKey).toBe("layer2-birthday-2026");
    const stale = birthdayAwardFor({ month: 5, day: 20 }, noon(2026, 6, 15));
    expect(stale).toBeNull();
    const unset = birthdayAwardFor(null, noon(2026, 6, 15));
    expect(unset).toBeNull();
  });

  test("a Feb 29 birthday celebrates on Feb 28 in common years", () => {
    expect(birthdayAwardFor({ month: 2, day: 29 }, noon(2026, 2, 28))?.refKey).toBe(
      "layer2-birthday-2026",
    );
    expect(birthdayAwardFor({ month: 2, day: 29 }, noon(2024, 2, 29))?.refKey).toBe(
      "layer2-birthday-2024",
    );
  });
});

// ---- Anniversary -----------------------------------------------------------------

describe("road anniversary", () => {
  test("pays at one full year, keyed by the year count", () => {
    const a = anniversaryAwardFor(noon(2025, 6, 15), noon(2026, 6, 15));
    expect(a?.points).toBe(150);
    expect(a?.refKey).toBe("layer2-anniversary-1");
    const a3 = anniversaryAwardFor(noon(2023, 6, 15), noon(2026, 6, 15));
    expect(a3?.refKey).toBe("layer2-anniversary-3");
  });

  test("no award before the first anniversary", () => {
    expect(anniversaryAwardFor(noon(2026, 1, 15), noon(2026, 6, 15))).toBeNull();
  });
});

// ---- Calendar weeks ----------------------------------------------------------------

describe("calendar weeks", () => {
  test("appreciation week is the Mon–Sun week containing Sep 15", () => {
    const w = appreciationWeek(2026); // Sep 15 2026 is a Tuesday
    expect(w.mondayKey).toBe("2026-09-14");
    expect(w.dayKeys.length).toBe(7);
    expect(w.dayKeys[6]).toBe("2026-09-20");
  });

  test("thanksgiving week contains the fourth Thursday of November", () => {
    const w = thanksgivingWeek(2026); // Thanksgiving 2026: Nov 26
    expect(w.dayKeys).toContain("2026-11-26");
    expect(w.mondayKey).toBe("2026-11-23");
  });

  test("christmas week contains Dec 25", () => {
    const w = christmasWeek(2026); // Dec 25 2026 is a Friday
    expect(w.dayKeys).toContain("2026-12-25");
    expect(w.mondayKey).toBe("2026-12-21");
  });

  test("a week award needs the week complete AND the driver active in it", () => {
    const w = appreciationWeek(2026);
    const base = {
      kind: "appreciation" as const,
      week: w,
      weekYear: 2026,
      activityDayKeys: new Set<string>(),
    };
    // Week not over yet.
    expect(
      calendarWeekAward({ ...base, activityMs: [w.startMs + 1000], nowMs: w.startMs + 1000 }),
    ).toBeNull();
    // Complete but nobody home.
    expect(calendarWeekAward({ ...base, activityMs: [], nowMs: w.endMs + 1 })).toBeNull();
    // Complete + a sealed trip inside the week.
    const a = calendarWeekAward({
      ...base,
      activityMs: [w.startMs + 3600000],
      nowMs: w.endMs + 1,
    });
    expect(a?.points).toBe(100);
    expect(a?.refKey).toBe("layer2-appreciation-2026");
    // Complete + an activity day stamped in the week.
    const b = calendarWeekAward({
      ...base,
      activityMs: [],
      activityDayKeys: new Set([w.dayKeys[3]!]),
      nowMs: w.endMs + 1,
    });
    expect(b?.refKey).toBe("layer2-appreciation-2026");
  });
});

// ---- Score math ----------------------------------------------------------------------

describe("score math (the season formulas)", () => {
  test("an empty window has no score", () => {
    expect(
      windowOverallScore({ trips: 0, seals: 0, onTimeCounted: 0, onTime: 0, overspeedFinal7d: 0, overspeedAny: 0 }),
    ).toBeNull();
  });

  test("reliability: 50 + 2/seal + trips + 10 on-time bonus, capped at 100", () => {
    // 16 on-time seals, nothing else: 50 + 32 + 10 = 92 (top band floor).
    expect(
      windowOverallScore({ trips: 0, seals: 16, onTimeCounted: 16, onTime: 16, overspeedFinal7d: 0, overspeedAny: 0 }),
    ).toBe(92);
    // Overspeed drags safety below reliability: 3 events → 91.
    expect(
      windowOverallScore({ trips: 0, seals: 16, onTimeCounted: 16, onTime: 16, overspeedFinal7d: 3, overspeedAny: 3 }),
    ).toBe(91);
    // A weak on-time rate loses the +10.
    expect(
      windowOverallScore({ trips: 0, seals: 16, onTimeCounted: 16, onTime: 8, overspeedFinal7d: 0, overspeedAny: 0 }),
    ).toBe(82);
  });

  test("rank bands match the season ranks", () => {
    expect(rankForScore(92)).toBe("Diamond");
    expect(rankForScore(80)).toBe("Platinum");
    expect(rankForScore(65)).toBe("Gold");
    expect(rankForScore(50)).toBe("Silver");
    expect(rankForScore(30)).toBe("Bronze");
    expect(rankForScore(29)).toBe("Rookie");
  });

  test("season-end prizes pay top finishers only", () => {
    expect(seasonRankPrize(3, 95)?.points).toBe(300);
    expect(seasonRankPrize(3, 85)?.points).toBe(150);
    expect(seasonRankPrize(3, 70)).toBeNull();
    expect(seasonRankPrize(3, null)).toBeNull();
  });

  test("perfect weeks need the top band", () => {
    expect(perfectWeekAward("2026-11-02", 92)?.points).toBe(150);
    expect(perfectWeekAward("2026-11-02", 91)).toBeNull();
    expect(perfectWeekAward("2026-11-02", null)).toBeNull();
  });

  test("comeback: a strong season after a low one pays once per recovery", () => {
    const awards = comebackAwards([
      { seasonNumber: 1, overall: 40 },
      { seasonNumber: 2, overall: 70 },
      { seasonNumber: 3, overall: 75 },
    ]);
    expect(awards.length).toBe(2);
    expect(awards[0]!.refKey).toBe("layer2-comeback-2");
    // Strong first, low later: no comeback.
    expect(
      comebackAwards([
        { seasonNumber: 1, overall: 80 },
        { seasonNumber: 2, overall: 40 },
      ]).length,
    ).toBe(0);
    // Empty seasons don't count as low.
    expect(
      comebackAwards([
        { seasonNumber: 1, overall: null },
        { seasonNumber: 2, overall: 70 },
      ]).length,
    ).toBe(0);
  });

  test("no-incident quarters close every third consecutive clean month", () => {
    const clean = (key: string) => ({ key, clean: true });
    const dirty = (key: string) => ({ key, clean: false });
    const a = noIncidentQuarterAwards([clean("2026-01"), clean("2026-02"), clean("2026-03")]);
    expect(a.length).toBe(1);
    expect(a[0]!.refKey).toBe("layer2-noincident-2026-03");
    const b = noIncidentQuarterAwards([
      clean("2026-01"), clean("2026-02"), dirty("2026-03"),
      clean("2026-04"), clean("2026-05"), clean("2026-06"),
    ]);
    expect(b.length).toBe(1);
    expect(b[0]!.refKey).toBe("layer2-noincident-2026-06");
    const c = noIncidentQuarterAwards([
      clean("2026-01"), clean("2026-02"), clean("2026-03"),
      clean("2026-04"), clean("2026-05"), clean("2026-06"),
    ]);
    expect(c.length).toBe(2);
  });
});

// ---- Loyalty ---------------------------------------------------------------------------

describe("loyalty", () => {
  test("covered months: monthly covers one, yearly covers twelve", () => {
    const keys = coveredMonthKeys([
      { createdMs: noon(2026, 1, 10), period: "monthly" },
      { createdMs: noon(2026, 2, 10), period: "monthly" },
      { createdMs: noon(2026, 3, 10), period: "monthly" },
    ]);
    expect(longestMonthRun(keys)).toBe(3);
    const yearly = coveredMonthKeys([{ createdMs: noon(2025, 8, 1), period: "yearly" }]);
    expect(yearly.size).toBe(12);
    expect(longestMonthRun(yearly)).toBe(12);
    // A gap breaks the run.
    const gapped = coveredMonthKeys([
      { createdMs: noon(2026, 1, 10), period: "monthly" },
      { createdMs: noon(2026, 3, 10), period: "monthly" },
    ]);
    expect(longestMonthRun(gapped)).toBe(1);
  });

  test("renewal streak awards at 6 / 12 / 24", () => {
    expect(renewalStreakAwards(5).length).toBe(0);
    expect(renewalStreakAwards(6).map((a) => a.points)).toEqual([250]);
    expect(renewalStreakAwards(24).map((a) => a.points)).toEqual([250, 500, 1200]);
  });

  test("referral ladder awards at 5 / 10 / 25 active", () => {
    expect(referralLadderAwards(4).length).toBe(0);
    expect(referralLadderAwards(10).map((a) => a.refKey)).toEqual([
      "layer2-refladder-5",
      "layer2-refladder-10",
    ]);
    expect(referralLadderAwards(25).length).toBe(3);
  });
});

// ---- Rig record --------------------------------------------------------------------------

describe("rig record", () => {
  const full = {
    truckYear: 2021, truckMake: "Kenworth", truckModel: "W900",
    trailerYear: 2022, trailerMake: "Great Dane", trailerModel: "Everest",
    truckPhotos: 2, trailerPhotos: 1, cdlCurrent: true, medicalCurrent: true,
  };
  test("complete when identity + photos + credentials are all in", () => {
    expect(rigRecordComplete(full)).toBe(true);
  });
  test("any missing piece blocks it", () => {
    expect(rigRecordComplete({ ...full, trailerPhotos: 0 })).toBe(false);
    expect(rigRecordComplete({ ...full, trailerModel: null })).toBe(false);
    expect(rigRecordComplete({ ...full, medicalCurrent: false })).toBe(false);
    expect(rigRecordComplete({ ...full, truckMake: "  " })).toBe(false);
  });
});

// ---- Maintenance discipline (the safety net) ------------------------------------------------

const D = 86400000;
const T0 = noon(2026, 6, 1);
const entry = (p: Partial<MaintEntryLike> & { id: number }): MaintEntryLike => ({
  category: "oil",
  performedMs: T0,
  odometer: null,
  cost: 300,
  nextDueMiles: null,
  nextDueAtMs: null,
  hasReceipt: true,
  status: "logged",
  ...p,
});
const oilService = [{ item: "oil", intervalMiles: 5000, lastDoneOdometer: 100000, lastDoneAtMs: T0 - 90 * D }];

describe("maintenance discipline — due window, receipt, odometer, duplicates", () => {
  test("a service logged when due, with receipt, earns; the cycle then closes", () => {
    const r = evaluateMaintenance(
      [
        entry({ id: 1, performedMs: T0, odometer: 105200 }), // due (105,000) → earns
        entry({ id: 2, performedMs: T0 + D, odometer: 106000, cost: 310 }), // same cycle → zero
        entry({ id: 3, performedMs: T0 + 2 * D, odometer: 110300 }), // next due (110,200) → earns
      ],
      oilService,
      120000,
    );
    expect(r.awards.map((a) => a.entryId)).toEqual([1, 3]);
    expect(r.awards[0]!.award.points).toBe(50);
    expect(r.awards[0]!.award.refKey).toBe("layer2-maint-1");
  });

  test("duplicate same-week maintenance earns zero: near-identical entries count once", () => {
    const r = evaluateMaintenance(
      [
        entry({ id: 1, performedMs: T0, odometer: 105200 }),
        entry({ id: 2, performedMs: T0 + 3600000, odometer: 105200 }), // same day/odo/cost
        entry({ id: 3, performedMs: T0 + 2 * 3600000, odometer: 105200 }),
        entry({ id: 4, performedMs: T0 + 3 * 3600000, odometer: 105200 }),
      ],
      oilService,
      120000,
    );
    expect(r.awards.map((a) => a.entryId)).toEqual([1]);
    expect(r.duplicateEntryIds).toEqual([2, 3, 4]);
    expect(r.duplicateCopies).toBe(3);
  });

  test("out-of-window (early) service earns zero and does not close the cycle", () => {
    const r = evaluateMaintenance(
      [
        entry({ id: 1, performedMs: T0, odometer: 102000 }), // due at 105,000 — too early
        entry({ id: 2, performedMs: T0 + D, odometer: 105200 }), // the real due service
      ],
      oilService,
      120000,
    );
    expect(r.awards.map((a) => a.entryId)).toEqual([2]);
  });

  test("no receipt earns zero — and the cycle still closes", () => {
    const r = evaluateMaintenance(
      [
        entry({ id: 1, performedMs: T0, odometer: 105200, hasReceipt: false }),
        entry({ id: 2, performedMs: T0 + D, odometer: 105400 }), // re-log with receipt: same cycle
      ],
      oilService,
      120000,
    );
    expect(r.awards.length).toBe(0);
    expect(r.dueButUnpaid).toEqual([{ entryId: 1, why: "no_receipt" }]);
  });

  test("odometer contradiction earns zero: past the sealed record, or backwards", () => {
    const beyond = evaluateMaintenance(
      [entry({ id: 1, performedMs: T0, odometer: 130000 })], // sealed record reached 120,000
      oilService,
      120000,
    );
    expect(beyond.awards.length).toBe(0);
    expect(beyond.odometerContradictionIds).toEqual([1]);
    expect(beyond.dueButUnpaid).toEqual([{ entryId: 1, why: "odometer" }]);

    const backward = evaluateMaintenance(
      [
        entry({ id: 1, performedMs: T0, odometer: 110000 }), // due (past 105,000) → earns
        entry({ id: 2, performedMs: T0 + D, odometer: 100000, cost: 250 }), // odometer ran backwards
      ],
      oilService,
      120000,
    );
    expect(backward.awards.map((a) => a.entryId)).toEqual([1]);
    expect(backward.odometerContradictionIds).toEqual([2]);
  });

  test("an entry with no odometer cannot be cross-checked and earns zero", () => {
    const r = evaluateMaintenance(
      [entry({ id: 1, performedMs: T0, odometer: null })],
      [{ item: "oil", intervalMiles: 5000, lastDoneOdometer: 100000, lastDoneAtMs: T0 - 90 * D }],
      120000,
    );
    // Not due by odometer (no reading) and no date due on an oil chain → nothing.
    expect(r.awards.length).toBe(0);
  });

  test("the entry's own nextDue chain sets the next due point", () => {
    const r = evaluateMaintenance(
      [
        entry({ id: 1, performedMs: T0, odometer: 105200, nextDueMiles: 108000 }),
        entry({ id: 2, performedMs: T0 + D, odometer: 108100, cost: 320 }),
      ],
      oilService,
      120000,
    );
    expect(r.awards.map((a) => a.entryId)).toEqual([1, 2]);
  });

  test("the DOT annual runs date-based on the 12-month rule", () => {
    const r = evaluateMaintenance(
      [entry({ id: 1, category: "dot_inspection", performedMs: noon(2026, 6, 10), odometer: 50000, cost: 450 })],
      [{ item: "dot_inspection", intervalMiles: 0, lastDoneOdometer: null, lastDoneAtMs: noon(2025, 6, 1) }],
      100000,
    );
    expect(r.awards.map((a) => a.entryId)).toEqual([1]);
  });

  test("categories the schedule doesn't track earn nothing; drafts never count", () => {
    const r = evaluateMaintenance(
      [
        entry({ id: 1, category: "engine", performedMs: T0, odometer: 105200 }),
        entry({ id: 2, performedMs: T0, odometer: 105200, status: "draft" }),
      ],
      oilService,
      120000,
    );
    expect(r.awards.length).toBe(0);
    expect(r.duplicateCopies).toBe(0); // the draft isn't even in the evaluation
  });

  test("day keys are driver-local", () => {
    expect(layer2DayKey(noon(2026, 6, 15))).toBe("2026-06-15");
  });
});
