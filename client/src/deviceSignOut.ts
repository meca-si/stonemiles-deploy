// deviceSignOut.ts — the durable "explicitly signed out of this
// device" mark + the signed-out overlay's door logic (sign-in
// re-entry fix, x 2026-11-11).
//
// Two layers guard sign-in: the AuthGate account session (host
// cookie) and SecurityPack's per-device session. "Sign out of this
// device" / "Sign out everywhere" end the device session, but the
// account cookie can outlive them — so without a durable local mark,
// a page reload quietly re-registered the device session and the
// sign-out evaporated, and the signed-out overlay's no-PIN door
// restored the session with no credential at all.
//
// The mark is what makes an explicit sign-out stick: while it
// stands, SecurityHosts' boot raises the sign-in overlay instead of
// re-registering, and the only ways back are real credentials — the
// app PIN (if set), Face ID / fingerprint (if enrolled), or the
// full account sign-in form (which is also the different-account
// door). A plain reload while signed IN never sets the mark, so the
// D3 session lifetimes (30-day absolute) behave exactly as before.
//
// A credentialed re-entry clears the mark: the overlay's PIN and
// biometric doors clear it as they re-register, and AuthGate clears
// it when a sign-in form shown during this browser session completes
// (shouldClearDeviceSignOutMark) — a leftover account cookie by
// itself never does.

import { useEffect, useState } from "react";

export type DeviceSignOutKind = "device" | "everywhere";

export interface DeviceSignOutMark {
  kind: DeviceSignOutKind;
  at: number;
}

export const DEVICE_SIGN_OUT_KEY = "tgps-device-signed-out";
const AUTH_FORM_SEEN_KEY = "tgps-auth-form-seen";

// ---------- pure decisions (unit-tested) --------------------------------------

/** Parse a stored mark; anything malformed is no mark at all. */
export function parseDeviceSignOutMark(raw: string | null): DeviceSignOutMark | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { kind?: unknown; at?: unknown };
    if (v.kind !== "device" && v.kind !== "everywhere") return null;
    return { kind: v.kind, at: typeof v.at === "number" ? v.at : 0 };
  } catch {
    return null;
  }
}

export type SignedOutDoor = "pin" | "biometric" | "full-form";

/**
 * The doors the signed-out overlay may offer. The full account
 * sign-in form is ALWAYS a door (it is also how you switch to a
 * different account); the PIN door exists only when a PIN is set;
 * the biometric door only when this device offers an enrolled
 * credential. There is deliberately no "restore" door: nothing on
 * the overlay brings the session back without one of these
 * credentials.
 */
export function signedOutDoors(input: {
  pinSet: boolean;
  biometricOffered: boolean;
}): SignedOutDoor[] {
  const doors: SignedOutDoor[] = [];
  if (input.biometricOffered) doors.push("biometric");
  if (input.pinSet) doors.push("pin");
  doors.push("full-form");
  return doors;
}

/** What the overlay's top "Sign in" button does — always a credential door. */
export function topSignInAction(input: {
  pinSet: boolean;
  biometricOffered: boolean;
}): SignedOutDoor {
  if (input.pinSet) return "pin";
  if (input.biometricOffered) return "biometric";
  return "full-form";
}

/**
 * AuthGate clears the mark only when a sign-in FORM was actually
 * shown during this browser session and the gate now reports a
 * completed sign-in. A still-live account cookie left over from
 * before the sign-out (the reload-resurrection case) must NOT clear
 * it, and a session still paused at the D7 TOTP gate is not a
 * completed sign-in yet.
 */
export function shouldClearDeviceSignOutMark(input: {
  signedIn: boolean;
  totpPending: boolean;
  formSeen: boolean;
}): boolean {
  return input.signedIn && !input.totpPending && input.formSeen;
}

// ---------- storage -----------------------------------------------------------

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let storageOverride: KeyValueStorage | null = null;

/** Test seam: swap the backing store (the unit suite has no DOM). */
export function __setDeviceSignOutStorageForTests(store: KeyValueStorage | null): void {
  storageOverride = store;
}

function localStore(): KeyValueStorage | null {
  if (storageOverride) return storageOverride;
  try {
    return localStorage as unknown as KeyValueStorage;
  } catch {
    return null;
  }
}

function sessionStore(): KeyValueStorage | null {
  try {
    return sessionStorage as unknown as KeyValueStorage;
  } catch {
    return null;
  }
}

// ---------- the mark + in-tab subscription ------------------------------------

const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      /* a listener never breaks the mark */
    }
  }
}

export function getDeviceSignOutMark(): DeviceSignOutMark | null {
  const store = localStore();
  if (!store) return null;
  try {
    return parseDeviceSignOutMark(store.getItem(DEVICE_SIGN_OUT_KEY));
  } catch {
    return null;
  }
}

export function setDeviceSignOutMark(kind: DeviceSignOutKind): void {
  const store = localStore();
  if (store) {
    try {
      const mark: DeviceSignOutMark = { kind, at: Date.now() };
      store.setItem(DEVICE_SIGN_OUT_KEY, JSON.stringify(mark));
    } catch {
      /* ignore */
    }
  }
  notify();
}

export function clearDeviceSignOutMark(): void {
  const store = localStore();
  if (store) {
    try {
      store.removeItem(DEVICE_SIGN_OUT_KEY);
    } catch {
      /* ignore */
    }
  }
  notify();
}

export function subscribeDeviceSignOutMark(fn: () => void): () => void {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === DEVICE_SIGN_OUT_KEY) fn();
  };
  try {
    window.addEventListener("storage", onStorage);
  } catch {
    /* ignore */
  }
  return () => {
    listeners.delete(fn);
    try {
      window.removeEventListener("storage", onStorage);
    } catch {
      /* ignore */
    }
  };
}

/**
 * Live mark for chrome that must vanish while the device is signed
 * out — the AuthGate account footer names the account email, and it
 * must not sit on a screen that says no account data shows.
 */
export function useDeviceSignOutMark(): DeviceSignOutMark | null {
  const [mark, setMark] = useState<DeviceSignOutMark | null>(() => getDeviceSignOutMark());
  useEffect(
    () => subscribeDeviceSignOutMark(() => setMark(getDeviceSignOutMark())),
    [],
  );
  return mark;
}

// ---------- "a sign-in form was shown this browser session" -------------------
// sessionStorage survives the Google/Apple redirect round-trip in
// the same tab, which is how AuthGate tells a just-completed
// credentialed sign-in apart from a leftover account cookie.

export function markAuthFormSeen(): void {
  const store = sessionStore();
  if (!store) return;
  try {
    store.setItem(AUTH_FORM_SEEN_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function authFormSeen(): boolean {
  const store = sessionStore();
  if (!store) return false;
  try {
    return store.getItem(AUTH_FORM_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}
