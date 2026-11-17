import { describe, expect, test } from "bun:test";
import { computePayRpm } from "./payRpm";

const NOW = Date.parse("2026-11-17T12:00:00Z");
const DAY = 86_400_000;

describe("computePayRpm", () => {
  test("sums revenue over loaded miles for loads sealed in the window", () => {
    const r = computePayRpm(
      [
        { sealedAtMs: NOW - 1 * DAY, revenue: 2500, loadedMiles: 1000 },
        { sealedAtMs: NOW - 10 * DAY, revenue: 1300, loadedMiles: 500 },
      ],
      NOW,
    );
    expect(r.hasData).toBe(true);
    expect(r.revenue).toBe(3800);
    expect(r.miles).toBe(1500);
    expect(r.loadCount).toBe(2);
    expect(r.rpm).toBe(2.53);
  });

  test("excludes loads sealed outside the 30-day window", () => {
    const r = computePayRpm(
      [
        { sealedAtMs: NOW - 31 * DAY, revenue: 9000, loadedMiles: 3000 },
        { sealedAtMs: NOW - 2 * DAY, revenue: 1000, loadedMiles: 400 },
      ],
      NOW,
    );
    expect(r.loadCount).toBe(1);
    expect(r.rpm).toBe(2.5);
  });

  test("a load with a rate but no miles is skipped and counted, never guessed", () => {
    const r = computePayRpm(
      [
        { sealedAtMs: NOW - DAY, revenue: 2000, loadedMiles: null },
        { sealedAtMs: NOW - DAY, revenue: 1000, loadedMiles: 500 },
      ],
      NOW,
    );
    expect(r.loadsSkippedNoMiles).toBe(1);
    expect(r.loadCount).toBe(1);
    expect(r.rpm).toBe(2);
  });

  test("a load with no rate contributes nothing at all", () => {
    const r = computePayRpm([{ sealedAtMs: NOW - DAY, revenue: null, loadedMiles: 500 }], NOW);
    expect(r.hasData).toBe(false);
    expect(r.rpm).toBe(null);
    expect(r.loadCount).toBe(0);
    expect(r.loadsSkippedNoMiles).toBe(0);
  });

  test("empty input reads as no data, rpm null", () => {
    const r = computePayRpm([], NOW);
    expect(r.hasData).toBe(false);
    expect(r.rpm).toBe(null);
    expect(r.windowDays).toBe(30);
  });
});
