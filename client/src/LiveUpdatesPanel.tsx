// LiveUpdatesPanel.tsx — Live Updates: app health & self-reporting
// (owner order 2026-11-05: "make the app AI controlled… it will
// notify itself through the AI to fix certain things… that way
// you can give me live updates").
//
// The visible face of the approved loop:
//   the app reports itself (crashes/failures land on their own —
//   healthReporter.ts wires window errors + rejections, and the
//   health check runs on a schedule) → the AI diagnoses and
//   drafts a fix → tests verify → THE OWNER APPROVES → the fix
//   ships through Play. The panel renders every stage honestly:
//   the health board reads real state, the feed narrates what
//   happened and when, and the inbox carries each report through
//   the pipeline with the approval button as its own step.
// The app never rewrites its own code and never auto-ships —
// that line is printed in the panel, not buried.

import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

type Banner = (s: string | null) => void;

function Section({ title, ariaLabel, badge, children }: { title: string; ariaLabel: string; badge?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="glass-panel p-3.5" aria-label={ariaLabel}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${open ? "Collapse" : "Expand"} ${ariaLabel}`}
        onClick={() => setOpen((v) => !v)}
        className="btn-press flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="font-condensed text-xl font-semibold">{title}</span>
        <span className="flex shrink-0 items-center gap-2">
          {badge}
          <span aria-hidden className="text-lg font-bold text-[var(--accent)]">{open ? "▾" : "▸"}</span>
        </span>
      </button>
      {open && <div className="mt-2">{children}</div>}
    </section>
  );
}

const CHECK_ICON: Record<string, string> = { pass: "✅", warn: "⚠️", fail: "🛑", info: "ℹ️" };
const SEVERITY_STYLE: Record<string, string> = {
  critical: "bg-[var(--danger)] text-white",
  warning: "bg-[var(--accent)] text-black",
  info: "bg-[var(--surface)] border border-[var(--border)]",
};
const STATUS_LABEL: Record<string, string> = {
  open: "OPEN — waiting for diagnosis",
  diagnosed: "DIAGNOSED",
  fix_drafted: "FIX DRAFTED",
  tested: "TESTED — waiting for your approval",
  approved: "APPROVED BY YOU — ships via Play",
  shipped: "SHIPPED",
  resolved: "RESOLVED",
  dismissed: "DISMISSED",
};

function timeText(iso: string): string {
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function LiveUpdatesPanel({ setBanner }: { setBanner: Banner }) {
  const queryClient = useQueryClient();
  const q = useQuery({
    queryKey: ["app-health"],
    queryFn: () => api.getAppHealth({}),
    // The live feel: while this panel's data is mounted the board
    // re-reads itself every minute, so a new self-report or a
    // scheduled health check shows up without a manual reload.
    refetchInterval: 60_000,
  });
  const [checking, setChecking] = useState(false);
  const [diagnosingId, setDiagnosingId] = useState<number | null>(null);
  const [manualTitle, setManualTitle] = useState("");
  const [manualDetail, setManualDetail] = useState("");
  const [manualBusy, setManualBusy] = useState(false);

  const data = q.data;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["app-health"] });

  const openReports = (data?.reports ?? []).filter((r) => ["open", "diagnosed", "fix_drafted", "tested", "approved"].includes(r.status));
  const closedReports = (data?.reports ?? []).filter((r) => !["open", "diagnosed", "fix_drafted", "tested", "approved"].includes(r.status));

  const runCheck = async () => {
    setChecking(true);
    try {
      const r = await api.runAppHealthCheck({});
      setBanner(
        r.overall === "healthy"
          ? `Health check done — all systems healthy. ${r.passed} checks passed, nothing opened. It's in your live feed below.`
          : `Health check done — ${r.failures} failing, ${r.warnings} warning. ${r.reportsOpened} report${r.reportsOpened === 1 ? "" : "s"} opened in the inbox, ${r.reportsResolved} cleared on their own. Full word is in your live feed.`,
      );
      refresh();
    } finally {
      setChecking(false);
    }
  };

  const diagnose = async (id: number, title: string) => {
    setDiagnosingId(id);
    try {
      const r = await api.diagnoseAppHealthReport({ id });
      setBanner(r.ok ? `Diagnosis drafted for “${title}” — the likely cause and fix plan are on the report below. Next it gets built and tested, then it waits for your approval.` : (r.error ?? "That diagnosis didn't draft."));
      refresh();
    } finally {
      setDiagnosingId(null);
    }
  };

  const move = async (id: number, status: "fix_drafted" | "tested" | "approved" | "shipped" | "resolved" | "dismissed" | "open", title: string) => {
    const r = await api.updateAppHealthReportStatus({ id, status });
    setBanner(
      r.ok
        ? status === "approved"
          ? `Approved — “${title}” is cleared to ship as a Play update. That's your gate doing its job.`
          : status === "shipped"
            ? `Marked shipped — “${title}” went out with the store update. If it ever fires again, the report reopens itself.`
            : `“${title}” moved to ${STATUS_LABEL[status] ?? status}. It's narrated in your live feed.`
        : (r.error ?? "That move didn't save."),
    );
    refresh();
  };

  const sendManual = async () => {
    if (!manualTitle.trim()) {
      setBanner("Give the problem a short title first — that's what the report files under.");
      return;
    }
    setManualBusy(true);
    try {
      const r = await api.reportAppIssue({
        kind: "manual",
        title: manualTitle.trim(),
        detail: manualDetail.trim() ? manualDetail.trim() : null,
        screen: "Live Updates",
        manual: true,
      });
      setBanner(r.accepted ? "Reported — it's in the health inbox now and can be diagnosed right away. You'll see it move in the live feed." : (r.reason ?? "That report didn't land."));
      if (r.accepted) {
        setManualTitle("");
        setManualDetail("");
      }
      refresh();
    } finally {
      setManualBusy(false);
    }
  };

  const overallBadge =
    q.isLoading ? "…" : data?.overall === "healthy" ? "HEALTHY" : data?.overall === "critical" ? "NEEDS YOU" : "ATTENTION";
  const overallStyle =
    data?.overall === "healthy"
      ? "bg-[var(--ok)] text-black"
      : data?.overall === "critical"
        ? "bg-[var(--danger)] text-white"
        : "bg-[var(--accent)] text-black";

  const inputCls = "w-full rounded-lg bg-[var(--surface)] px-3 py-2.5 text-sm border border-[var(--border)]";

  return (
    <Section
      title="📡 Live Updates — App Health & Self-Reporting"
      ariaLabel="Live Updates — app health, self-reporting, and the fix pipeline"
      badge={
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${q.isLoading ? "bg-[var(--surface2)] text-[var(--accent)]" : overallStyle}`}>
          {overallBadge}
          {!q.isLoading && (data?.openCount ?? 0) > 0 ? ` · ${data?.openCount} OPEN` : ""}
        </span>
      }
    >
      <div className="mt-2">
        <p className="text-sm text-[var(--dim)]">
          The app <strong className="text-[var(--text)]">watches itself</strong>. When something crashes or fails, it reports
          itself here on its own — the AI diagnoses it and drafts the fix, tests verify it, and then it waits at{" "}
          <strong className="text-[var(--text)]">your approval gate</strong>. Approved fixes ship as a normal Play update:
          the app never rewrites its own code and never ships anything behind your back. Everything that happens is
          narrated in the live feed below, as it happens.
        </p>

        {/* Self-reporting switch + health check */}
        <div className="mt-3 flex items-center justify-between rounded-xl bg-[var(--surface2)] px-3 py-2.5">
          <span className="font-semibold">Self-reporting — {data?.autoReportEnabled ? "On" : "Off"}</span>
          <button
            type="button"
            role="switch"
            aria-checked={data?.autoReportEnabled ?? true}
            aria-label={data?.autoReportEnabled ? "Turn off automatic self-reporting" : "Turn on automatic self-reporting"}
            onClick={async () => {
              const next = !(data?.autoReportEnabled ?? true);
              const r = await api.setAppHealthSettings({ autoReportEnabled: next });
              setBanner(
                next
                  ? "Self-reporting is ON — crashes and failures report themselves here automatically, ready for diagnosis."
                  : "Self-reporting is OFF — automatic reports are dropped and nothing from them is stored. Manual reports below still work.",
              );
              if (!r.ok) setBanner("That setting didn't save — try again.");
              refresh();
            }}
            className={`h-8 w-14 shrink-0 rounded-full p-1 ${data?.autoReportEnabled ? "bg-[var(--ok)]" : "bg-[var(--surface)] border border-[var(--border)]"}`}
          >
            <span className={`block h-6 w-6 rounded-full bg-white ${data?.autoReportEnabled ? "translate-x-6" : ""}`} />
          </button>
        </div>
        <p className="mt-1.5 text-xs text-[var(--dim)]">
          Reports carry the error text and the screen name only — no location, no documents, no personal data, and no
          third-party tracker. The same failure reported twice counts as one report with two occurrences.
        </p>

        <button
          type="button"
          className="btn-neon btn-press mt-3 min-h-[52px] w-full rounded-xl px-4 font-condensed text-xl font-bold disabled:opacity-50"
          aria-label="Run the app health check now"
          disabled={checking}
          onClick={() => void runCheck()}
        >
          {checking ? "Checking the app…" : "▶ Run health check now"}
        </button>
        <p className="mt-1.5 text-xs text-[var(--dim)]">
          {data?.lastCheckAt ? `Last health check: ${timeText(data.lastCheckAt)}. ` : "No health check has run yet on this install. "}
          A check also runs on its own every day — failing checks open a report, and a check that passes again clears
          its own report.
        </p>

        {/* The fix pipeline */}
        <div className="mt-4 text-xs font-bold uppercase tracking-wide text-[var(--dim)]">How a fix travels — you are the gate</div>
        <ol className="mt-1.5 space-y-1.5">
          {(data?.pipeline ?? []).map((step, i) => (
            <li key={step.key} className="flex gap-2.5 rounded-xl bg-[var(--surface2)] px-3 py-2.5">
              <span className="font-condensed text-lg font-bold text-[var(--accent)]">{i + 1}</span>
              <span>
                <span className="block text-sm font-bold">{step.label}</span>
                <span className="block text-sm text-[var(--dim)]">{step.detail}</span>
              </span>
            </li>
          ))}
        </ol>

        {/* Health board */}
        <div className="mt-4 text-xs font-bold uppercase tracking-wide text-[var(--dim)]">Health board — the app's real state, right now</div>
        {q.isLoading ? (
          <p className="mt-1.5 text-sm text-[var(--dim)]">Reading the app's state…</p>
        ) : (
          <ul className="mt-1.5 space-y-2">
            {(data?.checks ?? []).map((c) => (
              <li key={c.key} className="rounded-xl bg-[var(--surface2)] px-3 py-2.5">
                <span className="block text-sm font-bold">{CHECK_ICON[c.status] ?? "•"} {c.label}</span>
                <span className="mt-0.5 block text-sm text-[var(--dim)]">{c.detail}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Failure inbox */}
        <div className="mt-4 text-xs font-bold uppercase tracking-wide text-[var(--dim)]">
          Failure inbox{openReports.length > 0 ? ` — ${openReports.length} open` : ""}
          {(data?.awaitingApproval ?? 0) > 0 ? ` · ${data?.awaitingApproval} waiting for your approval` : ""}
        </div>
        {openReports.length === 0 ? (
          <p className="mt-1.5 text-sm text-[var(--dim)]">
            Nothing open. When the app hits a crash or a failure — or a health check fails — it lands here on its own,
            ready for diagnosis.
          </p>
        ) : (
          <ul className="mt-1.5 space-y-2">
            {openReports.map((r) => (
              <li key={r.id} className="rounded-xl bg-[var(--surface2)] px-3 py-2.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${SEVERITY_STYLE[r.severity] ?? ""}`}>{r.severity.toUpperCase()}</span>
                  <span className="text-sm font-bold">{r.title}</span>
                </span>
                <span className="mt-0.5 block text-xs text-[var(--dim)]">
                  {STATUS_LABEL[r.status] ?? r.status} · {r.kind.replace(/_/g, " ")}
                  {r.screen ? ` · screen: ${r.screen}` : ""} · seen {r.occurrences}× · first {timeText(r.firstSeenAt)} · last {timeText(r.lastSeenAt)}
                </span>
                {r.detail && <span className="mt-1 block text-sm text-[var(--dim)]">{r.detail}</span>}
                {r.diagnosis && (
                  <span className="mt-2 block rounded-lg bg-[var(--surface)] px-2.5 py-2 text-sm">
                    <strong>AI diagnosis:</strong> {r.diagnosis}
                  </span>
                )}
                {r.fixPlan.length > 0 && (
                  <span className="mt-1.5 block rounded-lg bg-[var(--surface)] px-2.5 py-2 text-sm">
                    <strong>Fix plan:</strong>
                    {r.fixPlan.map((step, i) => (
                      <span key={i} className="block text-[var(--dim)]">{i + 1}. {step}</span>
                    ))}
                  </span>
                )}
                <span className="mt-2 flex flex-wrap gap-2">
                  {(r.status === "open" || r.status === "diagnosed" || r.status === "fix_drafted") && (
                    <button
                      type="button"
                      className="btn-neon btn-press rounded-lg px-3 py-2 text-sm font-bold disabled:opacity-50"
                      aria-label={`Draft an AI diagnosis for report: ${r.title}`}
                      disabled={diagnosingId === r.id}
                      onClick={() => void diagnose(r.id, r.title)}
                    >
                      {diagnosingId === r.id ? "Diagnosing…" : r.diagnosis ? "🔁 Re-diagnose with AI" : "🧠 Diagnose with AI"}
                    </button>
                  )}
                  {r.status === "diagnosed" && (
                    <button type="button" className="btn-press rounded-lg border border-[var(--accent)] px-3 py-2 text-sm font-bold text-[var(--accent)]" aria-label={`Mark the fix drafted for report: ${r.title}`} onClick={() => void move(r.id, "fix_drafted", r.title)}>
                      Fix drafted
                    </button>
                  )}
                  {r.status === "fix_drafted" && (
                    <button type="button" className="btn-press rounded-lg border border-[var(--accent)] px-3 py-2 text-sm font-bold text-[var(--accent)]" aria-label={`Mark the fix tested for report: ${r.title}`} onClick={() => void move(r.id, "tested", r.title)}>
                      Mark tests passed
                    </button>
                  )}
                  {r.status === "tested" && (
                    <button type="button" className="btn-neon btn-press rounded-lg px-3 py-2 text-sm font-bold" aria-label={`Approve the fix to ship for report: ${r.title}`} onClick={() => void move(r.id, "approved", r.title)}>
                      ✅ Approve fix to ship
                    </button>
                  )}
                  {r.status === "approved" && (
                    <button type="button" className="btn-press rounded-lg border border-[var(--ok)] px-3 py-2 text-sm font-bold text-[var(--ok)]" aria-label={`Mark the approved fix as shipped for report: ${r.title}`} onClick={() => void move(r.id, "shipped", r.title)}>
                      Mark shipped via Play
                    </button>
                  )}
                  <button type="button" className="btn-press rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-bold" aria-label={`Resolve report: ${r.title}`} onClick={() => void move(r.id, "resolved", r.title)}>
                    Resolved
                  </button>
                  <button type="button" className="btn-press rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-bold" aria-label={`Dismiss report: ${r.title}`} onClick={() => void move(r.id, "dismissed", r.title)}>
                    Dismiss
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {closedReports.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {closedReports.slice(0, 5).map((r) => (
              <li key={r.id} className="rounded-lg bg-[var(--surface2)] px-3 py-2 text-sm">
                <span className="font-bold">{r.title}</span>{" "}
                <span className="text-[var(--dim)]">{STATUS_LABEL[r.status] ?? r.status} · seen {r.occurrences}× · last {timeText(r.lastSeenAt)}</span>{" "}
                {r.status === "dismissed" && (
                  <button type="button" className="font-bold text-[var(--accent)] underline" aria-label={`Reopen report: ${r.title}`} onClick={() => void move(r.id, "open", r.title)}>
                    Reopen
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Manual report */}
        <div className="mt-4 text-xs font-bold uppercase tracking-wide text-[var(--dim)]">Something feel wrong? Report it yourself</div>
        <p className="mt-1 text-sm text-[var(--dim)]">
          Automatic reporting catches crashes and failures — a slow screen or a wrong-looking number is yours to flag.
          Manual reports always land, even with self-reporting off.
        </p>
        <div className="mt-2 space-y-2">
          <label className="block text-xs font-bold text-[var(--dim)]">
            What went wrong — short title
            <input aria-label="Problem title" value={manualTitle} onChange={(e) => setManualTitle(e.target.value)} placeholder="e.g. Route took forever to load" className={inputCls} />
          </label>
          <label className="block text-xs font-bold text-[var(--dim)]">
            Details (optional)
            <textarea aria-label="Problem details" value={manualDetail} onChange={(e) => setManualDetail(e.target.value)} placeholder="What were you doing when it happened?" rows={3} className={inputCls} />
          </label>
          <button
            type="button"
            className="btn-press w-full rounded-xl border border-[var(--accent)] px-4 py-3 text-sm font-bold text-[var(--accent)] disabled:opacity-50"
            aria-label="Send this problem report to the health inbox"
            disabled={manualBusy}
            onClick={() => void sendManual()}
          >
            {manualBusy ? "Reporting…" : "📨 Report this problem"}
          </button>
        </div>

        {/* Live feed */}
        <div className="mt-4 text-xs font-bold uppercase tracking-wide text-[var(--dim)]">Live feed — what the app has been doing about itself</div>
        {(data?.feed ?? []).length === 0 ? (
          <p className="mt-1.5 text-sm text-[var(--dim)]">
            Nothing yet. The first health check, self-report, diagnosis, or approval lands here with its time — this
            feed is the live update stream.
          </p>
        ) : (
          <ul className="mt-1.5 space-y-2">
            {(data?.feed ?? []).map((f) => (
              <li key={f.id} className="rounded-xl bg-[var(--surface2)] px-3 py-2.5">
                <span className="block text-sm font-bold">
                  {f.kind === "health_check" ? "🩺" : f.kind === "crash_report" ? "💥" : f.kind === "diagnosis" ? "🧠" : f.kind === "pipeline" ? "🚦" : f.kind === "settings" ? "🎛️" : "📡"} {f.title}
                  <span className="ml-2 text-xs font-normal text-[var(--dim)]">{timeText(f.createdAt)}</span>
                </span>
                <span className="mt-0.5 block text-sm text-[var(--dim)]">{f.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
