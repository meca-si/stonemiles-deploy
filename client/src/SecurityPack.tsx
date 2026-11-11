// SecurityPack.tsx — Security Pack 2 client surfaces for STONEMILES:
// account-takeover protection (TOTP 2FA setup/verify, recovery codes,
// new-device alerts, server-side sessions + Sign Out Everywhere),
// lost-phone kill switch + auto-lock + step-up PIN gates, the sealed
// access audit ("Who accessed my records"), company location privacy,
// raw GPS retention, and money Review Holds. All state comes from the
// server actions — nothing here invents security state locally.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { qrGrid } from "./qrcode";
import { attemptBiometricUnlock, useBiometric } from "./biometric";
import {
  clearDeviceSignOutMark,
  getDeviceSignOutMark,
  setDeviceSignOutMark,
  signedOutDoors,
  topSignInAction,
} from "./deviceSignOut";

type Banner = (s: string | null) => void;

const inputCls =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm";
const btnCls =
  "rounded-lg bg-[var(--surface)] border border-[var(--border)] px-3 py-2 text-sm font-bold";
const accentBtnCls =
  "rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-bold text-black disabled:opacity-50";

// ---------- device identity ---------------------------------------------------

const DEVICE_ID_KEY = "tgps-device-id";
const SESSION_TOKEN_KEY = "tgps-session-token";

export function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = `dev-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return "dev-unstored";
  }
}

export function deviceLabel(): string {
  try {
    const ua = navigator.userAgent || "Unknown device";
    const plat = /iPhone/.test(ua)
      ? "iPhone"
      : /Android/.test(ua)
        ? "Android phone"
        : /Macintosh/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows PC"
            : "Browser";
    const browser = /CriOS|Chrome/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : /Firefox/.test(ua) ? "Firefox" : "browser";
    return `${plat} · ${browser}`;
  } catch {
    return "This device";
  }
}

// ---------- step-up PIN gate ---------------------------------------------------
// A module-level handler registered by <StepUpHost/> (mounted once in
// App). ensureStepUp(area) resolves true when the sensitive area may
// open: no PIN set, a still-fresh server grant (< 5 min), or the holder
// just entered the PIN in the prompt. False = stay out.

type StepUpHandler = (area: string) => Promise<boolean>;
let stepUpHandler: StepUpHandler | null = null;

export function ensureStepUp(area: string): Promise<boolean> {
  if (!stepUpHandler) return Promise.resolve(true);
  return stepUpHandler(area).catch(() => false);
}

// ---------- sign out of this device (round 2, x 2026-11-02) -------------------
// The plain Sign out control (Settings + the profile area) talks to
// <SecurityHosts/> through this module handler, the same pattern as
// the step-up gate: requestSignOut() revokes THIS device's server
// session, drops the local token, clears cached account data, and
// raises the sign-in screen. Other devices are untouched — Sign Out
// Everywhere (Security Center) remains the kill-all door.

type SignOutHandler = () => void;
let signOutHandler: SignOutHandler | null = null;

export function requestSignOut(): void {
  signOutHandler?.();
}

async function stepUpSatisfied(): Promise<boolean> {
  const st = await api.getStepUpState({});
  if (st.accountLocked || st.accessCutOff) return false;
  if (!st.pinSet) return true;
  return st.freshUntil != null && Date.parse(st.freshUntil) > Date.now();
}

export function StepUpHost() {
  const [prompt, setPrompt] = useState<{ area: string; resolve: (b: boolean) => void } | null>(null);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    stepUpHandler = async (area: string) => {
      if (await stepUpSatisfied()) return true;
      return new Promise<boolean>((resolve) => {
        setPin("");
        setErr(null);
        setPrompt({ area, resolve });
      });
    };
    return () => {
      stepUpHandler = null;
    };
  }, []);

  if (!prompt) return null;
  const close = (v: boolean) => {
    prompt.resolve(v);
    setPrompt(null);
  };
  return (
    <div className="fixed inset-0 z-[980] flex items-end justify-center bg-black/70" role="dialog" aria-label="Fresh PIN required">
      <div className="animate-sheet w-full max-w-md rounded-t-3xl bg-[var(--surface)] p-5 pb-safe">
        <div className="text-3xl" aria-hidden>🔐</div>
        <h3 className="mt-1 font-condensed text-2xl font-bold">Fresh PIN check</h3>
        <p className="mt-1 text-sm text-[var(--dim)]">
          <strong className="text-[var(--text)]">{prompt.area}</strong> is a sensitive area — it needs a fresh PIN
          entry (good for 5 minutes). This is the step-up check: a stolen unlocked phone still can't open it.
        </p>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          className={`${inputCls} mt-3 text-center font-condensed text-2xl tracking-[0.35em]`}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
          aria-label="PIN for sensitive area"
          placeholder="••••"
        />
        {err && <p className="mt-2 text-sm font-semibold text-[var(--danger)]">{err}</p>}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="flex-1 rounded-xl bg-[var(--surface2)] border border-[var(--border)] py-3 font-bold"
            aria-label="Cancel the PIN check"
            onClick={() => close(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pin.length < 4 || busy}
            className="flex-1 rounded-xl bg-[var(--accent)] py-3 font-bold text-black disabled:opacity-50"
            aria-label="Verify PIN and continue"
            onClick={() => {
              setBusy(true);
              void api
                .verifyStepUpPin({ pin, area: prompt.area })
                .then((r) => {
                  if (r.ok) close(true);
                  else setErr(r.error ?? "That PIN isn't right.");
                })
                .catch(() => setErr("Couldn't check the PIN — try again."))
                .finally(() => setBusy(false));
            }}
          >
            Verify &amp; open
          </button>
        </div>
      </div>
    </div>
  );
}

/** Wrap a sensitive area (wallet, settlements): children render only
 *  while a fresh step-up grant holds; otherwise a locked card with an
 *  unlock button stands in their place. */
export function SensitiveGate({ area, children }: { area: string; children: ReactNode }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const check = useCallback(async () => {
    try {
      setOpen(await stepUpSatisfied());
    } catch {
      setOpen(false);
    }
  }, []);
  useEffect(() => {
    void check();
    const t = setInterval(() => void check(), 30000);
    return () => clearInterval(t);
  }, [check]);
  if (open === null) {
    return (
      <section className="glass-panel p-4" aria-label={`${area} — checking the step-up lock`}>
        <p className="text-sm text-[var(--dim)]">Checking the step-up lock for {area}…</p>
      </section>
    );
  }
  if (!open) {
    return (
      <section className="glass-panel p-4" aria-label={`${area} — locked until a fresh PIN check`}>
        <div className="text-2xl" aria-hidden>🔐</div>
        <h2 className="mt-1 font-condensed text-xl font-semibold">{area} needs a fresh PIN</h2>
        <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
          Sensitive areas open only within 5 minutes of a fresh PIN entry — even on an unlocked phone. Enter your
          PIN to open {area}; it re-locks on its own when the 5 minutes run out.
        </p>
        <button
          type="button"
          className="mt-3 w-full rounded-xl bg-[var(--accent)] py-3 font-bold text-black"
          aria-label={`Unlock ${area} with a fresh PIN`}
          onClick={() => {
            void ensureStepUp(area).then((ok) => {
              if (ok) setOpen(true);
              else void check();
            });
          }}
        >
          Enter PIN to open {area}
        </button>
      </section>
    );
  }
  return <>{children}</>;
}

// ---------- session bootstrap + kill-switch / auto-lock hosts ------------------

export function SecurityHosts({
  setBanner,
  onAutoLock,
  onSignedIn,
}: {
  setBanner: Banner;
  onAutoLock: () => void;
  /** Round 2: a completed sign-in on the sign-in screen also
   *  satisfies the app lock — App passes setUnlocked(true). */
  onSignedIn?: () => void;
}) {
  const queryClient = useQueryClient();
  const [signedOut, setSignedOut] = useState(false);
  const [localSignOut, setLocalSignOut] = useState(false);
  const [signInPin, setSignInPin] = useState("");
  const [signInErr, setSignInErr] = useState<string | null>(null);
  const [signInBusy, setSignInBusy] = useState(false);
  const [remoteLocked, setRemoteLocked] = useState(false);
  const bio = useBiometric();
  const [cutOff, setCutOff] = useState(false);
  const [unlockPin, setUnlockPin] = useState("");
  const [unlockCode, setUnlockCode] = useState("");
  const [unlockErr, setUnlockErr] = useState<string | null>(null);
  const lastActivityRef = useRef(Date.now());
  const autoLockedRef = useRef(false);
  // The signed-out overlay's top "Sign in" button (x, 2026-11-11)
  // focuses this PIN field — the overlay renders no top bar, so the
  // button rides at the top of the view instead of beside a menu.
  const signInPinRef = useRef<HTMLInputElement | null>(null);

  const packQuery = useQuery({
    queryKey: ["security-pack"],
    queryFn: () => api.getSecurityPack({ deviceId: deviceId() }),
    refetchInterval: 60000,
  });

  // Register this device as a server-side session, once per mount —
  // UNLESS this device was explicitly signed out (device sign-out or
  // sign out everywhere): the durable mark stands, the sign-in
  // overlay raises instead, and NO session is re-registered until a
  // real credential is presented (PIN / biometric / the full account
  // form). Without the mark, boot auto-registration resurrected the
  // session on every reload and the sign-out evaporated. A plain
  // reload while signed IN carries no mark and keeps the session,
  // exactly as the D3 lifetimes intend.
  useEffect(() => {
    const mark = getDeviceSignOutMark();
    if (mark) {
      setLocalSignOut(mark.kind === "device");
      setSignedOut(true);
      return;
    }
    void (async () => {
      try {
        const r = await api.registerSession({ deviceId: deviceId(), deviceLabel: deviceLabel() });
        if (r.token) {
          try {
            localStorage.setItem(SESSION_TOKEN_KEY, r.token);
          } catch { /* ignore */ }
        }
        if (r.isNewDevice) {
          setBanner("⚠️ New device sign-in recorded — a security alert is waiting in Settings → Privacy & data → Security Center. If this wasn't you, lock the account there.");
        }
        if (r.accountLocked) setRemoteLocked(true);
        if (r.accessCutOff) setCutOff(true);
        queryClient.invalidateQueries({ queryKey: ["security-pack"] });
      } catch { /* session tracking never blocks the app */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll session validity: revocation (Sign Out Everywhere / cut-off /
  // remote lock from another device) lands here within a minute.
  useEffect(() => {
    const t = setInterval(() => {
      void (async () => {
        try {
          const token = localStorage.getItem(SESSION_TOKEN_KEY);
          if (!token) return;
          const v = await api.validateSession({ deviceId: deviceId(), token });
          if (v.accountLocked) setRemoteLocked(true);
          if (v.accessCutOff) setCutOff(true);
          if (!v.valid && !v.accountLocked && !v.accessCutOff) {
            // A revocation lands durably too: the mark keeps this
            // device on the sign-in overlay across reloads until a
            // credential is presented.
            setDeviceSignOutMark("everywhere");
            setLocalSignOut(false);
            setSignedOut(true);
          }
        } catch { /* ignore transient failures */ }
      })();
    }, 60000);
    return () => clearInterval(t);
  }, []);

  // Auto-lock: inactivity past the holder's setting re-locks the app
  // (the existing PIN lock screen takes over via onAutoLock).
  useEffect(() => {
    const bump = () => {
      lastActivityRef.current = Date.now();
      autoLockedRef.current = false;
    };
    window.addEventListener("pointerdown", bump);
    window.addEventListener("keydown", bump);
    return () => {
      window.removeEventListener("pointerdown", bump);
      window.removeEventListener("keydown", bump);
    };
  }, []);
  useEffect(() => {
    const t = setInterval(() => {
      const mins = packQuery.data?.autoLockMinutes ?? 0;
      if (!mins || autoLockedRef.current) return;
      if (Date.now() - lastActivityRef.current > mins * 60000) {
        autoLockedRef.current = true;
        onAutoLock();
        setBanner(`🔒 Auto-lock: the app locked after ${mins} minute${mins === 1 ? "" : "s"} without activity. Enter your PIN to keep going.`);
      }
    }, 15000);
    return () => clearInterval(t);
  }, [packQuery.data?.autoLockMinutes, onAutoLock, setBanner]);

  const reRegister = () => {
    // reRegister is only ever called AFTER a credential proof (PIN
    // verified, biometric matched, or the lost-phone unlock) — that
    // proof is what ends the signed-out posture, so the durable mark
    // clears here, at the single minting point.
    clearDeviceSignOutMark();
    void (async () => {
      try {
        localStorage.removeItem(SESSION_TOKEN_KEY);
      } catch { /* ignore */ }
      const r = await api.registerSession({ deviceId: deviceId(), deviceLabel: deviceLabel() });
      if (r.token) {
        try {
          localStorage.setItem(SESSION_TOKEN_KEY, r.token);
        } catch { /* ignore */ }
      }
      setSignedOut(false);
      if (r.accountLocked) setRemoteLocked(true);
      if (r.accessCutOff) setCutOff(true);
      queryClient.invalidateQueries({ queryKey: ["security-pack"] });
    })().catch(() => undefined);
  };

  // Sign out of THIS device (round 2): revoke this device's session
  // server-side (sealed), drop the local token, clear the cached
  // account data so nothing of the account sits behind the sign-in
  // screen, re-lock the app under it, and raise the sign-in screen.
  // A failed server call never traps the user IN — the local
  // sign-out proceeds regardless (the session poll revokes the
  // screen the next time it lands, and the token is gone either way).
  const doSignOut = useCallback(() => {
    void (async () => {
      try {
        await api.signOutDevice({ deviceId: deviceId() });
      } catch { /* local sign-out proceeds regardless */ }
      try {
        localStorage.removeItem(SESSION_TOKEN_KEY);
      } catch { /* ignore */ }
      // The durable mark: this sign-out must survive a page reload.
      // Boot reads it and raises the sign-in overlay instead of
      // re-registering the device session.
      setDeviceSignOutMark("device");
      queryClient.clear();
      setSignInPin("");
      setSignInErr(null);
      setLocalSignOut(true);
      setSignedOut(true);
      onAutoLock();
    })();
  }, [queryClient, onAutoLock]);

  // The different-account door — also the ONLY way back when no PIN
  // or biometric door exists on this device. The device sign-out
  // above never ends the AuthGate ACCOUNT session, which is why the
  // full sign-in form can't appear (and accounts can't switch) until
  // it ends: this door ends it (POST /auth/signout), drops the local
  // device token, and reloads into the full form (email + password /
  // Google / passkey). The durable mark stays set across the reload;
  // AuthGate clears it once a credentialed form sign-in completes,
  // and only then does this device register a session again — for
  // the NEW account, with none of the old account's state riding
  // along (the reload drops every in-memory cache regardless).
  const goToFullSignIn = useCallback(() => {
    void (async () => {
      try {
        await fetch("/auth/signout", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
      } catch { /* the reload reads the true state either way */ }
      try {
        localStorage.removeItem(SESSION_TOKEN_KEY);
      } catch { /* ignore */ }
      queryClient.clear();
      window.location.reload();
    })();
  }, [queryClient]);

  useEffect(() => {
    signOutHandler = doSignOut;
    return () => {
      if (signOutHandler === doSignOut) signOutHandler = null;
    };
  }, [doSignOut]);

  // A completed sign-in: fresh session registered, overlay down,
  // the app lock satisfied, caches refilled.
  const completeSignIn = useCallback(() => {
    setSignedOut(false);
    setLocalSignOut(false);
    setSignInPin("");
    setSignInErr(null);
    onSignedIn?.();
    queryClient.invalidateQueries();
  }, [onSignedIn, queryClient]);

  const signInWithPin = () => {
    setSignInBusy(true);
    setSignInErr(null);
    void api
      .verifyPin({ pin: signInPin })
      .then((r) => {
        if (r.ok) {
          reRegister();
          completeSignIn();
        } else if (r.lockedUntil) {
          setSignInErr(`Too many wrong PINs — sign-in is locked until ${new Date(r.lockedUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`);
        } else {
          setSignInErr(`That PIN isn't right${r.attemptsLeft != null ? ` — ${r.attemptsLeft} attempt${r.attemptsLeft === 1 ? "" : "s"} left before a 15-minute lock` : ""}.`);
        }
      })
      .catch(() => setSignInErr("Couldn't check the PIN — try again."))
      .finally(() => setSignInBusy(false));
  };

  const signInWithBiometric = () => {
    setSignInErr(null);
    void attemptBiometricUnlock().then((ok) => {
      if (ok) {
        reRegister();
        completeSignIn();
      } else {
        setSignInErr(
          packQuery.data?.pinSet
            ? "Face ID / fingerprint didn't go through — enter your PIN instead."
            : "Face ID / fingerprint didn't go through — use the full account sign-in below.",
        );
      }
    });
  };

  // The signed-out overlay's doors (pure logic in deviceSignOut.ts,
  // unit-tested): biometric only when offered, PIN only when set,
  // the full account form always — and no restore-without-credential
  // door, ever.
  const doors = signedOutDoors({
    pinSet: !!packQuery.data?.pinSet,
    biometricOffered: bio.offer,
  });

  return (
    <>
      {cutOff && (
        <div className="fixed inset-0 z-[975] flex flex-col items-center justify-center bg-[var(--bg)] px-6" role="dialog" aria-label="Access cut off">
          <div className="text-4xl" aria-hidden>⛔</div>
          <h2 className="mt-2 text-center font-condensed text-3xl font-bold">Access cut off</h2>
          <p className="mt-2 max-w-sm text-center text-sm leading-relaxed text-[var(--dim)]">
            The company owner cut off this account's access and signed out every session. Your own records, wallet,
            and points are yours and are untouched — this only ends the company sign-in. Talk to the owner if this
            looks wrong.
          </p>
        </div>
      )}
      {remoteLocked && !cutOff && (
        <div className="fixed inset-0 z-[975] flex flex-col items-center justify-center bg-[var(--bg)] px-6" role="dialog" aria-label="Account locked remotely">
          <div className="text-4xl" aria-hidden>📵</div>
          <h2 className="mt-2 text-center font-condensed text-3xl font-bold">Account locked</h2>
          <p className="mt-2 max-w-sm text-center text-sm leading-relaxed text-[var(--dim)]">
            This account was locked with the lost-phone kill switch and every session was signed out. If you're the
            account holder, unlock it here — your app PIN
            {packQuery.data?.totp.enabled ? " plus an authenticator (or recovery) code" : ""} proves it's you.
          </p>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            className="mt-4 w-64 rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-4 py-3.5 text-center font-condensed text-2xl tracking-[0.35em]"
            value={unlockPin}
            onChange={(e) => setUnlockPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            aria-label="PIN to unlock the account"
            placeholder="PIN"
          />
          {packQuery.data?.totp.enabled && (
            <input
              className="mt-2 w-64 rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-4 py-3 text-center font-condensed text-xl tracking-[0.2em]"
              value={unlockCode}
              onChange={(e) => setUnlockCode(e.target.value.toUpperCase().slice(0, 12))}
              aria-label="Authenticator or recovery code to unlock the account"
              placeholder="2FA code"
            />
          )}
          {unlockErr && <p className="mt-2 text-sm font-semibold text-[var(--danger)]">{unlockErr}</p>}
          <button
            type="button"
            className="mt-3 w-64 rounded-xl bg-[var(--accent)] py-3.5 font-bold text-black disabled:opacity-50"
            disabled={packQuery.data?.pinSet && unlockPin.length < 4}
            aria-label="Unlock the account"
            onClick={() => {
              void api
                .unlockAccount({ pin: unlockPin || undefined, totpCode: unlockCode || undefined })
                .then((r) => {
                  if (r.ok) {
                    setRemoteLocked(false);
                    setUnlockPin("");
                    setUnlockCode("");
                    setUnlockErr(null);
                    reRegister();
                    setBanner("Account unlocked — the lock and unlock are both sealed in your security log.");
                  } else {
                    setUnlockErr(r.error ?? "Couldn't unlock the account.");
                  }
                })
                .catch(() => setUnlockErr("Couldn't unlock the account — try again."));
            }}
          >
            Unlock account
          </button>
        </div>
      )}
      {signedOut && !remoteLocked && !cutOff && (
        <div className="fixed inset-0 z-[992] flex flex-col items-center justify-center bg-[var(--bg)] px-6" role="dialog" aria-label="Sign in">
          {/* Sign in at the top of the signed-out view (x, 2026-11-11):
              this overlay covers the app top bar, so the button that
              sits beside Menu in the bar rides at the top here instead.
              It drives THIS view's credential doors — focus the PIN
              field when a PIN is set, the biometric door when offered,
              otherwise the full account sign-in form. It never
              restores the session by itself: there is no one-tap way
              back after a sign-out (re-entry fix, x 2026-11-11). */}
          <div className="absolute right-3 top-3" style={{ paddingTop: "env(safe-area-inset-top)" }}>
            <button
              type="button"
              className="min-h-[44px] rounded-full bg-[var(--surface2)] px-4 py-2.5 text-sm font-bold active:opacity-80"
              aria-label="Sign in"
              onClick={() => {
                const action = topSignInAction({
                  pinSet: !!packQuery.data?.pinSet,
                  biometricOffered: bio.offer,
                });
                if (action === "pin") {
                  signInPinRef.current?.focus();
                } else if (action === "biometric") {
                  signInWithBiometric();
                } else {
                  goToFullSignIn();
                }
              }}
            >
              Sign in
            </button>
          </div>
          <div className="text-4xl" aria-hidden>🔑</div>
          <h2 className="mt-2 text-center font-condensed text-3xl font-bold">
            {localSignOut ? "Signed out" : "Signed out everywhere"}
          </h2>
          <p className="mt-2 max-w-sm text-center text-sm leading-relaxed text-[var(--dim)]">
            {localSignOut
              ? "You signed out of this device — no account data shows on it, and your other devices stay signed in. Getting back in takes a real credential: your app PIN, Face ID / fingerprint if it's on, or the full account sign-in. There's no one-tap way back."
              : "Every session for this account was revoked — that's the Sign Out Everywhere / kill-switch doing its job. To use this device again, sign in with a real credential: your app PIN, Face ID / fingerprint if it's on, or the full account sign-in."}
          </p>
          {doors.includes("biometric") && (
            <button
              type="button"
              className="mt-4 w-64 rounded-xl border border-[var(--accent)] bg-[var(--surface2)] py-3.5 font-bold text-[var(--accent)]"
              aria-label="Sign in with Face ID or fingerprint"
              onClick={signInWithBiometric}
            >
              🔓 Sign in with Face ID / fingerprint
            </button>
          )}
          {doors.includes("pin") ? (
            <>
              <input
                ref={signInPinRef}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                className="mt-3 w-64 rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-4 py-3.5 text-center font-condensed text-2xl tracking-[0.35em]"
                value={signInPin}
                onChange={(e) => setSignInPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                aria-label="App PIN to sign back in"
                placeholder="App PIN"
              />
              {signInErr && <p className="mt-2 w-64 text-center text-sm font-semibold text-[var(--danger)]">{signInErr}</p>}
              <button
                type="button"
                className="mt-3 w-64 rounded-xl bg-[var(--accent)] py-3.5 font-bold text-black disabled:opacity-50"
                disabled={signInPin.length < 4 || signInBusy}
                aria-label="Sign in with your PIN"
                onClick={signInWithPin}
              >
                Sign in
              </button>
              <p className="mt-3 max-w-xs text-center text-xs leading-relaxed text-[var(--dim)]">
                The PIN always works — Face ID is a shortcut on this device, never the only door.
              </p>
              <button
                type="button"
                className="mt-3 w-64 rounded-xl border border-[var(--border)] bg-[var(--surface2)] py-3 font-bold"
                aria-label="Sign in with a different account"
                onClick={goToFullSignIn}
              >
                Sign in with a different account
              </button>
            </>
          ) : (
            <>
              {signInErr && <p className="mt-2 w-64 text-center text-sm font-semibold text-[var(--danger)]">{signInErr}</p>}
              <button
                type="button"
                className="mt-3 w-64 rounded-xl bg-[var(--accent)] py-3.5 font-bold text-black"
                aria-label="Sign in with a different account"
                onClick={goToFullSignIn}
              >
                Sign in with a different account
              </button>
              <p className="mt-3 max-w-xs text-center text-xs leading-relaxed text-[var(--dim)]">
                No app PIN is set on this device, so the way back is the full account sign-in — email +
                password, Google, or a passkey. You can sign back into this same account there, or a
                different one.
              </p>
            </>
          )}
        </div>
      )}
    </>
  );
}

// ---------- small QR (same renderer family as the passport QR) -----------------

function TotpQr({ text }: { text: string }) {
  const grid = useMemo(() => qrGrid(text), [text]);
  if (!grid) return <p className="text-xs text-[var(--dim)]">QR didn't render — type the secret below into your authenticator app instead.</p>;
  const n = grid.length;
  return (
    <svg width={148} height={148} viewBox={`0 0 ${n + 2} ${n + 2}`} role="img" aria-label="QR code for adding STONEMILES to your authenticator app" className="rounded-lg bg-white">
      <rect x={0} y={0} width={n + 2} height={n + 2} fill="#ffffff" />
      {grid.map((row, y) =>
        row.map((dark, x) => (dark ? <rect key={`${x}-${y}`} x={x + 1} y={y + 1} width={1.02} height={1.02} fill="#000000" /> : null)),
      )}
    </svg>
  );
}

// ---------- the Security Pack 2 panel (Security Center) -------------------------

export function SecurityPackPanel({ setBanner }: { setBanner: Banner }) {
  const queryClient = useQueryClient();
  const pack = useQuery({ queryKey: ["security-pack"], queryFn: () => api.getSecurityPack({ deviceId: deviceId() }) });
  const sessions = useQuery({ queryKey: ["security-sessions"], queryFn: () => api.listSessions({ deviceId: deviceId() }) });
  const accessLog = useQuery({ queryKey: ["my-access-log"], queryFn: () => api.listMyAccessLog({ limit: 50 }) });
  const d = pack.data;

  const [setupSecret, setSetupSecret] = useState<{ secret: string; url: string } | null>(null);
  const [confirmCode, setConfirmCode] = useState("");
  const [recoveryShown, setRecoveryShown] = useState<string[] | null>(null);
  const [disableCode, setDisableCode] = useState("");
  const [disablePin, setDisablePin] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [autoLockDraft, setAutoLockDraft] = useState<number | null>(null);
  const [retentionDraft, setRetentionDraft] = useState<number | null>(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["security-pack"] });
    queryClient.invalidateQueries({ queryKey: ["security-sessions"] });
    queryClient.invalidateQueries({ queryKey: ["security-center"] });
  };

  return (
    <section className="mt-3 rounded-xl bg-[var(--surface2)] p-3" aria-label="Security Pack 2 — account protection">
      <div className="font-semibold">🛡️ Security Pack 2 — takeover protection, kill switch, access audit</div>
      {!d ? (
        <p className="mt-2 text-xs text-[var(--dim)]">Loading your account security state…</p>
      ) : (
        <div className="mt-2 space-y-4 text-sm">
          {/* alerts */}
          {d.alerts.length > 0 && (
            <div>
              <div className="flex items-center justify-between gap-2">
                <div className="font-bold">🔔 Security alerts {d.unreadAlerts > 0 && <span className="text-[var(--danger)]">({d.unreadAlerts} unread)</span>}</div>
                {d.unreadAlerts > 0 && (
                  <button
                    type="button"
                    className="text-xs font-bold underline"
                    aria-label="Mark all security alerts read"
                    onClick={() => void api.markSecurityAlertsRead({}).then(refresh)}
                  >
                    Mark read
                  </button>
                )}
              </div>
              <ul className="mt-1 space-y-1 text-xs text-[var(--dim)]">
                {d.alerts.slice(0, 6).map((a) => (
                  <li key={a.id} className={a.read ? "" : "font-semibold text-[var(--text)]"}>
                    <strong>{new Date(a.at).toLocaleString()}</strong> — {a.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 2FA */}
          <div>
            <div className="font-bold">📱 Two-factor authentication (authenticator app)</div>
            <p className="mt-0.5 text-xs leading-relaxed text-[var(--dim)]">
              {d.totp.required
                ? "Owner and Dispatch accounts must run 2FA — a stolen password alone can't take the account. "
                : "Optional for drivers, strongly recommended. "}
              The secret is generated on the server, encrypted at rest (AES-256-GCM, same vault as the EIN), and
              checked server-side against the real TOTP clock. Recovery codes are one-time, shown once, stored as
              hashes only. Status:{" "}
              <strong className="text-[var(--text)]">
                {d.totp.enabled ? "ON ✓" : d.totp.pendingSetup ? "setup started — not confirmed yet" : "OFF"}
              </strong>
              {d.totp.enabled && ` · ${d.totp.recoveryLeft} recovery code${d.totp.recoveryLeft === 1 ? "" : "s"} left`}
            </p>
            {!d.totp.enabled && !setupSecret && (
              <button
                type="button"
                className={`${accentBtnCls} mt-2`}
                aria-label="Start two-factor setup"
                onClick={() => {
                  void api
                    .beginTotpSetup({})
                    .then((r) => {
                      if (r.ok && r.secret && r.otpauthUrl) setSetupSecret({ secret: r.secret, url: r.otpauthUrl });
                      else setMsg(r.error ?? "Couldn't start 2FA setup.");
                    })
                    .catch(() => setMsg("Couldn't start 2FA setup — try again."));
                }}
              >
                {d.totp.pendingSetup ? "Restart setup & show a new secret" : "Set up 2FA"}
              </button>
            )}
            {setupSecret && (
              <div className="mt-2 rounded-lg bg-[var(--surface)] p-3">
                <p className="text-xs leading-relaxed text-[var(--dim)]">
                  Scan this with your authenticator app (or type the secret), then enter the 6-digit code it shows
                  to turn 2FA on. The secret is shown once — after setup it never leaves the server again.
                </p>
                <div className="mt-2 flex justify-center">
                  <TotpQr text={setupSecret.url} />
                </div>
                <p className="mt-2 break-all text-center font-mono text-sm font-bold tracking-wider">{setupSecret.secret}</p>
                <div className="mt-2 flex gap-2">
                  <input
                    className={inputCls}
                    inputMode="numeric"
                    placeholder="6-digit code from the app"
                    value={confirmCode}
                    onChange={(e) => setConfirmCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    aria-label="Authenticator code to confirm 2FA setup"
                  />
                  <button
                    type="button"
                    disabled={confirmCode.length !== 6}
                    className={`${accentBtnCls} shrink-0`}
                    aria-label="Confirm and turn on two-factor"
                    onClick={() => {
                      void api
                        .confirmTotpSetup({ code: confirmCode })
                        .then((r) => {
                          if (r.ok) {
                            setSetupSecret(null);
                            setConfirmCode("");
                            setRecoveryShown(r.recoveryCodes);
                            setMsg("2FA is ON. Save the recovery codes below — they're shown once and never again.");
                            refresh();
                          } else {
                            setMsg(r.error ?? "That code didn't confirm setup.");
                          }
                        })
                        .catch(() => setMsg("Couldn't confirm 2FA — try again."));
                    }}
                  >
                    Turn on 2FA
                  </button>
                </div>
              </div>
            )}
            {recoveryShown && (
              <div className="mt-2 rounded-lg border border-amber-500/50 bg-[#2c2207] p-3" role="note" aria-label="Your one-time recovery codes">
                <div className="font-bold text-amber-200">⚠️ Recovery codes — save these now, they're shown once</div>
                <p className="mt-1 text-xs leading-relaxed text-amber-200/85">
                  Each code unlocks the account once if you lose your authenticator. Only hashes of these are
                  stored — nobody, including the app, can show them again.
                </p>
                <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm font-bold text-amber-100">
                  {recoveryShown.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="mt-2 rounded-lg bg-[var(--surface)] px-3 py-2 text-xs font-bold"
                  aria-label="I saved my recovery codes — hide them"
                  onClick={() => setRecoveryShown(null)}
                >
                  I saved them — hide
                </button>
              </div>
            )}
            {d.totp.enabled && (
              <div className="mt-2 rounded-lg bg-[var(--surface)] p-2.5">
                <div className="flex flex-wrap gap-2">
                  <input
                    className={`${inputCls} min-w-0 flex-1`}
                    placeholder="Authenticator / recovery code — or app PIN"
                    value={disableCode}
                    onChange={(e) => setDisableCode(e.target.value.toUpperCase().slice(0, 12))}
                    aria-label="Code to prove it's you before turning 2FA off"
                  />
                  <input
                    type="password"
                    inputMode="numeric"
                    className={`${inputCls} w-28`}
                    placeholder="PIN"
                    value={disablePin}
                    onChange={(e) => setDisablePin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                    aria-label="App PIN to turn 2FA off"
                  />
                  <button
                    type="button"
                    className={`${btnCls} shrink-0 font-bold text-[var(--danger)]`}
                    aria-label="Turn off two-factor authentication"
                    onClick={() => {
                      void api
                        .disableTotp({ code: disableCode || undefined, pin: disablePin || undefined })
                        .then((r) => {
                          setMsg(r.ok ? "2FA is off. Owner/Dispatch accounts should turn it back on right away." : (r.error ?? "Couldn't turn 2FA off."));
                          if (r.ok) {
                            setDisableCode("");
                            setDisablePin("");
                            refresh();
                          }
                        })
                        .catch(() => setMsg("Couldn't turn 2FA off — try again."));
                    }}
                  >
                    Turn off 2FA
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* sessions */}
          <div>
            <div className="font-bold">💻 Active sessions</div>
            <p className="mt-0.5 text-xs leading-relaxed text-[var(--dim)]">
              Every signed-in device for this account, tracked on the server. Don't recognize one? Sign out
              everywhere — it revokes every session token at once, including this device's (you'll sign back in).
            </p>
            <ul className="mt-1.5 space-y-1">
              {(sessions.data?.sessions ?? []).slice(0, 8).map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--surface)] px-2.5 py-2 text-xs">
                  <span className="min-w-0">
                    <span className="block truncate font-bold text-[var(--text)]">
                      {s.deviceLabel} {s.current && <span className="text-[var(--accent)]">· this device</span>}
                      {s.revoked && <span className="text-[var(--danger)]"> · signed out</span>}
                    </span>
                    <span className="text-[var(--dim)]">
                      Signed in {new Date(s.signedInAt).toLocaleString()} · last active {new Date(s.lastActiveAt).toLocaleString()}
                    </span>
                  </span>
                </li>
              ))}
              {(sessions.data?.sessions ?? []).length === 0 && <li className="text-xs text-[var(--dim)]">No sessions recorded yet.</li>}
            </ul>
            <button
              type="button"
              className={`${btnCls} mt-2 font-bold text-[var(--danger)]`}
              aria-label="Sign out everywhere — revoke all sessions"
              onClick={() => {
                void api
                  .signOutEverywhere({})
                  .then((r) => {
                    try {
                      localStorage.removeItem(SESSION_TOKEN_KEY);
                    } catch { /* ignore */ }
                    // Durable here too — this device's own sign-out
                    // must survive a reload, not just the session
                    // poll noticing the revocation later.
                    setDeviceSignOutMark("everywhere");
                    setBanner(`Signed out everywhere — ${r.revoked} session(s) revoked. This device will ask you to sign back in.`);
                    refresh();
                  })
                  .catch(() => setMsg("Couldn't sign out everywhere — try again."));
              }}
            >
              Sign out everywhere
            </button>
          </div>

          {/* kill switch + auto-lock + step-up */}
          <div>
            <div className="font-bold">📵 Lost-phone kill switch &amp; step-up PIN</div>
            <p className="mt-0.5 text-xs leading-relaxed text-[var(--dim)]">
              Lost the phone? Sign in on any other device (2FA where enabled) and lock the account: every session
              dies at once and exports stop until you unlock it with your PIN
              {d.totp.enabled ? " + a 2FA code" : ""}. Lock and unlock are both sealed security events. Account
              status: <strong className="text-[var(--text)]">{d.locked ? `LOCKED since ${d.lockedAt ? new Date(d.lockedAt).toLocaleString() : ""}` : "not locked"}</strong>
              <br />
              Step-up: wallet screens, settlement views, and every export (Download / Copy / Print / Send) need a
              PIN entry fresh within 5 minutes. Current step-up:{" "}
              <strong className="text-[var(--text)]">
                {d.pinSet
                  ? d.stepUpFreshUntil
                    ? `fresh until ${new Date(d.stepUpFreshUntil).toLocaleTimeString()}`
                    : "not fresh — the next sensitive area will ask"
                  : "no PIN set — set one above to arm the step-up"}
              </strong>
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {!d.locked ? (
                <button
                  type="button"
                  className={`${btnCls} font-bold text-[var(--danger)]`}
                  aria-label="Lock this account and kill all sessions now"
                  onClick={() => {
                    void api
                      .lockAccount({ reason: "Locked from the Security Center" })
                      .then((r) => {
                        setBanner(`Account locked — ${r.revokedSessions} session(s) killed. Unlock it from any device with your PIN${d.totp.enabled ? " + 2FA code" : ""}.`);
                        refresh();
                      })
                      .catch(() => setMsg("Couldn't lock the account — try again."));
                  }}
                >
                  🔒 Lock account &amp; kill all sessions
                </button>
              ) : (
                <button
                  type="button"
                  className={accentBtnCls}
                  aria-label="Unlock this account"
                  onClick={() => {
                    void ensureStepUp("Unlock account").then(() => undefined);
                    setMsg("Use the account-locked screen (it appears on locked devices) or unlock from another signed-in device — unlocking needs your PIN" + (d.totp.enabled ? " and a 2FA code." : "."));
                  }}
                >
                  Unlock…
                </button>
              )}
              <label className="flex items-center gap-2 text-xs font-bold">
                Auto-lock after
                <select
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-xs font-bold"
                  value={autoLockDraft ?? d.autoLockMinutes}
                  aria-label="Auto-lock timer — minutes of inactivity before the app locks"
                  onChange={(e) => setAutoLockDraft(Number(e.target.value))}
                >
                  <option value={0}>Off</option>
                  <option value={1}>1 minute</option>
                  <option value={5}>5 minutes</option>
                  <option value={15}>15 minutes</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs font-bold">
                Raw GPS kept
                <select
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-xs font-bold"
                  value={retentionDraft ?? d.trackRetentionDays}
                  aria-label="Raw GPS track retention in days"
                  onChange={(e) => setRetentionDraft(Number(e.target.value))}
                >
                  <option value={7}>7 days</option>
                  <option value={30}>30 days</option>
                  <option value={90}>90 days</option>
                </select>
              </label>
              <button
                type="button"
                className={btnCls}
                aria-label="Save auto-lock and GPS retention settings"
                onClick={() => {
                  void api
                    .saveSecurityPrefs({
                      autoLockMinutes: autoLockDraft ?? d.autoLockMinutes,
                      trackRetentionDays: retentionDraft ?? d.trackRetentionDays,
                    })
                    .then((r) => {
                      setMsg(r.ok ? "Security settings saved." : (r.error ?? "Couldn't save those settings."));
                      if (r.ok) refresh();
                    })
                    .catch(() => setMsg("Couldn't save those settings — try again."));
                }}
              >
                Save settings
              </button>
            </div>
            <p className="mt-1.5 text-xs text-[var(--dim)]">
              Raw GPS breadcrumbs on the server: {d.trackPointCount} point(s), kept {d.trackRetentionDays} days
              {d.lastPurgeAt ? ` · last purge ${new Date(d.lastPurgeAt).toLocaleString()}` : ""}. Sealed trip
              records, trip sheets, and summaries are never purged — only the raw track.
            </p>
            <button
              type="button"
              className={`${btnCls} mt-1`}
              aria-label="Run the raw GPS retention purge now"
              onClick={() => {
                void api
                  .runTrackPurge({})
                  .then((r) => {
                    setBanner(`Retention purge ran — ${r.removed} raw point(s) older than ${r.retentionDays} days removed. Sealed records untouched.`);
                    refresh();
                  })
                  .catch(() => setMsg("Couldn't run the purge — try again."));
              }}
            >
              Run retention purge now
            </button>
          </div>

          {/* access audit */}
          <div>
            <div className="font-bold">👁️ Who accessed my records</div>
            <p className="mt-0.5 text-xs leading-relaxed text-[var(--dim)]">
              Every company-side (owner/dispatch) view or export of your records is written to a sealed audit the
              moment it happens. This is that list — there's no way for the company side to look quietly.
            </p>
            {(accessLog.data?.entries ?? []).length === 0 ? (
              <p className="mt-1 text-xs text-[var(--dim)]">Nobody on the company side has accessed your records through the audited paths yet.</p>
            ) : (
              <ul className="mt-1 space-y-1 text-xs text-[var(--dim)]">
                {(accessLog.data?.entries ?? []).slice(0, 10).map((e) => (
                  <li key={e.id}>
                    <strong className="text-[var(--text)]">@{e.viewerUsername}</strong> {e.kind === "export" ? "exported" : "viewed"} {e.what} · {new Date(e.at).toLocaleString()}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* money holds */}
          {d.holds.length > 0 && (
            <div>
              <div className="font-bold">⏸️ Money Review Holds</div>
              <ul className="mt-1 space-y-1.5">
                {d.holds.slice(0, 6).map((h) => (
                  <li key={h.id} className="rounded-lg bg-[var(--surface)] px-2.5 py-2 text-xs">
                    <span className="font-bold text-[var(--text)]">
                      {h.kind === "conversion" ? "Conversion" : "Cash-out"} · {h.stonerAmount.toLocaleString()} $STONER — REVIEW HOLD
                    </span>
                    <span className="block text-[var(--dim)]">
                      {new Date(h.createdAt).toLocaleString()} · {h.reason}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-[var(--dim)]">
                Holds are the step-up policy working: large money requests (conversion ≥{" "}
                {`5,000`} $STONER, cash-out ≥ $250) and rapid repeats wait for review instead of processing. A hold
                moves nothing, and conversion/cash-out stay gated until the November 20 launch + go-live word.
              </p>
            </div>
          )}
          {msg && <p className="text-xs font-semibold">{msg}</p>}
        </div>
      )}
    </section>
  );
}

// ---------- company-side: fleet locations + cut off access ----------------------

export function CompanySecurityPanel({
  members,
  myRole,
  myUsername,
  setBanner,
}: {
  members: { username: string; role: string; loginDisabled: boolean }[];
  myRole: string | null;
  myUsername: string;
  setBanner: Banner;
}) {
  const queryClient = useQueryClient();
  const canView = myRole === "owner" || myRole === "dispatch";
  const locations = useQuery({
    queryKey: ["company-locations"],
    queryFn: () => api.getCompanyLocations({}),
    enabled: canView,
    refetchInterval: 60000,
  });
  if (!canView) return null;
  return (
    <div className="mt-3">
      <div className="text-xs font-bold uppercase tracking-wide text-[var(--dim)]">Driver locations — privacy rules on</div>
      <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
        You see a driver's live location <strong className="text-[var(--text)]">only while they're on duty or on an
        active trip</strong>. Off duty, the server itself withholds the coordinates — this screen never receives them.
      </p>
      <ul className="mt-1.5 space-y-1">
        {(locations.data?.drivers ?? []).map((dr) => (
          <li key={dr.username} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--surface2)] px-3 py-2 text-sm">
            <span className="min-w-0">
              <span className="block truncate font-bold">
                {dr.username} <span className="text-xs font-normal text-[var(--dim)]">· {dr.role}</span>
              </span>
              <span className="block text-xs text-[var(--dim)]">{dr.statusLabel}</span>
            </span>
            {dr.visible && dr.lat != null && dr.lon != null ? (
              <span className="shrink-0 text-right font-mono text-xs font-bold text-[var(--accent)]">
                {dr.lat.toFixed(4)}, {dr.lon.toFixed(4)}
                {dr.updatedAt && <span className="block font-sans font-normal text-[var(--dim)]">{new Date(dr.updatedAt).toLocaleTimeString()}</span>}
              </span>
            ) : (
              <span className="shrink-0 text-xs font-bold text-[var(--dim)]">🔒 private</span>
            )}
          </li>
        ))}
        {(locations.data?.drivers ?? []).length === 0 && (
          <li className="text-xs text-[var(--dim)]">No other members yet — locations appear here as drivers join.</li>
        )}
      </ul>
      {myRole === "owner" && (
        <div className="mt-3">
          <div className="text-xs font-bold uppercase tracking-wide text-[var(--dim)]">Cut off access (departed driver)</div>
          <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
            One tap: their login is disabled, every session they hold is revoked, and they drop out of the company
            chats. The cut-off is a sealed security event, and their own records/wallet stay theirs.
          </p>
          <ul className="mt-1.5 space-y-1">
            {members
              .filter((m) => m.username !== myUsername)
              .map((m) => (
                <li key={m.username} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--surface2)] px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">
                    {m.username} <span className="text-xs text-[var(--dim)]">· {m.role}</span>
                    {m.loginDisabled && <span className="ml-1 text-xs font-bold text-[var(--danger)]">· ACCESS CUT OFF</span>}
                  </span>
                  {!m.loginDisabled && (
                    <button
                      type="button"
                      className="shrink-0 rounded-lg bg-[var(--surface)] border border-[var(--border)] px-3 py-1.5 text-xs font-bold text-[var(--danger)]"
                      aria-label={`Cut off access for ${m.username}`}
                      onClick={() => {
                        void api
                          .cutOffMember({ username: m.username })
                          .then((r) => {
                            setBanner(
                              r.ok
                                ? `${m.username} is cut off — login disabled, ${r.revokedSessions} session(s) revoked, removed from company chats. Sealed in the security log.`
                                : (r.error ?? "Couldn't cut off access."),
                            );
                            queryClient.invalidateQueries({ queryKey: ["company"] });
                            queryClient.invalidateQueries({ queryKey: ["company-locations"] });
                            queryClient.invalidateQueries({ queryKey: ["chat-groups"] });
                          })
                          .catch(() => setBanner("Couldn't cut off access — try again."));
                      }}
                    >
                      ⛔ Cut off access
                    </button>
                  )}
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
