import { useCallback, useEffect, useState } from "react";

/**
 * BIOMETRIC UNLOCK (round 2, x 2026-11-02) — Face ID / fingerprint /
 * Windows Hello sign-in and unlock, through the platform
 * authenticator (WebAuthn). The design rules, in order:
 *
 * 1. NEVER the only door. Biometrics are an ADDITIONAL unlock for a
 *    device that already has the app PIN (or, on the sign-in screen,
 *    the plain sign-back-in). Wherever the biometric button appears,
 *    the PIN path is right there with it — a failed, unavailable, or
 *    declined biometric always falls back to the PIN.
 * 2. DEVICE-LOCAL ONLY. Enrollment stores just the credential id in
 *    this browser's localStorage; the server keeps NO credential
 *    store (the app's identity rides the platform session + the app
 *    PIN — this build invents no new credential system). The
 *    biometric assertion never leaves the device: a success simply
 *    means "the person holding this device passed its own unlock",
 *    exactly what a native Face ID app-lock checks.
 * 3. HONEST AVAILABILITY. The button appears only when the platform
 *    reports a user-verifying platform authenticator AND this device
 *    has an enrollment. Everywhere else the UI says plainly that
 *    biometrics arrive with the device/browser support for them.
 */

export const BIOMETRIC_CRED_KEY = "tgps-biometric-cred-id";

/** A stored credential id is a base64url string of sane length —
 *  anything else in the slot is treated as no enrollment. */
export function parseStoredCredentialId(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (s.length < 8 || s.length > 512) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  return s;
}

/** The offer decision, pure: show the biometric button only when the
 *  platform authenticator is available AND this device enrolled. */
export function biometricOffer(args: { platformAvailable: boolean; enrolled: boolean }): boolean {
  return args.platformAvailable && args.enrolled;
}

export function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---- Device/browser surface (thin wrappers over WebAuthn) -------------------

type PublicKeyCredentialLike = {
  isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
};

type CredentialManagerLike = {
  create: (opts: unknown) => Promise<unknown>;
  get: (opts: unknown) => Promise<unknown>;
};

function publicKeyCredentialApi(): PublicKeyCredentialLike | null {
  if (typeof window === "undefined") return null;
  const pkc = (window as unknown as { PublicKeyCredential?: PublicKeyCredentialLike }).PublicKeyCredential;
  return pkc ?? null;
}

function credentialManager(): CredentialManagerLike | null {
  if (typeof navigator === "undefined") return null;
  const c = (navigator as unknown as { credentials?: CredentialManagerLike }).credentials;
  return c ?? null;
}

export async function platformBiometricAvailable(): Promise<boolean> {
  const pkc = publicKeyCredentialApi();
  if (!pkc?.isUserVerifyingPlatformAuthenticatorAvailable) return false;
  try {
    return await pkc.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export function biometricStoredId(): string | null {
  try {
    return parseStoredCredentialId(localStorage.getItem(BIOMETRIC_CRED_KEY));
  } catch {
    return null;
  }
}

export function biometricEnrolled(): boolean {
  return biometricStoredId() != null;
}

export function disableBiometric(): void {
  try {
    localStorage.removeItem(BIOMETRIC_CRED_KEY);
  } catch {
    /* storage unavailable — nothing persisted, nothing to clear */
  }
}

/** Enroll this device's platform authenticator. The credential is a
 *  local unlock key only — no server record exists or is needed. */
export async function enrollBiometric(
  userLabel: string,
): Promise<{ ok: boolean; error: string | null }> {
  const creds = credentialManager();
  if (!creds) return { ok: false, error: "This browser doesn't offer device biometrics." };
  try {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    const label = (userLabel || "STONEMILES user").slice(0, 64);
    const cred = (await creds.create({
      publicKey: {
        challenge,
        rp: { name: "STONEMILES" },
        user: {
          id: new TextEncoder().encode(label),
          name: label,
          displayName: label,
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
        timeout: 60000,
      },
    })) as { rawId?: ArrayBuffer } | null;
    if (!cred || !cred.rawId) return { ok: false, error: "Enrollment didn't finish — nothing was saved." };
    try {
      localStorage.setItem(BIOMETRIC_CRED_KEY, b64urlEncode(new Uint8Array(cred.rawId)));
    } catch {
      return { ok: false, error: "This device wouldn't keep the enrollment — biometric unlock stays off." };
    }
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: "Biometric enrollment was cancelled or didn't go through — your PIN still works." };
  }
}

/** One unlock attempt against the enrolled credential. True only on
 *  a completed, user-verified assertion; every failure mode (cancel,
 *  timeout, mismatch, unsupported) reads false, and the caller falls
 *  back to the PIN. */
export async function attemptBiometricUnlock(): Promise<boolean> {
  const id = biometricStoredId();
  const creds = credentialManager();
  if (!id || !creds) return false;
  try {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    const assertion = await creds.get({
      publicKey: {
        challenge,
        allowCredentials: [{ type: "public-key", id: b64urlDecode(id) }],
        userVerification: "required",
        timeout: 60000,
      },
    });
    return assertion != null;
  } catch {
    return false;
  }
}

/** Reactive offer state for the lock screen, the sign-in screen, and
 *  Settings: resolves the platform check once, re-checkable after an
 *  enroll/disable. */
export function useBiometric(): {
  ready: boolean;
  available: boolean;
  enrolled: boolean;
  offer: boolean;
  refresh: () => void;
} {
  const [state, setState] = useState<{ ready: boolean; available: boolean; enrolled: boolean }>({
    ready: false,
    available: false,
    enrolled: false,
  });
  const refresh = useCallback(() => {
    let cancelled = false;
    void platformBiometricAvailable().then((available) => {
      if (!cancelled) setState({ ready: true, available, enrolled: biometricEnrolled() });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => refresh(), [refresh]);
  return {
    ...state,
    offer: biometricOffer({ platformAvailable: state.available, enrolled: state.enrolled }),
    refresh,
  };
}
