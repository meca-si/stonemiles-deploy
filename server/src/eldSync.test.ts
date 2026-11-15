// ELD sync pipeline rules (TMS queue item 8) — the pure half: every
// feed payload is validated against the contract its existing
// reader consumes, malformed payloads are rejected with named
// errors (never stored, never silently emptied), the simulated
// device payload set passes its own contracts and carries the
// simulated marker in the data itself.
//
// Run: bun test server/src/eldSync.test.ts
import { describe, expect, test } from "bun:test";
import {
  simulatedEldPayloads,
  snapshotIsSimulated,
  summarizeEldSync,
  validateEldFeedPayload,
} from "./eldSync";

const NOW = new Date("2026-11-15T12:00:00.000Z");

describe("hos_clocks — the mirrored-clocks contract", () => {
  test("accepts the four remaining-hour fields", () => {
    const v = validateEldFeedPayload("hos_clocks", { driveRemainH: 7.5, windowRemainH: 9, cycleRemainH: 42, breakRemainH: 3 });
    expect(v.ok).toBe(true);
  });
  test("rejects a missing or negative clock, naming the field", () => {
    const missing = validateEldFeedPayload("hos_clocks", { driveRemainH: 7.5, windowRemainH: 9, cycleRemainH: 42 });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors.join(" ")).toContain("breakRemainH");
    const negative = validateEldFeedPayload("hos_clocks", { driveRemainH: -1, windowRemainH: 9, cycleRemainH: 42, breakRemainH: 3 });
    expect(negative.ok).toBe(false);
  });
});

describe("hos_logs", () => {
  test("accepts duty-state entries with ISO timestamps", () => {
    const v = validateEldFeedPayload("hos_logs", { logs: [{ state: "driving", at: "2026-11-15T10:00:00.000Z" }] });
    expect(v.ok).toBe(true);
  });
  test("rejects an unknown duty state and a bad timestamp", () => {
    const v = validateEldFeedPayload("hos_logs", { logs: [{ state: "flying", at: "not-a-date" }] });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.errors.join(" ")).toContain("state");
      expect(v.errors.join(" ")).toContain("at");
    }
  });
});

describe("dvirs — the ELD DVIR list's shape", () => {
  test("accepts reported inspections with defects", () => {
    const v = validateEldFeedPayload("dvirs", {
      dvirs: [{ id: 1, inspectedAt: "2026-11-15T08:00:00.000Z", vehicle: "Unit 7", status: "defects_reported", defects: [{ item: "Brakes", note: "Soft pedal", critical: true }] }],
    });
    expect(v.ok).toBe(true);
  });
  test("a defect without an item name is rejected", () => {
    const v = validateEldFeedPayload("dvirs", { dvirs: [{ defects: [{ note: "?" }] }] });
    expect(v.ok).toBe(false);
  });
});

describe("vehicle_stats", () => {
  test("an odometer reading alone is enough (the trip miles source)", () => {
    expect(validateEldFeedPayload("vehicle_stats", { odometerMi: 512340.5 }).ok).toBe(true);
  });
  test("an empty stats payload is rejected — a sync must carry a reading", () => {
    expect(validateEldFeedPayload("vehicle_stats", {}).ok).toBe(false);
    expect(validateEldFeedPayload("vehicle_stats", { lat: 91, lon: 0 }).ok).toBe(false);
  });
});

describe("ifta — the reconciliation's shape", () => {
  test("accepts state/miles rows", () => {
    expect(validateEldFeedPayload("ifta", { states: [{ state: "AL", miles: 412.5 }] }).ok).toBe(true);
  });
  test("rejects a bad state code and negative miles", () => {
    const v = validateEldFeedPayload("ifta", { states: [{ state: "Alabama", miles: -3 }] });
    expect(v.ok).toBe(false);
  });
});

describe("identity — the eld_identity reader's fields", () => {
  test("normalizes to the reader's driver/truck fields, nulls for gaps", () => {
    const v = validateEldFeedPayload("identity", {
      driver: { name: "Pat Driver", cdlNumber: "X123" },
      truck: { unitNumber: "7", year: 2022 },
    });
    expect(v.ok).toBe(true);
    if (v.ok) {
      const n = v.normalized as { driver: Record<string, unknown>; truck: Record<string, unknown> };
      expect(n.driver.name).toBe("Pat Driver");
      expect(n.driver.cdlState).toBeNull();
      expect(n.truck.year).toBe(2022);
      expect(n.truck.odometerMi).toBeNull();
    }
  });
  test("a wrong-typed field is rejected, not coerced", () => {
    expect(validateEldFeedPayload("identity", { driver: { name: 42 } }).ok).toBe(false);
    expect(validateEldFeedPayload("identity", { truck: { year: "2022" } }).ok).toBe(false);
  });
});

describe("the pipeline's edges", () => {
  test("an unknown feed is rejected by name", () => {
    const v = validateEldFeedPayload("gps_pings", {});
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors[0]).toContain("unknown feed");
  });
  test("a non-object payload is rejected", () => {
    expect(validateEldFeedPayload("hos_clocks", [1, 2, 3]).ok).toBe(false);
    expect(validateEldFeedPayload("hos_clocks", "nope").ok).toBe(false);
  });
});

describe("simulated device payloads", () => {
  test("every simulated payload passes its own contract", () => {
    const batch = simulatedEldPayloads(NOW);
    expect(batch.map((b) => b.feed)).toEqual(["hos_clocks", "hos_logs", "dvirs", "vehicle_stats", "ifta", "identity"]);
    for (const item of batch) {
      const v = validateEldFeedPayload(item.feed, item.payload);
      if (!v.ok) throw new Error(`${item.feed} simulated payload failed validation: ${v.errors.join("; ")}`);
    }
  });
  test("the simulated marker is in the stored data itself", () => {
    for (const item of simulatedEldPayloads(NOW)) {
      expect(snapshotIsSimulated(JSON.stringify(item.payload))).toBe(true);
    }
    expect(snapshotIsSimulated(JSON.stringify({ driveRemainH: 1 }))).toBe(false);
    expect(snapshotIsSimulated("not json")).toBe(false);
  });
  test("the simulated identity names itself simulated", () => {
    const identity = simulatedEldPayloads(NOW).find((b) => b.feed === "identity");
    const v = validateEldFeedPayload("identity", identity?.payload);
    expect(v.ok).toBe(true);
    if (v.ok) {
      const n = v.normalized as { driver: Record<string, unknown> };
      expect(String(n.driver.name)).toContain("Simulated");
    }
  });
});

describe("summarizeEldSync", () => {
  test("counts accepted/rejected and renders one line per feed", () => {
    const s = summarizeEldSync([
      { feed: "hos_clocks", ok: true, errors: [] },
      { feed: "ifta", ok: false, errors: ["states must be an array"] },
    ]);
    expect(s.accepted).toBe(1);
    expect(s.rejected).toBe(1);
    expect(s.lines[0]).toBe("hos_clocks: received");
    expect(s.lines[1]).toContain("rejected");
  });
});
