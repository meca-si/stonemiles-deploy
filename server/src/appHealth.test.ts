import { describe, expect, test } from "bun:test";
import {
  FIX_PIPELINE,
  buildHealthChecks,
  canTransition,
  classifySeverity,
  fingerprintFor,
  healthCheckFeedLine,
  overallForChecks,
  pipelineStepForStatus,
  sanitizeReportText,
} from "./appHealth";

describe("sanitizeReportText (no personal data in a report, ever)", () => {
  test("strips email, phone, SSN, card, coordinates", () => {
    const out = sanitizeReportText("Failed for bob@example.com call 251-599-8668 ssn 123-45-6789 card 4111 1111 1111 1111 at 30.12345, -88.12345");
    expect(out).not.toContain("bob@example.com");
    expect(out).not.toContain("251-599-8668");
    expect(out).not.toContain("123-45-6789");
    expect(out).not.toContain("4111");
    expect(out).not.toContain("30.12345");
  });
  test("caps length and collapses whitespace", () => {
    const out = sanitizeReportText("a  b\n c ".repeat(200));
    expect(out.length).toBeLessThanOrEqual(600);
    expect(out).not.toContain("\n");
  });
  test("null-safe", () => {
    expect(sanitizeReportText(null)).toBe("");
    expect(sanitizeReportText(undefined)).toBe("");
  });
});

describe("classifySeverity", () => {
  test("crashes are critical, health checks warning, plain notes info", () => {
    expect(classifySeverity("crash", "anything")).toBe("critical");
    expect(classifySeverity("health_check", "Fuel averages freshness")).toBe("warning");
    expect(classifySeverity("manual", "The button felt slow")).toBe("info");
    expect(classifySeverity("error", "Route request failed to load")).toBe("warning");
    expect(classifySeverity("error", "Cannot read properties of undefined")).toBe("critical");
  });
});

describe("fingerprintFor (dedupe)", () => {
  test("same failure with different numbers is one report", () => {
    const a = fingerprintFor({ kind: "error", title: "Timeout after 3000ms", screen: "Drive" });
    const b = fingerprintFor({ kind: "error", title: "Timeout after 5000ms", screen: "drive" });
    expect(a).toBe(b);
    expect(a.startsWith("ah-")).toBe(true);
  });
  test("different screen or kind is a different report", () => {
    const a = fingerprintFor({ kind: "error", title: "Boom", screen: "Drive" });
    expect(fingerprintFor({ kind: "error", title: "Boom", screen: "Loads" })).not.toBe(a);
    expect(fingerprintFor({ kind: "crash", title: "Boom", screen: "Drive" })).not.toBe(a);
  });
});

describe("fix pipeline + transitions (the owner is the gate)", () => {
  test("pipeline ends at approval then Play shipping", () => {
    expect(FIX_PIPELINE.length).toBe(6);
    expect(FIX_PIPELINE[4]!.label).toBe("You approve");
    expect(FIX_PIPELINE[5]!.label).toContain("Play");
  });
  test("tested can be approved; open cannot jump to approved or shipped", () => {
    expect(canTransition("tested", "approved")).toBe(true);
    expect(canTransition("open", "approved")).toBe(false);
    expect(canTransition("open", "shipped")).toBe(false);
    expect(canTransition("approved", "shipped")).toBe(true);
    expect(canTransition("resolved", "open")).toBe(false);
    expect(canTransition("dismissed", "open")).toBe(true);
  });
  test("status maps to its pipeline step", () => {
    expect(pipelineStepForStatus("open")).toBe(0);
    expect(pipelineStepForStatus("tested")).toBe(3);
    expect(pipelineStepForStatus("approved")).toBe(4);
    expect(pipelineStepForStatus("shipped")).toBe(5);
  });
});

describe("buildHealthChecks + overall", () => {
  const base = {
    chainIntact: true, chainChecked: 120,
    eiaStale: false, eiaAgeDays: 3, eiaWeekLabel: "Oct 27, 2026",
    marketStale: false, marketAgeDays: 2, marketWeekLabel: "44",
    tomtomSearchDisabled: false,
    perfTotal: 10, perfFailed: 1,
    openCritical: 0, openWarning: 0,
  };
  test("all-real-state healthy run", () => {
    const checks = buildHealthChecks(base);
    expect(overallForChecks(checks)).toBe("healthy");
    expect(healthCheckFeedLine(checks, "healthy").title).toContain("healthy");
  });
  test("broken chain is critical; stale EIA warns", () => {
    const checks = buildHealthChecks({ ...base, chainIntact: false, eiaStale: true, eiaAgeDays: 15 });
    expect(overallForChecks(checks)).toBe("critical");
    expect(checks.find((c) => c.key === "fuel_data")!.status).toBe("warn");
  });
  test("no perf data is an honest info, never a fake pass", () => {
    const checks = buildHealthChecks({ ...base, perfTotal: 0, perfFailed: 0 });
    expect(checks.find((c) => c.key === "route_reliability")!.status).toBe("info");
  });
  test("open critical reports fail the board", () => {
    const checks = buildHealthChecks({ ...base, openCritical: 1 });
    expect(checks.find((c) => c.key === "open_reports")!.status).toBe("fail");
  });
});
