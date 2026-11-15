// Unit tests for faultCodes.ts (Wave 2 item 11, Part B):
// normalization, the curated table, the unknown-code honesty
// rule (recorded as reported, meaning null, urgency unknown,
// never an invented meaning), the draft rule, and the due-soon
// computation (estimates from recorded readings; unknown when
// the inputs aren't there).
//
// Run: bun test server/src/faultCodes.test.ts
import { describe, expect, test } from "bun:test";
import {
  FAULT_CODE_TABLE,
  faultDraftsWorkOrder,
  lookupFaultCode,
  maintenanceDueFlags,
  normalizeFaultCode,
} from "./faultCodes";

describe("normalizeFaultCode", () => {
  test("OBD codes clean to their key form", () => {
    expect(normalizeFaultCode("p0401")).toBe("P0401");
    expect(normalizeFaultCode(" P2463 ")).toBe("P2463");
  });

  test("SPN codes drop the FMI dressing — the SPN names the parameter", () => {
    expect(normalizeFaultCode("SPN 3216")).toBe("SPN3216");
    expect(normalizeFaultCode("SPN 3216 FMI 4")).toBe("SPN3216");
    expect(normalizeFaultCode("spn3364")).toBe("SPN3364");
  });
});

describe("lookupFaultCode — known codes", () => {
  test("a known service-soon code answers with meaning + urgency", () => {
    const l = lookupFaultCode("P2463");
    expect(l.known).toBe(true);
    expect(l.urgency).toBe("service_soon");
    expect(l.meaning).toContain("particulate filter");
    expect(l.note).toBeNull();
  });

  test("stop-now codes are classified stop_now", () => {
    expect(lookupFaultCode("P0524").urgency).toBe("stop_now");
    expect(lookupFaultCode("P0217").urgency).toBe("stop_now");
  });

  test("SPN codes resolve through the same table", () => {
    const l = lookupFaultCode("SPN 5246");
    expect(l.known).toBe(true);
    expect(l.urgency).toBe("service_soon");
  });

  test("every table entry has a meaning and a real urgency", () => {
    expect(FAULT_CODE_TABLE.length).toBeGreaterThanOrEqual(30);
    for (const e of FAULT_CODE_TABLE) {
      expect(e.meaning.length).toBeGreaterThan(10);
      expect(["stop_now", "service_soon", "watch"]).toContain(e.urgency);
    }
  });
});

describe("lookupFaultCode — the unknown-code honesty rule", () => {
  test("an unknown code records as reported: meaning null, urgency unknown, no invention", () => {
    const l = lookupFaultCode("P9999");
    expect(l.known).toBe(false);
    expect(l.meaning).toBeNull();
    expect(l.urgency).toBe("unknown");
    expect(l.category).toBeNull();
    expect(l.note).toContain("recorded exactly as reported");
    expect(l.code).toBe("P9999");
  });

  test("a nonsense string also lands as unknown, never dressed up", () => {
    const l = lookupFaultCode("check engine light thing");
    expect(l.known).toBe(false);
    expect(l.urgency).toBe("unknown");
  });
});

describe("faultDraftsWorkOrder", () => {
  test("stop-now and service-soon draft; watch and unknown don't", () => {
    expect(faultDraftsWorkOrder("stop_now")).toBe(true);
    expect(faultDraftsWorkOrder("service_soon")).toBe(true);
    expect(faultDraftsWorkOrder("watch")).toBe(false);
    expect(faultDraftsWorkOrder("unknown")).toBe(false);
  });
});

describe("maintenanceDueFlags", () => {
  const now = Date.parse("2026-11-15T12:00:00Z");

  test("miles math: due soon inside 1000 miles of interval, overdue past it", () => {
    const flags = maintenanceDueFlags({
      services: [
        { item: "oil", intervalMiles: 25000, lastDoneOdometer: 100000, lastDoneAtMs: now - 90 * 86400000 },
        { item: "fuel_filter", intervalMiles: 30000, lastDoneOdometer: 100000, lastDoneAtMs: now - 90 * 86400000 },
      ],
      currentOdometer: 124500,
      nowMs: now,
    });
    expect(flags[0]!.state).toBe("due_soon");
    expect(flags[0]!.milesLeft).toBe(500);
    expect(flags[0]!.line).toContain("estimate");
    expect(flags[1]!.state).toBe("ok");
    expect(flags[1]!.milesLeft).toBe(5500);
  });

  test("past the interval reads overdue with the overage stated", () => {
    const flags = maintenanceDueFlags({
      services: [{ item: "oil", intervalMiles: 25000, lastDoneOdometer: 100000, lastDoneAtMs: null }],
      currentOdometer: 126000,
      nowMs: now,
    });
    expect(flags[0]!.state).toBe("overdue");
    expect(flags[0]!.milesLeft).toBe(-1000);
  });

  test("missing inputs read unknown — never a guessed date", () => {
    const flags = maintenanceDueFlags({
      services: [{ item: "oil", intervalMiles: 25000, lastDoneOdometer: null, lastDoneAtMs: null }],
      currentOdometer: null,
      nowMs: now,
    });
    expect(flags[0]!.state).toBe("unknown");
    expect(flags[0]!.milesLeft).toBeNull();
  });

  test("the DOT annual with interval 0 runs on the 12-month date rule", () => {
    const elevenMonthsAgo = now - 335 * 86400000;
    const flags = maintenanceDueFlags({
      services: [{ item: "dot_inspection", intervalMiles: 0, lastDoneOdometer: null, lastDoneAtMs: elevenMonthsAgo }],
      currentOdometer: 200000,
      nowMs: now,
    });
    expect(flags[0]!.state).toBe("due_soon");
    expect(flags[0]!.dueAtMs).toBe(elevenMonthsAgo + 365 * 86400000);
    const past = maintenanceDueFlags({
      services: [{ item: "dot_inspection", intervalMiles: 0, lastDoneOdometer: null, lastDoneAtMs: now - 400 * 86400000 }],
      currentOdometer: 200000,
      nowMs: now,
    });
    expect(past[0]!.state).toBe("overdue");
  });
});
