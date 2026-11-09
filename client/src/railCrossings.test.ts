// Railroad crossing tests (migration 0107): the crossing call
// from real inventory locations, and the high-center discipline —
// the humped claim fires ONLY where profile data says humped AND
// the rig is a long, low trailer. Unknown profile = no claim.
import { describe, expect, test } from "bun:test";
import {
  crossingAhead,
  crossingHeadline,
  fraProfileHumped,
  parseFraCrossings,
  parseOsmCrossings,
  type CrossingElement,
} from "./railCrossings";

// Straight route south, lat 39.04 → 39.00 at lon -105.
const COORDS: [number, number][] = [];
for (let i = 0; i <= 40; i++) COORDS.push([39.04 - i * 0.001, -105]);
// A crossing on the line at lat 39.02 → along ≈ 1.38 mi.
const XING = { lat: 39.02, lon: -105.0 };

describe("parsing", () => {
  test("OSM level crossings parse with UNKNOWN profile", () => {
    const els: CrossingElement[] = [
      { id: 7, type: "node", lat: 39.02, lon: -105.0, tags: { railway: "level_crossing" } },
      { id: 8, type: "node", lat: 39.02, lon: -105.0, tags: { railway: "station" } },
    ];
    const xs = parseOsmCrossings(els);
    expect(xs.length).toBe(1);
    expect(xs[0]!.humped).toBeNull();
    expect(xs[0]!.source).toBe("osm");
  });

  test("FRA profile text decides humped — and only real text decides", () => {
    expect(fraProfileHumped("Humped crossing")).toBe(true);
    expect(fraProfileHumped("Level")).toBe(false);
    expect(fraProfileHumped(null)).toBeNull();
    expect(fraProfileHumped("")).toBeNull();
    expect(fraProfileHumped("unknown")).toBeNull();
    const xs = parseFraCrossings([{ crossingId: "123456A", lat: 39.02, lon: -105.0, profile: "Humped" }]);
    expect(xs[0]!.humped).toBe(true);
  });
});

describe("crossingAhead", () => {
  const lowboy = { lowLongTrailer: true };
  const van = { lowLongTrailer: false };

  test("plain crossing alert within half a mile", () => {
    const xs = parseOsmCrossings([{ id: 7, type: "node", lat: XING.lat, lon: XING.lon, tags: { railway: "level_crossing" } }]);
    const ahead = crossingAhead(xs, COORDS, 1.1, lowboy);
    expect(ahead).not.toBeNull();
    expect(ahead!.highCenter).toBe(false); // profile unknown — no claim, even for a lowboy
    expect(crossingHeadline(ahead!)).toBe("RAILROAD CROSSING AHEAD");
  });

  test("humped profile + long low trailer = high-center warning", () => {
    const xs = parseFraCrossings([{ crossingId: "999", lat: XING.lat, lon: XING.lon, profile: "Humped crossing" }]);
    const ahead = crossingAhead(xs, COORDS, 1.1, lowboy);
    expect(ahead!.highCenter).toBe(true);
    expect(crossingHeadline(ahead!)).toContain("HIGH-CENTER RISK");
  });

  test("humped profile + tall van trailer = plain alert (no hang-up risk claimed)", () => {
    const xs = parseFraCrossings([{ crossingId: "999", lat: XING.lat, lon: XING.lon, profile: "Humped crossing" }]);
    const ahead = crossingAhead(xs, COORDS, 1.1, van);
    expect(ahead!.highCenter).toBe(false);
  });

  test("level profile + lowboy = plain alert", () => {
    const xs = parseFraCrossings([{ crossingId: "999", lat: XING.lat, lon: XING.lon, profile: "Level" }]);
    expect(crossingAhead(xs, COORDS, 1.1, lowboy)!.highCenter).toBe(false);
  });

  test("too far, behind, or off-route crossings never fire", () => {
    const xs = parseOsmCrossings([{ id: 7, type: "node", lat: XING.lat, lon: XING.lon, tags: { railway: "level_crossing" } }]);
    expect(crossingAhead(xs, COORDS, 0.5, lowboy)).toBeNull(); // ~0.9 mi out
    expect(crossingAhead(xs, COORDS, 1.8, lowboy)).toBeNull(); // passed
    const off = parseOsmCrossings([{ id: 9, type: "node", lat: 39.02, lon: -104.98, tags: { railway: "level_crossing" } }]);
    expect(crossingAhead(off, COORDS, 1.1, lowboy)).toBeNull(); // ~1 mi off the line
    expect(crossingAhead([], COORDS, 1.1, lowboy)).toBeNull();
  });
});
