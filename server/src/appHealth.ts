// appHealth.ts — STONEMILES self-reporting & live updates
// (owner order 2026-11-05: "make the app AI controlled so it will
// auto update and notify itself through the AI to fix certain
// things… that way you can give me live updates").
//
// THE APPROVED SHAPE — read before touching this module:
//   1. The app WATCHES ITSELF: crashes, unhandled failures, failed
//      actions, and scheduled health checks report themselves here
//      automatically (no driver chore, no third-party tracker).
//   2. The AI DIAGNOSES + DRAFTS: a diagnosis and a fix plan are
//      drafted for each report, and the live feed narrates what is
//      happening so the owner gets live updates.
//   3. TESTS VERIFY, THE OWNER APPROVES, THE STORE SHIPS.
// The app NEVER rewrites its own code (Google Play bans downloaded
// executable code anyway) and NEVER auto-ships a fix: the owner is
// the gate, exactly like every other Stonervision approval gate.
// Data updates (fuel averages, market rates) keep flowing through
// their own live channels — this module governs CODE health.
//
// PRIVACY (SI Rule 1 holds here too): a report carries an error
// title, a short sanitized detail, the screen name, and counts —
// never a location, never a document, never personal data.
// sanitizeReportText strips emails, phone-shaped numbers, SSN /
// card shapes, and coordinate pairs before anything is stored.

export type HealthKind =
  | "crash"
  | "error"
  | "unhandled_rejection"
  | "action_failed"
  | "health_check"
  | "manual";

export type HealthSeverity = "info" | "warning" | "critical";

export type ReportStatus =
  | "open"
  | "diagnosed"
  | "fix_drafted"
  | "tested"
  | "approved"
  | "shipped"
  | "resolved"
  | "dismissed";

/** The fix pipeline every report travels. The first step is the
 *  app itself; the last two are outside the app by design (the
 *  owner's tap, then the Play store review) — the UI renders this
 *  list so the gate is never hidden. */
export const FIX_PIPELINE: { key: string; label: string; detail: string }[] = [
  { key: "report", label: "App reports itself", detail: "A crash, failure, or failed health check lands here on its own — no one has to notice it first." },
  { key: "diagnose", label: "AI diagnoses", detail: "The likely cause is drafted from the report alone (error text + screen), never from personal data." },
  { key: "draft", label: "Fix drafted", detail: "A fix plan is written and attached to the report in the live feed." },
  { key: "test", label: "Tests verify", detail: "The fix is marked tested only after the build's checks pass — never on a guess." },
  { key: "approve", label: "You approve", detail: "Nothing ships without your tap. This is your gate and it stays yours." },
  { key: "ship", label: "Ships through Play", detail: "Approved fixes ship as a normal Play update. The app never rewrites its own code." },
];

/** Status → the pipeline step it has reached (index into
 *  FIX_PIPELINE). Terminal states map to the end. */
export function pipelineStepForStatus(status: string): number {
  switch (status) {
    case "open": return 0;
    case "diagnosed": return 1;
    case "fix_drafted": return 2;
    case "tested": return 3;
    case "approved": return 4;
    case "shipped": return 5;
    case "resolved": return 5;
    case "dismissed": return 0;
    default: return 0;
  }
}

/** Allowed forward moves for a report's status. The owner's
 *  approval is a distinct move (tested → approved) that no
 *  automatic step can make — the server enforces this table. */
export const REPORT_TRANSITIONS: Record<string, ReportStatus[]> = {
  open: ["diagnosed", "fix_drafted", "dismissed", "resolved"],
  diagnosed: ["fix_drafted", "dismissed", "resolved"],
  fix_drafted: ["tested", "dismissed", "resolved"],
  tested: ["approved", "fix_drafted", "dismissed"],
  approved: ["shipped", "resolved"],
  shipped: ["resolved"],
  resolved: [],
  dismissed: ["open"],
};

export function canTransition(from: string, to: string): boolean {
  return (REPORT_TRANSITIONS[from] ?? []).includes(to as ReportStatus);
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const CARD_RE = /\b(?:\d[ -]?){13,16}\d\b/g;
const PHONE_RE = /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g;
const COORD_RE = /-?\b\d{1,3}\.\d{4,}\s*,\s*-?\b\d{1,3}\.\d{4,}\b/g;
const SECRET_RE = /\b(seed phrase|private key|password|passwd)\b[^,.;]*/gi;

/** Strip anything that could carry personal data out of a report
 *  text, then cap the length. Reports are about the APP, never
 *  about a person or a place. */
export function sanitizeReportText(text: string | null | undefined, max = 600): string {
  let s = (text ?? "").replace(/\s+/g, " ").trim();
  s = s.replace(EMAIL_RE, "[email removed]");
  s = s.replace(SSN_RE, "[id removed]");
  s = s.replace(CARD_RE, "[number removed]");
  s = s.replace(PHONE_RE, "[phone removed]");
  s = s.replace(COORD_RE, "[location removed]");
  s = s.replace(SECRET_RE, "[secret removed]");
  return s.slice(0, max);
}

/** Severity from the kind + wording. A render crash is critical;
 *  a failed background action or a stale-data health check is a
 *  warning; a manual note defaults to info unless it says worse. */
export function classifySeverity(kind: string, text: string): HealthSeverity {
  const t = text.toLowerCase();
  if (kind === "crash") return "critical";
  if (/cannot read|not a function|undefined is not|chunkload|failed to fetch dynamically|render/.test(t)) return "critical";
  if (kind === "unhandled_rejection" || kind === "health_check") return "warning";
  if (/fail|error|timeout|unavailable|stale|broken/.test(t)) return "warning";
  return "info";
}

/** Stable fingerprint for dedupe: same kind + same normalized
 *  title + same screen = the same report, however many times it
 *  fires. Numbers collapse to # so "timeout after 3000ms" and
 *  "timeout after 5000ms" are one report with two occurrences. */
export function fingerprintFor(args: { kind: string; title: string; screen: string | null }): string {
  const norm = `${args.kind}|${(args.screen ?? "").toLowerCase()}|${args.title.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim()}`;
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < norm.length; i++) {
    const ch = norm.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `ah-${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`;
}

export type HealthCheck = {
  key: string;
  label: string;
  status: "pass" | "warn" | "fail" | "info";
  detail: string;
};

export type HealthInputs = {
  chainIntact: boolean;
  chainChecked: number;
  eiaStale: boolean;
  eiaAgeDays: number;
  eiaWeekLabel: string;
  marketStale: boolean;
  marketAgeDays: number;
  marketWeekLabel: string;
  tomtomSearchDisabled: boolean;
  perfTotal: number;
  perfFailed: number;
  openCritical: number;
  openWarning: number;
};

/** The health-check board: every check reads REAL state (the
 *  sealed chain, the stored EIA / market snapshots, the TomTom
 *  circuit breaker, the app's own perf timings, the open report
 *  inbox). Nothing here is simulated — a check with no data says
 *  so as "info", never as a fake pass. */
export function buildHealthChecks(inp: HealthInputs): HealthCheck[] {
  const checks: HealthCheck[] = [];
  checks.push({
    key: "sealed_records",
    label: "Sealed records integrity",
    status: inp.chainIntact ? "pass" : "fail",
    detail: inp.chainIntact
      ? `Hash chain verified end to end — ${inp.chainChecked} sealed entries, no broken links.`
      : `Hash chain verification found a broken link among ${inp.chainChecked} entries — sealed records need a human look before anything else.`,
  });
  checks.push({
    key: "fuel_data",
    label: "Fuel averages freshness (EIA weekly)",
    status: inp.eiaStale ? "warn" : "pass",
    detail: inp.eiaStale
      ? `Last good EIA week on file is ${inp.eiaWeekLabel} (${inp.eiaAgeDays} days old) — the weekly refresh hasn't landed a newer week yet. Prices shown stay labelled as that week.`
      : `EIA weekly averages current — ${inp.eiaWeekLabel}.`,
  });
  checks.push({
    key: "market_data",
    label: "Market rates freshness",
    status: inp.marketStale ? "warn" : "pass",
    detail: inp.marketStale
      ? `Market Pulse week ${inp.marketWeekLabel} is ${inp.marketAgeDays} days old — shown with its stale label until the next weekly entry lands.`
      : `Market Pulse current — week ${inp.marketWeekLabel}.`,
  });
  checks.push({
    key: "address_search",
    label: "Address search",
    status: inp.tomtomSearchDisabled ? "warn" : "pass",
    detail: inp.tomtomSearchDisabled
      ? "TomTom address search is off on the app key — the free search chain (Nominatim → ArcGIS → Photon) is carrying address lookup. Enable the Search product on the key and TomTom takes over with no code change."
      : "TomTom address search is live as the primary lookup.",
  });
  if (inp.perfTotal === 0) {
    checks.push({
      key: "route_reliability",
      label: "Route reliability (app's own timings)",
      status: "info",
      detail: "No route timings recorded yet on this install — this check starts judging after the first drives.",
    });
  } else {
    const failRate = inp.perfFailed / inp.perfTotal;
    checks.push({
      key: "route_reliability",
      label: "Route reliability (app's own timings)",
      status: failRate > 0.6 ? "fail" : failRate > 0.3 ? "warn" : "pass",
      detail: `${inp.perfTotal} route timing${inp.perfTotal === 1 ? "" : "s"} recorded by the app itself — ${inp.perfFailed} failed (${Math.round(failRate * 100)}%).`,
    });
  }
  checks.push({
    key: "open_reports",
    label: "Open failure reports",
    status: inp.openCritical > 0 ? "fail" : inp.openWarning > 0 ? "warn" : "pass",
    detail:
      inp.openCritical + inp.openWarning === 0
        ? "No open crash or failure reports — the inbox is clear."
        : `${inp.openCritical} critical and ${inp.openWarning} warning report${inp.openWarning === 1 ? "" : "s"} open in the inbox below, moving through the fix pipeline.`,
  });
  return checks;
}

export function overallForChecks(checks: HealthCheck[]): "healthy" | "attention" | "critical" {
  if (checks.some((c) => c.status === "fail")) return "critical";
  if (checks.some((c) => c.status === "warn")) return "attention";
  return "healthy";
}

/** One-line live-feed summary of a health check run. */
export function healthCheckFeedLine(checks: HealthCheck[], overall: string): { title: string; detail: string } {
  const fails = checks.filter((c) => c.status === "fail");
  const warns = checks.filter((c) => c.status === "warn");
  if (overall === "healthy") {
    return {
      title: "Health check — all systems healthy",
      detail: `${checks.length} checks ran against the app's real state (sealed records, data freshness, search, route reliability, open reports). Nothing needs attention.`,
    };
  }
  const named = [...fails, ...warns].map((c) => c.label).join(" · ");
  return {
    title: overall === "critical" ? "Health check — something needs you" : "Health check — attention items found",
    detail: `${fails.length} failing, ${warns.length} warning — ${named}. Each failing check opened (or updated) a report in the inbox so it can move through the fix pipeline.`,
  };
}
