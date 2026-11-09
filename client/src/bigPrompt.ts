// bigPrompt.ts — 5-second auto-dismiss for BIG on-map prompts
// (driver order 2026-11-03, third road-test verdict repair).
//
// The driver's words, from his 10:59 PM Drive screenshot: the big
// promo when an interstate sign / exit / switch / sign prompt
// fires should show "for 5 sec then disappear", and the weigh
// station OPEN/CLOSED sign-check prompt is in the same family.
// Before this module, the sign/exit prompt cards (signCheck.ts)
// had NO timer at all — they rode the map for as long as the
// maneuver stayed inside its 2-mile window, minutes at highway
// speed — and the weigh prompt waited 20 seconds.
//
// Rules (locked by the driver):
// - A big prompt appears, stays ~5 seconds, then fades on its own.
// - If it asked a question (the weigh OPEN/CLOSED prompt) and got
//   no tap, it records NOTHING — this module is display-only and
//   produces no report of any kind; the weigh tracker's own
//   5-second expiry (weighStation.ts) is the recording-side half
//   of the same rule.
// - A prompt never re-fires for the same event on the same pass:
//   once a key has been shown (answered, dismissed, replaced, or
//   expired), it is in the seen set for the rest of the pass.
// - Prompts never queue-stack: a genuinely new event REPLACES the
//   one on screen and gets its own full 5 seconds; there is never
//   more than one current prompt.
// - A new pass (a new route) resets the tracker, so the same sign
//   on a re-planned route prompts again legitimately.
//
// Pure logic (no DOM, no React), like signCheck.ts /
// weighStation.ts, so the production behaviour is unit-testable
// (see bigPrompt.test.ts). The weigh prompt keeps its own tracker
// (it carries recording semantics); its timeout constant is
// pinned equal to this one by test so the family never drifts.

/** How long a big on-map prompt stays up before it fades on its
 *  own — 5 seconds, per the driver's 2026-11-03 order. */
export const BIG_PROMPT_TIMEOUT_MS = 5_000;

export class BigPromptTracker {
  /** Keys shown (or superseded) on this pass — never shown again. */
  private seen = new Set<string>();
  private current: { key: string; shownAtMs: number } | null = null;

  /** Start a fresh pass (new route / new trip): seen keys clear. */
  reset(): void {
    this.seen.clear();
    this.current = null;
  }

  /** The key currently on screen, or null. */
  get showingKey(): string | null {
    return this.current?.key ?? null;
  }

  /** True when this key has already had its showing on this pass. */
  hasSeen(key: string): boolean {
    return this.seen.has(key);
  }

  /**
   * Feed the tracker the candidate prompt key for right now (the
   * sign prompt's or exit card's stable dedupe key, or null when
   * no big prompt applies). Returns the key that should be VISIBLE
   * now, or null:
   * - null candidate → nothing shows; any current prompt is closed
   *   and marked seen (its event has passed).
   * - a key already seen on this pass → nothing shows (no re-fire).
   * - the current key again → it keeps its ORIGINAL timer (repeat
   *   evaluations from GPS fixes never extend the 5 seconds), or
   *   expires if its 5 seconds are already up.
   * - a NEW key while one is showing → the old one is marked seen
   *   and replaced at once; the new one gets a full fresh timer.
   *   Two big prompts are never on screen together.
   */
  consider(key: string | null, nowMs: number): string | null {
    if (key == null) {
      if (this.current) {
        this.seen.add(this.current.key);
        this.current = null;
      }
      return null;
    }
    if (this.current && this.current.key === key) {
      if (nowMs - this.current.shownAtMs >= BIG_PROMPT_TIMEOUT_MS) {
        this.expire(nowMs);
        return null;
      }
      return key;
    }
    if (this.seen.has(key)) {
      // Same event on the same pass — it already had its 5 seconds.
      return null;
    }
    if (this.current) {
      // Replacement, never stacking: the superseded prompt is done
      // for this pass and the new event takes the screen alone.
      this.seen.add(this.current.key);
    }
    this.current = { key, shownAtMs: nowMs };
    return key;
  }

  /** The key on screen at `nowMs`, or null once its 5 seconds are
   *  up (expiring it as a side effect, exactly like consider). */
  visibleKey(nowMs: number): string | null {
    if (!this.current) return null;
    if (nowMs - this.current.shownAtMs >= BIG_PROMPT_TIMEOUT_MS) {
      this.expire(nowMs);
      return null;
    }
    return this.current.key;
  }

  /** The 5-second no-interaction timeout: returns true when an
   *  open prompt expired. Expiry is display-only — it produces NO
   *  report and NO record; the prompt simply fades, and its key
   *  joins the seen set so it cannot re-fire on this pass. */
  expire(nowMs: number): boolean {
    if (!this.current) return false;
    if (nowMs - this.current.shownAtMs < BIG_PROMPT_TIMEOUT_MS) return false;
    this.seen.add(this.current.key);
    this.current = null;
    return true;
  }

  /** Close the current prompt early (the event was answered, or
   *  the surface unmounted): it still counts as seen for this
   *  pass, so an answered prompt never pops back up. */
  dismiss(): void {
    if (this.current) this.seen.add(this.current.key);
    this.current = null;
  }
}
