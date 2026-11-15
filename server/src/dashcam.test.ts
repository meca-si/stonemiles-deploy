// Unit tests for dashcam.ts (Wave 2 item 11, Part A): the
// partner seam's env gate, webhook payload validation, the
// pattern-flag facts-only rule, and the simulated test event.
//
// Run: bun test server/src/dashcam.test.ts
import { describe, expect, test } from "bun:test";
import {
  DASHCAM_EVENT_KINDS,
  dashcamPartnerFromEnv,
  dashcamPatternFlags,
  simulatedDashcamEvent,
  validateDashcamEventPayload,
} from "./dashcam";

describe("dashcamPartnerFromEnv — the seam gate", () => {
  test("no API key → no partner (the production default)", () => {
    expect(dashcamPartnerFromEnv({})).toBeNull();
    expect(dashcamPartnerFromEnv({ DASHCAM_PARTNER_API_KEY: "  " })).toBeNull();
  });

  test("API key set → partner, with the configured name or the plain default", () => {
    expect(dashcamPartnerFromEnv({ DASHCAM_PARTNER_API_KEY: "k" })?.name).toBe("Dashcam partner");
    expect(
      dashcamPartnerFromEnv({ DASHCAM_PARTNER_API_KEY: "k", DASHCAM_PARTNER_NAME: "Motive" })?.name,
    ).toBe("Motive");
  });
});

describe("validateDashcamEventPayload", () => {
  const good = {
    partnerEventId: "evt-1",
    kind: "harsh_braking",
    severity: "moderate",
    occurredAt: "2026-11-15T10:00:00Z",
    clipRef: "clip-abc",
    clipUrl: "https://partner.example/clips/abc",
    driverRef: "driver1",
  };

  test("a well-formed payload validates and normalizes the timestamp", () => {
    const v = validateDashcamEventPayload(good);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.event.partnerEventId).toBe("evt-1");
    expect(v.event.kind).toBe("harsh_braking");
    expect(v.event.occurredAt).toBe("2026-11-15T10:00:00.000Z");
    expect(v.event.clipRef).toBe("clip-abc");
    expect(v.event.driverRef).toBe("driver1");
    expect(v.event.loadRef).toBeNull();
  });

  test("alias fields land (eventId / eventType / clipId / timestamp)", () => {
    const v = validateDashcamEventPayload({
      eventId: "e2",
      eventType: "speeding",
      timestamp: "2026-11-15T10:00:00Z",
      clipId: "c2",
    });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.event.partnerEventId).toBe("e2");
    expect(v.event.kind).toBe("speeding");
    expect(v.event.severity).toBe("unspecified");
  });

  test("every spec'd kind validates; an unknown kind refuses", () => {
    for (const kind of DASHCAM_EVENT_KINDS) {
      expect(validateDashcamEventPayload({ ...good, kind }).ok).toBe(true);
    }
    const v = validateDashcamEventPayload({ ...good, kind: "tailgating_forever" });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors.join(" ")).toContain("kind must be one of");
  });

  test("missing id, bad time, and missing clip reference each refuse", () => {
    expect(validateDashcamEventPayload({ ...good, partnerEventId: "" }).ok).toBe(false);
    expect(validateDashcamEventPayload({ ...good, occurredAt: "not a date" }).ok).toBe(false);
    expect(validateDashcamEventPayload({ ...good, clipRef: "" }).ok).toBe(false);
    expect(validateDashcamEventPayload("nope").ok).toBe(false);
    expect(validateDashcamEventPayload(null).ok).toBe(false);
  });

  test("an unrecognized severity defaults to unspecified — never invented", () => {
    const v = validateDashcamEventPayload({ ...good, severity: "catastrophic" });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.event.severity).toBe("unspecified");
  });
});

describe("dashcamPatternFlags — facts only", () => {
  const now = Date.parse("2026-11-15T12:00:00Z");
  const daysAgo = (d: number) => now - d * 24 * 60 * 60 * 1000;

  test("three of a kind inside 30 days flag; two don't", () => {
    const events = [
      { kind: "harsh_braking", occurredAtMs: daysAgo(1) },
      { kind: "harsh_braking", occurredAtMs: daysAgo(5) },
      { kind: "harsh_braking", occurredAtMs: daysAgo(9) },
      { kind: "speeding", occurredAtMs: daysAgo(2) },
      { kind: "speeding", occurredAtMs: daysAgo(3) },
    ];
    const flags = dashcamPatternFlags(events, { nowMs: now });
    expect(flags.length).toBe(1);
    expect(flags[0]!.kind).toBe("harsh_braking");
    expect(flags[0]!.count).toBe(3);
    expect(flags[0]!.line).toBe("Harsh braking: 3 events in the last 30 days.");
  });

  test("events outside the window don't count toward a pattern", () => {
    const events = [
      { kind: "speeding", occurredAtMs: daysAgo(31) },
      { kind: "speeding", occurredAtMs: daysAgo(40) },
      { kind: "speeding", occurredAtMs: daysAgo(2) },
    ];
    expect(dashcamPatternFlags(events, { nowMs: now }).length).toBe(0);
  });

  test("the flag carries counts and dates only — no score, no verdict", () => {
    const events = [1, 2, 3].map((d) => ({ kind: "collision", occurredAtMs: daysAgo(d) }));
    const flag = dashcamPatternFlags(events, { nowMs: now })[0]!;
    expect(Object.keys(flag).sort()).toEqual(
      ["count", "firstAtIso", "kind", "label", "lastAtIso", "line", "windowDays"].sort(),
    );
    expect(flag.line.toLowerCase()).not.toContain("score");
  });
});

describe("simulatedDashcamEvent", () => {
  test("produces a valid payload shape with the simulated clip reference", () => {
    const e = simulatedDashcamEvent(new Date("2026-11-15T12:00:00Z"), "speeding");
    expect(e.kind).toBe("speeding");
    expect(e.clipRef).toBe("simulated-clip-reference");
    expect(e.loadRef).toBeNull();
    expect(validateDashcamEventPayload({
      partnerEventId: e.partnerEventId,
      kind: e.kind,
      occurredAt: e.occurredAt,
      clipRef: e.clipRef,
    }).ok).toBe(true);
  });
});
