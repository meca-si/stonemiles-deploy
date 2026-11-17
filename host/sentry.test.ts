// sentry.test.ts — coverage for the STONEMILES SENTRY attack
// shield (2026-11-17):
//
//   Part A (pure, in-process): the signature inspector and the
//   strike/block bookkeeping — SQLi / XSS / traversal / scanner
//   shapes trip; ordinary app traffic never does; three strikes
//   in the window blocks; repeat blocks double up to the 24h cap.
//
//   Part B (the real server, spawned on a test port): a canary
//   path answers a boring 404; scanner probes from one IP earn a
//   block that then refuses even /healthz; other IPs and header-
//   less local traffic are unaffected.
//
// Hermetic: STONEMILES_DB / STONEMILES_BLOBS point into a temp dir
// before host/ctx is imported (the security-hardening pattern).

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "sm-sentry-"));
process.env.STONEMILES_DB = path.join(dir, "test.db");
process.env.STONEMILES_BLOBS = path.join(dir, "blobs");
delete process.env.STONEMILES_DIALECT;
delete process.env.AUTH_ALLOW_ANONYMOUS_LOCAL;

const { getDb, STANDALONE_ROOT, DB_PATH, BLOBS_DIR } = await import("./ctx");
const { migrate } = await import("drizzle-orm/libsql/migrator");
await migrate(getDb(), { migrationsFolder: path.join(STANDALONE_ROOT, "drizzle") });

const {
  inspectRequest,
  sentryStrike,
  sentryVerdict,
  __resetSentry,
  STRIKE_WINDOW_MS,
  BASE_BLOCK_MS,
  MAX_BLOCK_MS,
} = await import("./sentry");

const T0 = 1_700_000_000_000;

// ---------------------------------------------------------------------------
describe("sentry — signature inspection (pure)", () => {
  const inspect = (pathname: string, search = "", userAgent: string | null = "Mozilla/5.0") =>
    inspectRequest({ pathname, search, userAgent });

  test("ordinary app traffic trips nothing", () => {
    expect(inspect("/healthz")).toEqual([]);
    expect(inspect("/track/rcv_0123456789abcdef0123456789abcdef")).toEqual([]);
    expect(inspect("/receive/rcv_0123456789abcdef")).toEqual([]);
    expect(inspect("/blobs/paperwork-12-pod-abcdef0123456789")).toEqual([]);
    expect(inspect("/auth/google/callback", "code=4%2F0Aean123&state=xyz")).toEqual([]);
    expect(inspect("/loads", "tab=sealed&sort=recent")).toEqual([]);
    expect(inspect("/assets/app-1a2b3c.js")).toEqual([]);
  });

  test("SQL-injection probes trip the sqli signature", () => {
    const hits = inspect("/track/x", "id=1%27%20OR%201%3D1");
    expect(hits.map((h) => h.kind)).toContain("sqli");
    expect(inspect("/x", "q=UNION%20SELECT%20password%20FROM%20users")[0]?.kind).toBe("sqli");
    expect(inspect("/x", "q=1%3BSLEEP(5)")[0]?.kind).toBe("sqli");
    expect(inspect("/x", "q=information_schema.tables")[0]?.kind).toBe("sqli");
  });

  test("XSS payloads in the query trip the xss signature", () => {
    expect(inspect("/x", "q=%3Cscript%3Ealert(1)%3C/script%3E")[0]?.kind).toBe("xss");
    expect(inspect("/x", "q=javascript:alert(1)")[0]?.kind).toBe("xss");
    expect(inspect("/x", "next=%22%20onerror%3D%22alert(1)")[0]?.kind).toBe("xss");
  });

  test("path traversal trips in raw and encoded shapes", () => {
    expect(inspect("/blobs/../../etc/passwd")[0]?.kind).toBe("traversal");
    expect(inspect("/static/%2e%2e%2fhost%2fauth.ts")[0]?.kind).toBe("traversal");
    expect(inspect("/x", "file=..%2f..%2f.env")[0]?.kind).toBe("traversal");
  });

  test("scanner paths cost 2 strikes; canaries are canaries", () => {
    const env = inspect("/.env");
    expect(env).toEqual([{ kind: "canary", weight: 2 }]);
    expect(inspect("/wp-login.php")).toEqual([{ kind: "canary", weight: 2 }]);
    expect(inspect("/.git/config")).toEqual([{ kind: "canary", weight: 2 }]);
    expect(inspect("/wp-admin/options.php")).toEqual([{ kind: "scanner-path", weight: 2 }]);
    expect(inspect("/phpmyadmin/")).toEqual([{ kind: "scanner-path", weight: 2 }]);
    expect(inspect("/actuator/env")).toEqual([{ kind: "scanner-path", weight: 2 }]);
    expect(inspect("/.aws/credentials")).toEqual([{ kind: "scanner-path", weight: 2 }]);
  });

  test("scanner user agents trip, browsers do not", () => {
    expect(inspect("/healthz", "", "sqlmap/1.7")[0]?.kind).toBe("scanner-ua");
    expect(inspect("/healthz", "", "Mozilla/5.0 (iPhone) nikto")).toEqual([
      { kind: "scanner-ua", weight: 1 },
    ]);
    expect(inspect("/healthz", "", "Mozilla/5.0 (Macintosh; Intel Mac OS X)")).toEqual([]);
  });

  test("real routes are never scanner traps", () => {
    // A real route that merely resembles bait still passes.
    expect(inspect("/docs/doc_0123456789abcdef")).toEqual([]);
    expect(inspect("/apply/app_0123456789abcdef")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("sentry — strikes and blocks (pure)", () => {
  beforeEach(() => __resetSentry());

  test("three strikes inside the window blocks for 30 minutes", () => {
    const ip = "203.0.113.10";
    expect(sentryStrike(ip, 1, T0)).toEqual({ strikes: 1, blocked: false, blockMs: 0 });
    expect(sentryStrike(ip, 1, T0 + 1000)).toEqual({ strikes: 2, blocked: false, blockMs: 0 });
    const third = sentryStrike(ip, 1, T0 + 2000);
    expect(third.blocked).toBe(true);
    expect(third.blockMs).toBe(BASE_BLOCK_MS);
    expect(sentryVerdict(ip, T0 + 3000).action).toBe("blocked");
    expect(sentryVerdict(ip, T0 + 2000 + BASE_BLOCK_MS + 1).action).toBe("allow");
  });

  test("a 2-strike scanner hit plus one more strike blocks", () => {
    const ip = "203.0.113.11";
    sentryStrike(ip, 2, T0);
    const out = sentryStrike(ip, 1, T0 + 500);
    expect(out.blocked).toBe(true);
  });

  test("strikes outside the window decay", () => {
    const ip = "203.0.113.12";
    sentryStrike(ip, 2, T0);
    const later = sentryStrike(ip, 1, T0 + STRIKE_WINDOW_MS + 1);
    expect(later).toEqual({ strikes: 1, blocked: false, blockMs: 0 });
  });

  test("repeat blocks double: 30m, 1h, 2h … capped at 24h", () => {
    const ip = "203.0.113.13";
    const durations: number[] = [];
    let now = T0;
    // Strikes clear themselves when a block trips, so each round
    // starts clean; the block COUNT (the escalation ladder) is
    // what carries. Rounds stay under the clean-day reset because
    // each gap is the previous block's length (< 24h until the
    // cap itself is the last round).
    for (let round = 0; round < 7; round++) {
      sentryStrike(ip, 2, now);
      const out = sentryStrike(ip, 1, now + 1);
      expect(out.blocked).toBe(true);
      durations.push(out.blockMs);
      now += out.blockMs + 1000; // wait out the block
    }
    expect(durations[0]).toBe(30 * 60 * 1000);
    expect(durations[1]).toBe(60 * 60 * 1000);
    expect(durations[2]).toBe(2 * 60 * 60 * 1000);
    expect(durations[3]).toBe(4 * 60 * 60 * 1000);
    expect(durations[6]).toBe(MAX_BLOCK_MS); // 32h would be next — the cap holds
  });

  test("no IP, no strikes — unattributed traffic is logged, never blocked", () => {
    expect(sentryStrike(null, 2, T0)).toEqual({ strikes: 0, blocked: false, blockMs: 0 });
    expect(sentryVerdict(null, T0).action).toBe("allow");
  });

  test("one IP's block never touches another", () => {
    sentryStrike("203.0.113.20", 2, T0);
    sentryStrike("203.0.113.20", 1, T0);
    expect(sentryVerdict("203.0.113.20", T0).action).toBe("blocked");
    expect(sentryVerdict("203.0.113.21", T0).action).toBe("allow");
  });
});

// ---------------------------------------------------------------------------
describe("sentry — the guard on the real server", () => {
  const PORT = 18937;
  let proc: ReturnType<typeof Bun.spawn> | null = null;

  afterAll(() => {
    proc?.kill();
  });

  test("canaries 404, probes earn a block, everyone else is untouched", async () => {
    const spawnEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      PORT: String(PORT),
      STONEMILES_DB: DB_PATH,
      STONEMILES_BLOBS: BLOBS_DIR,
    };
    delete spawnEnv.STONEMILES_DIALECT;
    delete spawnEnv.AUTH_ALLOW_ANONYMOUS_LOCAL;
    proc = Bun.spawn(["bun", "host/server.ts"], {
      cwd: STANDALONE_ROOT,
      env: spawnEnv,
      stdout: "ignore",
      stderr: "ignore",
    });
    const base = `http://127.0.0.1:${PORT}`;
    let up = false;
    for (let i = 0; i < 120 && !up; i++) {
      try {
        const h = await fetch(`${base}/healthz`);
        up = h.status === 200;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    expect(up).toBe(true);

    const attacker = { "x-forwarded-for": "198.51.100.77" };
    const bystander = { "x-forwarded-for": "198.51.100.78" };

    // Canary: boring 404, nothing about it says "trap".
    const canary = await fetch(`${base}/.env`, { headers: attacker });
    expect(canary.status).toBe(404);
    expect(await canary.text()).toContain("not found");

    // Second scanner probe (2 more strikes) trips the block —
    // the tripping request itself is refused.
    const probe = await fetch(`${base}/wp-admin/`, { headers: attacker });
    expect(probe.status).toBe(403);

    // Blocked means everything, even the health check.
    const health = await fetch(`${base}/healthz`, { headers: attacker });
    expect(health.status).toBe(403);

    // The bystander IP is untouched…
    const other = await fetch(`${base}/healthz`, { headers: bystander });
    expect(other.status).toBe(200);

    // …and header-less local traffic (no attributable IP) still
    // flows — it is logged, never blocked.
    const local = await fetch(`${base}/healthz`);
    expect(local.status).toBe(200);

    // A signature in a query on a real route is a strike, not an
    // instant refusal: the page still answers the first time.
    const sqli = await fetch(`${base}/track/rcv_abc?x=1%27%20OR%201%3D1`, {
      headers: bystander,
    });
    expect(sqli.status).toBe(200);
  }, 120_000);
});
