// workspaces.ts — the Ten Workspaces (x's orders, 2026-11-15: the
// app calls its areas WORKSPACES, matching the marketing — the Reel
// shipped the headline five, then x ordered every feature area that
// stands on its own to get a door: "Add all features that need
// workspaces"). A NAMING + GROUPING pass only: every tool below
// already exists; this file names the ten homes, the one primary
// landing each Today-tab door opens, and the grouping — every other
// feature belongs to exactly one workspace, listed in its `tools`.
//
// Each door lands through a destination id the jump machinery already
// performs — the same Meca destinations Ask Meca's "Take me there"
// uses, or a top-level tab — so a workspace has one name and one
// landing everywhere, exactly like the tool directory. Door copy is
// the Reel card's wording where the Reel named it, and the same
// pattern for the five added doors: name + tagline, English source +
// Spanish pair routed through the app's tr() engine.

export interface WorkspaceDoor {
  id: "loads" | "drive" | "planner" | "fuel" | "pay" | "records" | "truck" | "schedule" | "team" | "rewards";
  icon: string;
  /** Display name — one word, all caps, same in every language. */
  name: string;
  /** Tagline (English source + Spanish pair). */
  tagEn: string;
  tagEs: string;
  /** The features grouped under this workspace — every feature in
   *  the app belongs to exactly one workspace. Data only: the door
   *  strip renders name + tagline; this list is the grouping record
   *  the contract test pins. */
  tools: string[];
  /** Where the door lands. `dest` names a Meca destination id App's
   *  goMecaDest already performs (the literal union in App is wider
   *  than ToolDestId — the calendar tab lives there); `tab` names a
   *  top-level tab the door opens directly. Exactly one is set. */
  dest?: string;
  tab?: "calendar";
}

export const WORKSPACES: WorkspaceDoor[] = [
  {
    id: "loads",
    icon: "📦",
    name: "LOADS",
    tagEn: "find it, book it, haul it",
    tagEs: "encuéntrala, resérvala, llévala",
    tools: ["Loadboard", "Suggested next load", "My loads", "Sealed load tracker", "Broker send door", "Broker desk", "Load paperwork"],
    // The Loads tab's own home — the active load and the load list.
    dest: "loads",
  },
  {
    id: "drive",
    icon: "🧭",
    name: "DRIVE",
    tagEn: "truck GPS, cab mode, hours clock",
    tagEs: "GPS del camión, modo cabina, reloj de horas",
    tools: ["Truck GPS routing", "Cab mode", "HOS status + hours clock", "DVIR", "Dashcam", "Road alerts", "Route weather while driving"],
    // The Drive tab — the live map / GPS home. The tab's panels live
    // in a sheet that starts closed, so the door's reveal also opens
    // the sheet (the "drive-panel" opener in App) — the eyebrow is
    // the sheet's first line.
    dest: "drive",
  },
  {
    id: "planner",
    icon: "🗺️",
    name: "PLANNER",
    tagEn: "plan the run: routes, parking, stops",
    tagEs: "planifica el viaje: rutas, estacionamiento, paradas",
    tools: ["Route planning", "Parking ahead", "Stops ahead", "Detention planning"],
    // The route planner (the Routes tab) — planning ahead, distinct
    // from Drive's live map.
    dest: "routes",
  },
  {
    id: "fuel",
    icon: "⛽",
    name: "FUEL",
    tagEn: "cheapest stops, true cost",
    tagEs: "paradas más baratas, costo real",
    tools: ["Fuel optimizer", "Cheapest stops", "Fuel log", "IFTA", "Fuel-card checks"],
    // The IFTA + fuel-log home on the Driver tab — the Fuel
    // workspace's labelled home (the net-price planner lives on the
    // Drive tab's route, the fuel-card checks inside this section).
    // The door's reveal opens the Driver-tab row AND the IFTA
    // Complete section inside it — the eyebrow is that section's
    // first line.
    dest: "ifta",
  },
  {
    id: "pay",
    icon: "💵",
    name: "PAY",
    tagEn: "earned, owed, checked",
    tagEs: "ganado, debido, verificado",
    tools: ["Pay Book", "Money overview", "My Settlement", "Settlement check", "Invoices", "Profit & loss", "Factoring"],
    // The Pay Book — the Pay workspace's front door on the Money tab
    // (Money overview, My Settlement and the settlement check share
    // the same Pay section).
    dest: "pay_book",
  },
  {
    id: "records",
    icon: "📁",
    name: "RECORDS",
    tagEn: "paperwork, sealed + proven",
    tagEs: "papeleo, sellado y probado",
    tools: ["Paperwork capture (BOL)", "Paperwork-to-pay status", "Sealed records + hash chain", "Records export", "DQF manager", "Credential wallet + alerts"],
    // The Library — every record in one home, on the Driver tab.
    dest: "library",
  },
  {
    id: "truck",
    icon: "🚛",
    name: "TRUCK",
    tagEn: "your rig, kept ready",
    tagEs: "tu camión, siempre listo",
    tools: ["My Truck", "Maintenance", "Predictive maintenance", "Inspections", "Smart trailer", "Truck + trailer photos"],
    // The Money tab's Truck section (maintenance countdown + log) —
    // the truck's working home; the reveal machinery switches the
    // Money section to Truck for this anchor. My Truck identity
    // itself lives in Settings → Truck and groups here.
    dest: "maintenance",
  },
  {
    id: "schedule",
    icon: "📅",
    name: "SCHEDULE",
    tagEn: "calendar + home time",
    tagEs: "calendario + tiempo en casa",
    tools: ["Driver Calendar", "Home time"],
    // The Driver Calendar — its own top-level tab.
    tab: "calendar",
  },
  {
    id: "team",
    icon: "👥",
    name: "TEAM",
    tagEn: "messages, fleet + shares",
    tagEs: "mensajes, flota y compartidos",
    tools: ["Inbox + broker messages", "Fleet board", "Tracking shares", "Team seats"],
    // The fleet load board — the team's shared surface on the
    // Loads tab (board view).
    dest: "fleet_board",
  },
  {
    id: "rewards",
    icon: "🏆",
    name: "REWARDS",
    tagEn: "points for the work",
    tagEs: "puntos por el trabajo",
    tools: ["SM Points", "How to earn points (Lanes 1–3 + Layer 2)", "Wallet + $STONER panel"],
    // The points lanes / how-to-earn home on the Driver tab (the
    // in-app wallet / $STONER panel groups here — points convert
    // there). The block lives in the hub's Rewards category; the
    // reveal machinery switches the category before the scroll.
    dest: "points_lanes",
  },
];
