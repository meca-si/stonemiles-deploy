// Unit tests for load-form draft persistence
// (loadDraftPersistence.ts) — the snapshot behind the 2026-11-01
// fix: "I upload, it blinks, then disappears." Add-a-load (and the
// fleet board's post form) kept the half-entered load only in React
// state; a webview recycle wiped it silently. These tests pin the
// serialize → store → remount → parse round-trip that restores the
// form exactly mid-entry, attached document included, plus the
// validation that keeps a corrupt or oversize snapshot from
// restoring garbage.
// Run: bun test client/src/loadDraftPersistence.test.ts

import { describe, expect, test } from "bun:test";
import {
  isEmptyFormSnapshot,
  parseFormSnapshot,
  serializeFormSnapshot,
  type LoadFormSnapshot,
} from "./loadDraftPersistence";
import { DOC_BASE64_MAX } from "./docImage";

// The Add-a-load draft shape (App.tsx LoadDraft), trimmed to the
// fields that matter here — the parser validates against whatever
// empty shape it is handed.
const EMPTY_ADD = {
  shipper: "",
  rate: "",
  loadedMiles: "",
  milesSource: null as "document" | "entered" | "estimate" | null,
  hazmat: false,
  extraChargesNote: "",
  loadNumber: "",
};

// The board post form shape (LoadBoard.tsx Draft) — carries a
// `notes` field the solo form doesn't.
const EMPTY_BOARD = {
  shipper: "",
  rate: "",
  milesSource: null as "document" | "entered" | "estimate" | null,
  hazmat: false,
  notes: "",
  brokerMc: "",
};

const DOC = { base64: "aGVsbG8gd29ybGQ=", mime: "image/jpeg" };

function addSnapshot(over: Partial<LoadFormSnapshot<typeof EMPTY_ADD>> = {}): LoadFormSnapshot<typeof EMPTY_ADD> {
  return {
    version: 1,
    savedAt: 1_730_000_000_000,
    formOpen: true,
    editingId: null,
    draft: { ...EMPTY_ADD, shipper: "Peacock Pavers", rate: "2800", loadNumber: "LD-1042" },
    pendingDoc: DOC,
    pendingDocKind: "rate_con",
    extractNote: "Pulled what the document shows",
    scanReview: { title: "📄 Meca read this as a rate confirmation", found: ["Rate: $2,800.00"], missing: ["Weight"], warnings: [] },
    ...over,
  };
}

describe("Add-a-load snapshot round-trip (the remount restore)", () => {
  test("serialize → parse restores the draft, document, kind, note, review, and open state exactly", () => {
    const snap = addSnapshot();
    const raw = serializeFormSnapshot(snap, EMPTY_ADD);
    expect(raw).not.toBeNull();
    // Simulate the webview recycle: the stored string is all that
    // survives; a fresh parse (a remount) must rebuild the form.
    const restored = parseFormSnapshot(raw, EMPTY_ADD);
    expect(restored).not.toBeNull();
    expect(restored!.draft).toEqual(snap.draft);
    expect(restored!.pendingDoc).toEqual(DOC);
    expect(restored!.pendingDocKind).toBe("rate_con");
    expect(restored!.extractNote).toBe("Pulled what the document shows");
    expect(restored!.scanReview).toEqual(snap.scanReview);
    expect(restored!.formOpen).toBe(true);
    expect(restored!.editingId).toBeNull();
  });

  test("an edit session restores with its editing id", () => {
    const raw = serializeFormSnapshot(addSnapshot({ editingId: 77 }), EMPTY_ADD);
    const restored = parseFormSnapshot(raw, EMPTY_ADD);
    expect(restored!.editingId).toBe(77);
  });

  test("a hand-typed draft with NO document still persists (the blink loses typing too)", () => {
    const snap = addSnapshot({ pendingDoc: null, pendingDocKind: null, scanReview: null, extractNote: null });
    const restored = parseFormSnapshot(serializeFormSnapshot(snap, EMPTY_ADD), EMPTY_ADD);
    expect(restored!.draft.shipper).toBe("Peacock Pavers");
    expect(restored!.pendingDoc).toBeNull();
  });
});

describe("Board post form snapshot round-trip", () => {
  test("the board draft restores with its notes field and document", () => {
    const snap: LoadFormSnapshot<typeof EMPTY_BOARD> = {
      version: 1,
      savedAt: 1_730_000_000_000,
      formOpen: true,
      editingId: null,
      draft: { ...EMPTY_BOARD, shipper: "Granted Enterprise", notes: "Call the gate on arrival", brokerMc: "MC-123" },
      pendingDoc: DOC,
      pendingDocKind: null,
      extractNote: null,
      scanReview: null,
    };
    const restored = parseFormSnapshot(serializeFormSnapshot(snap, EMPTY_BOARD), EMPTY_BOARD);
    expect(restored!.draft).toEqual(snap.draft);
    expect(restored!.draft.notes).toBe("Call the gate on arrival");
    expect(restored!.pendingDoc).toEqual(DOC);
  });
});

describe("empty forms never persist", () => {
  test("serialize returns null for a pristine form — nothing stale can resurrect after a save", () => {
    const snap = addSnapshot({
      draft: { ...EMPTY_ADD },
      pendingDoc: null,
      pendingDocKind: null,
      extractNote: null,
      scanReview: null,
    });
    expect(isEmptyFormSnapshot(snap, EMPTY_ADD)).toBe(true);
    expect(serializeFormSnapshot(snap, EMPTY_ADD)).toBeNull();
  });

  test("one typed character makes the snapshot non-empty", () => {
    const snap = addSnapshot({
      draft: { ...EMPTY_ADD, shipper: "P" },
      pendingDoc: null,
      pendingDocKind: null,
      extractNote: null,
      scanReview: null,
    });
    expect(isEmptyFormSnapshot(snap, EMPTY_ADD)).toBe(false);
    expect(serializeFormSnapshot(snap, EMPTY_ADD)).not.toBeNull();
  });

  test("a note alone does not keep an empty form alive", () => {
    const snap = addSnapshot({
      draft: { ...EMPTY_ADD },
      pendingDoc: null,
      pendingDocKind: null,
      extractNote: "Couldn't read that file.",
      scanReview: null,
    });
    expect(isEmptyFormSnapshot(snap, EMPTY_ADD)).toBe(true);
  });
});

describe("corrupt / hostile snapshots restore nothing bad", () => {
  test("null, empty, and non-JSON storage all parse to null", () => {
    expect(parseFormSnapshot(null, EMPTY_ADD)).toBeNull();
    expect(parseFormSnapshot("", EMPTY_ADD)).toBeNull();
    expect(parseFormSnapshot("{not json", EMPTY_ADD)).toBeNull();
    expect(parseFormSnapshot('"just a string"', EMPTY_ADD)).toBeNull();
  });

  test("a wrong version is refused", () => {
    const raw = JSON.stringify({ ...addSnapshot(), version: 2 });
    expect(parseFormSnapshot(raw, EMPTY_ADD)).toBeNull();
  });

  test("a non-object draft is refused outright", () => {
    const raw = JSON.stringify({ ...addSnapshot(), draft: "boom" });
    expect(parseFormSnapshot(raw, EMPTY_ADD)).toBeNull();
  });

  test("an oversize stored document drops the attachment but KEEPS the typed draft", () => {
    const snap = addSnapshot({
      pendingDoc: { base64: "A".repeat(DOC_BASE64_MAX + 1), mime: "image/jpeg" },
    });
    const restored = parseFormSnapshot(JSON.stringify(snap), EMPTY_ADD);
    expect(restored).not.toBeNull();
    expect(restored!.pendingDoc).toBeNull();
    expect(restored!.draft.shipper).toBe("Peacock Pavers");
  });

  test("wrong-typed fields fall back to empty instead of poisoning the restore", () => {
    const raw = JSON.stringify({
      ...addSnapshot(),
      draft: { ...addSnapshot().draft, rate: 2800, hazmat: "yes", milesSource: "gps-ish" },
      pendingDocKind: "passport",
      scanReview: { title: 42, found: "Rate", missing: [], warnings: [] },
    });
    const restored = parseFormSnapshot(raw, EMPTY_ADD);
    expect(restored!.draft.rate).toBe("");
    expect(restored!.draft.hazmat).toBe(false);
    expect(restored!.draft.milesSource).toBeNull();
    expect(restored!.draft.shipper).toBe("Peacock Pavers");
    expect(restored!.pendingDocKind).toBeNull();
    expect(restored!.scanReview).toBeNull();
  });

  test("serialize itself drops an over-cap document rather than storing a doomed one", () => {
    const snap = addSnapshot({
      pendingDoc: { base64: "A".repeat(DOC_BASE64_MAX + 1), mime: "image/jpeg" },
    });
    const raw = serializeFormSnapshot(snap, EMPTY_ADD);
    const restored = parseFormSnapshot(raw, EMPTY_ADD);
    expect(restored!.pendingDoc).toBeNull();
    expect(restored!.draft.loadNumber).toBe("LD-1042");
  });
});
