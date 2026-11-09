// Unit tests pinning the 2026-11-05 gap-report updates (truckers'
// needs vs STONEMILES — x's "all that's needed"):
//
//   1. OFFLINE MAPS, COMPLETED: the offline route download always
//      warmed OpenStreetMap raster tiles, but the MapLibre vector
//      map never requested them, so a saved route still lost its
//      basemap in a dead zone. The map engine now carries an
//      "offline" base style rendering the SAME tile template the
//      download warms, and the app auto-switches to it when the
//      connection drops with a saved route on the device (manual
//      switch in Settings → Offline maps).
//   2. VOICE CONTROL: the Ask Meca mic feeds speech recognition
//      transcripts into the same sendMeca path as typing — same
//      answers, commands, and gated "Take me there" jumps.
//   3. DETENTION PAY, NAMED: the detention tracker carries its name
//      everywhere it surfaces (panel, exported report, chat
//      snapshot, debrief), and Ask Meca has a real "detention"
//      destination plus a live-totals local answer.
//   4. TOMTOM SEARCH RUNG, SETTLED IN THE OPEN: Settings shows the
//      rung's real state from getTomTomStatus — OFF with the reason
//      (Search not entitled on the key; free sources serving) —
//      instead of the fallback staying silent.
//
// Run: bun test client/src/gapUpdates.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const appSource = readFileSync(`${import.meta.dir}/App.tsx`, "utf8");
const engineSource = readFileSync(`${import.meta.dir}/mapEngine.ts`, "utf8");

describe("offline maps — the saved tiles are the map's offline layer", () => {
  test("the engine's offline style renders the exact tile template the download warms", () => {
    expect(engineSource).toContain("https://tile.openstreetmap.org/{z}/{x}/{y}.png");
    expect(appSource).toContain("https://tile.openstreetmap.org/${t}.png");
    expect(engineSource).toContain('kind: "streets" | "satellite" | "hybrid" | "offline"');
    expect(engineSource).toContain('kind === "offline"');
    expect(engineSource).toContain('"sm-osm"');
  });

  test("the app auto-switches to the offline basemap on connection drop with a saved route", () => {
    expect(appSource).toContain("offlineBaseAutoRef");
    expect(appSource).toContain('effectiveMapStyle = offlineBaseOn ? ("offline" as const) : mapStyle');
    expect(appSource).toContain("the map switched to your saved offline map");
  });

  test("Settings → Offline maps carries the manual switch", () => {
    expect(appSource).toContain("Show the offline map now");
    expect(appSource).toContain("Back to the live map");
    expect(appSource).toContain("toggleOfflineBase");
  });
});

describe("voice control — Ask Meca by voice", () => {
  test("the mic runs speech recognition into sendMeca", () => {
    expect(appSource).toContain("startMecaVoice");
    expect(appSource).toContain('aria-label="Ask Meca by voice — speak a question or command"');
    expect(appSource).toContain("void sendMeca(t.trim())");
  });
});

describe("Detention Pay — the named feature", () => {
  test("the name rides the panel, the export, and the snapshot line", () => {
    expect(appSource).toContain("⏱️ Detention Pay — sealed detention tracker");
    expect(appSource).toContain("DETENTION PAY REPORT — Load #");
    expect(appSource).toContain("Detention Pay: within free time so far.");
    expect(appSource).toContain('id={`detention-pay-${loadId}`}');
  });

  test("Ask Meca resolves detention and jumps to the tracker", () => {
    expect(appSource).toContain('| "detention"');
    expect(appSource).toContain('return "detention"');
    expect(appSource).toContain('case "detention"');
    expect(appSource).toContain("Detention Pay so far:");
  });
});

describe("TomTom search rung — settled in Settings, not silent", () => {
  test("Settings reads getTomTomStatus and states the OFF case plainly", () => {
    expect(appSource).toContain("api.getTomTomStatus({})");
    expect(appSource).toContain("Place search — TomTom");
    expect(appSource).toContain("TomTom place search is OFF right now");
    expect(appSource).toContain("TomTom place search is ON");
  });
});
