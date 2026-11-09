import { describe, expect, test } from "bun:test";
import {
  NOT_HERE_RETIRE_THRESHOLD,
  WEIGH_DEDUPE_MI,
  WEIGH_FRESH_MS,
  WEIGH_PROMPT_TIMEOUT_MS,
  WEIGH_STALE_MS,
  WEIGH_TRIGGER_MI,
  WeighPromptTracker,
  bearingDeg,
  effectiveWeighStatus,
  evaluateWeighPrompt,
  isPlaceSuppressedForDriver,
  nearestStationWithin,
  planNotHereCorrection,
  weighAddedByLine,
  weighStatusLine,
  weighStatusSuppressesPrompt,
  type WeighStationPoint,
  type WeighStatusInfo,
} from "./weighStation";

const NOW = 1_800_000_000_000;
// A truck rolling north on I-65 in Alabama (heading 0°).
const POS = { lat: 33.0, lon: -86.8 };
// ~0.5 mi due north of the truck — inside the 0.7 mi trigger.
const NORTH_0_5MI = { lat: 33.0072, lon: -86.8 };
// ~0.69 mi due north — just inside the 0.7 mi boundary.
const NORTH_0_69MI = { lat: 33.01, lon: -86.8 };
// ~0.75 mi due north — just outside the 0.7 mi boundary.
const NORTH_0_75MI = { lat: 33.0109, lon: -86.8 };
// ~1.5 mi due north — prompted under the old ~2 mi trigger, NOT now.
const NORTH_1_5MI = { lat: 33.0217, lon: -86.8 };
// ~3 mi due north — outside the trigger zone.
const NORTH_3MI = { lat: 33.0435, lon: -86.8 };
// ~0.5 mi due SOUTH — behind the truck.
const SOUTH_0_5MI = { lat: 32.9928, lon: -86.8 };
// ~0.5 mi due east — off the heading cone.
const EAST_0_5MI = { lat: 33.0, lon: -86.7914 };
// ~1.5 mi due east (bearing-math fixtures).
const EAST_1_5MI = { lat: 33.0, lon: -86.774 };

const station = (id: string, p: { lat: number; lon: number }, routeRemainingMi: number | null = null): WeighStationPoint => ({
  id,
  name: `Station ${id}`,
  lat: p.lat,
  lon: p.lon,
  routeRemainingMi,
});

const UNKNOWN: WeighStatusInfo = { status: "unknown", updatedAtMs: null, reportCount: 0, reporter: null };
const fresh = (minsAgo: number): WeighStatusInfo => ({
  status: "open",
  updatedAtMs: NOW - minsAgo * 60000,
  reportCount: 3,
  reporter: "driver",
});

const baseInput = {
  promptsEnabled: true,
  tripActive: true,
  pos: POS,
  headingDeg: 0,
  stations: [] as WeighStationPoint[],
  statuses: new Map<string, WeighStatusInfo>(),
  promptedIds: new Set<string>(),
  nowMs: NOW,
};

describe("evaluateWeighPrompt — trigger distance / ahead logic (0.7 mi)", () => {
  test("the trigger constant is 0.7 miles (x's order)", () => {
    expect(WEIGH_TRIGGER_MI).toBe(0.7);
  });
  test("a station ~0.5 mi ahead (bearing fallback, no route) prompts", () => {
    const c = evaluateWeighPrompt({ ...baseInput, stations: [station("weigh-1", NORTH_0_5MI)] });
    expect(c?.station.id).toBe("weigh-1");
    expect(c!.distanceMi).toBeGreaterThan(0.4);
    expect(c!.distanceMi).toBeLessThan(0.6);
  });
  test("the 0.7 mi boundary: ~0.69 mi ahead prompts, ~0.75 mi does not (bearing fallback)", () => {
    expect(evaluateWeighPrompt({ ...baseInput, stations: [station("weigh-1", NORTH_0_69MI)] })?.station.id).toBe("weigh-1");
    expect(evaluateWeighPrompt({ ...baseInput, stations: [station("weigh-1", NORTH_0_75MI)] })).toBeNull();
  });
  test("a station ~1.5 mi ahead prompted under the old ~2 mi trigger — it does NOT prompt at 0.7 mi", () => {
    expect(evaluateWeighPrompt({ ...baseInput, stations: [station("weigh-1", NORTH_1_5MI)] })).toBeNull();
  });
  test("a station 3 mi ahead is outside the trigger zone", () => {
    expect(evaluateWeighPrompt({ ...baseInput, stations: [station("weigh-1", NORTH_3MI)] })).toBeNull();
  });
  test("a station behind the truck never prompts (bearing fallback)", () => {
    expect(evaluateWeighPrompt({ ...baseInput, stations: [station("weigh-1", SOUTH_0_5MI)] })).toBeNull();
  });
  test("a station off the heading cone never prompts (bearing fallback)", () => {
    expect(evaluateWeighPrompt({ ...baseInput, stations: [station("weigh-1", EAST_0_5MI)] })).toBeNull();
  });
  test("on the active route, remaining distance decides — heading is irrelevant", () => {
    // Station sits east (outside the bearing cone) but ON the route
    // 0.5 mi ahead: the route itself proves it is ahead.
    const c = evaluateWeighPrompt({ ...baseInput, stations: [station("weigh-1", EAST_0_5MI, 0.5)] });
    expect(c?.station.id).toBe("weigh-1");
    expect(c?.distanceMi).toBe(0.5);
  });
  test("the route-remaining boundary: exactly 0.7 mi prompts, 0.71 mi does not", () => {
    expect(evaluateWeighPrompt({ ...baseInput, stations: [station("weigh-1", NORTH_0_5MI, WEIGH_TRIGGER_MI)] })?.station.id).toBe(
      "weigh-1",
    );
    expect(evaluateWeighPrompt({ ...baseInput, stations: [station("weigh-1", NORTH_0_5MI, 0.71)] })).toBeNull();
  });
  test("a station already passed on the route (remaining ≤ 0) never prompts", () => {
    expect(evaluateWeighPrompt({ ...baseInput, stations: [station("weigh-1", NORTH_0_5MI, -0.4)] })).toBeNull();
    expect(evaluateWeighPrompt({ ...baseInput, stations: [station("weigh-1", NORTH_0_5MI, 0)] })).toBeNull();
  });
  test("a route station beyond 0.7 mi remaining never prompts", () => {
    expect(evaluateWeighPrompt({ ...baseInput, stations: [station("weigh-1", NORTH_0_5MI, 0.9)] })).toBeNull();
    expect(evaluateWeighPrompt({ ...baseInput, stations: [station("weigh-1", NORTH_0_5MI, 2.4)] })).toBeNull();
  });
  test("with no heading fix, the bearing fallback cannot fire", () => {
    expect(evaluateWeighPrompt({ ...baseInput, headingDeg: null, stations: [station("weigh-1", NORTH_0_5MI)] })).toBeNull();
  });
  test("the nearest qualifying station wins", () => {
    const c = evaluateWeighPrompt({
      ...baseInput,
      stations: [station("weigh-far", NORTH_0_5MI, 0.65), station("weigh-near", SOUTH_0_5MI, 0.3)],
    });
    expect(c?.station.id).toBe("weigh-near");
  });
  test("no live trip, no prompt", () => {
    expect(evaluateWeighPrompt({ ...baseInput, tripActive: false, stations: [station("weigh-1", NORTH_0_5MI)] })).toBeNull();
  });
});

describe("evaluateWeighPrompt — prompts-off setting", () => {
  test("prompts off suppresses an otherwise-perfect trigger", () => {
    expect(
      evaluateWeighPrompt({ ...baseInput, promptsEnabled: false, stations: [station("weigh-1", NORTH_0_5MI)] }),
    ).toBeNull();
  });
});

describe("evaluateWeighPrompt — 60-minute freshness gate", () => {
  test("a status reported 30 min ago suppresses the prompt", () => {
    const statuses = new Map([["weigh-1", fresh(30)]]);
    expect(evaluateWeighPrompt({ ...baseInput, stations: [station("weigh-1", NORTH_0_5MI)], statuses })).toBeNull();
    expect(weighStatusSuppressesPrompt(fresh(30), NOW)).toBe(true);
  });
  test("a status reported 59 min ago still suppresses; at 60 min it no longer does", () => {
    expect(weighStatusSuppressesPrompt(fresh(59), NOW)).toBe(true);
    expect(weighStatusSuppressesPrompt({ ...fresh(0), updatedAtMs: NOW - WEIGH_FRESH_MS }, NOW)).toBe(false);
  });
  test("a status reported 75 min ago prompts again", () => {
    const statuses = new Map([["weigh-1", fresh(75)]]);
    const c = evaluateWeighPrompt({ ...baseInput, stations: [station("weigh-1", NORTH_0_5MI)], statuses });
    expect(c?.station.id).toBe("weigh-1");
  });
  test("unknown status prompts", () => {
    const statuses = new Map([["weigh-1", UNKNOWN]]);
    const c = evaluateWeighPrompt({ ...baseInput, stations: [station("weigh-1", NORTH_0_5MI)], statuses });
    expect(c?.station.id).toBe("weigh-1");
  });
});

describe("4-hour staleness", () => {
  test("a status older than 4 hours reads unknown again — and prompts", () => {
    const stale: WeighStatusInfo = { status: "closed", updatedAtMs: NOW - WEIGH_STALE_MS - 60000, reportCount: 2, reporter: "x" };
    expect(effectiveWeighStatus(stale, NOW)).toBe("unknown");
    expect(weighStatusLine(stale, NOW)).toContain("Status unknown");
    const statuses = new Map([["weigh-1", stale]]);
    expect(evaluateWeighPrompt({ ...baseInput, stations: [station("weigh-1", NORTH_0_5MI)], statuses })?.station.id).toBe("weigh-1");
  });
  test("status lines: fresh open / closed with ages, unknown without a report", () => {
    expect(weighStatusLine(fresh(12), NOW)).toBe("Open — updated 12 min ago");
    expect(weighStatusLine({ status: "closed", updatedAtMs: NOW - 2 * 3600000 - 5 * 60000, reportCount: 1, reporter: "x" }, NOW)).toBe(
      "Closed — updated 2 h 5 min ago",
    );
    expect(weighStatusLine(UNKNOWN, NOW)).toBe("Status unknown — no driver report yet");
    expect(weighStatusLine(null, NOW)).toBe("Status unknown — no driver report yet");
  });
});

describe("WeighPromptTracker — per-trip cooldown", () => {
  const input = { promptsEnabled: true, tripActive: true, pos: POS, headingDeg: 0, stations: [station("weigh-1", NORTH_0_5MI)], statuses: new Map<string, WeighStatusInfo>(), nowMs: NOW };
  test("prompts once per station per trip — dismiss, then it never comes back", () => {
    const t = new WeighPromptTracker();
    expect(t.consider(input, NOW)?.station.id).toBe("weigh-1");
    t.dismiss();
    expect(t.consider(input, NOW + 5000)).toBeNull();
  });
  test("answered stations also stay cooled-down for the trip", () => {
    const t = new WeighPromptTracker();
    t.consider(input, NOW);
    expect(t.answer("open", NOW + 2000)).not.toBeNull();
    expect(t.consider(input, NOW + 10000)).toBeNull();
  });
  test("a new trip (reset) clears the cooldown", () => {
    const t = new WeighPromptTracker();
    t.consider(input, NOW);
    t.dismiss();
    t.reset();
    expect(t.consider(input, NOW + 60000)?.station.id).toBe("weigh-1");
  });
  test("while a prompt is open, no second prompt opens", () => {
    const t = new WeighPromptTracker();
    t.consider(input, NOW);
    const two = { ...input, stations: [station("weigh-1", NORTH_0_5MI), station("weigh-2", NORTH_0_5MI)] };
    expect(t.consider(two, NOW + 1000)).toBeNull();
    expect(t.showing?.station.id).toBe("weigh-1");
  });
});

describe("WeighPromptTracker — 5 s no-answer = no record (x's 2026-11-03 big-prompt rule; was 20 s)", () => {
  const input = { promptsEnabled: true, tripActive: true, pos: POS, headingDeg: 0, stations: [station("weigh-1", NORTH_0_5MI)], statuses: new Map<string, WeighStatusInfo>(), nowMs: NOW };
  test("the prompt timeout is exactly 5 seconds", () => {
    expect(WEIGH_PROMPT_TIMEOUT_MS).toBe(5_000);
  });
  test("before 5 s the prompt is still open; at 5 s it expires", () => {
    const t = new WeighPromptTracker();
    t.consider(input, NOW);
    expect(t.expire(NOW + WEIGH_PROMPT_TIMEOUT_MS - 1)).toBe(false);
    expect(t.showing).not.toBeNull();
    expect(t.expire(NOW + WEIGH_PROMPT_TIMEOUT_MS)).toBe(true);
    expect(t.showing).toBeNull();
  });
  test("after expiry there is nothing to answer — no report can be produced", () => {
    const t = new WeighPromptTracker();
    t.consider(input, NOW);
    t.expire(NOW + WEIGH_PROMPT_TIMEOUT_MS);
    expect(t.answer("open", NOW + WEIGH_PROMPT_TIMEOUT_MS + 1)).toBeNull();
    expect(t.answer("closed", NOW + WEIGH_PROMPT_TIMEOUT_MS + 1)).toBeNull();
  });
  test("an answer inside the window produces exactly one report, then the thanks state", () => {
    const t = new WeighPromptTracker();
    t.consider(input, NOW);
    const report = t.answer("closed", NOW + 4000);
    expect(report?.station.id).toBe("weigh-1");
    expect(report?.status).toBe("closed");
    expect(t.answer("open", NOW + 4500)).toBeNull(); // double-tap records nothing more
    expect(t.thanksVisible(NOW + 5000)).toBe(true);
    expect(t.thanksVisible(NOW + 8000)).toBe(false);
  });
  test("after the 5 s fade the same station never re-prompts on this pass (trip)", () => {
    const t = new WeighPromptTracker();
    t.consider(input, NOW);
    expect(t.expire(NOW + 5_000)).toBe(true);
    // Still parked in the trigger zone, status still unknown — the
    // per-trip cooldown keeps it gone; a timeout recorded nothing
    // and buys no second bite.
    expect(t.consider(input, NOW + 6_000)).toBeNull();
    expect(t.consider(input, NOW + 120_000)).toBeNull();
    expect(t.promptedIds.has("weigh-1")).toBe(true);
  });
  test("a tap inside the 5 seconds still answers — the shortened window changed no recording semantics", () => {
    const t = new WeighPromptTracker();
    t.consider(input, NOW);
    const report = t.answer("open", NOW + 4_999);
    expect(report?.station.id).toBe("weigh-1");
    expect(report?.status).toBe("open");
  });
});

describe("bearingDeg", () => {
  test("due north is 0, due east is 90", () => {
    expect(Math.round(bearingDeg(POS, NORTH_1_5MI))).toBe(0);
    expect(Math.round(bearingDeg(POS, EAST_1_5MI))).toBe(90);
  });
});

describe("nearestStationWithin — Station-here dedupe (0.3 mi)", () => {
  // ~0.2 mi north of the tap position.
  const NEAR_0_2MI = { lat: 33.0029, lon: -86.8 };
  // ~0.29 mi north — just inside the dedupe radius.
  const NEAR_0_29MI = { lat: 33.0042, lon: -86.8 };
  // ~0.45 mi north — outside the dedupe radius.
  const FAR_0_45MI = { lat: 33.0065, lon: -86.8 };
  test("the dedupe radius is 0.3 miles", () => {
    expect(WEIGH_DEDUPE_MI).toBe(0.3);
  });
  test("a station within 0.3 mi of the tap is found (update, not create)", () => {
    const hit = nearestStationWithin([station("weigh-1", NEAR_0_2MI)], POS, WEIGH_DEDUPE_MI);
    expect(hit?.station.id).toBe("weigh-1");
    expect(hit!.distanceMi).toBeLessThan(0.3);
    expect(nearestStationWithin([station("weigh-1", NEAR_0_29MI)], POS, WEIGH_DEDUPE_MI)?.station.id).toBe("weigh-1");
  });
  test("beyond 0.3 mi there is no dedupe hit (a new station is created)", () => {
    expect(nearestStationWithin([station("weigh-1", FAR_0_45MI)], POS, WEIGH_DEDUPE_MI)).toBeNull();
    expect(nearestStationWithin([station("weigh-1", NORTH_0_5MI)], POS, WEIGH_DEDUPE_MI)).toBeNull();
    expect(nearestStationWithin([], POS, WEIGH_DEDUPE_MI)).toBeNull();
  });
  test("the nearest in-radius station wins", () => {
    const hit = nearestStationWithin([station("weigh-far", NEAR_0_29MI), station("driver-x", NEAR_0_2MI)], POS, WEIGH_DEDUPE_MI);
    expect(hit?.station.id).toBe("driver-x");
  });
});

describe("driver-reported stations prompt other drivers like map stations", () => {
  const driverStation: WeighStationPoint = {
    id: "driver-abc",
    name: "Weigh station — Troy, Alabama",
    lat: NORTH_0_5MI.lat,
    lon: NORTH_0_5MI.lon,
    routeRemainingMi: null,
    driverReported: true,
  };
  test("a created station at the GPS position prompts another approaching driver", () => {
    const c = evaluateWeighPrompt({ ...baseInput, stations: [driverStation] });
    expect(c?.station.id).toBe("driver-abc");
    expect(c?.station.driverReported).toBe(true);
  });
  test("its fresh reported status suppresses the prompt (60-minute rule applies)", () => {
    const statuses = new Map([["driver-abc", fresh(10)]]);
    expect(evaluateWeighPrompt({ ...baseInput, stations: [driverStation], statuses })).toBeNull();
  });
  test("once its status is over an hour old it prompts again; over 4 hours it reads unknown and prompts", () => {
    const hourOld = new Map([["driver-abc", fresh(75)]]);
    expect(evaluateWeighPrompt({ ...baseInput, stations: [driverStation], statuses: hourOld })?.station.id).toBe("driver-abc");
    const stale: WeighStatusInfo = { status: "open", updatedAtMs: NOW - WEIGH_STALE_MS - 60000, reportCount: 1, reporter: "x" };
    expect(effectiveWeighStatus(stale, NOW)).toBe("unknown");
    expect(
      evaluateWeighPrompt({ ...baseInput, stations: [driverStation], statuses: new Map([["driver-abc", stale]]) })?.station.id,
    ).toBe("driver-abc");
  });
  test("the per-trip cooldown applies to it too", () => {
    const t = new WeighPromptTracker();
    const input = {
      promptsEnabled: true,
      tripActive: true,
      pos: POS,
      headingDeg: 0,
      stations: [driverStation],
      statuses: new Map<string, WeighStatusInfo>(),
      nowMs: NOW,
    };
    expect(t.consider(input, NOW)?.station.id).toBe("driver-abc");
    t.dismiss();
    expect(t.consider(input, NOW + 5000)).toBeNull();
  });
});

describe("weighAddedByLine — driver-reported marking", () => {
  test("shows reporter username and age for a driver-reported station", () => {
    const info: WeighStatusInfo = {
      status: "open",
      updatedAtMs: NOW - 5 * 60000,
      reportCount: 1,
      reporter: "x",
      driverReported: true,
      addedBy: "roadking",
      addedAtMs: NOW - 2 * 3600000,
    };
    expect(weighAddedByLine(info, NOW)).toBe("Driver-reported — added by @roadking · 2 h ago");
  });
  test("map stations carry no added-by line", () => {
    expect(weighAddedByLine(fresh(5), NOW)).toBeNull();
    expect(weighAddedByLine(null, NOW)).toBeNull();
    expect(weighAddedByLine(UNKNOWN, NOW)).toBeNull();
  });
});

describe("planNotHereCorrection — 'Not here' outcomes mirror the server (migration 0094)", () => {
  test("threshold is two independent drivers", () => {
    expect(NOT_HERE_RETIRE_THRESHOLD).toBe(2);
  });
  test("first mark hides for the reporter; creator's mark deletes; second independent mark retires", () => {
    expect(planNotHereCorrection({ reporter: "alice", creator: "bob", existingReporters: [] }).outcome).toBe("hidden");
    expect(planNotHereCorrection({ reporter: "bob", creator: "bob", existingReporters: [] }).outcome).toBe("deleted");
    expect(planNotHereCorrection({ reporter: "carol", creator: "bob", existingReporters: ["alice"] }).outcome).toBe("retired");
    expect(planNotHereCorrection({ reporter: "alice", creator: null, existingReporters: ["alice"] })).toEqual({
      outcome: "hidden",
      distinctReporters: 1,
      alreadyMarked: true,
    });
  });
});

describe("evaluateWeighPrompt — 'Not here' suppression (migration 0094)", () => {
  test("a station this driver marked Not here never prompts — even unknown, in range, on a live trip", () => {
    const hiddenPlaceIds = new Set(["weigh-1"]);
    expect(
      evaluateWeighPrompt({ ...baseInput, stations: [station("weigh-1", NORTH_0_5MI)], hiddenPlaceIds }),
    ).toBeNull();
    expect(isPlaceSuppressedForDriver("weigh-1", hiddenPlaceIds, new Set())).toBe(true);
  });
  test("a retired station never prompts for anyone", () => {
    const retiredPlaceIds = new Set(["weigh-1"]);
    expect(
      evaluateWeighPrompt({ ...baseInput, stations: [station("weigh-1", NORTH_0_5MI)], retiredPlaceIds }),
    ).toBeNull();
    expect(isPlaceSuppressedForDriver("weigh-1", new Set(), retiredPlaceIds)).toBe(true);
  });
  test("suppression is per-place: a hidden station does not block the next live station's prompt", () => {
    const c = evaluateWeighPrompt({
      ...baseInput,
      stations: [station("weigh-hidden", NORTH_0_5MI, 0.3), station("weigh-live", NORTH_0_5MI, 0.6)],
      hiddenPlaceIds: new Set(["weigh-hidden"]),
      retiredPlaceIds: new Set(["weigh-retired-elsewhere"]),
    });
    expect(c?.station.id).toBe("weigh-live");
  });
  test("the per-trip tracker also never opens a prompt for a hidden or retired station", () => {
    const t = new WeighPromptTracker();
    const input = {
      promptsEnabled: true,
      tripActive: true,
      pos: POS,
      headingDeg: 0,
      stations: [station("weigh-1", NORTH_0_5MI)],
      statuses: new Map<string, WeighStatusInfo>(),
      hiddenPlaceIds: new Set(["weigh-1"]),
      nowMs: NOW,
    };
    expect(t.consider(input, NOW)).toBeNull();
    expect(t.showing).toBeNull();
    const t2 = new WeighPromptTracker();
    expect(t2.consider({ ...input, hiddenPlaceIds: new Set<string>(), retiredPlaceIds: new Set(["weigh-1"]) }, NOW)).toBeNull();
  });
  test("without the Not-here sets, prompting is exactly as before (unregressed)", () => {
    expect(evaluateWeighPrompt({ ...baseInput, stations: [station("weigh-1", NORTH_0_5MI)] })?.station.id).toBe("weigh-1");
  });
});
