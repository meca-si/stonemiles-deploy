/**
 * Duty-change remarks (x's build order 2026-11-15; the owner is the
 * carrier and requires a remark on every duty status change — FMCSA
 * guidance leaves activity remarks to carrier policy, and this
 * carrier's policy is: always one).
 *
 * THE GUARANTEE: a sealed duty_change NEVER lacks a remark. The
 * driver-facing buttons always collect a quick-pick (one extra tap,
 * free text optional). Any path that cannot ask — the federal
 * stopped-default (B1, 2026-11-15: 5 minutes stopped in Driving,
 * prompted, no answer in 1 minute → On Duty, per 49 CFR Part 395
 * Appendix A §4.4.1.2), an offline capture sealed later, an older
 * client — gets an explicit system default here, stamped
 * remarkSource "default" so the record never dresses a system
 * reason up as the driver's words.
 * A remark the driver actually picked (or a note they typed) stamps
 * remarkSource "driver".
 *
 * Pure functions only. Unit-tested in dutyRemarks.test.ts. The
 * client carries the same key list (client/src/App.tsx DUTY_REMARKS)
 * — the placement pin test asserts the two lists agree.
 */

export const DUTY_REMARK_KEYS = [
  "pretrip",
  "fuel",
  "loading",
  "unloading",
  "posttrip",
  "break",
  "personal",
  "other",
] as const;

export type DutyRemarkKey = (typeof DUTY_REMARK_KEYS)[number];

export const DUTY_REMARK_LABELS: Record<DutyRemarkKey, string> = {
  pretrip: "Pre-trip inspection",
  fuel: "Fuel",
  loading: "Loading",
  unloading: "Unloading",
  posttrip: "Post-trip inspection",
  break: "Break / Rest",
  personal: "Personal",
  other: "Other",
};

export function isDutyRemarkKey(v: unknown): v is DutyRemarkKey {
  return typeof v === "string" && (DUTY_REMARK_KEYS as readonly string[]).includes(v);
}

export interface ResolvedDutyRemark {
  remark: DutyRemarkKey;
  remarkNote: string | null;
  remarkSource: "driver" | "default";
}

/** Resolve the remark a duty change seals with. A valid driver
 *  quick-pick (or a typed note standing alone) wins verbatim;
 *  anything else falls to the explicit default for the path that
 *  produced the change. Never returns an empty remark. */
export function resolveDutyRemark(input: {
  remark?: string | null;
  remarkNote?: string | null;
  source: string; // manual | auto_no_movement | pretrip_checklist
  autoStage?: string | null;
  offline?: boolean;
}): ResolvedDutyRemark {
  const note = (input.remarkNote ?? "").trim().slice(0, 200) || null;
  if (isDutyRemarkKey(input.remark)) {
    return { remark: input.remark, remarkNote: note, remarkSource: "driver" };
  }
  if (note) {
    // The driver typed a reason but picked no chip — their words,
    // bucketed as Other, still count as the driver's remark.
    return { remark: "other", remarkNote: note, remarkSource: "driver" };
  }
  if (input.source === "pretrip_checklist") {
    // The tap that produced this stamp WAS starting the pre-trip —
    // the system names it, honestly labelled as system-supplied.
    return { remark: "pretrip", remarkNote: null, remarkSource: "default" };
  }
  if (input.source === "auto_no_movement") {
    // The ONE automatic change left (B1 federal pattern): stopped
    // 5 minutes in Driving, prompted, no response in 1 minute →
    // On-Duty Not Driving. The default remark names the federal
    // default for what it is — never a reason the driver gave.
    return {
      remark: "other",
      remarkNote: "Stopped 5 min — no response; on-duty default",
      remarkSource: "default",
    };
  }
  if (input.offline) {
    return { remark: "other", remarkNote: "Captured offline — no remark recorded", remarkSource: "default" };
  }
  return { remark: "other", remarkNote: null, remarkSource: "default" };
}
