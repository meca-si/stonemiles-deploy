import { QueryClient } from "@tanstack/react-query";
import type { CSSProperties, HTMLAttributes, ReactElement } from "react";
import type { z, ZodType } from "zod";

/** What a person may do in the Space: read it, run its actions, or edit it. */
export type SpaceRole = "view" | "use" | "edit";
export interface SpacePerson {
    /** The person's Muse ID, stable across visits. Matches `ctx.viewer.museId`. */
    readonly id: string;
    readonly name: string | null;
    readonly role: SpaceRole;
    /** The Space's owner. Matches `ctx.viewer.isOwner` in actions. */
    readonly owner: boolean;
}
export interface SpacePresentPerson extends SpacePerson {
    /** When this visit started, in epoch milliseconds. */
    readonly sinceMs: number;
}
export interface SpaceViewer {
    readonly you: SpacePerson;
    /** The owner, also when they are not here. */
    readonly host: SpacePerson;
    /** Everyone with the Space open now, you included, longest here first. */
    readonly present: readonly SpacePresentPerson[];
}
export type SpaceViewerEvent = {
    readonly type: "join";
    readonly person: SpacePresentPerson;
} | {
    readonly type: "leave";
    readonly person: SpacePresentPerson;
} | {
    readonly type: "change";
    readonly by: string | null;
    readonly atMs: number;
};

export type SafeAreaTopScrimVariant = "gradient" | "blur" | "solid";
export interface SafeAreaTopScrimProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
    variant?: SafeAreaTopScrimVariant;
    backgroundColor?: CSSProperties["backgroundColor"];
    zIndex?: CSSProperties["zIndex"];
}
/**
 * Stub in the standalone shim (the app does not import it): renders
 * nothing. The hosted SDK renders a fixed top safe-area scrim.
 */
export declare function SafeAreaTopScrim(props: SafeAreaTopScrimProps): ReactElement | null;

export declare function bytesToBase64(bytes: Uint8Array): string;
export declare function fileToBase64(file: Blob): Promise<{
    dataBase64: string;
    mimeType: string;
}>;

/**
 * Error thrown by a {@link createActionClient} call when the host
 * returns a non-OK HTTP response. Carries the HTTP `status`, the
 * server's `Retry-After` as `retryAfterMs`, whether the failure is
 * safe to retry, and the server's error `code` when present.
 */
export declare class SpaceActionError extends Error {
    readonly status: number;
    readonly retryAfterMs?: number | undefined;
    readonly retrySafe: boolean;
    readonly code?: string | undefined;
    constructor(message: string, status: number, retryAfterMs?: number | undefined, retrySafe?: boolean, code?: string | undefined);
}
export declare const PERMANENT_ACTION_STATUSES: Set<number>;
/** Retries after the first failure for a retryable action error. */
export declare const MAX_ACTION_RETRIES = 3;
/**
 * Default retry predicate for Space action queries, used by
 * {@link spaceQueryClient}.
 */
export declare function shouldRetryAction(failureCount: number, error: unknown): boolean;
/**
 * Retry delay for Space action queries: exponential backoff with full
 * jitter, honoring the server's `Retry-After` as a floor.
 */
export declare function actionRetryDelay(failureCount: number, error: unknown): number;
/**
 * Shared TanStack Query client for every Space (standalone shim:
 * same defaults as the hosted SDK).
 *
 *   import { spaceQueryClient } from "@hatch/space-sdk/client";
 *   import { QueryClientProvider } from "@tanstack/react-query";
 *
 *   <QueryClientProvider client={spaceQueryClient}>
 *     <App />
 *   </QueryClientProvider>
 */
export declare const spaceQueryClient: QueryClient;
export declare function installAuditSettleProbe(queryClient?: QueryClient): void;
export declare function installSpaceQueryInvalidationListener(queryClient?: QueryClient): void;

/** Extract the request payload type for a given action definition. */
export type ActionRequest<A extends {
    request: ZodType;
}> = z.infer<A["request"]>;
/** Extract the response payload type for a given action definition. */
export type ActionResponse<A extends {
    response: ZodType;
}> = z.infer<A["response"]>;
/**
 * Request shape for an action on a typed action client, by name.
 *
 *     import { api } from "./api";
 *     import type { ApiRequest } from "@hatch/space-sdk/client";
 *     type Filter = ApiRequest<typeof api, "listArticles">;
 */
export type ApiRequest<C extends Record<string, (args: never) => Promise<unknown>>, K extends keyof C> = Parameters<C[K]>[0];
/**
 * Response shape for an action on a typed action client, by name.
 *
 *     import { api } from "./api";
 *     import type { ApiResponse } from "@hatch/space-sdk/client";
 *     type Article = ApiResponse<typeof api, "listArticles">["articles"][number];
 */
export type ApiResponse<C extends Record<string, (args: never) => Promise<unknown>>, K extends keyof C> = Awaited<ReturnType<C[K]>>;
type ClientActionShape = {
    request: ZodType;
    response: ZodType;
};
export type ActionClient<A extends Record<string, ClientActionShape>> = {
    [K in keyof A]: (args: ActionRequest<A[K]>) => Promise<ActionResponse<A[K]>>;
};
interface ClientOptions {
    /** Override the action endpoint (defaults to `./actions` resolved against `location.href`). */
    endpoint?: string;
    /** Inject a custom fetch (mostly for tests). */
    fetch?: typeof globalThis.fetch;
}
export declare function createActionClient<A extends Record<string, ClientActionShape>>(options?: ClientOptions): ActionClient<A>;
/**
 * Who is viewing this Space. Standalone shim: always resolves null —
 * a standalone deployment has no host viewer context.
 */
export declare function getSpaceViewer(): Promise<SpaceViewer | null>;
/**
 * Follow the viewer context. Standalone shim: the listener never
 * fires; returns an unsubscribe no-op.
 */
export declare function subscribeSpaceViewer(listener: (viewer: SpaceViewer | null, event?: SpaceViewerEvent) => void): () => void;
/** React hook form of {@link subscribeSpaceViewer}. Standalone shim: always null. */
export declare function useSpaceViewer(): SpaceViewer | null;
