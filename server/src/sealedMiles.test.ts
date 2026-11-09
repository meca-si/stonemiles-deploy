import { describe, expect, test } from "bun:test";
import {
SEALED_MILES_MONTHLY_CEILING_FREE,
SEALED_MILES_MONTHLY_CEILING_PAID,
SEALED_MILES_RATE_FREE,
SEALED_MILES_RATE_PAID,
conversionPortions,
milesAwardedInMonth,
milesPortionForRequest,
netSealedMilesPoints,
sealedMilesMonthlyCeiling,
sealedMilesPointsForTrip,
sealedMilesRatePerMile,
unconvertedMilesBalance,
} from "./sealedMiles";
import {
EARNING_POOL_QUEUE_ORDER,
anchorUsdForPoints,
tokensForUsd,
} from "./rewardsAnchor";

/**
 * SEALED MILES (owner-approved 2026-10-26; spec § Sealed Miles;
 * profit sim Part 6 PASSED). These tests run the EXACT pure
 * decisions the server paths run: awardSealedMiles in actions.ts
 * computes an award as milesAwardedInMonth(ledger, now) →
 * sealedMilesPointsForTrip(trip.totalMiles, paidTier, already) and
 * appends one "sealed_miles" ledger row; the void clawback appends
 * the negative of that row stamped at the award's instant (the same
 * shape voidPodSeal uses for the POD seal's points);
 * requestPointsConversion attributes via unconvertedMilesBalance +
 * milesPortionForRequest; the Earning Pool queue drains portions in
 * EARNING_POOL_QUEUE_ORDER phases, points leaving the ledger only as
 * each portion pays, each portion priced by anchorUsdForPoints +
 * tokensForUsd. The simulations below drive those same functions
 * over an in-memory ledger/pool, so a passing test here is the
 * handler's arithmetic there.
 */

type Row = { amount: number; source: string; createdAt: Date; refKey?: string };

const NOV5 = new Date("2026-11-05T15:00:00Z"); // Nov 5 in America/Chicago
const NOV20 = new Date("2026-11-20T15:00:00Z");
const OCT31 = new Date("2026-10-31T15:00:00Z"); // Oct 31 in America/Chicago

/** The award path, exactly as awardSealedMiles runs it. */
function awardTrip(
  ledger: Row[],
  tripId: number,
  sealedMiles: number,
  paidTier: boolean,
  at: Date,
): number {
  const already = milesAwardedInMonth(ledger, at);
  const points = sealedMilesPointsForTrip(sealedMiles, paidTier, already);
  if (points > 0) {
    ledger.push({
      amount: points,
      source: "sealed_miles",
      createdAt: at,
      refKey: `sealed_miles:trip:${tripId}`,
    });
  }
  return points;
}

/** The void clawback, exactly as voidPodSeal reverses a miles award. */
function clawbackTrip(ledger: Row[], tripId: number): number {
  const award = ledger.find((r) => r.refKey === `sealed_miles:trip:${tripId}` && r.amount > 0);
  if (!award) return 0;
  if (ledger.some((r) => r.refKey === `clawback:sealed_miles:${tripId}`)) return 0;
  ledger.push({
    amount: -award.amount,
    source: "sealed_miles",
    createdAt: award.createdAt, // stamped with the award's instant, like the POD clawback
    refKey: `clawback:sealed_miles:${tripId}`,
  });
  return award.amount;
}

describe("sealed miles — rates and ceilings", () => {
  test("paid rate is 1 point per 2.5 miles (0.4/mi); free tier is half (0.2/mi)", () => {
    expect(SEALED_MILES_RATE_PAID).toBe(0.4);
    expect(SEALED_MILES_RATE_FREE).toBe(0.2);
    expect(sealedMilesRatePerMile(true)).toBe(0.4);
    expect(sealedMilesRatePerMile(false)).toBe(0.2);
    expect(sealedMilesPointsForTrip(2.5, true, 0)).toBe(1);
    expect(sealedMilesPointsForTrip(10000, true, 0)).toBe(4000);
    expect(sealedMilesPointsForTrip(10000, false, 0)).toBe(2000);
  });

  test("per-trip award is floored — fractional value is not carried", () => {
    expect(sealedMilesPointsForTrip(101, true, 0)).toBe(40); // 40.4 → 40
    expect(sealedMilesPointsForTrip(101, false, 0)).toBe(20); // 20.2 → 20
    expect(sealedMilesPointsForTrip(1, true, 0)).toBe(0); // 0.4 → 0
  });

  test("ceilings: 8,000/month paid, 4,000/month free", () => {
    expect(SEALED_MILES_MONTHLY_CEILING_PAID).toBe(8000);
    expect(SEALED_MILES_MONTHLY_CEILING_FREE).toBe(4000);
    expect(sealedMilesMonthlyCeiling(true)).toBe(8000);
    expect(sealedMilesMonthlyCeiling(false)).toBe(4000);
    expect(sealedMilesPointsForTrip(100000, true, 0)).toBe(8000);
    expect(sealedMilesPointsForTrip(100000, false, 0)).toBe(4000);
  });

  test("already-awarded accounting clamps at the ceiling and never goes negative", () => {
    expect(sealedMilesPointsForTrip(1000, true, 7900)).toBe(100); // raw 400, room 100
    expect(sealedMilesPointsForTrip(1000, true, 8000)).toBe(0);
    expect(sealedMilesPointsForTrip(1000, true, 99999)).toBe(0);
    expect(sealedMilesPointsForTrip(1000, false, 3950)).toBe(50);
    expect(sealedMilesPointsForTrip(0, true, 0)).toBe(0);
    expect(sealedMilesPointsForTrip(-50, true, 0)).toBe(0);
    expect(sealedMilesPointsForTrip(Number.NaN, true, 0)).toBe(0);
    expect(sealedMilesPointsForTrip(1000, true, Number.NaN)).toBe(400);
  });
});

describe("sealed miles — award path at trip seal", () => {
  test("sealing a trip awards miles OUTSIDE the 500/day daily cap", () => {
    const ledger: Row[] = [
      // a perfect paid day already at the 500 cap
      { amount: 500, source: "daily_trip_sealed", createdAt: NOV5 },
    ];
    const awarded = awardTrip(ledger, 1, 2500, true, NOV5);
    expect(awarded).toBe(1000); // 2,500 mi × 0.4 — the daily cap never consulted
    const balance = ledger.reduce((s, r) => s + r.amount, 0);
    expect(balance).toBe(1500);
  });

  test("a second trip in the same month respects the monthly ceiling", () => {
    const ledger: Row[] = [];
    expect(awardTrip(ledger, 1, 15000, true, NOV5)).toBe(6000);
    expect(awardTrip(ledger, 2, 15000, true, NOV20)).toBe(2000); // clamped to the 8,000 ceiling
    expect(awardTrip(ledger, 3, 15000, true, NOV20)).toBe(0); // ceiling reached
    expect(milesAwardedInMonth(ledger, NOV20)).toBe(8000);
    // a new month starts fresh
    expect(milesAwardedInMonth(ledger, new Date("2026-12-02T15:00:00Z"))).toBe(0);
  });

  test("last month's awards don't consume this month's ceiling", () => {
    const ledger: Row[] = [];
    expect(awardTrip(ledger, 1, 20000, true, OCT31)).toBe(8000); // October, at ceiling
    expect(awardTrip(ledger, 2, 2500, true, NOV5)).toBe(1000); // November room is full
  });

  test("free tier earns half rate under its own 4,000 ceiling", () => {
    const ledger: Row[] = [];
    expect(awardTrip(ledger, 1, 10000, false, NOV5)).toBe(2000);
    expect(awardTrip(ledger, 2, 10000, false, NOV20)).toBe(2000);
    expect(awardTrip(ledger, 3, 10000, false, NOV20)).toBe(0);
    expect(netSealedMilesPoints(ledger)).toBe(4000);
  });

  test("voiding a seal reverses that trip's miles award and frees the ceiling", () => {
    const ledger: Row[] = [];
    expect(awardTrip(ledger, 7, 20000, true, NOV5)).toBe(8000); // at ceiling
    expect(awardTrip(ledger, 8, 2500, true, NOV20)).toBe(0);
    expect(clawbackTrip(ledger, 7)).toBe(8000);
    expect(netSealedMilesPoints(ledger)).toBe(0);
    expect(milesAwardedInMonth(ledger, NOV20)).toBe(0); // nets inside the award's month
    // the freed room can be earned again by a later seal
    expect(awardTrip(ledger, 9, 2500, true, NOV20)).toBe(1000);
    // a second void of the same trip reverses nothing (idempotent)
    expect(clawbackTrip(ledger, 7)).toBe(0);
    expect(netSealedMilesPoints(ledger)).toBe(1000);
  });
});

describe("sealed miles — conversion attribution (whole blocks, task first)", () => {
  test("miles portion = whole 1,000-pt blocks of the unconverted miles balance", () => {
    expect(milesPortionForRequest(10000, 5500)).toBe(5000);
    expect(milesPortionForRequest(10000, 999)).toBe(0);
    expect(milesPortionForRequest(3000, 100000)).toBe(3000);
    expect(milesPortionForRequest(10000, 10000)).toBe(10000);
    expect(milesPortionForRequest(0, 5000)).toBe(0);
    expect(milesPortionForRequest(10000, 0)).toBe(0);
  });

  test("unconverted balance = miles awards − miles portions already paid or queued", () => {
    expect(unconvertedMilesBalance(12000, 0)).toBe(12000);
    expect(unconvertedMilesBalance(12000, 5000)).toBe(7000); // first request committed 5,000
    // a second request can only attribute what remains, in blocks
    expect(milesPortionForRequest(10000, unconvertedMilesBalance(12000, 5000))).toBe(7000);
    // committed portions can exceed post-clawback awards — balance reads 0, never negative
    expect(unconvertedMilesBalance(3000, 5000)).toBe(0);
  });

  test("block attribution never exceeds the unconverted miles balance", () => {
    for (const unconverted of [0, 1, 999, 1000, 1001, 5500, 123456]) {
      for (const requested of [1000, 5000, 10000, 100000]) {
        const portion = milesPortionForRequest(requested, unconverted);
        expect(portion).toBeLessThanOrEqual(Math.floor(unconverted / 1000) * 1000);
        expect(portion).toBeLessThanOrEqual(requested);
        expect(portion % 1000).toBe(0);
      }
    }
  });

  test("conversionPortions splits task-first and clamps the miles part to blocks", () => {
    expect(conversionPortions(10000, 5000)).toEqual({ taskPoints: 5000, milesPoints: 5000 });
    expect(conversionPortions(10000, 0)).toEqual({ taskPoints: 10000, milesPoints: 0 });
    expect(conversionPortions(10000, 10000)).toEqual({ taskPoints: 0, milesPoints: 10000 });
    expect(conversionPortions(10000, 99999)).toEqual({ taskPoints: 0, milesPoints: 10000 });
  });
});

/**
 * The Earning Pool queue, simulated with the same phase order
 * (EARNING_POOL_QUEUE_ORDER), the same per-portion anchor math
 * (anchorUsdForPoints + tokensForUsd), and the same rule the
 * handlers enforce: points leave the ledger only as a portion pays,
 * a portion pays only when the pool covers its token amount and the
 * ledger balance covers its points.
 */
type Conv = {
  id: number;
  points: number;
  milesPoints: number;
  taskPaid: boolean;
  milesPaid: boolean;
  status: "queued" | "paid";
};
type Credit = { id: number; amountUsd: number; paid: boolean };

function drainQueues(args: {
  pool: number;
  price: number;
  balance: number;
  conversions: Conv[];
  credits: Credit[];
}): { pool: number; balance: number; order: string[] } {
  let { pool, balance } = args;
  const order: string[] = [];
  const payPortion = (c: Conv, portion: "task" | "miles"): boolean => {
    const { taskPoints, milesPoints } = conversionPortions(c.points, c.milesPoints);
    const pts = portion === "task" ? taskPoints : milesPoints;
    if (pts <= 0) return true; // an empty portion is complete by definition
    if (portion === "task" ? c.taskPaid : c.milesPaid) return true;
    const usd = anchorUsdForPoints(pts);
    const tokens = usd != null ? tokensForUsd(usd, args.price) : null;
    if (tokens == null || pool < tokens || balance < pts) return false;
    pool -= tokens;
    balance -= pts; // points leave the ledger only as the portion pays
    if (portion === "task") c.taskPaid = true;
    else c.milesPaid = true;
    order.push(`conv${c.id}:${portion}`);
    if (c.taskPaid && c.milesPaid) c.status = "paid";
    return true;
  };
  for (const phase of EARNING_POOL_QUEUE_ORDER) {
    if (phase === "points_conversions_task") {
      for (const c of args.conversions) payPortion(c, "task");
    } else if (phase === "welcome_credits") {
      for (const cr of args.credits) {
        const tokens = tokensForUsd(cr.amountUsd, args.price);
        if (tokens == null || pool < tokens) continue;
        pool -= tokens;
        cr.paid = true;
        order.push(`credit${cr.id}`);
      }
    } else if (phase === "points_conversions_miles") {
      for (const c of args.conversions) payPortion(c, "miles");
    }
  }
  return { pool, balance, order };
}

describe("sealed miles — Earning Pool queue order (task → credits → miles)", () => {
  const PRICE = 0.005; // $0.25 block → 50 tokens per 1,000 points

  test("a request's task portion pays before its miles portion", () => {
    const conv: Conv = { id: 1, points: 10000, milesPoints: 5000, taskPaid: false, milesPaid: false, status: "queued" };
    const r = drainQueues({ pool: 100000, price: PRICE, balance: 20000, conversions: [conv], credits: [] });
    expect(r.order).toEqual(["conv1:task", "conv1:miles"]);
    expect(conv.status).toBe("paid");
    expect(r.balance).toBe(10000); // both portions deducted, at their payments
  });

  test("pool covers the task portion only: miles portion stays queued and its points stay in the ledger", () => {
    const conv: Conv = { id: 1, points: 10000, milesPoints: 5000, taskPaid: false, milesPaid: false, status: "queued" };
    // task portion = 5,000 pts = $1.25 = 250 tokens; miles portion needs another 250
    const r = drainQueues({ pool: 250, price: PRICE, balance: 10000, conversions: [conv], credits: [] });
    expect(r.order).toEqual(["conv1:task"]);
    expect(conv.taskPaid).toBe(true);
    expect(conv.milesPaid).toBe(false);
    expect(conv.status).toBe("queued"); // completes only when BOTH portions paid
    expect(r.balance).toBe(5000); // the miles points never left the ledger
  });

  test("credits pay before miles portions", () => {
    const conv: Conv = { id: 1, points: 10000, milesPoints: 5000, taskPaid: false, milesPaid: false, status: "queued" };
    const credit: Credit = { id: 9, amountUsd: 1, paid: false }; // $1.00 → 200 tokens
    // pool: task 250 + credit 200 = 450 exactly; the miles portion (250) must wait
    const r = drainQueues({ pool: 450, price: PRICE, balance: 10000, conversions: [conv], credits: [credit] });
    expect(r.order).toEqual(["conv1:task", "credit9"]);
    expect(credit.paid).toBe(true);
    expect(conv.milesPaid).toBe(false);
    expect(r.balance).toBe(5000);
  });

  test("miles portions drain FIFO across conversions, after every task portion", () => {
    const c1: Conv = { id: 1, points: 10000, milesPoints: 5000, taskPaid: false, milesPaid: false, status: "queued" };
    const c2: Conv = { id: 2, points: 10000, milesPoints: 5000, taskPaid: false, milesPaid: false, status: "queued" };
    const r = drainQueues({ pool: 100000, price: PRICE, balance: 50000, conversions: [c1, c2], credits: [] });
    expect(r.order).toEqual(["conv1:task", "conv2:task", "conv1:miles", "conv2:miles"]);
    expect(c1.status).toBe("paid");
    expect(c2.status).toBe("paid");
  });

  test("a portion anchored per-portion: each 1,000-pt block carries $0.25", () => {
    expect(anchorUsdForPoints(5000)).toBe(1.25);
    const conv: Conv = { id: 1, points: 10000, milesPoints: 5000, taskPaid: false, milesPaid: false, status: "queued" };
    const r = drainQueues({ pool: 500, price: PRICE, balance: 10000, conversions: [conv], credits: [] });
    expect(r.pool).toBe(0); // 250 (task) + 250 (miles) — the full $2.50 anchor, no more
    expect(conv.status).toBe("paid");
  });
});
