// Client hazard tests (migration 0107): the 2-hour live window,
// the on-route approach trigger, and the Driver-reported labels.
import { describe, expect, test } from "bun:test";
import {
  hazardAhead,
  hazardLiveAt,
  hazardSourceLabel,
  hazardSpoken,
  type DriverHazard,
} from "./hazardReport";

const T0 = 1_700_000_000_000;
// Straight route south, lat 39.04 → 39.00 at lon -105.
const COORDS: [number, number][] = [];
for (let i = 0; i <= 40; i++) COORDS.push([39.04 - i * 0.001, -105]);

function hz(over: Partial<DriverHazard> = {}): DriverHazard {
  return {
    id: "hazard-1",
    kind: "debris",
    lat: 39.02, // along ≈ 1.38 mi
    lon: -105.0,
    note: null,
    reporter: "driver-a",
    confirmCount: 0,
    createdAtMs: T0,
    expiresAtMs: T0 + 2 * 3600_000,
    ...over,
  };
}

describe("hazard lifecycle mirror", () => {
  test("live for exactly 2 hours, then gone from every surface", () => {
    expect(hazardLiveAt(hz(), T0 + 2 * 3600_000 - 1)).toBe(true);
    expect(hazardLiveAt(hz(), T0 + 2 * 3600_000)).toBe(false);
  });
  test("always labelled Driver-reported with age", () => {
    expect(hazardSourceLabel(hz(), T0 + 20 * 60_000)).toBe("Driver-reported · reported 20 min ago");
  });
});

describe("hazardAhead", () => {
  test("fires within a mile on route, source named in the call", () => {
    const ahead = hazardAhead([hz()], COORDS, 0.8, T0 + 60_000);
    expect(ahead).not.toBeNull();
    expect(hazardSpoken(ahead!)).toContain("Debris in road ahead");
    expect(hazardSpoken(ahead!)).toContain("Driver reported");
  });
  test("expired, behind, off-route, or too-far hazards never fire", () => {
    expect(hazardAhead([hz()], COORDS, 0.8, T0 + 2 * 3600_000)).toBeNull(); // expired
    expect(hazardAhead([hz()], COORDS, 2.0, T0)).toBeNull(); // passed
    expect(hazardAhead([hz()], COORDS, 0.1, T0)).toBeNull(); // >1 mi out
    expect(hazardAhead([hz({ lon: -104.97 })], COORDS, 0.8, T0)).toBeNull(); // off the line
    expect(hazardAhead([hz({ kind: "traffic_stopped" })], COORDS, 0.8, T0)).not.toBeNull();
  });
});
