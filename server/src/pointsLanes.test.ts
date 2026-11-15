// pointsLanes.test.ts — UNIT tests for the pure points-lane decisions
// (pointsLanes.ts): milestone tiers, on-time streak blocks, the HOS
// violation replay, corroboration relations, and lane keys. The
// handler-level integration tests live in pointsLanesFlow.test.ts.

import { describe, expect, test } from "bun:test";
import {
  fuelRelation,
  haversineMi,
  hosViolationsInWindow,
  intelRelation,
  laneForSource,
  laneKeyFor,
  milesMilestonesCrossed,
  onTimeBlockAwards,
  type DutyEventLike,
  type SealedLoadTiming,
} from "./pointsLanes";

describe("laneForSource", () => {
  test("maps lane sources, nothing else", () => {
    expect(laneForSource("lane1_miles_milestone")).toBe("lane1");
    expect(laneForSource("lane2_intel_report")).toBe("lane2");
    expect(laneForSource("lane3_first_lane")).toBe("lane3");
    expect(laneForSource("daily_pod_seal")).toBeNull();
    expect(laneForSource("clawback")).toBeNull();
    expect(laneForSource("sealed_miles")).toBeNull();
  });
});

describe("milesMilestonesCrossed", () => {
  test("crosses tiers at the thresholds, one-time each", () => {
    expect(milesMilestonesCrossed(0)).toEqual([]);
    expect(milesMilestonesCrossed(9_999)).toEqual([]);
    expect(milesMilestonesCrossed(10_000).map((m) => m.miles)).toEqual([10_000]);
    expect(milesMilestonesCrossed(60_000).map((m) => m.miles)).toEqual([10_000, 50_000]);
    expect(milesMilestonesCrossed(250_000).map((m) => m.points)).toEqual([250, 1_000, 2_500]);
  });
});

describe("onTimeBlockAwards", () => {
  const t = (loadId: number, sealMin: number, onTime: boolean | null): SealedLoadTiming => ({
    loadId,
    sealMs: sealMin * 60000,
    apptMs: onTime === null ? null : sealMin * 60000 + 3600000,
    onTime: onTime === true,
  });
  test("five on-time in a row = one block, keyed by the run's first load", () => {
    const awards = onTimeBlockAwards([t(1, 0, true), t(2, 10, true), t(3, 20, true), t(4, 30, true), t(5, 40, true)]);
    expect(awards).toEqual([{ refKey: "lane1-ontime-1-1", runStartLoadId: 1, block: 1, points: 100 }]);
  });
  test("four is not a block; ten in a run is two blocks", () => {
    expect(onTimeBlockAwards([t(1, 0, true), t(2, 10, true), t(3, 20, true), t(4, 30, true)])).toEqual([]);
    const ten = Array.from({ length: 10 }, (_, i) => t(i + 1, i * 10, true));
    expect(onTimeBlockAwards(ten).map((a) => a.refKey)).toEqual(["lane1-ontime-1-1", "lane1-ontime-1-2"]);
  });
  test("a late load ends the run; the next run keys off its own first load", () => {
    const loads = [
      ...Array.from({ length: 4 }, (_, i) => t(i + 1, i * 10, true)),
      t(9, 100, false),
      ...Array.from({ length: 5 }, (_, i) => t(20 + i, 200 + i * 10, true)),
    ];
    expect(onTimeBlockAwards(loads).map((a) => a.refKey)).toEqual(["lane1-ontime-20-1"]);
  });
  test("loads with no appointment neither extend nor break a run", () => {
    const loads = [
      t(1, 0, true), t(2, 10, true), t(3, 20, null), t(4, 30, true), t(5, 40, true), t(6, 50, true),
    ];
    expect(onTimeBlockAwards(loads).map((a) => a.refKey)).toEqual(["lane1-ontime-1-1"]);
  });
  test("input order does not matter — seal order governs", () => {
    const loads = [t(5, 40, true), t(1, 0, true), t(3, 20, true), t(2, 10, true), t(4, 30, true)];
    expect(onTimeBlockAwards(loads).map((a) => a.refKey)).toEqual(["lane1-ontime-1-1"]);
  });
});

describe("hosViolationsInWindow", () => {
  const MON = Date.parse("2026-11-02T00:00:00Z"); // a Monday (UTC math only here)
  const at = (dayOffset: number, h: number, m = 0) =>
    new Date(MON + dayOffset * 86400000 + h * 3600000 + m * 60000).toISOString();
  const ev = (state: string, dayOffset: number, h: number, m = 0): DutyEventLike => ({ state, at: at(dayOffset, h, m) });
  const week: [number, number] = [MON, MON + 7 * 86400000];

  test("a short clean day is clean", () => {
    const events = [ev("on_duty", 0, 6), ev("driving", 0, 6, 5), ev("on_duty", 0, 10), ev("off_duty", 0, 10, 5)];
    expect(hosViolationsInWindow(events, week[0], week[1])).toEqual([]);
  });
  test("12 hours of driving breaks the 11h drive limit (and the break rule)", () => {
    const events = [ev("on_duty", 0, 6), ev("driving", 0, 6, 5), ev("off_duty", 0, 18, 5)];
    const kinds = hosViolationsInWindow(events, week[0], week[1]).map((v) => v.kind);
    expect(kinds).toContain("drive");
    expect(kinds).toContain("break");
  });
  test("driving past the 14h window is a window violation even under 11h driving", () => {
    // On duty 06:00, drive 3h, sit on-duty 9h, drive again at hour 15.
    const events = [
      ev("on_duty", 0, 6), ev("driving", 0, 6, 5), ev("on_duty", 0, 9, 5),
      ev("driving", 0, 21, 30), ev("off_duty", 0, 22),
    ];
    const kinds = hosViolationsInWindow(events, week[0], week[1]).map((v) => v.kind);
    expect(kinds).toContain("window");
    expect(kinds).not.toContain("drive");
  });
  test("a 10h break resets the clocks — the same driving after it is clean", () => {
    const events = [
      ev("on_duty", 0, 6), ev("driving", 0, 6, 5), ev("off_duty", 0, 14, 5), // 8h driving, then off
      ev("on_duty", 1, 0, 30), ev("driving", 1, 0, 35), ev("off_duty", 1, 8, 35), // 10h25m off in between
    ];
    expect(hosViolationsInWindow(events, week[0], week[1])).toEqual([]);
  });
  test("violations outside the window are not counted in it", () => {
    const events = [ev("on_duty", 0, 6), ev("driving", 0, 6, 5), ev("off_duty", 0, 18, 5)];
    const nextWeek: [number, number] = [MON + 7 * 86400000, MON + 14 * 86400000];
    expect(hosViolationsInWindow(events, nextWeek[0], nextWeek[1])).toEqual([]);
  });
  test("break rule (395.3(a)(3)(ii)): 30 min ON DUTY after 8h driving satisfies the break", () => {
    // 8h driving, then 30 minutes fueling/inspecting on duty, then
    // driving on: since 2020 the interruption may be on-duty-not-
    // driving. The clocks have always read it this way; the replay
    // once zeroed the non-driving run on an on-duty segment and
    // invented a break violation here. Fixed 2026-11-15.
    const events = [
      ev("on_duty", 0, 6), ev("driving", 0, 6, 5), ev("on_duty", 0, 14, 5),
      ev("driving", 0, 14, 35), ev("off_duty", 0, 15, 35),
    ];
    expect(hosViolationsInWindow(events, week[0], week[1])).toEqual([]);
  });
  test("break rule: a mixed 15m off-duty + 15m on-duty interruption also satisfies it", () => {
    const events = [
      ev("on_duty", 0, 6), ev("driving", 0, 6, 5), ev("off_duty", 0, 14, 5),
      ev("on_duty", 0, 14, 20), ev("driving", 0, 14, 35), ev("off_duty", 0, 15, 35),
    ];
    const kinds = hosViolationsInWindow(events, week[0], week[1]).map((v) => v.kind);
    expect(kinds).not.toContain("break");
  });
  test("break rule: 29 minutes on duty does NOT satisfy it — driving on is a break violation", () => {
    const events = [
      ev("on_duty", 0, 6), ev("driving", 0, 6, 5), ev("on_duty", 0, 14, 5),
      ev("driving", 0, 14, 34), ev("off_duty", 0, 15, 34),
    ];
    const kinds = hosViolationsInWindow(events, week[0], week[1]).map((v) => v.kind);
    expect(kinds).toContain("break");
  });
  test("break rule: the trigger is DRIVING time — 8h of on-duty time alone never trips it", () => {
    // 4h driving, 8h on-duty at a dock, 1h driving: 5h of driving
    // total, so no break is due — an on-duty-based rule would flag
    // this day, the driving-based rule (the actual rule) does not.
    const events = [
      ev("on_duty", 0, 6), ev("driving", 0, 6, 5), ev("on_duty", 0, 10, 5),
      ev("driving", 0, 18, 5), ev("off_duty", 0, 19, 5),
    ];
    expect(hosViolationsInWindow(events, week[0], week[1])).toEqual([]);
  });
  test("70h cycle: nine 10-hour duty days in a row trips the cycle clock (only the cycle)", () => {
    // 10h on duty/day (5h55m of it driving): under the 11h, 14h, and
    // break limits every day, with a 14h reset each night — but the
    // trailing-8-day duty total passes 70h on day 9.
    const events: DutyEventLike[] = [];
    for (let d = 0; d < 9; d++) {
      events.push(ev("on_duty", d, 6), ev("driving", d, 6, 5), ev("on_duty", d, 12), ev("off_duty", d, 16));
    }
    const kinds = hosViolationsInWindow(events, MON, MON + 14 * 86400000).map((v) => v.kind);
    expect(kinds).toContain("cycle");
    expect(kinds).not.toContain("drive");
    expect(kinds).not.toContain("window");
  });
  test("60/7 cycle (A3): seven 10-hour duty days trip a 60/7 driver's cycle but not a 70/8 driver's", () => {
    const events: DutyEventLike[] = [];
    for (let d = 0; d < 7; d++) {
      events.push(ev("on_duty", d, 6), ev("driving", d, 6, 5), ev("on_duty", d, 12), ev("off_duty", d, 16));
    }
    const kinds60 = hosViolationsInWindow(events, MON, MON + 14 * 86400000, "60/7").map((v) => v.kind);
    expect(kinds60).toContain("cycle");
    const kinds70 = hosViolationsInWindow(events, MON, MON + 14 * 86400000).map((v) => v.kind);
    expect(kinds70).not.toContain("cycle");
  });
  test("split sleeper (A10): an 8/2 split day is clean — the pair governs the driving between its periods", () => {
    // Drive 5h, 8h in the berth, drive 3h (past the naive 14h window
    // from the morning), 2h off completing the pair, drive 2h more.
    // Judged under the completed pair: anchor = berth end (21:00),
    // driving since anchor 5h, window 5h elapsed — clean. Judged
    // without the split, the 21:00 driving breaks the 14h window.
    const events = [
      ev("off_duty", 0, 0), ev("on_duty", 0, 8), ev("driving", 0, 8, 5),
      ev("sleeper", 0, 13), ev("driving", 0, 21), ev("off_duty", 1, 0),
      ev("driving", 1, 2), ev("off_duty", 1, 4),
    ];
    expect(hosViolationsInWindow(events, week[0], week[1])).toEqual([]);
  });
  test("split sleeper (A10): a 6/4 split does NOT pair — the same shape violates the window", () => {
    const events = [
      ev("off_duty", 0, 0), ev("on_duty", 0, 8), ev("driving", 0, 8, 5),
      ev("sleeper", 0, 13), ev("driving", 0, 19), ev("off_duty", 0, 23),
      ev("driving", 1, 3), ev("off_duty", 1, 5),
    ];
    const kinds = hosViolationsInWindow(events, week[0], week[1]).map((v) => v.kind);
    expect(kinds).toContain("window");
  });
});

describe("corroboration relations", () => {
  test("intel: same kind corroborates, opposites contradict, others are unrelated", () => {
    expect(intelRelation("parking_open", "parking_open")).toBe("consistent");
    expect(intelRelation("parking_open", "parking_full")).toBe("contradicted");
    expect(intelRelation("weigh_closed", "weigh_open")).toBe("contradicted");
    expect(intelRelation("hazard", "parking_open")).toBe("unrelated");
    expect(intelRelation("hazard", "hazard")).toBe("consistent");
  });
  test("fuel: within $0.15 agrees, over $0.50 contradicts, between is neither", () => {
    expect(fuelRelation(3.5, 3.6)).toBe("consistent");
    expect(fuelRelation(3.5, 3.8)).toBe("unrelated");
    expect(fuelRelation(3.5, 4.2)).toBe("contradicted");
  });
  test("haversine: a quarter mile is a quarter mile", () => {
    // 0.0036 degrees of latitude ≈ 0.25 mi.
    expect(haversineMi(30, -90, 30.0036, -90)).toBeGreaterThan(0.24);
    expect(haversineMi(30, -90, 30.0036, -90)).toBeLessThan(0.26);
    expect(haversineMi(30, -90, 30, -90)).toBe(0);
  });
});

describe("laneKeyFor", () => {
  test("normalizes city/state and requires both ends", () => {
    expect(laneKeyFor(" Mobile ", "al", "Dallas", "TX")).toBe("MOBILE,AL->DALLAS,TX");
    expect(laneKeyFor("Mobile", "AL", null, "TX")).toBeNull();
    expect(laneKeyFor("", "AL", "Dallas", "TX")).toBeNull();
  });
});
