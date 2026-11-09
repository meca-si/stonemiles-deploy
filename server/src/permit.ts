// permit.ts — OS/OW permit docket rules (migration 0097).
//
// Pure logic (no DB, no inference) so the permit surface's behaviour
// is unit-testable (see permit.test.ts), in the same style as the
// client modules. The docket is stored EXACTLY as the driver confirmed
// it; this module owns only the derivations the app is allowed to make
// from it:
//
//  - STATUS is derived from the permit's valid-date window and its
//    completion stamp — never a stored flag that can drift:
//      completed  — the driver/load marked it done (completedAt set)
//      expired    — the window's last day has passed
//      upcoming   — the window hasn't opened yet
//      active     — today is inside the window (or the permit carries
//                   no window, so nothing says it isn't usable)
//  - LINE LISTS: route steps, route places, curfews and restrictions
//    ride as JSON string arrays; the parse never invents a line —
//    malformed storage reads as an empty list, not a guessed one.
//  - DATE SHAPE: validFrom/validTo are YYYY-MM-DD exactly as printed
//    and confirmed; anything else is not a window date and is refused
//    at save time rather than silently reinterpreted.

export type PermitStatus = "active" | "upcoming" | "expired" | "completed";

/** True only for a real YYYY-MM-DD calendar date. */
export function isIsoDate(value: string | null | undefined): boolean {
  if (value == null) return false;
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Today's date as YYYY-MM-DD in the given IANA timezone (the permit
 *  window is judged on the DRIVER's calendar day, not UTC's). Falls
 *  back to UTC when the zone name is unusable. */
export function todayIsoInZone(nowMs: number, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(nowMs));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const iso = `${get("year")}-${get("month")}-${get("day")}`;
    if (isIsoDate(iso)) return iso;
  } catch {
    /* fall through to UTC */
  }
  return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * The permit's status, derived — the ONLY place this judgement lives.
 * `todayIso` is YYYY-MM-DD (the driver's local day). Window edges are
 * inclusive: a permit valid "Nov 4 – Nov 6" is active ON Nov 6 and
 * expired from Nov 7. A missing edge leaves that side open.
 */
export function permitStatusOf(
  p: { validFrom: string | null; validTo: string | null; completedAtMs: number | null },
  todayIso: string,
): PermitStatus {
  if (p.completedAtMs != null) return "completed";
  if (p.validTo != null && isIsoDate(p.validTo) && todayIso > p.validTo) return "expired";
  if (p.validFrom != null && isIsoDate(p.validFrom) && todayIso < p.validFrom) return "upcoming";
  return "active";
}

/** Parse a stored JSON line list. Anything malformed reads as []. */
export function parsePermitLines(raw: string | null | undefined): string[] {
  if (raw == null || raw === "") return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

/** Clean a driver-confirmed line list for storage: trim each line,
 *  drop blanks, cap the count and each line's length. The wording of
 *  surviving lines is NEVER altered beyond the trim — the docket is
 *  the driver's confirmed text, not a summary. */
export function cleanPermitLines(lines: readonly string[], maxLines = 60, maxLen = 300): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim().slice(0, maxLen);
    if (t) out.push(t);
    if (out.length >= maxLines) break;
  }
  return out;
}

/** Split a textarea block (one entry per line) into a line list —
 *  the confirm form's route / curfew / restriction editors. */
export function linesFromTextBlock(text: string): string[] {
  return cleanPermitLines(text.split(/\r?\n/));
}
