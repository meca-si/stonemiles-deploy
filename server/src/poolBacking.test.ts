import { describe, expect, test } from "bun:test";
import {
DEPEG_PAUSE_DEVIATION,
EARNING_POOL_WALLET_ADDRESS,
FLOOR_WINDOW_DAYS,
USDG_CONTRACT_ADDRESS,
assessPoolBacking,
evaluatePayoutRunGate,
expectedPayoutFloorUsd,
payoutDrawAllowed,
pointsLiabilityUsd,
sweepGuard,
totalLiabilitiesUsd,
} from "./poolBacking";
import { tokensForUsd } from "./rewardsAnchor";

describe("backing constants (USDG plan, locked 2026-10-26)", () => {
  test("canonical addresses + thresholds", () => {
    expect(USDG_CONTRACT_ADDRESS).toBe(
      "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    );
    expect(EARNING_POOL_WALLET_ADDRESS).toBe(
      "0x4550E380182c8CdE5Fbc01004eb7DA42CF102213",
    );
    expect(DEPEG_PAUSE_DEVIATION).toBe(0.05);
    expect(FLOOR_WINDOW_DAYS).toBe(30);
  });
});

describe("liabilities — points at the anchor + unpaid credits", () => {
  test("points liability is balance × $0.25 per 1,000", () => {
    expect(pointsLiabilityUsd(0)).toBe(0);
    expect(pointsLiabilityUsd(1000)).toBe(0.25);
    expect(pointsLiabilityUsd(10000)).toBe(2.5);
    expect(pointsLiabilityUsd(52500)).toBe(13.13);
    expect(pointsLiabilityUsd(-5000)).toBe(0);
    expect(pointsLiabilityUsd(Number.NaN)).toBe(0);
  });

  test("total liabilities sum points + credits + vesting, no double count", () => {
    // 20,000 pts outstanding ($5.00 at the $0.25 anchor) + $5.00
    // queued credits + $3.75 pending vesting = $13.75. Queued
    // conversions are NOT added — their points are already inside
    // the 20,000.
    expect(
      totalLiabilitiesUsd({
        outstandingPoints: 20000,
        unpaidCreditUsd: 5,
        unpaidVestingUsd: 3.75,
      }),
    ).toBe(13.75);
    expect(
      totalLiabilitiesUsd({
        outstandingPoints: 0,
        unpaidCreditUsd: 0,
        unpaidVestingUsd: 0,
      }),
    ).toBe(0);
  });
});

describe("coverage math", () => {
  test("coverage = backing valued at real price ÷ liabilities", () => {
    const a = assessPoolBacking({
      backingUsdg: 1000,
      usdgPriceUsd: 1,
      liabilitiesUsd: 800,
      floorUsd: 100,
    });
    expect(a.backingUsd).toBe(1000);
    expect(a.coverage).toBe(1.25);
    expect(a.payoutsPaused).toBe(false);
    expect(a.pauseReason).toBeNull();
    expect(a.surplusAboveFloorUsd).toBe(900);
  });

  test("no liabilities → coverage null, not paused, not infinite", () => {
    const a = assessPoolBacking({
      backingUsdg: 500,
      usdgPriceUsd: 1,
      liabilitiesUsd: 0,
      floorUsd: 0,
    });
    expect(a.coverage).toBeNull();
    expect(a.payoutsPaused).toBe(false);
  });

  test("a mild depeg revalues the backing and can drop coverage below 1", () => {
    const a = assessPoolBacking({
      backingUsdg: 1000,
      usdgPriceUsd: 0.97,
      liabilitiesUsd: 990,
      floorUsd: 0,
    });
    expect(a.backingUsd).toBe(970);
    expect(a.deviation).toBeCloseTo(-0.03, 10);
    expect(a.severeDepeg).toBe(false);
    expect(a.coverage).toBeLessThan(1);
    expect(a.payoutsPaused).toBe(true);
    expect(a.pauseReason).toBe("coverage_below_one");
  });

  test("a mild depeg with coverage still ≥ 1 does not pause", () => {
    const a = assessPoolBacking({
      backingUsdg: 1000,
      usdgPriceUsd: 0.98,
      liabilitiesUsd: 900,
      floorUsd: 0,
    });
    expect(a.backingUsd).toBe(980);
    expect(a.coverage).toBeGreaterThan(1);
    expect(a.payoutsPaused).toBe(false);
  });
});

describe("depeg pause (locked rule)", () => {
  test("severe depeg (>5% below peg) pauses outright even at full coverage", () => {
    const a = assessPoolBacking({
      backingUsdg: 10000,
      usdgPriceUsd: 0.94,
      liabilitiesUsd: 100,
      floorUsd: 0,
    });
    expect(a.severeDepeg).toBe(true);
    expect(a.payoutsPaused).toBe(true);
    expect(a.pauseReason).toBe("usdg_severe_depeg");
    // Exactly at -5% is not yet severe.
    const edge = assessPoolBacking({
      backingUsdg: 10000,
      usdgPriceUsd: 0.95,
      liabilitiesUsd: 100,
      floorUsd: 0,
    });
    expect(edge.severeDepeg).toBe(false);
    expect(edge.payoutsPaused).toBe(false);
  });

  test("unknown USDG price fails closed — paused, never assumed $1 for gating", () => {
    for (const bad of [null, undefined, 0, -1, Number.NaN]) {
      const a = assessPoolBacking({
        backingUsdg: 1000,
        usdgPriceUsd: bad,
        liabilitiesUsd: 10,
        floorUsd: 0,
      });
      expect(a.priceKnown).toBe(false);
      expect(a.payoutsPaused).toBe(true);
      expect(a.pauseReason).toBe("usdg_price_unknown");
    }
  });

  test("the $STONER price fail-closed rule is untouched (null price pays nothing)", () => {
    expect(tokensForUsd(2, null)).toBeNull();
    expect(tokensForUsd(2, 0)).toBeNull();
    expect(tokensForUsd(2, 0.005)).toBe(400);
  });
});

describe("D3 floor — expected payouts from the trailing run-rate", () => {
  const now = new Date("2026-10-26T12:00:00Z");
  const daysAgo = (d: number) =>
    new Date(now.getTime() - d * 24 * 60 * 60 * 1000);

  test("floor sums only the last 30 days of anchored payouts", () => {
    const floor = expectedPayoutFloorUsd(
      [
        { amountUsd: 10, paidAt: daysAgo(1) },
        { amountUsd: 5.5, paidAt: daysAgo(29) },
        { amountUsd: 100, paidAt: daysAgo(31) }, // outside the window
        { amountUsd: 7, paidAt: daysAgo(-1) }, // future — not history
        { amountUsd: 0, paidAt: daysAgo(2) }, // not a payout
      ],
      now,
    );
    expect(floor).toBe(15.5);
  });

  test("no payout history → floor 0 (pre-launch)", () => {
    expect(expectedPayoutFloorUsd([], now)).toBe(0);
  });
});

describe("D3 floor protection — sweeps blocked, driver payouts never blocked", () => {
  test("sweep down to exactly the floor is allowed; below it is blocked", () => {
    expect(
      sweepGuard({ backingUsd: 1000, floorUsd: 400, sweepUsd: 600 }),
    ).toMatchObject({ allowed: true, backingAfterUsd: 400 });
    const blocked = sweepGuard({
      backingUsd: 1000,
      floorUsd: 400,
      sweepUsd: 600.01,
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toContain("floor");
  });

  test("at or below the floor, any positive sweep is blocked", () => {
    expect(
      sweepGuard({ backingUsd: 400, floorUsd: 400, sweepUsd: 0.01 }).allowed,
    ).toBe(false);
    expect(
      sweepGuard({ backingUsd: 300, floorUsd: 400, sweepUsd: 1 }).allowed,
    ).toBe(false);
    expect(
      sweepGuard({ backingUsd: 1000, floorUsd: 400, sweepUsd: 0 }).allowed,
    ).toBe(false);
    expect(
      sweepGuard({ backingUsd: 1000, floorUsd: 400, sweepUsd: -5 }).allowed,
    ).toBe(false);
  });

  test("a driver payout may draw below the floor — the floor is FOR payouts", () => {
    // Backing 450, floor 400: a $200 driver payout draws to 250,
    // below the floor — allowed, because the backing covers the payout.
    expect(payoutDrawAllowed({ backingUsd: 450, payoutUsd: 200 })).toBe(true);
    // But never from air: a payout bigger than the backing queues.
    expect(payoutDrawAllowed({ backingUsd: 150, payoutUsd: 200 })).toBe(
      false,
    );
    expect(payoutDrawAllowed({ backingUsd: 450, payoutUsd: 0 })).toBe(false);
  });
});

describe("D2 manual-batch gating", () => {
  test("manual-batch mode blocks every non-batch run", () => {
    expect(
      evaluatePayoutRunGate({
        manualBatch: true,
        batchAuthorized: false,
        backingLive: false,
        payoutsPaused: false,
      }),
    ).toEqual({ run: false, blockedBy: "manual_batch" });
    // Automatic triggers (funding, subscription events, wallet reads)
    // are non-batch runs — blocked the same way.
    expect(
      evaluatePayoutRunGate({
        manualBatch: true,
        batchAuthorized: false,
        backingLive: true,
        payoutsPaused: false,
      }).run,
    ).toBe(false);
  });

  test("an authorized admin batch runs", () => {
    expect(
      evaluatePayoutRunGate({
        manualBatch: true,
        batchAuthorized: true,
        backingLive: false,
        payoutsPaused: false,
      }),
    ).toEqual({ run: true, blockedBy: null });
  });

  test("with manual batch off, runs execute (post-launch automation posture)", () => {
    expect(
      evaluatePayoutRunGate({
        manualBatch: false,
        batchAuthorized: false,
        backingLive: false,
        payoutsPaused: false,
      }).run,
    ).toBe(true);
  });

  test("a paused backing blocks even an authorized batch — but only when live", () => {
    expect(
      evaluatePayoutRunGate({
        manualBatch: true,
        batchAuthorized: true,
        backingLive: true,
        payoutsPaused: true,
      }),
    ).toEqual({ run: false, blockedBy: "backing_paused" });
    // Fallback posture (backing not live): the depeg assessment does
    // not gate — bank dollars govern, exactly as the spec's §6 says.
    expect(
      evaluatePayoutRunGate({
        manualBatch: false,
        batchAuthorized: false,
        backingLive: false,
        payoutsPaused: true,
      }).run,
    ).toBe(true);
  });
});
