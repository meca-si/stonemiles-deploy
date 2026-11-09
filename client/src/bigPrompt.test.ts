// Unit tests for the big-prompt 5-second auto-dismiss
// (client/src/bigPrompt.ts) — driver order 2026-11-03: interstate
// sign / exit / switch / sign prompts show for 5 seconds, then
// disappear; no re-fire for the same event on the same pass; a new
// event replaces a showing one instead of stacking.
// Run: bun test client/src/bigPrompt.test.ts
import { describe, expect, test } from "bun:test";
import { BIG_PROMPT_TIMEOUT_MS, BigPromptTracker } from "./bigPrompt";
import { WEIGH_PROMPT_TIMEOUT_MS } from "./weighStation";

const T0 = 1_800_000_000_000;
const SIGN_A = "sign-5-I-10-W-right";
const SIGN_B = "sign-8-I-65-S-left";
const EXIT_C = "card-exit-4-49";

describe("BigPromptTracker — the 5-second rule (x's order 2026-11-03)", () => {
  test("the timeout is 5 seconds, and the weigh prompt's timeout matches it", () => {
    expect(BIG_PROMPT_TIMEOUT_MS).toBe(5_000);
    expect(WEIGH_PROMPT_TIMEOUT_MS).toBe(BIG_PROMPT_TIMEOUT_MS);
  });

  test("a prompt shows when its event fires, and is visible inside 5 seconds", () => {
    const t = new BigPromptTracker();
    expect(t.consider(SIGN_A, T0)).toBe(SIGN_A);
    expect(t.visibleKey(T0)).toBe(SIGN_A);
    expect(t.visibleKey(T0 + 4_999)).toBe(SIGN_A);
    expect(t.showingKey).toBe(SIGN_A);
  });

  test("at 5 seconds it auto-dismisses on its own", () => {
    const t = new BigPromptTracker();
    t.consider(SIGN_A, T0);
    expect(t.expire(T0 + 4_999)).toBe(false);
    expect(t.showingKey).toBe(SIGN_A);
    expect(t.expire(T0 + 5_000)).toBe(true);
    expect(t.showingKey).toBeNull();
    expect(t.visibleKey(T0 + 5_001)).toBeNull();
  });

  test("expiry records NOTHING — the tracker is display-only and its timeout produces no report shape", () => {
    const t = new BigPromptTracker();
    t.consider(SIGN_A, T0);
    const result = t.expire(T0 + BIG_PROMPT_TIMEOUT_MS);
    // The expire path returns only whether a prompt expired — there
    // is no answer/report value for a caller to record, mirroring
    // the weigh rule that a no-tap timeout records nothing.
    expect(result).toBe(true);
    expect(t.showingKey).toBeNull();
  });

  test("no re-fire for the same event on the same pass after it fades", () => {
    const t = new BigPromptTracker();
    t.consider(SIGN_A, T0);
    t.expire(T0 + 5_000);
    // The maneuver is still inside its window for a long while after
    // the fade (GPS fixes keep evaluating it) — it must stay gone.
    expect(t.consider(SIGN_A, T0 + 6_000)).toBeNull();
    expect(t.consider(SIGN_A, T0 + 60_000)).toBeNull();
    expect(t.hasSeen(SIGN_A)).toBe(true);
  });

  test("repeat evaluations of the same event do NOT reset the 5-second clock", () => {
    const t = new BigPromptTracker();
    t.consider(SIGN_A, T0);
    // Guidance re-renders on every GPS fix — each one re-considers
    // the same key; the fade still lands 5 s after the FIRST show.
    expect(t.consider(SIGN_A, T0 + 3_000)).toBe(SIGN_A);
    expect(t.consider(SIGN_A, T0 + 4_500)).toBe(SIGN_A);
    expect(t.expire(T0 + 5_000)).toBe(true);
  });

  test("a genuinely new event still gets its own prompt after the first one fades", () => {
    const t = new BigPromptTracker();
    t.consider(SIGN_A, T0);
    t.expire(T0 + 5_000);
    expect(t.consider(EXIT_C, T0 + 6_000)).toBe(EXIT_C);
    expect(t.visibleKey(T0 + 10_999)).toBe(EXIT_C);
    expect(t.expire(T0 + 11_000)).toBe(true);
  });

  test("replacement: a new prompt replaces a showing one and resets the timer — never two boxes", () => {
    const t = new BigPromptTracker();
    t.consider(SIGN_A, T0);
    // A new event fires 2 s in, while A is still on screen.
    expect(t.consider(SIGN_B, T0 + 2_000)).toBe(SIGN_B);
    expect(t.showingKey).toBe(SIGN_B);
    // B's clock runs from ITS arrival, not A's: still up at +6.9 s
    // (past A's would-be expiry), gone at B's own 5 s mark.
    expect(t.visibleKey(T0 + 6_999)).toBe(SIGN_B);
    expect(t.expire(T0 + 7_000)).toBe(true);
    // And the replaced prompt never comes back on this pass either.
    expect(t.consider(SIGN_A, T0 + 8_000)).toBeNull();
  });

  test("when the event passes (candidate goes null) the prompt closes and stays seen", () => {
    const t = new BigPromptTracker();
    t.consider(SIGN_A, T0);
    expect(t.consider(null, T0 + 1_000)).toBeNull();
    expect(t.showingKey).toBeNull();
    expect(t.consider(SIGN_A, T0 + 2_000)).toBeNull();
  });

  test("dismiss (answered / closed early) also marks the event seen for this pass", () => {
    const t = new BigPromptTracker();
    t.consider(SIGN_A, T0);
    t.dismiss();
    expect(t.showingKey).toBeNull();
    expect(t.consider(SIGN_A, T0 + 1_000)).toBeNull();
  });

  test("a new pass (reset — a new route) lets the same sign prompt again", () => {
    const t = new BigPromptTracker();
    t.consider(SIGN_A, T0);
    t.expire(T0 + 5_000);
    expect(t.consider(SIGN_A, T0 + 6_000)).toBeNull();
    t.reset();
    expect(t.consider(SIGN_A, T0 + 7_000)).toBe(SIGN_A);
  });
});
