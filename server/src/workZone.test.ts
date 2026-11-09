// Unit tests for the driver-reported work-zone lifecycle
// (server/src/workZone.ts) — create window, age/expiry, Still-there
// extension, Gone retirement. Run: bun test server/src/workZone.test.ts

import { describe, expect, test } from "bun:test";
import {
  WORK_ZONE_GONE_VOTES_TO_RETIRE,
  WORK_ZONE_TTL_MS,
  applyGone,
  applyStillThere,
  haversineMi,
  newWorkZoneWindow,
  voteInRange,
  workZoneIsLive,
  workZoneState,
  type WorkZoneRow,
} from "./workZone";

const T0 = Date.parse("2026-11-08T12:00:00Z");

function zone(over: Partial<WorkZoneRow> = {}): WorkZoneRow {
  const w = newWorkZoneWindow(T0);
  return {
    id: 1,
    lat: 43.0,
    lon: -89.4,
    note: null,
    reporter: "@driver1",
    confirmCount: 0,
    goneCount: 0,
    status: "active",
    createdAtMs: w.createdAtMs,
    expiresAtMs: w.expiresAtMs,
    lastConfirmedAtMs: null,
    ...over,
  };
}

describe("create", () => {
  test("a new report lives exactly 12 hours from the drop", () => {
    const w = newWorkZoneWindow(T0);
    expect(w.createdAtMs).toBe(T0);
    expect(w.expiresAtMs - w.createdAtMs).toBe(WORK_ZONE_TTL_MS);
    expect(WORK_ZONE_TTL_MS).toBe(12 * 3600_000);
  });

  test("a fresh zone is live", () => {
    expect(workZoneState(zone(), T0)).toBe("active");
    expect(workZoneIsLive(zone(), T0 + 60_000)).toBe(true);
  });
});

describe("12-hour expiry", () => {
  test("live one minute before the window ends, expired at the end", () => {
    const z = zone();
    expect(workZoneIsLive(z, z.expiresAtMs - 60_000)).toBe(true);
    expect(workZoneState(z, z.expiresAtMs)).toBe("expired");
    expect(workZoneIsLive(z, z.expiresAtMs + 1)).toBe(false);
  });

  test("an expired zone is never revived by a Still-there vote", () => {
    const z = zone();
    const r = applyStillThere(z, z.expiresAtMs + 1000);
    expect(r.applied).toBe(false);
    expect(r.confirmCount).toBe(0);
  });
});

describe("Still there (extension)", () => {
  test("extends a live zone a fresh 12 hours from the confirmation and counts it", () => {
    const z = zone();
    const at = T0 + 11 * 3600_000; // an hour before it would die
    const r = applyStillThere(z, at);
    expect(r.applied).toBe(true);
    expect(r.expiresAtMs).toBe(at + WORK_ZONE_TTL_MS);
    expect(r.confirmCount).toBe(1);
    // …and the extended zone is still live past the ORIGINAL expiry.
    expect(workZoneIsLive({ ...z, expiresAtMs: r.expiresAtMs }, z.expiresAtMs + 3600_000)).toBe(true);
  });

  test("a retired zone cannot be extended", () => {
    const r = applyStillThere(zone({ status: "retired" }), T0 + 1000);
    expect(r.applied).toBe(false);
  });
});

describe("Gone (retirement)", () => {
  test("the reporter's own Gone retires the zone at once", () => {
    const r = applyGone(zone(), "@driver1", T0 + 1000);
    expect(r.applied).toBe(true);
    expect(r.retired).toBe(true);
    expect(workZoneState(zone({ goneCount: r.goneCount }), T0 + 2000)).toBe("retired");
  });

  test("one stranger's Gone does NOT retire — a second independent vote does", () => {
    const z = zone();
    const first = applyGone(z, "@driver2", T0 + 1000);
    expect(first.applied).toBe(true);
    expect(first.retired).toBe(false);
    expect(first.goneCount).toBe(1);
    expect(workZoneIsLive({ ...z, goneCount: first.goneCount }, T0 + 2000)).toBe(true);
    const second = applyGone({ ...z, goneCount: first.goneCount }, "@driver3", T0 + 3000);
    expect(second.retired).toBe(true);
    expect(second.goneCount).toBe(WORK_ZONE_GONE_VOTES_TO_RETIRE);
    expect(workZoneIsLive({ ...z, goneCount: second.goneCount }, T0 + 4000)).toBe(false);
  });

  test("voting Gone on an expired zone changes nothing", () => {
    const z = zone();
    const r = applyGone(z, "@driver2", z.expiresAtMs + 1000);
    expect(r.applied).toBe(false);
    expect(r.goneCount).toBe(0);
  });
});

describe("vote range (GPS-checked)", () => {
  test("a vote at the zone counts; a vote 30 miles away does not", () => {
    const z = zone(); // 43.0, -89.4
    expect(voteInRange(z, 43.0, -89.4)).toBe(true);
    expect(voteInRange(z, 43.005, -89.395)).toBe(true); // ~0.4 mi
    expect(voteInRange(z, 43.45, -89.4)).toBe(false); // ~31 mi north
  });

  test("haversine sanity: a degree of latitude is ~69 miles", () => {
    expect(haversineMi(43, -89.4, 44, -89.4)).toBeGreaterThan(68);
    expect(haversineMi(43, -89.4, 44, -89.4)).toBeLessThan(70);
  });
});
