// inspectionPrompts.test.ts — UNIT tests for the inspection prompt
// triggers (inspectionPrompts.ts), reckoned on the HOS duty window:
// the first On Duty / Driving after the last 10-hour reset, the
// same window the 14-hour clock runs on.
//
//   (a) first On Duty of the duty day, no pre-trip sealed → the
//       pre-trip prompt fires, keyed to the window;
//   (b) pre-trip sealed that window → no fire; skipped (dismissal
//       sealed for the key) → no re-fire that day;
//   (c) the next duty day (after a 10h reset) → fires again, new key;
//   (d) delivery + a NEW load started in the SAME window, no
//       post-trip since the delivery → the post-trip prompt fires,
//       keyed to the delivery; sealed → no refire for that
//       transition; the post-trip wins over a still-due pre-trip;
//   (e) a new load on a NEW duty day → the post-trip does NOT fire
//       (the delivery belongs to the old window) — the pre-trip
//       governs instead;
//   (f) off duty → nothing fires.

import { describe, expect, test } from "bun:test";
import {
  dutyWindowStartMs,
  evaluateInspectionPrompt,
  posttripPromptKey,
  pretripPromptKey,
  type DutyEventLite,
  type InspectionPromptFacts,
} from "./inspectionPrompts";

const H = 3_600_000;
const BASE = Date.parse("2026-11-10T00:00:00Z");
const at = (h: number) => BASE + h * H;
const iso = (h: number) => new Date(at(h)).toISOString();
const ev = (state: string, h: number): DutyEventLite => ({ state, at: iso(h) });

function facts(over: Partial<InspectionPromptFacts>): InspectionPromptFacts {
  return {
    dutyEvents: [ev("sleeper", 0), ev("on_duty", 12)],
    nowMs: at(14),
    dvirs: [],
    deliveries: [],
    newLoadStarts: [],
    dismissedKeys: [],
    ...over,
  };
}

describe("dutyWindowStartMs — the HOS window reckoning", () => {
  test("the window opens at the first On Duty after the 10h reset completes", () => {
    // Sleeper 0→12 completes the reset at hour 10; the window opens
    // when duty starts at 12 — the 14h clock and the prompt agree.
    expect(dutyWindowStartMs([ev("sleeper", 0), ev("on_duty", 12)], at(14))).toBe(at(12));
  });
  test("no completed reset and no duty → no window", () => {
    expect(dutyWindowStartMs([ev("sleeper", 0)], at(5))).toBeNull();
    expect(dutyWindowStartMs([], at(5))).toBeNull();
  });
  test("a first-ever duty start opens the window at itself", () => {
    expect(dutyWindowStartMs([ev("on_duty", 1)], at(3))).toBe(at(1));
  });
  test("a 9h59m break does NOT open a new window", () => {
    const events = [ev("on_duty", 0), ev("off_duty", 2), ev("on_duty", 11.9)];
    expect(dutyWindowStartMs(events, at(13))).toBe(at(0));
  });
});

describe("pre-trip prompt", () => {
  test("(a) first On Duty of the day with no pre-trip → fires, keyed to the window", () => {
    const p = evaluateInspectionPrompt(facts({}));
    expect(p?.kind).toBe("pretrip");
    expect(p?.key).toBe(pretripPromptKey(at(12)));
    expect(p?.windowStartMs).toBe(at(12));
    expect(p?.deliveryLoadId).toBeNull();
  });
  test("(a) driving counts the same — first drive of the day fires it", () => {
    const p = evaluateInspectionPrompt(facts({ dutyEvents: [ev("sleeper", 0), ev("driving", 12)] }));
    expect(p?.kind).toBe("pretrip");
  });
  test("(b) pre-trip already sealed this window → does not fire", () => {
    const p = evaluateInspectionPrompt(facts({ dvirs: [{ kind: "pretrip", inspectedAtMs: at(12.5) }] }));
    expect(p).toBeNull();
  });
  test("(b) a pre-trip sealed in a PRIOR window does not clear today's", () => {
    const p = evaluateInspectionPrompt(facts({ dvirs: [{ kind: "pretrip", inspectedAtMs: at(2) }] }));
    expect(p?.kind).toBe("pretrip");
  });
  test("(b) skipped → does not re-fire that day", () => {
    const p = evaluateInspectionPrompt(facts({ dismissedKeys: [pretripPromptKey(at(12))] }));
    expect(p).toBeNull();
  });
  test("(b) a second On Duty the same day is the same prompt — same key, no new fire", () => {
    const events = [ev("sleeper", 0), ev("on_duty", 12), ev("off_duty", 13), ev("on_duty", 13.5)];
    const p = evaluateInspectionPrompt(facts({ dutyEvents: events }));
    expect(p?.key).toBe(pretripPromptKey(at(12)));
  });
  test("(c) the next duty day fires again under a new key", () => {
    const events = [
      ev("sleeper", 0), ev("on_duty", 12), ev("off_duty", 20), ev("sleeper", 21), ev("on_duty", 32),
    ];
    const p = evaluateInspectionPrompt(facts({
      dutyEvents: events,
      nowMs: at(34),
      dismissedKeys: [pretripPromptKey(at(12))],
      dvirs: [{ kind: "pretrip", inspectedAtMs: at(12.5) }],
    }));
    expect(p?.kind).toBe("pretrip");
    expect(p?.key).toBe(pretripPromptKey(at(32)));
  });
  test("(f) off duty → no prompt, however due", () => {
    const p = evaluateInspectionPrompt(facts({ dutyEvents: [ev("sleeper", 0), ev("on_duty", 12), ev("off_duty", 13)] }));
    expect(p).toBeNull();
  });
});

describe("post-trip prompt — between loads, same window", () => {
  const delivery = { loadId: 7, atMs: at(13) };
  const started = { loadId: 9, atMs: at(13.5) };

  test("(d) delivery + new load in the same window, no post-trip → fires, keyed to the delivery", () => {
    const p = evaluateInspectionPrompt(facts({
      deliveries: [delivery],
      newLoadStarts: [started],
      dvirs: [{ kind: "pretrip", inspectedAtMs: at(12.25) }],
    }));
    expect(p?.kind).toBe("posttrip");
    expect(p?.key).toBe(posttripPromptKey(7, at(13)));
    expect(p?.deliveryLoadId).toBe(7);
  });
  test("(d) the post-trip wins over a still-due pre-trip", () => {
    const p = evaluateInspectionPrompt(facts({ deliveries: [delivery], newLoadStarts: [started] }));
    expect(p?.kind).toBe("posttrip");
  });
  test("(d) post-trip sealed since the delivery → no refire for that transition", () => {
    const p = evaluateInspectionPrompt(facts({
      deliveries: [delivery],
      newLoadStarts: [started],
      dvirs: [{ kind: "posttrip", inspectedAtMs: at(13.75) }, { kind: "pretrip", inspectedAtMs: at(12.25) }],
    }));
    expect(p).toBeNull();
  });
  test("(d) skipped → no refire; the pre-trip behind it still shows", () => {
    const p = evaluateInspectionPrompt(facts({
      deliveries: [delivery],
      newLoadStarts: [started],
      dismissedKeys: [posttripPromptKey(7, at(13))],
    }));
    expect(p?.kind).toBe("pretrip");
  });
  test("(d) no new load started yet → no post-trip (the delivery alone is not enough)", () => {
    const p = evaluateInspectionPrompt(facts({
      deliveries: [delivery],
      dvirs: [{ kind: "pretrip", inspectedAtMs: at(12.25) }],
    }));
    expect(p).toBeNull();
  });
  test("(d) re-starting the SAME load is not a new load", () => {
    const p = evaluateInspectionPrompt(facts({
      deliveries: [delivery],
      newLoadStarts: [{ loadId: 7, atMs: at(13.5) }],
      dvirs: [{ kind: "pretrip", inspectedAtMs: at(12.25) }],
    }));
    expect(p).toBeNull();
  });
  test("(e) a new load on a NEW duty day → post-trip does not fire; pre-trip governs", () => {
    const events = [
      ev("sleeper", 0), ev("on_duty", 12), ev("off_duty", 20), ev("sleeper", 21), ev("on_duty", 32),
    ];
    const p = evaluateInspectionPrompt(facts({
      dutyEvents: events,
      nowMs: at(34),
      deliveries: [delivery], // delivered in the OLD window (hour 13)
      newLoadStarts: [{ loadId: 9, atMs: at(33) }],
    }));
    expect(p?.kind).toBe("pretrip");
    expect(p?.key).toBe(pretripPromptKey(at(32)));
  });
});
