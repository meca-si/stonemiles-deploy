// hosEngine.test.ts — unit pins for the shared HOS clock engine
// (audit fixes A3 cycle type + A10 split sleeper, 2026-11-15).
// The client twin (client/src/hosEngine.ts) runs the IDENTICAL
// scenarios in client/src/hosEngine.test.ts — the two engines must
// never disagree on a driver's hours.

import { describe, expect, test } from "bun:test";
import { hosClocksFromEvents, hosEpochs, type HosEventLike } from "./hosEngine";

const H = 3600000;
const T0 = Date.parse("2026-11-10T00:00:00Z");

/** Build an event list from [state, startH, endH] spans (hours
 *  from T0). An event marks the START of a state; the engine
 *  derives segment ends from the next event / now. */
function evs(spans: [string, number, number][]): HosEventLike[] {
  return spans.map(([state, start]) => ({ state, at: new Date(T0 + start * H).toISOString() }));
}
const now = (h: number) => T0 + h * H;

describe("cycle type (A3 — 49 CFR 395.3(b))", () => {
  test("default is 70/8 — the pre-fix behaviour", () => {
    const events = evs([["on_duty", 0, 63]]);
    const c = hosClocksFromEvents(events, now(63));
    expect(c.cycleRemainH).toBe(7);
  });

  test("a 60/7 driver caps at 60 in 7 days", () => {
    const events = evs([["on_duty", 0, 63]]);
    const c = hosClocksFromEvents(events, now(63), "60/7");
    expect(c.cycleRemainH).toBe(0);
  });

  test("duty 7.5 days ago counts toward 70/8 but not 60/7", () => {
    // One 5h on-duty block 7.5 days back, nothing since.
    const events = evs([["on_duty", 0, 5], ["off_duty", 5, 180]]);
    const at = now(180);
    expect(hosClocksFromEvents(events, at, "60/7").cycleRemainH).toBe(60);
    expect(hosClocksFromEvents(events, at, "70/8").cycleRemainH).toBe(65);
  });

  test("no data shows the cycle's own full limit", () => {
    expect(hosClocksFromEvents([], now(0), "60/7").cycleRemainH).toBe(60);
    expect(hosClocksFromEvents([], now(0)).cycleRemainH).toBe(70);
  });
});

describe("split sleeper (A10 — 49 CFR 395.1(g))", () => {
  test("a valid 8/2 pair extends the window and re-anchors the drive clock", () => {
    const events = evs([
      ["off_duty", 0, 10], // full reset
      ["driving", 10, 15], // 5h
      ["sleeper", 15, 23], // 8h in the berth — long period
      ["driving", 23, 26], // 3h (counts: it is after the pair's first period)
      ["off_duty", 26, 28], // 2h — pair completes at 28, anchor = 23
      ["driving", 28, 30], // 2h
    ]);
    const c = hosClocksFromEvents(events, now(30));
    // Driving since anchor (23): 3 + 2 = 5 → 6 left of 11.
    expect(c.driveRemainH).toBeCloseTo(6, 5);
    // Window from 23: 7h elapsed minus the excluded 2h rest = 5 → 9 left.
    expect(c.windowRemainH).toBeCloseTo(9, 5);
  });

  test("a valid 7/3 pair (7 consecutive in the berth + 3 off) pairs too", () => {
    const events = evs([
      ["off_duty", 0, 10],
      ["driving", 10, 14],
      ["sleeper", 14, 21], // 7h berth
      ["driving", 21, 23],
      ["off_duty", 23, 26], // 3h — pair completes, anchor = 21
      ["driving", 26, 27],
    ]);
    const c = hosClocksFromEvents(events, now(27));
    expect(c.driveRemainH).toBeCloseTo(11 - 3, 5); // 2 + 1 since anchor
    expect(c.windowRemainH).toBeCloseTo(14 - (27 - 21 - 3), 5);
  });

  test("the short period may come first (2 off, then 8 in the berth)", () => {
    const events = evs([
      ["off_duty", 0, 10],
      ["driving", 10, 13],
      ["off_duty", 13, 15], // 2h
      ["driving", 15, 17],
      ["sleeper", 17, 25], // 8h berth — pair completes at 25, anchor = 15
      ["driving", 25, 26],
    ]);
    const c = hosClocksFromEvents(events, now(26));
    expect(c.driveRemainH).toBeCloseTo(11 - 3, 5); // 2 + 1 since anchor 15
    expect(c.windowRemainH).toBeCloseTo(14 - (26 - 15 - 8), 5);
  });

  test("a 6/4 pair does NOT pair — neither period has 7 consecutive in the berth", () => {
    const events = evs([
      ["off_duty", 0, 10],
      ["driving", 10, 14],
      ["sleeper", 14, 20], // 6h berth — not long
      ["driving", 20, 22],
      ["off_duty", 22, 26], // 4h — not long either
      ["driving", 26, 27],
    ]);
    const c = hosClocksFromEvents(events, now(27));
    // Reckoned from the full reset at 10, as before this fix.
    expect(c.driveRemainH).toBeCloseTo(11 - 7, 5);
    expect(c.windowRemainH).toBe(0);
  });

  test("an unpaired 8h sleeper period alone changes nothing", () => {
    const events = evs([
      ["off_duty", 0, 10],
      ["driving", 10, 15],
      ["sleeper", 15, 23], // 8h, but no second period yet
      ["driving", 23, 25],
    ]);
    const c = hosClocksFromEvents(events, now(25));
    expect(c.driveRemainH).toBeCloseTo(11 - 7, 5);
    expect(c.windowRemainH).toBe(0);
  });

  test("7 hours of MIXED off/sleeper is not the long period — the berth stretch must be consecutive", () => {
    const events = evs([
      ["off_duty", 0, 10],
      ["driving", 10, 14],
      ["off_duty", 14, 17], // 3h off
      ["sleeper", 17, 21], // 4h berth — the run totals 7h but only 4 consecutive in the berth
      ["driving", 21, 23],
      ["off_duty", 23, 26], // 3h
      ["driving", 26, 27],
    ]);
    const epochs = hosEpochs(events, now(27));
    // Only the full reset epoch exists — no pair was formed.
    expect(epochs.length).toBe(1);
    const c = hosClocksFromEvents(events, now(27));
    expect(c.driveRemainH).toBeCloseTo(11 - 7, 5);
  });

  test("a full 10h rest after a pair resets everything again", () => {
    const events = evs([
      ["off_duty", 0, 10],
      ["driving", 10, 15],
      ["sleeper", 15, 23],
      ["driving", 23, 26],
      ["off_duty", 26, 28], // pair completes, anchor 23
      ["driving", 28, 30],
      ["off_duty", 30, 41], // 11h — full reset at 40
      ["driving", 41, 43],
    ]);
    const c = hosClocksFromEvents(events, now(43));
    expect(c.driveRemainH).toBeCloseTo(9, 5);
    expect(c.windowRemainH).toBeCloseTo(12, 5); // window opens at the first duty segment (41)
  });
});

describe("unchanged rules", () => {
  test("30-min break: on-duty-not-driving satisfies it (395.3(a)(3)(ii))", () => {
    const events = evs([
      ["off_duty", 0, 10],
      ["driving", 10, 18], // 8h driving
      ["on_duty", 18, 18.5], // 30m fueling on duty
      ["driving", 18.5, 19.5], // 1h more
    ]);
    const c = hosClocksFromEvents(events, now(19.5));
    expect(c.breakRemainH).toBeCloseTo(7, 5);
  });

  test("plain shift with no split: 11 / 14 as before", () => {
    const events = evs([
      ["off_duty", 0, 10],
      ["on_duty", 10, 11],
      ["driving", 11, 16],
    ]);
    const c = hosClocksFromEvents(events, now(16));
    expect(c.driveRemainH).toBeCloseTo(6, 5);
    expect(c.windowRemainH).toBeCloseTo(8, 5);
  });
});
