// Unit tests for the Drive/GPS screen customization (Repair 5,
// driver order 2026-11-03 ~23:28 CT): see-through by default, and
// per-driver show/hide + transparency + reset-to-standard.
//
// Pins:
//   - the default see-through styling: every level's panel alpha is
//     translucent (< 1, no fully solid box), Med is the standard,
//     and theme.css mirrors the code's alphas exactly (the
//     mapPopup.test.ts no-drift pattern);
//   - the big prompt cards' translucent treatment in
//     SignCheckPrompt.tsx (no solid #0b3d24 / 0.96 fills return);
//   - toggle behavior at the production gate: a hidden overlay is
//     absent from visibleDriveOverlays and from App.tsx's renders,
//     which all consult driveVis;
//   - App.tsx wires the settings section, the scope attribute, and
//     the one-tap reset to the standard layout.
// Per-driver PERSISTENCE (save → reload → same layout, per-account
// isolation) is pinned server-side in server/src/mapPrefs.test.ts.
//
// Run: bun test client/src/driveScreen.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  DRIVE_GLASS_PANEL_ALPHA,
  DRIVE_GLASS_SOLID_ALPHA,
  DRIVE_OVERLAYS,
  DRIVE_PROMPT_ALPHA,
  SPEED_DISPLAY_OFFSET_MPH,
  STANDARD_DRIVE_LAYOUT,
  displayedSpeedMph,
  driveGlassCssVar,
  isStandardDriveLayout,
  promptCardBg,
  visibleDriveOverlays,
} from "./driveScreen";
import { MAP_PREFS_DEFAULTS, normalizeMapPrefs } from "./mapPrefs";

const appSource = readFileSync(`${import.meta.dir}/App.tsx`, "utf8");
const css = readFileSync(`${import.meta.dir}/theme.css`, "utf8");
const promptSource = readFileSync(`${import.meta.dir}/SignCheckPrompt.tsx`, "utf8");

describe("see-through by default", () => {
  test("every level is translucent — no fully solid box at any setting", () => {
    for (const lv of ["low", "med", "high"] as const) {
      expect(DRIVE_GLASS_PANEL_ALPHA[lv]).toBeLessThan(1);
      expect(DRIVE_GLASS_SOLID_ALPHA[lv]).toBeLessThan(1);
      expect(DRIVE_GLASS_PANEL_ALPHA[lv]).toBeGreaterThan(0);
    }
    // More see-through as the level rises; Med is the standard.
    expect(DRIVE_GLASS_PANEL_ALPHA.low).toBeGreaterThan(DRIVE_GLASS_PANEL_ALPHA.med);
    expect(DRIVE_GLASS_PANEL_ALPHA.med).toBeGreaterThan(DRIVE_GLASS_PANEL_ALPHA.high);
    expect(MAP_PREFS_DEFAULTS.driveGlassLevel).toBe("med");
  });

  test("theme.css mirrors the code's panel alphas for .drive-scope (no drift)", () => {
    for (const lv of ["low", "med", "high"] as const) {
      const block = new RegExp(`\\.drive-scope\\[data-drive-glass="${lv}"\\] \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
      expect(block).toContain(`--glass: ${driveGlassCssVar(lv)}`);
      const pill = new RegExp(`\\.drive-scope\\[data-drive-glass="${lv}"\\] \\.glass-pill \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
      expect(pill).toContain(`rgba(10, 16, 34, ${DRIVE_GLASS_PANEL_ALPHA[lv]})`);
    }
    // Overlay text carries a halo inside the scope (contrast rides
    // on the letters, not a solid box).
    expect(css).toContain(".drive-scope .glass-panel,");
    expect(css).toContain("text-shadow: 0 1px 3px rgba(0, 0, 0, 0.55)");
  });

  test("the map wrapper carries the scope + the driver's level", () => {
    expect(appSource).toContain("data-drive-glass={driveGlassLevel}");
    expect(appSource).toContain("drive-scope");
  });

  test("big prompt cards are translucent with a blur + halo — no solid fills", () => {
    expect(promptSource).not.toContain('background: "#0b3d24", borderColor');
    expect(promptSource).not.toContain("rgba(8,13,28,0.96)");
    expect(promptSource).toContain('backdropFilter: "blur(8px)"');
    expect(promptSource).toContain("textShadow:");
  });

  test("big prompt cards follow the selected see-through level (Low/Med/High differ)", () => {
    // Distinct alpha per level; Med is the standard the cards
    // shipped with; every level stays translucent.
    expect(DRIVE_PROMPT_ALPHA).toEqual({ low: 0.9, med: 0.8, high: 0.66 });
    expect(promptCardBg("low", "11, 61, 36")).toBe("rgba(11, 61, 36, 0.9)");
    expect(promptCardBg("med", "11, 61, 36")).toBe("rgba(11, 61, 36, 0.8)");
    expect(promptCardBg("high", "8, 13, 28")).toBe("rgba(8, 13, 28, 0.66)");
    // Both card variants build their fill from the level…
    expect(promptSource).toContain('promptCardBg(glassLevel, "11, 61, 36")');
    expect(promptSource).toContain('promptCardBg(glassLevel, "8, 13, 28")');
    // …and every driving render passes the driver's level in.
    expect(appSource.split("glassLevel={driveGlassLevel}").length - 1).toBe(4);
  });

  test("the listed solid-looking controls ride the level's solid alpha", () => {
    // Trip-tab End Route, Full screen, right rail. (The map's own
    // End route button and the MPH speed bubble were removed on
    // x's 2026-11-09 order — End route lives in the pull-up trip
    // tab, the map keeps only the posted LIMIT sign, and the
    // weather chip took the button's bottom-right spot.)
    expect(appSource).toContain('driveSolidBg(driveGlassLevel, "190, 28, 28")');
    expect(appSource).toContain('driveSolidBg(driveGlassLevel, "0, 0, 0")');
    expect(appSource).not.toContain('driveSolidBg(driveGlassLevel, "127, 29, 29")');
  });
});

describe("toggle behavior — a hidden element simply doesn't render", () => {
  test("each overlay's switch removes exactly that overlay from the visible set", () => {
    const base = visibleDriveOverlays(normalizeMapPrefs(null));
    for (const o of DRIVE_OVERLAYS) {
      const prefs = normalizeMapPrefs({ showTrafficLegend: true, [o.pref]: false });
      const vis = visibleDriveOverlays(prefs);
      expect(vis.has(o.key)).toBe(false);
      for (const other of DRIVE_OVERLAYS) {
        if (other.key !== o.key) expect(vis.has(other.key)).toBe(true);
      }
      expect(base.has(o.key)).toBe(o.key !== "trafficLegend");
    }
  });

  test("App.tsx gates every toggleable render on the same visible set", () => {
    expect(appSource).toContain('driveVis.has("weather")');
    expect(appSource).toContain('driveVis.has("bigPrompts")');
    expect(appSource).toContain('driveVis.has("etaPill")');
    expect(appSource).toContain('driveVis.has("trafficLegend")');
    // Speed/LIMIT rides the existing single speed switch.
    expect(appSource).toContain("mapPrefs.showSpeed &&");
  });

  test("the settings section offers every overlay + the level + reset", () => {
    expect(appSource).toContain('aria-label="Drive screen see-through level"');
    for (const o of DRIVE_OVERLAYS) {
      expect(appSource).toContain("DRIVE_OVERLAYS");
      expect(o.field.length).toBeGreaterThan(0);
    }
    expect(appSource).toContain("Reset to standard layout");
    expect(appSource).toContain("updateAppSettings({ ...STANDARD_DRIVE_LAYOUT })");
  });
});

describe("speed readout offset (x's order 2026-11-09: match my dash)", () => {
  test("the readout is the GPS speed PLUS 3 mph — the app read 3 under his dash", () => {
    expect(SPEED_DISPLAY_OFFSET_MPH).toBe(3);
    // His own screenshots: GPS said 67, the dash said 70.
    expect(displayedSpeedMph(67)).toBe(70);
    expect(displayedSpeedMph(70)).toBe(73);
    expect(displayedSpeedMph(65.4)).toBeCloseTo(68.4);
    expect(displayedSpeedMph(3)).toBe(6);
    expect(displayedSpeedMph(1)).toBe(4);
    // Parked still reads parked — the offset never invents motion.
    expect(displayedSpeedMph(0)).toBe(0);
  });

  test("App.tsx routes every own-speed readout through the offset — limits stay true", () => {
    // The display-unit helper for the truck's OWN speed exists and
    // applies the offset before the unit conversion.
    expect(appSource).toContain("dispSpeed(displayedSpeedMph(mph))");
    // The Drive panel readout and the alert banners print it (the
    // map's own MPH bubble was removed 2026-11-09 — limit only).
    expect(appSource).toContain("speedMph != null ? dispOwnSpeed(speedMph) : \"––\"");
    expect(appSource).toContain("speedMph != null ? dispOwnSpeed(speedMph) : \"—\"");
    // Posted limits still print through the unshifted helper.
    expect(appSource).toContain("dispSpeed(speedLimit)");
    expect(appSource).toContain("dispSpeed(alertLimit)");
  });
});

describe("reset to the standard layout", () => {
  test("the standard is tonight's verdict: legend OFF, rest on, glass Med", () => {
    expect(STANDARD_DRIVE_LAYOUT).toEqual({
      driveShowWeather: true,
      driveShowBigPrompts: true,
      driveShowTrafficLegend: false,
      driveShowEtaPill: true,
      driveGlassLevel: "med",
      mapShowSpeed: true,
    });
    expect(isStandardDriveLayout(STANDARD_DRIVE_LAYOUT)).toBe(true);
    expect(isStandardDriveLayout({ ...STANDARD_DRIVE_LAYOUT, driveShowTrafficLegend: true })).toBe(false);
    expect(isStandardDriveLayout({ ...STANDARD_DRIVE_LAYOUT, driveGlassLevel: "high" })).toBe(false);
    expect(isStandardDriveLayout({ ...STANDARD_DRIVE_LAYOUT, driveShowWeather: false })).toBe(false);
  });
});
