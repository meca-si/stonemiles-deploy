// healthReporter.ts — the app's self-reporting wiring
// (owner order 2026-11-05). Installed once from main.tsx so it
// catches failures from the first paint: window errors and
// unhandled promise rejections become reports through the
// reportAppIssue action, deduped per session (appHealth.ts).
//
// Discipline:
//  - It NEVER throws and never retries: a failed report is
//    dropped silently — the reporter must never become a second
//    failure on top of the first.
//  - It sends no location and no personal data: payloads are
//    built by reportFromError (sanitized) and the server
//    re-sanitizes + applies the owner's self-reporting toggle —
//    with the toggle off, automatic reports are dropped
//    server-side and nothing is stored.
//  - The current screen is read from the document title-level
//    state the app already exposes (the active tab's data attr
//    when present), falling back to null — never a URL, which
//    could carry query data.

import { api } from "./api";
import { SessionReportGate, isNetworkFailure, reportFromError } from "./appHealth";

let installed = false;

function currentScreen(): string | null {
  try {
    const el = document.querySelector<HTMLElement>("[data-sm-screen]");
    return el?.dataset.smScreen ?? null;
  } catch {
    return null;
  }
}

export function installHealthReporter(): void {
  if (installed) return;
  installed = true;
  const gate = new SessionReportGate();
  const send = (error: unknown, kind: "error" | "unhandled_rejection") => {
    try {
      // Connectivity failures are skipped: the report rides the
      // same connection that just failed (see isNetworkFailure).
      if (isNetworkFailure(error)) return;
      const payload = reportFromError({ error, kind, screen: currentScreen() });
      if (!gate.allow(payload)) return;
      void api.reportAppIssue(payload).catch(() => undefined);
    } catch {
      // The reporter never surfaces its own failures.
    }
  };
  try {
    window.addEventListener("error", (ev) => {
      // Resource-load errors (img/script) carry no Error object —
      // they are the map tiles' and CDNs' business, not an app
      // crash; only real script errors report.
      if (ev.error) send(ev.error, "error");
    });
    window.addEventListener("unhandledrejection", (ev) => {
      send(ev.reason, "unhandled_rejection");
    });
  } catch {
    // No window (SSR/test) — nothing to install.
  }
}
