// nextLoad.test.ts — pure-rule tests for the suggested-next-load
// ranking (Alvys-grab build): the deadhead basis rule, the
// calendar legs, the sealed-hours leg, the honesty rule (a
// missing fact reads "not checked", never a pass), and
// deterministic ordering. The funnel-gate integration coverage
// (a suggestion never bypasses DQF) lives in
// alvysGrabFlow.test.ts.

import { describe, expect, test } from "bun:test";
import {
  rankNextLoadsForDriver,
  type CandidateFitInput,
  type DriverFitFacts,
  type SuggestionLeg,
} from "./nextLoad";

const NOW = Date.UTC(2026, 10, 16, 12, 0, 0); // Mon Nov 16 2026, 12:00 UTC
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

const homeOk: SuggestionLeg = { status: "ok", detail: "Home-time safe.", short: "home-time safe" };

function facts(over: Partial<DriverFitFacts> = {}): DriverFitFacts {
  return {
    currentPos: null,
    routeEnd: null,
    hasActiveLoad: false,
    boundWindows: [],
    untimedBoundCount: 0,
    offDutyWindows: [],
    dutyEvents: [],
    ...over,
  };
}

function input(boardLoadId: number, over: Partial<CandidateFitInput["candidate"]> = {}, homeTime: SuggestionLeg = homeOk): CandidateFitInput {
  return {
    candidate: {
      boardLoadId,
      pickupAtMs: NOW + 2 * DAY,
      deliveryAtMs: NOW + 3 * DAY,
      pickupPoint: null,
      ...over,
    },
    homeTime,
  };
}

describe("deadhead leg — the assign ranking's basis rule", () => {
  test("an empty truck measures from its current position", () => {
    const [s] = rankNextLoadsForDriver(
      facts({ currentPos: { lat: 32.78, lon: -96.8 } }), // Dallas
      [input(1, { pickupPoint: { lat: 32.75, lon: -97.33 } })], // Fort Worth
      NOW,
    );
    expect(s!.legs.deadhead.status).toBe("ok");
    expect(s!.deadheadMi).toBeGreaterThan(25);
    expect(s!.deadheadMi).toBeLessThan(40);
    expect(s!.reasons[0]).toContain("mi deadhead");
  });

  test("a truck on a load measures from the route END, not its cab", () => {
    const [s] = rankNextLoadsForDriver(
      facts({
        currentPos: { lat: 35.0, lon: -100.0 }, // cab far away
        routeEnd: { lat: 32.78, lon: -96.8 }, // route ends in Dallas
        hasActiveLoad: true,
      }),
      [input(1, { pickupPoint: { lat: 32.75, lon: -97.33 } })],
      NOW,
    );
    expect(s!.legs.deadhead.status).toBe("ok");
    expect(s!.deadheadMi).toBeLessThan(40);
    expect(s!.legs.deadhead.detail).toContain("current load ends");
  });

  test("no position and no route end → not checked, never a zero", () => {
    const [s] = rankNextLoadsForDriver(facts(), [input(1, { pickupPoint: { lat: 32.75, lon: -97.33 } })], NOW);
    expect(s!.legs.deadhead.status).toBe("not_checked");
    expect(s!.deadheadMi).toBeNull();
    expect(s!.reasons.join(" ")).toContain("deadhead not checked");
  });

  test("a position without a geocoded pickup → not checked", () => {
    const [s] = rankNextLoadsForDriver(facts({ currentPos: { lat: 32.78, lon: -96.8 } }), [input(1)], NOW);
    expect(s!.legs.deadhead.status).toBe("not_checked");
    expect(s!.deadheadMi).toBeNull();
  });
});

describe("availability leg", () => {
  test("overlap with a bound load is a conflict", () => {
    const [s] = rankNextLoadsForDriver(
      facts({ boundWindows: [{ startMs: NOW + DAY, endMs: NOW + 4 * DAY, label: "Mobile, AL → Dallas, TX" }] }),
      [input(1)],
      NOW,
    );
    expect(s!.legs.availability.status).toBe("conflict");
    expect(s!.conflict).toBe(true);
    expect(s!.legs.availability.detail).toContain("Mobile, AL → Dallas, TX");
  });

  test("overlap with approved time off is a conflict", () => {
    const [s] = rankNextLoadsForDriver(
      facts({ offDutyWindows: [{ startMs: NOW + 2 * DAY, endMs: NOW + 2 * DAY + 12 * HOUR, label: "Home time" }] }),
      [input(1)],
      NOW,
    );
    expect(s!.legs.availability.status).toBe("conflict");
    expect(s!.legs.availability.detail).toContain("Home time");
  });

  test("a free calendar names the day the driver frees up", () => {
    const [s] = rankNextLoadsForDriver(
      facts({ boundWindows: [{ startMs: NOW - 2 * DAY, endMs: NOW + DAY, label: "earlier load" }] }),
      [input(1)],
      NOW,
    );
    expect(s!.legs.availability.status).toBe("ok");
    expect(s!.legs.availability.detail).toContain("Free from");
  });

  test("no appointment times on the candidate → not checked", () => {
    const [s] = rankNextLoadsForDriver(facts(), [input(1, { pickupAtMs: null, deliveryAtMs: null })], NOW);
    expect(s!.legs.availability.status).toBe("not_checked");
  });

  test("untimed bound loads are disclosed as a caveat, not hidden", () => {
    const [s] = rankNextLoadsForDriver(facts({ untimedBoundCount: 2 }), [input(1)], NOW);
    expect(s!.legs.availability.status).toBe("ok");
    expect(s!.legs.availability.detail).toContain("2 bound loads have no times on file");
  });
});

describe("hours leg — the sealed duty clock", () => {
  test("no duty facts on file → not checked", () => {
    const [s] = rankNextLoadsForDriver(facts(), [input(1)], NOW);
    expect(s!.legs.hos.status).toBe("not_checked");
    expect(s!.reasons.join(" ")).toContain("hours not checked");
  });

  test("pickup inside the open 14-hour window → ok", () => {
    const [s] = rankNextLoadsForDriver(
      facts({ dutyEvents: [{ state: "driving", at: iso(NOW - 2 * HOUR) }] }),
      [input(1, { pickupAtMs: NOW + 5 * HOUR, deliveryAtMs: NOW + 8 * HOUR })],
      NOW,
    );
    expect(s!.legs.hos.status).toBe("ok");
  });

  test("pickup past the window with no room to reset → conflict", () => {
    const [s] = rankNextLoadsForDriver(
      facts({ dutyEvents: [{ state: "driving", at: iso(NOW - 13 * HOUR) }] }), // window ends NOW+1h
      [input(1, { pickupAtMs: NOW + 2 * HOUR, deliveryAtMs: NOW + 5 * HOUR })],
      NOW,
    );
    expect(s!.legs.hos.status).toBe("conflict");
    expect(s!.legs.hos.short).toBe("hours run out");
    expect(s!.legs.hos.detail).toContain("run out");
  });

  test("a full 10-hour reset fits before the pickup → ok", () => {
    const [s] = rankNextLoadsForDriver(
      facts({ dutyEvents: [{ state: "driving", at: iso(NOW - 13 * HOUR) }] }), // window ends NOW+1h
      [input(1, { pickupAtMs: NOW + 12 * HOUR, deliveryAtMs: NOW + 15 * HOUR })],
      NOW,
    );
    expect(s!.legs.hos.status).toBe("ok");
    expect(s!.legs.hos.detail).toContain("reset");
  });

  test("a completed 10-hour break closes the old window", () => {
    const [s] = rankNextLoadsForDriver(
      facts({
        dutyEvents: [
          { state: "driving", at: iso(NOW - 40 * HOUR) },
          { state: "off_duty", at: iso(NOW - 30 * HOUR) }, // 10h break completes at NOW-20h
          { state: "on_duty", at: iso(NOW - 3 * HOUR) }, // new window opened 3h ago
        ],
      }),
      [input(1, { pickupAtMs: NOW + 5 * HOUR, deliveryAtMs: NOW + 8 * HOUR })],
      NOW,
    );
    expect(s!.legs.hos.status).toBe("ok");
  });
});

describe("ranking order", () => {
  test("conflicts sink, unchecked legs sink, then deadhead, then earlier pickup", () => {
    const ranked = rankNextLoadsForDriver(
      facts({
        currentPos: { lat: 32.78, lon: -96.8 },
        boundWindows: [{ startMs: NOW + DAY, endMs: NOW + 4 * DAY, label: "bound" }],
      }),
      [
        input(3, { pickupPoint: { lat: 32.9, lon: -96.9 } }), // clean but overlaps the bound window → conflict
        input(2, { pickupPoint: { lat: 34.0, lon: -98.0 }, pickupAtMs: NOW + 6 * DAY, deliveryAtMs: NOW + 7 * DAY }), // clean, far
        input(1, { pickupPoint: { lat: 32.8, lon: -96.85 }, pickupAtMs: NOW + 6 * DAY, deliveryAtMs: NOW + 7 * DAY }), // clean, near
      ],
      NOW,
    );
    expect(ranked.map((r) => r.boardLoadId)).toEqual([1, 2, 3]);
    expect(ranked[2]!.conflict).toBe(true);
  });

  test("deterministic: identical inputs rank identically, ties break by pickup then id", () => {
    const inputs = [input(9), input(4), input(7)];
    const a = rankNextLoadsForDriver(facts(), inputs, NOW).map((r) => r.boardLoadId);
    const b = rankNextLoadsForDriver(facts(), inputs, NOW).map((r) => r.boardLoadId);
    expect(a).toEqual(b);
    expect(a).toEqual([4, 7, 9]);
  });
});
