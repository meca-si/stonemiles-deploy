/**
 * MAINTENANCE SHEET — pure rules module (x's order, 2026-11-24).
 *
 * The Maintenance Sheet is the carrier-sendable face of ONE
 * maintenance log entry: the record a driver hands a carrier when
 * the carrier asks for maintenance paper (a missing sheet can cost
 * real money under a lease's maintenance-records clause — the sheet
 * exists so the record in the app IS the record that gets sent).
 *
 * Two record KINDS, one log:
 *   "service" — scheduled service / PM work (the oil change on its
 *               interval, the annual DOT, a tire rotation).
 *   "repair"  — the unscheduled fix that came up (x: "and for
 *               random maintenance / fixes that comes up").
 * Entries saved before the kind existed read "service".
 *
 * Parts ride the entry as [{name, partNumber}] — what went on the
 * truck, by the number a parts counter would ask for. An oil change
 * also names the oil itself (brand + weight) in its own fields: the
 * sheet prints it on its own line because a carrier's maintenance
 * clause can name the oil, and "whatever 10W-30" is not a record.
 *
 * Everything here is a pure function of its inputs (the
 * settlement.ts pattern) so it is unit-tested without a database:
 * the parts JSON codec, the kind/category labels, and the sheet
 * document builder the PDF + text exports share — one builder, so
 * the printed sheet and the text sheet can never drift apart.
 */

export type MaintenanceKind = "service" | "repair";

export const MAINTENANCE_KINDS: MaintenanceKind[] = ["service", "repair"];

export function maintenanceKindOf(v: string | null | undefined): MaintenanceKind {
  return v === "repair" ? "repair" : "service";
}

export function maintenanceKindLabel(kind: string | null | undefined): string {
  return maintenanceKindOf(kind) === "repair" ? "Repair — unscheduled fix" : "Scheduled service";
}

/** Category labels — the server twin of the client's moneyMath list
 *  (the truck record export prints the same words). */
export function maintenanceCategoryLabel(key: string): string {
  switch (key) {
    case "oil": return "Oil & filters";
    case "tires": return "Tires";
    case "brakes": return "Brakes";
    case "dot_inspection": return "Annual DOT inspection";
    case "engine": return "Engine";
    case "transmission": return "Transmission";
    case "suspension": return "Suspension & steering";
    case "electrical": return "Electrical";
    case "ac": return "A/C & heating";
    default: return "Other";
  }
}

export interface MaintenancePart {
  name: string;
  partNumber: string | null;
}

const MAX_PARTS = 24;

/** Parse the stored parts JSON. Anything malformed reads as no
 *  parts — a sheet never invents a part that wasn't recorded. */
export function parseMaintenanceParts(json: string | null | undefined): MaintenancePart[] {
  if (!json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: MaintenancePart[] = [];
  for (const item of parsed) {
    if (item == null || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    if (!name) continue;
    const pn = typeof rec.partNumber === "string" ? rec.partNumber.trim() : "";
    out.push({ name, partNumber: pn || null });
    if (out.length >= MAX_PARTS) break;
  }
  return out;
}

/** Clean a caller-supplied parts list for storage: trimmed, blanks
 *  dropped, capped. Returns the JSON string the row stores. */
export function cleanMaintenancePartsJson(parts: { name: string; partNumber?: string | null }[] | null | undefined): string {
  const out: MaintenancePart[] = [];
  for (const p of parts ?? []) {
    const name = (p?.name ?? "").trim();
    if (!name) continue;
    const pn = (p?.partNumber ?? "")?.trim() ?? "";
    out.push({ name, partNumber: pn || null });
    if (out.length >= MAX_PARTS) break;
  }
  return JSON.stringify(out);
}

export interface MaintenanceSheetEntry {
  id: number;
  kind: string;
  category: string;
  performedAtMs: number;
  odometer: number | null;
  description: string;
  /** Who performed it: a shop name, or null = the driver themselves. */
  shop: string | null;
  cost: number;
  parts: MaintenancePart[];
  oilBrand: string | null;
  oilWeight: string | null;
  nextDueMiles: number | null;
  nextDueAtMs: number | null;
  notes: string | null;
  attachmentLabels: string[];
}

export interface MaintenanceSheetTruck {
  truckYear: number | null;
  truckMake: string | null;
  truckModel: string | null;
  truckUnitNumber: string | null;
  truckVin: string | null;
  truckPlate: string | null;
  truckEngine: string | null;
}

export interface MaintenanceSheetDoc {
  title: string;
  subtitle: string;
  sections: { heading: string; lines: string[] }[];
  /** The same sheet as plain text lines (the .txt export). */
  textLines: string[];
  filenameStem: string;
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const miles = (n: number) => `${Math.round(n).toLocaleString("en-US")} mi`;
const money = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;

/** Build the one sheet document for one entry. Pure: the PDF export
 *  and the text export both render from this, and the fleet copy
 *  carries the same fields, so every face of the record agrees. */
export function buildMaintenanceSheet(entry: MaintenanceSheetEntry, truck: MaintenanceSheetTruck): MaintenanceSheetDoc {
  const truckName = [truck.truckYear ?? null, truck.truckMake?.trim() || null, truck.truckModel?.trim() || null].filter(Boolean).join(" ") || "Truck not named yet";
  const kindLabel = maintenanceKindLabel(entry.kind);
  const catLabel = maintenanceCategoryLabel(entry.category);
  const title = `MAINTENANCE SHEET #${entry.id}`;
  const subtitle = `${truckName}${truck.truckUnitNumber?.trim() ? ` - Unit ${truck.truckUnitNumber.trim()}` : ""} - ${kindLabel} - ${day(entry.performedAtMs)}`;

  const truckLines = [
    `Truck: ${truckName}`,
    `Unit: ${truck.truckUnitNumber?.trim() || "-"}`,
    `VIN: ${truck.truckVin?.trim() || "-"}`,
    `Plate: ${truck.truckPlate?.trim() || "-"}`,
    ...(truck.truckEngine?.trim() ? [`Engine: ${truck.truckEngine.trim()}`] : []),
  ];

  const workLines = [
    `Date: ${day(entry.performedAtMs)}`,
    `Odometer: ${entry.odometer != null ? miles(entry.odometer) : "-"}`,
    `Kind: ${kindLabel}`,
    `Category: ${catLabel}`,
    `Work done: ${entry.description}`,
    `Performed by: ${entry.shop?.trim() || "Driver (self)"}`,
    `Cost: ${money(entry.cost)}`,
    ...(entry.nextDueMiles != null || entry.nextDueAtMs != null
      ? [`Next due: ${[entry.nextDueMiles != null ? miles(entry.nextDueMiles) : null, entry.nextDueAtMs != null ? day(entry.nextDueAtMs) : null].filter(Boolean).join(" / ")}`]
      : []),
    ...(entry.notes?.trim() ? [`Notes: ${entry.notes.trim()}`] : []),
  ];

  const partLines: string[] = [];
  if (entry.oilBrand?.trim() || entry.oilWeight?.trim()) {
    partLines.push(`Oil: ${[entry.oilBrand?.trim() || null, entry.oilWeight?.trim() || null].filter(Boolean).join(" ")}`);
  }
  for (const p of entry.parts) {
    partLines.push(`${p.name}${p.partNumber ? ` - Part # ${p.partNumber}` : ""}`);
  }
  if (partLines.length === 0) partLines.push("(no parts recorded)");

  const sections = [
    { heading: "Truck", lines: truckLines },
    { heading: "Work performed", lines: workLines },
    { heading: "Parts used", lines: partLines },
    ...(entry.attachmentLabels.length > 0
      ? [{ heading: "Receipts on file", lines: entry.attachmentLabels.map((l) => `${l} (file stays in the app - download it from the log entry)`) }]
      : []),
  ];

  const textLines = [
    "STONEMILES - MAINTENANCE SHEET",
    `${title} - ${kindLabel} - ${catLabel}`,
    "",
    ...truckLines,
    "",
    "WORK PERFORMED",
    ...workLines,
    "",
    "PARTS USED",
    ...partLines,
    ...(entry.attachmentLabels.length > 0
      ? ["", "RECEIPTS ON FILE", ...entry.attachmentLabels.map((l) => `${l} (file stays in the app - download it from the log entry)`)]
      : []),
    "",
    "The driver's own maintenance record, kept and sealed in STONEMILES. Send this sheet to your carrier as the maintenance record for this work.",
  ];

  return {
    title,
    subtitle,
    sections,
    textLines,
    filenameStem: `stonemiles-maintenance-sheet-${entry.id}`,
  };
}
