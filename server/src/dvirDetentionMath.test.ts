// dvirDetentionMath.test.ts — UNIT tests for the pure modules
// behind the DVIR completion + detention timer (detention.ts,
// dvir.ts). No I/O: the clock math, the Lane 1 detention-delay
// overlap, the proof text's no-money guarantee, and the defect →
// maintenance category mapping.

import { describe, expect, test } from "bun:test";
import {
  DETENTION_DEFAULT_GRACE_MINUTES,
  detentionDelayMs,
  detentionProofText,
  detentionTimes,
  formatDurationMinutes,
} from "./detention";
import { categoryForDvirItem, dvirDraftDescription, dvirDraftNotes } from "./dvir";

const H = 3600000;
const M = 60000;

describe("detentionTimes", () => {
  test("grace default is 120 minutes (the one config spot)", () => {
    expect(DETENTION_DEFAULT_GRACE_MINUTES).toBe(120);
  });

  test("wait and billable past grace", () => {
    // 3 h 25 min wait, 2 h grace → 1 h 25 min billable.
    const t = detentionTimes(0, 205 * M, 120);
    expect(t.waitMinutes).toBe(205);
    expect(t.billableMinutes).toBe(85);
  });

  test("inside grace bills nothing; unfinished visit reports nulls", () => {
    expect(detentionTimes(0, 90 * M, 120)).toEqual({ waitMinutes: 90, billableMinutes: 0 });
    expect(detentionTimes(0, null, 120)).toEqual({ waitMinutes: null, billableMinutes: null });
  });

  test("zero grace bills the whole wait; negative spans clamp to zero", () => {
    expect(detentionTimes(0, 45 * M, 0).billableMinutes).toBe(45);
    expect(detentionTimes(100 * M, 50 * M, 120).waitMinutes).toBe(0);
  });
});

describe("formatDurationMinutes", () => {
  test("renders time only", () => {
    expect(formatDurationMinutes(205)).toBe("3 h 25 min");
    expect(formatDurationMinutes(45)).toBe("45 min");
    expect(formatDurationMinutes(120)).toBe("2 h");
    expect(formatDurationMinutes(0)).toBe("0 min");
  });
});

describe("detentionDelayMs — the Lane 1 fairness overlap", () => {
  const appt = 10 * H;
  const seal = appt + 90 * M; // sealed 30 min past the +60 grace

  test("a detention window covering the whole post-appointment span excuses all of it", () => {
    const delay = detentionDelayMs([{ arrivedMs: appt, departedMs: seal }], appt, seal);
    expect(delay).toBe(90 * M);
    expect(seal - delay <= appt + 60 * M).toBe(true);
  });

  test("waiting BEFORE the appointment excuses nothing", () => {
    const delay = detentionDelayMs([{ arrivedMs: appt - 3 * H, departedMs: appt - 1 * H }], appt, seal);
    expect(delay).toBe(0);
  });

  test("a window straddling the appointment excuses only the post-appointment part", () => {
    const delay = detentionDelayMs([{ arrivedMs: appt - 1 * H, departedMs: appt + 30 * M }], appt, seal);
    expect(delay).toBe(30 * M);
  });

  test("detention after the seal excuses nothing; delay never exceeds the lateness", () => {
    expect(detentionDelayMs([{ arrivedMs: seal + H, departedMs: seal + 2 * H }], appt, seal)).toBe(0);
    const delay = detentionDelayMs([{ arrivedMs: appt - H, departedMs: seal + 5 * H }], appt, seal);
    expect(delay).toBe(seal - appt);
  });

  test("no windows → no excuse", () => {
    expect(detentionDelayMs([], appt, seal)).toBe(0);
  });
});

describe("detentionProofText — times and place only", () => {
  const text = detentionProofText({
    place: "Dallas, TX",
    site: "delivery",
    apptAtIso: "2026-11-10T08:00:00.000Z",
    arrivedAtIso: "2026-11-10T08:00:00.000Z",
    departedAtIso: "2026-11-10T11:25:00.000Z",
    graceMinutes: 120,
    chainHash: "deadbeef",
  });

  test("carries the place, the stamps, and the time totals", () => {
    expect(text).toContain("Dallas, TX");
    expect(text).toContain("Total wait: 3 h 25 min");
    expect(text).toContain("Time past free time: 1 h 25 min");
    expect(text).toContain("Seal (chain hash): deadbeef");
  });

  test("never carries a rate, a dollar sign, or an amount", () => {
    expect(text).not.toMatch(/\$/);
    expect(text.toLowerCase()).not.toMatch(/per hour|\/hr|rate of|amount due|invoice|total due/);
  });
});

describe("categoryForDvirItem", () => {
  test("maps the FMCSA checklist areas to maintenance categories", () => {
    expect(categoryForDvirItem("Brakes")).toBe("brakes");
    expect(categoryForDvirItem("Trailer brakes & lights")).toBe("brakes");
    expect(categoryForDvirItem("Tires & wheels")).toBe("tires");
    expect(categoryForDvirItem("Lights & reflectors")).toBe("electrical");
    expect(categoryForDvirItem("Steering")).toBe("suspension");
    expect(categoryForDvirItem("Fluids & leaks")).toBe("engine");
  });

  test("unmapped items fall back to other; an explicit valid category wins", () => {
    expect(categoryForDvirItem("CB radio")).toBe("other");
    expect(categoryForDvirItem("Brakes", "dot_inspection")).toBe("dot_inspection");
    expect(categoryForDvirItem("Brakes", "not-a-category")).toBe("brakes");
  });

  test("draft text names the item and ties back to the DVIR", () => {
    expect(dvirDraftDescription("Brakes")).toBe("DVIR defect — Brakes");
    const notes = dvirDraftNotes("Pedal fades", 7, "pretrip");
    expect(notes).toContain("Pedal fades");
    expect(notes).toContain("pre-trip DVIR #7");
  });
});
