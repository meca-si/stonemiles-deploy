/**
 * GLOBAL SEARCH — pure matching rules (Alvys-grab build, x
 * 2026-11-15: "type a name, get everything").
 *
 * One query, searched within the CALLER's scope only — the scope
 * itself is enforced in actions.ts (the driver's own profile rows,
 * the desk's own fleet, the broker's own posted loads). This
 * module owns only the text rules: how a query normalizes, what
 * counts as a hit, and how each group is capped.
 *
 * THE RULES:
 * (a) Matching is plain substring on normalized text (lowercase,
 *     collapsed whitespace, punctuation thinned) — the same words
 *     a person would type: a city, a shipper, a reference, a
 *     driver's name. No fuzzy ranking, no stemming, nothing
 *     clever that could surprise.
 * (b) A bare number (or "#123") matches a load id exactly, and
 *     also matches as a substring of a reference number — drivers
 *     remember both ways.
 * (c) Groups are capped (SEARCH_GROUP_CAP) and the cap is
 *     REPORTED, never silent: the UI says "showing the first N"
 *     when a group overflows.
 * (d) Nothing here ever sees a rate or a money value — the
 *     shapes searched are identity facts (lane, dates, status,
 *     names, references) by construction in actions.ts.
 *
 * Pure functions only — the database half lives in actions.ts.
 */

export const SEARCH_GROUP_CAP = 8;
export const SEARCH_MIN_QUERY = 2;
export const SEARCH_MAX_QUERY = 80;

/** Normalize free text for matching: lowercase, collapse
 * whitespace, drop the punctuation people type inconsistently
 * (commas in "Mobile, AL", dashes in references). */
export function normalizeSearchText(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/[^a-z0-9# ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Clean a raw query into the normalized form + the raw trimmed
 * form (the raw form drives the load-id exact match). Returns
 * null when the query is too short or too long to run. */
export function cleanSearchQuery(raw: string): { query: string; raw: string } | null {
  const trimmed = raw.trim();
  if (trimmed.length < SEARCH_MIN_QUERY || trimmed.length > SEARCH_MAX_QUERY) return null;
  const query = normalizeSearchText(trimmed);
  if (query.length < 1) return null;
  return { query, raw: trimmed };
}

/** Does any of the candidate fields contain the query? Fields are
 * the record's own identity facts, already shaped by the caller. */
export function searchFieldsMatch(query: string, fields: readonly (string | null | undefined)[]): boolean {
  if (!query) return false; // an empty query matches nothing, ever
  for (const f of fields) {
    if (!f) continue;
    if (normalizeSearchText(f).includes(query)) return true;
  }
  return false;
}

/** A numeric query ("1048" or "#1048") names a load id exactly. */
export function searchLoadIdMatch(raw: string, loadId: number): boolean {
  const m = /^#?(\d{1,9})$/.exec(raw.trim());
  if (!m) return false;
  return Number(m[1]) === loadId;
}

/** Cap one result group, reporting whether anything was cut. */
export function capSearchGroup<T>(items: readonly T[]): { items: T[]; capped: boolean; total: number } {
  return {
    items: items.slice(0, SEARCH_GROUP_CAP),
    capped: items.length > SEARCH_GROUP_CAP,
    total: items.length,
  };
}
