// Unit tests for the docked gantry sign board logic
// (client/src/placard.ts). Run: bun test client/src/placard.test.ts
import { describe, expect, test } from "bun:test";
import {
  PLACARD_APPROACH_MI,
  PLACARD_FULL_MI,
  PLACARD_PALETTES,
  bridgeChipFor,
  buildPlacard,
  heightLabel,
  laneCaptionOf,
  parsePlacardRef,
  permitExitVerdict,
  permitStayLine,
  permitStayRoute,
  placardPalette,
  placardStage,
  weighChipFor,
  type PlacardManeuverLike,
} from "./placard";

function maneuver(partial: Partial<PlacardManeuverLike>): PlacardManeuverLike {
  return {
    instruction: "Continue",
    miles: 1,
    type: null,
    streetNames: [],
    beginStreetNames: [],
    exitNumber: null,
    exitName: null,
    exitToward: null,
    exitBranch: null,
    verbal: null,
    sign: null,
    lanes: null,
    ...partial,
  };
}

// The preview's own case, in the shape the live routing server
// actually returns (verified 2026-11-05): an I-65 exit whose sign
// object carries the exit number, the branch, and two toward towns.
const I65_EXIT = maneuver({
  instruction: "Take exit 242 onto I 65 North toward Birmingham.",
  type: 20,
  streetNames: ["I 65 North"],
  sign: {
    exitNumbers: ["242"],
    branches: [{ text: "I 65 North", consecutive: 1 }],
    towards: ["Birmingham", "Montgomery"],
    names: [],
  },
});

// A live-server exit shape (Birmingham run, 2026-11-05): two
// branches on one sign — the taken branch first, consecutive 1.
const I59_EXIT = maneuver({
  instruction: "Take exit 261B onto I 59 North toward Atlanta/Gadsden.",
  type: 20,
  sign: {
    exitNumbers: ["261B"],
    branches: [
      { text: "I 59 North", consecutive: 1 },
      { text: "I 20 East", consecutive: 0 },
    ],
    towards: ["Atlanta", "Gadsden"],
    names: [],
  },
});

describe("buildPlacard — sign data from the routing response", () => {
  test("builds the preview board: exit tab, shield, cardinal, both towns", () => {
    const p = buildPlacard(I65_EXIT, 3);
    expect(p).not.toBeNull();
    expect(p!.exitNumber).toBe("242");
    expect(p!.refs[0]).toMatchObject({ kind: "interstate", number: "65", label: "I-65", direction: "North" });
    expect(p!.directionWord).toBe("NORTH");
    expect(p!.destinations).toEqual(["Birmingham", "Montgomery"]);
    expect(p!.sign?.fullLabel).toBe("I-65 NORTH");
    expect(p!.dedupeKey).toBe("placard-3-242");
  });

  test("keeps every branch ref in sign order, capped at 3", () => {
    const p = buildPlacard(I59_EXIT, 5);
    expect(p!.refs.map((r) => r.label)).toEqual(["I-59", "I-20"]);
    expect(p!.exitNumber).toBe("261B");
    expect(p!.destinations).toEqual(["Atlanta", "Gadsden"]);
  });

  test("destinations cap at the gantry's two lines", () => {
    const p = buildPlacard(
      maneuver({
        type: 20,
        sign: { exitNumbers: ["9"], branches: [{ text: "US 98 West", consecutive: 0 }], towards: ["A", "B", "C"], names: [] },
      }),
      0,
    );
    expect(p!.destinations).toEqual(["A", "B"]);
  });

  test("falls back to the flat exit fields (routes saved before the sign parse)", () => {
    const p = buildPlacard(
      maneuver({
        instruction: "Take exit 49 onto I-10 W toward Mobile.",
        type: 20,
        exitNumber: "49",
        exitBranch: "I-10 W",
        exitToward: "Mobile",
      }),
      2,
    );
    expect(p!.exitNumber).toBe("49");
    expect(p!.refs[0]).toMatchObject({ label: "I-10", direction: "West" });
    expect(p!.destinations).toEqual(["Mobile"]);
  });

  test("a state-route branch reads as a state shield, not an interstate", () => {
    const p = buildPlacard(
      maneuver({
        instruction: "Take exit 128 onto AL 79 toward Tallapoosa Street.",
        type: 20,
        sign: { exitNumbers: ["128"], branches: [{ text: "AL 79", consecutive: 2 }], towards: ["Tallapoosa Street"], names: [] },
      }),
      1,
    );
    expect(p!.refs[0]).toMatchObject({ kind: "state", number: "79", label: "AL 79", direction: null });
    expect(p!.directionWord).toBeNull();
  });

  test("a signed stay/keep split boards (the I-10 West case)", () => {
    const p = buildPlacard(
      maneuver({
        instruction: "Keep right to stay on I-10 W.",
        type: 23,
        streetNames: ["I-10 W"],
        exitBranch: "I-10 W",
        verbal: "Keep right to stay on I-10 West.",
      }),
      4,
    );
    expect(p).not.toBeNull();
    expect(p!.sign?.fullLabel).toBe("I-10 WEST");
    expect(p!.side).toBe("right");
    expect(p!.exitNumber).toBeNull();
  });
});

describe("buildPlacard — honesty gates", () => {
  test("no sign data at all → no board (the one-line strip stays)", () => {
    expect(buildPlacard(maneuver({ type: 20, instruction: "Take the exit." }), 0)).toBeNull();
    expect(buildPlacard(maneuver({ type: 22, instruction: "Keep right." }), 0)).toBeNull();
  });

  test("a plain turn never boards, even with a named road", () => {
    expect(
      buildPlacard(maneuver({ type: 15, instruction: "Turn left onto Industrial Drive.", streetNames: ["Industrial Drive"] }), 0),
    ).toBeNull();
  });

  test("a merge never boards, even with sign data (x's mini-strip rule)", () => {
    expect(
      buildPlacard(
        maneuver({
          type: 38,
          instruction: "Merge onto I-65 N.",
          sign: { exitNumbers: [], branches: [{ text: "I 65 North", consecutive: 0 }], towards: ["Birmingham"], names: [] },
        }),
        0,
      ),
    ).toBeNull();
  });

  test("lanes are null when the maneuver carries no lane record — never invented", () => {
    const p = buildPlacard(I65_EXIT, 3);
    expect(p!.lanes).toBeNull();
    expect(p!.laneCaption).toBeNull();
  });

  test("a lane record rides through untouched, with its caption from the record", () => {
    const p = buildPlacard(
      maneuver({
        ...I65_EXIT,
        lanes: [
          { move: "straight", active: false },
          { move: "straight", active: false },
          { move: "straight", active: false },
          { move: "exit-right", active: true },
        ],
      }),
      3,
    );
    expect(p!.lanes).toHaveLength(4);
    expect(p!.laneCaption).toBe("Keep right — 1 lane exits");
  });

  test("an empty lane array is no lane data", () => {
    const p = buildPlacard(maneuver({ ...I65_EXIT, lanes: [] }), 3);
    expect(p!.lanes).toBeNull();
  });
});

describe("placardStage — x's locked staging", () => {
  test("beyond a mile: no board", () => {
    expect(placardStage(PLACARD_APPROACH_MI + 0.01, false)).toBeNull();
    expect(placardStage(2, false)).toBeNull();
  });
  test("a mile out to 0.3: slim approach", () => {
    expect(placardStage(PLACARD_APPROACH_MI, false)).toBe("slim");
    expect(placardStage(0.31, false)).toBe("slim");
  });
  test("inside 0.3: full board", () => {
    expect(placardStage(PLACARD_FULL_MI, false)).toBe("full");
    expect(placardStage(0.05, false)).toBe("full");
    expect(placardStage(0, false)).toBe("full");
  });
  test("one tap shrinks to mini at any in-window distance, until the next maneuver", () => {
    expect(placardStage(0.9, true)).toBe("mini");
    expect(placardStage(0.1, true)).toBe("mini");
    expect(placardStage(1.5, true)).toBeNull();
  });
  test("a passed/garbage distance shows nothing", () => {
    expect(placardStage(-0.1, false)).toBeNull();
    expect(placardStage(Number.NaN, false)).toBeNull();
  });
});

describe("parsePlacardRef", () => {
  test("interstate with direction", () => {
    expect(parsePlacardRef("I 65 North")).toMatchObject({ kind: "interstate", number: "65", direction: "North", directionAbbr: "N", label: "I-65" });
  });
  test("US route without direction keeps the route, claims no cardinal", () => {
    expect(parsePlacardRef("US 98")).toMatchObject({ kind: "us", number: "98", direction: null, label: "US 98" });
  });
  test("state route with direction", () => {
    expect(parsePlacardRef("AL 79 North")).toMatchObject({ kind: "state", label: "AL 79", direction: "North" });
  });
  test("a plain street branch stays an honest text ref", () => {
    const r = parsePlacardRef("Tallapoosa Street");
    expect(r.kind).toBe("text");
    expect(r.number).toBeNull();
    expect(r.label).toBe("Tallapoosa Street");
  });
});

describe("laneCaptionOf", () => {
  test("counts exit lanes from the record", () => {
    expect(
      laneCaptionOf([
        { move: "straight", active: false },
        { move: "exit-left", active: true },
        { move: "exit-left", active: true },
      ]),
    ).toBe("Keep left — 2 lanes exit");
  });
  test("no active lane → no caption", () => {
    expect(laneCaptionOf([{ move: "straight", active: false }])).toBeNull();
  });
});

describe("smart chips — real data only", () => {
  test("weigh chip shows a known status with its distance", () => {
    expect(weighChipFor({ distanceMi: 6, distanceLabel: "6 mi", status: "open" })?.text).toBe("Weigh station 6 mi — OPEN");
    expect(weighChipFor({ distanceMi: 2.5, distanceLabel: "2.5 mi", status: "closed" })?.tone).toBe("closed");
  });
  test("weigh chip is omitted when the status isn't known", () => {
    expect(weighChipFor({ distanceMi: 6, distanceLabel: "6 mi", status: "unknown" })).toBeNull();
    expect(weighChipFor(null)).toBeNull();
  });
  test("bridge chip: a clearing bridge reads with a check", () => {
    // 14'2" tagged, truck 13'6" — the preview's own figures.
    expect(bridgeChipFor({ clearanceFt: 14 + 2 / 12, truckHeightFt: 13.5 })?.text).toBe("Bridge 14'2\" — you're 13'6\" ✓");
  });
  test("bridge chip: a short bridge warns TOO LOW", () => {
    const chip = bridgeChipFor({ clearanceFt: 13 + 2 / 12, truckHeightFt: 13.5 });
    expect(chip?.tone).toBe("short");
    expect(chip?.text).toContain("TOO LOW");
  });
  test("bridge chip: exact-fit clearance is a clear, no data is no chip", () => {
    expect(bridgeChipFor({ clearanceFt: 13.5, truckHeightFt: 13.5 })?.tone).toBe("clear");
    expect(bridgeChipFor(null)).toBeNull();
  });
  test("heightLabel reads like the sign", () => {
    expect(heightLabel(13.5)).toBe("13'6\"");
    expect(heightLabel(14 + 2 / 12)).toBe("14'2\"");
    expect(heightLabel(16)).toBe("16'0\"");
  });
});

describe("permit variant", () => {
  test("the stay-on road parses from the docket's printed route lines", () => {
    expect(permitStayRoute({ routeSteps: ["Begin on I-65 N at mile 212", "End at the plant gate"], routePlaces: [] })).toBe("I-65");
    expect(permitStayLine({ routeSteps: ["I-65 N"], routePlaces: [] })).toBe("Permit route stays on I-65");
  });
  test("no route token in the docket → the general line, no invented road", () => {
    expect(permitStayRoute({ routeSteps: ["County Road 12 to the gate"], routePlaces: ["Theodore, AL"] })).toBeNull();
    expect(permitStayLine({ routeSteps: [], routePlaces: [] })).toBe("Stay on your approved permit route");
  });
});

describe("permitExitVerdict — the red claim must be verified", () => {
  const DOCKET = {
    routeSteps: ["Begin I-65 N at US 31", "Exit 242 onto US 31 S", "End at the plant gate, Birmingham"],
    routePlaces: ["Theodore, AL", "Birmingham, AL"],
  };
  test("an exit the permit itself names is on-route — green, no warning", () => {
    // Exit 242 onto US 31 toward Birmingham is IN the docket's steps.
    const p = buildPlacard(
      maneuver({
        type: 20,
        sign: { exitNumbers: ["242"], branches: [{ text: "US 31 South", consecutive: 0 }], towards: ["Birmingham"], names: [] },
      }),
      0,
    );
    expect(permitExitVerdict(DOCKET, p!)).toBe("on-route");
  });
  test("a stay on the permit's own highway is on-route", () => {
    const p = buildPlacard(I65_EXIT, 3); // I-65 North toward Birmingham/Montgomery
    expect(permitExitVerdict(DOCKET, p!)).toBe("on-route");
  });
  test("an exit naming only roads/places the permit never names is verified off-route", () => {
    const p = buildPlacard(I59_EXIT, 5); // I-59 North toward Atlanta/Gadsden
    expect(permitExitVerdict(DOCKET, p!)).toBe("off-route");
  });
  test("nothing comparable on the maneuver side → unknown, no claim", () => {
    const p = buildPlacard(
      maneuver({
        type: 20,
        sign: { exitNumbers: ["7"], branches: [{ text: "Frontage Road", consecutive: 0 }], towards: [], names: [] },
      }),
      0,
    );
    expect(permitExitVerdict(DOCKET, p!)).toBe("unknown");
  });
  test("a docket naming nothing comparable → unknown, no claim", () => {
    const p = buildPlacard(I59_EXIT, 5);
    expect(permitExitVerdict({ routeSteps: [], routePlaces: [] }, p!)).toBe("unknown");
  });
});

describe("night dim palette", () => {
  test("night is a real dimming of every board surface, not a relabel", () => {
    const day = PLACARD_PALETTES.day;
    const night = PLACARD_PALETTES.night;
    expect(night.boardBg).not.toBe(day.boardBg);
    expect(night.exitTabBg).not.toBe(day.exitTabBg);
    expect(night.text).not.toBe(day.text);
    expect(night.permitBg).not.toBe(day.permitBg);
    expect(placardPalette(true)).toBe(night);
    expect(placardPalette(false)).toBe(day);
  });
});
