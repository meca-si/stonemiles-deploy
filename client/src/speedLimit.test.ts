// Unit tests for the speed-limit selection logic
// (client/src/speedLimit.ts) — the production math behind the LIMIT
// readout. Regression target: the driver report of 2026-10-27 (62 mph
// on I-10, limit "––") caused by the old lookup taking the FIRST
// maxspeed way Overpass returned instead of the NEAREST one.
// Run: bun test client/src/speedLimit.test.ts

import { describe, expect, test } from "bun:test";
import {
createPostedLimitStabilizer,
estimateLimitMph,
lastKnownHoldApplies,
limitBadgeCaption,
matchRoad,
nearestHighwayClass,
parkedSettleActive,
parseMaxspeedMph,
pickNearestLimit,
raceDeadline,
sameRoadContinuity,
SPEED_LIMIT_CHECKING_AFTER_MS,
SPEED_LIMIT_LOOKUP_BUDGET_MS,
speedLimitQueryDue,
trackHeadingDeg,
wayDistanceM,
wayLimitMph,
type LastPostedLimit,
type LatLon,
type OsmWayLite,
} from "./speedLimit";

// Base point: on I-10 near Theodore, AL.
const BASE = { lat: 30.6405, lon: -88.2587 };
const M_PER_DEG_LAT = 111189;
const M_PER_DEG_LON = 111189 * Math.cos((BASE.lat * Math.PI) / 180);

function pt(eastM: number, northM: number): LatLon {
  return {
    lat: BASE.lat + northM / M_PER_DEG_LAT,
    lon: BASE.lon + eastM / M_PER_DEG_LON,
  };
}

/** An east-west way running `northM` metres from the truck. */
function ewWay(northM: number, tags: Record<string, string>): OsmWayLite {
  const a = pt(-500, northM);
  const b = pt(500, northM);
  return { tags, geometry: [a, b] };
}

/** A north-south way running `eastM` metres from the truck.
 *  `southbound` reverses the node order (the way's directed
 *  bearing becomes 180° instead of 0°). */
function nsWay(eastM: number, tags: Record<string, string>, southbound = false): OsmWayLite {
  const a = pt(eastM, -500);
  const b = pt(eastM, 500);
  return { tags, geometry: southbound ? [b, a] : [a, b] };
}

describe("parseMaxspeedMph", () => {
  test("parses the tag spellings OSM uses", () => {
    expect(parseMaxspeedMph("70 mph")).toBe(70);
    expect(parseMaxspeedMph("25")).toBe(25);
    expect(parseMaxspeedMph("30 mph; 20 mph")).toBe(30);
    expect(parseMaxspeedMph("100 km/h")).toBe(62);
    expect(parseMaxspeedMph("60|70")).toBe(60);
  });
  test("refuses tags that state no numeric limit", () => {
    expect(parseMaxspeedMph("none")).toBeNull();
    expect(parseMaxspeedMph("walk")).toBeNull();
    expect(parseMaxspeedMph(undefined)).toBeNull();
    expect(parseMaxspeedMph("")).toBeNull();
  });
});

describe("wayLimitMph", () => {
  test("reads directional and per-lane variants", () => {
    expect(wayLimitMph({ highway: "primary", "maxspeed:forward": "45 mph" })).toBe(45);
    expect(wayLimitMph({ highway: "primary", "maxspeed:lanes": "35|35" })).toBe(35);
  });
  test("maxspeed:type is provenance, never a limit", () => {
    expect(wayLimitMph({ highway: "primary", "maxspeed:type": "sign" })).toBeNull();
  });
});

describe("pickNearestLimit — the I-10 regression", () => {
  test("the truck's own road wins over a nearer-listed frontage road", () => {
    // Overpass storage order puts the frontage road first; the old
    // code returned its 45. The interstate the truck is ON is 15 m
    // away, the frontage road 90 m — nearest line wins.
    const ways = [
      ewWay(90, { highway: "service", maxspeed: "45 mph" }),
      ewWay(15, { highway: "motorway", maxspeed: "70 mph" }),
      ewWay(-140, { highway: "residential", maxspeed: "25 mph" }),
    ];
    const got = pickNearestLimit(BASE, ways);
    expect(got?.limitMph).toBe(70);
    expect(got?.highway).toBe("motorway");
  });
  test("a crossing street's limit is not claimed when the truck's road has none in range", () => {
    const ways = [ewWay(300, { highway: "residential", maxspeed: "25 mph" })];
    expect(pickNearestLimit(BASE, ways)).toBeNull();
  });
  test("ways without geometry or limits are skipped", () => {
    const ways: OsmWayLite[] = [
      { tags: { highway: "motorway", maxspeed: "70 mph" } },
      ewWay(10, { highway: "motorway" }),
    ];
    expect(pickNearestLimit(BASE, ways)).toBeNull();
  });
});

describe("matchRoad — road test #3: parallel roads and crossings", () => {
  test("a crossing street closer than the truck's road no longer steals the match when heading is known", () => {
    // Truck rolling EAST on the motorway (25 m away, 70 mph); a
    // north-south street crosses 8 m away with a 35 limit. Distance
    // alone picks the crossing street (the pre-fix behaviour); the
    // heading signal must overrule it.
    const ways = [
      nsWay(8, { highway: "primary", maxspeed: "35 mph" }),
      ewWay(25, { highway: "motorway", maxspeed: "70 mph", ref: "I-10" }),
    ];
    expect(pickNearestLimit(BASE, ways)?.limitMph).toBe(35); // distance-only: wrong road
    expect(pickNearestLimit(BASE, ways, { headingDeg: 90 })?.limitMph).toBe(70);
    expect(pickNearestLimit(BASE, ways, { headingDeg: 90 })?.highway).toBe("motorway");
  });

  test("the opposing one-way carriageway is the wrong road, however close it runs", () => {
    // Divided highway: the southbound carriageway passes 15 m to
    // the east, the truck's own northbound carriageway 25 m west.
    // Both are oneway; the truck heads north.
    const ways = [
      nsWay(15, { highway: "motorway", maxspeed: "70 mph", oneway: "yes", ref: "I-10" }, true),
      nsWay(-25, { highway: "motorway", maxspeed: "65 mph", oneway: "yes", ref: "I-10" }, false),
    ];
    const got = pickNearestLimit(BASE, ways, { headingDeg: 0 });
    expect(got?.limitMph).toBe(65);
    expect(got?.distM).toBeCloseTo(25, 0);
  });

  test("continuity: the road already being driven beats a slightly nearer frontage road", () => {
    const ways = [
      ewWay(12, { highway: "service", maxspeed: "45 mph", name: "Frontage Rd" }),
      ewWay(30, { highway: "motorway", maxspeed: "70 mph", ref: "I-10" }),
    ];
    // No history: the nearer frontage road wins on distance — the
    // honest answer for a first fix in the ambiguity zone.
    expect(pickNearestLimit(BASE, ways)?.limitMph).toBe(45);
    // Having matched I-10 a moment ago, the match sticks until the
    // frontage evidence is clearly better than 12 m vs 30 m.
    const stuck = pickNearestLimit(BASE, ways, { prevRef: "I-10", prevHighway: "motorway", prevLimitMph: 70 });
    expect(stuck?.limitMph).toBe(70);
    expect(stuck?.ref).toBe("I-10");
  });

  test("calibration (road test #5): clear distance evidence outranks continuity — the service road under the truck wins over the interstate driven a minute ago", () => {
    // The I-65 screenshot case: the truck is ON the West service
    // road (5 m from its line), the interstate runs 45 m away, and
    // the previous match was I-65. The old −34 continuity bonus
    // rescued the interstate (45 − 34 = 11 < 5 + 14 hysteresis);
    // outside the continuity window there is no rescue — the road
    // under the truck is the match, and its limit is the readout.
    const ways = [
      ewWay(5, { highway: "service", maxspeed: "35 mph", name: "West I-65 Service Road" }),
      ewWay(45, { highway: "motorway", maxspeed: "70 mph", ref: "I-65" }),
    ];
    const got = pickNearestLimit(BASE, ways, { prevRef: "I-65", prevHighway: "motorway", prevLimitMph: 70 });
    expect(got?.limitMph).toBe(35);
    expect(got?.highway).toBe("service");
  });

  test("speed plausibility: a truck sustaining 69 mph is not on the parallel service road", () => {
    const ways = [
      ewWay(10, { highway: "service", maxspeed: "45 mph" }),
      ewWay(32, { highway: "motorway", maxspeed: "70 mph", ref: "I-10" }),
    ];
    expect(pickNearestLimit(BASE, ways)?.limitMph).toBe(45);
    expect(pickNearestLimit(BASE, ways, { headingDeg: 90, speedMph: 69 })?.limitMph).toBe(70);
  });

  test("the distance cap still binds: an aligned motorway 150 m away is not claimed", () => {
    const ways = [ewWay(150, { highway: "motorway", maxspeed: "70 mph", ref: "I-10" })];
    expect(pickNearestLimit(BASE, ways, { headingDeg: 90, prevRef: "I-10" })).toBeNull();
  });

  test("matchRoad reports the snapped point ON the winning line", () => {
    const m = matchRoad(BASE, [ewWay(30, { highway: "motorway", maxspeed: "70 mph" })]);
    expect(m).not.toBeNull();
    expect(Math.round(m!.distM)).toBe(30);
    // Snapped point lies on the way (30 m north of the truck).
    expect(Math.round((m!.snapped.lat - BASE.lat) * M_PER_DEG_LAT)).toBe(30);
    expect(Math.round((m!.snapped.lon - BASE.lon) * M_PER_DEG_LON)).toBe(0);
  });

  test("nearestHighwayClass follows the heading too — the EST rung names the driven road", () => {
    const ways = [
      nsWay(8, { highway: "primary" }),
      ewWay(25, { highway: "motorway" }),
    ];
    expect(nearestHighwayClass(BASE, ways, { headingDeg: 90 })?.highway).toBe("motorway");
  });
});

describe("trackHeadingDeg", () => {
  test("derives the course from a breadcrumb span", () => {
    const shape = [pt(0, 0), pt(100, 0), pt(300, 0)];
    expect(Math.round(trackHeadingDeg(shape) ?? -1)).toBe(90);
    const north = [pt(0, 0), pt(0, 200)];
    expect(Math.round(trackHeadingDeg(north) ?? -1)).toBe(0);
  });
  test("a span too short to mean anything gives null", () => {
    expect(trackHeadingDeg([pt(0, 0), pt(5, 0)])).toBeNull();
    expect(trackHeadingDeg([pt(0, 0)])).toBeNull();
  });
});

describe("PostedLimitStabilizer — one wrong match can never fire the banner", () => {
  test("the first posted answer displays but does not alert; the second agreeing one confirms", () => {
    const s = createPostedLimitStabilizer();
    const first = s.push(55);
    expect(first.displayMph).toBe(55);
    expect(first.alertMph).toBeNull();
    const second = s.push(55);
    expect(second.alertMph).toBe(55);
    expect(s.alertFor(55)).toBe(55);
  });
  test("a changed limit drops the alert until the new one confirms", () => {
    const s = createPostedLimitStabilizer();
    s.push(70);
    s.push(70);
    expect(s.alertMph).toBe(70);
    // The road test #3 shape: a single 55 arrives (wrong parallel
    // match) — the confirmed 70 must not be replaced by it, and it
    // must not alert either; the alert simply waits.
    const stray = s.push(55);
    expect(stray.displayMph).toBe(55);
    expect(stray.alertMph).toBeNull();
    expect(s.alertFor(70)).toBeNull();
    // The next lookup agrees with the road actually being driven.
    expect(s.push(70).alertMph).toBeNull();
    expect(s.push(70).alertMph).toBe(70);
  });
  test("a held (last-known) limit only alerts if it was the confirmed one", () => {
    const s = createPostedLimitStabilizer();
    s.push(45);
    expect(s.alertFor(45)).toBeNull(); // never confirmed
    s.push(45);
    expect(s.alertFor(45)).toBe(45);
    expect(s.alertFor(70)).toBeNull();
  });
});

describe("nearestHighwayClass + estimateLimitMph", () => {
  test("an untagged interstate still identifies as motorway and earns the labelled estimate", () => {
    const ways = [ewWay(20, { highway: "motorway" })];
    const cls = nearestHighwayClass(BASE, ways);
    expect(cls?.highway).toBe("motorway");
    expect(estimateLimitMph(cls?.highway ?? null)).toBe(70);
  });
  test("no estimate is invented for other road classes", () => {
    expect(estimateLimitMph("primary")).toBeNull();
    expect(estimateLimitMph("residential")).toBeNull();
    expect(estimateLimitMph(null)).toBeNull();
  });
  test("the class answer also reports the matched road's identity (2026-11-09: the continuity hold judges on it)", () => {
    const cls = nearestHighwayClass(BASE, [ewWay(20, { highway: "motorway", ref: "I-65" })]);
    expect(cls?.highway).toBe("motorway");
    expect(cls?.ref).toBe("I-65");
  });
});

describe("speedLimitQueryDue — the 2026-10-29 starvation regression", () => {
  // The truck is queried at BASE at t=100_000, then rolls east.
  const last = { at: 100_000, lat: BASE.lat, lon: BASE.lon };
  const east = (mi: number): LatLon => ({
    lat: BASE.lat,
    lon: BASE.lon + mi / (M_PER_DEG_LON / 1609.34),
  });
  test("the first fix is always due", () => {
    expect(speedLimitQueryDue({ at: 0, lat: 0, lon: 0 }, 100_000, BASE)).toBe(true);
  });
  test("highway movement alone does NOT re-fire after a few seconds", () => {
    // The old rule fired at >0.08 mi — ~4 s at 79 mph — so every
    // slow lookup was superseded before it could land. 0.2 mi in
    // 5 s must now wait.
    expect(speedLimitQueryDue(last, 105_000, east(0.2))).toBe(false);
    expect(speedLimitQueryDue(last, 114_999, east(0.2))).toBe(false);
  });
  test("moved past the small threshold once 15 s have passed → due", () => {
    expect(speedLimitQueryDue(last, 115_000, east(0.2))).toBe(true);
  });
  test("barely moved but 30 s old → due (standing refresh)", () => {
    expect(speedLimitQueryDue(last, 130_000, east(0.01))).toBe(true);
  });
  test("a big move (>0.6 mi) is due at once — a different road", () => {
    expect(speedLimitQueryDue(last, 103_000, east(0.7))).toBe(true);
  });
  test("parked and fresh → not due", () => {
    expect(speedLimitQueryDue(last, 110_000, BASE)).toBe(false);
  });
});

describe("wayDistanceM", () => {
  test("measures to the segment, not just the vertices", () => {
    // Truck midway along a long segment, 30 m north of the line:
    // vertex distance would be ~500 m; segment distance is 30 m.
    const w = ewWay(30, { highway: "motorway" });
    expect(Math.round(wayDistanceM(BASE, w))).toBe(30);
  });
});

// ---- The 2026-11-09 LIMIT fix ---------------------------------------
// Driver's overnight I-65 run: LIMIT "––" with NO caption at
// 2:55 AM, LIMIT 70 one minute later, same road, same speed. The
// dig proved the data existed (OSM 70 on every mainline way;
// Valhalla returns 70) — the blank was lookup latency plus three
// display rules: no deadline on the lookup, a LAST KNOWN window
// (3 min / 0.5 mi) too short for that latency, and a loading
// state with no caption. The three regressions below pin the
// repair's pure logic (speedLimit.ts); App.tsx wires it.

const eastMi = (mi: number): LatLon => pt(mi * 1609.34, 0);

describe("raceDeadline — the ~20 s lookup budget's enforcement", () => {
  test("a fast answer lands with its value", async () => {
    await expect(raceDeadline(Promise.resolve(70), 1000)).resolves.toBe(70);
  });
  test("a slow answer loses to the deadline — null, not a hang", async () => {
    const slow = new Promise<number>((r) => setTimeout(() => r(70), 250));
    await expect(raceDeadline(slow, 25)).resolves.toBeNull();
  });
  test("a fast failure still rejects, so the caller's fallback runs", async () => {
    await expect(raceDeadline(Promise.reject(new Error("offline")), 1000)).rejects.toThrow("offline");
  });
  test("a spent budget answers null at once — the ladder settles instead", async () => {
    await expect(raceDeadline(Promise.resolve(70), 0)).resolves.toBeNull();
  });
  test("the budget constants are the brief's numbers", () => {
    expect(SPEED_LIMIT_LOOKUP_BUDGET_MS).toBe(20_000);
    expect(SPEED_LIMIT_CHECKING_AFTER_MS).toBe(3_000);
  });
});

describe("limitBadgeCaption — every badge state carries its caption", () => {
  test("a posted number speaks for itself (no caption, as always)", () => {
    expect(limitBadgeCaption({ limitMph: 70, source: "posted", state: "ok", checking: false })).toBeNull();
  });
  test("the fallback rungs keep their labels", () => {
    expect(limitBadgeCaption({ limitMph: 70, source: "est", state: "ok", checking: false })).toBe("EST — NO POSTED DATA");
    expect(limitBadgeCaption({ limitMph: 70, source: "last", state: "ok", checking: false })).toBe("LAST KNOWN LIMIT");
  });
  test("an answered miss says NO LIMIT DATA", () => {
    expect(limitBadgeCaption({ limitMph: null, source: null, state: "unavailable", checking: false })).toBe("NO LIMIT DATA");
  });
  test("a lookup in flight past the checking threshold says CHECKING…", () => {
    expect(limitBadgeCaption({ limitMph: null, source: null, state: "loading", checking: true })).toBe("CHECKING…");
  });
  test("before the first GPS fix the sign says WAITING FOR GPS — a resting state WITH a caption, however long the fix takes", () => {
    // The audit-capture shape: location off / no fix yet, so no
    // lookup has ever started and no CHECKING timer ever arms.
    // The idle badge must still not sit at a bare "––".
    expect(limitBadgeCaption({ limitMph: null, source: null, state: "idle", checking: false })).toBe("WAITING FOR GPS");
    expect(limitBadgeCaption({ limitMph: null, source: null, state: "idle", checking: true })).toBe("WAITING FOR GPS");
  });
  test("the only caption-less blank is a lookup's first ~3 s — a transient, never a resting state", () => {
    expect(limitBadgeCaption({ limitMph: null, source: null, state: "loading", checking: false })).toBeNull();
  });
});

describe("LIMIT fix regression (a) — a slow lookup on an I-65-like motorway segment", () => {
  test("CHECKING… while the answer is in flight, then the posted 70 — never a bare indefinite ––", async () => {
    // t = 0: the lookup starts on I-65. No value yet; the first
    // ~3 s are the one allowed caption-less transient.
    let view: { limitMph: number | null; source: "posted" | "last" | "est" | null; state: "idle" | "loading" | "ok" | "unavailable"; checking: boolean } = {
      limitMph: null, source: null, state: "loading", checking: false,
    };
    expect(limitBadgeCaption(view)).toBeNull();
    // Past ~3 s the answer is STILL in flight (the measured
    // Overpass day: 28 s+, 502s) — the wait is labelled, so a
    // working lookup never reads as a broken blank sign.
    view = { ...view, checking: true };
    expect(limitBadgeCaption(view)).toBe("CHECKING…");
    // The answer lands inside the budget — Valhalla's 70 for this
    // exact stretch — and the badge takes it immediately.
    view = { limitMph: 70, source: "posted", state: "ok", checking: false };
    expect(view.limitMph).toBe(70);
    expect(limitBadgeCaption(view)).toBeNull();
  });

  test("when the budget expires with no answer, the settle is captioned — LAST KNOWN on I-65, NO LIMIT DATA with nothing posted", async () => {
    // The server call never answers inside the budget.
    const never = new Promise<number>(() => {});
    await expect(raceDeadline(never, 25)).resolves.toBeNull();
    // On I-65 the last posted 70 (a minute ago, 0.3 mi back, road
    // on record) settles the badge: the number AND its caption.
    const last: LastPostedLimit = {
      mph: 70, at: 1_000_000, lat: BASE.lat, lon: BASE.lon,
      road: { highway: "motorway", ref: "I-65", name: null },
    };
    expect(lastKnownHoldApplies(last, 1_060_000, eastMi(0.3), null)).toBe(true);
    expect(limitBadgeCaption({ limitMph: 70, source: "last", state: "ok", checking: false })).toBe("LAST KNOWN LIMIT");
    // With nothing ever posted, the settle is the honest caption.
    expect(lastKnownHoldApplies(null, 1_060_000, eastMi(0.3), null)).toBe(false);
    expect(limitBadgeCaption({ limitMph: null, source: null, state: "unavailable", checking: false })).toBe("NO LIMIT DATA");
  });
});

describe("LIMIT fix regression (b) — LAST KNOWN held on same-road continuity, dropped on a road change", () => {
  const postedAt = 1_000_000;
  const lastI65: LastPostedLimit = {
    mph: 70, at: postedAt, lat: BASE.lat, lon: BASE.lon,
    road: { highway: "motorway", ref: "I-65", name: null },
  };
  test("held PAST the old 3-minute / 0.5-mi window while the road is still I-65", () => {
    // Ten minutes and four miles later the old window is long
    // dead — but the newest answers keep identifying the road
    // (class from the Valhalla rung, the ref outright from
    // Overpass), so the 70 stays up, labelled LAST KNOWN.
    const now = postedAt + 10 * 60_000;
    const pos = eastMi(4);
    expect(lastKnownHoldApplies(lastI65, now, pos, { highway: "motorway", ref: null, name: null })).toBe(true);
    expect(lastKnownHoldApplies(lastI65, now, pos, { highway: "motorway", ref: "I-65", name: null })).toBe(true);
    // A shared road NAME carries continuity the same way.
    const named: LastPostedLimit = {
      mph: 45, at: postedAt, lat: BASE.lat, lon: BASE.lon,
      road: { highway: "primary", ref: null, name: "Airport Blvd" },
    };
    expect(lastKnownHoldApplies(named, now, pos, { highway: "primary", ref: null, name: "Airport Blvd" })).toBe(true);
  });
  test("dropped at once on a genuine road change — even inside the old freshness window", () => {
    const now = postedAt + 60_000; // 1 min on: fresh by the old rule
    // Off the interstate onto its service road: a different class
    // never borrows the held limit.
    expect(lastKnownHoldApplies(lastI65, now, BASE, { highway: "service", ref: null, name: "W I-65 Service Rd" })).toBe(false);
    // Onto the exit ramp.
    expect(lastKnownHoldApplies(lastI65, now, BASE, { highway: "motorway_link", ref: null, name: null })).toBe(false);
    // Onto a DIFFERENT interstate: same class, different ref.
    expect(lastKnownHoldApplies(lastI65, now, BASE, { highway: "motorway", ref: "I-10", name: null })).toBe(false);
  });
  test("when neither side can identify the road, the old freshness window decides", () => {
    const anonymous: LastPostedLimit = { ...lastI65, road: { highway: null, ref: null, name: null } };
    expect(lastKnownHoldApplies(anonymous, postedAt + 60_000, eastMi(0.3), { highway: "motorway", ref: null, name: null })).toBe(true);
    expect(lastKnownHoldApplies(anonymous, postedAt + 10 * 60_000, eastMi(0.3), null)).toBe(false);
    expect(lastKnownHoldApplies(null, postedAt, BASE, { highway: "motorway", ref: "I-65", name: null })).toBe(false);
  });
  test("sameRoadContinuity: class conflict beats a shared name; a ref conflict beats a shared class", () => {
    expect(sameRoadContinuity({ highway: "motorway", ref: null, name: "X Rd" }, { highway: "service", ref: null, name: "X Rd" })).toBe(false);
    expect(sameRoadContinuity({ highway: "motorway", ref: "I-65", name: null }, { highway: "motorway", ref: "I-10", name: null })).toBe(false);
    expect(sameRoadContinuity({ highway: "motorway", ref: "I-65", name: null }, { highway: "motorway", ref: null, name: null })).toBe(true);
    expect(sameRoadContinuity(null, { highway: "motorway", ref: null, name: null })).toBeNull();
    expect(sameRoadContinuity({ highway: null, ref: null, name: null }, { highway: "motorway", ref: null, name: null })).toBeNull();
  });
});

describe("LIMIT fix regression (c) — parked settle at a no-data lot (Tyson Rd, I-65 Exit 158)", () => {
  // Parked in a lot whose roads carry no maxspeed at all; one
  // lookup already ANSWERED "no data" here and the sign settled.
  const lot = { lat: BASE.lat, lon: BASE.lon };
  test("settled: parked at the spot, the settle holds however long the truck sits", () => {
    expect(parkedSettleActive(lot, BASE, 0)).toBe(true);
    expect(parkedSettleActive(lot, pt(20, 10), 0)).toBe(true); // GPS wander inside the lot
    expect(parkedSettleActive(lot, BASE, null)).toBe(true); // speed unreported, position unmoved
  });
  test("the standing refresh WOULD be due — the settle is the gate that stops the re-fire (no new loading cycles)", () => {
    const lastQuery = { at: 1_000_000, lat: BASE.lat, lon: BASE.lon };
    expect(speedLimitQueryDue(lastQuery, 1_600_000, BASE)).toBe(true); // 10 min parked: due on time alone
    expect(parkedSettleActive(lot, BASE, 0)).toBe(true); // …and suppressed by the settle
  });
  test("released the moment the truck moves again or leaves the spot", () => {
    expect(parkedSettleActive(lot, BASE, 12)).toBe(false); // rolling again
    expect(parkedSettleActive(lot, eastMi(0.2), 0)).toBe(false); // out of the lot
    expect(parkedSettleActive(null, BASE, 0)).toBe(false); // never settled
  });
  test("the badge the settle leaves behind is the captioned NO LIMIT DATA", () => {
    expect(limitBadgeCaption({ limitMph: null, source: null, state: "unavailable", checking: false })).toBe("NO LIMIT DATA");
  });
});
