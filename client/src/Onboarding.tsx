// Onboarding.tsx — the Full Onboarding Suite (pass 3).
//
// Gating (owner's rule): signup, joining a company with an owner-issued
// code, and a basic driver profile stay FREE — the plain path below
// works off-plan and is never forced through this guide. The guided
// walkthroughs, the white-glove fleet import, and priority onboarding
// help are PREMIUM (Diamond Driver / Owner); on Basic the guide
// shows the plain path plus the premium support offered honestly.
//
// Honesty rules rendered here because the server enforces them:
// - Verified steps complete only when the app can see the real record
//   (profile saved, ELD connected, first course passed, setup
//   complete, codes issued, a driver on the roster). The server
//   re-checks at write time and refuses an unearned "done".
// - Skipped steps stay listed as NOT DONE — a skip is never a
//   completion and never counts in the progress bar.
// - Every step deep-links to the real feature it teaches.
// - Priority help is in-app guided help now (Ask Meca, flagged); a
//   human concierge follows at store launch and is labelled staged.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";

type Banner = (s: string | null) => void;
type ObData = ApiResponse<typeof api, "getOnboarding">;
type ObStep = ObData["driverSteps"][number];

export type OnboardingNav = {
  goDrive: () => void;
  goCompany: () => void;
  goProfile: () => void;
  goVault: () => void;
  goEld: () => void;
  goAcademy: () => void;
  goOwnerPortal: () => void;
  goTrainingBoard: () => void;
  openMeca: (flag: string | null) => void;
  openPlans: () => void;
};

type StepMeta = {
  icon: string;
  title: string;
  detail: string;
  goLabel: string;
  doneLabel: string;
};

const DRIVER_META: Record<string, StepMeta> = {
  account: {
    icon: "🔑",
    title: "Your account",
    detail:
      "You're in under your beta access — every trip, load, and record in STONEMILES seals to this account. Your recorded plan shows in Plans; billing itself starts at the app-store release and nothing is charged in this build.",
    goLabel: "View my plan",
    doneLabel: "Mark done",
  },
  company: {
    icon: "🏢",
    title: "Company — join with a code, or ride solo",
    detail:
      "Drivers: join with the driver code your owner issued and you land in the Company chat and the Owner & All Drivers chat automatically — joining is free and always will be. Applying to drive for RUGGS LOGISTICS, or joining the RUGGS LOGISTICS family? Email your driver application to ruggsllc7@gmail.com — the RUGGS LOGISTICS desk address for driver applications. Owner-operators and solo drivers: ride in individual mode instead; the rest of this guide is the same either way.",
    goLabel: "Open company / join",
    doneLabel: "I'm solo — individual mode",
  },
  profile: {
    icon: "🪪",
    title: "Profile — name + picture",
    detail:
      "Your display name and picture are how your company, dispatch, and other drivers know you. This step checks the real record: it completes when a display name is actually saved on your profile — the checklist doesn't take anyone's word for it.",
    goLabel: "Open my profile",
    doneLabel: "Mark done",
  },
  vault: {
    icon: "🗂️",
    title: "Document vault — license + medical card",
    detail:
      "Your personal document vault holds your CDL, medical card, insurance, registration, and IFTA licence as files. Renewal reminders come from the expiry dates you enter, so nothing lapses on the road by surprise. Take a look, add what's due soonest, then mark this intro done.",
    goLabel: "Open the document vault",
    doneLabel: "I've seen the vault",
  },
  eld: {
    icon: "🔌",
    title: "Connect your ELD — Samsara / Motive",
    detail:
      "The premium ELD hub: the fleet admin mints a read-only API token in the provider's own dashboard — never a password — and pastes it in. Once a connection is live, the ELD odometer becomes the miles of record and ELD HOS mirrors as the official record. No ELD yet? Skip this step: it stays on your list as not done, with the honest note — connect later; GPS labels your miles until then.",
    goLabel: "Open ELD connections",
    doneLabel: "Mark done",
  },
  academy: {
    icon: "🎓",
    title: "Safety Academy — your first core course",
    detail:
      "Ten courses: short lessons plus a 5-question quiz, 80% to pass, and every pass seals into your record and your Reputation Passport. Start with Defensive Driving — it's a core course, and the core courses come due again as refreshers every 31-day season. This step completes when your first pass is on record.",
    goLabel: "Open the Safety Academy",
    doneLabel: "Mark done",
  },
  first_trip: {
    icon: "🚚",
    title: "First-trip walkthrough",
    detail:
      "Three things to know before your first run — each one is a real rule of the app, not a slogan. Read them, take the Drive tab for a spin, then mark the walkthrough done.",
    goLabel: "Open the Drive tab",
    doneLabel: "I've walked through it",
  },
  ask_meca: {
    icon: "💬",
    title: "Meet Ask Meca",
    detail:
      "Ask Meca answers from this app's own real state — your routes, loads, clocks, scores, and records — and says plainly when it doesn't have something. Onboarding help requests (below) are flagged straight to it. Open it once so you know where it lives.",
    goLabel: "Open Ask Meca",
    doneLabel: "I've met Ask Meca",
  },
};

const OWNER_META: Record<string, StepMeta> = {
  company_setup: {
    icon: "🧭",
    title: "Company setup wizard",
    detail:
      "Legal name, address, EIN (encrypted and sealed — it only ever shows masked), MC, USDOT, and contact, plus the three vault documents: W-9, operating authority, and insurance. Driver codes stay locked until setup is complete — that's the fraud-proofing, and this step completes when the wizard says complete.",
    goLabel: "Open company setup",
    doneLabel: "Mark done",
  },
  driver_codes: {
    icon: "🔑",
    title: "Issue your first driver codes",
    detail:
      "Single-use codes you hand to your drivers; joining drops them straight into the Company chat and the Owner & All Drivers chat. Revoke or regenerate a code anytime from the same place. This step completes when your first code exists.",
    goLabel: "Open driver codes",
    doneLabel: "Mark done",
  },
  eld_connect: {
    icon: "🔌",
    title: "Connect the fleet ELD",
    detail:
      "Connect the fleet's Samsara or Motive once, with a read-only API token from your own provider dashboard — never a password. Per-truck status then shows in your Owner Portal. Not running an ELD yet? Skip it: the step stays listed as not done — connect later, and the fleet runs on GPS-labelled miles meanwhile.",
    goLabel: "Open ELD connections",
    doneLabel: "Mark done",
  },
  invite_drivers: {
    icon: "📣",
    title: "Invite your drivers",
    detail:
      "Hand out your driver codes, or use the white-glove import below to put the whole roster on at once. This step completes when your first driver is on the roster. In a hurry? Skip it for now — a skip stays on the list as not done, never faked as complete.",
    goLabel: "Open the roster",
    doneLabel: "Mark done",
  },
  training_tour: {
    icon: "🎓",
    title: "Tour the fleet training board",
    detail:
      "Inside your Owner Portal: every driver's Safety Academy status — completed, current, or due — your company-only uploaded training videos, and who has watched what. Open it once so you know where your fleet's training stands, then mark the tour done.",
    goLabel: "Open the training board",
    doneLabel: "I've toured the board",
  },
};

const FIRST_TRIP_CARDS: { title: string; body: string }[] = [
  {
    title: "1 · Start the trip — the sheet builds itself",
    body: "From the Drive tab, start a trip and drive. GPS logs your miles state line to state line, and the trip sheet pays $0.55/mi per state with full state names. Moving about 1 mile can auto-start the log (you set that under Automation) — which is exactly what the next card is about.",
  },
  {
    title: "2 · The 1-mile duty prompt — the app asks, you decide",
    body: "When a trip auto-starts after 1 mile of movement, the app asks BEFORE anything changes: Drive / On Duty (not driving) / Stay Sleeper Berth / Stay Off Duty. Your answer — or no answer — is stamped into the sealed record. STONEMILES never changes your duty status on its own, ever.",
  },
  {
    title: "3 · Pickup proof is camera-fresh only",
    body: "At pickup, once you've received the load, take a NEW picture of the load right in the app and attach it with the BOL to that load's record. Both photos must be fresh captures — gallery uploads are not accepted for these two slots, and the server rejects them (gallery stays fine for creating a load). Each photo is stamped with time + GPS and sealed; the pair completes the Pickup sealed step in the Load Tracker.",
  },
];

function statusChip(s: ObStep): { text: string; cls: string } {
  if (s.status === "done")
    return { text: s.source === "verified" ? "✅ DONE — ON RECORD" : "✅ DONE", cls: "bg-emerald-900/60 text-emerald-300" };
  if (s.status === "skipped") return { text: "⏭ SKIPPED — STILL TO DO", cls: "bg-amber-900/60 text-amber-200" };
  return { text: "○ TO DO", cls: "bg-[var(--surface)] text-[var(--dim)]" };
}

function StepRow({
  step,
  meta,
  premium,
  freePath,
  fact,
  onGo,
  onSet,
}: {
  step: ObStep;
  meta: StepMeta;
  premium: boolean;
  freePath: boolean;
  fact: string | null;
  onGo: () => void;
  onSet: (status: "done" | "skipped" | "pending") => void;
}) {
  const chip = statusChip(step);
  const locked = !premium && !freePath;
  return (
    <li className="rounded-2xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3.5 py-3">
      <div className="flex items-start justify-between gap-2">
        <span className="font-condensed text-lg font-bold leading-tight">
          {meta.icon} {meta.title}
        </span>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${chip.cls}`}>{chip.text}</span>
      </div>
      <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">{meta.detail}</p>
      {fact && <p className="mt-1.5 rounded-lg bg-[var(--surface)] px-2.5 py-2 text-xs font-bold">{fact}</p>}
      {step.id === "first_trip" && (
        <div className="mt-2 space-y-2">
          {FIRST_TRIP_CARDS.map((c) => (
            <div key={c.title} className="rounded-xl bg-[var(--surface)] px-3 py-2.5">
              <div className="text-sm font-bold">{c.title}</div>
              <p className="mt-0.5 text-xs leading-relaxed text-[var(--dim)]">{c.body}</p>
            </div>
          ))}
        </div>
      )}
      {step.status === "skipped" && (
        <p className="mt-2 text-xs font-semibold text-amber-200">
          Skipped for now — it stays on your list as not done. Skipping never marks a step complete; do it whenever
          you're ready.
        </p>
      )}
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-press rounded-lg bg-[var(--accent)] px-3.5 py-2 text-sm font-bold text-black"
          aria-label={`${meta.goLabel} — step: ${meta.title}`}
          onClick={onGo}
        >
          {meta.goLabel} →
        </button>
        {locked ? (
          <span className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-bold text-[var(--dim)]">
            🔒 Guided step — premium support (Diamond Driver / Owner)
          </span>
        ) : (
          <>
            {step.status !== "done" && (
              <button
                type="button"
                className="btn-press rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-sm font-bold"
                aria-label={`${meta.doneLabel} — step: ${meta.title}`}
                onClick={() => onSet("done")}
              >
                {meta.doneLabel}
              </button>
            )}
            {step.status === "done" && step.kind !== "verified" && step.source !== "verified" && (
              <button
                type="button"
                className="btn-press rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-sm font-bold"
                aria-label={`Reset step to to-do: ${meta.title}`}
                onClick={() => onSet("pending")}
              >
                Back to to-do
              </button>
            )}
            {step.skippable && step.status !== "skipped" && step.status !== "done" && (
              <button
                type="button"
                className="btn-press rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-sm font-bold"
                aria-label={`Skip for now — step: ${meta.title}`}
                onClick={() => onSet("skipped")}
              >
                Skip for now
              </button>
            )}
            {step.status === "skipped" && (
              <button
                type="button"
                className="btn-press rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2 text-sm font-bold"
                aria-label={`Un-skip step: ${meta.title}`}
                onClick={() => onSet("pending")}
              >
                Put it back on my list
              </button>
            )}
          </>
        )}
      </div>
    </li>
  );
}

// ---- Owner Portal introduction --------------------------------------------

/** The Owner Portal introduction — owner-saved copy, shown on first
 *  entry to the Owner Portal only; marking it seen is recorded
 *  server-side so it never re-nags. Renders nothing for non-owners or
 *  after it has been seen. */
export function OwnerIntroBlock({
  setBanner,
  onOpenChecklist,
}: {
  setBanner: Banner;
  onOpenChecklist?: () => void;
}) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["onboarding"], queryFn: () => api.getOnboarding({}) });
  const intro = q.data?.ownerIntro;
  if (!q.data?.isOwner || !intro || intro.seen) return null;
  return (
    <section
      className="mb-3 rounded-2xl border-2 border-[var(--accent)] bg-[var(--surface2)] p-3.5"
      aria-label="Owner Portal introduction"
    >
      <h3 className="font-condensed text-xl font-bold">👋 Owner Portal introduction</h3>
      <p className="mt-1.5 text-sm leading-relaxed">{intro.copy}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-neon btn-press rounded-xl px-4 py-2.5 text-sm font-bold"
          aria-label="Dismiss the Owner Portal introduction — don't show it again"
          onClick={() => {
            void api.markOwnerIntroSeen({}).then(() => {
              queryClient.invalidateQueries({ queryKey: ["onboarding"] });
              setBanner("Owner Portal introduction saved as seen — it won't pop up again. It's always re-readable in the onboarding guide.");
            });
          }}
        >
          Got it — don't show this again
        </button>
        {onOpenChecklist && (
          <button
            type="button"
            className="btn-press rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-bold"
            aria-label="Open my owner onboarding checklist"
            onClick={onOpenChecklist}
          >
            Open my owner checklist →
          </button>
        )}
      </div>
    </section>
  );
}

// ---- White-glove import -----------------------------------------------------

type ImportKind = "drivers" | "trucks" | "loads";
type ImportRow = ApiResponse<typeof api, "previewFleetImport">["rows"][number];

const IMPORT_HELP: Record<ImportKind, string> = {
  drivers:
    "One driver per line: username — optionally followed by , dispatch. Example:\njsmith\ndperez, dispatch\nDrivers land on your roster and in both company chats. (Staging note: at release, drivers join with your issued codes — the roster rows you import are the same records either way.)",
  trucks:
    "One truck per line: unit label — optionally followed by , details (year / make / model / VIN note). Example:\nUnit 12, 2022 Freightliner Cascadia\nUnit 13",
  loads:
    "One load per line, comma-separated: shipper, pickup city, pickup state, delivery city, delivery state, rate, weight lbs, commodity. Rate, weight, and commodity may be empty — the lane (pickup + delivery city/state) may not. A header row is fine: it's reported as skipped, never imported.",
};

function WhiteGloveImport({ setBanner }: { setBanner: Banner }) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<ImportKind>("drivers");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<{ rows: ImportRow[]; counts: { received: number; ready: number; rejected: number } } | null>(null);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [result, setResult] = useState<{ rows: ImportRow[]; summary: { received: number; written: number; rejected: number } } | null>(null);
  const [busy, setBusy] = useState(false);

  const runPreview = () => {
    if (!text.trim()) {
      setBanner("Paste some rows first — one per line.");
      return;
    }
    setBusy(true);
    setResult(null);
    void api
      .previewFleetImport({ kind, text })
      .then((r) => {
        if (!r.ok) {
          setBanner(r.error ?? "That paste couldn't be checked.");
          setPreview(null);
          return;
        }
        setPreview({ rows: r.rows, counts: r.counts });
        const c: Record<number, boolean> = {};
        for (const row of r.rows) if (row.ok) c[row.line] = true;
        setChecked(c);
      })
      .catch(() => setBanner("Couldn't check those rows — try again."))
      .finally(() => setBusy(false));
  };

  const selectedLines = (preview?.rows ?? []).filter((r) => r.ok && checked[r.line]).map((r) => r.raw);

  const runCommit = () => {
    if (selectedLines.length === 0) {
      setBanner("No rows are selected — tick at least one ready row to import.");
      return;
    }
    setBusy(true);
    void api
      .commitFleetImport({ kind, lines: selectedLines })
      .then((r) => {
        if (!r.ok || !r.summary) {
          setBanner(r.error ?? "The import didn't go through.");
          return;
        }
        setResult({ rows: r.rows as ImportRow[], summary: r.summary });
        setPreview(null);
        setText("");
        queryClient.invalidateQueries({ queryKey: ["onboarding"] });
        queryClient.invalidateQueries({ queryKey: ["company"] });
        queryClient.invalidateQueries({ queryKey: ["loads"] });
        setBanner(
          `White-glove import complete: ${r.summary.written} of ${r.summary.received} confirmed row${r.summary.received === 1 ? "" : "s"} written, ${r.summary.rejected} rejected — every row is listed below with its result. Nothing was silently dropped.`,
        );
      })
      .catch(() => setBanner("The import didn't go through — try again."))
      .finally(() => setBusy(false));
  };

  const rowLine = (r: ImportRow) => (
    <li key={r.line} className="rounded-lg bg-[var(--surface)] px-2.5 py-2 text-xs">
      <span className="font-bold">Line {r.line}:</span>{" "}
      {r.status === "written" ? "✅ Written" : r.ok ? "✅ Ready" : r.status === "skipped" ? "⏭ Skipped" : "⛔ Rejected"} —{" "}
      {r.detail ?? r.reason}
      <span className="mt-0.5 block truncate font-mono text-[11px] text-[var(--dim)]">{r.raw || "(blank)"}</span>
    </li>
  );

  return (
    <section className="rounded-2xl border border-[var(--glass-border)] bg-[var(--surface2)] p-3.5" aria-label="White-glove fleet setup import">
      <h3 className="font-condensed text-xl font-bold">🤝 White-glove fleet setup — bulk import</h3>
      <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
        Owner premium. Paste your trucks, drivers, and opening loads in the plain formats below. Every row is
        checked first and reported — accepted, rejected with the reason, or skipped with the reason — and only the
        rows you confirm are written. Nothing is ever silently dropped.
      </p>
      <div className="mt-2.5 grid grid-cols-3 gap-1.5" role="tablist" aria-label="Import kind">
        {(
          [
            { key: "drivers" as const, label: "👥 Drivers" },
            { key: "trucks" as const, label: "🚛 Trucks" },
            { key: "loads" as const, label: "📦 Opening loads" },
          ]
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={kind === t.key}
            aria-label={`Import ${t.label.replace(/^\S+ /, "")}`}
            onClick={() => {
              setKind(t.key);
              setPreview(null);
              setResult(null);
            }}
            className={`btn-press rounded-xl border px-1 py-2.5 text-xs font-bold ${
              kind === t.key ? "border-[var(--accent)] neon-text" : "border-[var(--glass-border)] text-[var(--dim)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="mt-2 whitespace-pre-line rounded-xl bg-[var(--surface)] px-3 py-2.5 text-xs leading-relaxed text-[var(--dim)]">
        {IMPORT_HELP[kind]}
      </p>
      <label className="mt-2 block text-xs font-bold text-[var(--dim)]">
        Paste rows — one per line
        <textarea
          className="mt-1 h-32 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 font-mono text-xs text-[var(--text)]"
          value={text}
          aria-label={`Paste ${kind} rows, one per line`}
          placeholder={kind === "drivers" ? "jsmith\ndperez, dispatch" : kind === "trucks" ? "Unit 12, 2022 Freightliner Cascadia" : "Peacock Pavers, Mobile, Alabama, Dallas, Texas, 2450, 38000, Pavers"}
          onChange={(e) => {
            setText(e.target.value);
            setPreview(null);
            setResult(null);
          }}
        />
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          className="btn-press rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-bold text-black disabled:opacity-50"
          aria-label="Check the pasted rows before importing"
          onClick={runPreview}
        >
          {busy ? "Checking…" : "Check rows"}
        </button>
        {preview && (
          <button
            type="button"
            disabled={busy || selectedLines.length === 0}
            className="btn-neon btn-press rounded-xl px-4 py-2.5 text-sm font-bold disabled:opacity-50"
            aria-label={`Import the ${selectedLines.length} selected rows`}
            onClick={runCommit}
          >
            Import {selectedLines.length} selected row{selectedLines.length === 1 ? "" : "s"}
          </button>
        )}
      </div>
      {preview && (
        <div className="mt-3">
          <p className="text-xs font-bold" role="status">
            Checked {preview.counts.received} row{preview.counts.received === 1 ? "" : "s"}: {preview.counts.ready}{" "}
            ready, {preview.counts.rejected} rejected or skipped — reasons on every row. Tick the rows you confirm,
            then import.
          </p>
          <ul className="mt-2 space-y-1.5">
            {preview.rows.map((r) => (
              <li key={r.line} className="flex items-start gap-2 rounded-lg bg-[var(--surface)] px-2.5 py-2 text-xs">
                {r.ok ? (
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 shrink-0"
                    checked={checked[r.line] ?? false}
                    aria-label={`Confirm import of line ${r.line}: ${r.raw}`}
                    onChange={(e) => setChecked((c) => ({ ...c, [r.line]: e.target.checked }))}
                  />
                ) : (
                  <span className="mt-0.5 shrink-0" aria-hidden>{r.status === "skipped" ? "⏭" : "⛔"}</span>
                )}
                <span className="min-w-0">
                  <span className="font-bold">Line {r.line}:</span> {r.ok ? "Ready" : r.status === "skipped" ? "Skipped" : "Rejected"} —{" "}
                  {r.detail ?? r.reason}
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-[var(--dim)]">{r.raw || "(blank)"}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {result && (
        <div className="mt-3">
          <p className="rounded-xl bg-[var(--surface)] px-3 py-2.5 text-sm font-bold" role="status">
            Import summary — received {result.summary.received} · written {result.summary.written} · rejected{" "}
            {result.summary.rejected}. The counts match the rows below, one result per row.
          </p>
          <ul className="mt-2 space-y-1.5">{result.rows.map(rowLine)}</ul>
        </div>
      )}
    </section>
  );
}

// ---- Priority onboarding help ----------------------------------------------

const HELP_TOPICS: { key: "owner_onboarding" | "driver_onboarding" | "eld" | "training" | "other"; label: string }[] = [
  { key: "owner_onboarding", label: "Owner onboarding — company setup, codes, roster" },
  { key: "driver_onboarding", label: "Driver onboarding — joining, profile, first trip" },
  { key: "eld", label: "ELD connection — Samsara / Motive" },
  { key: "training", label: "Safety Academy & training board" },
  { key: "other", label: "Something else" },
];

function HelpBlock({ setBanner, nav, premium }: { setBanner: Banner; nav: OnboardingNav; premium: boolean }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["onboarding"], queryFn: () => api.getOnboarding({}) });
  const [topic, setTopic] = useState<(typeof HELP_TOPICS)[number]["key"]>("owner_onboarding");
  const [message, setMessage] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requests = q.data?.helpRequests ?? [];
  return (
    <section className="rounded-2xl border border-[var(--glass-border)] bg-[var(--surface2)] p-3.5" aria-label="Get onboarding help">
      <h3 className="font-condensed text-xl font-bold">🙋 Get onboarding help — priority</h3>
      <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
        Premium support. File the question here and it's saved, sealed, and flagged for Ask Meca as onboarding help —
        continue in Ask Meca and it walks the answer with your real app state. What this is, plainly: in-app guided
        help right now; a human concierge follows at the app-store launch. Nobody human is on the other end of this
        staging build, and the app won't pretend otherwise.
      </p>
      {!premium ? (
        <p className="mt-2 rounded-xl bg-[var(--surface)] px-3 py-2.5 text-sm">
          🔒 Priority onboarding help is part of the premium support on Diamond Driver and Owner. The free plain path —
          signup, joining with a code, basic profile — never needs it.{" "}
          <button type="button" className="font-bold text-[var(--accent)] underline" aria-label="See plans and upgrade" onClick={nav.openPlans}>
            See plans
          </button>
        </p>
      ) : (
        <>
          <label className="mt-2.5 block text-xs font-bold text-[var(--dim)]">
            Topic
            <select
              className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm font-bold text-[var(--text)]"
              value={topic}
              aria-label="Onboarding help topic"
              onChange={(e) => setTopic(e.target.value as typeof topic)}
            >
              {HELP_TOPICS.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-2 block text-xs font-bold text-[var(--dim)]">
            What do you need a hand with?
            <textarea
              className="mt-1 h-20 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)]"
              value={message}
              aria-label="Describe what you need onboarding help with"
              placeholder="e.g. Walk me through issuing codes and getting my first two drivers onto the roster."
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !message.trim()}
              className="btn-press rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-bold text-black disabled:opacity-50"
              aria-label="Send my onboarding help request"
              onClick={() => {
                setBusy(true);
                void api
                  .requestOnboardingHelp({ topic, message: message.trim() })
                  .then((r) => {
                    if (r.ok) {
                      setNote(r.note);
                      setMessage("");
                      queryClient.invalidateQueries({ queryKey: ["onboarding"] });
                    } else {
                      setBanner(r.error ?? "The request didn't save.");
                    }
                  })
                  .catch(() => setBanner("The request didn't save — try again."))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "Sending…" : "Send help request"}
            </button>
            <button
              type="button"
              className="btn-press rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-bold"
              aria-label="Continue this in Ask Meca, flagged as onboarding help"
              onClick={() => nav.openMeca(topic)}
            >
              Continue in Ask Meca →
            </button>
          </div>
          {note && (
            <p className="mt-2 rounded-xl bg-[var(--surface)] px-3 py-2.5 text-xs leading-relaxed" role="status">
              {note}
            </p>
          )}
          {requests.length > 0 && (
            <ul className="mt-2.5 space-y-1.5">
              {requests.map((r) => (
                <li key={r.id} className="rounded-lg bg-[var(--surface)] px-2.5 py-2 text-xs">
                  <strong>{HELP_TOPICS.find((t) => t.key === r.topic)?.label ?? r.topic}</strong> ·{" "}
                  {new Date(r.createdAt).toLocaleString()} · flagged: {r.flag}
                  <span className="mt-0.5 block text-[var(--dim)]">{r.message}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

// ---- The onboarding sheet -----------------------------------------------------

export function OnboardingSheet({
  setBanner,
  nav,
  onClose,
}: {
  setBanner: Banner;
  nav: OnboardingNav;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["onboarding"], queryFn: () => api.getOnboarding({}) });
  const data = q.data;
  const [introOpen, setIntroOpen] = useState(false);

  const setStep = (track: "driver" | "owner", stepId: string, status: "done" | "skipped" | "pending") => {
    void api
      .setOnboardingStep({ track, stepId, status })
      .then((r) => {
        if (!r.ok) setBanner(r.error ?? "That step couldn't be recorded.");
        else queryClient.invalidateQueries({ queryKey: ["onboarding"] });
      })
      .catch(() => setBanner("That step couldn't be recorded — try again."));
  };

  const dismiss = () => {
    void api
      .dismissOnboarding({})
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["onboarding"] });
        onClose();
      })
      .catch(onClose);
  };

  const factFor = (id: string): string | null => {
    if (!data) return null;
    const f = data.facts;
    switch (id) {
      case "account":
        return `Recorded plan: ${data.plan === "owner" ? "Owner" : data.plan === "diamond" || data.plan === "full" ? "Diamond Driver" : data.plan === "gold" ? "Gold Driver" : "Basic (free)"}.`;
      case "company":
        return data.hasCompany
          ? `You're on the roster at ${data.companyName ?? "your company"} as ${data.myRole ?? "member"}.`
          : "Not in a company right now — join with a code above, create your own, or mark solo below.";
      case "profile":
        return f.profileDone
          ? `On record: display name saved${f.hasAvatar ? " + profile picture" : ""}.`
          : "On record: no display name saved yet.";
      case "vault":
        return f.personalDocs > 0
          ? `On record: ${f.personalDocs} document${f.personalDocs === 1 ? "" : "s"} in your personal vault.`
          : "On record: your personal vault is empty.";
      case "eld":
      case "eld_connect":
        return f.eldConnected ? `On record: ELD connected (${f.eldProvider ?? "provider"}).` : "On record: no ELD connected.";
      case "academy":
        return f.academyCompletions > 0
          ? `On record: ${f.academyCompletions} sealed training completion${f.academyCompletions === 1 ? "" : "s"}.`
          : "On record: no course passed yet.";
      case "first_trip":
        return f.tripsCount > 0
          ? `On record: ${f.tripsCount} sealed trip${f.tripsCount === 1 ? "" : "s"} so far.`
          : "On record: no trips yet — the walkthrough is the whole assignment.";
      case "company_setup":
        return f.setupComplete ? "On record: company setup is complete." : "On record: company setup is not complete yet.";
      case "driver_codes":
        return f.codesCount > 0 ? `On record: ${f.codesCount} driver code${f.codesCount === 1 ? "" : "s"} issued.` : "On record: no driver codes issued yet.";
      case "invite_drivers":
        return f.memberCount > 1
          ? `On record: ${f.memberCount} people on the roster (you included).`
          : "On record: just you on the roster so far.";
      default:
        return null;
    }
  };

  const goFor = (track: "driver" | "owner", id: string): (() => void) => {
    switch (id) {
      case "account":
        return nav.openPlans;
      case "company":
      case "driver_codes":
      case "invite_drivers":
        return track === "owner" ? nav.goOwnerPortal : nav.goCompany;
      case "company_setup":
        return nav.goOwnerPortal;
      case "profile":
        return nav.goProfile;
      case "vault":
        return nav.goVault;
      case "eld":
      case "eld_connect":
        return nav.goEld;
      case "academy":
        return nav.goAcademy;
      case "first_trip":
        return nav.goDrive;
      case "ask_meca":
        return () => nav.openMeca(null);
      case "training_tour":
        return nav.goTrainingBoard;
      default:
        return nav.goCompany;
    }
  };

  // The free plain path: the three steps a free driver completes
  // without any guided support. Everything else in the guide is an
  // offer, never a toll gate.
  const FREE_PATH = new Set(["account", "company", "profile"]);

  return (
    <div className="fixed inset-0 z-[930] flex items-end bg-black/70" role="dialog" aria-label="Onboarding guide">
      <div className="animate-sheet max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-[var(--surface)] p-5 pb-safe">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-condensed text-2xl font-bold">🧭 Getting started — onboarding</h2>
            <p className="mt-0.5 text-xs font-bold tracking-wide text-[var(--dim)]">
              {data?.mode === "individual" ? "INDIVIDUAL MODE — SOLO OWNER-OPERATOR" : data?.isOwner ? "OWNER + DRIVER GUIDE" : "DRIVER GUIDE"} · PROGRESS SAVES AS YOU GO — LEAVE AND RESUME ANYTIME
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-full bg-[var(--surface2)] px-4 py-2 font-bold"
            aria-label="Close the onboarding guide"
            onClick={onClose}
          >
            ✕ Close
          </button>
        </div>

        {q.isLoading && <p className="mt-3 text-sm text-[var(--dim)]">Loading your checklists…</p>}
        {data && (
          <>
            <div className="mt-3" aria-label="Onboarding progress">
              <div className="flex items-baseline justify-between text-xs font-bold">
                <span>
                  {data.progress.done} of {data.progress.total} steps done
                </span>
                <span className="text-[var(--accent)]">{data.progress.pct}%</span>
              </div>
              <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-[var(--surface2)]">
                <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${data.progress.pct}%` }} />
              </div>
              <p className="mt-1 text-xs text-[var(--dim)]">
                Only real completions count — a skipped step stays on the list as not done, and verified steps
                complete only when the app can see the record.
              </p>
            </div>

            {!data.premium && (
              <p className="mt-3 rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-sm leading-relaxed">
                <strong>You're on the free plain path.</strong> Signup, joining a company with a driver code, and
                your basic profile are free and completable right here — nothing in this guide is forced. The
                guided walkthroughs, white-glove fleet import, and priority onboarding help are the premium
                support on Diamond Driver and Owner, offered — never a toll gate on getting in the door.{" "}
                <button type="button" className="font-bold text-[var(--accent)] underline" aria-label="See plans and upgrade from onboarding" onClick={nav.openPlans}>
                  See plans
                </button>
              </p>
            )}

            <h3 className="mt-4 font-condensed text-xl font-bold">
              {data.mode === "individual" ? "Your individual guide" : "Driver guide"}
            </h3>
            <ul className="mt-2 space-y-2.5">
              {data.driverSteps.map((s) => {
                const meta = DRIVER_META[s.id];
                if (!meta) return null;
                return (
                  <StepRow
                    key={s.id}
                    step={s}
                    meta={meta}
                    premium={data.premium}
                    freePath={FREE_PATH.has(s.id)}
                    fact={factFor(s.id)}
                    onGo={goFor("driver", s.id)}
                    onSet={(status) => setStep("driver", s.id, status)}
                  />
                );
              })}
            </ul>

            {data.isOwner && (
              <>
                <h3 className="mt-5 font-condensed text-xl font-bold">Owner guide</h3>
                {data.ownerIntro && (
                  <div className="mt-2 rounded-2xl border border-[var(--glass-border)] bg-[var(--surface2)] p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-condensed text-lg font-bold">👋 The Owner Portal introduction</span>
                      {data.ownerIntro.seen ? (
                        <button
                          type="button"
                          className="shrink-0 text-xs font-bold text-[var(--accent)] underline"
                          aria-label={introOpen ? "Hide the Owner Portal introduction" : "Re-read the Owner Portal introduction"}
                          onClick={() => setIntroOpen(!introOpen)}
                        >
                          {introOpen ? "Hide" : "Re-read"}
                        </button>
                      ) : (
                        <span className="shrink-0 rounded-full bg-amber-900/60 px-2.5 py-1 text-[10px] font-bold text-amber-200">NEW — SHOWS ONCE IN THE PORTAL</span>
                      )}
                    </div>
                    {(!data.ownerIntro.seen || introOpen) && (
                      <p className="mt-1.5 text-sm leading-relaxed">{data.ownerIntro.copy}</p>
                    )}
                    {!data.ownerIntro.seen && (
                      <button
                        type="button"
                        className="btn-press mt-2 rounded-lg bg-[var(--accent)] px-3.5 py-2 text-sm font-bold text-black"
                        aria-label="Mark the Owner Portal introduction as seen"
                        onClick={() => {
                          void api.markOwnerIntroSeen({}).then(() => queryClient.invalidateQueries({ queryKey: ["onboarding"] }));
                        }}
                      >
                        Got it
                      </button>
                    )}
                  </div>
                )}
                {!data.hasCompany && (
                  <p className="mt-2 rounded-xl bg-amber-900/40 px-3 py-2.5 text-sm font-semibold text-amber-200">
                    No company yet — the owner checklist and the white-glove import file everything under your
                    company. Create it first (Chat tab → “Run your own fleet?”), then come back here.
                  </p>
                )}
                <ul className="mt-2 space-y-2.5">
                  {data.ownerSteps.map((s) => {
                    const meta = OWNER_META[s.id];
                    if (!meta) return null;
                    return (
                      <StepRow
                        key={s.id}
                        step={s}
                        meta={meta}
                        premium={data.premium}
                        freePath={false}
                        fact={factFor(s.id)}
                        onGo={goFor("owner", s.id)}
                        onSet={(status) => setStep("owner", s.id, status)}
                      />
                    );
                  })}
                </ul>
                {data.hasCompany && data.myRole === "owner" && (
                  <div className="mt-3">
                    {data.premium ? (
                      <WhiteGloveImport setBanner={setBanner} />
                    ) : (
                      <p className="rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-sm">
                        🔒 The white-glove fleet import (bulk trucks, drivers, and opening loads) is Owner premium
                        support.{" "}
                        <button type="button" className="font-bold text-[var(--accent)] underline" aria-label="See plans for white-glove import" onClick={nav.openPlans}>
                          See plans
                        </button>
                      </p>
                    )}
                    {data.trucks.length > 0 && (
                      <div className="mt-2.5 rounded-2xl border border-[var(--glass-border)] bg-[var(--surface2)] p-3.5" aria-label="Fleet truck list">
                        <h4 className="font-condensed text-lg font-bold">🚛 Fleet truck list — {data.trucks.length} on record</h4>
                        <ul className="mt-1.5 space-y-1">
                          {data.trucks.map((t) => (
                            <li key={t.id} className="rounded-lg bg-[var(--surface)] px-2.5 py-2 text-sm">
                              <strong>{t.unitLabel}</strong>
                              {t.detail ? <span className="text-[var(--dim)]"> — {t.detail}</span> : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            <div className="mt-4">
              <HelpBlock setBanner={setBanner} nav={nav} premium={data.premium} />
            </div>

            <button
              type="button"
              className="btn-press mt-4 w-full rounded-xl border border-[var(--border)] bg-[var(--surface2)] py-3 text-sm font-bold"
              aria-label="Done with onboarding for now — don't auto-show it again"
              onClick={dismiss}
            >
              Done for now — I've got it from here
            </button>
            <p className="mt-1.5 text-center text-xs text-[var(--dim)]">
              That records onboarding as dismissed: it won't auto-open again, your progress stays saved, and the guide
              is always one tap away on the Driver tab and in the Menu.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ---- Driver-tab entry card ----------------------------------------------------

export function OnboardingCard({ onOpen }: { onOpen: () => void }) {
  const q = useQuery({ queryKey: ["onboarding"], queryFn: () => api.getOnboarding({}) });
  const data = q.data;
  if (!data) return null;
  const complete = data.progress.total > 0 && data.progress.done >= data.progress.total;
  return (
    <section className="glass-panel p-3.5" aria-label="Getting started and onboarding">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-condensed text-xl font-semibold">🧭 Getting started</h2>
        <span className="rounded-full bg-[var(--surface2)] px-2.5 py-1 text-[10px] font-bold text-[var(--accent)]">
          {data.progress.done}/{data.progress.total} STEPS · {data.progress.pct}%
        </span>
      </div>
      <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
        {complete
          ? "Every guided step is on record — nice work. The guide stays here if you ever want the refresher, the white-glove import, or priority help."
          : data.premium
            ? "Your guided onboarding: profile, document vault, ELD, first Academy course, and the first-trip walkthrough — plus the owner checklist, white-glove fleet import, and priority help if you run a fleet. Progress saves as you go; pick it up anytime."
            : "The free plain path — signup, join with a code, basic profile — plus a look at the premium guided support (walkthroughs, white-glove import, priority help) on Diamond Driver and Owner."}
      </p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--surface2)]">
        <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${data.progress.pct}%` }} />
      </div>
      <button
        type="button"
        className="btn-press mt-2.5 w-full rounded-xl bg-[var(--accent)] py-2.5 text-sm font-bold text-black"
        aria-label="Open the onboarding guide"
        onClick={onOpen}
      >
        {complete ? "Reopen the guide" : data.progress.done > 0 ? "Resume onboarding →" : "Start onboarding →"}
      </button>
    </section>
  );
}
