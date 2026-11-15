/**
 * Duty-remark → inspection checklist link (owner addition
 * 2026-11-15): when a driver seals a duty change with the
 * "Pre-trip inspection" or "Post-trip inspection" remark, that
 * inspection's checklist opens automatically right then — the
 * driver just declared the inspection as the reason for the status
 * change. Any other remark (Fuel, Loading, Break…) opens nothing.
 *
 * This module is only the mapping. The open itself is gated
 * server-side (getInspectionSealedState): an inspection already
 * sealed in its scope — pre-trip in the current duty window,
 * post-trip since the relevant delivery — does not reopen. The
 * checklist is a prompt, never a block: it opens where the driver
 * can complete or dismiss it.
 */
export type RemarkInspectionKind = "pretrip" | "posttrip";

export function inspectionKindForRemark(
  remark: string | null | undefined,
): RemarkInspectionKind | null {
  if (remark === "pretrip") return "pretrip";
  if (remark === "posttrip") return "posttrip";
  return null;
}
