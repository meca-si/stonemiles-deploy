// Android Auto / Cab Mode — the glanceable cab display model.
//
// What this is: STONEMILES' car surface. Android Auto apps are built
// from a small set of driver-distraction-safe templates (Google's Car
// App Library): a Navigation template for live guidance, a Place List
// template for stops, and a Pane/Message template for alerts. This
// module is the ONE model those templates bind to — the in-app car
// display renders it today, and the native Android Auto build that
// ships with the Play Store release renders the same fields through
// the Car App Library. Nothing here invents data: every field comes
// from the live drive state (GPS speed, the route's own maneuvers,
// the app's HOS planning clocks) and reads as absent — never guessed —
// when its source has nothing.
//
// Distraction rules baked into the model (the same rules Google's
// Android Auto review enforces): at most four glance tiles, one next
// maneuver, no lists while rolling beyond the first few stops, and
// urgency is a threshold fact (overspeed past the driver's own warn
// setting, turn inside half a mile, drive clock under 30 minutes),
// never decoration.

import { displayedSpeedMph } from "./driveScreen";

export interface CarReadoutInput {
  /** Live GPS speed, mph. Null when there is no fix. */
  speedMph: number | null;
  /** Posted/estimated limit for the current road, mph. Null = unknown. */
  speedLimitMph: number | null;
  /** The driver's own overspeed warn threshold (Settings → Driving). */
  overspeedThresholdMph: number;
  /** Guidance is live on a selected route. */
  guidanceActive: boolean;
  /** Arrived at the destination. */
  arrived: boolean;
  /** Next maneuver's direction arrow (from the routing data). */
  arrow: string | null;
  /** Next maneuver's instruction, from the routing response. */
  instruction: string | null;
  /** Road the maneuver turns onto, when the routing data names one. */
  street: string | null;
  /** Miles to the next maneuver. */
  distToTurnMi: number | null;
  /** Pre-formatted arrival clock ("4:32 PM"), from the live ETA. */
  etaText: string | null;
  /** Pre-formatted time remaining ("2 h 14 min"). */
  timeLeftText: string | null;
  /** Miles remaining on the route. */
  milesLeft: number | null;
  /** Destination label the driver set. Null when none. */
  destinationLabel: string | null;
  /** Drive hours remaining on the app's planning clock. Null = no HOS data. */
  hosDriveLeftH: number | null;
  /** Whether the driver wants the HOS tile on the cab display. */
  showHos: boolean;
  /** Hill grade alert from the app's grade engine (hillGrade.ts) —
   *  the app stays the single source of truth; the head unit mirrors
   *  it. Null when no grade is near or the route carries no stored
   *  elevation. A safety warning: it rides the Guidance screen for
   *  EVERY tier (Basic included) — never paywalled. */
  gradeAlert?: { headline: string; detail: string | null; urgent: boolean } | null;
  /** Construction-ahead alert from the app's work-zone layer
   *  (workZone.ts) — same mirroring law as the grade alert: the app
   *  computes it, the head unit shows it, in big type on the
   *  Guidance screen for EVERY tier. The headline carries the
   *  source ("Construction reported ahead" / "DOT construction
   *  ahead") so the mirror never blurs driver truth and DOT truth. */
  constructionAlert?: { headline: string; detail: string | null } | null;
  /** The five-alert-systems mirror (migration 0107): the single
   *  highest-priority call among runaway ramp / sharp curve /
   *  railroad crossing / driver hazard / severe-weather-winter,
   *  picked by the APP (the source of truth) — the head unit shows
   *  exactly what the phone computed, icon included. A safety
   *  warning: every tier, like the grade alert above. */
  safetyAlert?: { headline: string; detail: string | null; urgent: boolean; icon: string } | null;
}

export type CarTileId = "speed" | "eta" | "miles" | "hos";

export interface CarTile {
  id: CarTileId;
  /** Small caps label over the value. */
  label: string;
  /** The big glanceable value. */
  value: string;
  /** Secondary line under the value, when there is one. */
  sub: string | null;
  /** True when a real threshold is crossed — the tile turns urgent. */
  urgent: boolean;
}

export interface CarReadout {
  /** Hill grade alert mirrored from the phone's grade engine, or
   *  null. Rendered on the Guidance screen in big glanceable type. */
  gradeAlert: { headline: string; detail: string | null; urgent: boolean } | null;
  /** Construction-ahead alert mirrored from the phone's work-zone
   *  layer, or null. Rendered on the Guidance screen under the grade
   *  banner slot in big glanceable type. */
  constructionAlert: { headline: string; detail: string | null } | null;
  /** The five-alert-systems safety call (migration 0107) mirrored
   *  from the phone — ramp / curve / crossing / hazard / winter
   *  weather, whichever the app ranked first — or null. */
  safetyAlert: { headline: string; detail: string | null; urgent: boolean; icon: string } | null;
  /** The next maneuver block, or null when guidance isn't live. */
  turn: {
    arrow: string;
    instruction: string;
    street: string | null;
    /** Formatted distance to the maneuver ("0.4 mi" / "800 ft"). */
    distanceText: string;
    /** Inside half a mile — the maneuver is imminent. */
    imminent: boolean;
    arrived: boolean;
  } | null;
  tiles: CarTile[];
}

/** Distance to a maneuver, the way a driver reads it at a glance:
 *  feet under a tenth of a mile, one decimal under 10, whole above. */
export function formatTurnDistance(mi: number): string {
  if (!Number.isFinite(mi) || mi < 0) return "—";
  if (mi < 0.1) return `${Math.max(0, Math.round((mi * 5280) / 50) * 50)} ft`;
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi)} mi`;
}

/** Drive-clock hours as "7 h 20 m" / "42 m" — never negative. */
export function formatHosLeft(hours: number): string {
  const totalMin = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m} m`;
  return `${h} h ${String(m).padStart(2, "0")} m`;
}

export function carReadout(input: CarReadoutInput): CarReadout {
  const turn =
    input.guidanceActive && input.instruction
      ? {
          arrow: input.arrow ?? "⬆",
          instruction: input.instruction,
          street: input.street,
          distanceText: input.distToTurnMi != null ? formatTurnDistance(input.distToTurnMi) : "—",
          imminent: input.distToTurnMi != null && input.distToTurnMi <= 0.5,
          arrived: input.arrived,
        }
      : null;

  const tiles: CarTile[] = [];

  const overspeed =
    input.speedMph != null &&
    input.speedLimitMph != null &&
    input.speedMph > input.speedLimitMph + input.overspeedThresholdMph;
  tiles.push({
    id: "speed",
    label: "Speed",
    // The tile SHOWS the driver's dash-matched readout (GPS + 3 —
    // driveScreen.ts, x's order 2026-11-09, mirroring the phone);
    // the overspeed flag above keeps the TRUE speed.
    value: input.speedMph != null ? `${Math.round(displayedSpeedMph(input.speedMph))}` : "––",
    sub: input.speedLimitMph != null ? `mph · limit ${Math.round(input.speedLimitMph)}` : "mph",
    urgent: overspeed,
  });

  if (input.guidanceActive) {
    tiles.push({
      id: "eta",
      label: "Arrive",
      value: input.etaText ?? "––",
      sub: input.timeLeftText ? `${input.timeLeftText} left` : null,
      urgent: false,
    });
    tiles.push({
      id: "miles",
      label: "To go",
      value: input.milesLeft != null ? formatTurnDistance(input.milesLeft) : "––",
      sub: input.destinationLabel,
      urgent: false,
    });
  }

  if (input.showHos && input.hosDriveLeftH != null) {
    tiles.push({
      id: "hos",
      label: "Drive left",
      value: formatHosLeft(input.hosDriveLeftH),
      sub: "of 11 h",
      urgent: input.hosDriveLeftH < 0.5,
    });
  }

  // The distraction rule: never more than four glance tiles.
  return {
    gradeAlert: input.gradeAlert ?? null,
    constructionAlert: input.constructionAlert ?? null,
    safetyAlert: input.safetyAlert ?? null,
    turn,
    tiles: tiles.slice(0, 4),
  };
}

/** Auto-launch rule: the cab display opens itself only when the driver
 *  turned Cab Mode on AND left auto-launch on AND guidance is live.
 *  A display the driver closed by hand stays closed for that stretch —
 *  the caller passes `dismissed` once the driver exits mid-route. */
export function shouldAutoOpenCarDisplay(args: {
  enabled: boolean;
  autoLaunch: boolean;
  guidanceActive: boolean;
  dismissed: boolean;
}): boolean {
  return args.enabled && args.autoLaunch && args.guidanceActive && !args.dismissed;
}

// ---------------------------------------------------------------------------
// The Android Auto template bindings — the exact screens the native
// Car App Library build renders, and the STONEMILES fields each one
// binds. The in-app cab display (CarModePanel.tsx) previews these
// same templates so what the driver sees on the phone today is what
// the head unit shows when the Play build ships.
// ---------------------------------------------------------------------------

export interface CarTemplateBinding {
  id: "navigation" | "places" | "alert";
  /** The Car App Library template the native build uses. */
  template: string;
  /** What the driver sees it as. */
  title: string;
  /** The live fields it binds, in display order. */
  binds: string[];
}

export const CAR_TEMPLATES: readonly CarTemplateBinding[] = [
  {
    id: "navigation",
    template: "NavigationTemplate",
    title: "Guidance",
    binds: ["Next turn arrow + instruction", "Distance to the turn", "Current speed + posted limit", "ETA · time left · miles to go", "Drive clock remaining (HOS)"],
  },
  {
    id: "places",
    template: "PlaceListMapTemplate",
    title: "Stops ahead",
    binds: ["Truck stops on your corridor", "Parking status from driver reports", "Fuel · showers · scales from map data", "One tap starts guidance to the stop"],
  },
  {
    id: "alert",
    template: "MessageTemplate",
    title: "Road alerts",
    binds: ["Weigh station open / closed ahead", "Hazard reports from drivers", "Weather advisories on your route", "HOS break warnings before the clock runs out"],
  },
];

// ---------------------------------------------------------------------------
// The head unit — the full three-screen surface (2026-11-07, x's order:
// "Let build head unit"). The CarDisplay is one screen (Guidance). The
// head unit is all three Android Auto templates as working screens,
// bound to the truck's live state:
//
// ARCHITECTURE LAW (x, 2026-11-07): "Keep the app the main source and
// the head unit a tool of the app." The app is the single source of
// truth — state, settings, tiers, records, the sealed chain all live
// in the app/account. The head unit is a display-and-control surface
// OF the app: it renders these models from app state, holds nothing
// authoritative of its own (its only local state is which screen is
// showing), has no head-unit-only features or data, and a disconnect
// loses nothing — nothing strands on the dash. No standalone head-unit
// logic may drift from the app; anything a native template keeps
// locally is a live mirror of app state only.
//
// AUDIENCE (x, 2026-11-07): commercial work across the board —
// hotshots, commercial rigs and fleet trucks, the new 2027 cabs &
// semis — never consumer driving. Head-unit copy stays commercial.
//
// SIMPLICITY LAW (x, 2026-11-07, outranks feature richness): the head
// unit must be user-friendly and simple — big glanceable type, big
// touch targets, the fewest possible steps, no buried menus, no small
// text, nothing that needs reading at length while rolling. If a
// screen needs more than a glance and one tap, simplify it until it
// doesn't; when in doubt, cut the option and keep the drive simple.
//
//   Guidance    — the carReadout above (NavigationTemplate)
//   Stops ahead — the corridor's real truck stops (PlaceListMapTemplate)
//   Road alerts — the real hazards ahead + the drive clock
//                 (MessageTemplate)
//
// Same distraction rules the native build answers to: while rolling,
// the stops list caps at four rows and alerts at three — a head unit
// never asks a rolling driver to scroll. Every fact on a stop row
// comes from the map data itself; a fact the data doesn't state
// (parking, showers, price) simply never appears — it is never guessed.
// ---------------------------------------------------------------------------

export interface HeadUnitStopInput {
  id: string;
  name: string;
  brandLabel: string;
  /** Miles from the truck: route-miles remaining when a route runs,
   *  straight-line miles otherwise. Negative / NaN = behind or
   *  unmeasured, and the row is dropped. */
  distanceMi: number;
  /** Miles off the route corridor; null when no route is running. */
  offRouteMi: number | null;
  dieselPrice: number | null;
  truckParking: boolean | null;
  showers: boolean | null;
  scales: boolean | null;
  lat: number;
  lon: number;
  /** "weigh" rows are weigh stations — hauling infrastructure, shown
   *  in the same ahead list; they carry no stop card, so they render
   *  as plain rows, never buttons. */
  kind?: "stop" | "weigh";
  /** A leading fact computed by the caller (e.g. a weigh station's
   *  driver-reported OPEN / CLOSED status). */
  leadFact?: string | null;
}

export interface HeadUnitStop {
  id: string;
  name: string;
  brandLabel: string;
  distanceText: string;
  /** Known facts only, in display order. */
  facts: string[];
  lat: number;
  lon: number;
  /** Truck stops open their stop card on tap; weigh rows don't. */
  tappable: boolean;
}

/** The PlaceList model: nearest stops first, capped for the driver's
 *  state — four while rolling, six parked (the template's own limits).
 *  Built for hauling, not car POIs: truck stops and weigh stations —
 *  truck parking, fuel, scales — from the app's own corridor data. */
export function headUnitStops(stops: HeadUnitStopInput[], rolling: boolean): HeadUnitStop[] {
  const cap = rolling ? 4 : 6;
  return stops
    .filter((s) => Number.isFinite(s.distanceMi) && s.distanceMi >= 0)
    .sort((a, b) => a.distanceMi - b.distanceMi)
    .slice(0, cap)
    .map((s) => {
      const facts: string[] = [];
      if (s.leadFact) facts.push(s.leadFact);
      if (s.dieselPrice != null) facts.push(`Diesel $${s.dieselPrice.toFixed(2)}`);
      if (s.truckParking === true) facts.push("Truck parking");
      if (s.showers === true) facts.push("Showers");
      if (s.scales === true) facts.push("Scales");
      if (s.offRouteMi != null && s.offRouteMi > 0.1) facts.push(`${s.offRouteMi.toFixed(1)} mi off route`);
      return {
        id: s.id,
        name: s.name,
        brandLabel: s.brandLabel,
        distanceText: formatTurnDistance(s.distanceMi),
        facts,
        lat: s.lat,
        lon: s.lon,
        tappable: s.kind !== "weigh",
      };
    });
}

// ---------------------------------------------------------------------------
// Receiver memory on approach — STONEMILES-only. When the truck closes
// on the delivery, the head unit surfaces what the DRIVER'S OWN sealed
// history says about that dock: visit count, average dwell, the door
// from last time, and the driver's own check-in note. The caller does
// the matching against the sealed facility history (extras.ts) and
// passes one matched record; this model owns only the approach gate
// (inside 50 miles to go) and the glanceable wording. No history, no
// surface — nothing is crowdsourced or guessed.
// ---------------------------------------------------------------------------

export interface ReceiverMemory {
  headline: string;
  line: string;
  note: string | null;
}

export function receiverMemoryNote(args: {
  facility: string;
  site: string;
  visits: number;
  avgDwellHours: number;
  lastNote: string | null;
  lastDoor: string | null;
  milesLeft: number | null;
}): ReceiverMemory | null {
  if (args.milesLeft == null || !Number.isFinite(args.milesLeft) || args.milesLeft > 50) return null;
  const parts = [
    `${args.visits} visit${args.visits === 1 ? "" : "s"} here`,
    `avg dwell ${args.avgDwellHours.toFixed(1)} h`,
  ];
  if (args.lastDoor) parts.push(`door ${args.lastDoor} last time`);
  return {
    headline: `What to expect here — ${args.facility}${args.site ? ` (${args.site})` : ""}`,
    line: parts.join(" · "),
    note: args.lastNote,
  };
}

export type HeadUnitAlertKind =
  | "bridge"
  | "weight"
  | "notruck"
  | "weigh"
  | "hos"
  | "grade"
  | "construction"
  | "ramp"
  | "curve"
  | "crossing"
  | "hazard"
  | "weather";

export interface HeadUnitAlertInput {
  id: string;
  kind: HeadUnitAlertKind;
  label: string;
  detail: string;
  /** Explicit urgency override (a strong downgrade ≥6% reads urgent;
   *  a climb does not). Absent = the kind-based rule below. */
  urgent?: boolean;
  /** Miles ahead of the truck; null = no position (the drive-clock
   *  warning) and sorts after every placed alert. */
  distanceMi: number | null;
}

export interface HeadUnitAlert {
  id: string;
  kind: HeadUnitAlertKind;
  icon: string;
  label: string;
  detail: string;
  distanceText: string | null;
  urgent: boolean;
}

const HEAD_UNIT_ALERT_ICON: Record<HeadUnitAlertKind, string> = {
  bridge: "🌉",
  weight: "⚖️",
  notruck: "⛔",
  weigh: "🏋️",
  hos: "⏱️",
  grade: "⛰️",
  construction: "🚧",
  ramp: "🛟",
  curve: "↩️",
  crossing: "🚂",
  hazard: "⚠️",
  weather: "🌨️",
};

/** The Message model: nearest first, never more than three on the
 *  head unit. Restrictions that can stop the truck (low bridge, weight
 *  limit) and a dying drive clock read urgent; the rest read plain. */
export function headUnitAlerts(alerts: HeadUnitAlertInput[]): HeadUnitAlert[] {
  return alerts
    .slice()
    .sort(
      (a, b) =>
        (a.distanceMi ?? Number.POSITIVE_INFINITY) - (b.distanceMi ?? Number.POSITIVE_INFINITY),
    )
    .slice(0, 3)
    .map((a) => ({
      id: a.id,
      kind: a.kind,
      icon: HEAD_UNIT_ALERT_ICON[a.kind],
      label: a.label,
      detail: a.detail,
      distanceText: a.distanceMi != null ? formatTurnDistance(a.distanceMi) : null,
      urgent: a.urgent ?? (a.kind === "bridge" || a.kind === "weight" || a.kind === "hos"),
    }));
}

/** The drive-clock alert row, present only when the clock is actually
 *  dying (< 30 min) and the driver left the HOS tile on. */
export function hosAlert(hosDriveLeftH: number | null, showHos: boolean): HeadUnitAlertInput | null {
  if (!showHos || hosDriveLeftH == null || hosDriveLeftH >= 0.5) return null;
  return {
    id: "hos-clock",
    kind: "hos",
    label: "Drive clock running out",
    detail: `${formatHosLeft(hosDriveLeftH)} of drive time left — plan your stop now.`,
    distanceMi: null,
  };
}

// ---------------------------------------------------------------------------
// Tier inclusion (x's pricing call, 2026-11-07: "Basic gets basic
// version everyone else get it's tier"). Cab Mode is NOT a separate
// paid add-on and carries no price of its own anywhere — it is part of
// the plan tiers:
//
//   Basic           — the basic cab version: the glanceable core
//                     (next turn + distance, speed vs the posted limit,
//                     ETA / time left / miles left).
//   Gold · Diamond  — the full version for their tier: everything in
//   · Fleet/Owner     Basic, plus auto-open with guidance, voice
//                     directions on the cab display, the HOS tile, and
//                     the Stops ahead + Road alerts head-unit screens.
//
// The caller resolves the account's plan through the app's one tier
// system and passes fullAccess (Gold-and-up); this model just names
// what the flag unlocks so the panel, the displays, and the tests all
// read the same rule.
// ---------------------------------------------------------------------------

export interface CarTierFeatures {
  autoLaunch: boolean;
  voiceOnDisplay: boolean;
  hosTile: boolean;
  headUnitScreens: boolean;
}

export function carTierFeatures(fullAccess: boolean): CarTierFeatures {
  return {
    autoLaunch: fullAccess,
    voiceOnDisplay: fullAccess,
    hosTile: fullAccess,
    headUnitScreens: fullAccess,
  };
}

// NOTE (x's order, 2026-11-07): there is deliberately NO readiness /
// roadmap model here anymore. The launch roadmap — Play account state,
// listing and review steps, the CarPlay road — lives in our files
// (DATA-PLAN.md, the PACCAR Connect brief), never in the product UI.
// The panel carries one plain line where projection status matters:
// "Head-unit projection arrives with the Play Store release."
