import { describe, expect, test } from "bun:test";
import {
evaluateSealGrade,
RELEASE_GRADE_GEOFENCE_MI,
type FixQualityTallies,
} from "./sealGrade";

const goodFix: FixQualityTallies = {
  accepted: 900,
  rejAccuracy: 20,
  rejJump: 5,
  rejTime: 0,
  accLe10: 300,
  accLe25: 300,
  accLe50: 200,
  accLe65: 100,
  accGt65: 15,
  accNone: 10,
}; // 925 raw fixes, 900 inside 65 m → 97% good

const base = {
  distanceMi: 0.1,
  bolSha256: "a".repeat(64),
  sealMismatch: false,
  fixQuality: goodFix,
};

describe("evaluateSealGrade", () => {
  test("all four criteria hold → release_grade", () => {
    const r = evaluateSealGrade(base);
    expect(r.grade).toBe("release_grade");
    expect(r.criteria.tightGeofence.pass).toBe(true);
    expect(r.criteria.bolFingerprinted.pass).toBe(true);
    expect(r.criteria.noOpenExceptions.pass).toBe(true);
    expect(r.criteria.gpsFixQuality.pass).toBe(true);
  });

  test("distance inside the 3-mile points radius but outside the tight radius → proof_grade", () => {
    const r = evaluateSealGrade({ ...base, distanceMi: 1.5 });
    expect(r.grade).toBe("proof_grade");
    expect(r.criteria.tightGeofence.pass).toBe(false);
    expect(r.criteria.tightGeofence.distanceMi).toBe(1.5);
    expect(r.criteria.tightGeofence.radiusMi).toBe(RELEASE_GRADE_GEOFENCE_MI);
  });

  test("distance exactly at the tight radius passes; just beyond fails", () => {
    expect(evaluateSealGrade({ ...base, distanceMi: RELEASE_GRADE_GEOFENCE_MI }).grade).toBe(
      "release_grade",
    );
    expect(
      evaluateSealGrade({ ...base, distanceMi: RELEASE_GRADE_GEOFENCE_MI + 0.01 }).grade,
    ).toBe("proof_grade");
  });

  test("unmeasured distance (no delivery spot) → proof_grade", () => {
    const r = evaluateSealGrade({ ...base, distanceMi: null });
    expect(r.grade).toBe("proof_grade");
    expect(r.criteria.tightGeofence.pass).toBe(false);
  });

  test("no fingerprinted BOL → proof_grade", () => {
    const r = evaluateSealGrade({ ...base, bolSha256: null });
    expect(r.grade).toBe("proof_grade");
    expect(r.criteria.bolFingerprinted.pass).toBe(false);
  });

  test("open exception (seal mismatch) → proof_grade, with the reason recorded", () => {
    const r = evaluateSealGrade({ ...base, sealMismatch: true });
    expect(r.grade).toBe("proof_grade");
    expect(r.criteria.noOpenExceptions.pass).toBe(false);
    expect(r.criteria.noOpenExceptions.detail).toContain("seal mismatch");
  });

  test("no trip sheet yet → fix quality unproven → proof_grade", () => {
    const r = evaluateSealGrade({ ...base, fixQuality: null });
    expect(r.grade).toBe("proof_grade");
    expect(r.criteria.gpsFixQuality.pass).toBe(false);
    expect(r.criteria.gpsFixQuality.accepted).toBeNull();
  });

  test("mostly coarse fixes → proof_grade even with everything else perfect", () => {
    const coarse: FixQualityTallies = {
      accepted: 40,
      rejAccuracy: 300,
      rejJump: 0,
      rejTime: 0,
      accLe10: 5,
      accLe25: 5,
      accLe50: 10,
      accLe65: 20,
      accGt65: 250,
      accNone: 50,
    }; // 340 raw, 40 good → 12%
    const r = evaluateSealGrade({ ...base, fixQuality: coarse });
    expect(r.grade).toBe("proof_grade");
    expect(r.criteria.gpsFixQuality.goodShare).toBeCloseTo(0.118, 2);
  });

  test("zero accepted fixes → proof_grade", () => {
    const none: FixQualityTallies = { ...goodFix, accepted: 0 };
    const r = evaluateSealGrade({ ...base, fixQuality: none });
    expect(r.grade).toBe("proof_grade");
    expect(r.criteria.gpsFixQuality.pass).toBe(false);
  });
});
