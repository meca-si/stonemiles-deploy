// AuthGate — standalone sign-in gate (Re-platform Phase 2b).
//
// Wraps the whole app (main.tsx). Talks to the host's /auth/* routes
// (NOT actions — sign-in runs before a session exists):
//   GET  /auth/me            → { signedIn, gateEnforced, totpPending, account }
//   POST /auth/signin        → email + password (+ totpCode when asked)
//   POST /auth/totp          → completes a session paused at the D7 gate
//   POST /auth/signout
//   POST /auth/request-reset → always answers ok (no enumeration)
//   GET  /auth/methods       → which sign-in doors are actually live
//   GET  /auth/google/start  → Google OAuth (live only when env is set)
//   GET  /auth/apple/start   → Apple OAuth (wired; live after Dec 4 env)
//   POST /auth/passkey/*     → WebAuthn enroll / list / remove / sign-in
//   POST /auth/invites       → owner-only tester/trial invites (D1/D2)
//   GET  /auth/testers       → owner-only Founding Tester list (D4)
//   POST /auth/testers/flip  → owner-only manual Diamond→Gold-year flip (D4)
//
// Behaviour:
// - Host in staging-anonymous mode (gateEnforced false) → children render
//   untouched (the Phase 1 local proof posture).
// - No session → sign-in screen. Registration is invite-only (D2): the
//   screen says so and points at the invite link flow — there is no
//   public signup form anywhere in this component, by design.
// - Session pending TOTP (D7: owner + team seats) → code screen.
// - Signed in → children + a compact account bar (email, sign out, and
//   for the owner: invite desk + tester completion list).

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

interface MeState {
  signedIn: boolean;
  gateEnforced: boolean;
  totpPending?: boolean;
  account?: {
    email: string;
    username: string;
    isOwner: boolean;
    hasTeamSeat: boolean;
    profileId: number;
  } | null;
}

interface TesterRow {
  accountId: number;
  email: string;
  username: string | null;
  acceptedAt: string | null;
  daysActiveOf14: number;
  windowComplete: boolean;
  completed: boolean;
  currentPlan: string | null;
  flippedToGoldYear: boolean;
}

async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, {
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...init,
  });
}

const wrap: React.CSSProperties = {
  minHeight: "100dvh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#050a1a",
  color: "#e8ecf4",
  fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  padding: 16,
};
const card: React.CSSProperties = {
  width: "100%",
  maxWidth: 400,
  background: "#0b1226",
  border: "1px solid #1d2a4a",
  borderRadius: 16,
  padding: 24,
};
const input: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: 12,
  fontSize: 16,
  borderRadius: 10,
  border: "1px solid #2a3a5f",
  background: "#070d1f",
  color: "#e8ecf4",
  marginTop: 6,
};
const label: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  color: "#9fb0d0",
  marginTop: 14,
};
const button: React.CSSProperties = {
  width: "100%",
  marginTop: 20,
  padding: 13,
  fontSize: 16,
  fontWeight: 600,
  border: 0,
  borderRadius: 10,
  background: "#22c55e",
  color: "#04120a",
  cursor: "pointer",
};
const ghostButton: React.CSSProperties = {
  background: "none",
  border: 0,
  color: "#7dd3fc",
  cursor: "pointer",
  fontSize: 14,
  padding: 0,
  marginTop: 14,
};
const socialButton: React.CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  marginTop: 10,
  padding: 12,
  fontSize: 15,
  fontWeight: 600,
  textAlign: "center",
  textDecoration: "none",
  borderRadius: 10,
  border: "1px solid #2a3a5f",
  background: "#0e1730",
  color: "#e8ecf4",
  cursor: "pointer",
};

// ---------------------------------------------------------------------------
// Passkeys (WebAuthn). The server (host/social-auth.ts) runs the
// ceremonies; the device keeps the private key and ALL biometric data —
// Face ID / fingerprint never leaves the phone. Password sign-in always
// remains available; a passkey is an added door, never the only one.
// ---------------------------------------------------------------------------

function b64urlToBuf(text: string): ArrayBuffer {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const buf = new ArrayBuffer(bin.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

function bufToB64url(buf: ArrayBuffer): string {
  const view = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < view.length; i++) bin += String.fromCharCode(view[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface RawPkCredential {
  id: string;
  type: string;
  response: {
    clientDataJSON: ArrayBuffer;
    attestationObject?: ArrayBuffer;
    authenticatorData?: ArrayBuffer;
    signature?: ArrayBuffer;
    userHandle?: ArrayBuffer | null;
    getTransports?: () => string[];
  };
}

function credsApi(): {
  create: (opts: unknown) => Promise<RawPkCredential | null>;
  get: (opts: unknown) => Promise<RawPkCredential | null>;
} | null {
  if (typeof navigator === "undefined" || !navigator.credentials) return null;
  if (typeof window === "undefined" || !("PublicKeyCredential" in window)) {
    return null;
  }
  const c = navigator.credentials as unknown as {
    create?: unknown;
    get?: unknown;
  };
  if (typeof c.create !== "function" || typeof c.get !== "function") return null;
  return c as {
    create: (opts: unknown) => Promise<RawPkCredential | null>;
    get: (opts: unknown) => Promise<RawPkCredential | null>;
  };
}

function passkeySupported(): boolean {
  return credsApi() !== null;
}

/** "Face ID" on Apple platforms; fingerprint/passkey wording elsewhere. */
function biometricLabel(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  return /iPhone|iPad|iPod|Macintosh|Mac OS/.test(ua)
    ? "Face ID"
    : "fingerprint / passkey";
}

function suggestedDeviceLabel(): string {
  const ua = navigator.userAgent || "";
  const kind = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android phone"
        : /Macintosh|Mac OS/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows PC"
            : "This device";
  return `${kind} passkey`;
}

interface RegisterOptionsJson {
  challenge: string;
  user: { id: string; name: string; displayName: string };
  excludeCredentials?: Array<{ type: string; id: string }>;
  [key: string]: unknown;
}

interface AuthOptionsJson {
  challenge: string;
  allowCredentials?: Array<{ type: string; id: string }>;
  [key: string]: unknown;
}

async function createPasskey(
  options: RegisterOptionsJson,
): Promise<Record<string, unknown>> {
  const api = credsApi();
  if (!api) throw new Error("This device can't do passkeys.");
  const cred = await api.create({
    publicKey: {
      ...options,
      challenge: b64urlToBuf(options.challenge),
      user: { ...options.user, id: b64urlToBuf(options.user.id) },
      excludeCredentials: (options.excludeCredentials ?? []).map((c) => ({
        type: "public-key",
        id: b64urlToBuf(c.id),
      })),
    },
  });
  if (!cred) throw new Error("Passkey setup was cancelled.");
  return {
    id: cred.id,
    type: cred.type,
    response: {
      attestationObject: bufToB64url(cred.response.attestationObject!),
      clientDataJSON: bufToB64url(cred.response.clientDataJSON),
      transports:
        typeof cred.response.getTransports === "function"
          ? cred.response.getTransports()
          : [],
    },
  };
}

async function getPasskeyAssertion(
  options: AuthOptionsJson,
): Promise<Record<string, unknown>> {
  const api = credsApi();
  if (!api) throw new Error("This device can't do passkeys.");
  const cred = await api.get({
    publicKey: {
      ...options,
      challenge: b64urlToBuf(options.challenge),
      allowCredentials: (options.allowCredentials ?? []).map((c) => ({
        type: "public-key",
        id: b64urlToBuf(c.id),
      })),
    },
  });
  if (!cred) throw new Error("Passkey sign-in was cancelled.");
  return {
    id: cred.id,
    type: cred.type,
    response: {
      authenticatorData: bufToB64url(cred.response.authenticatorData!),
      clientDataJSON: bufToB64url(cred.response.clientDataJSON),
      signature: bufToB64url(cred.response.signature!),
      ...(cred.response.userHandle
        ? { userHandle: bufToB64url(cred.response.userHandle) }
        : {}),
    },
  };
}

function SignInScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const emailRef = useRef<HTMLInputElement | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpRequired, setTotpRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  // Which social doors the server reports live (env-configured). A door
  // that isn't configured never renders — no dead buttons, ever.
  const [methods, setMethods] = useState<{ google: boolean; apple: boolean }>({
    google: false,
    apple: false,
  });
  const [canPasskey] = useState(() => passkeySupported());

  useEffect(() => {
    let live = true;
    authFetch("/auth/methods")
      .then(async (res) => {
        if (res.ok && live) {
          const data = (await res.json()) as {
            google?: boolean;
            apple?: boolean;
          };
          setMethods({
            google: data.google === true,
            apple: data.apple === true,
          });
        }
      })
      .catch(() => {
        // Methods unreachable → email/password only, the always-on door.
      });
    // A social round-trip that refused lands back here with ?authError=.
    const params = new URLSearchParams(window.location.search);
    const authError = params.get("authError");
    if (authError) {
      setError(
        authError === "invite_only"
          ? "STONEMILES is invite-only — that account's email doesn't have an invite yet. If you were invited, open the link from your invite."
          : "That sign-in didn't work — try again, or use your email and password.",
      );
      params.delete("authError");
      const rest = params.toString();
      window.history.replaceState(
        null,
        "",
        window.location.pathname + (rest ? `?${rest}` : "") + window.location.hash,
      );
    }
    return () => {
      live = false;
    };
  }, []);

  const passkeySignIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const optRes = await authFetch("/auth/passkey/auth/options", {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!optRes.ok) throw new Error("Passkey sign-in isn't available right now.");
      const options = (await optRes.json()) as AuthOptionsJson;
      const credential = await getPasskeyAssertion(options);
      const res = await authFetch("/auth/passkey/auth/verify", {
        method: "POST",
        body: JSON.stringify({ credential }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "That passkey sign-in didn't work.");
      // If the account is owner/team, the session comes back paused at
      // the D7 TOTP gate and AuthGate shows the code screen next.
      onSignedIn();
    } catch (err) {
      // Closing the device prompt is a choice, not an error to shout.
      if ((err as { name?: string })?.name !== "NotAllowedError") {
        setError(
          err instanceof Error ? err.message : "That passkey sign-in didn't work.",
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch("/auth/signin", {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          ...(totpRequired && totpCode ? { totpCode } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        totpRequired?: boolean;
      };
      if (!res.ok) {
        if (data.totpRequired) setTotpRequired(true);
        throw new Error(data.error ?? "Sign-in failed.");
      }
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await authFetch("/auth/request-reset", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setResetSent(true);
    } finally {
      setBusy(false);
    }
  };

  if (resetMode) {
    return (
      <div style={wrap}>
        <div style={card}>
          <h1 style={{ fontSize: 20, margin: "0 0 6px" }}>Reset your password</h1>
          {resetSent ? (
            <p style={{ color: "#9fb0d0", fontSize: 14, lineHeight: 1.5 }}>
              If that email has an account, a reset link is on its way (or
              the owner will deliver it). Links last 60 minutes.
            </p>
          ) : (
            <form onSubmit={submitReset}>
              <p style={{ color: "#9fb0d0", fontSize: 14, margin: 0, lineHeight: 1.5 }}>
                Enter your account email and we'll send a reset link.
              </p>
              <label style={label}>
                Email
                <input style={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
              </label>
              <button style={button} type="submit" disabled={busy}>Send reset link</button>
            </form>
          )}
          <button style={ghostButton} onClick={() => { setResetMode(false); setResetSent(false); }}>
            ← Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <div style={card}>
        {/* Sign in at the top of the signed-out view (x, 2026-11-11):
            this screen renders no app top bar or menu, so the button
            that sits beside Menu in the bar rides at the top of the
            card instead — it puts the cursor in the email field, the
            first step of the form right below it. */}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            style={{ ...ghostButton, marginTop: 0 }}
            onClick={() => emailRef.current?.focus()}
          >
            Sign in
          </button>
        </div>
        <h1 style={{ fontSize: 20, margin: "0 0 6px" }}>STONEMILES by Stonervision</h1>
        <p style={{ color: "#9fb0d0", fontSize: 14, margin: 0, lineHeight: 1.5 }}>
          Sign in to your account. New accounts are invite-only — if you
          were invited, use the link in your email to set your password.
        </p>
        <form onSubmit={submit}>
          <label style={label}>
            Email
            <input ref={emailRef} style={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </label>
          <label style={label}>
            Password
            <input style={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </label>
          {totpRequired && (
            <label style={label}>
              Authenticator code (or a recovery code)
              <input style={input} type="text" value={totpCode} onChange={(e) => setTotpCode(e.target.value)} autoComplete="one-time-code" inputMode="numeric" />
            </label>
          )}
          {error && <p style={{ color: "#f87171", fontSize: 14 }}>{error}</p>}
          <button style={button} type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        {(methods.google || methods.apple || canPasskey) && (
          <div style={{ marginTop: 18 }}>
            <p
              style={{
                color: "#5b6c92",
                fontSize: 12,
                textAlign: "center",
                margin: "0 0 4px",
              }}
            >
              — or —
            </p>
            {methods.google && (
              <a href="/auth/google/start" style={socialButton}>
                Continue with Google
              </a>
            )}
            {methods.apple && (
              <a href="/auth/apple/start" style={socialButton}>
                Continue with Apple
              </a>
            )}
            {canPasskey && (
              <button
                type="button"
                style={{ ...socialButton, marginTop: 10 }}
                disabled={busy}
                onClick={() => void passkeySignIn()}
              >
                Sign in with {biometricLabel()}
              </button>
            )}
            <p style={{ color: "#5b6c92", fontSize: 12, lineHeight: 1.5, marginTop: 10 }}>
              {biometricLabel()} uses a passkey on this device — your face or
              fingerprint never leaves the phone. New accounts stay
              invite-only on every door.
            </p>
          </div>
        )}
        <button style={ghostButton} onClick={() => setResetMode(true)}>
          Forgot your password?
        </button>
      </div>
    </div>
  );
}

function TotpScreen({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await authFetch("/auth/totp", {
        method: "POST",
        body: JSON.stringify({ totpCode: code }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "That code doesn't match.");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code doesn't match.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={wrap}>
      <div style={card}>
        <h1 style={{ fontSize: 20, margin: "0 0 6px" }}>Two-factor sign-in</h1>
        <p style={{ color: "#9fb0d0", fontSize: 14, margin: 0, lineHeight: 1.5 }}>
          Owner and team accounts confirm with an authenticator code (a
          recovery code works too).
        </p>
        <form onSubmit={submit}>
          <label style={label}>
            Authenticator code
            <input style={input} type="text" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" inputMode="numeric" required />
          </label>
          {error && <p style={{ color: "#f87171", fontSize: 14 }}>{error}</p>}
          <button style={button} type="submit" disabled={busy}>Confirm</button>
        </form>
      </div>
    </div>
  );
}

function OwnerDesk({ me }: { me: MeState }) {
  const [open, setOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteKind, setInviteKind] = useState<"tester" | "trial">("tester");
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [acceptLink, setAcceptLink] = useState<string | null>(null);
  const [testers, setTesters] = useState<TesterRow[] | null>(null);

  const loadTesters = useCallback(async () => {
    const res = await authFetch("/auth/testers");
    if (res.ok) {
      const data = (await res.json()) as { testers: TesterRow[] };
      setTesters(data.testers);
    }
  }, []);

  useEffect(() => {
    if (open) void loadTesters();
  }, [open, loadTesters]);

  const issue = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteMsg(null);
    setAcceptLink(null);
    const res = await authFetch("/auth/invites", {
      method: "POST",
      body: JSON.stringify({ email: inviteEmail, kind: inviteKind }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      emailed?: boolean;
      acceptLink?: string | null;
    };
    if (!res.ok) {
      setInviteMsg(data.error ?? "Couldn't issue that invite.");
      return;
    }
    setInviteMsg(
      data.emailed
        ? "Invite emailed."
        : "Mail isn't live yet — the invite is queued. Deliver this link yourself:",
    );
    setAcceptLink(data.acceptLink ?? null);
    setInviteEmail("");
  };

  const flip = async (accountId: number) => {
    const res = await authFetch("/auth/testers/flip", {
      method: "POST",
      body: JSON.stringify({ accountId }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setInviteMsg(data.error ?? "Flip failed.");
      return;
    }
    void loadTesters();
  };

  if (!me.account?.isOwner) return null;
  return (
    <div style={{ borderTop: "1px solid #1d2a4a", marginTop: 10, paddingTop: 10 }}>
      <button style={ghostButton} onClick={() => setOpen(!open)}>
        {open ? "Hide owner desk" : "Owner desk — invites & testers"}
      </button>
      {open && (
        <div>
          <form onSubmit={issue}>
            <label style={label}>
              Invite email
              <input style={input} type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} required />
            </label>
            <label style={label}>
              Kind
              <select
                style={input}
                value={inviteKind}
                onChange={(e) => setInviteKind(e.target.value as "tester" | "trial")}
              >
                <option value="tester">Founding Tester (Diamond during test)</option>
                <option value="trial">Trial (Diamond 30 days, then Basic)</option>
              </select>
            </label>
            <button style={button} type="submit">Send invite</button>
          </form>
          {inviteMsg && <p style={{ fontSize: 13, color: "#9fb0d0" }}>{inviteMsg}</p>}
          {acceptLink && (
            <p style={{ fontSize: 12, wordBreak: "break-all", color: "#7dd3fc" }}>{acceptLink}</p>
          )}
          <h3 style={{ fontSize: 15, margin: "18px 0 6px" }}>Founding Testers — 14-day completion</h3>
          {testers === null && <p style={{ fontSize: 13, color: "#9fb0d0" }}>Loading…</p>}
          {testers !== null && testers.length === 0 && (
            <p style={{ fontSize: 13, color: "#9fb0d0" }}>No testers have accepted yet.</p>
          )}
          {testers?.map((t) => (
            <div key={t.accountId} style={{ fontSize: 13, borderTop: "1px solid #16213d", padding: "8px 0" }}>
              <div>{t.email} {t.username ? `(@${t.username})` : ""}</div>
              <div style={{ color: "#9fb0d0" }}>
                Active {t.daysActiveOf14} of 14 days · plan: {t.currentPlan ?? "—"} ·{" "}
                {t.flippedToGoldYear
                  ? "Gold-year flip done"
                  : t.completed
                    ? "Completed — ready for your flip"
                    : t.windowComplete
                      ? "Window closed — didn't reach 10 days"
                      : "In progress"}
              </div>
              {t.completed && !t.flippedToGoldYear && (
                <button style={{ ...ghostButton, marginTop: 4 }} onClick={() => void flip(t.accountId)}>
                  Flip to Gold-year (manual, audited)
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface PasskeyRow {
  id: number;
  deviceLabel: string;
  createdAt: string;
  lastUsedAt: string | null;
}

function PasskeyDesk() {
  const [rows, setRows] = useState<PasskeyRow[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await authFetch("/auth/passkey");
    if (res.ok) {
      const data = (await res.json()) as { passkeys: PasskeyRow[] };
      setRows(data.passkeys);
    } else {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const optRes = await authFetch("/auth/passkey/register/options", {
        method: "POST",
        body: "{}",
      });
      if (!optRes.ok) throw new Error("Couldn't start passkey setup.");
      const options = (await optRes.json()) as RegisterOptionsJson;
      const credential = await createPasskey(options);
      const res = await authFetch("/auth/passkey/register/verify", {
        method: "POST",
        body: JSON.stringify({ credential, deviceLabel: suggestedDeviceLabel() }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Passkey setup didn't finish.");
      setMsg(`${biometricLabel()} is on for this device.`);
      void load();
    } catch (err) {
      if ((err as { name?: string })?.name !== "NotAllowedError") {
        setMsg(err instanceof Error ? err.message : "Passkey setup didn't finish.");
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    await authFetch("/auth/passkey/remove", {
      method: "POST",
      body: JSON.stringify({ id }),
    });
    void load();
  };

  if (!passkeySupported()) return null;
  const label = biometricLabel();
  return (
    <div style={{ borderTop: "1px solid #1d2a4a", marginTop: 10, paddingTop: 10 }}>
      <div style={{ fontSize: 13, color: "#9fb0d0", lineHeight: 1.5 }}>
        Sign in with {label} — a passkey on this device, so you can skip
        the password here. Your face or fingerprint never leaves the
        device; the password always works as a fallback.
      </div>
      {rows === null && (
        <p style={{ fontSize: 13, color: "#9fb0d0" }}>Loading…</p>
      )}
      {rows?.map((r) => (
        <div
          key={r.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 13,
            borderTop: "1px solid #16213d",
            padding: "8px 0",
          }}
        >
          <span style={{ flex: 1 }}>
            {r.deviceLabel || "Passkey"}
            <span style={{ color: "#5b6c92" }}>
              {" "}
              · added {new Date(r.createdAt).toLocaleDateString()}
              {r.lastUsedAt
                ? ` · last used ${new Date(r.lastUsedAt).toLocaleDateString()}`
                : ""}
            </span>
          </span>
          <button
            style={{ ...ghostButton, marginTop: 0 }}
            onClick={() => void remove(r.id)}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        style={{ ...socialButton, marginTop: 10 }}
        disabled={busy}
        onClick={() => void add()}
      >
        {busy ? "Setting up…" : `Add ${label} on this device`}
      </button>
      {msg && <p style={{ fontSize: 13, color: "#9fb0d0" }}>{msg}</p>}
    </div>
  );
}

function AccountBar({ me, refresh }: { me: MeState; refresh: () => void }) {
  const [open, setOpen] = useState(false);
  const signOut = async () => {
    await authFetch("/auth/signout", { method: "POST", body: "{}" });
    refresh();
  };
  return (
    <div
      style={{
        position: "fixed",
        right: 10,
        bottom: 10,
        zIndex: 9999,
        background: "#0b1226ee",
        border: "1px solid #1d2a4a",
        borderRadius: 12,
        padding: "8px 12px",
        color: "#e8ecf4",
        fontFamily: "system-ui, sans-serif",
        maxWidth: "min(400px, calc(100vw - 20px))",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 12, color: "#9fb0d0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {me.account?.email} {me.account?.isOwner ? "· owner" : ""}
        </span>
        <button style={{ ...ghostButton, marginTop: 0 }} onClick={() => setOpen(!open)}>
          Account
        </button>
        <button style={{ ...ghostButton, marginTop: 0 }} onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
      {open && (
        <>
          <OwnerDesk me={me} />
          <PasskeyDesk />
        </>
      )}
    </div>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeState | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await authFetch("/auth/me");
      if (res.ok) {
        setMe((await res.json()) as MeState);
        return;
      }
    } catch {
      // Host without auth routes (shouldn't happen standalone) — don't
      // lock the driver out of the local proof.
    }
    setMe({ signedIn: true, gateEnforced: false, account: null });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (me === null) return null;
  if (!me.gateEnforced) return <>{children}</>;
  if (!me.signedIn) return <SignInScreen onSignedIn={() => void refresh()} />;
  if (me.totpPending) return <TotpScreen onDone={() => void refresh()} />;
  return (
    <>
      {children}
      <AccountBar me={me} refresh={() => void refresh()} />
    </>
  );
}
