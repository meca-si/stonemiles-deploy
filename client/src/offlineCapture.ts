// offlineCapture.ts — OFFLINE MODE (TMS completion queue item 7).
//
// The device-side half of offline mode. When a duty change or a
// signed DVIR can't reach the server, it is captured HERE — in
// local storage, with the moment it actually happened — and the
// App's flush seals it into the chain through syncDutyCapture /
// syncDvirCapture when the connection returns. The server dedupes
// by capture id, so a flush retried after a lost response can
// never seal a record twice.
//
// THE HONESTY RULE this module exists to keep: a capture is NOT a
// sealed record. Every surface that shows one badges it with
// OFFLINE_BADGE ("Offline — will seal on reconnect") and the
// pending state stays visible until the server confirms the seal
// and the capture leaves this queue. Nothing here ever calls a
// capture sealed.
//
// Framework-free (the pointsLayer2 pattern): storage, merging, and
// copy are pure functions of their inputs, unit-tested in
// offlineCapture.test.ts. React consumers keep their own state and
// re-read on OFFLINE_CAPTURES_EVENT.

export type DutyStateName = "off_duty" | "sleeper" | "on_duty" | "driving";
export type DvirKindName = "pretrip" | "posttrip";
export type MaintenanceCategoryName =
  | "oil" | "tires" | "brakes" | "dot_inspection" | "engine" | "transmission"
  | "suspension" | "electrical" | "ac" | "other";

export interface DutyCapture {
  captureId: string;
  kind: "duty";
  /** ISO timestamp of the moment the change happened on the device. */
  capturedAt: string;
  state: DutyStateName;
  locationLabel: string | null;
  source: "manual" | "auto_no_movement";
  autoStage: "off_duty_2min" | "sleeper_10min" | null;
  stillSince: string | null;
  /** Remark + 395.8(c) place stamp captured with the change
   *  (2026-11-15). Optional: captures queued by older builds carry
   *  none, and the server seals those with its explicit offline
   *  default remark instead of inventing one. */
  remark?: string | null;
  remarkNote?: string | null;
  city?: string | null;
  usState?: string | null;
}

export interface DvirDefectCapture {
  item: string;
  note: string;
  critical: boolean;
  category?: MaintenanceCategoryName | null;
  photoDataBase64?: string | null;
  photoMime?: string | null;
}

export interface DvirCapture {
  captureId: string;
  kind: "dvir";
  /** ISO timestamp of the moment the driver signed on the device. */
  capturedAt: string;
  dvirKind: DvirKindName;
  items: { item: string; ok: boolean }[];
  defects: DvirDefectCapture[];
  signedName: string;
  odometer: number | null;
  lat: number | null;
  lon: number | null;
  safeToOperate: boolean | null;
}

export type OfflineCapture = DutyCapture | DvirCapture;

const CAPTURES_KEY = "tgps-offline-captures";
const LOAD_SNAPSHOT_KEY = "tgps-active-load-snapshot";

/** Window event fired whenever the capture queue changes, so every
 * mounted surface (clocks, Driver panel, DVIR panel, the offline
 * bar) re-reads the queue. */
export const OFFLINE_CAPTURES_EVENT = "tgps-offline-captures-changed";

/** The one badge copy for a not-yet-sealed capture — used verbatim
 * everywhere a pending capture shows. */
export const OFFLINE_BADGE = "Offline — will seal on reconnect";

/** The line under a captured record: captured is not sealed. */
export const OFFLINE_CAPTURED_LINE =
  "Captured on this device — not sealed yet. It seals into the record when your connection returns.";

export function newCaptureId(): string {
  return `cap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isCapture(v: unknown): v is OfflineCapture {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.captureId === "string" &&
    typeof c.capturedAt === "string" &&
    (c.kind === "duty" || c.kind === "dvir")
  );
}

export function loadCaptures(): OfflineCapture[] {
  try {
    const raw = localStorage.getItem(CAPTURES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCapture);
  } catch {
    return [];
  }
}

export function saveCaptures(list: readonly OfflineCapture[]): void {
  try {
    localStorage.setItem(CAPTURES_KEY, JSON.stringify(list));
  } catch {
    /* storage full/blocked — the in-memory surfaces still show the capture */
  }
  try {
    window.dispatchEvent(new Event(OFFLINE_CAPTURES_EVENT));
  } catch {
    /* no window (tests) — consumers re-read on their own triggers */
  }
}

/** Add a capture to the queue (a second enqueue of the same id is a
 * no-op — capture ids are the idempotency key end to end). Returns
 * the queue as it now stands, oldest first. */
export function enqueueCapture(capture: OfflineCapture): OfflineCapture[] {
  const list = loadCaptures();
  if (list.some((c) => c.captureId === capture.captureId)) return list;
  const next = [...list, capture].sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  saveCaptures(next);
  return next;
}

export function removeCapture(captureId: string): OfflineCapture[] {
  const next = loadCaptures().filter((c) => c.captureId !== captureId);
  saveCaptures(next);
  return next;
}

export function pendingDutyCaptures(list: readonly OfflineCapture[]): DutyCapture[] {
  return list.filter((c): c is DutyCapture => c.kind === "duty");
}

export function pendingDvirCaptures(list: readonly OfflineCapture[]): DvirCapture[] {
  return list.filter((c): c is DvirCapture => c.kind === "dvir");
}

/** A pending duty capture wearing the sealed timeline's shape, so
 * the HOS clocks and the duty list can show it in place — flagged
 * pendingOffline, with a synthetic negative id no sealed event can
 * ever hold. */
export interface PendingDutyEvent {
  id: number;
  state: string;
  at: string;
  location: string | null;
  source: string;
  edited: boolean;
  editedBy: null;
  editedByRole: null;
  editReason: null;
  originalState: null;
  originalAt: null;
  pendingOffline: true;
}

export function pendingDutyEvent(capture: DutyCapture, index: number): PendingDutyEvent {
  return {
    id: -1 - index,
    state: capture.state,
    at: capture.capturedAt,
    location: capture.locationLabel,
    source: capture.source,
    edited: false,
    editedBy: null,
    editedByRole: null,
    editReason: null,
    originalState: null,
    originalAt: null,
    pendingOffline: true,
  };
}

/** Merge pending duty captures into the sealed duty timeline, in
 * time order, so the HOS clocks keep running on the driver's real
 * status with no signal — the pending entries ride along flagged,
 * and computeHos reads them exactly like sealed ones. With no
 * captures the sealed list passes through untouched. */
export function mergePendingDutyEvents<T extends { state: string; at: string }>(
  events: readonly T[],
  captures: readonly DutyCapture[],
): (T | PendingDutyEvent)[] {
  if (captures.length === 0) return [...events];
  const pending = captures.map((c, i) => pendingDutyEvent(c, i));
  return [...events, ...pending].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

// ---- Active load snapshot -------------------------------------------
// The active load's last known details, persisted whenever the
// loads query lands, so the driver can still see and work the load
// with no signal. It is a READ-ONLY snapshot: it never claims live
// state, and the card that renders it carries the offline badge
// plus the moment it was saved.

export interface ActiveLoadSnapshotData {
  id: number;
  status: string;
  shipper: string | null;
  brokerName: string | null;
  pickupCity: string | null;
  pickupState: string | null;
  deliveryCity: string | null;
  deliveryState: string | null;
  weightLbs: number | null;
  hazmat: boolean;
  podSealed: boolean;
}

export interface ActiveLoadSnapshot {
  savedAt: string; // ISO
  load: ActiveLoadSnapshotData;
}

export function saveActiveLoadSnapshot(load: ActiveLoadSnapshotData | null): void {
  try {
    if (load == null) {
      localStorage.removeItem(LOAD_SNAPSHOT_KEY);
    } else {
      const snap: ActiveLoadSnapshot = { savedAt: new Date().toISOString(), load };
      localStorage.setItem(LOAD_SNAPSHOT_KEY, JSON.stringify(snap));
    }
  } catch {
    /* storage blocked — the offline card simply won't render */
  }
}

export function loadActiveLoadSnapshot(): ActiveLoadSnapshot | null {
  try {
    const raw = localStorage.getItem(LOAD_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveLoadSnapshot;
    if (typeof parsed?.savedAt !== "string" || typeof parsed?.load?.id !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}
