// Map display preferences — server-side pure helpers for the
// app_settings columns added by migration 0060. Kept framework-free so
// the round-trip / defaults / isolation behavior is unit-testable
// (see mapPrefs.test.ts); actions.ts owns the DB reads and writes.
//
// Storage follows the app's existing settings pattern: the prefs live
// on the account's own single app_settings row (id = 1) in the
// account's own database — there is no shared or global prefs store,
// so one driver's choices can never surface on another driver's
// account. Defaults = the map exactly as it shipped before
// customization existed (everything on, streets base).

export type MapBaseStyle = "streets" | "satellite" | "hybrid";

/** GPS day / night mode (migration 0081): "auto" follows the sun at
 *  the truck's position (device clock without a fix), "day"/"night"
 *  pin the look, "off" disables day/night entirely — the map keeps
 *  its standard true-color look. Display-only: it restyles the
 *  Streets base map and never touches routes, alerts, or data. */
export type MapDayNightMode = "auto" | "day" | "night" | "off";

export type MapPrefs = {
  mapBaseStyle: MapBaseStyle;
  mapDayNightMode: MapDayNightMode;
  mapShowFuel: boolean;
  mapShowParking: boolean;
  mapShowHazards: boolean;
  mapShowIntel: boolean;
  mapShowRoute: boolean;
  mapShowSpeed: boolean;
  mapShowLabels: boolean;
  // Traffic display (migration 0062): a DISPLAY-ONLY toggle for
  // TomTom traffic — the live congestion colors on the selected
  // route line (orange slow / red heavy, since 2026-10-27) AND the
  // text annotations on route cards and the scan-ahead status. It
  // gates rendering only — never fetching, the scan-ahead protective
  // function, spoken alerts, or hazard displays.
  mapShowTrafficNotes: boolean;
  // Traffic lights layer (migration 0106): OpenStreetMap
  // traffic-signal LOCATIONS on the map and ahead on the route.
  // Locations only — the source carries no phase/timing data and
  // none is ever displayed. Default ON.
  mapShowSignals: boolean;
  // Route weather radar overlay (migration 0085): display-only —
  // the NWS NEXRAD tile layer on the map. Default OFF.
  mapShowRadar: boolean;
  // Drive-screen overlay customization (migration 0095, Repair 5):
  // VISIBILITY + TRANSPARENCY ONLY for the floating elements on the
  // Drive/GPS screen. The traffic legend defaults OFF — the
  // 2026-11-03 removal order is the standard layout, and this
  // switch is the only way the legend ever appears. No behavior
  // (prompt timers, guidance, alerts) ever consults these.
  driveShowWeather: boolean;
  driveShowBigPrompts: boolean;
  driveShowTrafficLegend: boolean;
  driveShowEtaPill: boolean;
  driveGlassLevel: DriveGlassLevel;
  // Enhanced map view (migration 0100): the satellite base styles +
  // tilted camera as one removable feature. Default ON — the feature
  // is part of the shipped map. OFF removes it entirely (style
  // collapses to Streets, camera forced flat); the stored base-style
  // and tilt choices are KEPT while off, so turning it back on
  // restores the driver's setup exactly.
  mapEnhancedView: boolean;
  mapTiltMode: MapTiltMode;
};

/** See-through level for Drive-screen overlays (Repair 5): how
 *  much the map reads through every floating element. "med" is the
 *  standard layout from the driver's 2026-11-03 verdict. */
export type DriveGlassLevel = "low" | "med" | "high";

/** Tilted driving camera choice (migration 0100, enhanced map view):
 *    auto   — the shipped behavior: the Go face leans in, Explore
 *             stays flat.
 *    flat   — the camera stays top-down everywhere.
 *    tilted — the camera leans in everywhere, Explore included.
 *  Only ever consulted while the enhanced map view is ON; with it
 *  OFF the camera is flat and the choice is inert (kept, so turning
 *  the feature back on restores the driver's setup). */
export type MapTiltMode = "auto" | "flat" | "tilted";

export const MAP_PREFS_DEFAULTS: MapPrefs = {
  mapBaseStyle: "streets",
  mapDayNightMode: "auto",
  mapShowFuel: true,
  mapShowParking: true,
  mapShowHazards: true,
  mapShowIntel: true,
  mapShowRoute: true,
  mapShowSpeed: true,
  mapShowLabels: true,
  mapShowTrafficNotes: true,
  mapShowSignals: true,
  mapShowRadar: false,
  driveShowWeather: true,
  driveShowBigPrompts: true,
  driveShowTrafficLegend: false,
  driveShowEtaPill: true,
  driveGlassLevel: "med",
  mapEnhancedView: true,
  mapTiltMode: "auto",
};

/** The app_settings row shape the prefs columns are read from. */
export type MapPrefsRow = {
  mapBaseStyle: string;
  mapDayNightMode: string;
  mapShowFuel: boolean;
  mapShowParking: boolean;
  mapShowHazards: boolean;
  mapShowIntel: boolean;
  mapShowRoute: boolean;
  mapShowSpeed: boolean;
  mapShowLabels: boolean;
  mapShowTrafficNotes: boolean;
  mapShowSignals: boolean;
  mapShowRadar: boolean;
  driveShowWeather: boolean;
  driveShowBigPrompts: boolean;
  driveShowTrafficLegend: boolean;
  driveShowEtaPill: boolean;
  driveGlassLevel: string;
  mapEnhancedView: boolean;
  mapTiltMode: string;
};

/** Map a stored row to typed prefs. A missing row (account has never
 *  saved settings) yields the shipped defaults — today's exact map. */
export function mapPrefsFromRow(row: MapPrefsRow | null | undefined): MapPrefs {
  if (!row) return { ...MAP_PREFS_DEFAULTS };
  return {
    mapBaseStyle:
      row.mapBaseStyle === "satellite" || row.mapBaseStyle === "hybrid"
        ? row.mapBaseStyle
        : "streets",
    mapDayNightMode:
      row.mapDayNightMode === "day" || row.mapDayNightMode === "night" || row.mapDayNightMode === "off"
        ? row.mapDayNightMode
        : "auto",
    mapShowFuel: row.mapShowFuel !== false,
    mapShowParking: row.mapShowParking !== false,
    mapShowHazards: row.mapShowHazards !== false,
    mapShowIntel: row.mapShowIntel !== false,
    mapShowRoute: row.mapShowRoute !== false,
    mapShowSpeed: row.mapShowSpeed !== false,
    mapShowLabels: row.mapShowLabels !== false,
    mapShowTrafficNotes: row.mapShowTrafficNotes !== false,
    // Traffic lights (0106): a legacy row predating the column reads
    // as the shipped default — ON.
    mapShowSignals: row.mapShowSignals !== false,
    mapShowRadar: row.mapShowRadar === true,
    // Drive-screen overlays (0095): a legacy row predating the
    // columns reads as the standard layout — weather / big prompts
    // / ETA pill on, traffic legend OFF, glass Med.
    driveShowWeather: row.driveShowWeather !== false,
    driveShowBigPrompts: row.driveShowBigPrompts !== false,
    driveShowTrafficLegend: row.driveShowTrafficLegend === true,
    driveShowEtaPill: row.driveShowEtaPill !== false,
    driveGlassLevel:
      row.driveGlassLevel === "low" || row.driveGlassLevel === "high"
        ? row.driveGlassLevel
        : "med",
    // Enhanced map view (0100): a legacy row predating the columns
    // reads as the shipped feature — ON, tilt Auto. Only an explicit
    // stored false removes the feature.
    mapEnhancedView: row.mapEnhancedView !== false,
    mapTiltMode:
      row.mapTiltMode === "flat" || row.mapTiltMode === "tilted"
        ? row.mapTiltMode
        : "auto",
  };
}

/** Map typed prefs back to the stored row shape (the save direction of
 *  the round-trip: fromRow(toRow(p)) === p for every valid p). */
export function mapPrefsToRow(prefs: MapPrefs): MapPrefsRow {
  return {
    mapBaseStyle: prefs.mapBaseStyle,
    mapDayNightMode: prefs.mapDayNightMode,
    mapShowFuel: prefs.mapShowFuel,
    mapShowParking: prefs.mapShowParking,
    mapShowHazards: prefs.mapShowHazards,
    mapShowIntel: prefs.mapShowIntel,
    mapShowRoute: prefs.mapShowRoute,
    mapShowSpeed: prefs.mapShowSpeed,
    mapShowLabels: prefs.mapShowLabels,
    mapShowTrafficNotes: prefs.mapShowTrafficNotes,
    mapShowSignals: prefs.mapShowSignals,
    mapShowRadar: prefs.mapShowRadar,
    driveShowWeather: prefs.driveShowWeather,
    driveShowBigPrompts: prefs.driveShowBigPrompts,
    driveShowTrafficLegend: prefs.driveShowTrafficLegend,
    driveShowEtaPill: prefs.driveShowEtaPill,
    driveGlassLevel: prefs.driveGlassLevel,
    mapEnhancedView: prefs.mapEnhancedView,
    mapTiltMode: prefs.mapTiltMode,
  };
}
