#!/usr/bin/env bash
# COMBINED smoke proof for the merged STONEMILES tree (Phase 2 merge):
# the Phase 1 host checks + the Phase 2a Postgres checks + the FULL auth
# Phase B suite (session gate, owner claim, invite -> tester, profile +
# scoped-table isolation, reset with session revocation, session
# persistence across restart, D7 TOTP gate) — all against a
# Postgres-backed host. The scoped-enforcement wrapper is re-proved
# here under Postgres by the Phase B isolation checks (B13/B14).
# Self-contained: scratch database (dropped + recreated by this script)
# + scratch blob dir under /tmp, own port, own server processes.
#
#   SMOKE_PG_URL=postgres://postgres@localhost:54400/stonemiles_smoke_pgauth \
#     bun run smoke:pg-auth
#
# The database named in SMOKE_PG_URL is DESTROYED and recreated.
set -u
cd "$(dirname "$0")/.."
PORT="${SMOKE_PORT:-8819}"
BASE="http://localhost:${PORT}"
SCRATCH="$(mktemp -d /tmp/stonemiles-smoke-pgauth.XXXXXX)"
export STONEMILES_DIALECT="postgres"
export DATABASE_URL="${SMOKE_PG_URL:-postgres://postgres@localhost:54400/stonemiles_smoke_pgauth}"
export STONEMILES_BLOBS="${SCRATCH}/blobs"
export AUTH_ALLOW_INSECURE_LOCALHOST=1
export PORT
PASS=0; FAIL=0
say()  { echo "[smoke-pg-auth] $*"; }
ok()   { PASS=$((PASS+1)); echo "PASS: $*"; }
bad()  { FAIL=$((FAIL+1)); echo "FAIL: $*"; }
SRVPID=""
cleanup() { if [ -n "${SRVPID}" ]; then kill "${SRVPID}" 2>/dev/null; wait "${SRVPID}" 2>/dev/null; SRVPID=""; fi; }
trap cleanup EXIT

start_server() {
  # $1 = "anon" | "multi"
  if [ "$1" = "anon" ]; then
    AUTH_ALLOW_ANONYMOUS_LOCAL=1 bun run host/server.ts > "${SCRATCH}/server-$1.log" 2>&1 &
  else
    bun run host/server.ts > "${SCRATCH}/server-$1.log" 2>&1 &
  fi
  SRVPID=$!
  for i in $(seq 1 60); do
    if curl -s -m 2 "${BASE}/healthz" > /dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  echo "server did not come up ($1); log:"; cat "${SCRATCH}/server-$1.log"; return 1
}

act() { # act <jar|-> <json>
  local jar="$1"; shift
  local payload="$1"; shift
  if [ "$jar" = "-" ]; then
    curl -s -m 10 -X POST "${BASE}/actions" -H 'content-type: application/json' -H 'x-stonemiles-client: 1' -d "$payload"
  else
    curl -s -m 10 -X POST "${BASE}/actions" -H 'content-type: application/json' -H 'x-stonemiles-client: 1' -b "$jar" -c "$jar" -d "$payload"
  fi
}
authpost() { # authpost <jar|-> <path> <json>
  local jar="$1"; shift
  local path_="$1"; shift
  local payload="$1"; shift
  if [ "$jar" = "-" ]; then
    curl -s -m 10 -X POST "${BASE}${path_}" -H 'content-type: application/json' -d "$payload"
  else
    curl -s -m 10 -X POST "${BASE}${path_}" -H 'content-type: application/json' -b "$jar" -c "$jar" -d "$payload"
  fi
}

say "scratch dir: ${SCRATCH}"
say "target db: ${DATABASE_URL}"
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
bun run host/migrate-pg.ts > "${SCRATCH}/migrate.log" 2>&1 && ok "migrations apply clean (drizzle-pg 0000+0001 + index parity incl. ported 0108 indexes)" || { bad "pg migrations failed"; cat "${SCRATCH}/migrate.log"; }

# ===========================================================================
say "--- Phase A: Phase 1 suite (staging-anonymous mode) ---"
start_server anon || exit 1
say "server pid ${SRVPID} on ${BASE}"
grep -q "actions registered: 463" "${SCRATCH}/server-anon.log" && ok "host booted on Postgres with 463 actions" || bad "unexpected action count in boot log"
grep -q "auth: session gate OFF" "${SCRATCH}/server-anon.log" && ok "boot log: staging-anonymous flag honored in Phase A only" || bad "boot log missing auth mode line"

# 1) health
OUT=$(curl -s -m 5 -w "\n%{http_code}" "${BASE}/healthz")
echo "$OUT" | grep -q '"ok":true' && echo "$OUT" | grep -q '200' && ok "GET /healthz -> 200 {ok:true}" || bad "GET /healthz: $OUT"

# 2) client loads: real HTML shell
OUT=$(curl -s -m 5 -w "\n%{http_code}" "${BASE}/")
echo "$OUT" | grep -q '<title>STONEMILES</title>' && echo "$OUT" | grep -q 'data-generated-space-root' && ok "GET / -> 200 real client HTML (title + space root div)" || bad "GET / unexpected body"

# 2b) Play data-safety pages serve without a session
OUT_A=$(curl -s -m 5 -w "\n%{http_code}" "${BASE}/delete-account")
OUT_D=$(curl -s -m 5 -w "\n%{http_code}" "${BASE}/delete-data")
echo "$OUT_A" | grep -q 'Delete your STONEMILES account' && echo "$OUT_A" | grep -q '200' && echo "$OUT_D" | grep -q 'Delete your STONEMILES data' && echo "$OUT_D" | grep -q '200' && ok "GET /delete-account + /delete-data -> 200 (Play data-safety pages)" || bad "deletion pages failed"

# 3) read action on empty profile
OUT=$(act - '{"action":"getProfile","args":{}}')
echo "getProfile (empty): $OUT"
echo "$OUT" | grep -q '"profile":null' && ok "read action getProfile answers {profile:null} on scratch DB" || bad "getProfile read failed"

# 4) write action round-trip
PROFILE='{"action":"saveProfile","args":{"heightFt":6,"heightIn":0,"weightLbs":80000,"lengthFt":70,"mpg":6.5,"dieselPrice":3.99,"tankRangeMi":800,"lovesOff":false,"pilotOff":false,"brandOffs":[],"autoRoute":true,"autoTrip":true,"autoAlerts":true,"autoFuel":true,"autoSeal":true,"priority1":"safety","priority2":"net","priority3":"time","chatName":"Standalone Smoke","hazmat":false,"hazmatClass":null,"companyName":null,"driverCpm":null,"payBasis":"cpm","driverPayPct":null,"trailerType":"dry_van"}}'
OUT=$(act - "$PROFILE")
echo "saveProfile: $OUT"
echo "$OUT" | grep -q '"ok":true' && ok "write action saveProfile -> {ok:true}" || bad "saveProfile failed"
OUT=$(act - '{"action":"getProfile","args":{}}')
echo "getProfile (after save): $OUT"
echo "$OUT" | grep -q '"chatName":"Standalone Smoke"' && ok "read-after-write: profile round-trips with saved chatName" || bad "profile did not round-trip"

# 5) blob round-trip through ctx.blobs + HTTP serving
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

# 6) unknown action is a clean 404, not a crash
CODE=$(curl -s -o /dev/null -m 5 -w "%{http_code}" -X POST "${BASE}/actions" -H 'content-type: application/json' -H 'x-stonemiles-client: 1' -d '{"action":"noSuchAction","args":{}}')
[ "$CODE" = "404" ] && ok "unknown action -> 404 (host stays up)" || bad "unknown action status ${CODE}"

# 7) restart persistence (still anonymous mode)
say "restarting server (anon)..."
cleanup
start_server anon || exit 1
OUT=$(act - '{"action":"getProfile","args":{}}')
echo "getProfile (after restart): $OUT"
echo "$OUT" | grep -q '"chatName":"Standalone Smoke"' && ok "PERSISTENCE: profile survives a server restart (Postgres)" || bad "profile lost across restart"
OUT=$(curl -s -m 5 "${BASE}/blobs/smoke/proof.txt")
[ "$OUT" = "standalone-blob-proof" ] && ok "PERSISTENCE: blob survives a server restart (disk store)" || bad "blob lost across restart"
cleanup

# ===========================================================================
say "--- Phase B: Auth suite (multi-account mode) ---"
start_server multi || exit 1
OWNER_JAR="${SCRATCH}/owner.jar"
TESTER_JAR="${SCRATCH}/tester.jar"
OWNER_PW='owner-smoke-pass-1'
TESTER_PW='tester-smoke-pass-1'
TESTER_PW2='tester-smoke-pass-2'

# B1) unauthenticated non-public action is refused cleanly
CODE=$(curl -s -o "${SCRATCH}/b1.json" -m 5 -w "%{http_code}" -X POST "${BASE}/actions" -H 'content-type: application/json' -H 'x-stonemiles-client: 1' -d '{"action":"getProfile","args":{}}')
[ "$CODE" = "401" ] && grep -q 'signin_required' "${SCRATCH}/b1.json" && ok "gate: unauthenticated getProfile -> 401 signin_required" || bad "gate failed: $CODE $(cat "${SCRATCH}/b1.json")"

# B2) public capability lookup still answers without a session
OUT=$(curl -s -m 5 -X POST "${BASE}/actions" -H 'content-type: application/json' -H 'x-stonemiles-client: 1' -d '{"action":"verifyCode","args":{"code":"SMOKETEST1"}}')
echo "verifyCode (public, unauth): $OUT"
echo "$OUT" | grep -q '"found":false' && ok "gate: public verifyCode answers without a session" || bad "public verifyCode blocked: $OUT"

# B3) arm the owner claim (operator CLI; token printed once, captured here)
bun run host/auth-claim.ts --arm --email owner@smoke.test > "${SCRATCH}/claim.log" 2>&1
CLAIM_TOKEN=$(grep -oE '[A-Za-z0-9_-]{43}' "${SCRATCH}/claim.log" | head -1)
[ -n "$CLAIM_TOKEN" ] && ok "claim CLI armed (token captured from terminal output only)" || { bad "claim arm failed"; cat "${SCRATCH}/claim.log"; }

# B4) claim with wrong email is refused generically
OUT=$(authpost - /auth/claim "{\"token\":\"${CLAIM_TOKEN}\",\"email\":\"wrong@smoke.test\",\"newPassword\":\"${OWNER_PW}\"}")
echo "$OUT" | grep -q "isn't valid" && ok "claim: wrong email -> generic refusal" || bad "claim wrong-email not refused: $OUT"

# B5) claim succeeds, binds profile 1, issues a session
OUT=$(authpost "$OWNER_JAR" /auth/claim "{\"token\":\"${CLAIM_TOKEN}\",\"email\":\"owner@smoke.test\",\"newPassword\":\"${OWNER_PW}\"}")
echo "claim: $OUT"
echo "$OUT" | grep -q '"ok":true' && ok "claim: owner account created + session issued" || bad "claim failed: $OUT"

# B6) claim token is single-use
OUT=$(authpost - /auth/claim "{\"token\":\"${CLAIM_TOKEN}\",\"email\":\"owner@smoke.test\",\"newPassword\":\"${OWNER_PW}\"}")
echo "$OUT" | grep -q "isn't valid" && ok "claim: token cannot be replayed" || bad "claim token replayed: $OUT"

# B7) owner session reads the Phase A profile (profile 1 binding works)
OUT=$(act "$OWNER_JAR" '{"action":"getProfile","args":{}}')
echo "owner getProfile: $OUT"
echo "$OUT" | grep -q '"chatName":"Standalone Smoke"' && ok "claim: owner session sees profile 1's saved data" || bad "owner profile binding failed: $OUT"

# B8) wrong password is rejected with the generic message
OUT=$(authpost - /auth/signin "{\"email\":\"owner@smoke.test\",\"password\":\"wrong-password-1\"}")
echo "$OUT" | grep -q "doesn't match" && ok "signin: wrong password rejected (generic message)" || bad "wrong password not rejected: $OUT"

# B9) unknown email gets the SAME generic message (no enumeration)
OUT=$(authpost - /auth/signin "{\"email\":\"nobody@smoke.test\",\"password\":\"wrong-password-1\"}")
echo "$OUT" | grep -q "doesn't match" && ok "signin: unknown email -> same generic message" || bad "unknown email message differs: $OUT"

# B10) owner issues a tester invite; mail unconfigured -> queued + link for owner
OUT=$(authpost "$OWNER_JAR" /auth/invites '{"email":"tester@smoke.test","kind":"tester"}')
echo "invite: $OUT"
INVITE_TOKEN=$(echo "$OUT" | grep -oE 'token=[A-Za-z0-9_-]{43}' | head -1 | cut -d= -f2)
echo "$OUT" | grep -q '"queued":true' && [ -n "$INVITE_TOKEN" ] && ok "invite: issued, mail honestly QUEUED, accept link returned to owner once" || bad "invite failed: $OUT"

# B11) anonymous invite issuance refused
CODE=$(curl -s -o /dev/null -m 5 -w "%{http_code}" -X POST "${BASE}/auth/invites" -H 'content-type: application/json' -d '{"email":"x@smoke.test","kind":"tester"}')
[ "$CODE" = "403" ] && ok "invite: anonymous issuance refused (403)" || bad "invite issuance not gated: $CODE"

# B12) tester accepts the invite -> account + own profile + session
OUT=$(authpost "$TESTER_JAR" /auth/accept-invite "{\"token\":\"${INVITE_TOKEN}\",\"newPassword\":\"${TESTER_PW}\"}")
echo "accept: $OUT"
echo "$OUT" | grep -q '"ok":true' && ok "invite accept: tester account created with session" || bad "invite accept failed: $OUT"

# B13) tester profile isolation: tester's profile is NOT the owner's
OUT=$(act "$TESTER_JAR" '{"action":"getProfile","args":{}}')
echo "tester getProfile: $OUT"
echo "$OUT" | grep -q 'Standalone Smoke' && bad "LEAK: tester saw owner's profile: $OUT" || { echo "$OUT" | grep -q '"chatName":"Driver"' && ok "isolation: tester gets his OWN fresh default profile (not owner's)" || bad "tester profile unexpected: $OUT"; }

# B14) scoped-table isolation (trips): owner saves a trip; tester can't see it
TRIP='{"action":"saveTrip","args":{"startedAt":"2026-11-09T10:00:00Z","endedAt":"2026-11-09T12:00:00Z","totalMiles":120,"states":[],"destination":"Owner Town","sessionId":null}}'
OUT=$(act "$OWNER_JAR" "$TRIP")
echo "owner saveTrip: $OUT"
echo "$OUT" | grep -q '"id":' && ok "owner saveTrip ok" || bad "owner saveTrip failed: $OUT"
OUT=$(act "$TESTER_JAR" '{"action":"listTrips","args":{"limit":30}}')
echo "tester listTrips: $OUT"
echo "$OUT" | grep -q 'Owner Town' && bad "LEAK: tester can see owner's trip" || ok "isolation: owner's trip invisible to tester (scoped table)"
OUT=$(act "$OWNER_JAR" '{"action":"listTrips","args":{"limit":30}}')
echo "$OUT" | grep -q 'Owner Town' && ok "owner still sees own trip" || bad "owner lost own trip: $OUT"

# B15) owner-visible tester list (D4) answers for the owner only
OUT=$(curl -s -m 5 "${BASE}/auth/testers" -b "$OWNER_JAR")
echo "testers (owner): $OUT"
echo "$OUT" | grep -q 'tester@smoke.test' && ok "D4: owner tester list shows the accepted tester" || bad "tester list failed: $OUT"
CODE=$(curl -s -o /dev/null -m 5 -w "%{http_code}" "${BASE}/auth/testers" -b "$TESTER_JAR")
[ "$CODE" = "403" ] && ok "D4: tester list refused for non-owner (403)" || bad "tester list not owner-gated: $CODE"

# B16) password reset flow: request -> token from queued mail row -> reset
OUT=$(authpost - /auth/request-reset '{"email":"tester@smoke.test"}')
echo "request-reset: $OUT"
RESET_TOKEN=$(bun -e '
import("./host/ctx.ts").then(async (m) => {
  const { eq, desc } = await import("drizzle-orm");
  const s = await import("./server/src/schema.ts");
  const db = m.getDb();
  const rows = await db.select().from(s.authMailQueue).where(eq(s.authMailQueue.kind, "reset")).orderBy(desc(s.authMailQueue.id)).limit(1);
  console.log(rows[0]?.linkToken ?? "");
});' 2>/dev/null | tail -1)
[ -n "$RESET_TOKEN" ] && ok "reset: link token recorded in queued mail (D1)" || bad "reset: no queued token found"
OUT=$(authpost - /auth/reset "{\"token\":\"${RESET_TOKEN}\",\"newPassword\":\"${TESTER_PW2}\"}")
echo "reset: $OUT"
echo "$OUT" | grep -q '"ok":true' && ok "reset: password reset completes" || bad "reset failed: $OUT"

# B17) reset revoked the tester's old session
CODE=$(curl -s -o /dev/null -m 5 -w "%{http_code}" -X POST "${BASE}/actions" -H 'content-type: application/json' -H 'x-stonemiles-client: 1' -b "$TESTER_JAR" -d '{"action":"getProfile","args":{}}')
[ "$CODE" = "401" ] && ok "reset: old tester session revoked" || bad "reset did not revoke old session: $CODE"

# B18) old password dead, new password signs in
OUT=$(authpost - /auth/signin "{\"email\":\"tester@smoke.test\",\"password\":\"${TESTER_PW}\"}")
echo "$OUT" | grep -q "doesn't match" && ok "reset: old password no longer works" || bad "old password still works: $OUT"
OUT=$(authpost "$TESTER_JAR" /auth/signin "{\"email\":\"tester@smoke.test\",\"password\":\"${TESTER_PW2}\"}")
echo "tester signin (new pw): $OUT"
echo "$OUT" | grep -q '"ok":true' && ok "reset: new password signs in" || bad "new password signin failed: $OUT"

# B19) session persists across a server restart
say "restarting server (multi)..."
cleanup
start_server multi || exit 1
OUT=$(curl -s -m 5 "${BASE}/auth/me" -b "$TESTER_JAR")
echo "me after restart: $OUT"
echo "$OUT" | grep -q '"signedIn":true' && ok "PERSISTENCE: tester session survives a server restart" || bad "session lost across restart: $OUT"
OUT=$(act "$TESTER_JAR" '{"action":"getProfile","args":{}}')
echo "$OUT" | grep -q '"chatName":"Driver"' && ok "PERSISTENCE: tester actions answer after restart (own profile)" || bad "post-restart action failed: $OUT"

# B20) D7 TOTP gate: owner enables TOTP via the app's own actions, then
#      sign-in pauses at the gate until the code is presented.
OUT=$(act "$OWNER_JAR" '{"action":"beginTotpSetup","args":{}}')
TOTP_SECRET=$(echo "$OUT" | grep -oE 'secret=[A-Z2-7]+' | head -1 | cut -d= -f2)
[ -n "$TOTP_SECRET" ] && ok "totp: owner setup started (secret issued by Security Pack action)" || bad "totp setup failed: $OUT"
cat > "${SCRATCH}/totp.mjs" <<'EOF'
const ALPH = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function b32dec(s) { const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, ""); let bits = 0, val = 0; const out = []; for (const ch of clean) { const idx = ALPH.indexOf(ch); if (idx < 0) continue; val = (val << 5) | idx; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return new Uint8Array(out); }
const secret = b32dec(process.argv[2]);
const key = await crypto.subtle.importKey("raw", secret.buffer.slice(secret.byteOffset, secret.byteOffset + secret.byteLength), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
let c = Math.floor(Date.now() / 30000);
const msg = new Uint8Array(8); for (let i = 7; i >= 0; i--) { msg[i] = c & 0xff; c = Math.floor(c / 256); }
const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg.buffer.slice(0)));
const off = sig[sig.length - 1] & 0x0f;
const bin = ((sig[off] & 0x7f) << 24) | ((sig[off+1] & 0xff) << 16) | ((sig[off+2] & 0xff) << 8) | (sig[off+3] & 0xff);
console.log(String(bin % 1000000).padStart(6, "0"));
EOF
TOTP_CODE=$(bun "${SCRATCH}/totp.mjs" "$TOTP_SECRET")
OUT=$(act "$OWNER_JAR" "{\"action\":\"confirmTotpSetup\",\"args\":{\"code\":\"${TOTP_CODE}\"}}")
echo "confirmTotpSetup: $OUT"
echo "$OUT" | grep -q '"ok":true' && ok "totp: owner TOTP enabled via Security Pack" || bad "totp confirm failed: $OUT"
rm -f "$OWNER_JAR"
OUT=$(authpost "$OWNER_JAR" /auth/signin "{\"email\":\"owner@smoke.test\",\"password\":\"${OWNER_PW}\"}")
echo "owner signin (totp on): $OUT"
echo "$OUT" | grep -q '"totpRequired":true' && ok "D7: owner sign-in pauses at the TOTP gate" || bad "D7 gate did not fire: $OUT"
CODE=$(curl -s -o /dev/null -m 5 -w "%{http_code}" -X POST "${BASE}/actions" -H 'content-type: application/json' -H 'x-stonemiles-client: 1' -b "$OWNER_JAR" -d '{"action":"getProfile","args":{}}')
[ "$CODE" = "401" ] && ok "D7: pending-TOTP session authorizes NO actions" || bad "pending-TOTP session leaked actions: $CODE"
OUT=$(authpost "$OWNER_JAR" /auth/totp '{"totpCode":"000000"}')
echo "$OUT" | grep -q "doesn't match" && ok "D7: wrong code rejected at the gate" || bad "wrong totp code accepted: $OUT"
TOTP_CODE=$(bun "${SCRATCH}/totp.mjs" "$TOTP_SECRET")
OUT=$(authpost "$OWNER_JAR" /auth/totp "{\"totpCode\":\"${TOTP_CODE}\"}")
echo "totp complete: $OUT"
echo "$OUT" | grep -q '"ok":true' && ok "D7: correct code completes the gate" || bad "totp completion failed: $OUT"
OUT=$(act "$OWNER_JAR" '{"action":"getProfile","args":{}}')
echo "$OUT" | grep -q '"chatName":"Standalone Smoke"' && ok "D7: owner actions work after gate completion" || bad "post-gate action failed: $OUT"

# B21) signout revokes the session
OUT=$(authpost "$OWNER_JAR" /auth/signout '{}')
CODE=$(curl -s -o /dev/null -m 5 -w "%{http_code}" -X POST "${BASE}/actions" -H 'content-type: application/json' -H 'x-stonemiles-client: 1' -b "$OWNER_JAR" -d '{"action":"getProfile","args":{}}')
[ "$CODE" = "401" ] && ok "signout: session no longer authorizes actions" || bad "signout did not revoke: $CODE"

# PG) the ported 0108 indexes exist in the scratch database
IDX=$(bun -e '
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const r = await pool.query("SELECT indexname FROM pg_indexes");
const names = new Set(r.rows.map((x) => x.indexname));
const scoped = r.rows.filter((x) => x.indexname.endsWith("_profile_id_idx")).length;
console.log(JSON.stringify({ scoped, owner: names.has("accounts_one_owner_idx"), activity: names.has("auth_activity_account_day_unique") }));
await pool.end();
' 2>/dev/null | tail -1)
echo "pg indexes: $IDX"
echo "$IDX" | grep -q '"scoped":28' && echo "$IDX" | grep -q '"owner":true' && echo "$IDX" | grep -q '"activity":true' && ok "PG: 0108 index port present (28 profile_id indexes + partial owner index + activity-day unique)" || bad "PG index port incomplete: $IDX"
cleanup

echo "[smoke-pg-auth] RESULT: ${PASS} passed, ${FAIL} failed (scratch kept at ${SCRATCH})"
[ "${FAIL}" = "0" ]
