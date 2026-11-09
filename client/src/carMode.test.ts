import { describe, expect, test } from "bun:test";
import {
  CAR_TEMPLATES,
  carReadout,
  carTierFeatures,
  formatHosLeft,
  formatTurnDistance,
  headUnitAlerts,
  headUnitStops,
  hosAlert,
  receiverMemoryNote,
  shouldAutoOpenCarDisplay,
  type CarReadoutInput,
  type HeadUnitStopInput,
} from "./carMode";

const base: CarReadoutInput = {
  speedMph: 62,
  speedLimitMph: 65,
  overspeedThresholdMph: 5,
  guidanceActive: true,
  arrived: false,
  arrow: "↱",
  instruction: "Take exit 90 toward Mobile",
  street: "I-10 W",
  distToTurnMi: 2.3,
  etaText: "4:32 PM",
  timeLeftText: "2 h 14 min",
  milesLeft: 148.2,
  destinationLabel: "Haleyville, AL",
  hosDriveLeftH: 7.33,
  showHos: true,
};

describe("formatTurnDistance", () => {
  test("feet under a tenth of a mile, rounded to 50s", () => {
    expect(formatTurnDistance(0.05)).toBe("250 ft");
    expect(formatTurnDistance(0)).toBe("0 ft");
  });
  test("one decimal under 10 miles, whole above", () => {
    expect(formatTurnDistance(2.34)).toBe("2.3 mi");
    expect(formatTurnDistance(148.2)).toBe("148 mi");
  });
  test("bad input reads as a dash, never a guess", () => {
    expect(formatTurnDistance(Number.NaN)).toBe("—");
    expect(formatTurnDistance(-1)).toBe("—");
  });
});

describe("formatHosLeft", () => {
  test("hours and minutes, zero-padded minutes", () => {
    expect(formatHosLeft(7.33)).toBe("7 h 20 m");
    expect(formatHosLeft(0.7)).toBe("42 m");
  });
  test("never negative", () => {
    expect(formatHosLeft(-2)).toBe("0 m");
  });
});

describe("carReadout", () => {
  test("guidance live: turn block + speed/eta/miles/hos tiles, capped at four", () => {
    const r = carReadout(base);
    expect(r.turn?.instruction).toBe("Take exit 90 toward Mobile");
    expect(r.turn?.distanceText).toBe("2.3 mi");
    expect(r.turn?.imminent).toBe(false);
    expect(r.tiles.map((t) => t.id)).toEqual(["speed", "eta", "miles", "hos"]);
    expect(r.tiles.length).toBeLessThanOrEqual(4);
  });

  test("no guidance: no turn block, no eta/miles tiles — speed and HOS only", () => {
    const r = carReadout({ ...base, guidanceActive: false, instruction: null });
    expect(r.turn).toBeNull();
    expect(r.tiles.map((t) => t.id)).toEqual(["speed", "hos"]);
  });

  test("speed tile shows the driver's dash-matched readout — GPS + 3 (x's order 2026-11-09)", () => {
    const r = carReadout(base); // base speedMph 62
    expect(r.tiles[0]?.value).toBe("65");
    // …while the overspeed flag still judges the TRUE speed:
    // 72 actual in a 65 + 5 threshold is urgent; the tile prints
    // the dash number, 75.
    const fast = carReadout({ ...base, speedMph: 72 });
    expect(fast.tiles[0]?.value).toBe("75");
    expect(fast.tiles[0]?.urgent).toBe(true);
  });

  test("overspeed past the driver's own threshold flags the speed tile", () => {
    const r = carReadout({ ...base, speedMph: 72 });
    expect(r.tiles[0]?.urgent).toBe(true);
    const within = carReadout({ ...base, speedMph: 69 });
    expect(within.tiles[0]?.urgent).toBe(false);
  });

  test("unknown limit never claims overspeed; missing speed reads as dashes", () => {
    const r = carReadout({ ...base, speedMph: null, speedLimitMph: null });
    expect(r.tiles[0]?.value).toBe("––");
    expect(r.tiles[0]?.urgent).toBe(false);
    expect(r.tiles[0]?.sub).toBe("mph");
  });

  test("turn inside half a mile is imminent; drive clock under 30 min is urgent", () => {
    const r = carReadout({ ...base, distToTurnMi: 0.4, hosDriveLeftH: 0.4 });
    expect(r.turn?.imminent).toBe(true);
    expect(r.tiles.find((t) => t.id === "hos")?.urgent).toBe(true);
    expect(r.tiles.find((t) => t.id === "hos")?.value).toBe("24 m");
  });

  test("HOS tile hides when the driver turns it off or there is no HOS data", () => {
    expect(carReadout({ ...base, showHos: false }).tiles.some((t) => t.id === "hos")).toBe(false);
    expect(carReadout({ ...base, hosDriveLeftH: null }).tiles.some((t) => t.id === "hos")).toBe(false);
  });

  test("missing instruction means no turn block even with guidance flagged on", () => {
    expect(carReadout({ ...base, instruction: null }).turn).toBeNull();
  });
});

describe("shouldAutoOpenCarDisplay", () => {
  test("opens only when enabled + auto-launch + guidance live + not dismissed", () => {
    expect(shouldAutoOpenCarDisplay({ enabled: true, autoLaunch: true, guidanceActive: true, dismissed: false })).toBe(true);
    expect(shouldAutoOpenCarDisplay({ enabled: false, autoLaunch: true, guidanceActive: true, dismissed: false })).toBe(false);
    expect(shouldAutoOpenCarDisplay({ enabled: true, autoLaunch: false, guidanceActive: true, dismissed: false })).toBe(false);
    expect(shouldAutoOpenCarDisplay({ enabled: true, autoLaunch: true, guidanceActive: false, dismissed: false })).toBe(false);
    expect(shouldAutoOpenCarDisplay({ enabled: true, autoLaunch: true, guidanceActive: true, dismissed: true })).toBe(false);
  });
});

describe("headUnitStops — the Stops ahead screen", () => {
  const stop = (over: Partial<HeadUnitStopInput>): HeadUnitStopInput => ({
    id: "s1",
    name: "Love's Travel Stop",
    brandLabel: "Love's",
    distanceMi: 10,
    offRouteMi: 0,
    dieselPrice: null,
    truckParking: null,
    showers: null,
    scales: null,
    lat: 30,
    lon: -88,
    ...over,
  });

  test("nearest first; stops behind the truck or unmeasured are dropped", () => {
    const rows = headUnitStops(
      [
        stop({ id: "far", distanceMi: 42 }),
        stop({ id: "near", distanceMi: 3.2 }),
        stop({ id: "behind", distanceMi: -1 }),
        stop({ id: "unknown", distanceMi: Number.NaN }),
      ],
      false,
    );
    expect(rows.map((r) => r.id)).toEqual(["near", "far"]);
    expect(rows[0]?.distanceText).toBe("3.2 mi");
  });

  test("rolling caps at four rows, parked at six — the distraction rule", () => {
    const many = Array.from({ length: 8 }, (_, i) => stop({ id: `s${i}`, distanceMi: i + 1 }));
    expect(headUnitStops(many, true).length).toBe(4);
    expect(headUnitStops(many, false).length).toBe(6);
  });

  test("facts come only from what the data states — unknowns never appear", () => {
    const [bare] = headUnitStops([stop({})], false);
    expect(bare?.facts).toEqual([]);
    const [rich] = headUnitStops(
      [stop({ dieselPrice: 3.899, truckParking: true, showers: true, scales: false, offRouteMi: 0.4 })],
      false,
    );
    expect(rich?.facts).toEqual(["Diesel $3.90", "Truck parking", "Showers", "0.4 mi off route"]);
  });

  test("weigh stations ride the same list, lead with their reported status, and never tap", () => {
    const rows = headUnitStops(
      [
        stop({ id: "fuel", distanceMi: 9 }),
        stop({
          id: "weigh-1",
          name: "Weigh station",
          brandLabel: "Weigh station",
          distanceMi: 4,
          kind: "weigh",
          leadFact: "OPEN — driver-reported",
        }),
      ],
      false,
    );
    expect(rows.map((r) => r.id)).toEqual(["weigh-1", "fuel"]);
    expect(rows[0]?.facts).toEqual(["OPEN — driver-reported"]);
    expect(rows[0]?.tappable).toBe(false);
    expect(rows[1]?.tappable).toBe(true);
  });
});

describe("receiverMemoryNote — receiver memory on approach", () => {
  const base = {
    facility: "Peacock Pavers",
    site: "Mobile, AL",
    visits: 3,
    avgDwellHours: 2.4,
    lastNote: "Check in at the guard shack",
    lastDoor: "12",
  };

  test("far out, the surface stays down — it is an approach surface", () => {
    expect(receiverMemoryNote({ ...base, milesLeft: 120 })).toBeNull();
    expect(receiverMemoryNote({ ...base, milesLeft: null })).toBeNull();
  });

  test("inside 50 miles it reads at a glance: visits, dwell, door, the driver's own note", () => {
    const r = receiverMemoryNote({ ...base, milesLeft: 32 });
    expect(r?.headline).toBe("What to expect here — Peacock Pavers (Mobile, AL)");
    expect(r?.line).toBe("3 visits here · avg dwell 2.4 h · door 12 last time");
    expect(r?.note).toBe("Check in at the guard shack");
  });

  test("no recorded door or note: the line just omits them", () => {
    const r = receiverMemoryNote({ ...base, lastNote: null, lastDoor: null, visits: 1, milesLeft: 5 });
    expect(r?.line).toBe("1 visit here · avg dwell 2.4 h");
    expect(r?.note).toBeNull();
  });
});

describe("headUnitAlerts + hosAlert — the Road alerts screen", () => {
  test("nearest first, unplaced (drive clock) last, never more than three", () => {
    const rows = headUnitAlerts([
      { id: "w", kind: "weigh", label: "Weigh station", detail: "Ahead", distanceMi: 12 },
      { id: "b", kind: "bridge", label: "Low bridge 13'6\"", detail: "Under your height", distanceMi: 2 },
      { id: "n", kind: "notruck", label: "No trucks", detail: "Restricted road", distanceMi: 30 },
      { id: "h", kind: "hos", label: "Drive clock running out", detail: "24 m left", distanceMi: null },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["b", "w", "n"]);
    expect(rows[0]?.urgent).toBe(true);
    expect(rows[0]?.icon).toBe("🌉");
    expect(rows[1]?.urgent).toBe(false);
  });

  test("the drive-clock alert exists only when the clock is dying and shown", () => {
    expect(hosAlert(0.4, true)?.kind).toBe("hos");
    expect(hosAlert(0.5, true)).toBeNull();
    expect(hosAlert(3, true)).toBeNull();
    expect(hosAlert(0.4, false)).toBeNull();
    expect(hosAlert(null, true)).toBeNull();
  });
});

describe("carTierFeatures — tier inclusion, never an add-on", () => {
  test("Basic gets none of the full-version features — the core display only", () => {
    expect(carTierFeatures(false)).toEqual({
      autoLaunch: false,
      voiceOnDisplay: false,
      hosTile: false,
      headUnitScreens: false,
    });
  });

  test("Gold-and-up gets the full version for its tier", () => {
    expect(carTierFeatures(true)).toEqual({
      autoLaunch: true,
      voiceOnDisplay: true,
      hosTile: true,
      headUnitScreens: true,
    });
  });
});

describe("car templates", () => {
  test("the three Android Auto templates bind real STONEMILES fields", () => {
    expect(CAR_TEMPLATES.map((t) => t.id)).toEqual(["navigation", "places", "alert"]);
    for (const t of CAR_TEMPLATES) expect(t.binds.length).toBeGreaterThan(0);
  });
});
