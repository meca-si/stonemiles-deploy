#!/bin/sh
set -e
bun run host/migrate-pg.ts
exec bun run host/server.bundle.js
