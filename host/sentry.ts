// STONEMILES SENTRY — the host's in-process attack shield
// (2026-11-17, owner's order: fight back, close back doors, stop
// breaches before they start).
//
// What this is: a first-pass inspector on EVERY request the host
// receives, before routing. It reads the path, the query string,
// and a few headers — never request bodies (drivers upload
// documents through /actions JSON; pattern-scanning bodies would
// false-positive on real paperwork and cost real CPU). It looks
// for the shapes automated attack tooling actually sends:
//
//   - SQL-injection probes in the query string
//   - XSS payloads in the query string
//   - path traversal in path or query
//   - vulnerability-scanner paths (/.env, /.git/, /wp-admin, …)
//   - well-known scanner user agents (sqlmap, nikto, …)
//
// Strikes: a signature hit costs the source IP 1 strike, a
// scanner-path hit 2. Three strikes inside ten minutes blocks the
// IP — 30 minutes the first time, doubling on every repeat block
// (1h, 2h, 4h … capped at 24h). A blocked IP gets a plain 403 for
// everything until the block expires. Canary paths (below) are
// scanner bait: they answer a boring 404 and cost 2 strikes.
//
// Every strike and block is logged as one structured line
// prefixed "SENTRY" so Render's log search surfaces the whole
// fight with one grep.
//
// Posture notes:
//   - The client IP comes from the proxy headers (x-forwarded-for
//     first entry, else x-real-ip — the same precedence as
//     host/auth.ts clientIp). With NO proxy headers there is no
//     attributable IP: signatures are still logged, but no strikes
//     accumulate and nothing blocks (a shared "unknown" bucket
//     would let one local probe lock out every local user).
//   - State is in-memory per process, like the auth throttles —
//     a restart clears strikes and blocks. That is the Phase-1
//     posture the whole host already runs on.
//   - Legitimate traffic cannot trip this: the app talks POST
//     /actions with JSON bodies (never scanned), its tokens are
//     hex, and its real routes are allowlisted out of the scanner
//     path traps below.

// ---------------------------------------------------------------------------
// Detection tables
// ---------------------------------------------------------------------------

/** The app's own real route space. A scanner pattern that would
 *  collide with one of these prefixes is NOT a trap — these are
 *  checked first and always pass the path screen. */
const REAL_ROUTE_PREFIXES = [
  "/healthz",
  "/actions",
  "/events",
  "/blobs/",
  "/auth/",
  "/join",
  "/delete-account",
  "/delete-data",
  "/privacy",
  "/receive/",
  "/pod/",
  "/track/",
  "/docs/",
  "/apply/",
] as const;

function isRealRoute(pathname: string): boolean {
  return REAL_ROUTE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p),
  );
}

/** Canary traps: paths no real route will ever own and no real
 *  user ever asks for. A request here is hostile by definition.
 *  Answered 404 (boring on purpose — the trap is never revealed)
 *  and logged as SENTRY CANARY with 2 strikes. */
export const CANARY_PATHS = new Set([
  "/.env",
  "/.git/config",
  "/wp-login.php",
  "/xmlrpc.php",
  "/api/admin/backup",
]);

/** Scanner-bait path shapes (matched against the lowercased,
 *  decoded pathname, real routes excluded). Each is worth
 *  2 strikes. */
const SCANNER_PATH_PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: "scanner-path", re: /^\/.env(\.|$|\/)/ },
  { kind: "scanner-path", re: /^\/.git(\/|$)/ },
  { kind: "scanner-path", re: /^\/.aws(\/|$)/ },
  { kind: "scanner-path", re: /^\/.svn(\/|$)/ },
  { kind: "scanner-path", re: /^\/wp-admin(\/|$)/ },
  { kind: "scanner-path", re: /^\/wp-login\.php$/ },
  { kind: "scanner-path", re: /^\/wp-content(\/|$)/ },
  { kind: "scanner-path", re: /^\/wp-includes(\/|$)/ },
  { kind: "scanner-path", re: /^\/xmlrpc\.php$/ },
  { kind: "scanner-path", re: /^\/phpmyadmin(\/|$)/ },
  { kind: "scanner-path", re: /^\/pma(\/|$)/ },
  { kind: "scanner-path", re: /^\/config\.php$/ },
  { kind: "scanner-path", re: /^\/actuator(\/|$)/ },
  { kind: "scanner-path", re: /^\/.ds_store$/ },
  { kind: "scanner-path", re: /^\/server-status$/ },
  { kind: "scanner-path", re: /^\/vendor\/phpunit(\/|$)/ },
  { kind: "scanner-path", re: /^\/(backup|db|database)\.(sql|zip|tar|gz)$/ },
];

/** SQL-injection probe shapes, matched against the DECODED query
 *  string (and the decoded path — probes ride both). */
const SQLI_PATTERNS: RegExp[] = [
  /\bunion\s+(all\s+)?select\b/i,
  /\bselect\b[\s\S]*\bfrom\b[\s\S]*\bwhere\b/i,
  /\bor\s+1\s*=\s*1\b/i,
  /\band\s+1\s*=\s*1\b/i,
  /'\s*or\s*'[^']*'\s*=/i,
  /'\s*or\s+\d+\s*=\s*\d+/i,
  /\binformation_schema\b/i,
  /\b(sleep|benchmark|pg_sleep|waitfor\s+delay)\b/i,
  /\b(drop|alter)\s+table\b/i,
  /--\s|#\s*$/i,
  /\bchar\s*\(\s*\d+/i,
  /\bconcat\s*\(/i,
];

/** XSS payload shapes in the query string / path. */
const XSS_PATTERNS: RegExp[] = [
  /<script\b/i,
  /<\/script\s*>/i,
  /\bon\w+\s*=\s*["']?[^"'\s]*\(/i,
  /javascript\s*:/i,
  /<svg\b[^>]*\bon\w+/i,
  /<iframe\b/i,
  /<img\b[^>]*\bonerror/i,
  /document\.cookie/i,
  /document\.location/i,
];

/** Path traversal shapes, matched against the RAW (still-encoded)
 *  and decoded path + query — attackers encode, so both faces are
 *  checked. */
const TRAVERSAL_PATTERNS: RegExp[] = [
  /\.\.\//,
  /\.\.\\/,
  /%2e%2e/i,
  /\.\.%2f/i,
  /%2e\.\//i,
  /\.\.%5c/i,
  /%252e%252e/i, // double-encoded dots
];

/** User agents of offensive tooling. No legitimate client of this
 *  app (browser, the native shell, curl in the smoke scripts)
 *  sends one of these. */
const SCANNER_UA_PATTERN =
  /\b(sqlmap|nikto|nmap|masscan|zgrab|dirbuster|gobuster|hydra|wpscan|nuclei|acunetix|nessus|openvas)\b/i;

export type SentryHit = {
  kind: "sqli" | "xss" | "traversal" | "scanner-path" | "scanner-ua" | "canary";
  /** Strike weight of this hit. */
  weight: number;
};

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
}

/** Inspect one request's path + query + user agent. Returns every
 *  signature hit (empty for legitimate traffic). Pure — the
 *  strike bookkeeping lives below. */
export function inspectRequest(args: {
  pathname: string;
  /** Raw query string, no leading "?". */
  search: string;
  userAgent: string | null;
}): SentryHit[] {
  const hits: SentryHit[] = [];
  const rawPath = args.pathname;
  const path = safeDecode(rawPath).toLowerCase();
  const rawHay = `${rawPath}?${args.search}`;
  const hay = `${path}?${safeDecode(args.search)}`;

  if (CANARY_PATHS.has(path)) {
    hits.push({ kind: "canary", weight: 2 });
    return hits; // the canary verdict is complete on its own
  }

  if (!isRealRoute(path)) {
    for (const { re } of SCANNER_PATH_PATTERNS) {
      if (re.test(path)) {
        hits.push({ kind: "scanner-path", weight: 2 });
        break;
      }
    }
  }

  for (const re of TRAVERSAL_PATTERNS) {
    if (re.test(rawHay) || re.test(hay)) {
      hits.push({ kind: "traversal", weight: 1 });
      break;
    }
  }
  for (const re of SQLI_PATTERNS) {
    if (re.test(hay)) {
      hits.push({ kind: "sqli", weight: 1 });
      break;
    }
  }
  for (const re of XSS_PATTERNS) {
    if (re.test(hay)) {
      hits.push({ kind: "xss", weight: 1 });
      break;
    }
  }
  if (args.userAgent && SCANNER_UA_PATTERN.test(args.userAgent)) {
    hits.push({ kind: "scanner-ua", weight: 1 });
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Strike + block bookkeeping (in-memory, the auth-throttle pattern)
// ---------------------------------------------------------------------------

export const STRIKE_WINDOW_MS = 10 * 60 * 1000;
export const STRIKES_TO_BLOCK = 3;
export const BASE_BLOCK_MS = 30 * 60 * 1000;
export const MAX_BLOCK_MS = 24 * 60 * 60 * 1000;
/** A clean day erases an IP's escalation history. */
const ESCALATION_RESET_MS = 24 * 60 * 60 * 1000;

type IpRecord = {
  strikes: { at: number; weight: number }[];
  blockedUntil: number;
  /** How many times this IP has been blocked (drives doubling). */
  blockCount: number;
  lastSeenAt: number;
};

const ipRecords = new Map<string, IpRecord>();

function recordFor(ip: string, now: number): IpRecord {
  let rec = ipRecords.get(ip);
  if (!rec) {
    rec = { strikes: [], blockedUntil: 0, blockCount: 0, lastSeenAt: now };
    ipRecords.set(ip, rec);
  }
  return rec;
}

function strikeTotal(rec: IpRecord, now: number): number {
  rec.strikes = rec.strikes.filter((s) => now - s.at < STRIKE_WINDOW_MS);
  return rec.strikes.reduce((sum, s) => sum + s.weight, 0);
}

export type SentryVerdict =
  | { action: "allow" }
  | { action: "blocked"; retryAfterMs: number };

/** Is this IP blocked right now? Checked before anything else. */
export function sentryVerdict(ip: string | null, now = Date.now()): SentryVerdict {
  if (!ip) return { action: "allow" };
  const rec = ipRecords.get(ip);
  if (!rec) return { action: "allow" };
  if (rec.blockedUntil > now) {
    return { action: "blocked", retryAfterMs: rec.blockedUntil - now };
  }
  return { action: "allow" };
}

export type StrikeOutcome = {
  /** Strike weight inside the live window, after this hit. */
  strikes: number;
  /** True when this hit tripped (or extended) a block. */
  blocked: boolean;
  /** The block length in ms when blocked, else 0. */
  blockMs: number;
};

/** Record one hit against an IP. Three strikes in the window
 *  blocks; each successive block doubles from 30 minutes, capped
 *  at 24 hours. */
export function sentryStrike(
  ip: string | null,
  weight: number,
  now = Date.now(),
): StrikeOutcome {
  if (!ip) return { strikes: 0, blocked: false, blockMs: 0 };
  const rec = recordFor(ip, now);
  if (now - rec.lastSeenAt > ESCALATION_RESET_MS && rec.blockedUntil <= now) {
    rec.blockCount = 0; // a clean day resets the escalation ladder
  }
  rec.lastSeenAt = now;
  rec.strikes.push({ at: now, weight });
  const total = strikeTotal(rec, now);
  if (total >= STRIKES_TO_BLOCK) {
    const blockMs = Math.min(BASE_BLOCK_MS * 2 ** rec.blockCount, MAX_BLOCK_MS);
    rec.blockedUntil = now + blockMs;
    rec.blockCount += 1;
    rec.strikes = [];
    return { strikes: total, blocked: true, blockMs };
  }
  return { strikes: total, blocked: false, blockMs: 0 };
}

/** Test hook: wipe all strike/block state. */
export function __resetSentry(): void {
  ipRecords.clear();
}

// ---------------------------------------------------------------------------
// Request-path wiring
// ---------------------------------------------------------------------------

/** The client IP from the proxy headers — the same precedence as
 *  host/auth.ts clientIp. Null when no proxy headers are present. */
export function sentryClientIp(req: Request): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null
  );
}

function sentryLog(line: string): void {
  console.warn(`SENTRY ${line}`);
}

/**
 * The guard itself, called at the very top of routing:
 *   - blocked IP            → 403, plain and short
 *   - canary path           → 404 (boring), strike logged
 *   - signature hit         → logged + strike; the request still
 *                             proceeds unless the strike tripped
 *                             a block, in which case 403
 *   - clean                 → null (routing continues untouched)
 */
export function sentryGuard(req: Request, url: URL): Response | null {
  const ip = sentryClientIp(req);
  const now = Date.now();

  const verdict = sentryVerdict(ip, now);
  if (verdict.action === "blocked") {
    sentryLog(
      `BLOCKED ip=${ip} path=${url.pathname} retryAfterMs=${verdict.retryAfterMs}`,
    );
    return new Response("Forbidden.", {
      status: 403,
      headers: { "content-type": "text/plain" },
    });
  }

  const hits = inspectRequest({
    pathname: url.pathname,
    search: url.search.startsWith("?") ? url.search.slice(1) : url.search,
    userAgent: req.headers.get("user-agent"),
  });
  if (hits.length === 0) return null;

  let blockedNow = false;
  for (const hit of hits) {
    const outcome = sentryStrike(ip, hit.weight, now);
    if (hit.kind === "canary") {
      sentryLog(
        `CANARY ip=${ip ?? "unknown"} path=${url.pathname} strikes=${outcome.strikes}`,
      );
    } else {
      sentryLog(
        `STRIKE ip=${ip ?? "unknown"} path=${url.pathname} kind=${hit.kind} strikes=${outcome.strikes}`,
      );
    }
    if (outcome.blocked) {
      blockedNow = true;
      sentryLog(
        `BLOCK ip=${ip} path=${url.pathname} blockMs=${outcome.blockMs}`,
      );
    }
  }

  if (hits.some((h) => h.kind === "canary")) {
    // Boring on purpose: the same shape as every other 404 here.
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }
  if (blockedNow) {
    return new Response("Forbidden.", {
      status: 403,
      headers: { "content-type": "text/plain" },
    });
  }
  return null;
}
