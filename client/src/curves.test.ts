// Curve / rollover tests (migration 0107): advisory speed from
// real route geometry, the speed comparison, and the tall/heavy
// rig getting a lower advisory and an earlier, stronger call.
import { describe, expect, test } from "bun:test";
import {
  advisoryMphForRadius,
  buildCurves,
  curveAlertState,
  isTallOrHeavy,
  rigAdvisoryMph,
} from "./curves";

// Build a route in a local tangent plane (meters east/north of an
// origin), converted to lat/lon: 1 mi straight north, then a
// circular arc of radius R turning right (east), then straight.
function routeWithArc(radiusM: number, arcDeg = 80): [number, number][] {
  const lat0 = 39.0;
  const lon0 = -105.0;
  const mLat = 111_320;
  const mLon = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const toLatLon = (eastM: number, northM: number): [number, number] => [
    lat0 + northM / mLat,
    lon0 + eastM / mLon,
  ];
  const pts: [number, number][] = [];
  for (let n = 0; n <= 1609; n += 100) pts.push(toLatLon(0, n));
  const steps = 24;
  for (let i = 1; i <= steps; i++) {
    const a = (arcDeg * Math.PI) / 180 * (i / steps);
    pts.push(toLatLon(radiusM * (1 - Math.cos(a)), 1609 + radiusM * Math.sin(a)));
  }
  const endA = (arcDeg * Math.PI) / 180;
  const ex = radiusM * (1 - Math.cos(endA));
  const ey = 1609 + radiusM * Math.sin(endA);
  for (let d = 100; d <= 800; d += 100) {
    pts.push(toLatLon(ex + d * Math.sin(endA), ey + d * Math.cos(endA)));
  }
  return pts;
}

const STANDARD = { heightIn: 12 * 12, weightLbs: 40000 };
const TALL_HEAVY = { heightIn: 13 * 12 + 6, weightLbs: 78000 };

describe("advisoryMphForRadius", () => {
  test("tighter radius, lower advisory", () => {
    expect(advisoryMphForRadius(100)).toBe(30); // sqrt(9.81*.2*100)=14 m/s ≈ 31 mph → 30
    expect(advisoryMphForRadius(50)).toBeLessThan(advisoryMphForRadius(100));
    expect(advisoryMphForRadius(2000)).toBe(65); // capped
  });
});

describe("buildCurves", () => {
  test("finds the arc and prices it from its radius", () => {
    const curves = buildCurves(routeWithArc(100));
    expect(curves.length).toBe(1);
    expect(curves[0]!.radiusM).toBeGreaterThan(60);
    expect(curves[0]!.radiusM).toBeLessThan(140);
    expect(curves[0]!.advisoryMph).toBeGreaterThanOrEqual(25);
    expect(curves[0]!.advisoryMph).toBeLessThanOrEqual(30);
    expect(curves[0]!.direction).toBe("right");
    // The curve sits just past the 1-mile straight.
    expect(curves[0]!.atMi).toBeGreaterThan(0.9);
    expect(curves[0]!.atMi).toBeLessThan(1.3);
  });

  test("a straight route has no curves; a gentle sweep is not a rollover event", () => {
    const straight: [number, number][] = [];
    for (let i = 0; i <= 20; i++) straight.push([39 + i * 0.002, -105]);
    expect(buildCurves(straight)).toEqual([]);
    expect(buildCurves(routeWithArc(1500))).toEqual([]); // advisory hits the cap
    expect(buildCurves(null)).toEqual([]);
    expect(buildCurves([])).toEqual([]);
  });
});

describe("curveAlertState", () => {
  const curves = buildCurves(routeWithArc(100));
  const at = curves[0]!.atMi;

  test("warns a fast rig 0.3 mi out, naming advisory + live speed", () => {
    const s = curveAlertState(curves, at - 0.28, 55, STANDARD);
    expect(s).not.toBeNull();
    expect(s!.advisoryMph).toBe(curves[0]!.advisoryMph);
    expect(s!.speedMph).toBe(55);
    expect(s!.strong).toBe(true); // well over the advisory
  });

  test("a rig already slow enough hears NOTHING", () => {
    expect(curveAlertState(curves, at - 0.3, 30, STANDARD)).toBeNull();
    expect(curveAlertState(curves, at - 0.3, 25, STANDARD)).toBeNull();
  });

  test("no known speed, no call", () => {
    expect(curveAlertState(curves, at - 0.3, null, STANDARD)).toBeNull();
  });

  test("tall/heavy rig: advisory drops 5 and the call comes at 0.5 mi", () => {
    expect(isTallOrHeavy(TALL_HEAVY)).toBe(true);
    expect(isTallOrHeavy(STANDARD)).toBe(false);
    expect(rigAdvisoryMph(curves[0]!, TALL_HEAVY)).toBe(curves[0]!.advisoryMph - 5);
    // 0.45 mi out: silent for the standard rig, called for the tall/heavy one.
    expect(curveAlertState(curves, at - 0.45, 40, STANDARD)).toBeNull();
    const s = curveAlertState(curves, at - 0.45, 40, TALL_HEAVY);
    expect(s).not.toBeNull();
    expect(s!.advisoryMph).toBe(curves[0]!.advisoryMph - 5);
  });

  test("a curve already passed never fires", () => {
    expect(curveAlertState(curves, at + 0.4, 60, STANDARD)).toBeNull();
  });
});
