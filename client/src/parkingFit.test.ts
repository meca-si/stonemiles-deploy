// parkingFit.test.ts — unit pins for the client HOS-aware
// parking fit verdict (Research Wave 2 item 4): the same math the
// server grades reservations with (parkingArrivalPlan), at the
// route-weather pace (paceMphFor — rolling speed, else 50 mph),
// against the binding clock (earlier of drive / window).
//
// Run: bun test client/src/parkingFit.test.ts
import { describe, expect, test } from "bun:test";
import { bindingRemainHours, parkingFitFor } from "./parkingFit";

const NOW = new Date("2026-11-15T12:00:00.000Z");

describe("parkingFitFor", () => {
  test("fits: hours to spare at the standing pace", () => {
    // No rolling speed → 50 mph. 100 mi = 2 h; 8 h binding → 6 h margin.
    const r = parkingFitFor({ now: NOW, alongMi: 100, speedMph: null, driveRemainH: 9, windowRemainH: 8 });
    expect(r.verdict).toBe("fits");
    expect(r.marginMinutes).toBe(360);
    expect(r.etaAt.toISOString()).toBe("2026-11-15T14:00:00.000Z");
  });

  test("the binding clock is the earlier of drive and window", () => {
    expect(bindingRemainHours(11, 3)).toBe(3);
    expect(bindingRemainHours(2, 14)).toBe(2);
    expect(bindingRemainHours(null, 5)).toBe(5);
    expect(bindingRemainHours(null, null)).toBeNull();
  });

  test("tight: inside the 45-minute margin", () => {
    const r = parkingFitFor({ now: NOW, alongMi: 100, speedMph: null, driveRemainH: 2.5, windowRemainH: 14 });
    expect(r.verdict).toBe("tight");
    expect(r.marginMinutes).toBe(30);
  });

  test("wont_make_it: the clock runs out first", () => {
    const r = parkingFitFor({ now: NOW, alongMi: 300, speedMph: null, driveRemainH: 4, windowRemainH: 14 });
    expect(r.verdict).toBe("wont_make_it");
    expect(r.marginMinutes).toBe(-120);
  });

  test("a rolling speed is used when the truck is moving", () => {
    // 120 mi at 60 mph = 2 h; 2.2 h binding → 12 min margin → tight.
    const r = parkingFitFor({ now: NOW, alongMi: 120, speedMph: 60, driveRemainH: 2.2, windowRemainH: 14 });
    expect(r.verdict).toBe("tight");
  });

  test("unknown clocks read unknown", () => {
    const r = parkingFitFor({ now: NOW, alongMi: 100, speedMph: null, driveRemainH: null, windowRemainH: null });
    expect(r.verdict).toBe("unknown");
  });
});
