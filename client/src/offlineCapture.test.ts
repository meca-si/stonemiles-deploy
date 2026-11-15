// Offline capture queue (TMS queue item 7) — the pure half: the
// local queue's discipline (idempotent enqueue by capture id, time
// order, removal), the pending-duty merge that keeps the HOS clocks
// honest offline (pending entries flagged, never dressed as
// sealed), and the badge copy every surface shares.
//
// Run: bun test client/src/offlineCapture.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import {
  OFFLINE_BADGE,
  OFFLINE_CAPTURED_LINE,
  enqueueCapture,
  loadActiveLoadSnapshot,
  loadCaptures,
  mergePendingDutyEvents,
  newCaptureId,
  pendingDutyCaptures,
  pendingDvirCaptures,
  removeCapture,
  saveActiveLoadSnapshot,
  type DutyCapture,
  type DvirCapture,
} from "./offlineCapture";

// A minimal localStorage stand-in for the test runtime.
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const duty = (over: Partial<DutyCapture> = {}): DutyCapture => ({
  captureId: "cap-1",
  kind: "duty",
  capturedAt: "2026-11-15T14:00:00.000Z",
  state: "off_duty",
  locationLabel: "AL (GPS state at the change)",
  source: "manual",
  autoStage: null,
  stillSince: null,
  ...over,
});

const dvir = (over: Partial<DvirCapture> = {}): DvirCapture => ({
  captureId: "cap-2",
  kind: "dvir",
  capturedAt: "2026-11-15T13:00:00.000Z",
  dvirKind: "pretrip",
  items: [{ item: "Brakes", ok: true }],
  defects: [],
  signedName: "Pat Driver",
  odometer: 512000,
  lat: 30.69,
  lon: -88.04,
  safeToOperate: true,
  ...over,
});

beforeEach(() => store.clear());

describe("the capture queue", () => {
  test("enqueue + load round-trips, oldest first", () => {
    enqueueCapture(dvir());
    enqueueCapture(duty());
    const list = loadCaptures();
    expect(list.map((c) => c.captureId)).toEqual(["cap-2", "cap-1"]);
    expect(pendingDutyCaptures(list)).toHaveLength(1);
    expect(pendingDvirCaptures(list)).toHaveLength(1);
  });
  test("enqueue is idempotent per capture id", () => {
    enqueueCapture(duty());
    enqueueCapture(duty());
    expect(loadCaptures()).toHaveLength(1);
  });
  test("removeCapture drops exactly that capture", () => {
    enqueueCapture(duty());
    enqueueCapture(dvir());
    removeCapture("cap-1");
    expect(loadCaptures().map((c) => c.captureId)).toEqual(["cap-2"]);
  });
  test("a corrupted store reads as an empty queue, never a crash", () => {
    store.set("tgps-offline-captures", "{not json");
    expect(loadCaptures()).toEqual([]);
    store.set("tgps-offline-captures", JSON.stringify([{ nope: true }]));
    expect(loadCaptures()).toEqual([]);
  });
  test("capture ids are unique per call", () => {
    expect(newCaptureId()).not.toBe(newCaptureId());
  });
});

describe("mergePendingDutyEvents — the offline HOS timeline", () => {
  const sealed = [
    { id: 10, state: "on_duty", at: "2026-11-15T12:00:00.000Z", location: null, source: "manual" },
    { id: 11, state: "driving", at: "2026-11-15T12:30:00.000Z", location: null, source: "manual" },
  ];
  test("with no captures the sealed timeline passes through untouched", () => {
    expect(mergePendingDutyEvents(sealed, [])).toEqual(sealed);
  });
  test("pending captures merge in time order, flagged pendingOffline", () => {
    const merged = mergePendingDutyEvents(sealed, [duty({ capturedAt: "2026-11-15T13:15:00.000Z" })]);
    expect(merged.map((e) => e.state)).toEqual(["on_duty", "driving", "off_duty"]);
    const last = merged[merged.length - 1];
    expect(last && "pendingOffline" in last && last.pendingOffline).toBe(true);
    expect(last && last.id).toBeLessThan(0); // a synthetic id no sealed event can hold
  });
  test("a capture older than the newest sealed event still lands in order", () => {
    const merged = mergePendingDutyEvents(sealed, [duty({ capturedAt: "2026-11-15T12:15:00.000Z", state: "sleeper" })]);
    expect(merged.map((e) => e.state)).toEqual(["on_duty", "sleeper", "driving"]);
  });
});

describe("the honesty copy", () => {
  test("the badge never claims a seal", () => {
    expect(OFFLINE_BADGE).toBe("Offline — will seal on reconnect");
    expect(OFFLINE_CAPTURED_LINE).toContain("not sealed yet");
  });
});

describe("the active-load snapshot", () => {
  test("save + load round-trips with its saved-at stamp", () => {
    saveActiveLoadSnapshot({
      id: 42, status: "picked_up", shipper: "Peacock Pavers", brokerName: null,
      pickupCity: "Mobile", pickupState: "AL", deliveryCity: "Pensacola", deliveryState: "FL",
      weightLbs: 42000, hazmat: false, podSealed: false,
    });
    const snap = loadActiveLoadSnapshot();
    expect(snap?.load.id).toBe(42);
    expect(typeof snap?.savedAt).toBe("string");
  });
  test("saving null clears the snapshot (no active load)", () => {
    saveActiveLoadSnapshot({
      id: 42, status: "booked", shipper: null, brokerName: null,
      pickupCity: null, pickupState: null, deliveryCity: null, deliveryState: null,
      weightLbs: null, hazmat: false, podSealed: false,
    });
    saveActiveLoadSnapshot(null);
    expect(loadActiveLoadSnapshot()).toBeNull();
  });
});
