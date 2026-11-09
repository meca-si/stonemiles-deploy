# STONEMILES — Final Deploy Runbook

Written 2026-11-09 (America/Chicago) at the Phase 2 merge. The deployable
tree is `stonemiles-deploy/` in this folder (auth + Postgres merged and
proven: combined smoke 48/48 on Postgres 16, chain verified intact —
see MERGE-REPORT.md). This runbook is the exact ordered sequence for
deploy day. Steps marked **[OWNER HANDS]** need the owner's own taps —
nobody else can do them. Every stage lists its rollback; until the DNS
stage, nothing is public and rollback is "stop, nothing happened."

Ground rules carried from the phase reports:

- **Deploy-time data snapshot:** the production data move runs against a
  snapshot of the LIVE data taken on deploy day (step 3.1). The Nov 9
  seeded copy used in the proofs is NOT the production source — records
  sealed after a snapshot are not in it.
- **TomTom key rotation:** the TomTom key value is hard-coded in the
  artifact source (`server/src/tomtom.ts` line 27). In the standalone
  trees it sits behind the `TOMTOM_API_KEY` env var instead. At deploy:
  rotate the key at TomTom, enter the NEW value as `TOMTOM_API_KEY` in
  Render (step 2.3), and never carry the old value forward.
- **Secrets are entered by the owner in the Render dashboard** (every
  secret env var in render.yaml is `sync: false`). No secret value is
  written in this pack, in the repo, or in chat.
- **AUTH_ALLOW_ANONYMOUS_LOCAL must NOT be set** on Render. Unset = the
  session gate is ON (production posture). It exists only for local
  staging proofs.

## Stage 0 — Owner taps before any deploy work

1. **[OWNER HANDS]** Buy `stonervision.io` at Cloudflare Registrar
   (~$40–70/yr), in RUGGS LLC's name.
2. **[OWNER HANDS]** Create the Render account under
   stonervisionteam@gmail.com / RUGGS LLC and add payment.
3. **[OWNER HANDS]** Rotate the TomTom API key in the TomTom console
   (the value goes into Render in step 2.3 — have it ready).

Rollback: none needed; nothing exists yet.

## Stage 1 — Provision (Render)

1. Create the Postgres database from `stonemiles-deploy/render.yaml`
   (Blueprint) or by hand: name `stonemiles-db`, Postgres major **16**,
   plan basic-256mb (estimate).
2. Create the web service from the same blueprint: name `stonemiles`,
   Docker runtime, `./Dockerfile`, health check path `/`,
   `dockerCommand: bun run host/migrate-pg.ts && bun run host/server.ts`
   (already in render.yaml — it applies the drizzle-pg migrations +
   index parity on every boot, then serves; journal-aware, no-op when
   current).
3. Confirm env vars staged from render.yaml: `STONEMILES_DIALECT=postgres`,
   `DATABASE_URL` fromDatabase `stonemiles-db`.

Rollback: delete the service/database. Nothing public yet.

**Blob storage decision (before the closed test carries real user
documents):** the host stores blobs on disk (`data/blobs`), which is
ephemeral on Render — a redeploy wipes uploaded documents. Either attach
a Render persistent disk mounted at the app's `data/` path, or accept
the wipe for the first closed-test build and schedule object storage.
This does not block the deploy proof below; it must be decided before
testers store real paperwork.

## Stage 2 — Secrets (owner, in the Render dashboard)

1. **[OWNER HANDS]** Enter the `sync: false` secrets: `STRIPE_SECRET_KEY`,
   `RESEND_API_KEY`, `DOC_EMAIL_FROM`, `TOMTOM_API_KEY` (the NEW rotated
   value from step 0.3), `INFERENCE_API_KEY`, `AUTH_TOKEN_PEPPER`
   (optional; generate a fresh random value).
2. Confirm the pre-filled values: `STRIPE_CHECKOUT_SUCCESS_URL` /
   `STRIPE_CHECKOUT_CANCEL_URL` point at `https://app.stonervision.io/…`.
3. Double-check `AUTH_ALLOW_ANONYMOUS_LOCAL` is absent.

Rollback: values can be edited/removed at any time; service not public.

## Stage 3 — Production data move (fresh snapshot → transfer)

Run from a checkout of `stonemiles-deploy/` (exact commands; the
transfer tooling is the merged `host/pg/transfer.ts`):

```bash
# 3.1 Snapshot the CURRENT live data WITHOUT touching the originals
#     (copy the WAL trio together; take this on deploy day, not before)
cp data/app.db      /path/to/snapshot.db
cp data/app.db-wal  /path/to/snapshot.db-wal
cp data/app.db-shm  /path/to/snapshot.db-shm
#     also copy the blob store + its index:
cp -r data/blobs          /path/to/blobs
cp    data/blobs-meta.json /path/to/blobs-meta.json

# 3.2 Apply the PG schema to the (empty) production database
DATABASE_URL=<render external connection string> bun run host/migrate-pg.ts

# 3.3 Transfer (aborts if the target is non-empty or any value misfits;
#     the 7 auth tables start empty BY DESIGN — accounts are created by
#     the owner claim in stage 5; profile_id is backfilled to profile 1,
#     mirroring SQLite migration 0108; the one known legacy drop,
#     admin_settings.welcome_credit_stoner, is recorded in the result
#     file host/pg/work/tran
...[truncated 6151 chars]