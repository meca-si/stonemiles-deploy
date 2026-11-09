// Unit tests for the server side of map display preferences
// (server/src/mapPrefs.ts) — defaults, the save/load round-trip the
// getAppSettings/saveAppSettings actions run, and per-account
// isolation. Run: bun test server/src/mapPrefs.test.ts
//
// Isolation note: prefs live on the account's own single app_settings
// row (id = 1) in the account's own database — there is no shared or
// global prefs state anywhere in the module (these helpers are pure
// functions of the row they're handed). The isolation test below pins
// that contract: mapping account A's row can never surface account
// B's choices, and an account with no row gets the shipped defaults,
// not anyone else's setup.

import { describe, expect, test } from "bun:test";
import {
MAP_PREFS_DEFAULTS,
mapPrefsFromRow,
mapPrefsToRow,
type MapPrefs,
} from "./mapPrefs";

describe("defaults equal today's map", () => {
  test("everything on, streets base", () => {
    expect(MAP_PREFS_DEFAULTS).toEqual({
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
    });
  });
  test("an account that never saved gets the defaults", () => {
    expect(mapPrefsFromRow(null)).toEqual(MAP_PREFS_DEFAULTS);
    expect(mapPrefsFromRow(undefined)).toEqual(MAP_PREFS_DEFAULTS);
  });
});

describe("preference round-trip (set → reload → same setup)", () => {
  test("prefs → row → prefs is identity", () => {
    const chosen: MapPrefs = {
      mapBaseStyle: "satellite",
      mapDayNightMode: "off",
      mapShowFuel: false,
      mapShowParking: false,
      mapShowHazards: true,
      mapShowIntel: false,
      mapShowRoute: true,
      mapShowSpeed: false,
      mapShowLabels: true,
      mapShowTrafficNotes: false,
      mapShowSignals: false,
      mapShowRadar: true,
      driveShowWeather: false,
      driveShowBigPrompts: false,
      driveShowTrafficLegend: true,
      driveShowEtaPill: false,
      driveGlassLevel: "high",
      mapEnhancedView: false,
      mapTiltMode: "tilted",
    };
    expect(mapPrefsFromRow(mapPrefsToRow(chosen))).toEqual(chosen);
    expect(mapPrefsFromRow(mapPrefsToRow(MAP_PREFS_DEFAULTS))).toEqual(MAP_PREFS_DEFAULTS);
  });
  test("traffic notes default ON and an explicit off round-trips", () => {
    // No row / column unset → today's behavior (notes shown).
    expect(MAP_PREFS_DEFAULTS.mapShowTrafficNotes).toBe(true);
    expect(mapPrefsFromRow(null).mapShowTrafficNotes).toBe(true);
    // Explicit false survives the save → reload round-trip.
    const off: MapPrefs = { ...MAP_PREFS_DEFAULTS, mapShowTrafficNotes: false };
    expect(mapPrefsFromRow(mapPrefsToRow(off)).mapShowTrafficNotes).toBe(false);
  });
  test("radar defaults OFF and an explicit on round-trips", () => {
    expect(MAP_PREFS_DEFAULTS.mapShowRadar).toBe(false);
    expect(mapPrefsFromRow(null).mapShowRadar).toBe(false);
    const on: MapPrefs = { ...MAP_PREFS_DEFAULTS, mapShowRadar: true };
    expect(mapPrefsFromRow(mapPrefsToRow(on)).mapShowRadar).toBe(true);
  });
  test("a legacy row with an unknown base style reads as streets", () => {
    const row = { ...mapPrefsToRow(MAP_PREFS_DEFAULTS), mapBaseStyle: "bogus" };
    expect(mapPrefsFromRow(row).mapBaseStyle).toBe("streets");
  });
  test("day/night defaults to Auto and an explicit Off round-trips", () => {
    expect(MAP_PREFS_DEFAULTS.mapDayNightMode).toBe("auto");
    expect(mapPrefsFromRow(null).mapDayNightMode).toBe("auto");
    for (const mode of ["auto", "day", "night", "off"] as const) {
      const prefs: MapPrefs = { ...MAP_PREFS_DEFAULTS, mapDayNightMode: mode };
      expect(mapPrefsFromRow(mapPrefsToRow(prefs)).mapDayNightMode).toBe(mode);
    }
    // A bogus stored value reads as Auto, never a broken state.
    const row = { ...mapPrefsToRow(MAP_PREFS_DEFAULTS), mapDayNightMode: "bogus" };
    expect(mapPrefsFromRow(row).mapDayNightMode).toBe("auto");
  });
});

describe("drive-screen overlays (migration 0095, Repair 5)", () => {
  test("the standard layout: legend OFF, the rest on, glass Med", () => {
    expect(MAP_PREFS_DEFAULTS.driveShowTrafficLegend).toBe(false);
    expect(MAP_PREFS_DEFAULTS.driveShowWeather).toBe(true);
    expect(MAP_PREFS_DEFAULTS.driveShowBigPrompts).toBe(true);
    expect(MAP_PREFS_DEFAULTS.driveShowEtaPill).toBe(true);
    expect(MAP_PREFS_DEFAULTS.driveGlassLevel).toBe("med");
    // An account that never saved gets the standard layout.
    expect(mapPrefsFromRow(null).driveShowTrafficLegend).toBe(false);
  });
  test("per-driver choices round-trip through the row (persistence)", () => {
    const chosen: MapPrefs = {
      ...MAP_PREFS_DEFAULTS,
      driveShowWeather: false,
      driveShowBigPrompts: false,
      driveShowTrafficLegend: true,
      driveShowEtaPill: false,
      driveGlassLevel: "high",
    };
    expect(mapPrefsFromRow(mapPrefsToRow(chosen))).toEqual(chosen);
  });
  test("a bogus stored glass level reads as Med, never a broken state", () => {
    const row = { ...mapPrefsToRow(MAP_PREFS_DEFAULTS), driveGlassLevel: "bogus" };
    expect(mapPrefsFromRow(row).driveGlassLevel).toBe("med");
  });
});

describe("enhanced map view (migration 0100)", () => {
  test("defaults ship the feature ON with tilt Auto", () => {
    expect(MAP_PREFS_DEFAULTS.mapEnhancedView).toBe(true);
    expect(MAP_PREFS_DEFAULTS.mapTiltMode).toBe("auto");
    expect(mapPrefsFromRow(null).mapEnhancedView).toBe(true);
  });
  test("removal OFF and every tilt choice round-trip through the row", () => {
    const off: MapPrefs = { ...MAP_PREFS_DEFAULTS, mapEnhancedView: false };
    expect(mapPrefsFromRow(mapPrefsToRow(off)).mapEnhancedView).toBe(false);
    for (const mode of ["auto", "flat", "tilted"] as const) {
      const prefs: MapPrefs = { ...MAP_PREFS_DEFAULTS, mapTiltMode: mode };
      expect(mapPrefsFromRow(mapPrefsToRow(prefs)).mapTiltMode).toBe(mode);
    }
  });
  test("a bogus stored tilt mode reads as Auto, never a broken state", () => {
    const row = { ...mapPrefsToRow(MAP_PREFS_DEFAULTS), mapTiltMode: "bogus" };
    expect(mapPrefsFromRow(row).mapTiltMode).toBe("auto");
  });
});

describe("per-account isolation", () => {
  test("one driver's row never leaks into another's", () => {
    const driverA = mapPrefsToRow({
      ...MAP_PREFS_DEFAULTS,
      mapBaseStyle: "hybrid",
      mapShowFuel: false,
      mapShowSpeed: false,
    });
    const driverB = mapPrefsToRow({ ...MAP_PREFS_DEFAULTS });
    const a = mapPrefsFromRow(driverA);
    const b = mapPrefsFromRow(driverB);
    expect(a.mapBaseStyle).toBe("hybrid");
    expect(a.mapShowFuel).toBe(false);
    // B is untouched by A's choices — and vice versa on re-read.
    expect(b).toEqual(MAP_PREFS_DEFAULTS);
    expect(mapPrefsFromRow(driverA)).toEqual(a);
  });
});
