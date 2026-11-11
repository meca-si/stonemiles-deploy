import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  __setDeviceSignOutStorageForTests,
  clearDeviceSignOutMark,
  getDeviceSignOutMark,
  parseDeviceSignOutMark,
  setDeviceSignOutMark,
  shouldClearDeviceSignOutMark,
  signedOutDoors,
  topSignInAction,
  type KeyValueStorage,
} from "./deviceSignOut";

/**
 * SIGN-IN RE-ENTRY FIX (x, 2026-11-11). The owner signed out, tapped
 * sign in, and was straight back into the same account with no
 * credential — and a reload resurrected the session too. These tests
 * pin the decisions the fix stands on:
 *  - the signed-out overlay offers ONLY credential doors (PIN when
 *    set, biometric when offered, the full account form always) —
 *    no restore-without-credential door exists;
 *  - the durable mark round-trips and junk is no mark;
 *  - AuthGate clears the mark only for a completed sign-in that a
 *    shown form stands behind — never for a leftover cookie, never
 *    mid-TOTP-gate.
 */

class FakeStorage implements KeyValueStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

afterEach(() => {
  __setDeviceSignOutStorageForTests(null);
});

describe("the durable sign-out mark", () => {
  test("set → get round-trips the kind; clear removes it", () => {
    __setDeviceSignOutStorageForTests(new FakeStorage());
    expect(getDeviceSignOutMark()).toBeNull();
    setDeviceSignOutMark("device");
    expect(getDeviceSignOutMark()?.kind).toBe("device");
    setDeviceSignOutMark("everywhere");
    expect(getDeviceSignOutMark()?.kind).toBe("everywhere");
    clearDeviceSignOutMark();
    expect(getDeviceSignOutMark()).toBeNull();
  });

  test("parse: stored JSON parses; junk, wrong kinds, and empties are no mark", () => {
    expect(parseDeviceSignOutMark(JSON.stringify({ kind: "device", at: 5 }))?.kind).toBe("device");
    expect(parseDeviceSignOutMark(JSON.stringify({ kind: "everywhere", at: 5 }))?.kind).toBe("everywhere");
    expect(parseDeviceSignOutMark(null)).toBeNull();
    expect(parseDeviceSignOutMark("")).toBeNull();
    expect(parseDeviceSignOutMark("not json")).toBeNull();
    expect(parseDeviceSignOutMark(JSON.stringify({ kind: "restore" }))).toBeNull();
    expect(parseDeviceSignOutMark(JSON.stringify({}))).toBeNull();
  });

  test("a malformed stored value reads as no mark (boot never traps the user out)", () => {
    const fake = new FakeStorage();
    __setDeviceSignOutStorageForTests(fake);
    fake.setItem("tgps-device-signed-out", "{oops");
    expect(getDeviceSignOutMark()).toBeNull();
  });
});

describe("the signed-out overlay's doors", () => {
  const combos = [
    { pinSet: false, biometricOffered: false },
    { pinSet: true, biometricOffered: false },
    { pinSet: false, biometricOffered: true },
    { pinSet: true, biometricOffered: true },
  ];

  test("every combination offers only credential doors — no restore door exists", () => {
    for (const c of combos) {
      const doors = signedOutDoors(c);
      for (const d of doors) {
        expect(["pin", "biometric", "full-form"]).toContain(d);
      }
      // The full account form is always a door (same account or a
      // different one — switching accounts is always possible).
      expect(doors).toContain("full-form");
    }
  });

  test("no PIN and no biometric: the full form is the ONLY door", () => {
    expect(signedOutDoors({ pinSet: false, biometricOffered: false })).toEqual(["full-form"]);
    expect(topSignInAction({ pinSet: false, biometricOffered: false })).toBe("full-form");
  });

  test("PIN set: PIN door present, top button focuses the PIN, form door still there", () => {
    expect(signedOutDoors({ pinSet: true, biometricOffered: false })).toEqual(["pin", "full-form"]);
    expect(topSignInAction({ pinSet: true, biometricOffered: false })).toBe("pin");
    expect(topSignInAction({ pinSet: true, biometricOffered: true })).toBe("pin");
  });

  test("biometric offered without a PIN: biometric door + form door, top button takes biometric", () => {
    expect(signedOutDoors({ pinSet: false, biometricOffered: true })).toEqual(["biometric", "full-form"]);
    expect(topSignInAction({ pinSet: false, biometricOffered: true })).toBe("biometric");
  });

  test("the top Sign in action is a credential door in every combination", () => {
    for (const c of combos) {
      expect(["pin", "biometric", "full-form"]).toContain(topSignInAction(c));
    }
  });
});

describe("when AuthGate may clear the mark", () => {
  test("a completed form sign-in clears it", () => {
    expect(
      shouldClearDeviceSignOutMark({ signedIn: true, totpPending: false, formSeen: true }),
    ).toBe(true);
  });

  test("a leftover account cookie (no form shown) never clears it — the reload case", () => {
    expect(
      shouldClearDeviceSignOutMark({ signedIn: true, totpPending: false, formSeen: false }),
    ).toBe(false);
  });

  test("a session still paused at the D7 TOTP gate is not complete", () => {
    expect(
      shouldClearDeviceSignOutMark({ signedIn: true, totpPending: true, formSeen: true }),
    ).toBe(false);
  });

  test("no sign-in, no clear", () => {
    expect(
      shouldClearDeviceSignOutMark({ signedIn: false, totpPending: false, formSeen: true }),
    ).toBe(false);
  });
});

describe("source guards", () => {
  const securityPack = readFileSync(`${import.meta.dir}/SecurityPack.tsx`, "utf8");
  const authGate = readFileSync(`${import.meta.dir}/AuthGate.tsx`, "utf8");

  test("the zero-factor 'Sign this device back in' button is gone", () => {
    expect(securityPack).not.toContain('aria-label="Sign this device back in"');
  });

  test("the different-account door is on the overlay", () => {
    expect(securityPack).toContain('aria-label="Sign in with a different account"');
    expect(securityPack).toContain("goToFullSignIn");
  });

  test("sign-out sets the durable mark and boot reads it", () => {
    expect(securityPack).toContain("setDeviceSignOutMark(");
    expect(securityPack).toContain("getDeviceSignOutMark()");
  });

  test("the account footer hides while the mark stands (no email on the signed-out screen)", () => {
    expect(authGate).toContain("useDeviceSignOutMark");
    expect(authGate).toContain("if (deviceSignOutMark) return null;");
  });
});
