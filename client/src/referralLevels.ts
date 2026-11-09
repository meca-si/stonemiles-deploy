// Referral level badges (locked 2026-10-25): every level ABOVE Spotter
// carries its OWN distinct badge — Dispatcher at 5 active referrals,
// Fleet Builder at 15, Road Captain at 40. Spotter is the entry level
// and carries NO badge; the first badge is the first real rung.
// Returns null for Spotter (and anything unknown).
export function referralBadgeFor(
  levelKey: string,
): { emoji: string; label: string; className: string } | null {
  switch (levelKey) {
    case "dispatcher":
      return { emoji: "🎧", label: "Dispatcher", className: "bg-sky-900/70 text-sky-100 border border-sky-700" };
    case "fleet_builder":
      return { emoji: "🏗️", label: "Fleet Builder", className: "bg-emerald-900/70 text-emerald-100 border border-emerald-700" };
    case "road_captain":
      return { emoji: "👑", label: "Road Captain", className: "bg-[var(--accent)] text-black border border-[var(--accent)]" };
    default:
      return null; // Spotter — no badge
  }
}
