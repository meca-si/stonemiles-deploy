// Standalone HTTP host for STONEMILES (re-platform Phase 1).
//
// Bun.serve app that runs the space's server actions outside the Muse
// runtime:
//   POST /actions     — {action, args, actionCallId} -> {data} | {error}
//   GET  /events      — SSE stream of query invalidations from actions
//   GET  /blobs/<key> — bytes stored through ctx.blobs
//   GET  /healthz     — {ok:true}
//   GET  /*           — client/dist static files with SPA fallback
//
// Actions are imported straight from server/src/actions.ts (Bun runs the
// TypeScript directly; the build:server bundle is not used on this path).
// Privileged calls are transported in-process to the handlers in
// server/src/privileged.ts, bound per action by createPrivilegedExecutor so
// an action can only invoke the contracts it declared.

// Boot guard FIRST: installs process-level logging/handlers and prints a
// boot marker before the rest of the import graph evaluates (see
// host/boot-guard.ts — added after the silent Render boot failures).
import "./boot-guard";
import { createPrivilegedExecutor, isAction } from "@hatch/space-sdk";
import path from "node:path";
import * as actionsModule from "../server/src/actions";
import { privilegedHandlers } from "../server/src/privileged";
import {
  PUBLIC_ACTIONS,
  handleAcceptInvite,
  handleBetaJoinDecide,
  handleBetaJoinList,
  handleBetaJoinSubmit,
  handleClaim,
  handleIssueInvite,
  handleMe,
  handlePasswordChange,
  handleRequestReset,
  handleReset,
  handleSignin,
  handleSignout,
  handleTesterFlip,
  handleTesterList,
  handleTotp,
  resolveSession,
  sessionCookieFromRequest,
} from "./auth";
import {
  BLOBS_DIR,
  STANDALONE_ROOT,
  blobMeta,
  createInvocation,
  describeDb,
  getDb,
  readBlob,
} from "./ctx";
import {
  handleAppleCallback,
  handleAppleStart,
  handleAuthMethods,
  handleGoogleCallback,
  handleGoogleStart,
  handlePasskeyAuthOptions,
  handlePasskeyAuthVerify,
  handlePasskeyList,
  handlePasskeyRegisterOptions,
  handlePasskeyRegisterVerify,
  handlePasskeyRemove,
} from "./social-auth";

/** Staging-anonymous escape hatch (AUTH-DESIGN.md §9 step 2): local
 *  proof only. When set, /actions answers without a session using the
 *  legacy profile-1 identity. NEVER set this on a deployed host. */
const ALLOW_ANONYMOUS =
  process.env.AUTH_ALLOW_ANONYMOUS_LOCAL === "1";

const AUTH_PAGES = new Set(["/auth/reset", "/auth/claim", "/auth/accept"]);

const PORT = Number(process.env.PORT ?? 8787);
const CLIENT_DIST = path.join(STANDALONE_ROOT, "client", "dist");

// ---------------------------------------------------------------------------
// Action dispatch table: scan module exports for branded action definitions.
// The app exports a single `Actions` record; top-level branded exports are
// also picked up if they ever appear.
// ---------------------------------------------------------------------------

type ActionDef = {
  request: { parse: (args: unknown) => unknown };
  response?: { parse: (result: unknown) => unknown };
  privileged?: readonly unknown[];
  handler: (ctx: unknown, args: unknown) => Promise<unknown>;
};

const actionTable = new Map<string, ActionDef>();
for (const exported of Object.values(actionsModule as Record<string, unknown>)) {
  if (isAction(exported)) {
    // Anonymous top-level action export: no name to dispatch by; skip.
    continue;
  }
  if (exported && typeof exported === "object") {
    for (const [name, def] of Object.entries(exported as Record<string, unknown>)) {
      if (isAction(def)) actionTable.set(name, def as ActionDef);
    }
  }
}

// ---------------------------------------------------------------------------
// Privileged transport: contract name -> handler from privileged.ts.
// Handlers read process.env directly, which works natively under Bun.
// ---------------------------------------------------------------------------

const privilegedTransport = async (
  contract: { name: string },
  args: unknown,
): Promise<unknown> => {
  const entry = privilegedHandlers.entries.find(
    (e) => e.contract.name === contract.name,
  );
  if (!entry) {
    throw new Error(`no privileged handler registered for '${contract.name}'`);
  }
  return entry.handler(args as never);
};

// ---------------------------------------------------------------------------
// SSE invalidation broadcast
// ---------------------------------------------------------------------------

const sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();
const sseEncoder = new TextEncoder();

function broadcastInvalidations(
  drained: { invalidateAll: boolean; queryKeys: unknown[][] },
  originActionCallId: unknown,
): void {
  const payload = JSON.stringify({
    type: "invalidate",
    queryKeys: drained.invalidateAll ? null : drained.queryKeys,
    originActionCallId: originActionCallId ?? null,
  });
  const frame = sseEncoder.encode(`data: ${payload}\n\n`);
  for (const controller of [...sseClients]) {
    try {
      controller.enqueue(frame);
    } catch {
      sseClients.delete(controller);
    }
  }
}

// Keepalive so proxies don't reap idle SSE connections.
setInterval(() => {
  const ping = sseEncoder.encode(`: ping\n\n`);
  for (const controller of [...sseClients]) {
    try {
      controller.enqueue(ping);
    } catch {
      sseClients.delete(controller);
    }
  }
}, 25_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// SECURITY (Wave 2 item 12): baseline hardening headers on EVERY
// response the host sends — app shell, static assets, public pages
// (track / apply / receive), auth pages, action JSON, records
// downloads, and blobs alike. Before this pass the host sent none.
// frame-ancestors + X-Frame-Options keep the app out of foreign
// frames while its own same-origin document frames keep working;
// object-src / base-uri close the classic plugin and base hijacks.
// A fuller CSP (script-src / style-src) is deliberately NOT set
// here: the app loads MapLibre tiles and workers and inline boot
// code, so a wrong script-src would break the product — that
// tightening is a proposed change in the item-12 findings report,
// not a silent ship.
const SECURITY_HEADERS: Record<string, string> = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
  "referrer-policy": "same-origin",
  "content-security-policy": "frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
};

function withSecurityHeaders(res: Response): Response {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!res.headers.has(name)) res.headers.set(name, value);
  }
  return res;
}

/** SECURITY (Wave 2 item 12): a thrown error's message can carry
 *  internals — SQL text, table/column names, constraint detail,
 *  file paths, env names, stack fragments. Designed refusals are
 *  RETURNED as { ok: false } results, never thrown, so whatever
 *  reaches a catch is an unexpected failure: pass through only
 *  short, plainly human messages (a few designed guards do throw,
 *  e.g. the owner-only factory-reset refusal), and replace anything
 *  that smells like internals with a generic line. The full error
 *  is always logged server-side at the catch site. */
const INTERNAL_ERROR_PATTERNS: RegExp[] = [
  /\bselect\b[\s\S]*\bfrom\b|\binsert into\b|\bdelete from\b/i,
  /no such table|no such column|unique constraint|foreign key constraint|not null constraint/i,
  /drizzle|sqlite|libsql/i,
  /process\.env|\/home\/|node_modules/,
  /\(.*:\d+:\d+\)/, // a "(file:line:col)" stack fragment
];
const GENERIC_CLIENT_ERROR = "Something went wrong on our side — the details are in the server log.";

function clientSafeErrorMessage(err: unknown): string {
  const msg = errorMessage(err);
  if (msg.length > 200) return GENERIC_CLIENT_ERROR;
  for (const pattern of INTERNAL_ERROR_PATTERNS) {
    if (pattern.test(msg)) return GENERIC_CLIENT_ERROR;
  }
  return msg;
}

/** Readable one-line summary for zod failures (issues array) or any error. */
function validationMessage(err: unknown): string {
  const issues = (err as { issues?: unknown[] })?.issues;
  if (Array.isArray(issues) && issues.length > 0) {
    return issues
      .map((issue) => {
        const i = issue as { path?: unknown[]; message?: string };
        const where = Array.isArray(i.path) && i.path.length > 0 ? i.path.join(".") : "args";
        return `${where}: ${i.message ?? "invalid"}`;
      })
      .join("; ");
  }
  return errorMessage(err);
}

async function handleAction(req: Request): Promise<Response> {
  let body: { action?: unknown; args?: unknown; actionCallId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const actionName = typeof body?.action === "string" ? body.action : null;
  if (!actionName) return json({ error: "missing 'action' name" }, 400);
  const def = actionTable.get(actionName);
  if (!def) return json({ error: `unknown action: ${actionName}` }, 404);

  // ---- Session gate (Auth Phase 2b, AUTH-DESIGN.md §5.3) ---------------
  // Resolution happens at the HOST, before dispatch, so a forgotten gate
  // inside an action cannot leak data. Public capability lookups
  // (PUBLIC_ACTIONS) and the local staging flag are the only ways in
  // without a session. A session paused at the D7 TOTP gate authorizes
  // nothing. Cookie-authenticated calls must carry the app client's
  // custom header (CSRF posture, §8.3).
  const resolved = await resolveSession(
    getDb(),
    sessionCookieFromRequest(req),
  );
  let viewer = resolved?.viewer ?? null;
  if (resolved) {
    if (resolved.viewer.totpPending) {
      return json(
        { error: "Two-factor sign-in isn't finished yet.", code: "totp_required" },
        401,
      );
    }
    if (
      !req.headers.get("x-stonemiles-client") &&
      !req.headers.get("x-request-id")
    ) {
      return json({ error: "missing client header" }, 403);
    }
  } else if (!PUBLIC_ACTIONS.has(actionName) && !ALLOW_ANONYMOUS) {
    return json({ error: "Sign in required.", code: "signin_required" }, 401);
  }
  if (!resolved) viewer = null;

  let parsedArgs: unknown;
  try {
    parsedArgs = def.request.parse(body.args ?? {});
  } catch (err) {
    return json({ error: validationMessage(err) }, 400);
  }

  const executor = createPrivilegedExecutor(
    def.privileged as never,
    privilegedTransport as never,
  );
  const invocation = createInvocation({
    executePrivileged: executor.executePrivileged as (
      contract: unknown,
      args: unknown,
    ) => Promise<unknown>,
    viewer,
  });

  let result: unknown;
  try {
    result = await def.handler(invocation.ctx, parsedArgs);
  } catch (err) {
    console.error(`[actions] ${actionName} threw:`, err);
    // Item 12: the client sees a sanitized message (see
    // clientSafeErrorMessage) — internals stay in this server log.
    return json({ error: clientSafeErrorMessage(err) }, 500);
  }

  // Soft response validation: the real runtime's strictness here is
  // unproven, so a schema mismatch logs a warning and returns the raw
  // result rather than failing a call the handler completed.
  let data = result;
  if (def.response && typeof def.response.parse === "function") {
    try {
      data = def.response.parse(result);
    } catch (err) {
      console.warn(
        `[actions] ${actionName} response failed schema validation (returning raw result):`,
        validationMessage(err),
      );
      data = result;
    }
  }

  const drained = invocation.drainInvalidations();
  if (drained.invalidateAll || drained.queryKeys.length > 0) {
    broadcastInvalidations(drained, body.actionCallId);
  }
  return json({ data });
}

async function serveStatic(pathname: string): Promise<Response | null> {
  const resolved = path.normalize(path.join(CLIENT_DIST, pathname));
  if (resolved !== CLIENT_DIST && !resolved.startsWith(CLIENT_DIST + path.sep)) {
    return null;
  }
  const file = Bun.file(resolved);
  if (await file.exists()) return new Response(file);
  return null;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

/** Every route, factored out of Bun.serve so the fetch entry can
 *  decorate ALL responses with the security headers (item 12). */
async function routeRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    if (pathname === "/healthz") return json({ ok: true });

    // ---- Public Preview demo (2026-11-13): preview.stonervision.io
    // serves ONE static page — the self-contained Preview demo (fake
    // data only, no account, nothing saves). Every GET path on that
    // hostname short-circuits to host/preview.html; there is no API,
    // storage, or server state behind it. app.stonervision.io and
    // every other hostname fall through to the normal routes below,
    // untouched.
    if (req.method === "GET" && url.hostname === "preview.stonervision.io") {
      const page = Bun.file(path.join(STANDALONE_ROOT, "host", "preview.html"));
      if (await page.exists()) {
        return new Response(page, {
          headers: { "content-type": "text/html" },
        });
      }
      return json({ error: "not found" }, 404);
    }

    // ---- Public info pages (Play data-safety form): static deletion
    // instructions, served without a session like the auth pages.
    if (
      req.method === "GET" &&
      (pathname === "/delete-account" ||
        pathname === "/delete-data" ||
        pathname === "/privacy")
    ) {
      const page = Bun.file(
        path.join(STANDALONE_ROOT, "host", `${pathname.slice(1)}.html`),
      );
      if (await page.exists()) {
        return new Response(page, {
          headers: { "content-type": "text/html" },
        });
      }
      return json({ error: "not found" }, 404);
    }

    // ---- Beta join page (2026-11-11): the ONE public join link. The
    // static page posts to POST /auth/beta-requests, which creates a
    // pending request row and nothing else — the owner approves from
    // the Owner desk (D2 stays invite-only). No session.
    if (req.method === "GET" && pathname === "/join") {
      const page = Bun.file(path.join(STANDALONE_ROOT, "host", "join.html"));
      if (await page.exists()) {
        return new Response(page, {
          headers: { "content-type": "text/html" },
        });
      }
      return json({ error: "not found" }, 404);
    }

    // ---- Receive-link pages (2026-11-10): the receiver-facing public
    // pages. /receive/<token> is the action page (confirm delivery);
    // /pod/<token> is the view-only copy page. Both serve the same
    // static shell; the page reads the token from its own path and
    // talks to the PUBLIC_ACTIONS receive actions. No session.
    if (
      req.method === "GET" &&
      (pathname.startsWith("/receive/") || pathname.startsWith("/pod/"))
    ) {
      const page = Bun.file(path.join(STANDALONE_ROOT, "host", "receive.html"));
      if (await page.exists()) {
        return new Response(page, {
          headers: { "content-type": "text/html" },
        });
      }
      return json({ error: "not found" }, 404);
    }

    // ---- Tracking-share page (2026-11-15, TMS queue item 4):
    // /track/<token> is the view-only public page for an outward
    // tracking share — route, stops, ETA, and the truck's location
    // with its freshness; never a rate. It talks to the PUBLIC
    // getTrackInfo action. No session.
    if (req.method === "GET" && pathname.startsWith("/track/")) {
      const page = Bun.file(path.join(STANDALONE_ROOT, "host", "track.html"));
      if (await page.exists()) {
        return new Response(page, {
          headers: { "content-type": "text/html" },
        });
      }
      return json({ error: "not found" }, 404);
    }

    // ---- Recruiting application door (2026-11-15, Wave 2 item
    // 10): /apply/<token> is a fleet's public driver-application
    // page — no account, no session. The page reads the token
    // from its own path and talks to the PUBLIC getApplyInfo /
    // submitDriverApplication actions. It exposes the fleet's
    // name and the form, nothing else.
    if (req.method === "GET" && pathname.startsWith("/apply/")) {
      const page = Bun.file(path.join(STANDALONE_ROOT, "host", "apply.html"));
      if (await page.exists()) {
        return new Response(page, {
          headers: { "content-type": "text/html" },
        });
      }
      return json({ error: "not found" }, 404);
    }

    // ---- Auth routes (Phase 2b): host routes, not actions — they run
    // before a session exists and set the session cookie themselves.
    if (pathname.startsWith("/auth/")) {
      if (req.method === "GET" && AUTH_PAGES.has(pathname)) {
        const page = Bun.file(path.join(STANDALONE_ROOT, "host", "auth.html"));
        if (await page.exists()) {
          return new Response(page, { headers: { "content-type": "text/html" } });
        }
        return json({ error: "not found" }, 404);
      }
      if (req.method === "GET" && pathname === "/auth/me") return handleMe(req);
      if (req.method === "GET" && pathname === "/auth/testers") return handleTesterList(req);
      if (req.method === "GET" && pathname === "/auth/beta-requests") return handleBetaJoinList(req);
      // Social sign-in + passkeys (host/social-auth.ts): the OAuth
      // starts/callbacks are browser navigations (GET; Apple's
      // callback also arrives as a form POST), the passkey ceremonies
      // are JSON POSTs, and /auth/methods reports which doors the
      // host env has switched on.
      if (req.method === "GET" && pathname === "/auth/methods") return handleAuthMethods();
      if (req.method === "GET" && pathname === "/auth/google/start") return handleGoogleStart(req);
      if (req.method === "GET" && pathname === "/auth/google/callback") return handleGoogleCallback(req);
      if (req.method === "GET" && pathname === "/auth/apple/start") return handleAppleStart(req);
      if (pathname === "/auth/apple/callback" && (req.method === "GET" || req.method === "POST")) return handleAppleCallback(req);
      if (req.method === "GET" && pathname === "/auth/passkey") return handlePasskeyList(req);
      if (req.method !== "POST") return json({ error: "POST required" }, 405);
      switch (pathname) {
        case "/auth/signin": return handleSignin(req);
        case "/auth/totp": return handleTotp(req);
        case "/auth/signout": return handleSignout(req);
        case "/auth/request-reset": return handleRequestReset(req);
        case "/auth/reset": return handleReset(req);
        case "/auth/claim": return handleClaim(req);
        case "/auth/accept-invite": return handleAcceptInvite(req);
        case "/auth/invites": return handleIssueInvite(req);
        case "/auth/testers/flip": return handleTesterFlip(req);
        case "/auth/beta-requests": return handleBetaJoinSubmit(req);
        case "/auth/beta-requests/decide": return handleBetaJoinDecide(req);
        case "/auth/password": return handlePasswordChange(req);
        case "/auth/passkey/register/options": return handlePasskeyRegisterOptions(req);
        case "/auth/passkey/register/verify": return handlePasskeyRegisterVerify(req);
        case "/auth/passkey/remove": return handlePasskeyRemove(req);
        case "/auth/passkey/auth/options": return handlePasskeyAuthOptions(req);
        case "/auth/passkey/auth/verify": return handlePasskeyAuthVerify(req);
        default: return json({ error: "not found" }, 404);
      }
    }

    if (pathname === "/actions") {
      if (req.method !== "POST") return json({ error: "POST required" }, 405);
      return handleAction(req);
    }

    if (pathname === "/events") {
      if (req.method !== "GET") return json({ error: "GET required" }, 405);
      // Invalidation keys are low-sensitivity, but in multi-account mode
      // the stream still requires a live session (or the staging flag).
      if (!ALLOW_ANONYMOUS) {
        const resolvedEvents = await resolveSession(
          getDb(),
          sessionCookieFromRequest(req),
        );
        if (!resolvedEvents || resolvedEvents.viewer.totpPending) {
          return json({ error: "Sign in required.", code: "signin_required" }, 401);
        }
      }
      let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controllerRef = controller;
          sseClients.add(controller);
          controller.enqueue(sseEncoder.encode(`: connected\n\n`));
        },
        cancel() {
          if (controllerRef) sseClients.delete(controllerRef);
        },
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      });
    }

    if (pathname.startsWith("/blobs/")) {
      if (req.method !== "GET") return json({ error: "GET required" }, 405);
      const key = decodeURIComponent(pathname.slice("/blobs/".length));
      try {
        // SECURITY (Wave 2 item 12): this route previously served
        // EVERY blob to ANYONE who had or could guess the key, with
        // the uploader-claimed content type and no disposition
        // discipline — while the storage layer records every blob
        // PRIVATE (nothing in the app ever puts with public: true).
        // Pay stubs, company W-9s, vault documents, and broker docs
        // were all world-readable by key, and an HTML/SVG upload was
        // a stored-XSS page on the app origin. Now:
        //   - visibility is enforced: a public blob serves openly;
        //     a private blob (or a key with no metadata record —
        //     fail closed) requires a signed-in session. The app's
        //     own blob consumers are all signed-in same-origin
        //     loads, so legitimate viewing is unchanged; an
        //     anonymous request learns nothing, not even whether
        //     the key exists (same 404 as a missing blob).
        //   - content discipline: only raster images and PDF may
        //     render inline (the app's photo/document viewing);
        //     everything else — HTML and SVG included — downloads
        //     as an attachment, and a sandbox CSP rides along so a
        //     stored document can never execute as this origin.
        const meta = blobMeta(key);
        const isPublic = meta?.visibility === "public";
        // ALLOW_ANONYMOUS is the local staging flag (the session
        // gate is off entirely in that mode — same rule as /actions).
        if (!isPublic && !ALLOW_ANONYMOUS) {
          const resolvedBlobSession = await resolveSession(
            getDb(),
            sessionCookieFromRequest(req),
          );
          // A session paused at the TOTP gate authorizes nothing —
          // the same rule the /actions gate enforces.
          if (!resolvedBlobSession || resolvedBlobSession.viewer.totpPending) {
            return json({ error: "blob not found" }, 404);
          }
        }
        const blob = await readBlob(key);
        if (!blob) return json({ error: "blob not found" }, 404);
        const INLINE_TYPES = new Set([
          "image/jpeg",
          "image/png",
          "image/webp",
          "image/gif",
          "image/avif",
          "application/pdf",
        ]);
        const baseName = key.split("/").pop() ?? "file";
        const safeName = baseName.replace(/[^A-Za-z0-9._-]+/g, "_");
        const disposition = INLINE_TYPES.has(blob.contentType)
          ? `inline; filename="${safeName}"`
          : `attachment; filename="${safeName}"`;
        return new Response(blob.bytes as BodyInit, {
          headers: {
            "content-type": blob.contentType,
            "content-length": String(blob.bytes.byteLength),
            "content-disposition": disposition,
            "content-security-policy": "default-src 'none'; sandbox",
          },
        });
      } catch (err) {
        return json({ error: clientSafeErrorMessage(err) }, 400);
      }
    }

    if (req.method === "GET" || req.method === "HEAD") {
      const staticResponse = await serveStatic(pathname);
      if (staticResponse) return staticResponse;
      // SPA fallback (only once the client has been built).
      const index = Bun.file(path.join(CLIENT_DIST, "index.html"));
      if (await index.exists()) {
        return new Response(index, { headers: { "content-type": "text/html" } });
      }
      return json({ error: "not found" }, 404);
    }

    return json({ error: "not found" }, 404);
}


let server: ReturnType<typeof Bun.serve>;
try {
server = Bun.serve({
  port: PORT,
  async fetch(req) {
    return withSecurityHeaders(await routeRequest(req));
  },
});
} catch (err) {
  // Never die silently at boot: name the failure, then exit non-zero.
  console.error("[stonemiles-host] FATAL: Bun.serve failed to start:", err);
  process.exit(1);
}

console.log(`[stonemiles-host] listening on http://localhost:${server.port}`);
console.log(`[stonemiles-host] actions registered: ${actionTable.size}`);
console.log(
  `[stonemiles-host] auth: session gate ${ALLOW_ANONYMOUS ? "OFF (staging-anonymous local flag set)" : "ON (multi-account)"}`,
);
console.log(`[stonemiles-host] db: ${describeDb()}`);
console.log(`[stonemiles-host] blobs: ${BLOBS_DIR}`);
console.log(
  `[stonemiles-host] client dist: ${CLIENT_DIST} (${(await Bun.file(path.join(CLIENT_DIST, "index.html")).exists()) ? "present" : "not built yet — static/SPA routes will 404"})`,
);
