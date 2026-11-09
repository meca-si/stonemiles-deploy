// Unit tests for the maneuver side geometry check
// (client/src/maneuverSide.ts). Run: bun test client/src/maneuverSide.test.ts
import { describe, expect, test } from "bun:test";
import {
  correctManeuverSide,
  geometricTurnDeg,
  statedSideOf,
  swapDirectionWords,
  type SideCheckManeuver,
} from "./maneuverSide";

const M_PER_DEG = 111194.93; // 6371000 * pi / 180

/** Build a polyline from bearing runs (each leg split into ~step-m
 *  segments), starting at lat/lon. A 200 m leg at the default 20 m
 *  step puts the leg joint at index 10 — the tests' begin point. */
function pathFrom(
  start: [number, number],
  legs: { bearing: number; meters: number; step?: number }[],
): { pts: [number, number][] } {
  const pts: [number, number][] = [start];
  let lat = start[0];
  let lon = start[1];
  for (const leg of legs) {
    const step = leg.step ?? 20;
    let remaining = leg.meters;
    while (remaining > 0.001) {
      const d = Math.min(step, remaining);
      const br = (leg.bearing * Math.PI) / 180;
      lat += (d * Math.cos(br)) / M_PER_DEG;
      lon += (d * Math.sin(br)) / (M_PER_DEG * Math.cos((lat * Math.PI) / 180));
      pts.push([lat, lon]);
      remaining -= d;
    }
  }
  return { pts };
}

function maneuver(partial: Partial<SideCheckManeuver>): SideCheckManeuver {
  return { type: null, instruction: "Continue", verbal: null, ...partial };
}

describe("geometricTurnDeg", () => {
  test("a right bend reads positive, a left bend negative", () => {
    const right = pathFrom([30.56, -88.2], [
      { bearing: 0, meters: 200 },
      { bearing: 40, meters: 200 },
    ]);
    const dRight = geometricTurnDeg(right.pts, 10);
    expect(dRight).not.toBeNull();
    expect(dRight!).toBeGreaterThan(30);
    expect(dRight!).toBeLessThan(50);
    const left = pathFrom([30.56, -88.2], [
      { bearing: 0, meters: 200 },
      { bearing: -40, meters: 200 },
    ]);
    const dLeft = geometricTurnDeg(left.pts, 10);
    expect(dLeft!).toBeLessThan(-30);
  });

  test("a straight run reads ~0", () => {
    const s = pathFrom([30.56, -88.2], [{ bearing: 15, meters: 400 }]);
    expect(Math.abs(geometricTurnDeg(s.pts, 10)!)).toBeLessThan(3);
  });

  test("no verdict at the route ends or on degenerate geometry", () => {
    const s = pathFrom([30.56, -88.2], [{ bearing: 0, meters: 400 }]);
    expect(geometricTurnDeg(s.pts, 0)).toBeNull(); // no incoming shape
    expect(geometricTurnDeg(s.pts, s.pts.length - 1)).toBeNull(); // no outgoing shape
    expect(geometricTurnDeg([[30.56, -88.2]], 0)).toBeNull();
    expect(geometricTurnDeg(s.pts, 9999)).toBeNull();
  });

  test("sparse highway shape still measures the window, not the whole segment", () => {
    // 300 m segments: the outgoing window (80 m) lands INSIDE the
    // first outgoing segment by interpolation.
    const s = pathFrom([30.56, -88.2], [
      { bearing: 0, meters: 300, step: 300 },
      { bearing: 30, meters: 300, step: 300 },
    ]);
    const d = geometricTurnDeg(s.pts, 1);
    expect(d!).toBeGreaterThan(20);
    expect(d!).toBeLessThan(40);
  });
});

// The genuine left-turn ramp onto I-10 at Theodore Dawes Road,
// replayed live from the routing server at build time (Theodore →
// Mobile, truck costing): the shape's own points around the ramp
// maneuver's begin point (shape index 56 of the full leg; here
// rebased so the begin point is index 8). The shape turns hard
// LEFT across the overpass — the router's word is the road's real
// shape, and the check must leave it byte-identical.
const THEODORE_DAWES_RAMP: [number, number][] = [
  [30.55999, -88.20457], [30.55995, -88.2044], [30.5599, -88.20414], [30.55979, -88.20362],
  [30.55976, -88.20342], [30.55967, -88.203], [30.55961, -88.20268], [30.55949, -88.20198],
  [30.55936, -88.20131], // <- begin point of the ramp maneuver
  [30.55946, -88.20121], [30.55956, -88.20111], [30.56004, -88.20075], [30.56055, -88.20037],
  [30.56072, -88.20024], [30.56088, -88.2001], [30.56109, -88.19992], [30.56128, -88.19973],
  [30.56152, -88.19948], [30.56192, -88.19911], [30.56229, -88.19862], [30.56345, -88.19704],
  [30.56875, -88.18982], [30.57194, -88.18549],
];

describe("correctManeuverSide", () => {
  test("the driver's case: card says left, the shape bends right — type, text, and verbal are corrected", () => {
    // Northbound approach; past the maneuver point the route's own
    // shape bends ~40° RIGHT (the ramp presents on the right).
    const { pts } = pathFrom([30.56, -88.2], [
      { bearing: 0, meters: 200 },
      { bearing: 40, meters: 200 },
    ]);
    const fix = correctManeuverSide(
      maneuver({
        type: 19, // ramp left
        instruction: "Turn left to take the I 10 ramp.",
        verbal: "Turn left to take the Interstate 10 ramp.",
      }),
      pts,
      10,
    );
    expect(fix).not.toBeNull();
    expect(fix!.type).toBe(18); // ramp right
    expect(fix!.instruction).toBe("Turn right to take the I 10 ramp.");
    expect(fix!.verbal).toBe("Turn right to take the Interstate 10 ramp.");
  });

  test("the follow-on lane call is corrected the same way (keep-left over a rightward shape)", () => {
    const { pts } = pathFrom([30.56, -88.2], [
      { bearing: 0, meters: 200 },
      { bearing: 35, meters: 200 },
    ]);
    const fix = correctManeuverSide(
      maneuver({ type: 24, instruction: "Keep left to take the exit.", verbal: "Keep left to take the exit." }),
      pts,
      10,
    );
    expect(fix!.type).toBe(23);
    expect(fix!.instruction).toBe("Keep right to take the exit.");
  });

  test("agreeing maneuvers are untouched — the genuine Theodore Dawes left ramp", () => {
    const turn = geometricTurnDeg(THEODORE_DAWES_RAMP, 8);
    expect(turn!).toBeLessThan(-30); // the fixture really does turn left
    const fix = correctManeuverSide(
      maneuver({ type: 19, instruction: "Turn left to take the I 10 ramp.", verbal: "Turn left to take the Interstate 10 ramp." }),
      THEODORE_DAWES_RAMP,
      8,
    );
    expect(fix).toBeNull();
  });

  test("an ordinary agreeing turn is untouched", () => {
    const { pts } = pathFrom([30.56, -88.2], [
      { bearing: 90, meters: 200 },
      { bearing: 0, meters: 200 }, // 90° left turn
    ]);
    const fix = correctManeuverSide(maneuver({ type: 15, instruction: "Turn left onto Bellingrath Road." }), pts, 10);
    expect(fix).toBeNull();
  });

  test("a gentle fork is the router's call — no correction below the threshold", () => {
    const { pts } = pathFrom([30.56, -88.2], [
      { bearing: 0, meters: 200 },
      { bearing: 8, meters: 200 },
    ]);
    expect(correctManeuverSide(maneuver({ type: 19, instruction: "Turn left to take the ramp." }), pts, 10)).toBeNull();
    expect(correctManeuverSide(maneuver({ type: 18, instruction: "Turn right to take the ramp." }), pts, 10)).toBeNull();
  });

  test("exit-on-the-left over a rightward shape becomes the right exit", () => {
    const { pts } = pathFrom([30.56, -88.2], [
      { bearing: 90, meters: 200 },
      { bearing: 125, meters: 200 },
    ]);
    const fix = correctManeuverSide(maneuver({ type: 21, instruction: "Take the exit on the left." }), pts, 10);
    expect(fix!.type).toBe(20);
    expect(fix!.instruction).toBe("Take the exit on the right.");
  });

  test("a 'straight' ramp that decisively bends gets the sided type — words untouched (they claimed no side)", () => {
    const { pts } = pathFrom([30.56, -88.2], [
      { bearing: 0, meters: 200 },
      { bearing: 45, meters: 200 },
    ]);
    const fix = correctManeuverSide(maneuver({ type: 17, instruction: "Take the I 10 ramp." }), pts, 10);
    expect(fix!.type).toBe(18);
    expect(fix!.instruction).toBe("Take the I 10 ramp.");
  });

  test("a keep on a curving mainline is NOT refined into a side below the straight threshold", () => {
    const { pts } = pathFrom([30.56, -88.2], [
      { bearing: 0, meters: 200 },
      { bearing: 20, meters: 200 },
    ]);
    expect(correctManeuverSide(maneuver({ type: 22, instruction: "Stay on I-10." }), pts, 10)).toBeNull();
  });

  test("U-turn territory never gets a side verdict", () => {
    const { pts } = pathFrom([30.56, -88.2], [
      { bearing: 0, meters: 200 },
      { bearing: 175, meters: 200 },
    ]);
    expect(correctManeuverSide(maneuver({ type: 15, instruction: "Turn left." }), pts, 10)).toBeNull();
  });

  test("a wording-only maneuver (no type) is corrected in text, type stays null", () => {
    const { pts } = pathFrom([30.56, -88.2], [
      { bearing: 0, meters: 200 },
      { bearing: -50, meters: 200 },
    ]);
    const fix = correctManeuverSide(maneuver({ type: null, instruction: "Turn right at the fork." }), pts, 10);
    expect(fix!.type).toBeNull();
    expect(fix!.instruction).toBe("Turn left at the fork.");
  });

  test("no geometry, no correction", () => {
    const { pts } = pathFrom([30.56, -88.2], [{ bearing: 0, meters: 200 }]);
    expect(correctManeuverSide(maneuver({ type: 19, instruction: "Turn left to take the ramp." }), pts, pts.length - 1)).toBeNull();
  });
});

describe("statedSideOf", () => {
  test("type code first, wording as the fallback", () => {
    expect(statedSideOf(maneuver({ type: 11, instruction: "Turn." }))).toBe("right"); // sharp right claims a side
    expect(statedSideOf(maneuver({ type: 17, instruction: "Take the ramp." }))).toBe("straight");
    expect(statedSideOf(maneuver({ type: null, instruction: "Keep left to stay on I-10." }))).toBe("left");
    expect(statedSideOf(maneuver({ type: null, instruction: "Continue." }))).toBeNull();
  });
});

describe("swapDirectionWords", () => {
  test("verb phrases, on-the-side, and lane phrases swap with case preserved", () => {
    expect(swapDirectionWords("Turn left to take the I 10 ramp.", "left", "right")).toBe("Turn right to take the I 10 ramp.");
    expect(swapDirectionWords("Keep right to stay on I-10 W.", "right", "left")).toBe("Keep left to stay on I-10 W.");
    expect(swapDirectionWords("Take the exit on the left.", "left", "right")).toBe("Take the exit on the right.");
    expect(swapDirectionWords("Stay in the left lane for the exit.", "left", "right")).toBe("Stay in the right lane for the exit.");
    expect(swapDirectionWords("TURN LEFT at the fork.", "left", "right")).toBe("TURN RIGHT at the fork.");
  });

  test("road names are never rewritten", () => {
    expect(swapDirectionWords("Turn left onto Left Bank Road.", "left", "right")).toBe("Turn right onto Left Bank Road.");
    expect(swapDirectionWords("Turn right onto Wright Avenue.", "right", "left")).toBe("Turn left onto Wright Avenue.");
  });
});
