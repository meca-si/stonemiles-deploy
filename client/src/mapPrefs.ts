// Map display preferences — pure logic (no DOM, no React), like
// routeGeometry.ts / gpsFilter.ts, so the exact production behavior is
// unit-testable (see mapPrefs.test.ts).
//
// The driver chooses what the map draws. Every category the map layer
// effect in App.tsx actually renders has exactly one switch here:
//
//   fuel     — fuel-stop markers (with diesel prices in their tooltips)
//   parking  — parking intel markers (parking_open / parking_full)
//   hazards  — restriction & weigh-station hazards (bridge height,
//              weight limits, no-truck roads, weigh stations)
//   intel    — road intel markers (driver reports that aren't parking)
//   route    — route lines + the destination pin ("Route & stops")
//   speed    — the speed / posted-limit readout overlay
//   labels   — place-label overlays (the vector style carries its
//              labels as their own layers, so this splits out on
//              every base style; Hybrid's Esri overlays follow it too)
//
// Enhanced map view (2026-11-06) rides on the same prefs object:
//   enhancedMap — the satellite styles + tilted camera as ONE
//                 removable feature (Settings switch). OFF removes
//                 both entirely; the stored choices stay and return
//                 with it. Default ON.
//   tiltMode    — the camera choice while enhanced is on: auto
//                 (Go leans / Explore flat), flat, or tilted.
//
// The driver's own truck marker and active-navigation guidance are NOT
// categories: they are never toggleable. Spoken/audio hazard alerts are
// a safety behavior driven by the hazard DATA (which keeps loading
// regardless), never by these display switches.
//
// Defaults = the map exactly as it shipped before customization existed
// (everything on, streets base), so nobody's map changes until they
// change it themselves.

export type MapBaseStyle = "streets" | "satellite" | "hybrid";

/** GPS day / night mode (driver's ask, 2026-10-31): which light the
 *  Streets map wears.
 *    auto  — day map in daylight, night map after dark. With a GPS
 *            position the switch follows the real sun there
 *            (sunrise/sunset from the solar math below); without one
 *            it follows the device clock (day 7 AM–7 PM).
 *    day   — the bright true-color day map, always.
 *    night — the dark night map, always (cab-friendly at any hour).
 *    off   — day/night mode OFF entirely: the map keeps its standard
 *            true-color look exactly as it shipped before this
 *            feature existed, and nothing ever switches it.
 *  Day/night restyles the Streets vector base only — satellite photos
 *  are photos and stay as they are. Route lines, markers, traffic
 *  colors, and every safety alert are never touched by it. */
export type MapDayNightMode = "auto" | "day" | "night" | "off";

/** Tilted driving camera choice (enhanced map view, 2026-11-06):
 *    auto   — the shipped behavior: the Go face leans in, Explore
 *             stays flat.
 *    flat   — the camera stays top-down everywhere.
 *    tilted — the camera leans in everywhere, Explore included.
 *  Only ever consulted while the enhanced map view is ON; with it
 *  OFF the camera is flat and the choice is inert (kept, so turning
 *  the feature back on restores the driver's setup). */
export type MapTiltMode = "auto" | "flat" | "tilted";

export type MapPrefs = {
  baseStyle: MapBaseStyle;
  dayNightMode: MapDayNightMode;
  showFuel: boolean;
  showParking: boolean;
  showHazards: boolean;
  showIntel: boolean;
  showRoute: boolean;
  showSpeed: boolean;
  showLabels: boolean;
  // Traffic (migration 0062): the Layers "Traffic" switch. It gates
  // the TEXT TomTom annotations on route cards and the scan-ahead
  // status, the live congestion COLORS on the selected route line
  // (orange slow / red heavy, trafficSegments.ts), and — since the
  // 2026-11-02 repair — the continuous live-traffic REFRESH POLL
  // that keeps that paint fresh while a route runs (see
  // trafficLiveRefreshEnabled): display off installs no poll timer
  // and makes no TomTom refresh requests. It never gates the
  // one-shot traffic enrichment at plan time (a route-comparison
  // answer the driver asked for by planning a route), the
  // scan-ahead protective function, spoken alerts, or hazard data.
  showTrafficNotes: boolean;
  // Traffic lights (migration 0106): OpenStreetMap traffic-signal
  // LOCATIONS drawn on the map and called out ahead on the route.
  // Locations only — the map data carries no live phase or timing
  // and the app never displays a signal color, countdown, or state.
  showSignals: boolean;
  // Weather radar (migration 0085): a display-only toggle for the
  // NWS NEXRAD radar tile overlay (routeWeather.ts RADAR_TILE_URL).
  // Default OFF — radar is an overlay the driver asks for; the
  // corridor weather data and its alerts never consult this switch.
  showRadar: boolean;
  // Drive-screen overlay customization (migration 0095, Repair 5 —
  // see driveScreen.ts for the inventory): VISIBILITY ONLY for the
  // floating elements on the Drive/GPS screen, plus the see-through
  // level. The traffic legend defaults OFF — the 2026-11-03 removal
  // order is the standard layout; showTrafficLegend is the only way
  // it ever appears.
  showDriveWeather: boolean;
  showBigPrompts: boolean;
  showTrafficLegend: boolean;
  showEtaPill: boolean;
  driveGlassLevel: "low" | "med" | "high";
  // Enhanced map view (2026-11-06): the satellite base styles +
  // tilted camera as one removable feature. Default ON — the feature
  // is part of the shipped map. OFF removes it entirely (style
  // collapses to Streets, camera forced flat); the stored base-style
  // and tilt choices are KEPT while off, so turning it back on
  // restores the driver's setup exactly. See effectiveBaseStyle /
  // effectivePitchDeg / satelliteFallbackActive below.
  enhancedMap: boolean;
  tiltMode: MapTiltMode;
};

export const MAP_PREFS_DEFAULTS: MapPrefs = {
  baseStyle: "streets",
  // Day/night ships ON in Auto — that is the feature the driver asked
  // for — with Off one tap away in the same control, restoring the
  // exact pre-feature map.
  dayNightMode: "auto",
  showFuel: true,
  showParking: true,
  showHazards: true,
  showIntel: true,
  showRoute: true,
  showSpeed: true,
  showLabels: true,
  showTrafficNotes: true,
  showSignals: true,
  showRadar: false,
  showDriveWeather: true,
  showBigPrompts: true,
  showTrafficLegend: false,
  showEtaPill: true,
  driveGlassLevel: "med",
  enhancedMap: true,
  tiltMode: "auto",
};

/** The drawn-layer categories, in panel order. `key` names the drawn
 *  layer; `pref` is the MapPrefs field that gates it. */
export const MAP_LAYER_CATEGORIES = [
  { key: "fuel", pref: "showFuel", label: "Fuel prices", hint: "Fuel-stop markers and their diesel prices" },
  { key: "parking", pref: "showParking", label: "Parking", hint: "Parking reports from drivers — open spots and full lots" },
  { key: "hazards", pref: "showHazards", label: "Hazards & incidents", hint: "Low bridges, weight limits, no-truck roads, weigh stations" },
  { key: "intel", pref: "showIntel", label: "Road intel", hint: "Driver reports: closures, crashes, debris, scale lines" },
  { key: "route", pref: "showRoute", label: "Route & stops", hint: "Your route lines and the destination pin" },
  { key: "speed", pref: "showSpeed", label: "Posted limit", hint: "The posted speed limit sign, bottom-left of the map" },
  { key: "labels", pref: "showLabels", label: "Place labels", hint: "Town and road-name labels on the map" },
  { key: "radar", pref: "showRadar", label: "Weather radar", hint: "Live NWS radar overlay — precipitation moving over your route" },
  { key: "signals", pref: "showSignals", label: "Traffic lights", hint: "Traffic-signal locations from OpenStreetMap — locations only; no live red/green timing exists in the data" },
] as const;

export type MapLayerKey = (typeof MAP_LAYER_CATEGORIES)[number]["key"];

/** Merge a partial / untrusted prefs value over the defaults. Unknown
 *  values fall back per-field, so a stale cache or an older server row
 *  can never produce a half-broken setup. This is the round-trip core:
 *  normalize(save(x)) === normalize(x) for every valid x. */
export function normalizeMapPrefs(input: Partial<MapPrefs> | null | undefined): MapPrefs {
  if (!input || typeof input !== "object") return { ...MAP_PREFS_DEFAULTS };
  const bool = (v: unknown, dflt: boolean): boolean => (typeof v === "boolean" ? v : dflt);
  return {
    baseStyle:
      input.baseStyle === "satellite" || input.baseStyle === "hybrid" || input.baseStyle === "streets"
        ? input.baseStyle
        : MAP_PREFS_DEFAULTS.baseStyle,
    dayNightMode:
      input.dayNightMode === "day" || input.dayNightMode === "night" || input.dayNightMode === "off" || input.dayNightMode === "auto"
        ? input.dayNightMode
        : MAP_PREFS_DEFAULTS.dayNightMode,
    showFuel: bool(input.showFuel, MAP_PREFS_DEFAULTS.showFuel),
    showParking: bool(input.showParking, MAP_PREFS_DEFAULTS.showParking),
    showHazards: bool(input.showHazards, MAP_PREFS_DEFAULTS.showHazards),
    showIntel: bool(input.showIntel, MAP_PREFS_DEFAULTS.showIntel),
    showRoute: bool(input.showRoute, MAP_PREFS_DEFAULTS.showRoute),
    showSpeed: bool(input.showSpeed, MAP_PREFS_DEFAULTS.showSpeed),
    showLabels: bool(input.showLabels, MAP_PREFS_DEFAULTS.showLabels),
    showTrafficNotes: bool(input.showTrafficNotes, MAP_PREFS_DEFAULTS.showTrafficNotes),
    showSignals: bool(input.showSignals, MAP_PREFS_DEFAULTS.showSignals),
    showRadar: bool(input.showRadar, MAP_PREFS_DEFAULTS.showRadar),
    showDriveWeather: bool(input.showDriveWeather, MAP_PREFS_DEFAULTS.showDriveWeather),
    showBigPrompts: bool(input.showBigPrompts, MAP_PREFS_DEFAULTS.showBigPrompts),
    showTrafficLegend: bool(input.showTrafficLegend, MAP_PREFS_DEFAULTS.showTrafficLegend),
    showEtaPill: bool(input.showEtaPill, MAP_PREFS_DEFAULTS.showEtaPill),
    driveGlassLevel:
      input.driveGlassLevel === "low" || input.driveGlassLevel === "high"
        ? input.driveGlassLevel
        : MAP_PREFS_DEFAULTS.driveGlassLevel,
    // Enhanced map view: only an explicit false removes the feature —
    // a stale cache or older server row (no field at all) keeps it.
    enhancedMap: input.enhancedMap !== false,
    tiltMode:
      input.tiltMode === "flat" || input.tiltMode === "tilted"
        ? input.tiltMode
        : MAP_PREFS_DEFAULTS.tiltMode,
  };
}

/** The set of layer categories the map draws under these prefs. A
 *  category absent from this set is absent from the map — the layer
 *  effect gates every draw on it. */
export function visibleMapLayers(prefs: MapPrefs): ReadonlySet<MapLayerKey> {
  const out = new Set<MapLayerKey>();
  for (const c of MAP_LAYER_CATEGORIES) {
    if (prefs[c.pref]) out.add(c.key);
  }
  return out;
}

/** Which display category an intel report kind belongs to: parking
 *  reports are their own category; every other report is road intel. */
export function intelCategory(kind: string): "parking" | "intel" {
  return kind === "parking_open" || kind === "parking_full" ? "parking" : "intel";
}

/** Whether an intel report of this kind is drawn under these prefs. */
export function isIntelVisible(kind: string, prefs: MapPrefs): boolean {
  return intelCategory(kind) === "parking" ? prefs.showParking : prefs.showIntel;
}

// ---------- Enhanced map view (satellite + tilt, 2026-11-06) ------------
// The satellite base styles and the tilted driving camera are ONE
// feature with an optional removal (x's order): Settings → "Enhanced
// map view". These pure helpers are the single source the map effect,
// the mode switch, the rail controls, and the Layers panel all
// consult, so the removal is total and the offline honesty can't
// drift between surfaces.

/** The leaned-in driving pitch, in degrees — the Go face's shipped
 *  camera angle. Tilt applies to EVERY base style (vector streets,
 *  satellite, hybrid, and the offline base alike): it is a camera
 *  move, not a style property. */
export const DRIVE_TILT_PITCH_DEG = 55;

/** The base style the map actually draws. With the enhanced view
 *  OFF the satellite styles are REMOVED, not paused: the map draws
 *  plain Streets no matter what style is stored. The stored choice
 *  itself is never rewritten — turning the feature back on restores
 *  it exactly. */
export function effectiveBaseStyle(prefs: MapPrefs): MapBaseStyle {
  return prefs.enhancedMap ? prefs.baseStyle : "streets";
}

/** The camera pitch (degrees) for a map face under these prefs.
 *  Enhanced OFF → always 0 (flat, exactly the pre-feature map).
 *  Tilt "flat" → 0 everywhere; "tilted" → the driving lean
 *  everywhere; "auto" → the shipped faces (Go leans, Explore flat). */
export function effectivePitchDeg(prefs: MapPrefs, mode: "explore" | "go"): number {
  if (!prefs.enhancedMap) return 0;
  if (prefs.tiltMode === "flat") return 0;
  if (prefs.tiltMode === "tilted") return DRIVE_TILT_PITCH_DEG;
  return mode === "go" ? DRIVE_TILT_PITCH_DEG : 0;
}

/** Whether the map's camera is leaned in under these prefs/face —
 *  the tilt rail button's pressed state. */
export function tiltActive(prefs: MapPrefs, mode: "explore" | "go"): boolean {
  return effectivePitchDeg(prefs, mode) > 0;
}

/** What the rail's one-tap tilt button does NEXT, from the driver's
 *  current setup: leaning in when the camera is flat, flattening
 *  when it leans. Pinning the choice as an explicit flat/tilted
 *  (rather than toggling back to "auto") is deliberate: one tap
 *  always lands the camera where the button promised, on either
 *  face; "Auto" stays available in Layers for the shipped faces. */
export function nextTiltMode(prefs: MapPrefs, mode: "explore" | "go"): MapTiltMode {
  return tiltActive(prefs, mode) ? "flat" : "tilted";
}

/** Satellite-family choices need streamed imagery tiles — they can
 *  never be served from the phone. Streets and the offline base are
 *  not satellite; hybrid counts (its ground IS the imagery). */
export function isSatelliteStyle(style: MapBaseStyle): boolean {
  return style === "satellite" || style === "hybrid";
}

/** Offline honesty for satellite: TRUE exactly when the driver's
 *  chosen style is a satellite style but the map is NOT drawing it
 *  because there is no signal — either the offline base took over
 *  (a saved route's tiles are on the device) or the connection is
 *  simply down. While this is true, no surface may present Satellite
 *  as the active view: the toggle shows the fallback state and the
 *  status lines say the imagery waits for signal. When the enhanced
 *  view is OFF there is no satellite choice to fall back from. */
export function satelliteFallbackActive(args: {
  prefs: MapPrefs;
  isOnline: boolean;
  offlineBaseOn: boolean;
}): boolean {
  if (!args.prefs.enhancedMap) return false;
  if (!isSatelliteStyle(args.prefs.baseStyle)) return false;
  return args.offlineBaseOn || !args.isOnline;
}

/** Whether losing signal should pull the offline base in on its own
 *  for THIS driver: the shipped rule (a saved offline route exists)
 *  OR the satellite rule — satellite imagery streams, so the moment
 *  signal drops the map must leave it for the stored-tile base even
 *  when no route was ever saved for offline (areas outside any saved
 *  corridor stay blank; that honest edge is labelled on screen). */
export function offlineAutoSwitchApplies(args: {
  prefs: MapPrefs;
  isOnline: boolean;
  hasSavedRoutes: boolean;
}): boolean {
  if (args.isOnline) return false;
  if (args.hasSavedRoutes) return true;
  return args.prefs.enhancedMap && isSatelliteStyle(args.prefs.baseStyle);
}

/** Whether TomTom traffic renders under these prefs — the single
 *  display gate the route-card traffic block, the scan-ahead status,
 *  and the route-line congestion colors consult. The scan-ahead
 *  protective function, spoken alerts, and hazard drawing never
 *  consult this. For the refresh poll's gate, see
 *  trafficLiveRefreshEnabled below. */
export function trafficNotesVisible(prefs: MapPrefs): boolean {
  return prefs.showTrafficNotes;
}

/** Whether the continuous live-traffic refresh poll runs under
 *  these prefs (repair, 2026-11-02 — the wart left open by road
 *  test #4: the poll kept fetching TomTom flow/incidents every
 *  5 minutes while the Traffic display switch was off, refreshing
 *  paint nobody could see). The poll exists only to keep the
 *  DISPLAYED traffic fresh, so it runs exactly when the display
 *  switch is on: off → App.tsx's refresh effect installs no timer
 *  and makes no requests; on → the poll resumes. The one-shot
 *  enrichment at plan time is NOT this poll — it answers the route
 *  comparison the driver asked for by planning a route — and the
 *  scan-ahead protective function's own throttled traffic check is
 *  a safety behavior, not display; neither consults this gate. */
export function trafficLiveRefreshEnabled(prefs: MapPrefs): boolean {
  return prefs.showTrafficNotes;
}

// ---------- Day / night resolution --------------------------------------
// Standard solar-position math (the same astronomy every sunrise
// calculator runs: Julian day → solar mean anomaly → ecliptic
// longitude → declination + sidereal time → hour angle → altitude;
// the sunrise equation for rise/set times). Pure and deterministic —
// no network, no library — so Auto mode works offline in the cab and
// the exact production behavior is unit-testable.

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;

const toJulian = (date: Date): number => date.getTime() / DAY_MS - 0.5 + J1970;
const fromJulian = (j: number): Date => new Date((j + 0.5 - J1970) * DAY_MS);
const toDays = (date: Date): number => toJulian(date) - J2000;

function solarMeanAnomaly(d: number): number {
  return RAD * (357.5291 + 0.98560028 * d);
}
function eclipticLongitude(meanAnomaly: number): number {
  const center = RAD * (1.9148 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly) + 0.0003 * Math.sin(3 * meanAnomaly));
  const perihelion = RAD * 102.9372;
  return meanAnomaly + center + perihelion + Math.PI;
}
function declination(eclipticLon: number): number {
  return Math.asin(Math.sin(eclipticLon) * Math.sin(OBLIQUITY));
}
function siderealTime(d: number, lw: number): number {
  return RAD * (280.16 + 360.9856235 * d) - lw;
}

/** The sun's altitude in degrees at a place and moment: positive
 *  above the horizon, negative below it. Null only for nonsense
 *  coordinates (out-of-range or non-finite), never a guess. */
export function sunAltitudeDeg(date: Date, lat: number, lon: number): number | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toDays(date);
  const m = solarMeanAnomaly(d);
  const l = eclipticLongitude(m);
  const dec = declination(l);
  // Right ascension from ecliptic longitude (the sun's ecliptic latitude ≈ 0).
  const rightAscension = Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY), Math.cos(l));
  const hourAngle = siderealTime(d, lw) - rightAscension;
  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hourAngle));
  return altitude / RAD;
}

/** Sunrise / sunset for a place on the date's local day (the sunrise
 *  equation; -0.833° is the standard horizon angle accounting for
 *  refraction + the sun's disc). Null where the sun never rises or
 *  never sets that day (polar day/night) or for bad coordinates. */
export function sunTimes(date: Date, lat: number, lon: number): { sunrise: Date; sunset: Date } | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toDays(date);
  const n = Math.round(d - 0.0009 - lw / (2 * Math.PI));
  const ds = 0.0009 + lw / (2 * Math.PI) + n;
  const m = solarMeanAnomaly(ds);
  const l = eclipticLongitude(m);
  const dec = declination(l);
  const jNoon = J2000 + ds + 0.0053 * Math.sin(m) - 0.0069 * Math.sin(2 * l);
  const h0 = RAD * -0.833;
  const cosH = (Math.sin(h0) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosH < -1 || cosH > 1) return null; // polar day / polar night
  const w = Math.acos(cosH);
  const a = 0.0009 + (w + lw) / (2 * Math.PI) + n;
  const jSet = J2000 + a + 0.0053 * Math.sin(m) - 0.0069 * Math.sin(2 * l);
  const jRise = jNoon - (jSet - jNoon);
  return { sunrise: fromJulian(jRise), sunset: fromJulian(jSet) };
}

export type MapDayNightResolution = {
  /** The look the map wears right now: "night" = the dark night map;
   *  "day" = the bright day map (also what Off resolves to — Off
   *  simply never leaves the standard look). */
  theme: "day" | "night";
  /** How the theme was decided, for the plain-language status line. */
  source: "off" | "manual" | "sun" | "clock";
  /** In Auto+sun mode, when the look next flips (the coming sunset
   *  while it's day, the coming sunrise while it's night). */
  nextChange: Date | null;
};

/** Clock fallback hours for Auto without a GPS position: day map
 *  from 7 AM to 7 PM device-local time. */
export const AUTO_DAY_START_HOUR = 7;
export const AUTO_DAY_END_HOUR = 19;

/** Resolve the driver's day/night choice to the look the map wears
 *  right now. Auto prefers the real sun at the truck's position
 *  (sun altitude ≥ 0 = day) and falls back to the device clock when
 *  no position is known yet. */
export function resolveMapDayNight(
  mode: MapDayNightMode,
  args: { now: Date; lat: number | null; lon: number | null },
): MapDayNightResolution {
  if (mode === "off") return { theme: "day", source: "off", nextChange: null };
  if (mode === "day") return { theme: "day", source: "manual", nextChange: null };
  if (mode === "night") return { theme: "night", source: "manual", nextChange: null };
  // auto
  const { now, lat, lon } = args;
  if (lat != null && lon != null) {
    const alt = sunAltitudeDeg(now, lat, lon);
    if (alt != null) {
      const theme = alt >= 0 ? "day" : "night";
      const times = sunTimes(now, lat, lon);
      let nextChange: Date | null = null;
      if (times) {
        nextChange = theme === "day" ? times.sunset : times.sunrise;
        if (nextChange.getTime() <= now.getTime()) {
          // Today's flip already passed (e.g. night after midnight →
          // the sunrise that matters is tomorrow's).
          const tomorrow = sunTimes(new Date(now.getTime() + DAY_MS), lat, lon);
          if (tomorrow) nextChange = theme === "day" ? tomorrow.sunset : tomorrow.sunrise;
        }
      }
      return { theme, source: "sun", nextChange };
    }
  }
  const h = now.getHours() + now.getMinutes() / 60;
  const theme = h >= AUTO_DAY_START_HOUR && h < AUTO_DAY_END_HOUR ? "day" : "night";
  return { theme, source: "clock", nextChange: null };
}

// ---------- Heading source selection ------------------------------------
// Heading-up bearing follows the truck's heading. Standard practice:
// GPS course while moving (accurate, direction of travel), the phone
// compass while stationary (GPS course wanders when parked). Pure so
// the choice is unit-testable; App.tsx owns the sensors.

export type BearingSource = "gps" | "compass";

export type BearingChoice = {
  source: BearingSource | null;
  /** The heading to ease the map bearing toward, or null to hold. */
  heading: number | null;
};

/** Below this speed GPS course is noise; at/above it, GPS wins. */
export const GPS_COURSE_MIN_MPH = 3;

export function selectBearingSource(args: {
  speedMph: number | null;
  gpsHeading: number | null;
  compassHeading: number | null;
  compassOn: boolean;
}): BearingChoice {
  const { speedMph, gpsHeading, compassHeading, compassOn } = args;
  if (speedMph != null && speedMph >= GPS_COURSE_MIN_MPH && gpsHeading != null) {
    return { source: "gps", heading: gpsHeading };
  }
  if (compassOn && compassHeading != null) {
    return { source: "compass", heading: compassHeading };
  }
  // Moving slowly with no compass (or no heading at all): hold the
  // current bearing — a parked truck never spins its own map.
  return { source: null, heading: null };
}
