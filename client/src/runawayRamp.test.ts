// Runaway ramp tests (migration 0107): the call fires ONLY on an
// active downgrade, with the right distance + side, and never from
// invented data — no ramps in the data, no ramp call, ever.
import { describe, expect, test } from "bun:test";
import { parseEscapeRamps, rampAheadOnDescent, rampSpoken, type RampElement } from "./runawayRamp";
import type { GradeSegment } from "./hillGrade";

// A straight route running SOUTH (descending), ~4 miles long:
// lat 39.06 → 39.00 at lon -105 (1° lat ≈ 69 mi).
const COORDS: [number, number][] = [];
for (let i = 0; i <= 40; i++) COORDS.push([39.06 - i * 0.0015, -105]);

function seg(over: Partial<GradeSegment> = {}): GradeSegment {
  return {
    id: 0,
    direction: "down",
    startMi: 1.0,
    endMi: 3.5,
    lengthMi: 2.5,
    avgPct: 6,
    peakPct: 7,
    strong: true,
    ...over,
  };
}

// A ramp ~0.05 mi EAST of the line at along ≈2.07 mi. Travelling
// south, east is the driver's LEFT... verified against the cross
// product in the engine: heading south, an east offset reads left.
const RAMP_EAST = { id: "ramp-node-1", lat: 39.03, lon: -104.999 };
// A ramp ~0.05 mi WEST of the line at the same stretch (right side
// heading south).
const RAMP_WEST = { id: "ramp-node-2", lat: 39.03, lon: -105.001 };

describe("parseEscapeRamps", () => {
  test("only escape-tagged map data becomes a ramp", () => {
    const els: RampElement[] = [
      { id: 1, type: "node", lat: 39.03, lon: -105.001, tags: { highway: "escape" } },
      { id: 2, type: "node", lat: 39.03, lon: -105.0, tags: { highway: "traffic_signals" } },
      { id: 3, type: "way", tags: { emergency: "escape_ramp" }, geometry: [{ lat: 39.04, lon: -105.002 }, { lat: 39.035, lon: -105.003 }, { lat: 39.03, lon: -105.004 }] },
      { id: 4, type: "node", lat: 39.02, lon: -105.0, tags: {} },
    ];
    const ramps = parseEscapeRamps(els);
    expect(ramps.length).toBe(2);
    expect(ramps[0]!.id).toBe("ramp-node-1");
    expect(ramps[1]!.lat).toBeCloseTo(39.035, 5);
  });
  test("no data, no ramps", () => {
    expect(parseEscapeRamps([])).toEqual([]);
    expect(parseEscapeRamps(null)).toEqual([]);
    expect(parseEscapeRamps(undefined)).toEqual([]);
  });
});

describe("rampAheadOnDescent", () => {
  test("calls the ramp on an active downgrade, with distance and side", () => {
    const ahead = rampAheadOnDescent([RAMP_WEST], COORDS, 1.6, [seg()]);
    expect(ahead).not.toBeNull();
    expect(ahead!.distAheadMi).toBeGreaterThan(0.3);
    expect(ahead!.distAheadMi).toBeLessThan(0.6);
    expect(ahead!.side).toBe("right");
    expect(rampSpoken(ahead!)).toContain("Runaway ramp");
    expect(rampSpoken(ahead!)).toContain("right side");
  });

  test("east ramp reads left when heading south", () => {
    const ahead = rampAheadOnDescent([RAMP_EAST], COORDS, 1.6, [seg()]);
    expect(ahead?.side).toBe("left");
  });

  test("NO downgrade, NO call — a ramp beside a climb is silent", () => {
    expect(rampAheadOnDescent([RAMP_WEST], COORDS, 1.6, [seg({ direction: "up" })])).toBeNull();
    expect(rampAheadOnDescent([RAMP_WEST], COORDS, 1.6, [])).toBeNull();
  });

  test("a ramp past the end of the descent never fires", () => {
    // Descent ends at 3.5 mi; this ramp sits at ~3.9 mi along.
    const late = { id: "ramp-node-9", lat: 39.0035, lon: -105.001 };
    expect(rampAheadOnDescent([late], COORDS, 3.2, [seg()])).toBeNull();
  });

  test("a ramp already passed never fires, and no ramp data means silence", () => {
    expect(rampAheadOnDescent([RAMP_WEST], COORDS, 2.6, [seg()])).toBeNull();
    expect(rampAheadOnDescent([], COORDS, 1.6, [seg()])).toBeNull();
  });
});
