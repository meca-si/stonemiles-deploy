// Unit tests for the split-sign prompt logic (client/src/signCheck.ts).
// Run: bun test client/src/signCheck.test.ts
import { describe, expect, test } from "bun:test";
import {
  evaluateManeuverCard,
  evaluateSignPrompt,
  findNextSplitSign,
  isSplitManeuver,
  laneSideOf,
  parseRoadSign,
  type SignManeuverLike,
} from "./signCheck";

function maneuver(partial: Partial<SignManeuverLike>): SignManeuverLike {
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
    ...partial,
  };
}

// The driver's own scenario (2026-11-01): westbound on I-10, the road
// bends, and at the split the route keeps right onto I-10 WEST —
// Valhalla's stay-right maneuver with the sign branch attached.
const I10_WEST_SPLIT = maneuver({
  instruction: "Keep right to stay on I-10 W.",
  type: 23, // stay right
  streetNames: ["I-10 W"],
  beginStreetNames: ["I-10 W"],
  exitBranch: "I-10 W",
  verbal: "Keep right to stay on I-10 West.",
});

describe("parseRoadSign", () => {
  test("reads the gantry sign off the split maneuver: I-10 WEST", () => {
    const sign = parseRoadSign(I10_WEST_SPLIT);
    expect(sign?.kind).toBe("interstate");
    expect(sign?.number).toBe("10");
    expect(sign?.direction).toBe("West");
    expect(sign?.fullLabel).toBe("I-10 WEST");
    expect(sign?.spokenLabel).toBe("I-10 West");
  });
  test("single-letter and full-word cardinals both parse", () => {
    expect(parseRoadSign(maneuver({ exitBranch: "I-65 S" }))?.fullLabel).toBe("I-65 SOUTH");
    expect(parseRoadSign(maneuver({ beginStreetNames: ["Interstate 10 East"] }))?.fullLabel).toBe("I-10 EAST");
    expect(parseRoadSign(maneuver({ streetNames: ["US 98 W"] }))?.fullLabel).toBe("US 98 WEST");
  });
  test("direction may come from the instruction when the street name lacks it", () => {
    const sign = parseRoadSign(
      maneuver({ beginStreetNames: ["I-10"], instruction: "Keep right to stay on I-10 W." }),
    );
    expect(sign?.fullLabel).toBe("I-10 WEST");
  });
  test("a route number with NO direction in the data yields NO sign — never guessed", () => {
    expect(
      parseRoadSign(maneuver({ beginStreetNames: ["I-10"], instruction: "Keep right to stay on I-10." })),
    ).toBeNull();
  });
  test("exit_toward (a town name) never supplies a direction", () => {
    expect(
      parseRoadSign(maneuver({ beginStreetNames: ["I-10"], exitToward: "West Memphis" })),
    ).toBeNull();
  });
  test("an ordinary street turn carries no sign", () => {
    expect(parseRoadSign(maneuver({ instruction: "Turn right onto Main Street.", streetNames: ["Main Street"] }))).toBeNull();
  });
});

describe("isSplitManeuver + laneSideOf", () => {
  test("stay / exit / ramp / merge types are splits; plain turns are not", () => {
    expect(isSplitManeuver(I10_WEST_SPLIT)).toBe(true);
    expect(isSplitManeuver(maneuver({ type: 20 }))).toBe(true); // exit right
    expect(isSplitManeuver(maneuver({ type: 22 }))).toBe(true); // stay straight
    expect(isSplitManeuver(maneuver({ type: 10, instruction: "Turn right onto Main Street." }))).toBe(false);
    expect(isSplitManeuver(maneuver({ type: 8, instruction: "Continue on Main Street." }))).toBe(false);
  });
  test("keep wording alone (no type) still counts as a split", () => {
    expect(isSplitManeuver(maneuver({ instruction: "Keep left at the fork to stay on I-10 E." }))).toBe(true);
  });
  test("lane side comes from the maneuver itself", () => {
    expect(laneSideOf(I10_WEST_SPLIT)).toBe("right");
    expect(laneSideOf(maneuver({ type: 21 }))).toBe("left"); // exit left
    expect(laneSideOf(maneuver({ type: 22 }))).toBe("straight"); // stay straight
    expect(laneSideOf(maneuver({ instruction: "Keep left to stay on I-10 E." }))).toBe("left");
    expect(laneSideOf(maneuver({ instruction: "Continue." }))).toBeNull();
  });
});

describe("evaluateSignPrompt — the driver's I-10 West case", () => {
  test("inside 2 miles the prompt pops with the sign and the right lane", () => {
    const p = evaluateSignPrompt(I10_WEST_SPLIT, 1.4, 5);
    expect(p).not.toBeNull();
    expect(p!.sign.fullLabel).toBe("I-10 WEST");
    expect(p!.laneLabel).toBe("Right lane");
    expect(p!.phase).toBe("early");
    expect(p!.spokenEarly).toContain("I-10 West");
    expect(p!.spokenEarly).toContain("right lane");
    expect(p!.spokenNow).toContain("I-10 West");
  });
  test("phases tighten as the split closes in", () => {
    expect(evaluateSignPrompt(I10_WEST_SPLIT, 0.5, 5)?.phase).toBe("prepare");
    expect(evaluateSignPrompt(I10_WEST_SPLIT, 0.1, 5)?.phase).toBe("now");
  });
  test("beyond the window there is no prompt yet", () => {
    expect(evaluateSignPrompt(I10_WEST_SPLIT, 2.1, 5)).toBeNull();
    expect(evaluateSignPrompt(I10_WEST_SPLIT, 40, 5)).toBeNull();
  });
  test("no prompt for an ordinary turn, even at the curb", () => {
    expect(
      evaluateSignPrompt(maneuver({ type: 10, instruction: "Turn right onto Main Street.", streetNames: ["Main Street"] }), 0.1, 0),
    ).toBeNull();
  });
  test("no prompt when the data's sign has no direction (the honesty rule)", () => {
    expect(
      evaluateSignPrompt(
        maneuver({ type: 23, instruction: "Keep right to stay on I-10.", beginStreetNames: ["I-10"] }),
        0.4,
        0,
      ),
    ).toBeNull();
  });
  test("exit number rides along only when the data returned it", () => {
    const withExit = evaluateSignPrompt({ ...I10_WEST_SPLIT, exitNumber: "25" }, 1, 5);
    expect(withExit?.exitLine).toBe("Exit 25");
    expect(evaluateSignPrompt(I10_WEST_SPLIT, 1, 5)?.exitLine).toBeNull();
  });
  test("dedupe key is stable for the same maneuver + sign", () => {
    const a = evaluateSignPrompt(I10_WEST_SPLIT, 1.4, 5)!;
    const b = evaluateSignPrompt(I10_WEST_SPLIT, 0.4, 5)!;
    expect(a.dedupeKey).toBe(b.dedupeKey);
  });
});

describe("parseRoadSign — widened field phrasings (2026-11-01 field fix)", () => {
  test("westbound wording after the token parses", () => {
    expect(parseRoadSign(maneuver({ exitBranch: "I-10 Westbound" }))?.fullLabel).toBe("I-10 WEST");
  });
  test("a cardinal riding BEFORE the token parses (Westbound I-10)", () => {
    expect(parseRoadSign(maneuver({ instruction: "Take the ramp onto Westbound I-10." }))?.fullLabel).toBe("I-10 WEST");
  });
  test("single letter with a period parses (I-65 S.)", () => {
    expect(parseRoadSign(maneuver({ exitBranch: "I-65 S." }))?.fullLabel).toBe("I-65 SOUTH");
  });
  test("state route signs parse as highway signs", () => {
    expect(parseRoadSign(maneuver({ beginStreetNames: ["State Route 59 North"] }))?.fullLabel).toBe("Highway 59 NORTH");
  });
  test("exit fields alone make a maneuver a split candidate", () => {
    expect(isSplitManeuver(maneuver({ type: 8, instruction: "Continue.", exitNumber: "49", exitBranch: "I-10 W" }))).toBe(true);
  });
});

describe("evaluateManeuverCard — exit & turn prompt cards (2026-11-01 field fix)", () => {
  test("the driver's screenshot case: turn left onto Michael Boulevard cards at city range", () => {
    const card = evaluateManeuverCard(
      maneuver({ type: 15, instruction: "Turn left onto Michael Boulevard.", beginStreetNames: ["Michael Boulevard"] }),
      0.3,
      2,
    );
    expect(card?.kind).toBe("turn");
    expect(card?.title).toBe("Michael Boulevard");
  });
  test("an ordinary turn beyond 0.6 mi does not card yet", () => {
    expect(
      evaluateManeuverCard(
        maneuver({ type: 15, instruction: "Turn left onto Michael Boulevard.", beginStreetNames: ["Michael Boulevard"] }),
        1.2,
        2,
      ),
    ).toBeNull();
  });
  test("an exit cards within 2 miles with its number and branch", () => {
    const card = evaluateManeuverCard(
      maneuver({ type: 20, instruction: "Take exit 49 toward Mobile.", exitNumber: "49", exitToward: "Mobile", exitBranch: "I-10 W" }),
      1.7,
      4,
    );
    expect(card?.kind).toBe("exit");
    expect(card?.title).toBe("EXIT 49");
    expect(card?.exitLine).toContain("toward Mobile");
  });
  test("a continue maneuver with no exit data and no turn gets NO card — nothing invented", () => {
    expect(evaluateManeuverCard(maneuver({ type: 8, instruction: "Continue." }), 0.2, 0)).toBeNull();
    expect(
      evaluateManeuverCard(maneuver({ type: 10, instruction: "Turn right." }), 0.2, 0),
    ).toBeNull(); // a turn onto an UNNAMED road cards nothing — the banner already says it
  });
});

describe("findNextSplitSign — the panel's next-sign-ahead read", () => {
  const route: SignManeuverLike[] = [
    maneuver({ instruction: "Head west on I-10 W.", type: 2, miles: 12, beginStreetNames: ["I-10 W"] }),
    maneuver({ instruction: "Continue on I-10 W.", type: 8, miles: 30, streetNames: ["I-10 W"] }),
    { ...I10_WEST_SPLIT, miles: 4 },
    maneuver({ instruction: "Continue on I-10 W.", type: 8, miles: 20, streetNames: ["I-10 W"] }),
  ];
  test("finds the split ahead at its true distance", () => {
    // Truck is 3 mi into maneuver 1 (30 mi long → 27 mi to its end,
    // which is the split maneuver's point under the guidance
    // convention: following maneuvers start where the countdown ends).
    const next = findNextSplitSign(route, 1, 27);
    expect(next).not.toBeNull();
    expect(next!.maneuverIndex).toBe(2);
    expect(next!.atMi).toBe(27);
    expect(next!.phase).toBe("ahead");
    expect(next!.sign.fullLabel).toBe("I-10 WEST");
  });
  test("when the split IS the current maneuver, its distance is the countdown", () => {
    const next = findNextSplitSign(route, 2, 1.2);
    expect(next!.maneuverIndex).toBe(2);
    expect(next!.atMi).toBe(1.2);
    expect(next!.phase).toBe("early");
  });
  test("a route with no signed split returns null — nothing invented", () => {
    const plain = [maneuver({ type: 8, miles: 5 }), maneuver({ type: 10, instruction: "Turn right onto Main Street.", miles: 1 })];
    expect(findNextSplitSign(plain, 0, 4)).toBeNull();
    expect(findNextSplitSign([], 0, 0)).toBeNull();
  });
});
