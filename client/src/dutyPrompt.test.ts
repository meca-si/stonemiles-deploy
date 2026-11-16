// dutyPrompt.test.ts — UNIT tests for the federal stopped-duty
// pattern (dutyPrompt.ts, B1 build 2026-11-15): 49 CFR Part 395
// Appendix A §4.4.1.2 — Driving + 5 consecutive minutes stopped →
// prompt; no response in 1 minute → the on-duty default fires
// exactly once. Nothing ever prompts or defaults out of any other
// status, and nothing in this machine can produce Off Duty or
// Sleeper Berth — those statuses exist only as driver taps, which
// this module does not model at all.

import { describe, expect, test } from "bun:test";
import {
  DutyPromptTracker,
  MOVING_MPH,
  PROMPT_RESPONSE_MS,
  STOPPED_MPH,
  STOPPED_PROMPT_MS,
} from "./dutyPrompt";

const MIN = 60_000;
const T0 = 1_700_000_000_000;
const stopped = (t: DutyPromptTracker, nowMs: number, duty: string | null = "driving") =>
  t.evaluate({ duty, mph: 0, nowMs });

describe("the federal thresholds", () => {
  test("are 5 minutes to prompt and 1 minute to default, not configurable", () => {
    expect(STOPPED_PROMPT_MS).toBe(5 * MIN);
    expect(PROMPT_RESPONSE_MS).toBe(1 * MIN);
    expect(MOVING_MPH).toBe(3);
    expect(STOPPED_MPH).toBe(2);
  });
});

describe("the prompt", () => {
  test("fires at exactly 5 minutes stopped in Driving — not a second before", () => {
    const t = new DutyPromptTracker();
    stopped(t, T0);
    const early = stopped(t, T0 + 5 * MIN - 1000);
    expect(early.promptVisible).toBe(false);
    const at = stopped(t, T0 + 5 * MIN);
    expect(at.promptVisible).toBe(true);
    expect(at.phase).toBe("prompted");
    expect(at.promptAtMs).toBe(T0 + 5 * MIN);
    expect(at.stillSinceMs).toBe(T0);
    expect(at.fireDefault).toBe(false);
  });

  test("never fires from any other status — On Duty with a task is immune", () => {
    for (const duty of ["on_duty", "off_duty", "sleeper", null]) {
      const t = new DutyPromptTracker();
      stopped(t, T0, duty);
      const r = stopped(t, T0 + 30 * MIN, duty);
      expect(r.promptVisible).toBe(false);
      expect(r.fireDefault).toBe(false);
      expect(r.phase).toBe("idle");
    }
  });

  test("leaving Driving mid-stop resets the clock entirely", () => {
    const t = new DutyPromptTracker();
    stopped(t, T0);
    stopped(t, T0 + 4 * MIN);
    t.evaluate({ duty: "on_duty", mph: 0, nowMs: T0 + 4 * MIN + 1000 }); // driver tapped Fuel
    t.evaluate({ duty: "driving", mph: 0, nowMs: T0 + 4 * MIN + 2000 });
    const r = stopped(t, T0 + 8 * MIN);
    expect(r.promptVisible).toBe(false); // only ~4 min into the new stop
  });
});

describe("the on-duty default", () => {
  test("fires 1 minute after the prompt, exactly once", () => {
    const t = new DutyPromptTracker();
    stopped(t, T0);
    stopped(t, T0 + 5 * MIN); // prompt
    const early = stopped(t, T0 + 5 * MIN + 59_000);
    expect(early.fireDefault).toBe(false);
    expect(early.promptVisible).toBe(true);
    const fired = stopped(t, T0 + 6 * MIN);
    expect(fired.fireDefault).toBe(true);
    expect(fired.phase).toBe("defaulted");
    expect(fired.stillSinceMs).toBe(T0);
    // Never twice, however long the seal takes to land.
    expect(stopped(t, T0 + 7 * MIN).fireDefault).toBe(false);
    expect(stopped(t, T0 + 60 * MIN).fireDefault).toBe(false);
  });

  test("moving again cancels a live prompt WITHOUT firing the default", () => {
    const t = new DutyPromptTracker();
    stopped(t, T0);
    stopped(t, T0 + 5 * MIN); // prompt up
    const moving = t.evaluate({ duty: "driving", mph: 40, nowMs: T0 + 5 * MIN + 30_000 });
    expect(moving.promptVisible).toBe(false);
    expect(moving.fireDefault).toBe(false);
    // And the next stop starts a fresh 5 minutes.
    stopped(t, T0 + 10 * MIN);
    expect(stopped(t, T0 + 14 * MIN).promptVisible).toBe(false);
    expect(stopped(t, T0 + 15 * MIN).promptVisible).toBe(true);
  });
});

describe("still driving", () => {
  test("latches: no re-prompt while the same stop continues, however long", () => {
    const t = new DutyPromptTracker();
    stopped(t, T0);
    stopped(t, T0 + 5 * MIN);
    t.answerStillDriving();
    const r = stopped(t, T0 + 45 * MIN);
    expect(r.promptVisible).toBe(false);
    expect(r.fireDefault).toBe(false);
    expect(r.phase).toBe("latched");
  });

  test("re-arms only after the truck moves and stops again", () => {
    const t = new DutyPromptTracker();
    stopped(t, T0);
    stopped(t, T0 + 5 * MIN);
    t.answerStillDriving();
    t.evaluate({ duty: "driving", mph: 55, nowMs: T0 + 6 * MIN }); // rolls again
    stopped(t, T0 + 20 * MIN); // next stop begins
    expect(stopped(t, T0 + 24 * MIN).promptVisible).toBe(false);
    expect(stopped(t, T0 + 25 * MIN).promptVisible).toBe(true);
  });

  test("answering with a change closes the prompt for good", () => {
    const t = new DutyPromptTracker();
    stopped(t, T0);
    stopped(t, T0 + 5 * MIN);
    t.answerWithChange();
    const r = t.evaluate({ duty: "on_duty", mph: 0, nowMs: T0 + 6 * MIN });
    expect(r.promptVisible).toBe(false);
    expect(r.fireDefault).toBe(false);
  });
});

describe("the speed band", () => {
  test("an ambiguous fix (2–3 mph, or none) holds the stillness clock as-is", () => {
    const t = new DutyPromptTracker();
    stopped(t, T0);
    t.evaluate({ duty: "driving", mph: 2.5, nowMs: T0 + 2 * MIN });
    t.evaluate({ duty: "driving", mph: null, nowMs: T0 + 3 * MIN });
    // The clock started at T0 and held — the prompt still lands
    // at T0 + 5 min of wall time on the next clear stop fix.
    expect(stopped(t, T0 + 5 * MIN).promptVisible).toBe(true);
  });

  test("no fix at all never starts the clock", () => {
    const t = new DutyPromptTracker();
    t.evaluate({ duty: "driving", mph: null, nowMs: T0 });
    const r = t.evaluate({ duty: "driving", mph: null, nowMs: T0 + 30 * MIN });
    expect(r.promptVisible).toBe(false);
    expect(r.fireDefault).toBe(false);
  });
});
