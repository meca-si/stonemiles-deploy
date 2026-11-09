// Load-form draft persistence — pure logic (no DOM, no React),
// like routePersistence.ts, so the round-trip is unit-testable (see
// loadDraftPersistence.test.ts).
//
// Why this module exists (driver report, 2026-11-01): "I upload, it
// blinks, then disappears." The Add-a-load form — and the fleet
// board's post form — kept EVERYTHING in in-memory React state: the
// typed draft, the attached document, its kind, the scan note. Any
// webview recycle (memory pressure from a full-res photo encode,
// the shell backgrounding, a reload) remounted the app at defaults
// and the half-entered load vanished without a word.
//
// The fix mirrors how the open route/trip already survive: the
// in-progress form snapshot lives in localStorage and is restored
// on mount exactly mid-entry — fields, attached document, panel
// open state and all. A successful save (or a cancel) empties the
// form, and an empty form clears the stored snapshot, so nothing
// stale ever resurrects.

import { DOC_BASE64_MAX } from "./docImage";

/** Add-a-load form (Loads tab, App.tsx). */
export const LOAD_DRAFT_KEY = "tgps-load-draft-v1";

/** Fleet-board post form (LoadBoard.tsx). */
export const BOARD_DRAFT_KEY = "tgps-board-load-draft-v1";

export type LoadDocKind = "rate_con" | "bol" | "load_sheet" | "other";

const DOC_KINDS: readonly string[] = ["rate_con", "bol", "load_sheet", "other"];

export type PendingDocSnapshot = { base64: string; mime: string };

export type ScanReviewSnapshot = {
  title: string;
  found: string[];
  missing: string[];
  warnings: string[];
};

export type LoadFormSnapshot<Draft> = {
  version: 1;
  savedAt: number;
  /** Whether the form panel was open when the snapshot was taken. */
  formOpen: boolean;
  /** The load being edited, when the form is an edit session. */
  editingId: number | null;
  draft: Draft;
  pendingDoc: PendingDocSnapshot | null;
  pendingDocKind: LoadDocKind | null;
  extractNote: string | null;
  scanReview: ScanReviewSnapshot | null;
};

/** Validate one draft field-by-field against the empty-draft shape:
 *  strings must be strings, booleans booleans, the milesSource enum
 *  one of its values (or null). A field of the wrong type falls back
 *  to the empty value rather than poisoning the whole restore — a
 *  form draft is inert text, so partial restore beats none. Returns
 *  null only when the raw value isn't an object at all. */
function parseDraft<Draft>(raw: unknown, empty: Draft): Draft | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, emptyVal] of Object.entries(empty as Record<string, unknown>)) {
    const v = src[key];
    if (typeof emptyVal === "string") {
      out[key] = typeof v === "string" ? v : emptyVal;
    } else if (typeof emptyVal === "boolean") {
      out[key] = typeof v === "boolean" ? v : emptyVal;
    } else if (emptyVal === null) {
      // Enum-or-null fields (milesSource): accept the known values.
      out[key] = v === "document" || v === "entered" || v === "estimate" ? v : null;
    } else {
      out[key] = emptyVal;
    }
  }
  return out as Draft;
}

/** A stored document is only restored when it is well-formed AND
 *  still fits the server cap — an oversize or corrupt blob drops
 *  the attachment, never the typed draft around it. */
function parsePendingDoc(raw: unknown): PendingDocSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Partial<PendingDocSnapshot>;
  if (typeof d.base64 !== "string" || d.base64.length === 0) return null;
  if (d.base64.length > DOC_BASE64_MAX) return null;
  if (typeof d.mime !== "string" || d.mime.length === 0) return null;
  return { base64: d.base64, mime: d.mime };
}

function parseStringArray(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  if (!raw.every((x) => typeof x === "string")) return null;
  return raw as string[];
}

function parseScanReview(raw: unknown): ScanReviewSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<ScanReviewSnapshot>;
  if (typeof r.title !== "string") return null;
  const found = parseStringArray(r.found);
  const missing = parseStringArray(r.missing);
  const warnings = parseStringArray(r.warnings);
  if (!found || !missing || !warnings) return null;
  return { title: r.title, found, missing, warnings };
}

/** Serialize a form snapshot for localStorage. Returns null when
 *  there is nothing worth restoring (fully empty form, no document,
 *  no edit session) — callers clear the key instead of storing an
 *  empty shell. A pending document over the server cap is dropped
 *  from the snapshot rather than stored to fail at save time. */
export function serializeFormSnapshot<Draft>(
  snap: LoadFormSnapshot<Draft>,
  emptyDraft: Draft,
): string | null {
  if (isEmptyFormSnapshot(snap, emptyDraft)) return null;
  const pendingDoc =
    snap.pendingDoc && snap.pendingDoc.base64.length <= DOC_BASE64_MAX
      ? snap.pendingDoc
      : null;
  return JSON.stringify({ ...snap, version: 1, pendingDoc });
}

/** Parse + validate a stored snapshot. Anything malformed returns
 *  null — a corrupt snapshot must never restore garbage into the
 *  form. `emptyDraft` supplies the field shape for the form being
 *  restored (Add-a-load and the board form carry different fields). */
export function parseFormSnapshot<Draft>(
  raw: string | null,
  emptyDraft: Draft,
): LoadFormSnapshot<Draft> | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const s = data as Partial<LoadFormSnapshot<Draft>>;
  if (s.version !== 1) return null;
  const draft = parseDraft(s.draft, emptyDraft);
  if (draft === null) return null;
  return {
    version: 1,
    savedAt: typeof s.savedAt === "number" ? s.savedAt : 0,
    formOpen: s.formOpen === true,
    editingId: typeof s.editingId === "number" && Number.isFinite(s.editingId) ? s.editingId : null,
    draft,
    pendingDoc: parsePendingDoc(s.pendingDoc),
    pendingDocKind:
      typeof s.pendingDocKind === "string" && DOC_KINDS.includes(s.pendingDocKind)
        ? (s.pendingDocKind as LoadDocKind)
        : null,
    extractNote: typeof s.extractNote === "string" ? s.extractNote : null,
    scanReview: parseScanReview(s.scanReview),
  };
}

/** True when the form holds nothing worth restoring: the draft is
 *  the empty draft, no document is attached, no edit session is in
 *  progress, and no scan review is showing. Callers clear the
 *  storage key for an empty snapshot so a saved load never
 *  resurrects. (The note text alone doesn't keep a snapshot alive —
 *  notes are always re-derivable from the state they describe.) */
export function isEmptyFormSnapshot<Draft>(
  snap: LoadFormSnapshot<Draft>,
  emptyDraft: Draft,
): boolean {
  if (snap.pendingDoc) return false;
  if (snap.editingId != null) return false;
  if (snap.scanReview) return false;
  return JSON.stringify(snap.draft) === JSON.stringify(emptyDraft);
}
