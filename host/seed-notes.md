# Seed notes — standalone host data (Phase 1)

Written 2026-11-09 by the server-side re-platform worker.

## Sources (live artifact — READ-ONLY, never modified)

- Live DB: `/home/hatch/workspace/ts-spaces/trucker-gps/app.db`
  - 1,212,416 bytes, WAL-mode SQLite, actively written by the live artifact.
  - Copied with `cp` only. The original was never opened with sqlite,
    migrated, or written to. (A checksum comparison and `cp` are the only
    operations ever run against it; all inspection below ran against
    throwaway copies in /tmp.)
  - The `app.db` files under `ts-spaces/trucker-gps/.harness/probe-ui/…`
    are probe fixtures and were ignored, per the coordinator's note.
- Live blob store: `/home/hatch/workspace/ts-spaces/trucker-gps/blobs/`
  (276 KB total, directory beside app.db).

## What the live data looks like

- app.db: 155 tables. Its `__drizzle_migrations` journal holds exactly
  107 rows = all 107 migrations in this tree's `drizzle/` folder, so the
  live copy is fully migrated against the exported schema.
  Spot counts on a /tmp copy: profile 1 row, app_settings 1 row,
  trips 17 rows, loads 0 rows.
- Because the journal is complete, `bun run host/migrate.ts` against the
  seeded copy is a verified no-op (ran clean, exit 0, against a /tmp copy
  of the live DB). migrate.ts is therefore only a fallback for a fresh /
  absent DB — but it is safe in the `start` script either way.

## Blob store layout (live) → standalone mapping

The live store is content-addressed, NOT key-path storage:

- Bytes: `blobs/objects/<object_id[0:2]>/<object_id>` where `object_id`
  is a sha256 hex string.
- Index: `blobs/index.sqlite`, table `blobs(key TEXT PK, content_type,
  size_bytes, etag, visibility, created_at_ms, updated_at_ms, object_id)`
  mapping each logical key to its object.
- 4 blobs total at seed time.

Standalone layout (host/ctx.ts): bytes at `data/blobs/<key>`, metadata in
the single sidecar index `data/blobs-meta.json`
(key → {contentType, size, etag, visibility, createdAtMs, updatedAtMs}).
Seeding copied each object file to its key path and carried the index
row's metadata across verbatim:

| key | bytes | content type | live object |
| --- | --- | --- | --- |
| `vault/master-key` | 32 | application/octet-stream | objects/03/03a5d2…a9260 |
| `company-docs/1/authority-1792964967213-u3gaug` | 32,843 | application/pdf | objects/cb/cb4df1…fc3f6d |
| `company-docs/1/insurance-1792965064077-hes6oj` | 119,849 | application/pdf | objects/ea/eac053…259916 |
| `company-docs/1/w9-1792965071270-dq11fh` | 104,849 | application/pdf | objects/63/63c1cf…359b |

## Seeded result (this tree)

- `data/app.db` — byte-identical copy of the live DB (md5 verified equal
  at seed time). It is a working scratch copy: proof actions were run
  against it, and two `saveAppSettings` round-trips rewrote the
  app_settings row with identical values (only `updated_at` moved).
  The live original is untouched.
- `data/blobs/` + `data/blobs-meta.json` — the 4 blobs above.
- Verified end-to-end: `getProfile` returns the live profile row,
  `getAppSettings` returns the live settings row, and
  `GET /blobs/company-docs/1/w9-1792965071270-dq11fh` returns
  200 / application/pdf / 104,849 bytes.

## Incident note

During this work a second process was simultaneously active in this tree
(a duplicate worker on the same brief): it overwrote `host/server.ts`
once with a different implementation (boot-time hand-rolled migrations —
crashed on the seeded DB with "table entries already exists") and at
22:33:48 UTC deleted `data/blobs/` and truncated `data/app.db` to 0 bytes
while rebuilding it via the migration fallback (that DB reached 909,312
bytes, schema-only). All seed data was re-copied from the live sources
afterwards and re-verified (md5 + live action reads), so the tree above
reflects the final, verified state. A server from that worker may still
be running on port 8791; the Phase 1 host from this brief runs on 8787.
