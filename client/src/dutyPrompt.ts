// dutyPrompt.ts — the federal stopped-duty pattern (B1 build,
// owner's ruling 2026-11-15), replacing the retired Oct 24
// auto-swap (2 min stopped → Off Duty, 10 min → Sleeper Berth).
//
// The pattern is 49 CFR Part 395 Appendix A §4.4.1, the ELD
// functional spec, and it allows exactly TWO automatic duty
// changes: motion sets Driving (the app's drive detection, owned
// elsewhere), and §4.4.1.2's stopped default —
//
//   duty status is Driving, the truck has not moved for 5
//   consecutive minutes → the app MUST prompt the driver to
//   confirm continued driving or enter the proper status; if the
//   driver does not respond within 1 minute, the status switches
//   automatically to On-Duty Not Driving.
//
// Nothing else is ever automatic: Off Duty and Sleeper Berth are
// always the driver's own tap (an automatic rest status would
// falsify the record — a stopped driver may be fueling, loading,
// or inspecting, all of it On Duty under §395.2). The 5-minute /
// 1-minute thresholds are the federal numbers and are NOT
// configurable (§4.4.1.2: "The time thresholds for purposes of
// this section must not be configurable").
//
// While the driver is On Duty (Not Driving) — fueling with a task
// remark, say — no prompt fires and no default fires: prompts
// start from Driving only.
//
// Pure logic (no DOM, no React), unit-tested in dutyPrompt.test.ts.
// The App feeds it every GPS fix + a slow heartbeat and renders
// the prompt while `promptVisible`; the actual seal goes through
// the App's one sealDutyChange path.

/** Stopped this long in Driving → the "Still driving?" prompt. */
export const STOPPED_PROMPT_MS = 5 * 60_000;
/** The prompt waits this long for an answer before the default. */
export const PROMPT_RESPONSE_MS = 60_000;
/** At/above this speed the truck is moving again (the band the
 *  retired auto-swap used: >= 3 mph resets, < 2 mph is stopped,
 *  in between holds the clock as-is). */
export const MOVING_MPH = 3;
export const STOPPED_MPH = 2;

/** The stage the stopped default seals under — the server's
 *  pairing rule accepts exactly this stage, on On Duty only. */
export const ON_DUTY_DEFAULT_STAGE = "on_duty_default";

export type DutyPromptPhaseName = "idle" | "still" | "prompted" | "latched" | "defaulted";

export interface DutyPromptEvaluation {
  phase: DutyPromptPhaseName;
  /** Render the "Still driving?" prompt now. */
  promptVisible: boolean;
  /** The prompt's deadline passed unanswered — seal the on-duty
   *  default exactly once (the App performs the seal). */
  fireDefault: boolean;
  /** When the current stop began (the default's stillSince). */
  stillSinceMs: number | null;
  /** When the prompt appeared (the UI counts the minute down). */
  promptAtMs: number | null;
}

type Phase =
  | { name: "idle" }
  | { name: "still"; sinceMs: number }
  | { name: "prompted"; sinceMs: number; promptAtMs: number }
  | { name: "latched" }
  | { name: "defaulted"; sinceMs: number };

export class DutyPromptTracker {
  private phase: Phase = { name: "idle" };

  get phaseName(): DutyPromptPhaseName {
    return this.phase.name;
  }

  /** The driver answered "Still driving": stay in Driving and do
   *  NOT prompt again until the truck moves and stops again
   *  (Appendix A's re-prompt condition). */
  answerStillDriving(): void {
    if (this.phase.name === "prompted") this.phase = { name: "latched" };
  }

  /** The driver answered with a status change (a task pick, Off
   *  Duty, or Sleeper): the prompt is done; the seal that follows
   *  moves the duty status and the tracker resets with it. */
  answerWithChange(): void {
    this.phase = { name: "idle" };
  }

  /**
   * Feed one observation (a GPS fix or a heartbeat tick). Returns
   * what the UI should show and whether the on-duty default must
   * fire on this pass.
   */
  evaluate(input: { duty: string | null; mph: number | null; nowMs: number }): DutyPromptEvaluation {
    const { duty, mph, nowMs } = input;
    const out = (fireDefault: boolean): DutyPromptEvaluation => ({
      phase: this.phase.name,
      promptVisible: this.phase.name === "prompted",
      fireDefault,
      stillSinceMs:
        this.phase.name === "still" || this.phase.name === "prompted" || this.phase.name === "defaulted"
          ? this.phase.sinceMs
          : null,
      promptAtMs: this.phase.name === "prompted" ? this.phase.promptAtMs : null,
    });

    // Prompts and defaults exist only out of Driving. Any other
    // status — above all On Duty with a task remark — is immune:
    // no prompt, no default, the tracker simply resets.
    if (duty !== "driving") {
      this.phase = { name: "idle" };
      return out(false);
    }
    // Moving again: the stillness clock, the prompt, and the
    // still-driving latch all reset. Moving also cancels a live
    // prompt WITHOUT firing the default — the driver is driving.
    if (mph != null && mph >= MOVING_MPH) {
      this.phase = { name: "idle" };
      return out(false);
    }
    switch (this.phase.name) {
      case "idle":
        // Not clearly stopped (no fix, or creeping in the 2–3 mph
        // band): hold — the stillness clock starts on a clear stop.
        if (mph == null || mph >= STOPPED_MPH) return out(false);
        this.phase = { name: "still", sinceMs: nowMs };
        return out(false);
      case "still": {
        if (mph == null || mph >= STOPPED_MPH) return out(false); // hold the clock as-is
        if (nowMs - this.phase.sinceMs >= STOPPED_PROMPT_MS) {
          this.phase = { name: "prompted", sinceMs: this.phase.sinceMs, promptAtMs: nowMs };
          return out(false);
        }
        return out(false);
      }
      case "prompted": {
        // The 1-minute response window is wall-clock from the
        // prompt (Appendix A) — an ambiguous fix doesn't pause it.
        if (nowMs - this.phase.promptAtMs >= PROMPT_RESPONSE_MS) {
          const sinceMs = this.phase.sinceMs;
          this.phase = { name: "defaulted", sinceMs };
          return out(true);
        }
        return out(false);
      }
      case "latched":
        // "Still driving" holds until the truck moves again.
        return out(false);
      case "defaulted":
        // The default fired; the seal moves the status off
        // Driving, which resets the tracker on the next pass.
        return out(false);
    }
  }
}
