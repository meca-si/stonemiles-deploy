// Standalone type surface for @hatch/space-sdk (server side).
// Mirrors the real SDK's server-contract types for exactly the surface the
// STONEMILES server imports: defineAction, z, ActionsModule, Ctx, and the
// privileged-contract helpers used by server/src/privileged.ts.

import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { z } from "zod";
export { z };

/** A loose JSON value used by streaming `ctx.emit` frames. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type SpaceDb<TSchema extends Record<string, unknown> = Record<string, never>> =
  Pick<
    LibSQLDatabase<TSchema>,
    "select" | "insert" | "update" | "delete" | "run" | "all" | "get" | "batch"
  >;

/** Per-invocation typed DB accessor: `ctx.db<typeof schema>()`. */
export type SpaceDbAccessor = <
  TSchema extends Record<string, unknown> = Record<string, never>,
>() => SpaceDb<TSchema>;

export type SpaceRole = "view" | "use" | "edit";
export type LocalViewer = {
  source: "local";
  authenticated: true;
  spaceSlug: string;
  userId: string;
  ownerUserId: string;
  isOwner: boolean;
  delegate?: "agent" | "schedule";
};
export type CloudflareViewer = {
  source: "cloudflare";
  authenticated: true;
  shareId: string;
  spaceSlug: string;
  spaceId?: string;
  isOwner: boolean;
  tokenExpiresAt: number;
  tokenId: string;
};
export type PeerViewer = {
  source: "peer";
  authenticated: true;
  spaceSlug: string;
  museId: string;
  name?: string;
  role: SpaceRole;
  isOwner: false;
};
export type Viewer = LocalViewer | CloudflareViewer | PeerViewer;

// ---------------------------------------------------------------------------
// Blobs
// ---------------------------------------------------------------------------

export type BlobPutData = string | ArrayBuffer | ArrayBufferView | Blob;
export interface BlobPutOptions {
  readonly contentType?: string;
  readonly public?: boolean;
}
export interface BlobUrlOptions {
  readonly expiresInSeconds?: number;
  readonly public?: boolean;
}
export interface BlobMetadata {
  readonly key: string;
  readonly contentType: string;
  readonly size: number;
  readonly sizeBytes: number;
  readonly etag: string;
  readonly visibility: "private" | "public";
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly public: boolean;
}
export interface BlobClient {
  put(key: string, data: BlobPutData, options?: BlobPutOptions): Promise<void>;
  getUrl(key: string, options?: BlobUrlOptions): Promise<string>;
  delete(key: string): Promise<void>;
  head(key: string): Promise<BlobMetadata | null>;
  list(prefix?: string): Promise<BlobMetadata[]>;
}

// ---------------------------------------------------------------------------
// Privileged contracts
// ---------------------------------------------------------------------------

export declare const PRIVILEGED_CONTRACT_BRAND: "@hatch/space-sdk/privileged-contract/v1";
export declare const PRIVILEGED_HANDLERS_FORMAT: "hatch-space-privileged-handlers-v1";

export interface PrivilegedContract<
  Name extends string = string,
  Req extends z.ZodType = z.ZodType,
  Res extends z.ZodType = z.ZodType,
> {
  readonly __brand: typeof PRIVILEGED_CONTRACT_BRAND;
  readonly name: Name;
  readonly request: Req;
  readonly response: Res;
  readonly capabilities?: readonly string[];
  readonly timeoutMs?: number;
}
export type PrivilegedContractSpec<
  Req extends z.ZodType = z.ZodType,
  Res extends z.ZodType = z.ZodType,
> = {
  readonly request: Req;
  readonly response: Res;
  readonly capabilities?: readonly string[];
  readonly timeoutMs?: number;
};
export type PrivilegedContractsFor<Specs extends Record<string, PrivilegedContractSpec>> = {
  readonly [Name in keyof Specs & string]: PrivilegedContract<
    Name,
    Specs[Name]["request"],
    Specs[Name]["response"]
  >;
};
export type PrivilegedRequest<C extends PrivilegedContract> = z.infer<C["request"]>;
export type PrivilegedResponse<C extends PrivilegedContract> = z.infer<C["response"]>;
export interface PrivilegedExecutor {
  executePrivileged<C extends PrivilegedContract>(
    contract: C,
    args: PrivilegedRequest<C>,
  ): Promise<PrivilegedResponse<C>>;
}
export type PrivilegedTransport = <C extends PrivilegedContract>(
  contract: C,
  args: PrivilegedRequest<C>,
) => Promise<unknown>;
export type PrivilegedHandler<C extends PrivilegedContract = PrivilegedContract> = (
  args: PrivilegedRequest<C>,
) => Promise<PrivilegedResponse<C>> | PrivilegedResponse<C>;
export type PrivilegedHandlersFor<Contracts extends Record<string, PrivilegedContract>> = {
  readonly [Name in keyof Contracts]?: PrivilegedHandler<Contracts[Name]>;
};
export interface PrivilegedHandlerEntry<C extends PrivilegedContract = PrivilegedContract> {
  readonly contract: C;
  readonly handler: PrivilegedHandler<C>;
}
export interface PrivilegedHandlers {
  readonly format: typeof PRIVILEGED_HANDLERS_FORMAT;
  readonly entries: readonly PrivilegedHandlerEntry[];
}

export declare function definePrivilegedContracts<
  const Specs extends Record<string, PrivilegedContractSpec>,
>(specs: Specs): PrivilegedContractsFor<Specs>;
export declare function definePrivilegedHandlers<
  const Contracts extends Record<string, PrivilegedContract>,
>(
  contracts: Contracts,
  handlers: PrivilegedHandlersFor<Contracts>,
): PrivilegedHandlers;
export declare function isPrivilegedContract(value: unknown): value is PrivilegedContract;
export declare function isPrivilegedHandlers(value: unknown): value is PrivilegedHandlers;
export declare function createPrivilegedExecutor(
  declared: readonly PrivilegedContract[] | undefined,
  transport: PrivilegedTransport,
): PrivilegedExecutor;

// ---------------------------------------------------------------------------
// Query invalidation
// ---------------------------------------------------------------------------

export type SpaceQueryKey = readonly JsonValue[];
export interface SpaceQueryInvalidation {
  readonly queryKey: SpaceQueryKey;
}
export interface SpaceQueryInvalidationBatch {
  readonly queryKeys: readonly SpaceQueryKey[];
}
export type SpaceQueryInvalidationInput =
  | SpaceQueryKey
  | SpaceQueryInvalidation
  | SpaceQueryInvalidationBatch;

// ---------------------------------------------------------------------------
// Agent / inference / tools (present on Ctx; unused by this app's actions)
// ---------------------------------------------------------------------------

export interface AgentSendOptions {
  readonly expectsAction?: string;
  readonly dedupeKey?: string;
  readonly allowParallel?: boolean;
}
export type AgentSendResult =
  | { ok: true; taskId: string; agentId: string; messageId: string }
  | { ok: false; error: string };
export interface AgentStatusResult {
  readonly taskId: string;
  readonly status: "queued" | "running" | "completed" | "failed" | "not_found";
  readonly returnContractStatus?: "not_expected" | "pending" | "satisfied" | "unsatisfied";
  readonly agentStatus?: string;
  readonly agentId?: string;
  readonly messageId?: string;
  readonly finalResponse?: string;
  readonly statusMessage?: string;
  readonly failureReason?: string;
  readonly expectedAction?: string;
  readonly completedAction?: string;
}
export type AgentTaskOptions = AgentSendOptions;
export type AgentTaskResult = AgentSendResult;
export interface AgentClient {
  spawnTask(message: string, options?: AgentTaskOptions): Promise<AgentTaskResult>;
  send(message: string, options?: AgentSendOptions): Promise<AgentSendResult>;
  status(taskId: string): Promise<AgentStatusResult>;
}

export interface InferenceImageInput {
  readonly dataBase64: string;
  readonly mimeType?: "image/jpeg" | "image/png";
  readonly filename?: string;
  readonly caption?: string;
}
export interface InferenceCompleteOptions<T extends z.ZodType = z.ZodType> {
  readonly schema: T;
  readonly timeout_secs?: number;
  readonly system?: string;
  readonly images?: readonly InferenceImageInput[];
}
export interface InferenceClient {
  complete<T extends z.ZodType>(
    prompt: string,
    options: InferenceCompleteOptions<T>,
  ): Promise<z.infer<T>>;
}

/** Managed-tool surface; this app never calls it. Kept intentionally loose. */
export interface SpaceToolClient {
  readonly [name: string]: (...args: never[]) => Promise<unknown>;
}

export declare const INFERENCE_SCHEMA_ERROR_BRAND: "@hatch/space-sdk/InferenceSchemaError/v1";
export declare class InferenceSchemaError extends Error {
  readonly __brand: typeof INFERENCE_SCHEMA_ERROR_BRAND;
  readonly issues: readonly z.core.$ZodIssue[];
  constructor(issues: readonly z.core.$ZodIssue[]);
  static is(value: unknown): value is InferenceSchemaError;
}

// ---------------------------------------------------------------------------
// Ctx + actions
// ---------------------------------------------------------------------------

/** Runtime-neutral context fields available to portable Space actions. */
export interface PortableCtx extends PrivilegedExecutor {
  readonly slug: string;
  readonly invocationId: string;
  readonly spaceDir: string;
  readonly db: SpaceDbAccessor;
  readonly viewer?: Viewer;
  readonly blobs: BlobClient;
}

/** Per-invocation context passed to every action handler. */
export interface Ctx extends PortableCtx {
  readonly agent: AgentClient;
  readonly inference: InferenceClient;
  readonly tool: SpaceToolClient;
  emit(data: JsonValue): void;
  invalidateQueries(invalidation?: SpaceQueryInvalidationInput): void;
}

export declare const ACTION_BRAND: "@hatch/space-sdk/action/v1";

export interface ActionDefinition<
  TCtx extends PortableCtx = PortableCtx,
  Req extends z.ZodType = z.ZodType,
  Res extends z.ZodType = z.ZodType,
> {
  readonly __brand: typeof ACTION_BRAND;
  readonly request: Req;
  readonly response: Res;
  readonly description?: string;
  readonly privileged?: readonly PrivilegedContract[];
  readonly handler: (ctx: TCtx, args: z.infer<Req>) => Promise<z.infer<Res>>;
}
export type ActionFactoryInput<
  TCtx extends PortableCtx,
  Req extends z.ZodType,
  Res extends z.ZodType,
> = {
  request: Req;
  response: Res;
  description?: string;
  privileged?: readonly PrivilegedContract[];
  handler: (ctx: TCtx, args: z.infer<Req>) => Promise<z.infer<Res>>;
};

export declare function actionDescription(
  definition: Pick<ActionDefinition, "description">,
): string | undefined;
export declare function isAction(value: unknown): value is ActionDefinition;
export declare const defineAction: <Req extends z.ZodType, Res extends z.ZodType>(
  spec: ActionFactoryInput<Ctx, Req, Res>,
) => ActionDefinition<Ctx, Req, Res>;

export type ActionsModuleFor<TCtx extends PortableCtx> = Record<
  string,
  Omit<ActionDefinition<TCtx>, "handler"> & {
    handler: (ctx: TCtx, args: any) => Promise<any>;
  }
>;
export type ActionsModule = ActionsModuleFor<Ctx>;

export type ActionRequest<A extends { request: z.ZodType }> = z.infer<A["request"]>;
export type ActionResponse<A extends { response: z.ZodType }> = z.infer<A["response"]>;
