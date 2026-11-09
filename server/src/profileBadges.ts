// Profile display: subscription tier chip + featured badge — pure
// logic (see profileBadges.test.ts). actions.ts owns the DB reads.
//
// TIER: derived SERVER-SIDE from the account's recorded plan (the
// myPlan source of truth — never client-supplied, never stored on
// the social profile). Plan → tier: basic → Basic, gold → Gold,
// diamond → Diamond, owner → Fleet (the Owner plan is the fleet
// plan). Legacy plan values normalize exactly like normalizePlan in
// actions.ts (simple → basic, full → diamond; unknown → diamond,
// the app's standing default).
//
// FEATURED BADGE: the driver may feature ONE badge they have
// actually earned. The earned set is what exists today:
//   referral    — referral badge (level ≥ Dispatcher; Spotter has none)
//   all_time_best — an all-time-best season rank on record
//   season_rank   — a current-season rank highlight on record
// The stored choice (social_users.featured_badge) is validated
// against the earned set on BOTH write and read: an unearned or
// stale choice resolves to null and the profile falls back to the
// default display order — silently, never an error, never a badge
// the driver didn't earn.

export type ProfileTier = "basic" | "gold" | "diamond" | "fleet";

export const PROFILE_TIER_LABELS: Record<ProfileTier, string> = {
  basic: "Basic",
  gold: "Gold",
  diamond: "Diamond",
  fleet: "Fleet",
};

/** The account's subscription tier from its recorded plan. */
export function tierForPlan(plan: string | null | undefined): ProfileTier {
  switch (plan) {
    case "basic":
    case "simple":
      return "basic";
    case "gold":
      return "gold";
    case "owner":
      return "fleet";
    case "diamond":
    case "full":
    default:
      return "diamond";
  }
}

export type FeaturedBadgeKey = "referral" | "all_time_best" | "season_rank";

export const FEATURED_BADGE_KEYS: readonly FeaturedBadgeKey[] = [
  "referral",
  "all_time_best",
  "season_rank",
] as const;

export function isFeaturedBadgeKey(v: unknown): v is FeaturedBadgeKey {
  return v === "referral" || v === "all_time_best" || v === "season_rank";
}

/** The badges this driver has actually earned, from their real
 *  records: referral level key (badge exists at Dispatcher and up),
 *  an all-time-best rank, and a current-season rank. */
export function earnedFeaturedBadges(args: {
  referralLevelKey: string;
  allTimeBest: { rank: string; seasonNumber: number } | null;
  overallRank: string | null;
}): FeaturedBadgeKey[] {
  const earned: FeaturedBadgeKey[] = [];
  if (
    args.referralLevelKey === "dispatcher" ||
    args.referralLevelKey === "fleet_builder" ||
    args.referralLevelKey === "road_captain"
  ) {
    earned.push("referral");
  }
  if (args.allTimeBest != null) earned.push("all_time_best");
  if (args.overallRank != null) earned.push("season_rank");
  return earned;
}

/** Validate a stored/requested featured choice against the earned
 *  set. Returns the choice when earned, else null (default order). */
export function resolveFeaturedBadge(
  choice: string | null | undefined,
  earned: readonly FeaturedBadgeKey[],
): FeaturedBadgeKey | null {
  if (!isFeaturedBadgeKey(choice)) return null;
  return earned.includes(choice) ? choice : null;
}
