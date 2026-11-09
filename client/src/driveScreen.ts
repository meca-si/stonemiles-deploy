// driveScreen.ts — the Drive/GPS screen's floating-overlay system
// (Repair 5, driver order 2026-11-03 ~23:28 CT: "That layout need
// to be see through because it blocking the map or organize it
// another way. User should be able to customize the gps screen.").
//
// Two halves, both DISPLAY-ONLY — visibility and transparency,
// never behavior:
//
//   1. SEE-THROUGH BY DEFAULT. Every floating element on the
//      driving map (top instruction bar, speed/LIMIT cluster,
//      weather chip, End route / Full screen buttons, big prompt
//      cards, right rail) renders translucent with the map readable
//      beneath and a text halo carrying contrast — the same
//      treatment the small place popup got in the previous repair
//      (mapPopup.ts). Nothing on the driving map sits in a fully
//      solid box. The alphas below are the single source: theme.css
//      mirrors the panel/pill values for the .drive-scope rules and
//      App.tsx reads the solid-control values for inline styles;
//      the unit tests pin both sides so they can't drift apart.
//
//   2. PER-DRIVER CUSTOMIZATION, persisted server-side on the
//      driver's own app_settings row (migration 0095, through the
//      existing mapPrefs plumbing — client mapPrefs.ts mirrors the
//      fields). Each overlay below can be shown/hidden, the
//      see-through level is Low/Med/High, and one tap resets to the
//      STANDARD layout — exactly what the driver carved out on
//      2026-11-03: slim top bar, speedo cluster, weather chip,
//      NO traffic legend, see-through everything at Med.
//
// Locked behaviors never consult any of this: the 5-second prompt
// timers, no-record-on-timeout, Not here, OPEN/CLOSED semantics,
// the top bar's contents, voice guidance, and every alert behave
// identically whatever a driver hides. A hidden element simply
// doesn't render for that driver. The top instruction bar, the
// right-rail controls, End route, and the reroute state panels are
// NOT toggleable — guidance and controls always stay.

import type { MapPrefs } from "./mapPrefs";

export type DriveGlassLevel = "low" | "med" | "high";

export const DRIVE_GLASS_LEVELS: readonly DriveGlassLevel[] = ["low", "med", "high"];

/** Background alpha of the glass PANELS/PILLS on the driving map,
 *  per see-through level (dark base rgb(13,21,43) / pill base
 *  rgb(10,16,34); theme.css mirrors these numbers). Med is the
 *  standard. Every value is < 1 — no fully solid box, ever. */
export const DRIVE_GLASS_PANEL_ALPHA: Record<DriveGlassLevel, number> = {
  low: 0.7,
  med: 0.55,
  high: 0.4,
};

/** Background alpha for the SOLID-LOOKING controls (the trip tab's
 *  End Route button, Full screen, right rail): still see-through at
 *  every level, but they keep more substance than the panels
 *  because they're the glance-and-tap targets. */
export const DRIVE_GLASS_SOLID_ALPHA: Record<DriveGlassLevel, number> = {
  low: 0.88,
  med: 0.78,
  high: 0.66,
};

/** The --glass value theme.css applies inside .drive-scope for a
 *  level (dark theme). Kept here so the test can pin CSS == code. */
export function driveGlassCssVar(level: DriveGlassLevel): string {
  return `rgba(13, 21, 43, ${DRIVE_GLASS_PANEL_ALPHA[level]})`;
}

/** Inline background for a solid-looking control at a level. */
export function driveSolidBg(level: DriveGlassLevel, rgb: string): string {
  return `rgba(${rgb}, ${DRIVE_GLASS_SOLID_ALPHA[level]})`;
}

/** Background alpha for the BIG PROMPT CARDS (sign / exit cards,
 *  SignCheckPrompt.tsx), per see-through level. The cards keep more
 *  substance than the panels — they're the glance-and-match safety
 *  surface — but they DO follow the driver's level: Med (.8) is the
 *  standard the cards shipped with in Repair 5's first pass, Low is
 *  nearer the old solid sign, High lets the most map through. */
export const DRIVE_PROMPT_ALPHA: Record<DriveGlassLevel, number> = {
  low: 0.9,
  med: 0.8,
  high: 0.66,
};

/** Inline background for a big prompt card at a level. */
export function promptCardBg(level: DriveGlassLevel, rgb: string): string {
  return `rgba(${rgb}, ${DRIVE_PROMPT_ALPHA[level]})`;
}

/** The toggleable floating elements on the Drive/GPS screen, in
 *  settings order. `field` is the AppSettings (server-shape) field
 *  the Layers panel switch writes; `pref` is the client MapPrefs
 *  field App.tsx gates the render on. The speed/LIMIT cluster rides
 *  the existing mapShowSpeed switch (the same one Layers → On the
 *  map carries) so there's exactly one source for it. */
export const DRIVE_OVERLAYS = [
  {
    key: "weather",
    label: "Weather chip",
    hint: "Live conditions chip at the bottom-right of the driving map, where the End route button used to sit",
    field: "driveShowWeather",
    pref: "showDriveWeather",
  },
  {
    key: "speed",
    label: "Posted LIMIT",
    hint: "The posted speed limit sign, bottom-left — the map shows no own-speed readout (x's order 2026-11-09)",
    field: "mapShowSpeed",
    pref: "showSpeed",
  },
  {
    key: "bigPrompts",
    label: "Big prompt cards",
    hint: "The 5-second sign / exit cards at sign scale. Hiding them changes nothing else — timers, voice, and records work the same",
    field: "driveShowBigPrompts",
    pref: "showBigPrompts",
  },
  {
    key: "etaPill",
    label: "ETA pill",
    hint: "Arrival clock + time and miles left, floating at the top when the map isn't in Go",
    field: "driveShowEtaPill",
    pref: "showEtaPill",
  },
  {
    key: "trafficLegend",
    label: "Traffic legend",
    hint: "The TomTom flowing / slow / heavy chip. OFF in the standard layout — it only ever appears if you turn it on here",
    field: "driveShowTrafficLegend",
    pref: "showTrafficLegend",
  },
] as const;

export type DriveOverlayKey = (typeof DRIVE_OVERLAYS)[number]["key"];

/** Which toggleable overlays render under these prefs. A key absent
 *  from the set is absent from the screen — App.tsx gates every
 *  render on it. */
export function visibleDriveOverlays(prefs: MapPrefs): ReadonlySet<DriveOverlayKey> {
  const out = new Set<DriveOverlayKey>();
  for (const o of DRIVE_OVERLAYS) {
    if (prefs[o.pref]) out.add(o.key);
  }
  return out;
}

/** The STANDARD layout (the driver's 2026-11-03 verdict): the
 *  AppSettings patch the one-tap Reset writes. Traffic legend OFF,
 *  everything else on, see-through Med. */
export const STANDARD_DRIVE_LAYOUT = {
  driveShowWeather: true,
  driveShowBigPrompts: true,
  driveShowTrafficLegend: false,
  driveShowEtaPill: true,
  driveGlassLevel: "med" as DriveGlassLevel,
  mapShowSpeed: true,
};

/** SPEED READOUT OFFSET — DASH MATCH (driver order 2026-11-09:
 *  "speed show 3 mph less than actual speed" → the app's number
 *  was reading 3 mph UNDER his dash; his follow-up order, twice:
 *  "Make the screen match my dash"). Everywhere the app SHOWS the
 *  truck's own speed — the Drive bubble, the Drive panel readout,
 *  the grade/curve "you're at" lines, the over-limit banner, and
 *  the Cab Mode speed tile — the printed number is the true GPS
 *  speed PLUS this offset, so the screen reads what his dash
 *  reads. (An earlier build shipped this at −3 — the wrong sign,
 *  6 under the dash; the sign here is the whole point.) DISPLAY
 *  ONLY, like everything else in this module: the true speed
 *  still drives the overspeed alerts, the safety engines, HOS,
 *  points, and every sealed record — the chain never sees the
 *  shifted number. Posted limits and advisory speeds are never
 *  offset (they aren't the truck's speed). */
export const SPEED_DISPLAY_OFFSET_MPH = 3;

/** The speed the driver reads: GPS speed plus the dash offset.
 *  A parked truck (0) still reads 0 — the offset matches a moving
 *  dash, it never invents motion at a standstill. */
export function displayedSpeedMph(actualMph: number): number {
  return actualMph > 0 ? actualMph + SPEED_DISPLAY_OFFSET_MPH : 0;
}

/** True when the drive-screen fields already match the standard
 *  layout (the Reset button can say so instead of pretending). */
export function isStandardDriveLayout(s: {
  driveShowWeather: boolean;
  driveShowBigPrompts: boolean;
  driveShowTrafficLegend: boolean;
  driveShowEtaPill: boolean;
  driveGlassLevel: DriveGlassLevel;
  mapShowSpeed: boolean;
}): boolean {
  return (
    s.driveShowWeather === STANDARD_DRIVE_LAYOUT.driveShowWeather &&
    s.driveShowBigPrompts === STANDARD_DRIVE_LAYOUT.driveShowBigPrompts &&
    s.driveShowTrafficLegend === STANDARD_DRIVE_LAYOUT.driveShowTrafficLegend &&
    s.driveShowEtaPill === STANDARD_DRIVE_LAYOUT.driveShowEtaPill &&
    s.driveGlassLevel === STANDARD_DRIVE_LAYOUT.driveGlassLevel &&
    s.mapShowSpeed === STANDARD_DRIVE_LAYOUT.mapShowSpeed
  );
}
