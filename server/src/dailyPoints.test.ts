import { describe, expect, test } from "bun:test";
import {
CLEAN_WEEK_POINTS,
DAILY_POINTS_CAP,
DAILY_TASKS,
SEALED_WORK_TASKS,
dailyTaskPoints,
dailyTaskTablePoints,
} from "./dailyPoints";

describe("daily table v2 — paid-tier values (rewards rework, 2026-10-26)", () => {
  test("table values match the rework exactly", () => {
    expect(dailyTaskTablePoints("briefing")).toBe(25); // A1: unchanged
    expect(dailyTaskTablePoints("dvir")).toBe(50);
    expect(dailyTaskTablePoints("posttrip_dvir")).toBe(25);
    expect(dailyTaskTablePoints("trip_sealed")).toBe(120); // was 100
    expect(dailyTaskTablePoints("pod_seal")).toBe(165); // was 150
    expect(dailyTaskTablePoints("clean_day")).toBe(75);
    expect(dailyTaskTablePoints("intel")).toBe(35); // was 50
    expect(dailyTaskTablePoints("fuel_stop")).toBe(10); // was 25
    expect(dailyTaskTablePoints("debrief")).toBe(20); // was 25
  });

  test("the lines add to 525 and the cap still holds a perfect day at 500", () => {
    const sum = DAILY_TASKS.reduce((s, t) => s + t.points, 0);
    expect(sum).toBe(525);
    expect(DAILY_POINTS_CAP).toBe(500);
  });

  test("clean-week bonus is +200, outside the cap", () => {
    expect(CLEAN_WEEK_POINTS).toBe(200);
  });

  test("sealed work is exactly trip_sealed + pod_seal", () => {
    expect([...SEALED_WORK_TASKS].sort()).toEqual(["pod_seal", "trip_sealed"]);
  });
});

describe("paid tier earns the full table value", () => {
  test("(c) paid trip_sealed / pod_seal / fuel_stop pay 120 / 165 / 10", () => {
    expect(dailyTaskPoints("trip_sealed", true)).toBe(120);
    expect(dailyTaskPoints("pod_seal", true)).toBe(165);
    expect(dailyTaskPoints("fuel_stop", true)).toBe(10);
  });

  test("paid tier: every task pays its table value", () => {
    for (const t of DAILY_TASKS) {
      expect(dailyTaskPoints(t.key, true)).toBe(t.points);
    }
  });
});

describe("free tier (amendment A2) — half on sealed work only, no fuel points", () => {
  test("(a) free trip_sealed pays 60 and pod_seal pays 82 (floor of half)", () => {
    expect(dailyTaskPoints("trip_sealed", false)).toBe(60);
    expect(dailyTaskPoints("pod_seal", false)).toBe(82);
  });

  test("(b) free fuel_stop pays 0 — fuel route/planner tools are paid-tier only", () => {
    expect(dailyTaskPoints("fuel_stop", false)).toBe(0);
  });

  test("(d) free check-in / DVIR / clean day / intel / debrief pay full value", () => {
    expect(dailyTaskPoints("briefing", false)).toBe(25);
    expect(dailyTaskPoints("dvir", false)).toBe(50);
    expect(dailyTaskPoints("posttrip_dvir", false)).toBe(25);
    expect(dailyTaskPoints("clean_day", false)).toBe(75);
    expect(dailyTaskPoints("intel", false)).toBe(35);
    expect(dailyTaskPoints("debrief", false)).toBe(20);
  });

  test("a free-tier full day (every payable line) totals 372 before the cap", () => {
    const total = DAILY_TASKS.reduce(
      (s, t) => s + dailyTaskPoints(t.key, false),
      0,
    );
    // 25 + 50 + 25 + 60 + 82 + 75 + 35 + 0 + 20
    expect(total).toBe(372);
    expect(total).toBeLessThan(DAILY_POINTS_CAP);
  });
});
