// workspaces.ts — the Five Workspaces (x's order, 2026-11-15: the
// app calls its five areas WORKSPACES, matching the marketing —
// "FIVE WORKSPACES. ONE APP."). A NAMING + GROUPING pass only: every
// tool below already exists; this file just names the five homes and
// the one primary landing each Today-tab door opens.
//
// Each door lands through a destination id the jump machinery already
// performs — Meca destinations Ask Meca's "Take me there" uses, or a
// top-level tab — so a workspace has one name and one landing
// everywhere, exactly like the tool directory. Door copy is the
// Reel card's wording, verbatim: name + tagline, English source +
// Spanish pair routed through the app's tr() engine.

export interface WorkspaceDoor {
  id: "pay" | "fuel" | "planner" | "schedule" | "rewards";
  icon: string;
  /** Display name — one word, all caps, same in every language. */
  name: string;
  /** The Reel card's tagline (English source + Spanish pair). */
  tagEn: string;
  tagEs: string;
  /** Where the door lands. `dest` names a Meca destination id App's
   *  goMecaDest already performs (the literal union in App is wider
   *  than ToolDestId — the calendar tab lives there); `tab` names a
   *  top-level tab the door opens directly. Exactly one is set. */
  dest?: string;
  tab?: "calendar";
}

export const WORKSPACES: WorkspaceDoor[] = [
  {
    id: "pay",
    icon: "💵",
    name: "PAY",
    tagEn: "earned, owed, checked",
    tagEs: "ganado, debido, verificado",
    // The Pay Book — the Pay workspace's front door on the Money tab
    // (Money overview, My Settlement and the settlement check share
    // the same Pay section).
    dest: "pay_book",
  },
  {
    id: "fuel",
    icon: "⛽",
    name: "FUEL",
    tagEn: "cheapest stops, true cost",
    tagEs: "paradas más baratas, costo real",
    // The IFTA + fuel-log home on the Driver tab — the Fuel
    // workspace's labelled home (the net-price planner lives on the
    // Drive tab's route, the fuel-card checks inside this section).
    dest: "ifta",
  },
  {
    id: "planner",
    icon: "🗺️",
    name: "PLANNER",
    tagEn: "routes + next load",
    tagEs: "rutas + próxima carga",
    // The route planner on the Drive tab.
    dest: "routes",
  },
  {
    id: "schedule",
    icon: "📅",
    name: "SCHEDULE",
    tagEn: "calendar + home time",
    tagEs: "calendario + tiempo en casa",
    // The Driver Calendar — its own top-level tab.
    tab: "calendar",
  },
  {
    id: "rewards",
    icon: "🏆",
    name: "REWARDS",
    tagEn: "points for the work",
    tagEs: "puntos por el trabajo",
    // The points lanes / how-to-earn home on the Driver tab.
    dest: "points_lanes",
  },
];
