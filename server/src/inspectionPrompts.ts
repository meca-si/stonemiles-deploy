/**
 * Inspection prompt triggers (x's build order 2026-11-15): when the
 * app should automatically offer the pre-trip / post-trip DVIR.
 *
 * Two prompts, both reckoned from sealed facts only:
 *
 *   PRE-TRIP — the driver has started a duty day (first On Duty /
 *   Driving since the last 10-hour reset, the same reckoning the HOS
 *   clocks use) and no pre-trip DVIR has been sealed in this duty
 *   window. Fires once per duty day: sealing the pre-trip clears it,
 *   and a sealed dismissal for the day clears it.
 *
 *   POST-TRIP (between loads) — inside the SAME duty window, a load
 *   was delivered (sealed) and the driver has since started a NEW
 *   load, and no post-trip DVIR has been sealed since that delivery.
 *   Fires once per delivery → new-load transition (the prompt key
 *   names the delivery). A delivery from a PRIOR duty window never
 *   fires here — a new duty day is the pre-trip's ground.
 *
 * When both are due, the post-trip wins: it is the between-loads
 * step for the load just finished; the pre-trip stays due behind it.
 *
 * Pure functions only — the action layer gathers the facts (duty
 * timeline, signed DVIRs, delivery / pickup seals, load rows,
 * dismissals) and this module decides. Unit-tested in
 * inspectionPrompts.test.ts; the wiring is flow-tested in
 * inspectionPromptsFlow.test.ts.
 */

export type InspectionKind = "pretrip" | "posttrip";

export interface DutyEventLite {
  state: string; // off_duty | sleeper | on_duty | driving
  at: string; // ISO timestamp
}

export interface InspectionPromptFacts {
  /** The driver's effective duty timeline (sealed duty_change rows
   *  with corrections applied), any order. */
  dutyEvents: DutyEventLite[];
  nowMs: number;
  /** The driver's signed DVIRs (live saves + offline captures, which
   *  land at their captured signing time). */
  dvirs: { kind: string; inspectedAtMs: number }[];
  /** Sealed deliveries: one entry per delivered load, at the load's
   *  first delivery confirmation time. */
  deliveries: { loadId: number; atMs: number }[];
  /** Moments the driver started a load: pickup seals and load rows
   *  created (the driver's own loads only). */
  newLoadStarts: { loadId: number; atMs: number }[];
  /** Prompt keys the driver has dismissed (sealed dismissals). */
  dismissedKeys: string[];
}

export interface InspectionPrompt {
  kind: InspectionKind;
  /** Stable identity of this prompt instance: the pre-trip's key
   *  names its duty window; the post-trip's names its delivery. A
   *  dismissal seals against the key, so a prompt can never re-fire
   *  for the same day / transition once skipped. */
  key: string;
  windowStartMs: number;
  deliveryLoadId: number | null;
}

const H = 3_600_000;

/**
 * The start of the current duty window: the first On Duty / Driving
 * moment after the last completed 10-hour reset — the exact
 * reckoning hosClocksFor (actions.ts) applies to the 14-hour clock,
 * so the prompt's "duty day" can never disagree with the clocks.
 * Null when no duty window is open (never on duty, or the reset
 * after the last window has already completed).
 */
export function dutyWindowStartMs(events: DutyEventLite[], nowMs: number): number | null {
  const sorted = [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const segs: { state: string; start: number; end: number }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = Date.parse(sorted[i]!.at);
    const end = i + 1 < sorted.length ? Date.parse(sorted[i + 1]!.at) : nowMs;
    if (Number.isFinite(start) && end > start) segs.push({ state: sorted[i]!.state, start, end });
  }
  if (segs.length === 0) return null;
  let resetAt = 0;
  let offRun = 0;
  let offRunStart = 0;
  for (const s of segs) {
    if (s.state === "off_duty" || s.state === "sleeper") {
      if (offRun === 0) offRunStart = s.start;
      offRun += s.end - s.start;
      if (offRun >= 10 * H) resetAt = Math.max(resetAt, offRunStart + 10 * H);
    } else offRun = 0;
  }
  for (const s of segs) {
    if (s.end <= resetAt) continue;
    if (s.state === "on_duty" || s.state === "driving") return Math.max(s.start, resetAt);
  }
  return null;
}

export function pretripPromptKey(windowStartMs: number): string {
  return `pretrip:${windowStartMs}`;
}

export function posttripPromptKey(loadId: number, deliveryAtMs: number): string {
  return `posttrip:${loadId}:${deliveryAtMs}`;
}

/** The inspection prompt currently due, or null. Prompts only exist
 *  while the driver is On Duty / Driving — nothing pops up over an
 *  off-duty driver. */
export function evaluateInspectionPrompt(facts: InspectionPromptFacts): InspectionPrompt | null {
  const windowStart = dutyWindowStartMs(facts.dutyEvents, facts.nowMs);
  if (windowStart === null) return null;
  const sorted = [...facts.dutyEvents].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const current = sorted.length > 0 ? sorted[sorted.length - 1]!.state : null;
  if (current !== "on_duty" && current !== "driving") return null;
  const dismissed = new Set(facts.dismissedKeys);

  // Post-trip between loads — the freshest delivery inside this duty
  // window, with a different load started after it.
  const inWindow = facts.deliveries
    .filter((d) => d.atMs >= windowStart && d.atMs <= facts.nowMs)
    .sort((a, b) => b.atMs - a.atMs);
  const latest = inWindow[0];
  if (latest) {
    const started = facts.newLoadStarts.some(
      (s) => s.loadId !== latest.loadId && s.atMs > latest.atMs && s.atMs <= facts.nowMs,
    );
    if (started) {
      const sealed = facts.dvirs.some((d) => d.kind === "posttrip" && d.inspectedAtMs >= latest.atMs);
      const key = posttripPromptKey(latest.loadId, latest.atMs);
      if (!sealed && !dismissed.has(key)) {
        return { kind: "posttrip", key, windowStartMs: windowStart, deliveryLoadId: latest.loadId };
      }
    }
  }

  // Pre-trip — first drive of the duty day, none sealed this window.
  const preSealed = facts.dvirs.some((d) => d.kind === "pretrip" && d.inspectedAtMs >= windowStart);
  const preKey = pretripPromptKey(windowStart);
  if (!preSealed && !dismissed.has(preKey)) {
    return { kind: "pretrip", key: preKey, windowStartMs: windowStart, deliveryLoadId: null };
  }
  return null;
}
