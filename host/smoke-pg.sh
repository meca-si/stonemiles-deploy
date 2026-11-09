#!/usr/bin/env bash
# Phase 2a smoke proof for the standalone STONEMILES host on POSTGRES.
# Mirror of host/smoke.sh, but the server runs with
# STONEMILES_DIALECT=postgres against a scratch database that this
# script drops, recreates, and migrates itself. Scratch blobs under
# /tmp; own port; own server processes (started and stopped here).
#
#   SMOKE_PG_URL=postgres://postgres@localhost:54399/stonemiles_smoke \
#     bun run smoke:pg
#
# The database named in SMOKE_PG_URL is DESTROYED and recreated.
set -u
cd "$(dirname "$0")/.."
PORT="${SMOKE_PORT:-8809}"
BASE="http://localhost:${PORT}"
SCRATCH="$(mktemp -d /tmp/stonemiles-smoke-pg.XXXXXX)"
export STONEMILES_DIALECT="postgres"
export DATABASE_URL="${SMOKE_PG_URL:-postgres://postgres@localhost:54399/stonemiles_smoke}"
export STONEMILES_BLOBS="${SCRATCH}/blobs"
export PORT
PASS=0; FAIL=0
say()  { echo "[smoke-pg] $*"; }
ok()   { PASS=$((PASS+1)); echo "PASS: $*"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL: $*"; }
SRVPID=""
cleanup() { if [ -n "${SRVPID}" ]; then kill "${SRVPID}" 2>/dev/null; wait "${SRVPID}" 2>/dev/null; SRVPID=""; fi; }
trap cleanup EXIT

start_server() {
  bun run host/server.ts > "${SCRATCH}/server.log" 2>&1 &
  SRVPID=$!
  for i in $(seq 1 60); do
    if curl -s -m 2 "${BASE}/healthz" > /dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  echo "server did not come up; log:"; cat "${SCRATCH}/server.log"; return 1
}

say "scratch dir: ${SCRATCH}"
say "target db: ${DATABASE_URL}"

# 0) fresh scratch database (drop + recreate via the maintenance db)
bun -e '
import pg from "pg";
const url = new URL(process.env.DATABASE_URL);
const dbName = url.pathname.slice(1);
url.pathname = "/postgres";
const pool = new pg.Pool({ connectionString: url.toString() });
await pool.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
await pool.query(`CREATE DATABASE "${dbName}"`);
await pool.end();
console.log("recreated", dbName);
' > "${SCRATCH}/createdb.log" 2>&1 && ok "scratch Postgres database recreated" || { bad "could not recreate scratch db"; cat "${SCRATCH}/createdb.log"; }

# 1) migrations (drizzle-pg set + index parity)
bun run host/migrate-pg.ts > "${SCRATCH}/migrate.log" 2>&1 && ok "migrations apply clean (drizzle-orm/node-postgres/migrator over drizzle-pg/*.sql + index parity)" || { bad "pg migrations failed"; cat "${SCRATCH}/migrate.log"; }

start_server || exit 1
say "server pid ${SRVPID} on ${BASE}"
grep -q "actions registered: 463" "${SCRATCH}/server.log" && ok "host booted on Postgres with 463 actions" || bad "unexpected action count in boot log"

# 2) health
OUT=$(curl -s -m 5 -w "\n%{http_code}" "${BASE}/healthz")
echo "$OUT" | grep -q '"ok":true' && echo "$OUT" | grep -q '200' && ok "GET /healthz -> 200 {ok:true}" || bad "GET /healthz: $OUT"

# 3) client loads: real HTML shell
OUT=$(curl -s -m 5 -w "\n%{http_code}" "${BASE}/")
echo "$OUT" | grep -q '<title>STONEMILES</title>' && echo "$OUT" | grep -q 'data-generated-space-root' && ok "GET / -> 200 real client HTML (title + space root div)" || bad "GET / unexpected body"

# 4) read action on empty profile
OUT=$(curl -s -m 10 -X POST "${BASE}/actions" -H 'content-type: application/json' -d '{"action":"getProfile","args":{}}')
echo "getProfile (empty): $OUT"
echo "$OUT" | grep -q '"profile":null' && ok "read action getProfile answers {profile:null} on scratch PG db" || bad "getProfile read failed"

# 5) write action round-trip
PROFILE='{"action":"saveProfile","args":{"heightFt":6,"heightIn":0,"weightLbs":80000,"lengthFt":70,"mpg":6.5,"dieselPrice":3.99,"tankRangeMi":800,"lovesOff":false,"pilotOff":false,"brandOffs":[],"autoRoute":true,"autoTrip":true,"autoAlerts":true,"autoFuel":true,"autoSeal":true,"priority1":"safety","priority2":"net","priority3":"time","chatName":"Standalone Smoke PG","hazmat":false,"hazmatClass":null,"companyName":null,"driverCpm":null,"payBasis":"cpm","driverPayPct":null,"trailerType":"dry_van"}}'
OUT=$(curl -s -m 10 -X POST "${BASE}/actions" -H 'content-type: application/json' -d "$PROFILE")
echo "saveProfile: $OUT"
echo "$OUT" | grep -q '"ok":true' && ok "write action saveProfile -> {ok:true} (Postgres)" || bad "saveProfile failed"
OUT=$(curl -s -m 10 -X POST "${BASE}/actions" -H 'content-type: application/json' -d '{"action":"getProfile","args":{}}')
echo "getProfile (after save): $OUT"
echo "$OUT" | grep -q '"chatName":"Standalone Smoke PG"' && ok "read-after-write: profile round-trips with saved chatName" || bad "profile did not round-trip"

# 6) blob round-trip through ctx.blobs + HTTP serving
bun -e '
import("./host/ctx.ts").then(async (m) => {
  await m.blobs.put("smoke/proof.txt", "standalone-blob-proof", { contentType: "text/plain" });
  const url = await m.blobs.getUrl("smoke/proof.txt");
  console.log("blob url:", url);
});' > "${SCRATCH}/blob.log" 2>&1
cat "${SCRATCH}/blob.log"
OUT=$(curl -s -m 5 "${BASE}/blobs/smoke/proof.txt")
echo "GET /blobs/smoke/proof.txt: $OUT"
[ "$OUT" = "standalone-blob-proof" ] && ok "blob put via ctx.blobs serves back over HTTP" || bad "blob round-trip failed"

# 7) unknown action is a clean 404, not a crash
CODE=$(curl -s -o /dev/null -m 5 -w "%{http_code}" -X POST "${BASE}/actions" -H 'content-type: application/json' -d '{"action":"noSuchAction","args":{}}')
[ "$CODE" = "404" ] && ok "unknown action -> 404 (host stays up)" || bad "unknown action status ${CODE}"

# 8) restart persistence (proves data lives in Postgres, not process memory)
say "restarting server..."
cleanup
start_server || exit 1
OUT=$(curl -s -m 10 -X POST "${BASE}/actions" -H 'content-type: application/json' -d '{"action":"getProfile","args":{}}')
echo "getProfile (after restart): $OUT"
echo "$OUT" | grep -q '"chatName":"Standalone Smoke PG"' && ok "PERSISTENCE: profile survives a server restart (Postgres)" || bad "profile lost across restart"
OUT=$(curl -s -m 5 "${BASE}/blobs/smoke/proof.txt")
[ "$OUT" = "standalone-blob-proof" ] && ok "PERSISTENCE: blob survives a server restart (disk store)" || bad "blob lost across restart"

echo "[smoke-pg] RESULT: ${PASS} passed, ${FAIL} failed (scratch kept at ${SCRATCH})"
[ "${FAIL}" = "0" ]
