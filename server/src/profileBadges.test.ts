// Unit tests for profile tier + featured badge logic
// (server/src/profileBadges.ts). Run: bun test server/src/profileBadges.test.ts

import { describe, expect, test } from "bun:test";
import {
earnedFeaturedBadges,
resolveFeaturedBadge,
tierForPlan,
} from "./profileBadges";

describe("tier derivation per plan (server-side source of truth)", () => {
  test("each recorded plan maps to its display tier", () => {
    expect(tierForPlan("basic")).toBe("basic");
    expect(tierForPlan("gold")).toBe("gold");
    expect(tierForPlan("diamond")).toBe("diamond");
    expect(tierForPlan("owner")).toBe("fleet"); // the Owner plan is the fleet plan
  });
  test("legacy plan values normalize like the rest of the app", () => {
    expect(tierForPlan("simple")).toBe("basic");
    expect(tierForPlan("full")).toBe("diamond");
  });
  test("no profile row yet reads as the app default (diamond)", () => {
    expect(tierForPlan(null)).toBe("diamond");
    expect(tierForPlan(undefined)).toBe("diamond");
  });
});

describe("earned set — only badges that exist today", () => {
  test("referral badge requires Dispatcher or above (Spotter has none)", () => {
    expect(
      earnedFeaturedBadges({ referralLevelKey: "spotter", allTimeBest: null, overallRank: null }),
    ).toEqual([]);
    for (const key of ["dispatcher", "fleet_builder", "road_captain"]) {
      expect(
        earnedFeaturedBadges({ referralLevelKey: key, allTimeBest: null, overallRank: null }),
      ).toEqual(["referral"]);
    }
  });
  test("all-time best and season rank join the set from real records", () => {
    expect(
      earnedFeaturedBadges({
        referralLevelKey: "spotter",
        allTimeBest: { rank: "Gold", seasonNumber: 2 },
        overallRank: "Silver",
      }),
    ).toEqual(["all_time_best", "season_rank"]);
  });
});

describe("featured-badge validation", () => {
  test("an earned choice is kept", () => {
    expect(resolveFeaturedBadge("referral", ["referral", "season_rank"])).toBe("referral");
    expect(resolveFeaturedBadge("season_rank", ["referral", "season_rank"])).toBe("season_rank");
  });
  test("an UNEARNED choice is rejected — a driver cannot feature a badge they don't hold", () => {
    expect(resolveFeaturedBadge("referral", [])).toBe(null);
    expect(resolveFeaturedBadge("all_time_best", ["referral"])).toBe(null);
    expect(resolveFeaturedBadge("season_rank", ["all_time_best"])).toBe(null);
  });
  test("stale / invalid / absent choices fall back to default order silently", () => {
    expect(resolveFeaturedBadge("road_captain", ["referral"])).toBe(null); // not a badge key
    expect(resolveFeaturedBadge("bogus", ["referral", "all_time_best", "season_rank"])).toBe(null);
    expect(resolveFeaturedBadge(null, ["referral"])).toBe(null);
    expect(resolveFeaturedBadge(undefined, ["referral"])).toBe(null);
  });
  test("a once-earned badge whose record is gone falls back, never displays unearned", () => {
    // Stored "all_time_best" from an earlier season; the current
    // earned set (recomputed from records) no longer contains it.
    expect(resolveFeaturedBadge("all_time_best", ["referral"])).toBe(null);
  });
});
