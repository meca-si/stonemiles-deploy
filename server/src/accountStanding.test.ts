import { describe, expect, test } from "bun:test";
import {
REACTIVATION_HOLD_MS,
RETAINER_MS,
holdEndsAt,
moneyExitRefusal,
planConversionRequest,
resolveStanding,
retainerEndsAt,
standingDateText,
trancheDueAfterPause,
vestingClockAction,
vestingShiftOnLift,
type AccountStanding,
} from "./accountStanding";
import {
FREE_TIER_CASHOUT_REFUSAL,
FREE_TIER_CONVERSION_REFUSAL,
pointsBalanceFromLedger,
} from "./pointsRetention";
import {
ANCHOR_USD_PER_BLOCK,
CONV_BLOCK_POINTS,
CONV_MONTHLY_CAP_POINTS,
CONV_MIN_BALANCE,
anchorUsdForPoints,
} from "./rewardsAnchor";

/**
 * Clauses A2c/A2d/A2e/A2f (owner, 2026-10-26) — the universal
 * money-exit gate and the non-renewal lifecycle. These tests run the
 * EXACT pure decisions the handlers run (resolveStanding /
 * moneyExitRefusal / planConversionRequest / vestingClockAction in
 * accountStanding.ts): a refusal outcome is the only thing the
 * handlers act on — they write a conversion row, a cash-out hold, or
 * a ledger movement ONLY past a null refusal / "queued" outcome, so
 * a refused plan here is a refused request there, with the balance
 * provably untouched.
 */

const DAY = 86400000;
const T0 = Date.parse("2026-11-02T12:00:00Z"); // a non-renewal instant

const freeStanding = (now: number): AccountStanding =>
  resolveStanding({ plan: "basic", retainer: null, hold: null, now });
const paidStanding = (now: number): AccountStanding =>
  resolveStanding({ plan: "gold", retainer: null, hold: null, now });

/** A retained earned balance: 10,440 points (past the 10,000 minimum). */
const RETAINED = 10440;
const ledger = [{ amount: 100 }, { amount: 372 }, { amount: 200 }, { amount: 9768 }];

describe("clause A2c — conversion and cash-out are locked while free", () => {
  test("(a) a free-tier conversion request is refused — no queue row, balance unchanged", () => {
    const queue: unknown[] = [];
    const plan = planConversionRequest({
      standing: freeStanding(T0),
      live: true, // even with the launch gate open, the standing gate refuses
      points: 10000,
      balance: RETAINED,
      convertedThisMonth: 0,
    });
    expect(plan.outcome).toBe("refused");
    if (plan.outcome === "refused") {
      expect(plan.error).toBe(FREE_TIER_CONVERSION_REFUSAL);
      expect(plan.error).toContain("never expire");
      expect(plan.error).toContain("upgrade");
    }
    if (plan.outcome === "queued") queue.push(plan);
    expect(queue).toHaveLength(0);
    expect(pointsBalanceFromLedger(ledger)).toBe(RETAINED);
    // The standing gate fires regardless of the other checks' state.
    expect(
      planConversionRequest({ standing: freeStanding(T0), live: false, points: 10000, balance: RETAINED, convertedThisMonth: 0 }).outcome,
    ).toBe("refused");
    expect(
      planConversionRequest({ standing: freeStanding(T0), live: true, points: 500, balance: 500, convertedThisMonth: 0 }).outcome,
    ).toBe("refused");
  });

  test("(b) a free-tier cash-out request is refused the same way; a paying tier passes the gate", () => {
    expect(moneyExitRefusal("cashout", freeStanding(T0))).toBe(FREE_TIER_CASHOUT_REFUSAL);
    expect(moneyExitRefusal("conversion", freeStanding(T0))).toBe(FREE_TIER_CONVERSION_REFUSAL);
    expect(moneyExitRefusal("cashout", paidStanding(T0))).toBeNull();
    expect(moneyExitRefusal("conversion", paidStanding(T0))).toBeNull();
  });

  test("(c) after upgrading, the SAME retained balance converts under the normal rules", () => {
    const gated = planConversionRequest({
      standing: paidStanding(T0),
      live: false,
      points: 10000,
      balance: RETAINED,
      convertedThisMonth: 0,
    });
    expect(gated.outcome).toBe("refused");
    if (gated.outcome === "refused") expect(gated.error).toContain("November 20 launch");
    expect(CONV_MIN_BALANCE).toBe(10000);
    expect(CONV_BLOCK_POINTS).toBe(1000);
    expect(CONV_MONTHLY_CAP_POINTS).toBe(100000);
    expect(ANCHOR_USD_PER_BLOCK).toBe(0.25);
    const plan = planConversionRequest({
      standing: paidStanding(T0),
      live: true,
      points: 10000,
      balance: RETAINED,
      convertedThisMonth: 0,
    });
    expect(plan).toEqual({ outcome: "queued", anchorUsd: 2.5 });
    expect(anchorUsdForPoints(10000)).toBe(2.5);
    expect(
      planConversionRequest({ standing: paidStanding(T0), live: true, points: 1500, balance: RETAINED, convertedThisMonth: 0 }).outcome,
    ).toBe("refused"); // not a whole block
    expect(
      planConversionRequest({ standing: paidStanding(T0), live: true, points: 10000, balance: 9000, convertedThisMonth: 0 }).outcome,
    ).toBe("refused"); // below the minimum
    expect(
      planConversionRequest({ standing: paidStanding(T0), live: true, points: 10000, balance: RETAINED, convertedThisMonth: 95000 }).outcome,
    ).toBe("refused"); // monthly cap
  });
});

describe("clause A2d/A2e — the 14-day retainer on non-renewal", () => {
  const ends = retainerEndsAt(T0);
  const inRetainer = (now: number): AccountStanding =>
    resolveStanding({ plan: "basic", retainer: { status: "active", endsAt: ends }, hold: null, now });

  test("the retainer window is exactly 14 days from the non-renewal date", () => {
    expect(RETAINER_MS).toBe(14 * DAY);
    expect(ends - T0).toBe(14 * DAY);
    expect(inRetainer(T0).state).toBe("in_retainer");
    expect(inRetainer(T0).lockEndsAt).toBe(ends);
    expect(inRetainer(ends - 1).state).toBe("in_retainer");
  });

  test("(a) in retainer: conversion AND both cash-out lanes refused, balance unchanged", () => {
    const s = inRetainer(T0 + 3 * DAY);
    // Cash-out is one gate for both lanes: moneyExitRefusal runs in
    // requestCashout before the instant/standard lane handling.
    expect(moneyExitRefusal("cashout", s)).toContain("2-week retainer");
    expect(moneyExitRefusal("cashout", s)).toContain(standingDateText(ends));
    expect(moneyExitRefusal("conversion", s)).toContain("2-week retainer");
    const queue: unknown[] = [];
    const plan = planConversionRequest({ standing: s, live: true, points: 10000, balance: RETAINED, convertedThisMonth: 0 });
    expect(plan.outcome).toBe("refused");
    if (plan.outcome === "queued") queue.push(plan);
    expect(queue).toHaveLength(0);
    expect(pointsBalanceFromLedger(ledger)).toBe(RETAINED);
    // Vesting is paused, not returned, during the retainer.
    expect(vestingClockAction(s)).toBe("pause");
  });

  test("(b) renewal inside the retainer: vesting clocks resume unspent — a paused tranche pays on its resumed schedule", () => {
    // Tranche granted at T0-30d, due at T0+20d (20 days after the
    // non-renewal). The account renews at T0+10d, inside the window.
    const dueAt = T0 + 20 * DAY;
    const renewedAt = T0 + 10 * DAY;
    const shift = vestingShiftOnLift(T0, renewedAt);
    expect(shift).toBe(10 * DAY); // exactly the paused span — no tranche time consumed
    const resumedDue = trancheDueAfterPause(dueAt, shift);
    expect(resumedDue).toBe(T0 + 30 * DAY);
    // On the resumed schedule: not due 5 days after renewal, due at day 30.
    expect(resumedDue > renewedAt + 5 * DAY).toBe(true);
    expect(resumedDue <= T0 + 30 * DAY).toBe(true);
    // After renewal the standing is the reactivation hold (A2f), and
    // vesting RUNS under it — payouts land in the wallet, unlock nothing.
    const after = resolveStanding({
      plan: "diamond",
      retainer: { status: "lifted", endsAt: ends },
      hold: { status: "active", endsAt: holdEndsAt(renewedAt) },
      now: renewedAt,
    });
    expect(after.state).toBe("reactivated_hold");
    expect(vestingClockAction(after)).toBe("run");
  });

  test("(c) retainer expiry un-renewed: unvested credits return, earned balance unchanged and still locked", () => {
    const s = resolveStanding({
      plan: "basic",
      retainer: { status: "active", endsAt: ends },
      hold: null,
      now: ends, // the window has run out (settle pass flips the row to expired)
    });
    expect(s.state).toBe("lapsed_locked");
    // The expiry treatment: pending vesting tranches return to the pool…
    expect(vestingClockAction(s)).toBe("return");
    // …while the earned points balance is exactly what it was…
    expect(pointsBalanceFromLedger(ledger)).toBe(RETAINED);
    // …and every exit stays locked, indefinitely.
    expect(moneyExitRefusal("conversion", s)).toContain("reactivate to convert and cash out");
    expect(moneyExitRefusal("cashout", s)).toContain("still here");
    const later = resolveStanding({
      plan: "basic",
      retainer: { status: "expired", endsAt: ends },
      hold: null,
      now: ends + 365 * DAY,
    });
    expect(later.state).toBe("lapsed_locked");
    expect(moneyExitRefusal("conversion", later)).not.toBeNull();
  });

  test("(d) reactivation after expiry unlocks conversion of the retained earned balance (after the A2f hold)", () => {
    const backAt = ends + 30 * DAY;
    const duringHold = resolveStanding({
      plan: "gold",
      retainer: { status: "expired", endsAt: ends },
      hold: { status: "active", endsAt: holdEndsAt(backAt) },
      now: backAt + DAY,
    });
    expect(duringHold.state).toBe("reactivated_hold");
    expect(
      planConversionRequest({ standing: duringHold, live: true, points: 10000, balance: RETAINED, convertedThisMonth: 0 }).outcome,
    ).toBe("refused");
    const afterHold = resolveStanding({
      plan: "gold",
      retainer: { status: "expired", endsAt: ends },
      hold: { status: "active", endsAt: holdEndsAt(backAt) },
      now: holdEndsAt(backAt),
    });
    expect(afterHold.state).toBe("paid_active");
    expect(
      planConversionRequest({ standing: afterHold, live: true, points: 10000, balance: RETAINED, convertedThisMonth: 0 }),
    ).toEqual({ outcome: "queued", anchorUsd: 2.5 });
    expect(pointsBalanceFromLedger(ledger)).toBe(RETAINED);
  });
});

describe("clause A2f — 14-day post-reactivation hold", () => {
  test("the hold window is exactly 14 days from reactivation", () => {
    expect(REACTIVATION_HOLD_MS).toBe(14 * DAY);
    expect(holdEndsAt(T0) - T0).toBe(14 * DAY);
  });

  test("(a) renewed inside the retainer: exits refused during the hold, allowed after hold end while active; vesting resumed during the hold", () => {
    const renewedAt = T0 + 5 * DAY; // inside the retainer window
    const holdEnd = holdEndsAt(renewedAt);
    const hold = { status: "active", endsAt: holdEnd };
    const retainer = { status: "lifted", endsAt: retainerEndsAt(T0) };
    const during = resolveStanding({ plan: "gold", retainer, hold, now: renewedAt + 7 * DAY });
    expect(during.state).toBe("reactivated_hold");
    expect(during.lockEndsAt).toBe(holdEnd);
    expect(moneyExitRefusal("conversion", during)).toContain("unlocks on");
    expect(moneyExitRefusal("conversion", during)).toContain(standingDateText(holdEnd));
    expect(moneyExitRefusal("cashout", during)).not.toBeNull(); // both lanes, one gate
    expect(
      planConversionRequest({ standing: during, live: true, points: 10000, balance: RETAINED, convertedThisMonth: 0 }).outcome,
    ).toBe("refused");
    // Vesting resumed during the hold (A2e clocks + A2f: payouts land
    // in the balance, they do not unlock anything).
    expect(vestingClockAction(during)).toBe("run");
    const after = resolveStanding({ plan: "gold", retainer, hold, now: holdEnd });
    expect(after.state).toBe("paid_active");
    expect(moneyExitRefusal("conversion", after)).toBeNull();
    expect(
      planConversionRequest({ standing: after, live: true, points: 10000, balance: RETAINED, convertedThisMonth: 0 }),
    ).toEqual({ outcome: "queued", anchorUsd: 2.5 });
  });

  test("(b) returned after retainer expiry: retained earned balance only — returned credits do NOT come back", () => {
    // Two tranches were pending at expiry: the settle returned them.
    const tranches = [
      { id: 1, status: "pending" as string },
      { id: 2, status: "pending" as string },
    ];
    const expiryStanding = resolveStanding({
      plan: "basic",
      retainer: { status: "active", endsAt: retainerEndsAt(T0) },
      hold: null,
      now: retainerEndsAt(T0),
    });
    expect(vestingClockAction(expiryStanding)).toBe("return");
    for (const t of tranches) if (vestingClockAction(expiryStanding) === "return") t.status = "returned";
    // Reactivation months later: the earned balance is intact, the
    // returned tranches stay returned (terminal), conversion waits
    // out the hold, then unlocks.
    const backAt = retainerEndsAt(T0) + 60 * DAY;
    const during = resolveStanding({
      plan: "gold",
      retainer: { status: "expired", endsAt: retainerEndsAt(T0) },
      hold: { status: "active", endsAt: holdEndsAt(backAt) },
      now: backAt + 2 * DAY,
    });
    expect(during.state).toBe("reactivated_hold");
    expect(
      planConversionRequest({ standing: during, live: true, points: 10000, balance: RETAINED, convertedThisMonth: 0 }).outcome,
    ).toBe("refused");
    expect(tranches.every((t) => t.status === "returned")).toBe(true);
    expect(tranches.filter((t) => t.status === "pending")).toHaveLength(0);
    expect(pointsBalanceFromLedger(ledger)).toBe(RETAINED);
    const after = resolveStanding({
      plan: "gold",
      retainer: { status: "expired", endsAt: retainerEndsAt(T0) },
      hold: { status: "active", endsAt: holdEndsAt(backAt) },
      now: holdEndsAt(backAt),
    });
    expect(after.state).toBe("paid_active");
    expect(
      planConversionRequest({ standing: after, live: true, points: 10000, balance: RETAINED, convertedThisMonth: 0 }),
    ).toEqual({ outcome: "queued", anchorUsd: 2.5 });
    expect(tranches.every((t) => t.status === "returned")).toBe(true);
  });

  test("(c) cancelling during the hold drops the balance into a FRESH retainer cycle with a new end date", () => {
    const renewedAt = T0 + 5 * DAY;
    const cancelAt = renewedAt + 4 * DAY; // still inside the hold
    // The hold row flips to cancelled; a fresh retainer opens at the
    // cancellation with its own 14-day window (A2e rules anew).
    const freshEnds = retainerEndsAt(cancelAt);
    expect(freshEnds).toBe(cancelAt + 14 * DAY);
    expect(freshEnds).not.toBe(holdEndsAt(renewedAt));
    expect(freshEnds).not.toBe(retainerEndsAt(T0));
    const s = resolveStanding({
      plan: "basic",
      retainer: { status: "active", endsAt: freshEnds },
      hold: { status: "cancelled", endsAt: holdEndsAt(renewedAt) },
      now: cancelAt + DAY,
    });
    expect(s.state).toBe("in_retainer");
    expect(s.lockEndsAt).toBe(freshEnds);
    expect(moneyExitRefusal("conversion", s)).toContain("2-week retainer");
    expect(moneyExitRefusal("cashout", s)).toContain(standingDateText(freshEnds));
    expect(vestingClockAction(s)).toBe("pause"); // the new cycle pauses vesting again
    expect(
      planConversionRequest({ standing: s, live: true, points: 10000, balance: RETAINED, convertedThisMonth: 0 }).outcome,
    ).toBe("refused");
    expect(pointsBalanceFromLedger(ledger)).toBe(RETAINED);
  });
});
