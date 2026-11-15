/**
 * DVIR defect → maintenance-log mapping (x's build order 2026-11-15;
 * spec: dvir-detention-spec-2026-11-15.md). The signed DVIR itself
 * predates this module (dvir_reports + saveDvir); what lives here is
 * the bridge the spec adds: every defect on a signed DVIR drafts a
 * maintenance-log entry in the mapped category, so the defect flows
 * into the truck's record without the driver typing it twice, and
 * stays "open" until that entry is closed.
 *
 * Item labels are the client's DVIR_ITEMS strings (NextLevel.tsx) —
 * the map keys must match them exactly; an unmapped label falls back
 * to "other", so a renamed or new checklist item can never lose a
 * defect, it just lands in the catch-all category.
 *
 * Pure functions only. Unit-tested in dvirDetention.test.ts.
 */

/** Maintenance-log categories (the maintenanceLogCategory enum in
 *  actions.ts): oil | tires | brakes | dot_inspection | engine |
 *  transmission | suspension | electrical | ac | other. */
export type MaintenanceCategory =
  | "oil" | "tires" | "brakes" | "dot_inspection" | "engine"
  | "transmission" | "suspension" | "electrical" | "ac" | "other";

export const DVIR_ITEM_CATEGORIES: Record<string, MaintenanceCategory> = {
  "Brakes": "brakes",
  "Trailer brakes & lights": "brakes",
  "Tires & wheels": "tires",
  "Lights & reflectors": "electrical",
  "Steering": "suspension",
  "Horn": "electrical",
  "Mirrors": "other",
  "Coupling (fifth wheel / kingpin)": "other",
  "Load securement": "other",
  "Emergency equipment": "other",
  "Fluids & leaks": "engine",
};

const ALL_CATEGORIES: readonly string[] = [
  "oil", "tires", "brakes", "dot_inspection", "engine",
  "transmission", "suspension", "electrical", "ac", "other",
];

/** The maintenance category a DVIR defect drafts into. An explicit
 *  category on the defect (validated against the enum by the caller)
 *  wins; otherwise the item label maps; otherwise "other". */
export function categoryForDvirItem(
  item: string,
  explicit?: string | null,
): MaintenanceCategory {
  if (explicit && ALL_CATEGORIES.includes(explicit)) {
    return explicit as MaintenanceCategory;
  }
  return DVIR_ITEM_CATEGORIES[item] ?? "other";
}

/** The draft entry's description: names the DVIR item plainly so the
 *  driver recognizes it in the log and confirms it there. */
export function dvirDraftDescription(item: string): string {
  return `DVIR defect — ${item}`;
}

/** The draft entry's notes: the driver's defect note verbatim, plus
 *  the source line tying the entry back to its signed DVIR. */
export function dvirDraftNotes(note: string, dvirId: number, kind: string): string {
  const src = `From the signed ${kind === "posttrip" ? "post-trip" : "pre-trip"} DVIR #${dvirId} — drafted automatically; confirm or edit this entry, then mark it closed when the repair is done.`;
  const n = note.trim();
  return n ? `${n}\n${src}` : src;
}
