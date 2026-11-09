// Hazard lifecycle tests (migration 0107): the 2-hour clock, the
// Still-there extension, the Gone retirement rules, and the GPS
// vote gate — the brief's hazard lifecycle/expiry requirements.
import { describe, expect, test } from "bun:test";
import {
  HAZARD_TTL_MS,
  applyHazardGone,
  applyHazardStillThere,
  hazardIsLive,
  hazardState,
  hazardVoteInRange,
  isHazardKind,
  newHazardWindow,
  type HazardRow,
} from "./hazardReport";

const T0 = 1_700_000_000_000;
function row(over: Partial<HazardRow> = {}): HazardRow {
  const win = newHazardWindow(T0);
  return {
    id: 1,
    kind: "debris",
    lat: 39.0,
    lon: -105.0,
    note: null,
    reporter: "driver-a",
    confirmCount: 0,
    goneCount: 0,
    status: "active",
    createdAtMs: win.createdAtMs,
    expiresAtMs: win.expiresAtMs,
    lastConfirmedAtMs: null,
    ...over,
  };
}

describe("hazard kinds", () => {
  test("only the three quick types are valid", () => {
    expect(isHazardKind("traffic_stopped")).toBe(true);
    expect(isHazardKind("debris")).toBe(true);
    expect(isHazardKind("vehicle_shoulder")).toBe(true);
    expect(isHazardKind("construction")).toBe(false);
    expect(isHazardKind("speed_trap")).toBe(false);
  });
});

describe("hazard lifecycle", () => {
  test("a fresh report lives exactly 2 hours", () => {
    const h = row();
    expect(HAZARD_TTL_MS).toBe(2 * 3600_000);
    expect(hazardIsLive(h, T0 + HAZARD_TTL_MS - 1)).toBe(true);
    expect(hazardIsLive(h, T0 + HAZARD_TTL_MS)).toBe(false);
    expect(hazardState(h, T0 + HAZARD_TTL_MS)).toBe("expired");
  });

  test("Still there restarts the 2-hour clock and counts", () => {
    const h = row();
    const at = T0 + 90 * 60_000; // 90 min in — 30 min of life left
    const res = applyHazardStillThere(h, at);
    expect(res.applied).toBe(true);
    expect(res.confirmCount).toBe(1);
    expect(res.expiresAtMs).toBe(at + HAZARD_TTL_MS);
    const extended = row({ expiresAtMs: res.expiresAtMs, confirmCount: res.confirmCount });
    expect(hazardIsLive(extended, T0 + HAZARD_TTL_MS + 60 * 60_000)).toBe(true);
  });

  test("Still there does not revive an expired or retired hazard", () => {
    expect(applyHazardStillThere(row(), T0 + HAZARD_TTL_MS + 1).applied).toBe(false);
    expect(applyHazardStillThere(row({ status: "retired" }), T0).applied).toBe(false);
  });

  test("the reporter's own Gone retires at once; a stranger needs two votes", () => {
    const own = applyHazardGone(row(), "driver-a", T0);
    expect(own.retired).toBe(true);
    const first = applyHazardGone(row(), "driver-b", T0);
    expect(first.applied).toBe(true);
    expect(first.retired).toBe(false);
    const second = applyHazardGone(row({ goneCount: first.goneCount }), "driver-c", T0);
    expect(second.retired).toBe(true);
    expect(hazardState(row({ goneCount: second.goneCount }), T0)).toBe("retired");
  });

  test("votes count only from a driver at the hazard", () => {
    const h = row();
    expect(hazardVoteInRange(h, 39.001, -105.001)).toBe(true);
    expect(hazardVoteInRange(h, 40.0, -105.0)).toBe(false); // ~69 mi away
  });
});
