import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
USD_GATE_NOTE,
allPayeesCovered,
canEverFund,
cancelGate,
commitmentCanonicalString,
distributionGate,
drawSeedInput,
drawWinners,
eligibleEntrants,
equalSplit,
formatAmount,
isRecipientCovered,
payoutRecordingGate,
statusAfterPayoutRecord,
validatePerDriverAmounts,
validateRosterSelection,
type RecipientFunding,
type RosterMember,
} from "./ownerGiveaway";

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

describe("roster scoping", () => {
  const rosterA: RosterMember[] = [
    { username: "ownerA", role: "owner" },
    { username: "dispatchA", role: "dispatch" },
    { username: "driver1", role: "driver" },
    { username: "driver2", role: "driver" },
  ];
  // Owner B's roster — driverB belongs to a DIFFERENT company.
  const rosterB: RosterMember[] = [
    { username: "ownerB", role: "owner" },
    { username: "driverB", role: "driver" },
  ];

  test("eligible entrants are drivers only, sorted — owner/dispatch never entrants", () => {
    expect(eligibleEntrants(rosterA)).toEqual(["driver1", "driver2"]);
    expect(eligibleEntrants(rosterB)).toEqual(["driverB"]);
  });

  test("owner A cannot select owner B's driver", () => {
    const v = validateRosterSelection(rosterA, ["driver1", "driverB"]);
    expect(v.ok).toBe(false);
    expect(v.error).toContain("driverB");
    expect(v.error).toContain("not a driver in your company");
  });

  test("the owner and dispatch can never be entrants, even on their own roster", () => {
    expect(validateRosterSelection(rosterA, ["ownerA"]).ok).toBe(false);
    expect(validateRosterSelection(rosterA, ["ownerA"]).error).toContain("never entrants");
    expect(validateRosterSelection(rosterA, ["dispatchA"]).ok).toBe(false);
    expect(validateRosterSelection(rosterA, ["dispatchA"]).error).toContain("never entrants");
  });

  test("own drivers validate; duplicates are refused", () => {
    expect(validateRosterSelection(rosterA, ["driver2", "driver1"]).ok).toBe(true);
    expect(validateRosterSelection(rosterA, ["driver1", "driver1"]).ok).toBe(false);
  });
});

describe("split math exactness", () => {
  test("equal split sums EXACTLY to the pot, including remainder cases", () => {
    // USD 2dp: 100.00 across 3 → 33.34 + 33.33 + 33.33.
    const usd = equalSplit(100, 3, "USD");
    expect(usd).toEqual([33.34, 33.33, 33.33]);
    expect(usd.reduce((s, a) => s + a, 0)).toBeCloseTo(100, 10);
    // Crypto 6dp: 10 USDG across 3.
    const usdg = equalSplit(10, 3, "USDG");
    expect(usdg).toEqual([3.333334, 3.333333, 3.333333]);
    expect(Math.round(usdg.reduce((s, a) => s + a, 0) * 1e6)).toBe(10_000_000);
    // One minor unit across many: the remainder goes to the front, deterministically.
    expect(equalSplit(0.000001, 2, "ETH")).toEqual([0.000001, 0]);
    expect(equalSplit(50, 1, "STONER")).toEqual([50]);
    // A ragged pot across 7 winners still sums exactly in minor units.
    const shares = equalSplit(123.456789, 7, "STONER");
    expect(shares).toHaveLength(7);
    expect(shares.reduce((s, a) => s + Math.round(a * 1e6), 0)).toBe(123_456_789);
  });

  test("per-driver amounts validate cent-exact and name the difference when off", () => {
    expect(validatePerDriverAmounts(100, [60, 40], "USD")).toEqual({
      ok: true,
      sum: 100,
      difference: 0,
    });
    const over = validatePerDriverAmounts(100, [60, 41], "USD");
    expect(over.ok).toBe(false);
    expect(over.difference).toBe(1);
    const under = validatePerDriverAmounts(100, [60, 39.99], "USD");
    expect(under.ok).toBe(false);
    expect(under.difference).toBe(-0.01);
    // 6dp currencies: a one-micro-unit shortfall is caught too.
    const micro = validatePerDriverAmounts(1, [0.5, 0.499999], "USDG");
    expect(micro.ok).toBe(false);
    expect(micro.difference).toBe(-0.000001);
  });

  test("amounts format at currency precision", () => {
    expect(formatAmount(100, "USD")).toBe("100.00");
    expect(formatAmount(10, "USDG")).toBe("10.000000");
    expect(formatAmount(0.5, "ETH")).toBe("0.500000");
  });
});

describe("commitment + draw determinism", () => {
  const facts = {
    companyId: 7,
    entrants: ["carol", "alice", "bob", "dave"],
    potAmount: 250,
    currency: "USDG" as const,
    winnerCount: 2,
    createdAtIso: "2026-10-27T06:00:00.000Z",
  };

  test("commitment recomputation matches — entrant order does not matter, facts do", () => {
    const a = sha256(commitmentCanonicalString(facts));
    const shuffled = sha256(
      commitmentCanonicalString({ ...facts, entrants: ["dave", "bob", "alice", "carol"] }),
    );
    expect(shuffled).toBe(a);
    // Any committed fact changing changes the commitment.
    expect(sha256(commitmentCanonicalString({ ...facts, potAmount: 251 }))).not.toBe(a);
    expect(sha256(commitmentCanonicalString({ ...facts, winnerCount: 3 }))).not.toBe(a);
    expect(
      sha256(commitmentCanonicalString({ ...facts, entrants: ["carol", "alice", "bob"] })),
    ).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test("same seed + entrants → same winners; winners ⊆ entrants, exact count, no duplicates", () => {
    const commitment = sha256(commitmentCanonicalString(facts));
    const seed = sha256(drawSeedInput(commitment, "headhash-abc"));
    const w1 = drawWinners({ entrants: facts.entrants, winnerCount: 2, seedHex: seed });
    const w2 = drawWinners({ entrants: ["bob", "dave", "carol", "alice"], winnerCount: 2, seedHex: seed });
    expect(w1).toEqual(w2);
    expect(w1).toHaveLength(2);
    expect(new Set(w1).size).toBe(2);
    for (const w of w1) expect(facts.entrants).toContain(w);
    // A different chain head at draw time produces a different seed input.
    const otherSeed = sha256(drawSeedInput(commitment, "headhash-xyz"));
    expect(otherSeed).not.toBe(seed);
    // Winner count is clamped to the entrant list.
    expect(drawWinners({ entrants: facts.entrants, winnerCount: 99, seedHex: seed }).sort()).toEqual(
      [...facts.entrants].sort(),
    );
    expect(drawWinners({ entrants: facts.entrants, winnerCount: 0, seedHex: seed })).toEqual([]);
  });

  test("winners share the pot equally and exactly", () => {
    const commitment = sha256(commitmentCanonicalString(facts));
    const seed = sha256(drawSeedInput(commitment, "headhash-abc"));
    const winners = drawWinners({ entrants: facts.entrants, winnerCount: 2, seedHex: seed });
    const shares = equalSplit(facts.potAmount, winners.length, facts.currency);
    expect(shares.reduce((s, a) => s + Math.round(a * 1e6), 0)).toBe(250_000_000);
  });
});

describe("state machine", () => {
  const covered = (amount: number): RecipientFunding => ({
    amount,
    isWinner: true,
    verification: "verified",
    verifiedAmount: amount,
  });
  const uncovered = (amount: number): RecipientFunding => ({
    amount,
    isWinner: true,
    verification: null,
    verifiedAmount: null,
  });

  test("no funded until ALL payees are verified-covered; partial verification stays draft", () => {
    const partial = [covered(50), uncovered(50)];
    expect(allPayeesCovered(partial, "USDG")).toBe(false);
    expect(statusAfterPayoutRecord("draft", partial, "USDG")).toBe("draft");
    const full = [covered(50), covered(50)];
    expect(allPayeesCovered(full, "USDG")).toBe(true);
    expect(statusAfterPayoutRecord("draft", full, "USDG")).toBe("funded");
  });

  test("only 'verified' counts — every other outcome covers nothing", () => {
    for (const outcome of ["not_found", "recipient_mismatch", "unavailable"] as const) {
      const r: RecipientFunding = { amount: 50, isWinner: true, verification: outcome, verifiedAmount: 50 };
      expect(isRecipientCovered(r, "USDG")).toBe(false);
    }
    // Verified but short of the share does not cover it.
    expect(
      isRecipientCovered({ amount: 50, isWinner: true, verification: "verified", verifiedAmount: 49.999999 }, "USDG"),
    ).toBe(false);
    // Verified above the share covers it.
    expect(
      isRecipientCovered({ amount: 50, isWinner: true, verification: "verified", verifiedAmount: 55 }, "USDG"),
    ).toBe(true);
  });

  test("non-winner entrants never block funding in random mode", () => {
    const rows: RecipientFunding[] = [
      covered(100),
      { amount: 0, isWinner: false, verification: null, verifiedAmount: null },
      { amount: 0, isWinner: false, verification: null, verifiedAmount: null },
    ];
    expect(allPayeesCovered(rows, "ETH")).toBe(true);
    // No payees at all (random mode before the draw) can never read as funded.
    expect(
      allPayeesCovered([{ amount: 0, isWinner: false, verification: null, verifiedAmount: null }], "ETH"),
    ).toBe(false);
  });

  test("USD payout recording is refused and USD can never reach funded/distributed", () => {
    const gate = payoutRecordingGate({ currency: "USD", status: "draft" });
    expect(gate.allowed).toBe(false);
    expect(gate.error).toBe(USD_GATE_NOTE);
    expect(gate.error).toContain("Stripe rails");
    expect(canEverFund("USD")).toBe(false);
    expect(canEverFund("USDG")).toBe(true);
    expect(canEverFund("STONER")).toBe(true);
    expect(canEverFund("ETH")).toBe(true);
    // And the distribution gate keeps a draft USD giveaway out of distributed.
    expect(distributionGate("draft").allowed).toBe(false);
  });

  test("cancel only from draft; distribute only from funded", () => {
    expect(cancelGate("draft").allowed).toBe(true);
    expect(cancelGate("funded").allowed).toBe(false);
    expect(cancelGate("distributed").allowed).toBe(false);
    expect(cancelGate("cancelled").allowed).toBe(false);
    expect(distributionGate("funded").allowed).toBe(true);
    expect(distributionGate("draft").allowed).toBe(false);
    expect(distributionGate("distributed").allowed).toBe(false);
    expect(distributionGate("cancelled").allowed).toBe(false);
    // Payout records are refused on closed giveaways, allowed while funding.
    expect(payoutRecordingGate({ currency: "ETH", status: "cancelled" }).allowed).toBe(false);
    expect(payoutRecordingGate({ currency: "ETH", status: "distributed" }).allowed).toBe(false);
    expect(payoutRecordingGate({ currency: "ETH", status: "draft" }).allowed).toBe(true);
    expect(payoutRecordingGate({ currency: "ETH", status: "funded" }).allowed).toBe(true);
  });
});
