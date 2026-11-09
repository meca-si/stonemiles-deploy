// Per-invocation ctx for the standalone STONEMILES host (Phase 1 + 2a).
//
// Builds the `ctx` object action handlers receive:
//   ctx.db()                — dialect-selected Drizzle handle (see getDb):
//                             SQLite via drizzle-orm/libsql over
//                             data/app.db (Phase 1 default), or Postgres
//                             via drizzle-orm/node-postgres over
//                             $DATABASE_URL when STONEMILES_DIALECT=postgres
//                             (Phase 2a; schema twin server/src/schema-pg.ts)
//   ctx.blobs               — directory blob store rooted at data/blobs/
//   ctx.invalidateQueries() — records invalidations for the host to broadcast
//   ctx.inference           — fail-soft stub (throws a clear action error)
//   ctx.executePrivileged   — injected by server.ts, bound per action
//   ctx.agent / ctx.tool    — throwing stubs (unused by this app's actions)
//
// Blob layout: bytes live at data/blobs/<key> (key may contain "/"); metadata
// (content type, size, etag, visibility, timestamps) lives in ONE sidecar
// index file, data/blobs-meta.json, mapping key -> metadata. The index is
// kept in memory and persisted atomically (tmp file + rename) on mutation.

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import pg from "pg";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import * as schema from "../server/src/schema";
import * as pgSchema from "../server/src/schema-pg";

/** Absolute path of the standalone root (the directory containing host/). */
export const STANDALONE_ROOT = path.resolve(import.meta.dir, "..");

export const DB_PATH =
  process.env.STONEMILES_DB ?? path.join(STANDALONE_ROOT, "data", "app.db");

export const BLOBS_DIR =
  process.env.STONEMILES_BLOBS ?? path.join(STANDALONE_ROOT, "data", "blobs");

/** Sidecar metadata index for the blob store (sibling of the blobs dir). */
export const BLOBS_META_PATH = `${BLOBS_DIR}-meta.json`;

// ---------------------------------------------------------------------------
// DB (singleton per process; dialect chosen once from the environment)
// ---------------------------------------------------------------------------

/** "postgres" when STONEMILES_DIALECT=postgres, else "sqlite" (Phase 1). */
export const DIALECT: "sqlite" | "postgres" =
  process.env.STONEMILES_DIALECT === "postgres" ? "postgres" : "sqlite";

/** Postgres connection string (only used when DIALECT === "postgres"). */
export const DATABASE_URL = process.env.DATABASE_URL;

type AppDb = ReturnType<typeof drizzle<typeof schema>>;

let dbSingleton: AppDb | null = null;
let pgPool: pg.Pool | null = null;

export function getDb(): AppDb {
  if (!dbSingleton) {
    if (DIALECT === "postgres") {
      if (!DATABASE_URL) {
        throw new Error(
          "STONEMILES_DIALECT=postgres requires DATABASE_URL to be set",
        );
      }
      pgPool = new pg.Pool({ connectionString: DATABASE_URL });
      // The pg handle is structurally the same query surface over the
      // pg-core schema twin; the AppDb type stays pinned to the SQLite
      // twin (see server/src/schema.ts dispatcher note).
      dbSingleton = drizzlePg(pgPool, {
        schema: pgSchema,
      }) as unknown as AppDb;
    } else {
      mkdirSync(path.dirname(DB_PATH), { recursive: true });
      const client = createClient({ url: `file:${DB_PATH}` });
      dbSingleton = drizzle(client, { schema });
    }
  }
  return dbSingleton;
}

/** Human-readable DB description for the host boot log. */
export function describeDb(): string {
  if (DIALECT === "postgres") {
    // Host + db name only — never print credentials from the URL.
    try {
      const u = new URL(DATABASE_URL ?? "");
      return `postgres://${u.host}${u.pathname}`;
    } catch {
      return "postgres (unparseable DATABASE_URL)";
    }
  }
  return DB_PATH;
}

// ---------------------------------------------------------------------------
// Viewer-scoped DB (Auth Phase 2b — AUTH-DESIGN.md §4.4/§5.3)
//
// Tables that carry a `profile_id` column (the private shape-(c) set,
// classified in AUTH-BUILD-REPORT.md) are scoped to the session's profile
// for every query that flows through ctx.db():
//   insert → profile_id stamped from the viewer when the caller didn't
//            set one (explicit values are never overridden);
//   select / update / delete → the executed condition is ANDed with
//            profile_id = viewer. A caller .where() is combined, never
//            replaced; if the caller never calls .where(), the scope
//            condition is injected at execution (the builder's `then`).
// Tables without a profile_id column pass through untouched (shared
// tables stay shared by design; username-keyed tables are scoped by the
// actions' own myUsername() resolution). Joins: the driving table's
// scope is enforced; joined tables are the caller's responsibility.
// Transactions receive the same scoped wrapper.
// ---------------------------------------------------------------------------

export interface ViewerScope {
  profileId: number;
}

function isScopedTable(table: unknown): boolean {
  return (
    table != null &&
    typeof table === "object" &&
    (table as Record<string, unknown>).profileId != null &&
    typeof (table as Record<string, unknown>).profileId === "object"
  );
}

function wrapScopedBuilder(
  builder: unknown,
  table: unknown,
  kind: "select" | "update" | "delete" | "insert",
  profileId: number,
): unknown {
  const target = builder as Record<string, unknown> & {
    where?: (cond: unknown) => unknown;
    then?: unknown;
  };
  const state = { whereApplied: false };
  const scopeCond = () =>
    eq((table as Record<string, never>).profileId, profileId);
  const proxy: unknown = new Proxy(target, {
    get(t, prop, receiver) {
      if (prop === "where" && kind !== "insert") {
        return (cond?: unknown) => {
          state.whereApplied = true;
          const combined = cond ? and(cond as never, scopeCond()) : scopeCond();
          const res = (t.where as (c: unknown) => unknown).call(t, combined);
          return res === t ? receiver : res;
        };
      }
      if (prop === "then" && kind !== "insert") {
        return (onFulfilled: unknown, onRejected: unknown) => {
          if (!state.whereApplied) {
            state.whereApplied = true;
            try {
              (t.where as (c: unknown) => unknown).call(t, scopeCond());
            } catch {
              // Builder already executed/closed — execute as-is.
            }
          }
          const thenFn = t.then as (
            a: unknown,
            b: unknown,
          ) => unknown;
          return thenFn.call(t, onFulfilled, onRejected);
        };
      }
      const val = Reflect.get(t, prop, t);
      if (typeof val === "function") {
        return (...args: unknown[]) => {
          const res = (val as (...a: unknown[]) => unknown).apply(t, args);
          return res === t ? receiver : res;
        };
      }
      return val;
    },
  });
  return proxy;
}

function wrapInsertBuilder(builder: unknown, profileId: number): unknown {
  const target = builder as Record<string, unknown>;
  const proxy: unknown = new Proxy(target, {
    get(t, prop, receiver) {
      if (prop === "values") {
        return (values: unknown) => {
          const stamp = (v: unknown) => {
            if (v && typeof v === "object" && !Array.isArray(v)) {
              const rec = v as Record<string, unknown>;
              if (rec.profileId == null) return { ...rec, profileId };
            }
            return v;
          };
          const stamped = Array.isArray(values) ? values.map(stamp) : stamp(values);
          const res = (t.values as (v: unknown) => unknown).call(t, stamped);
          return res === t ? receiver : res;
        };
      }
      const val = Reflect.get(t, prop, t);
      if (typeof val === "function") {
        return (...args: unknown[]) => {
          const res = (val as (...a: unknown[]) => unknown).apply(t, args);
          return res === t ? receiver : res;
        };
      }
      return val;
    },
  });
  return proxy;
}

export function scopedDb(db: AppDb, profileId: number): AppDb {
  const raw = db as unknown as Record<string, unknown>;
  const proxy = new Proxy(raw, {
    get(t, prop, receiver) {
      if (prop === "insert") {
        return (table: unknown) => {
          const builder = (t.insert as (tb: unknown) => unknown).call(t, table);
          return isScopedTable(table) ? wrapInsertBuilder(builder, profileId) : builder;
        };
      }
      if (prop === "update" || prop === "delete") {
        return (table: unknown) => {
          const builder = (t[prop] as (tb: unknown) => unknown).call(t, table);
          return isScopedTable(table)
            ? wrapScopedBuilder(builder, table, prop, profileId)
            : builder;
        };
      }
      if (prop === "select" || prop === "selectDistinct") {
        return (...args: unknown[]) => {
          const selectBuilder = (t[prop] as (...a: unknown[]) => unknown).apply(t, args);
          const sb = selectBuilder as Record<string, unknown>;
          return new Proxy(sb, {
            get(st, sprop, sreceiver) {
              if (sprop === "from") {
                return (table: unknown) => {
                  const res = (st.from as (tb: unknown) => unknown).call(st, table);
                  return isScopedTable(table)
                    ? wrapScopedBuilder(res, table, "select", profileId)
                    : res;
                };
              }
              const val = Reflect.get(st, sprop, st);
              if (typeof val === "function") {
                return (...a: unknown[]) => {
                  const res = (val as (...x: unknown[]) => unknown).apply(st, a);
                  return res === st ? sreceiver : res;
                };
              }
              return val;
            },
          });
        };
      }
      if (prop === "transaction") {
        return async (cb: (tx: unknown) => Promise<unknown>) =>
          (t.transaction as (fn: unknown) => Promise<unknown>).call(
            t,
            async (tx: unknown) => cb(scopedDb(tx as AppDb, profileId)),
          );
      }
      const val = Reflect.get(t, prop, t);
      if (typeof val === "function") {
        return (...args: unknown[]) => (val as (...a: unknown[]) => unknown).apply(t, args);
      }
      return val;
    },
  });
  return proxy as AppDb;
}

// ---------------------------------------------------------------------------
// Blob store
// ---------------------------------------------------------------------------

export interface BlobMetaRecord {
  contentType: string;
  size: number;
  etag: string;
  visibility: "private" | "public";
  createdAtMs: number;
  updatedAtMs: number;
}

let metaCache: Map<string, BlobMetaRecord> | null = null;

function loadMeta(): Map<string, BlobMetaRecord> {
  if (metaCache) return metaCache;
  metaCache = new Map();
  try {
    if (existsSync(BLOBS_META_PATH)) {
      const raw = JSON.parse(readFileSync(BLOBS_META_PATH, "utf8")) as Record<
        string,
        BlobMetaRecord
      >;
      for (const [key, rec] of Object.entries(raw)) metaCache.set(key, rec);
    }
  } catch (err) {
    console.warn(`[blobs] could not read ${BLOBS_META_PATH}:`, err);
  }
  return metaCache;
}

function persistMeta(): void {
  const meta = loadMeta();
  mkdirSync(path.dirname(BLOBS_META_PATH), { recursive: true });
  const tmp = `${BLOBS_META_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(Object.fromEntries(meta), null, 2));
  renameSync(tmp, BLOBS_META_PATH);
}

/** Reject keys that could escape the blob root. Returns the key unchanged. */
function sanitizeKey(key: string): string {
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("blob key must be a non-empty string");
  }
  if (key.includes("\0") || key.includes("\\")) {
    throw new Error(`invalid blob key: ${JSON.stringify(key)}`);
  }
  const segments = key.split("/");
  if (
    key.startsWith("/") ||
    segments.some((s) => s === ".." || s === "." || s.length === 0)
  ) {
    throw new Error(`invalid blob key: ${JSON.stringify(key)}`);
  }
  return key;
}

function blobFilePath(key: string): string {
  const resolved = path.join(BLOBS_DIR, key);
  const root = path.resolve(BLOBS_DIR);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`invalid blob key: ${JSON.stringify(key)}`);
  }
  return resolved;
}

async function toBytes(
  data: string | ArrayBuffer | ArrayBufferView | Blob,
): Promise<Uint8Array> {
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function toMetadata(key: string, rec: BlobMetaRecord) {
  return {
    key,
    contentType: rec.contentType,
    size: rec.size,
    sizeBytes: rec.size,
    etag: rec.etag,
    visibility: rec.visibility,
    createdAtMs: rec.createdAtMs,
    updatedAtMs: rec.updatedAtMs,
    public: rec.visibility === "public",
  };
}

export const blobs = {
  async put(
    key: string,
    data: string | ArrayBuffer | ArrayBufferView | Blob,
    options?: { contentType?: string; public?: boolean },
  ): Promise<void> {
    sanitizeKey(key);
    const bytes = await toBytes(data);
    const file = blobFilePath(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
    const now = Date.now();
    const meta = loadMeta();
    const prev = meta.get(key);
    meta.set(key, {
      contentType:
        options?.contentType ??
        (data instanceof Blob && data.type ? data.type : "application/octet-stream"),
      size: bytes.byteLength,
      etag: createHash("sha256").update(bytes).digest("hex"),
      visibility: options?.public ? "public" : "private",
      createdAtMs: prev?.createdAtMs ?? now,
      updatedAtMs: now,
    });
    persistMeta();
  },

  async getUrl(key: string): Promise<string> {
    sanitizeKey(key);
    // Host-relative URL; host/server.ts serves GET /blobs/<key>.
    return `/blobs/${key.split("/").map(encodeURIComponent).join("/")}`;
  },

  async delete(key: string): Promise<void> {
    sanitizeKey(key);
    rmSync(blobFilePath(key), { force: true });
    if (loadMeta().delete(key)) persistMeta();
  },

  async head(key: string) {
    sanitizeKey(key);
    const rec = loadMeta().get(key);
    if (!rec || !existsSync(blobFilePath(key))) return null;
    return toMetadata(key, rec);
  },

  async list(prefix?: string) {
    const out = [];
    for (const [key, rec] of loadMeta()) {
      if (prefix && !key.startsWith(prefix)) continue;
      if (!existsSync(blobFilePath(key))) continue;
      out.push(toMetadata(key, rec));
    }
    out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return out;
  },
};

/** Read a stored blob's bytes + content type for the HTTP layer. */
export async function readBlob(
  key: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  sanitizeKey(key);
  const rec = loadMeta().get(key);
  const file = blobFilePath(key);
  if (!existsSync(file)) return null;
  const bytes = new Uint8Array(await readFile(file));
  return { bytes, contentType: rec?.contentType ?? "application/octet-stream" };
}

// ---------------------------------------------------------------------------
// Query invalidation recording
// ---------------------------------------------------------------------------

export interface DrainedInvalidations {
  /** True when any call asked to invalidate everything (no key given). */
  invalidateAll: boolean;
  /** Recorded query keys (empty when invalidateAll). */
  queryKeys: unknown[][];
}

/**
 * Normalize the SDK's invalidateQueries input shapes:
 *   undefined                       -> invalidate all
 *   [ ... ] (a query key array)     -> that one key
 *   { queryKey: [...] }             -> that one key
 *   { queryKeys: [[...], [...]] }   -> those keys
 * Anything else is treated as invalidate-all (fail-open refetch, never a
 * missed invalidation).
 */
export function normalizeInvalidation(input: unknown): {
  all: boolean;
  keys: unknown[][];
} {
  if (input === undefined || input === null) return { all: true, keys: [] };
  if (Array.isArray(input)) return { all: false, keys: [input as unknown[]] };
  if (typeof input === "object") {
    const obj = input as Record<string, unknown>;
    if (Array.isArray(obj.queryKeys)) {
      return { all: false, keys: obj.queryKeys as unknown[][] };
    }
    if (Array.isArray(obj.queryKey)) {
      return { all: false, keys: [obj.queryKey as unknown[]] };
    }
  }
  return { all: true, keys: [] };
}

// ---------------------------------------------------------------------------
// Stubs for ctx members this app never uses
// ---------------------------------------------------------------------------

// Fail-soft inference stub (DEPLOY.md §2.5: "those features must fail
// soft, never crash the action"). No provider is configured in Phase 1,
// so complete() synthesizes the emptiest schema-valid result from the
// caller's Zod schema (booleans false, strings empty, numbers 0, arrays
// empty, objects recursed). Extraction callers read `found: false` and
// degrade to manual entry — exactly their no-result path. If no valid
// shape can be synthesized, it throws a clear InferenceUnavailable error
// for that one action; the host itself never crashes. A real provider
// replaces this in Phase 2 behind INFERENCE_API_KEY.
import { z } from "zod";

function synthFromJsonSchema(js: unknown, fillStrings: boolean): unknown {
  if (!js || typeof js !== "object") return undefined;
  const s = js as Record<string, unknown>;
  if (s.default !== undefined) return s.default;
  if (Array.isArray(s.enum) && s.enum.length > 0) return s.enum[0];
  if (Array.isArray(s.const)) return s.const[0];
  if (s.const !== undefined) return s.const;
  for (const key of ["anyOf", "oneOf"] as const) {
    if (Array.isArray(s[key])) {
      for (const sub of s[key] as unknown[]) {
        const v = synthFromJsonSchema(sub, fillStrings);
        if (v !== undefined) return v;
      }
      return null;
    }
  }
  const type = Array.isArray(s.type) ? (s.type as string[])[0] : (s.type as string | undefined);
  switch (type) {
    case "object": {
      const out: Record<string, unknown> = {};
      const props = (s.properties ?? {}) as Record<string, unknown>;
      for (const [k, v] of Object.entries(props)) {
        const val = synthFromJsonSchema(v, fillStrings);
        if (val !== undefined) out[k] = val;
      }
      return out;
    }
    case "string":
      return fillStrings ? "—" : "";
    case "number":
    case "integer":
      return fillStrings ? 1 : 0;
    case "boolean":
      return false;
    case "array":
      return [];
    case "null":
      return null;
    default:
      if (s.properties) return synthFromJsonSchema({ ...s, type: "object" }, fillStrings);
      return undefined;
  }
}

const inferenceStub = {
  async complete(_prompt: string, options?: { schema?: unknown }): Promise<unknown> {
    const schema = options?.schema as { parse: (v: unknown) => unknown } | undefined;
    if (schema && typeof schema.parse === "function") {
      try {
        const jsonSchema = z.toJSONSchema(schema as never);
        for (const fillStrings of [false, true]) {
          try {
            return schema.parse(synthFromJsonSchema(jsonSchema, fillStrings));
          } catch {
            // try the next synthesis strategy
          }
        }
      } catch {
        // fall through to the explicit error below
      }
    }
    throw new Error(
      "ctx.inference unavailable in standalone host (Phase 1 stub) and no schema-valid empty result could be synthesized",
    );
  },
};

function throwingClient(member: string) {
  const fail = async (): Promise<never> => {
    throw new Error(`ctx.${member} is not available in standalone host`);
  };
  return new Proxy(
    {},
    {
      get(_target, prop) {
        // Keep await/inspection machinery from mistaking this for a thenable.
        if (prop === "then" || typeof prop === "symbol") return undefined;
        return fail;
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Invocation ctx builder
// ---------------------------------------------------------------------------

export interface Invocation {
  ctx: Record<string, unknown>;
  /** Read + clear the invalidations recorded during this invocation. */
  drainInvalidations(): DrainedInvalidations;
}

export function createInvocation(opts: {
  executePrivileged: (
    contract: unknown,
    args: unknown,
  ) => Promise<unknown>;
  /**
   * Auth Phase 2b: the resolved session viewer (host/auth.ts AuthViewer),
   * or null for staging-anonymous mode (local proof only — server.ts
   * refuses anonymous /actions unless AUTH_ALLOW_ANONYMOUS_LOCAL=1).
   * With a viewer, ctx.db() is profile-scoped (scopedDb above) and
   * actions.ts resolves identity from ctx.viewer.
   */
  viewer?: {
    accountId: number;
    profileId: number;
    username: string;
    email: string;
    isOwner: boolean;
    status: string;
    totpPending: boolean;
    hasTeamSeat: boolean;
    sessionId: number;
  } | null;
}): Invocation {
  let invalidateAll = false;
  let queryKeys: unknown[][] = [];
  const viewer = opts.viewer ?? null;

  const ctx = {
    slug: "trucker-gps",
    invocationId: randomUUID(),
    spaceDir: STANDALONE_ROOT,
    db: () => (viewer ? scopedDb(getDb(), viewer.profileId) : getDb()),
    blobs,
    viewer: viewer ?? undefined,
    emit: (_data: unknown): void => {},
    inference: inferenceStub,
    agent: throwingClient("agent"),
    tool: throwingClient("tool"),
    executePrivileged: opts.executePrivileged,
    invalidateQueries(input?: unknown): void {
      const normalized = normalizeInvalidation(input);
      if (normalized.all) {
        invalidateAll = true;
        queryKeys = [];
      } else if (!invalidateAll) {
        queryKeys.push(...normalized.keys);
      }
    },
  };

  return {
    ctx,
    drainInvalidations(): DrainedInvalidations {
      const drained = { invalidateAll, queryKeys };
      invalidateAll = false;
      queryKeys = [];
      return drained;
    },
  };
}
