// Unit tests pinning the TomTom traffic legend chip's place in the
// app after the driver's two verdicts of 2026-11-03:
//
//   1. Road test 11:23–11:43 PM: "Take off the tomtom traffic icon
//      off gps screen." The floating pill — traffic-light icon,
//      flowing / slow / heavy swatches, "TomTom <time>" line — came
//      OFF the GPS screen: the standard layout has NO legend chip.
//   2. Repair 5 (~23:28 CT): the driver may customize the GPS
//      screen. The legend is the one element whose customization
//      switch defaults OFF — it renders ONLY when that driver turns
//      it on (driveShowTrafficLegend, migration 0095), for that
//      driver only. There is no other way it appears.
//
// These tests pin both halves from the production sources, plus
// what must NOT be removed with the chip: the traffic flow
// coloring painted ON the route line itself (buildTrafficSegments
// — orange slow / red heavy over the blue), and TomTom attribution,
// which lives off the driving view in the route-details "Why this
// route" panel and the Routes-tab route cards ("Traffic: …
// (TomTom, data as of …)").
//
// Run: bun test client/src/trafficLegend.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { MAP_PREFS_DEFAULTS as CLIENT_DEFAULTS, normalizeMapPrefs } from "./mapPrefs";
import { visibleDriveOverlays } from "./driveScreen";

const appSource = readFileSync(`${import.meta.dir}/App.tsx`, "utf8");
const serverPrefsSource = readFileSync(`${import.meta.dir}/../../server/src/mapPrefs.ts`, "utf8");

describe("TomTom traffic legend chip — off the GPS screen by default", () => {
  test("the standard layout defaults the legend OFF on client and server", () => {
    expect(CLIENT_DEFAULTS.showTrafficLegend).toBe(false);
    expect(normalizeMapPrefs(null).showTrafficLegend).toBe(false);
    expect(normalizeMapPrefs({}).showTrafficLegend).toBe(false);
    expect(serverPrefsSource).toContain("driveShowTrafficLegend: false");
  });

  test("under default prefs the legend is absent from the visible drive overlays", () => {
    const vis = visibleDriveOverlays(normalizeMapPrefs(null));
    expect(vis.has("trafficLegend")).toBe(false);
    // …while the rest of the standard layout is present.
    expect(vis.has("weather")).toBe(true);
    expect(vis.has("speed")).toBe(true);
    expect(vis.has("bigPrompts")).toBe(true);
    expect(vis.has("etaPill")).toBe(true);
  });

  test("the legend's render is gated on the driver's opt-in — never unconditional", () => {
    expect(appSource).toContain('selected && driveVis.has("trafficLegend")');
    // The swatch row exists only inside that gated render.
    expect(appSource).toContain("aria-hidden /> flowing");
    expect(appSource).toContain("aria-hidden /> heavy");
  });

  test("opting in is per-driver and round-trips: on shows it, off hides it again", () => {
    const on = normalizeMapPrefs({ showTrafficLegend: true });
    expect(visibleDriveOverlays(on).has("trafficLegend")).toBe(true);
    const offAgain = normalizeMapPrefs({ showTrafficLegend: false });
    expect(visibleDriveOverlays(offAgain).has("trafficLegend")).toBe(false);
  });

  test("the radar pill stacks above the legend only when the legend is opted in", () => {
    // The pill's bottom offset is computed inline (it also lifts
    // over the Go trip bar via liftPx): 76px with the legend opted
    // in, 46px without.
    expect(appSource).toContain('(selected && driveVis.has("trafficLegend") ? 76 : 46) + liftPx');
  });

  test("the traffic coloring painted ON the route line itself is untouched", () => {
    expect(appSource).toContain('import { buildTrafficSegments } from "./trafficSegments"');
    expect(appSource).toContain("buildTrafficSegments(r.coords, r.trafficFlow ?? [], r.trafficIncidents ?? [])");
    expect(appSource).toContain("buildTrafficSegments(selected.coords, selected.trafficFlow ?? [], selected.trafficIncidents ?? [])");
  });

  test("TomTom attribution still lives in the route details, off the driving view", () => {
    expect(appSource).toContain("min live delay (TomTom)");
    expect(appSource).toContain("no live delay on this route right now (TomTom");
  });
});
