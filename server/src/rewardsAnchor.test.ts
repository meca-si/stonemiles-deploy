import { describe, expect, test } from "bun:test";
import {
ANCHOR_USD_PER_BLOCK,
CONV_BLOCK_POINTS,
EARNING_POOL_QUEUE_ORDER,
WELCOME_CREDIT_USD,
WELCOME_VEST_MONTHLY_TRANCHES,
YEARLY_CREDIT_USD,
anchorUsdForPoints,
splitVestedCreditUsd,
tokensForUsd,
} from "./rewardsAnchor";

describe("anchor constants (Option C, locked 2026-10-26; anchor raised by the rewards rework 2026-10-26)", () => {
  test("anchor is $0.25 per 1,000-point block", () => {
    expect(ANCHOR_USD_PER_BLOCK).toBe(0.25);
    expect(CONV_BLOCK_POINTS).toBe(1000);
  });

  test("credit USD values per tier", () => {
    expect(WELCOME_CREDIT_USD.gold).toBe(1);
    expect(WELCOME_CREDIT_USD.diamond).toBe(5);
    expect(WELCOME_CREDIT_USD.owner).toBe(25);
    expect(YEARLY_CREDIT_USD).toBe(1);
  });

  test("vesting shape: Diamond ×6, Fleet ×12, Gold liquid", () => {
    expect(WELCOME_VEST_MONTHLY_TRANCHES.diamond).toBe(6);
    expect(WELCOME_VEST_MONTHLY_TRANCHES.owner).toBe(12);
    expect(WELCOME_VEST_MONTHLY_TRANCHES.gold).toBeUndefined();
  });

  test("queue priority: task portions, then bonus credits, then miles portions (sealed miles, 2026-10-26)", () => {
    expect(EARNING_POOL_QUEUE_ORDER[0]).toBe("points_conversions_task");
    expect(EARNING_POOL_QUEUE_ORDER[1]).toBe("welcome_credits");
    expect(EARNING_POOL_QUEUE_ORDER[2]).toBe("points_conversions_miles");
    expect(EARNING_POOL_QUEUE_ORDER.length).toBe(3);
  });
});

describe("anchorUsdForPoints — block math", () => {
  test("whole blocks price at the anchor", () => {
    expect(anchorUsdForPoints(1000)).toBe(0.25);
    expect(anchorUsdForPoints(10000)).toBe(2.5);
    expect(anchorUsdForPoints(100000)).toBe(25);
    expect(anchorUsdForPoints(15000)).toBe(3.75);
  });

  test("non-block amounts have no anchored value", () => {
    expect(anchorUsdForPoints(1500)).toBeNull();
    expect(anchorUsdForPoints(999)).toBeNull();
    expect(anchorUsdForPoints(1001)).toBeNull();
  });

  test("non-positive / non-integer / non-finite amounts are null", () => {
    expect(anchorUsdForPoints(0)).toBeNull();
    expect(anchorUsdForPoints(-1000)).toBeNull();
    expect(anchorUsdForPoints(1000.5)).toBeNull();
    expect(anchorUsdForPoints(Number.NaN)).toBeNull();
    expect(anchorUsdForPoints(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("tokensForUsd — anchor math at payout prices", () => {
  test("tokens = USD ÷ price at several prices", () => {
    // One block ($0.25) at the sim's price grid.
    expect(tokensForUsd(0.25, 0.001)).toBe(250);
    expect(tokensForUsd(0.25, 0.002)).toBe(125);
    expect(tokensForUsd(0.25, 0.005)).toBe(50);
    expect(tokensForUsd(0.25, 0.01)).toBe(25);
    expect(tokensForUsd(0.25, 0.05)).toBe(5);
    // The 10,000-point minimum conversion is $2.50 of value.
    expect(tokensForUsd(2.5, 0.005)).toBe(500);
    // Welcome credits at a mid price.
    expect(tokensForUsd(1, 0.005)).toBe(200);
    expect(tokensForUsd(5, 0.005)).toBe(1000);
    expect(tokensForUsd(25, 0.005)).toBe(5000);
  });

  test("rounds DOWN to 6 decimals — never above the USD anchor", () => {
    const t = tokensForUsd(1, 0.003);
    expect(t).toBe(333.333333);
    expect(t! * 0.003).toBeLessThanOrEqual(1);
    const t2 = tokensForUsd(0.25, 0.007);
    expect(t2).toBe(35.714285);
    expect(t2! * 0.007).toBeLessThanOrEqual(0.25);
  });

  test("price missing fails closed (null) — never a guessed price", () => {
    expect(tokensForUsd(0.25, null)).toBeNull();
    expect(tokensForUsd(0.25, undefined)).toBeNull();
    expect(tokensForUsd(2.5, null)).toBeNull();
    expect(tokensForUsd(25, null)).toBeNull();
  });

  test("price zero / negative / non-finite fails closed", () => {
    expect(tokensForUsd(0.25, 0)).toBeNull();
    expect(tokensForUsd(0.25, -0.005)).toBeNull();
    expect(tokensForUsd(0.25, Number.NaN)).toBeNull();
    expect(tokensForUsd(0.25, Number.POSITIVE_INFINITY)).toBeNull();
  });

  test("non-positive USD entitlement pays nothing", () => {
    expect(tokensForUsd(0, 0.005)).toBeNull();
    expect(tokensForUsd(-1, 0.005)).toBeNull();
    expect(tokensForUsd(Number.NaN, 0.005)).toBeNull();
  });

  test("an entitlement worth less than 0.000001 tokens is not a payout", () => {
    expect(tokensForUsd(0.25, 1_000_000)).toBeNull();
  });
});

describe("splitVestedCreditUsd — anchored vesting split in cents", () => {
  test("Diamond $5.00: 25% head + 6 tranches summing exactly", () => {
    const { headUsd, tranchesUsd } = splitVestedCreditUsd(5, 6);
    expect(headUsd).toBe(1.25);
    expect(tranchesUsd.length).toBe(6);
    const total = headUsd + tranchesUsd.reduce((s, t) => s + t, 0);
    expect(Math.round(total * 100)).toBe(500);
  });

  test("Fleet $25.00: 25% head + 12 tranches summing exactly", () => {
    const { headUsd, tranchesUsd } = splitVestedCreditUsd(25, 12);
    expect(headUsd).toBe(6.25);
    expect(tranchesUsd.length).toBe(12);
    const total = headUsd + tranchesUsd.reduce((s, t) => s + t, 0);
    expect(Math.round(total * 100)).toBe(2500);
    // Tranches are equal except the last, which absorbs rounding.
    const first = tranchesUsd[0] ?? 0;
    for (const t of tranchesUsd.slice(0, -1)) expect(t).toBe(first);
  });

  test("Gold with 0 tranches is fully liquid", () => {
    const { headUsd, tranchesUsd } = splitVestedCreditUsd(1, 0);
    expect(headUsd).toBe(1);
    expect(tranchesUsd).toEqual([]);
  });

  test("odd cent totals still sum exactly", () => {
    const { headUsd, tranchesUsd } = splitVestedCreditUsd(3.33, 6);
    const total = headUsd + tranchesUsd.reduce((s, t) => s + t, 0);
    expect(Math.round(total * 100)).toBe(333);
    for (const t of [headUsd, ...tranchesUsd]) {
      expect(Math.round(t * 100) / 100).toBe(t);
    }
  });
});
