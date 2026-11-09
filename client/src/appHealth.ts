// appHealth.ts — client side of STONEMILES self-reporting
// (owner order 2026-11-05). Pure logic, unit-tested: how a raw
// browser error becomes a report payload, and the session dedupe
// that keeps a looping error from flooding the inbox. The server
// re-sanitizes everything (server/src/appHealth.ts) — this pass
// exists so personal-shaped text never even leaves the device if
// it can be stripped here first.
//
// A report carries: kind, a short title, a sanitized detail, and
// the screen name. NEVER a location, a document, or personal
// data — the sanitizer strips emails, phone numbers, SSN / card
// shapes, and coordinate pairs before anything is sent.

export type ClientReportPayload = {
  kind: "crash" | "error" | "unhandled_rejection" | "action_failed" | "manual";
  title: string;
  detail: string | null;
  screen: string | null;
  manual: boolean;
};

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const CARD_RE = /\b(?:\d[ -]?){13,16}\d\b/g;
const PHONE_RE = /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g;
const COORD_RE = /-?\b\d{1,3}\.\d{4,}\s*,\s*-?\b\d{1,3}\.\d{4,}\b/g;
const SECRET_RE = /\b(seed phrase|private key|password|passwd)\b[^,.;]*/gi;

export function sanitizeClientText(text: string | null | undefined, max = 600): string {
  let s = (text ?? "").replace(/\s+/g, " ").trim();
  s = s.replace(EMAIL_RE, "[email removed]");
  s = s.replace(SSN_RE, "[id removed]");
  s = s.replace(CARD_RE, "[number removed]");
  s = s.replace(PHONE_RE, "[phone removed]");
  s = s.replace(COORD_RE, "[location removed]");
  s = s.replace(SECRET_RE, "[secret removed]");
  return s.slice(0, max);
}

/** First meaningful line of a stack, capped — the stack's top
 *  frame names the failing code path without shipping the whole
 *  trace (or anything the trace might quote). */
export function stackHead(stack: string | null | undefined): string | null {
  if (!stack) return null;
  const lines = stack.split("\n").map((l) => l.trim()).filter(Boolean);
  const head = lines.slice(0, 2).join(" · ");
  return head ? sanitizeClientText(head, 300) : null;
}

/** True for plain connectivity failures ("Failed to fetch" and
 *  friends). Those are NOT app defects, and reporting them is
 *  pointless by construction: the report travels the same dead
 *  connection, so it can only add pressure to a struggling
 *  server and burn the session's report budget. The health
 *  check (which runs when the app can reach its server) is the
 *  layer that notices outages — with real timings, not noise. */
export function isNetworkFailure(error: unknown): boolean {
  const e = error as { message?: unknown; name?: unknown } | null;
  const msg = typeof e?.message === "string" ? e.message : typeof error === "string" ? error : "";
  return /failed to fetch|networkerror|load failed|network request failed/i.test(msg);
}

/** Build the report payload for a caught error. `crash` is for
 *  render-level failures (the error boundary); plain window
 *  errors are `error`; rejected promises are their own kind so
 *  the inbox can tell them apart. */
export function reportFromError(args: {
  error: unknown;
  kind: "crash" | "error" | "unhandled_rejection";
  screen: string | null;
}): ClientReportPayload {
  const e = args.error as { message?: unknown; stack?: unknown } | null;
  const message =
    typeof e?.message === "string" && e.message
      ? e.message
      : typeof args.error === "string"
        ? args.error
        : "Unknown error";
  return {
    kind: args.kind,
    title: sanitizeClientText(message, 200) || "Unknown error",
    detail: stackHead(typeof e?.stack === "string" ? e.stack : null),
    screen: args.screen ? sanitizeClientText(args.screen, 60) : null,
    manual: false,
  };
}

/** Session dedupe: the same payload (kind + title + screen) is
 *  sent at most once per session per key, and the session as a
 *  whole sends at most MAX_SESSION_REPORTS automatic reports —
 *  a failure loop reports its first occurrence and then shuts
 *  up; the server counts further occurrences only when a NEW
 *  session (or a manual report) sends again. */
export const MAX_SESSION_REPORTS = 10;

export function reportKey(p: Pick<ClientReportPayload, "kind" | "title" | "screen">): string {
  return `${p.kind}|${(p.screen ?? "").toLowerCase()}|${p.title.toLowerCase().replace(/\d+/g, "#")}`;
}

export class SessionReportGate {
  private seen = new Set<string>();
  private sent = 0;
  /** True (and records the send) when this payload may go out. */
  allow(p: ClientReportPayload): boolean {
    if (p.manual) return true;
    if (this.sent >= MAX_SESSION_REPORTS) return false;
    const key = reportKey(p);
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    this.sent++;
    return true;
  }
  get sentCount(): number {
    return this.sent;
  }
}
