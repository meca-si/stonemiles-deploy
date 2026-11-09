// Profile header display — pure logic (see profileBadges.test.ts).
// The server derives the tier and validates the featured badge
// (server/src/profileBadges.ts); this module only decides how the
// header renders what the payload carries: the tier chip's style and
// the badge-row order (featured first, the rest in today's order).

export type ProfileTier = "basic" | "gold" | "diamond" | "fleet";
export type FeaturedBadgeKey = "referral" | "all_time_best" | "season_rank";

/** Tier chip presentation per tier: Diamond distinct, Gold gold,
 *  Fleet its own fleet styling, Basic plain. Display only — no
 *  price, no internal numbers. */
export function tierChipFor(
  tier: ProfileTier,
): { label: string; className: string } {
  switch (tier) {
    case "diamond":
      return {
        label: "💎 Diamond",
        className: "bg-cyan-900/70 text-cyan-100 border border-cyan-400",
      };
    case "gold":
      return {
        label: "🥇 Gold",
        className: "bg-yellow-900/60 text-yellow-200 border border-yellow-500",
      };
    case "fleet":
      return {
        label: "🚛 Fleet",
        className: "bg-violet-900/70 text-violet-100 border border-violet-500",
      };
    case "basic":
    default:
      return {
        label: "Basic",
        className: "bg-[var(--surface2)] text-[var(--dim)] border border-[var(--border)]",
      };
  }
}

/** Today's badge-row order when nothing is featured. */
export const DEFAULT_BADGE_ORDER: readonly FeaturedBadgeKey[] = [
  "season_rank",
  "all_time_best",
  "referral",
] as const;

/** Order the earned badges for the header row: the featured badge
 *  first (rendered prominent), the rest in the default order. An
 *  unearned/absent featured choice changes nothing. */
export function orderProfileBadges(
  earned: readonly FeaturedBadgeKey[],
  featured: FeaturedBadgeKey | null,
): FeaturedBadgeKey[] {
  const inDefaultOrder = DEFAULT_BADGE_ORDER.filter((k) => earned.includes(k));
  if (featured && earned.includes(featured)) {
    return [featured, ...inDefaultOrder.filter((k) => k !== featured)];
  }
  return inDefaultOrder;
}
