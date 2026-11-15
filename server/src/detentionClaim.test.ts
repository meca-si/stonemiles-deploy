// detentionClaim.test.ts — unit pins for the detention
// collection pack (Research Wave 2 item 5): the amount honesty
// rule (priced ONLY from the driver's recorded terms, labelled
// as such; no terms → time facts with a blank amount), the claim
// lifecycle transitions, and the per-facility stats (facts with
// the sample size; no score below 3 visits). Flow behavior lives
// in detentionClaimFlow.test.ts.
//
// Run: bun test server/src/detentionClaim.test.ts
import { describe, expect, test } from "bun:test";
import {
  canDetentionClaimMove,
  detentionClaimPack,
  facilityDetentionStats,
  facilityKeyOf,
  type DetentionClaimInput,
} from "./detentionClaim";

// A 4.5 h visit with 2 h of free time: 150 min beyond free time.
const BASE: DetentionClaimInput = {
  place: "Test Facility — Dallas, TX",
  site: "delivery",
  apptAtIso: "2026-11-10T13:00:00.000Z",
  arrivedAtIso: "2026-11-10T13:00:00.000Z",
  departedAtIso: "2026-11-10T17:30:00.000Z",
  graceMinutes: 120,
  arriveLat: 32.7767,
  arriveLon: -96.797,
  departLat: 32.7768,
  departLon: -96.7971,
  chainHash: "seal-abc",
  load: {
    reference: "REF-1042",
    originLabel: "Fort Worth, TX",
    destinationLabel: "Dallas, TX",
    brokerName: "Sam Broker",
    brokerCompany: "Broker Co",
    brokerMc: "MC123456",
  },
  detentionRatePerHour: null,
  facility: null,
};

describe("detentionClaimPack — amount honesty", () => {
  test("with recorded terms the pack prices from them and labels them", () => {
    const pack = detentionClaimPack({ ...BASE, detentionRatePerHour: 65 });
    // 150 min beyond free time = 2.5 h × $65 = $162.50.
    expect(pack.facts.totalMinutes).toBe(270);
    expect(pack.facts.billableMinutes).toBe(150);
    expect(pack.amountCents).toBe(16250);
    expect(pack.text).toContain("$162.50");
    expect(pack.text).toContain("driver's recorded terms");
    expect(pack.text).toContain("Test Facility — Dallas, TX");
    expect(pack.text).toContain("REF-1042");
    expect(pack.text).toContain("32.77670, -96.79700");
    expect(pack.text).toContain("Record seal: seal-abc");
  });

  test("with NO terms the pack prints time facts and a blank amount — never an invented rate", () => {
    const pack = detentionClaimPack(BASE);
    expect(pack.amountCents).toBeNull();
    expect(pack.amountLabel).toBeNull();
    expect(pack.text).toContain("Detention claimed: __________");
    expect(pack.text).toContain("no detention terms recorded on this load");
    expect(pack.text).not.toContain("driver's recorded terms");
    // No dollar figure anywhere on the no-terms pack.
    expect(pack.text).not.toMatch(/\$\d/);
    // The time facts still print in full.
    expect(pack.text).toContain("Total time at facility: 4 h 30 min");
    expect(pack.text).toContain("Time beyond free time: 2 h 30 min");
  });

  test("a visit inside free time claims zero — honestly", () => {
    const pack = detentionClaimPack({
      ...BASE,
      departedAtIso: "2026-11-10T14:00:00.000Z",
      detentionRatePerHour: 65,
    });
    expect(pack.facts.billableMinutes).toBe(0);
    expect(pack.amountCents).toBe(0);
    expect(pack.text).toContain("$0.00");
  });

  test("the facility history line prints only at 3+ visits", () => {
    const stat = {
      placeKey: "x",
      placeLabel: "X",
      visits: 3,
      detainedCount: 2,
      avgBillableMinutes: 90,
      totalBillableMinutes: 270,
      lastVisitAtIso: "2026-11-10T17:30:00.000Z",
      scoreEligible: true,
    };
    const withHistory = detentionClaimPack({ ...BASE, facility: stat });
    expect(withHistory.text).toContain("held past free time on 2 of them");
    const thin = detentionClaimPack({ ...BASE, facility: { ...stat, visits: 2, scoreEligible: false } });
    expect(thin.text).not.toContain("in your sealed records");
  });
});

describe("claim lifecycle transitions", () => {
  test("the legal path walks in order", () => {
    expect(canDetentionClaimMove("none", "generated")).toBe(true);
    expect(canDetentionClaimMove("generated", "sent")).toBe(true);
    expect(canDetentionClaimMove("sent", "acknowledged")).toBe(true);
    expect(canDetentionClaimMove("sent", "paid")).toBe(true);
    expect(canDetentionClaimMove("sent", "disputed")).toBe(true);
    expect(canDetentionClaimMove("acknowledged", "paid")).toBe(true);
    expect(canDetentionClaimMove("disputed", "paid")).toBe(true);
  });

  test("skips and backwards moves are refused", () => {
    expect(canDetentionClaimMove("none", "sent")).toBe(false);
    expect(canDetentionClaimMove("generated", "paid")).toBe(false);
    expect(canDetentionClaimMove("paid", "disputed")).toBe(false);
    expect(canDetentionClaimMove("sent", "generated")).toBe(false);
    expect(canDetentionClaimMove("none", "acknowledged")).toBe(false);
  });
});

describe("facilityDetentionStats — sealed facts, sample size attached", () => {
  const visit = (placeLabel: string, arrived: string, departed: string, grace = 120) => ({
    placeKey: facilityKeyOf(placeLabel),
    placeLabel,
    arrivedAtIso: arrived,
    departedAtIso: departed,
    graceMinutes: grace,
  });

  test("keys normalize case and spacing", () => {
    expect(facilityKeyOf("Dallas,  TX")).toBe(facilityKeyOf("dallas, tx"));
  });

  test("two visits: facts print, no score eligibility", () => {
    const stats = facilityDetentionStats([
      visit("Dallas, TX", "2026-11-01T10:00:00.000Z", "2026-11-01T14:00:00.000Z"), // 120 billable
      visit("dallas, tx", "2026-11-05T10:00:00.000Z", "2026-11-05T11:00:00.000Z"), // 0 billable
    ]);
    expect(stats).toHaveLength(1);
    expect(stats[0]?.visits).toBe(2);
    expect(stats[0]?.detainedCount).toBe(1);
    expect(stats[0]?.avgBillableMinutes).toBe(60);
    expect(stats[0]?.scoreEligible).toBe(false);
  });

  test("three visits: score eligible, totals add up", () => {
    const stats = facilityDetentionStats([
      visit("Dallas, TX", "2026-11-01T10:00:00.000Z", "2026-11-01T14:00:00.000Z"), // 120
      visit("Dallas, TX", "2026-11-05T10:00:00.000Z", "2026-11-05T13:00:00.000Z"), // 60
      visit("Dallas, TX", "2026-11-09T10:00:00.000Z", "2026-11-09T15:00:00.000Z"), // 180
      visit("Other, OK", "2026-11-09T10:00:00.000Z", "2026-11-09T11:00:00.000Z"), // separate facility
    ]);
    expect(stats).toHaveLength(2);
    const dallas = stats.find((s) => s.placeLabel === "Dallas, TX")!;
    expect(dallas.visits).toBe(3);
    expect(dallas.detainedCount).toBe(3);
    expect(dallas.totalBillableMinutes).toBe(360);
    expect(dallas.avgBillableMinutes).toBe(120);
    expect(dallas.scoreEligible).toBe(true);
    expect(dallas.lastVisitAtIso).toBe("2026-11-09T15:00:00.000Z");
  });
});
