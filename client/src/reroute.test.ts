// Unit tests for the reroute budget + settle logic (reroute.ts).
// Run: bun test client/src/reroute.test.ts
import { describe, expect, test } from "bun:test";
import {
  REROUTE_BUDGET_MS,
  REROUTE_FIRST_TIMEOUT_MS,
  canFireReroute,
  isNotSettling,
  isRerouteSettled,
  rerouteMayRetry,
  rerouteTimeoutForAttempt,
} from "./reroute";

describe("reroute budget — the driver's 3–6 second rule", () => {
  test("the budget itself is the promised 6 seconds", () => {
    expect(REROUTE_BUDGET_MS).toBe(6000);
  });
  test("first attempt gets its capped share, never the old 20 s", () => {
    expect(rerouteTimeoutForAttempt(0, 0)).toBe(REROUTE_FIRST_TIMEOUT_MS);
    expect(rerouteTimeoutForAttempt(0, 0)).toBeLessThanOrEqual(3000);
  });
  test("first + one retry fit inside the budget together", () => {
    const first = rerouteTimeoutForAttempt(0, 0);
    const retry = rerouteTimeoutForAttempt(1, first);
    expect(retry).toBeGreaterThan(0);
    expect(first + retry).toBeLessThanOrEqual(REROUTE_BUDGET_MS);
  });
  test("a retry that cannot fit is refused — no 12 s hangs", () => {
    // The field failure burned 12–13.6 s on one attempt. With most
    // of the budget gone, no new attempt may start.
    expect(rerouteTimeoutForAttempt(1, 5400)).toBe(0);
    expect(rerouteMayRetry(1, 5400)).toBe(false);
    expect(rerouteMayRetry(1, 1000)).toBe(true);
  });
  test("never more than two attempts ride one budget", () => {
    expect(rerouteMayRetry(2, 0)).toBe(false);
    expect(rerouteMayRetry(3, 0)).toBe(false);
  });
  test("elapsed time shrinks the attempt, never grows it", () => {
    expect(rerouteTimeoutForAttempt(1, 4000)).toBeLessThan(rerouteTimeoutForAttempt(1, 1000));
  });
});

describe("settle — a reroute counts only when the truck is on the new line", () => {
  test("on the line (or within GPS fuzz of it) settles", () => {
    expect(isRerouteSettled(0)).toBe(true);
    expect(isRerouteSettled(0.05)).toBe(true);
    expect(isRerouteSettled(0.08)).toBe(true);
  });
  test("a line that landed on the wrong parallel road does NOT settle", () => {
    expect(isRerouteSettled(0.12)).toBe(false);
    expect(isRerouteSettled(0.4)).toBe(false);
    expect(isRerouteSettled(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isRerouteSettled(Number.NaN)).toBe(false);
  });
});

describe("canFireReroute — the same-spot loop is dead", () => {
  const now = 1_000_000;
  test("the first attempt of an episode always fires", () => {
    expect(canFireReroute({ attempts: 0, lastAttemptAtMs: 0, travelledSinceLastMi: 0 }, now)).toBe(true);
  });
  test("a refire at the same spot inside the gap is refused", () => {
    expect(
      canFireReroute({ attempts: 1, lastAttemptAtMs: now - 20_000, travelledSinceLastMi: 0.02 }, now),
    ).toBe(false);
  });
  test("real movement from the reroute origin earns a refire", () => {
    expect(
      canFireReroute({ attempts: 1, lastAttemptAtMs: now - 5_000, travelledSinceLastMi: 0.25 }, now),
    ).toBe(true);
  });
  test("the long gap earns a refire below the attempt cap", () => {
    expect(
      canFireReroute({ attempts: 2, lastAttemptAtMs: now - 60_000, travelledSinceLastMi: 0.01 }, now),
    ).toBe(true);
  });
  test("at the attempt cap, only movement earns a refire — time alone does not", () => {
    expect(
      canFireReroute({ attempts: 3, lastAttemptAtMs: now - 120_000, travelledSinceLastMi: 0.01 }, now),
    ).toBe(false);
    expect(
      canFireReroute({ attempts: 3, lastAttemptAtMs: now - 120_000, travelledSinceLastMi: 0.3 }, now),
    ).toBe(true);
  });
});

describe("isNotSettling — surfaced on screen, not looped in silence", () => {
  test("three same-spot attempts = not settling", () => {
    expect(isNotSettling({ attempts: 3, lastAttemptAtMs: 1, travelledSinceLastMi: 0.02 })).toBe(true);
  });
  test("fewer attempts, or real movement, is not the not-settling state", () => {
    expect(isNotSettling({ attempts: 2, lastAttemptAtMs: 1, travelledSinceLastMi: 0.02 })).toBe(false);
    expect(isNotSettling({ attempts: 3, lastAttemptAtMs: 1, travelledSinceLastMi: 0.4 })).toBe(false);
  });
});
