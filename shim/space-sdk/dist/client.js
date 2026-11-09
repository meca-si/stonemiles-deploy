// Browser-side surface of @hatch/space-sdk — STANDALONE SHIM.
//
// Drop-in replacement for the Muse-hosted SDK client, for the
// STONEMILES standalone re-platform (Phase 1). Implements only the
// surface the app imports from "@hatch/space-sdk/client":
//
//   createActionClient, spaceQueryClient, fileToBase64 (+ bytesToBase64)
//
// plus the SDK's supporting exports (SpaceActionError, retry policy,
// audit settle probe, invalidation listener, viewer stubs,
// SafeAreaTopScrim stub) with semantics mirrored from the real
// dist/client.js (SDK 0.14.0):
//
//   - Actions POST to `./actions` resolved against location.href, body
//     JSON {action, args, actionCallId}, header x-request-id:
//     <actionCallId>; actionCallId is crypto.randomUUID() when
//     available. A successful response's JSON `data` field is the
//     result; a truthy `error` field throws
//     Error(`action <name> error: <error>`). Non-OK responses throw
//     SpaceActionError(message, status, retryAfterMs parsed from the
//     Retry-After header, retrySafe from body.retrySafe === true, code
//     from body.code / body.error.code when present).
//   - spaceQueryClient defaults: retry shouldRetryAction, retryDelay
//     actionRetryDelay, staleTime 30_000, refetchOnWindowFocus false.
//
// Standalone difference — query invalidation: the hosted runtime
// pushes invalidations through a parent-frame postMessage bridge
// ("hatch:space:query-invalidated"), which does not exist standalone.
// The standalone host instead serves GET /events as Server-Sent
// Events; each message is
//   data: {"type":"invalidate","queryKeys":<array|null>,"originActionCallId":<id>}
// with queryKeys null meaning "invalidate everything".
// installSpaceQueryInvalidationListener() (installed at module scope,
// like the real client) opens that EventSource and invalidates
// spaceQueryClient accordingly, skipping messages whose
// originActionCallId is one of this client's own recent action calls
// (the SDK's self-suppression: the caller already gets fresh data
// from its own mutation handling). EventSource reconnects natively
// on error. The hosted-only extras (parent-frame auth refresh,
// space-unavailable latch, viewer presence) have no standalone
// counterpart and are intentionally absent; the viewer accessors are
// inert stubs returning null.

import { QueryClient } from "@tanstack/react-query";

/**
 * Error thrown by a {@link createActionClient} call when the host
 * returns a non-OK HTTP response. Carries the HTTP `status` so retry
 * policy can tell a permanent client error (4xx) apart from retryable
 * backpressure/transient failures, the server's `Retry-After` (when
 * present) as `retryAfterMs` so the backoff honors it, and the
 * server's error `code` (when present) so a page can tell refusals
 * with the same status apart.
 */
export class SpaceActionError extends Error {
    status;
    retryAfterMs;
    retrySafe;
    code;
    constructor(message, status, retryAfterMs, retrySafe = false, code) {
        super(message);
        this.status = status;
        this.retryAfterMs = retryAfterMs;
        this.retrySafe = retrySafe;
        this.code = code;
        this.name = "SpaceActionError";
    }
}

// Actions can write even when invoked by useQuery. A failed connection
// or gateway response cannot prove that the handler did not commit a
// write.
export const PERMANENT_ACTION_STATUSES = new Set([400, 401, 403, 404, 409, 413, 415, 422]);
/** Retries after the first failure for a retryable action error. */
export const MAX_ACTION_RETRIES = 3;
const RETRY_BASE_MS = 1_000;
const RETRY_CAP_MS = 30_000;
/**
 * Default retry predicate for Space action queries, used by
 * {@link spaceQueryClient}. Retry only explicit pre-invocation
 * failures, with bounded backoff. Per-query overrides must preserve
 * this outcome boundary.
 */
export function shouldRetryAction(failureCount, error) {
    if (error instanceof SpaceActionError &&
        PERMANENT_ACTION_STATUSES.has(error.status)) {
        return false;
    }
    return error instanceof SpaceActionError && error.retrySafe && failureCount < MAX_ACTION_RETRIES;
}
/**
 * Retry delay for Space action queries: exponential backoff with full
 * jitter, honoring the server's `Retry-After` (carried on
 * {@link SpaceActionError}) as a floor.
 */
export function actionRetryDelay(failureCount, error) {
    const ceiling = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** failureCount);
    const floor = error instanceof SpaceActionError && error.retryAfterMs != null
        ? Math.min(RETRY_CAP_MS, Math.max(0, error.retryAfterMs))
        : 0;
    // Wait at least as long as the server asked, then add full jitter on top.
    return floor + Math.random() * ceiling;
}

// ---------------------------------------------------------------------------
// File encoding — copied semantics-for-semantics from the real SDK's
// dist/client/file-encoding.js.
// ---------------------------------------------------------------------------

/**
 * Base64-encode raw bytes. Uses the engine's native
 * `Uint8Array.prototype.toBase64` when present; older engines fall
 * back to building the intermediate binary string in bounded 32 KB
 * chunks (small enough to never hit the call-argument limit) and
 * encoding once with `btoa`.
 */
export function bytesToBase64(bytes) {
    const native = bytes;
    if (typeof native.toBase64 === "function") {
        return native.toBase64();
    }
    const chunkSize = 0x8000;
    let binary = "";
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
}
/**
 * Read a browser `File`/`Blob` into the `{ dataBase64, mimeType }`
 * shape the server's inference/blob inputs accept. `mimeType` falls
 * back to "application/octet-stream" when the blob reports no type.
 */
export async function fileToBase64(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return {
        dataBase64: bytesToBase64(bytes),
        mimeType: file.type || "application/octet-stream",
    };
}

// ---------------------------------------------------------------------------
// Shared query client
// ---------------------------------------------------------------------------

/**
 * Shared TanStack Query client, with the real SDK's defaults:
 * conservative retry (explicit pre-invocation failures only), 30s
 * staleTime, no refetch on window focus.
 */
export const spaceQueryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: shouldRetryAction,
            retryDelay: actionRetryDelay,
            staleTime: 30_000,
            refetchOnWindowFocus: false,
        },
    },
});

/**
 * Global the UI audit reads to know when the app has finished
 * loading: window.__hatchAuditSettle() returns the number of
 * in-flight queries + mutations. Introspection only. Installed at
 * module scope, guarded for non-browser environments.
 */
const AUDIT_SETTLE_GLOBAL = "__hatchAuditSettle";
export function installAuditSettleProbe(queryClient = spaceQueryClient) {
    if (typeof window === "undefined")
        return;
    const target = window;
    if (typeof target[AUDIT_SETTLE_GLOBAL] === "function")
        return;
    target[AUDIT_SETTLE_GLOBAL] = () => queryClient.isFetching() + queryClient.isMutating();
}
installAuditSettleProbe();

// ---------------------------------------------------------------------------
// Recent local action calls (invalidation self-suppression)
// ---------------------------------------------------------------------------

const LOCAL_ACTION_CALL_RETENTION_MS = 30_000;
const localActionCalls = new Map();
function rememberLocalActionCall(actionCallId) {
    const startedAtMs = Date.now();
    localActionCalls.set(actionCallId, startedAtMs);
    if (typeof window === "undefined") {
        // No timers outside the browser; keep the map bounded instead.
        if (localActionCalls.size > 512) {
            const cutoff = startedAtMs - LOCAL_ACTION_CALL_RETENTION_MS;
            for (const [id, ts] of localActionCalls) {
                if (ts < cutoff) localActionCalls.delete(id);
            }
        }
        return;
    }
    window.setTimeout(() => {
        if (localActionCalls.get(actionCallId) === startedAtMs) {
            localActionCalls.delete(actionCallId);
        }
    }, LOCAL_ACTION_CALL_RETENTION_MS);
}
function isLocalActionCall(actionCallId) {
    const startedAtMs = localActionCalls.get(actionCallId);
    if (startedAtMs == null) return false;
    if (Date.now() - startedAtMs > LOCAL_ACTION_CALL_RETENTION_MS) {
        localActionCalls.delete(actionCallId);
        return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Endpoint resolution + action client
// ---------------------------------------------------------------------------

function resolveEndpoint(relative) {
    const href = globalThis.location?.href;
    if (typeof href !== "string" || href.length === 0) {
        return relative;
    }
    const base = new URL(href);
    base.hash = "";
    base.search = "";
    return new URL(relative, base).toString();
}

function createActionCallId() {
    if (typeof globalThis.crypto?.randomUUID === "function") {
        return globalThis.crypto.randomUUID();
    }
    return `space-action-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2)}`;
}

// Parse a `Retry-After` response header (delta-seconds or HTTP-date)
// into milliseconds-from-now. Undefined when absent/unparseable.
function parseRetryAfterMs(response) {
    const raw = response.headers.get("retry-after");
    if (raw == null) {
        return undefined;
    }
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) {
        return Math.max(0, seconds * 1000);
    }
    const dateMs = Date.parse(raw);
    if (Number.isFinite(dateMs)) {
        return Math.max(0, dateMs - Date.now());
    }
    return undefined;
}

async function readActionErrorBody(response) {
    const text = await response.text();
    if (text.length === 0) {
        return "";
    }
    try {
        return JSON.parse(text);
    }
    catch {
        return text;
    }
}

function isActionRetrySafe(body) {
    return body !== null && typeof body === "object" && "retrySafe" in body && body.retrySafe === true;
}

const SHOWN_REFUSAL_CODES = new Set([
    "view_only",
    "peer_artifact_view_only",
]);

function actionErrorCode(body) {
    if (body === null || typeof body !== "object") {
        return undefined;
    }
    if ("code" in body && typeof body.code === "string") {
        return body.code;
    }
    const error = "error" in body ? body.error : undefined;
    const nested = error !== null && typeof error === "object" && "code" in error
        ? error.code
        : undefined;
    return typeof nested === "string" ? nested : undefined;
}

/**
 * A shown refusal keeps the server's own sentence; any other failure
 * names the action, status, and body.
 */
function actionFailureMessage(name, failure, status, body) {
    const error = body !== null && typeof body === "object" && "error" in body ? body.error : undefined;
    const code = actionErrorCode(body);
    const message = typeof error === "string" ? error : error?.message;
    if (code !== undefined &&
        SHOWN_REFUSAL_CODES.has(code) &&
        typeof message === "string" &&
        message.length > 0) {
        return message;
    }
    const text = typeof body === "string" ? body : JSON.stringify(body ?? null);
    return `action ${name} ${failure}: ${status} ${text}`;
}

const DEFAULT_ENDPOINT = "./actions";
export function createActionClient(options = {}) {
    const endpoint = options.endpoint ?? resolveEndpoint(DEFAULT_ENDPOINT);
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const callAction = (action, args, actionCallId) => fetchImpl(endpoint, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            // Request correlation: mirrors the real SDK, which sends
            // the actionCallId both in the body and this header.
            "x-request-id": actionCallId,
        },
        body: JSON.stringify({
            action,
            args: args ?? {},
            actionCallId,
        }),
    });
    const readActionData = async (response, name) => {
        const body = (await response.json());
        if (body && typeof body === "object" && "error" in body && body.error) {
            throw new Error(`action ${name} error: ${String(body.error)}`);
        }
        return body?.data;
    };
    return new Proxy({}, {
        get(_target, name) {
            // Symbol keys and promise-protocol names must NOT resolve
            // to a phantom action (an accidental `await client` would
            // otherwise POST to a non-existent action named "then").
            if (typeof name !== "string") {
                return undefined;
            }
            if (name === "then" || name === "catch" || name === "finally") {
                return undefined;
            }
            return async (args) => {
                const actionCallId = createActionCallId();
                rememberLocalActionCall(actionCallId);
                const response = await callAction(name, args, actionCallId);
                if (!response.ok) {
                    const body = await readActionErrorBody(response);
                    throw new SpaceActionError(actionFailureMessage(name, "failed", response.status, body), response.status, parseRetryAfterMs(response), isActionRetrySafe(body), actionErrorCode(body));
                }
                return readActionData(response, name);
            };
        },
    });
}

// ---------------------------------------------------------------------------
// Query invalidation over SSE (standalone replacement for the hosted
// parent-frame postMessage bridge)
// ---------------------------------------------------------------------------

const EVENTS_ENDPOINT = "./events";
let queryInvalidationListenerInstalled = false;
let invalidationEventSource = null;
export function installSpaceQueryInvalidationListener(queryClient = spaceQueryClient) {
    if (queryInvalidationListenerInstalled) {
        return;
    }
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
        return;
    }
    queryInvalidationListenerInstalled = true;
    let source;
    try {
        source = new EventSource(resolveEndpoint(EVENTS_ENDPOINT));
    }
    catch {
        queryInvalidationListenerInstalled = false;
        return;
    }
    invalidationEventSource = source;
    source.addEventListener("message", (event) => {
        let message;
        try {
            message = JSON.parse(event.data);
        }
        catch {
            return;
        }
        if (message === null || typeof message !== "object") {
            return;
        }
        if (message.type != null && message.type !== "invalidate") {
            return;
        }
        const originActionCallId = typeof message.originActionCallId === "string" && message.originActionCallId.length > 0
            ? message.originActionCallId
            : null;
        // Self-suppression: our own action already returned fresh
        // data to this client; the echo would only churn refetches.
        if (originActionCallId != null && isLocalActionCall(originActionCallId)) {
            return;
        }
        const queryKeys = message.queryKeys;
        if (queryKeys == null) {
            void queryClient.invalidateQueries();
            return;
        }
        if (!Array.isArray(queryKeys)) {
            return;
        }
        if (queryKeys.length === 0) {
            void queryClient.invalidateQueries();
            return;
        }
        for (const queryKey of queryKeys) {
            if (Array.isArray(queryKey)) {
                void queryClient.invalidateQueries({ queryKey });
            }
        }
    });
    // No manual reconnect: EventSource retries natively on error.
}
installSpaceQueryInvalidationListener();

// ---------------------------------------------------------------------------
// Viewer context — standalone stubs. There is no Muse host framing a
// standalone deployment, so there is never viewer context: getSpaceViewer
// resolves null, subscribeSpaceViewer never fires (and returns an
// unsubscribe no-op), useSpaceViewer returns null.
// ---------------------------------------------------------------------------

export async function getSpaceViewer() {
    return null;
}
export function subscribeSpaceViewer(_listener) {
    return () => { };
}
export function useSpaceViewer() {
    return null;
}

// ---------------------------------------------------------------------------
// SafeAreaTopScrim — STUB. The app does not import this component; the
// real SDK renders a fixed safe-area scrim div. This stub exists only
// so the export name resolves; it renders nothing.
// ---------------------------------------------------------------------------

export function SafeAreaTopScrim(_props) {
    return null;
}
