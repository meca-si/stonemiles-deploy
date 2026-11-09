// Unit tests for map display preferences (client/src/mapPrefs.ts) —
// the production logic behind the Layers & display panel: defaults,
// preference round-trip, hidden-category absence, and heading-source
// selection for heading-up rotation.
// Run: bun test client/src/mapPrefs.test.ts

import { describe, expect, test } from "bun:test";
import {
DRIVE_TILT_PITCH_DEG,
MAP_LAYER_CATEGORIES,
MAP_PREFS_DEFAULTS,
effectiveBaseStyle,
effectivePitchDeg,
intelCategory,
isIntelVisible,
isSatelliteStyle,
nextTiltMode,
normalizeMapPrefs,
offlineAutoSwitchApplies,
resolveMapDayNight,
satelliteFallbackActive,
selectBearingSource,
sunAltitudeDeg,
sunTimes,
tiltActive,
trafficLiveRefreshEnabled,
trafficNotesVisible,
visibleMapLayers,
type MapPrefs,
} from "./mapPrefs";

describe("defaults equal today's map", () => {
  test("everything on, streets base", () => {
    expect(MAP_PREFS_DEFAULTS).toEqual({
      baseStyle: "streets",
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
    });
  });
  test("normalize of nothing is the defaults", () => {
    expect(normalizeMapPrefs(null)).toEqual(MAP_PREFS_DEFAULTS);
    expect(normalizeMapPrefs(undefined)).toEqual(MAP_PREFS_DEFAULTS);
    expect(normalizeMapPrefs({})).toEqual(MAP_PREFS_DEFAULTS);
  });
  test("defaults draw every category except radar (an opt-in overlay)", () => {
    const vis = visibleMapLayers(MAP_PREFS_DEFAULTS);
    for (const c of MAP_LAYER_CATEGORIES) {
      if (c.key === "radar") expect(vis.has(c.key)).toBe(false);
      else expect(vis.has(c.key)).toBe(true);
    }
    expect(vis.size).toBe(MAP_LAYER_CATEGORIES.length - 1);
    // Turning radar on draws it like any other category.
    expect(visibleMapLayers(normalizeMapPrefs({ showRadar: true })).has("radar")).toBe(true);
  });
});

describe("preference round-trip", () => {
  test("set → normalize → same setup", () => {
    const chosen: MapPrefs = {
      baseStyle: "hybrid",
      dayNightMode: "night",
      showFuel: false,
      showParking: true,
      showHazards: false,
      showIntel: true,
      showRoute: false,
      showSpeed: false,
      showLabels: false,
      showTrafficNotes: false,
      showSignals: false,
      showRadar: true,
      showDriveWeather: false,
      showBigPrompts: false,
      showTrafficLegend: true,
      showEtaPill: false,
      driveGlassLevel: "high",
      enhancedMap: false,
      tiltMode: "flat",
    };
    expect(normalizeMapPrefs(chosen)).toEqual(chosen);
    // Idempotent: a saved setup reloaded passes through unchanged.
    expect(normalizeMapPrefs(normalizeMapPrefs(chosen))).toEqual(chosen);
  });
  test("partial / stale cache merges over defaults, never half-broken", () => {
    const merged = normalizeMapPrefs({ showFuel: false, baseStyle: "satellite" });
    expect(merged.showFuel).toBe(false);
    expect(merged.baseStyle).toBe("satellite");
    expect(merged.showHazards).toBe(true);
    expect(merged.showSpeed).toBe(true);
  });
  test("invalid values fall back per-field", () => {
    const merged = normalizeMapPrefs({
      baseStyle: "bogus" as MapPrefs["baseStyle"],
      showFuel: "yes" as unknown as boolean,
    });
    expect(merged.baseStyle).toBe("streets");
    expect(merged.showFuel).toBe(true);
  });
});

describe("a hidden category is absent from drawn layers", () => {
  test("turning one category off removes exactly that layer", () => {
    // Baseline: defaults draw everything except radar (opt-in).
    const baseSize = visibleMapLayers(MAP_PREFS_DEFAULTS).size;
    for (const c of MAP_LAYER_CATEGORIES) {
      const prefs = normalizeMapPrefs({ showRadar: true, [c.pref]: false });
      const vis = visibleMapLayers(prefs);
      expect(vis.has(c.key)).toBe(false);
      expect(vis.size).toBe(MAP_LAYER_CATEGORIES.length - 1);
      void baseSize;
    }
  });
  test("parking intel obeys the parking switch, not the intel switch", () => {
    expect(intelCategory("parking_open")).toBe("parking");
    expect(intelCategory("parking_full")).toBe("parking");
    expect(intelCategory("road_closed")).toBe("intel");
    const noParking = normalizeMapPrefs({ showParking: false });
    expect(isIntelVisible("parking_open", noParking)).toBe(false);
    expect(isIntelVisible("parking_full", noParking)).toBe(false);
    expect(isIntelVisible("road_closed", noParking)).toBe(true);
    const noIntel = normalizeMapPrefs({ showIntel: false });
    expect(isIntelVisible("crash", noIntel)).toBe(false);
    expect(isIntelVisible("parking_open", noIntel)).toBe(true);
  });
});

describe("traffic notes display gate", () => {
  test("defaults ON — notes shown exactly as today", () => {
    expect(normalizeMapPrefs(null).showTrafficNotes).toBe(true);
    expect(normalizeMapPrefs({}).showTrafficNotes).toBe(true);
    expect(trafficNotesVisible(MAP_PREFS_DEFAULTS)).toBe(true);
    expect(trafficNotesVisible(normalizeMapPrefs({}))).toBe(true);
  });
  test("explicit false is preserved and round-trips", () => {
    const off = normalizeMapPrefs({ showTrafficNotes: false });
    expect(off.showTrafficNotes).toBe(false);
    expect(normalizeMapPrefs(off)).toEqual(off);
    expect(trafficNotesVisible(off)).toBe(false);
  });
  test("OFF suppresses traffic notes but never hazard visibility", () => {
    const off = normalizeMapPrefs({ showTrafficNotes: false });
    // Traffic notes suppressed for route cards + scan-ahead display…
    expect(trafficNotesVisible(off)).toBe(false);
    // …while hazard/intel drawing is completely unaffected.
    const vis = visibleMapLayers(off);
    expect(vis.has("hazards")).toBe(true);
    expect(vis.size).toBe(MAP_LAYER_CATEGORIES.length - 1); // all but radar (opt-in, off by default)
    expect(isIntelVisible("crash", off)).toBe(true);
    expect(isIntelVisible("parking_open", off)).toBe(true);
    // Traffic notes are not a map layer: no category exists for them.
    expect(MAP_LAYER_CATEGORIES.some((c) => (c.pref as string) === "showTrafficNotes")).toBe(false);
  });
});

describe("traffic live-refresh poll gate (2026-11-02 repair)", () => {
  test("defaults ON — the poll runs exactly as it did before the repair", () => {
    expect(trafficLiveRefreshEnabled(MAP_PREFS_DEFAULTS)).toBe(true);
    expect(trafficLiveRefreshEnabled(normalizeMapPrefs({}))).toBe(true);
    expect(trafficLiveRefreshEnabled(normalizeMapPrefs(null))).toBe(true);
  });
  test("display OFF stops the poll — the refresh effect installs no timer and fetches nothing", () => {
    const off = normalizeMapPrefs({ showTrafficNotes: false });
    expect(trafficLiveRefreshEnabled(off)).toBe(false);
  });
  test("turning the display back ON resumes the poll", () => {
    const off = normalizeMapPrefs({ showTrafficNotes: false });
    expect(trafficLiveRefreshEnabled(off)).toBe(false);
    const backOn = normalizeMapPrefs({ ...off, showTrafficNotes: true });
    expect(trafficLiveRefreshEnabled(backOn)).toBe(true);
  });
  test("the poll gate is the same switch as the display gate, in both positions", () => {
    for (const p of [
      MAP_PREFS_DEFAULTS,
      normalizeMapPrefs({ showTrafficNotes: false }),
      normalizeMapPrefs({ showTrafficNotes: true }),
    ]) {
      expect(trafficLiveRefreshEnabled(p)).toBe(trafficNotesVisible(p));
    }
  });
});

describe("GPS day / night mode", () => {
  // Theodore, AL — the driver's home ground.
  const LAT = 30.669;
  const LON = -88.183;
  test("default is Auto, and every mode round-trips", () => {
    expect(MAP_PREFS_DEFAULTS.dayNightMode).toBe("auto");
    expect(normalizeMapPrefs(null).dayNightMode).toBe("auto");
    for (const mode of ["auto", "day", "night", "off"] as const) {
      expect(normalizeMapPrefs({ dayNightMode: mode }).dayNightMode).toBe(mode);
      expect(normalizeMapPrefs(normalizeMapPrefs({ dayNightMode: mode })).dayNightMode).toBe(mode);
    }
    // A bogus stored value falls back to Auto, never a broken state.
    expect(normalizeMapPrefs({ dayNightMode: "bogus" as MapPrefs["dayNightMode"] }).dayNightMode).toBe("auto");
  });
  test("Off never switches: it resolves to the standard day look at any hour", () => {
    const night = new Date("2026-11-01T06:00:00Z"); // 1 AM local in Theodore
    expect(resolveMapDayNight("off", { now: night, lat: LAT, lon: LON })).toEqual({
      theme: "day",
      source: "off",
      nextChange: null,
    });
  });
  test("Day and Night pin the look regardless of the sun", () => {
    const noon = new Date("2026-10-31T17:00:00Z");
    const night = new Date("2026-11-01T06:00:00Z");
    expect(resolveMapDayNight("day", { now: night, lat: LAT, lon: LON }).theme).toBe("day");
    expect(resolveMapDayNight("night", { now: noon, lat: LAT, lon: LON }).theme).toBe("night");
  });
  test("Auto follows the real sun at the truck's position", () => {
    const noon = resolveMapDayNight("auto", { now: new Date("2026-10-31T17:00:00Z"), lat: LAT, lon: LON });
    expect(noon.theme).toBe("day");
    expect(noon.source).toBe("sun");
    // The day resolution names the coming sunset as the next flip.
    expect(noon.nextChange?.getTime()).toBeGreaterThan(new Date("2026-10-31T17:00:00Z").getTime());
    const wee = resolveMapDayNight("auto", { now: new Date("2026-11-01T06:00:00Z"), lat: LAT, lon: LON });
    expect(wee.theme).toBe("night");
    expect(wee.source).toBe("sun");
    // After midnight, the next flip is the COMING sunrise, not yesterday's.
    expect(wee.nextChange?.getTime()).toBeGreaterThan(new Date("2026-11-01T06:00:00Z").getTime());
  });
  test("Auto without a position falls back to the device clock (7 AM–7 PM = day)", () => {
    const midday = resolveMapDayNight("auto", { now: new Date(2026, 9, 31, 12, 0), lat: null, lon: null });
    expect(midday).toEqual({ theme: "day", source: "clock", nextChange: null });
    const late = resolveMapDayNight("auto", { now: new Date(2026, 9, 31, 23, 0), lat: null, lon: null });
    expect(late.theme).toBe("night");
    expect(late.source).toBe("clock");
  });
  test("solar math matches the real sky over Theodore, AL (Oct 31, 2026)", () => {
    const times = sunTimes(new Date("2026-10-31T12:00:00Z"), LAT, LON);
    expect(times).not.toBeNull();
    // Published: sunrise ≈ 7:09 AM CDT (12:09 UTC), sunset ≈ 6:04 PM CDT (23:04 UTC).
    expect(times!.sunrise.getUTCHours()).toBe(12);
    expect(Math.abs(times!.sunrise.getUTCMinutes() - 9)).toBeLessThanOrEqual(6);
    expect(times!.sunset.getUTCHours()).toBe(23);
    expect(Math.abs(times!.sunset.getUTCMinutes() - 4)).toBeLessThanOrEqual(6);
    expect(sunAltitudeDeg(new Date("2026-10-31T17:00:00Z"), LAT, LON)).toBeGreaterThan(0);
    expect(sunAltitudeDeg(new Date("2026-11-01T06:00:00Z"), LAT, LON)).toBeLessThan(0);
    expect(sunAltitudeDeg(new Date(), 999, 0)).toBeNull();
    expect(sunTimes(new Date(), 0, 999)).toBeNull();
  });
});

describe("bearing source selection (heading-up)", () => {
  test("GPS course wins while moving", () => {
    expect(
      selectBearingSource({ speedMph: 55, gpsHeading: 90, compassHeading: 200, compassOn: true }),
    ).toEqual({ source: "gps", heading: 90 });
    expect(
      selectBearingSource({ speedMph: 3, gpsHeading: 45, compassHeading: 200, compassOn: true }),
    ).toEqual({ source: "gps", heading: 45 });
  });
  test("compass takes over while stationary, only when enabled", () => {
    expect(
      selectBearingSource({ speedMph: 0, gpsHeading: 90, compassHeading: 200, compassOn: true }),
    ).toEqual({ source: "compass", heading: 200 });
    expect(
      selectBearingSource({ speedMph: null, gpsHeading: null, compassHeading: 200, compassOn: true }),
    ).toEqual({ source: "compass", heading: 200 });
  });
  test("no source → hold (a parked truck never spins its map)", () => {
    expect(
      selectBearingSource({ speedMph: 0, gpsHeading: 90, compassHeading: 200, compassOn: false }),
    ).toEqual({ source: null, heading: null });
    expect(
      selectBearingSource({ speedMph: 1, gpsHeading: null, compassHeading: null, compassOn: true }),
    ).toEqual({ source: null, heading: null });
  });
  test("moving with no GPS heading falls back to compass", () => {
    expect(
      selectBearingSource({ speedMph: 40, gpsHeading: null, compassHeading: 270, compassOn: true }),
    ).toEqual({ source: "compass", heading: 270 });
  });
});

describe("enhanced map view — removal (Settings switch, 2026-11-06)", () => {
  const satTilted: MapPrefs = { ...MAP_PREFS_DEFAULTS, baseStyle: "satellite", tiltMode: "tilted" };

  test("defaults ship the feature ON with tilt Auto", () => {
    expect(MAP_PREFS_DEFAULTS.enhancedMap).toBe(true);
    expect(MAP_PREFS_DEFAULTS.tiltMode).toBe("auto");
  });
  test("OFF collapses the drawn style to streets but never rewrites the stored choice", () => {
    const off: MapPrefs = { ...satTilted, enhancedMap: false };
    expect(effectiveBaseStyle(off)).toBe("streets");
    expect(off.baseStyle).toBe("satellite"); // stored choice untouched
    // And back on, the driver's setup returns exactly.
    expect(effectiveBaseStyle({ ...off, enhancedMap: true })).toBe("satellite");
  });
  test("OFF forces the camera flat on both faces, whatever the tilt choice", () => {
    const off: MapPrefs = { ...satTilted, enhancedMap: false };
    expect(effectivePitchDeg(off, "go")).toBe(0);
    expect(effectivePitchDeg(off, "explore")).toBe(0);
    expect(tiltActive(off, "go")).toBe(false);
  });
  test("a stale cache without the new fields keeps the feature (normalize)", () => {
    const legacy = { baseStyle: "satellite" } as Partial<MapPrefs>;
    const n = normalizeMapPrefs(legacy);
    expect(n.enhancedMap).toBe(true);
    expect(n.tiltMode).toBe("auto");
    // Only an explicit false removes it; a bogus tilt mode reads as auto.
    expect(normalizeMapPrefs({ enhancedMap: false }).enhancedMap).toBe(false);
    expect(normalizeMapPrefs({ tiltMode: "bogus" as MapPrefs["tiltMode"] }).tiltMode).toBe("auto");
  });
  test("choices round-trip through normalize unchanged", () => {
    for (const tiltMode of ["auto", "flat", "tilted"] as const) {
      const p = normalizeMapPrefs({ enhancedMap: false, tiltMode });
      expect(normalizeMapPrefs(p)).toEqual(p);
    }
  });
});

describe("enhanced map view — tilted camera", () => {
  test("Auto is the shipped faces: Go leans at the driving pitch, Explore flat", () => {
    expect(DRIVE_TILT_PITCH_DEG).toBe(55);
    expect(effectivePitchDeg(MAP_PREFS_DEFAULTS, "go")).toBe(55);
    expect(effectivePitchDeg(MAP_PREFS_DEFAULTS, "explore")).toBe(0);
  });
  test("Flat pins top-down everywhere; Tilted leans everywhere", () => {
    const flat: MapPrefs = { ...MAP_PREFS_DEFAULTS, tiltMode: "flat" };
    const tilted: MapPrefs = { ...MAP_PREFS_DEFAULTS, tiltMode: "tilted" };
    expect(effectivePitchDeg(flat, "go")).toBe(0);
    expect(effectivePitchDeg(flat, "explore")).toBe(0);
    expect(effectivePitchDeg(tilted, "go")).toBe(55);
    expect(effectivePitchDeg(tilted, "explore")).toBe(55);
  });
  test("tilt is style-independent — the same pitch on streets, satellite, hybrid", () => {
    for (const baseStyle of ["streets", "satellite", "hybrid"] as const) {
      const p: MapPrefs = { ...MAP_PREFS_DEFAULTS, baseStyle, tiltMode: "tilted" };
      expect(effectivePitchDeg(p, "explore")).toBe(55);
      expect(effectivePitchDeg(p, "go")).toBe(55);
    }
  });
  test("the rail Tilt button flips from the CURRENT camera, either face", () => {
    // Auto + Explore (flat) → the button leans in; Auto + Go (leaned) → flattens.
    expect(nextTiltMode(MAP_PREFS_DEFAULTS, "explore")).toBe("tilted");
    expect(nextTiltMode(MAP_PREFS_DEFAULTS, "go")).toBe("flat");
    // And the pinned states flip back.
    expect(nextTiltMode({ ...MAP_PREFS_DEFAULTS, tiltMode: "tilted" }, "go")).toBe("flat");
    expect(nextTiltMode({ ...MAP_PREFS_DEFAULTS, tiltMode: "flat" }, "go")).toBe("tilted");
  });
});

describe("enhanced map view — satellite offline honesty", () => {
  const sat: MapPrefs = { ...MAP_PREFS_DEFAULTS, baseStyle: "satellite" };
  const hyb: MapPrefs = { ...MAP_PREFS_DEFAULTS, baseStyle: "hybrid" };

  test("satellite family = satellite + hybrid, never streets", () => {
    expect(isSatelliteStyle("satellite")).toBe(true);
    expect(isSatelliteStyle("hybrid")).toBe(true);
    expect(isSatelliteStyle("streets")).toBe(false);
  });
  test("online with satellite chosen: no fallback — the imagery is real", () => {
    expect(satelliteFallbackActive({ prefs: sat, isOnline: true, offlineBaseOn: false })).toBe(false);
    expect(satelliteFallbackActive({ prefs: hyb, isOnline: true, offlineBaseOn: false })).toBe(false);
  });
  test("signal loss with satellite chosen: fallback is active (toggle must not claim satellite)", () => {
    expect(satelliteFallbackActive({ prefs: sat, isOnline: false, offlineBaseOn: false })).toBe(true);
    expect(satelliteFallbackActive({ prefs: sat, isOnline: false, offlineBaseOn: true })).toBe(true);
    expect(satelliteFallbackActive({ prefs: hyb, isOnline: false, offlineBaseOn: true })).toBe(true);
  });
  test("the manual offline base under satellite is also a fallback, even online", () => {
    expect(satelliteFallbackActive({ prefs: sat, isOnline: true, offlineBaseOn: true })).toBe(true);
  });
  test("streets never falls back, and neither does a removed feature", () => {
    expect(satelliteFallbackActive({ prefs: MAP_PREFS_DEFAULTS, isOnline: false, offlineBaseOn: true })).toBe(false);
    expect(satelliteFallbackActive({ prefs: { ...sat, enhancedMap: false }, isOnline: false, offlineBaseOn: true })).toBe(false);
  });
  test("auto-switch: the shipped saved-route rule is unchanged for streets", () => {
    expect(offlineAutoSwitchApplies({ prefs: MAP_PREFS_DEFAULTS, isOnline: false, hasSavedRoutes: true })).toBe(true);
    expect(offlineAutoSwitchApplies({ prefs: MAP_PREFS_DEFAULTS, isOnline: false, hasSavedRoutes: false })).toBe(false);
    expect(offlineAutoSwitchApplies({ prefs: MAP_PREFS_DEFAULTS, isOnline: true, hasSavedRoutes: true })).toBe(false);
  });
  test("auto-switch: satellite loses signal → offline base even with NO saved route", () => {
    expect(offlineAutoSwitchApplies({ prefs: sat, isOnline: false, hasSavedRoutes: false })).toBe(true);
    expect(offlineAutoSwitchApplies({ prefs: hyb, isOnline: false, hasSavedRoutes: false })).toBe(true);
    // …but never while online, and never once the feature is removed.
    expect(offlineAutoSwitchApplies({ prefs: sat, isOnline: true, hasSavedRoutes: false })).toBe(false);
    expect(offlineAutoSwitchApplies({ prefs: { ...sat, enhancedMap: false }, isOnline: false, hasSavedRoutes: false })).toBe(false);
  });
});
