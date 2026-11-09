// Unit tests for profile header display logic
// (client/src/profileBadges.ts): tier chip styling and badge order.
// Run: bun test client/src/profileBadges.test.ts

import { describe, expect, test } from "bun:test";
import { orderProfileBadges, tierChipFor } from "./profileBadges";

describe("tier chip", () => {
  test("each tier has its own chip label and styling", () => {
    expect(tierChipFor("basic").label).toBe("Basic");
    expect(tierChipFor("gold").label).toContain("Gold");
    expect(tierChipFor("diamond").label).toContain("Diamond");
    expect(tierChipFor("fleet").label).toContain("Fleet");
    const classes = (["basic", "gold", "diamond", "fleet"] as const).map(
      (t) => tierChipFor(t).className,
    );
    expect(new Set(classes).size).toBe(4); // every tier styled distinctly
  });
});

describe("badge order", () => {
  test("no featured badge → today's default order", () => {
    expect(
      orderProfileBadges(["referral", "all_time_best", "season_rank"], null),
    ).toEqual(["season_rank", "all_time_best", "referral"]);
  });
  test("featured badge renders first, the rest keep default order", () => {
    expect(
      orderProfileBadges(["referral", "all_time_best", "season_rank"], "referral"),
    ).toEqual(["referral", "season_rank", "all_time_best"]);
    expect(orderProfileBadges(["all_time_best", "season_rank"], "all_time_best")).toEqual([
      "all_time_best",
      "season_rank",
    ]);
  });
  test("a featured choice outside the earned set changes nothing", () => {
    expect(orderProfileBadges(["season_rank"], "referral")).toEqual(["season_rank"]);
    expect(orderProfileBadges([], "referral")).toEqual([]);
  });
});
