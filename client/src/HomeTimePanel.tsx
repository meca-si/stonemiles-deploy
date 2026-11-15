// HomeTimePanel.tsx — home-time guarantee + retention (Wave 2 item 9).
//
// Three surfaces over the same server rules (homeTime.ts — the
// panels render records and tallies, they never compute them):
//
//   MyHomeTimeCard — the driver's own record, in the Money tab
//     beside the qualification file: their commitments (stated by
//     them or by their fleet), the next deadline, the last 90
//     days of kept / missed / overridden outcomes derived from
//     sealed records, their own facts, and the pulse check when
//     one is due (dismissible, never blocking).
//   FleetHomeTimePanel — Owner / Dispatch desks: every driver's
//     commitments and tallies, the retention signals (objective
//     sealed facts worth a check-in — never a verdict, never a
//     score), and the pulse aggregate. Averages appear only when
//     3+ drivers answered in the window; below that, counts only.
//     A driver's pulse answers and note are NEVER shown here —
//     the server doesn't send them on this path at all.
//   DriverHomeTimeView — one driver's record opened from the
//     fleet panel: commitments, with the desk's set/void controls
//     (fleet-stated terms only — a term the driver stated is
//     theirs alone to end or override).
//
// Planning enforcement lives server-side at claim / assign /
// accept (homeTimeGateForBoardTake); the boards carry the
// override box. Plain wording throughout; counts, never
// percentages or composite scores.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";

type HomeTimeData = ApiResponse<typeof api, "getHomeTime">;
type Commitment = HomeTimeData["commitments"][number];
type HitRate = HomeTimeData["hitRate"];
type FleetData = ApiResponse<typeof api, "getFleetHomeTime">;
type FleetDriver = FleetData["drivers"][number];

const BTN = "rounded-lg bg-[var(--surface)] border border-[var(--border)] px-3 py-2 text-xs font-bold disabled:opacity-50";
const BTN_PRIMARY = "rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-bold text-white disabled:opacity-50";
const INPUT = "w-full rounded-lg bg-[var(--surface)] border border-[var(--border)] px-2 py-2 text-xs";
const SECTION = "mt-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3";

const QUESTIONS: { key: string; label: string; low: string; high: string }[] = [
  { key: "home_time", label: "How is home time holding up lately?", low: "Rough", high: "Great" },
  { key: "workload", label: "How is the workload feeling?", low: "Too much", high: "About right" },
  { key: "staying", label: "How likely are you to still be driving here in six months?", low: "Not likely", high: "Very likely" },
];

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function outcomeChip(outcome: string): { label: string; cls: string } {
  if (outcome === "kept") return { label: "KEPT", cls: "bg-emerald-500/15 text-emerald-300" };
  if (outcome === "missed") return { label: "MISSED", cls: "bg-red-500/15 text-red-300" };
  if (outcome === "overridden") return { label: "OVERRIDDEN", cls: "bg-amber-500/15 text-amber-200" };
  return { label: "NO HOME RECORD", cls: "bg-[var(--surface)] text-[var(--dim)]" };
}

export function HitRateLine({ hr }: { hr: HitRate }) {
  if (hr.total === 0) {
    return <p className="mt-1 text-xs text-[var(--dim)]">No home-time deadlines fell in the last 90 days.</p>;
  }
  return (
    <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
      Last 90 days, from sealed records: <strong className="text-[var(--text)]">kept {hr.kept}</strong> ·{" "}
      <strong className="text-[var(--text)]">missed {hr.missed}</strong> ·{" "}
      <strong className="text-[var(--text)]">overridden {hr.overridden}</strong> · no home record {hr.noHomeRecord} —{" "}
      {hr.decided} of {hr.total} deadline{hr.total === 1 ? "" : "s"} provable either way.
    </p>
  );
}

// ---------------------------------------------------------------------------
// Set-a-commitment form — used by the driver for their own terms
// and by the desk for fleet-stated terms.
// ---------------------------------------------------------------------------

function CommitmentForm({
  driverUsername,
  onMsg,
  onDone,
}: {
  driverUsername: string;
  onMsg: (m: string | null) => void;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<"by_date" | "every_n_days" | "weekends">("by_date");
  const [when, setWhen] = useState("");
  const [days, setDays] = useState("14");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    onMsg(null);
    try {
      const instant = when ? new Date(when).toISOString() : null;
      const res = await api.setHomeTimeCommitment({
        driverUsername,
        kind,
        homeByAt: kind === "by_date" ? instant : null,
        everyNDays: kind === "every_n_days" ? Number(days) || null : null,
        anchorAt: kind === "every_n_days" ? instant : null,
        effectiveTo: null,
        note: note.trim() ? note.trim() : null,
      });
      if (!res.ok) {
        onMsg(res.error ?? "That commitment didn't save.");
        return;
      }
      onMsg("Commitment recorded — it's on the sealed record, and loads that would break it stop for an override first.");
      setWhen("");
      setNote("");
      onDone();
    } catch {
      onMsg("That didn't save — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 rounded-lg bg-[var(--surface)] px-3 py-2.5">
      <p className="text-xs font-bold">Set a home-time commitment</p>
      <div className="mt-2 grid gap-2">
        <label className="text-xs text-[var(--dim)]">
          Pattern
          <select className={INPUT} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Commitment pattern">
            <option value="by_date">Home by a date</option>
            <option value="every_n_days">Home every N days</option>
            <option value="weekends">Home every weekend (by Saturday)</option>
          </select>
        </label>
        {kind === "by_date" && (
          <label className="text-xs text-[var(--dim)]">
            Home by
            <input type="datetime-local" className={INPUT} value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Home by date and time" />
          </label>
        )}
        {kind === "every_n_days" && (
          <>
            <label className="text-xs text-[var(--dim)]">
              Every how many days (2–90)
              <input type="number" min={2} max={90} className={INPUT} value={days} onChange={(e) => setDays(e.target.value)} aria-label="Days between home times" />
            </label>
            <label className="text-xs text-[var(--dim)]">
              Counting from a home-by date
              <input type="datetime-local" className={INPUT} value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Anchor home-by date and time" />
            </label>
          </>
        )}
        <label className="text-xs text-[var(--dim)]">
          Note (optional)
          <input className={INPUT} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="What this home time is for" aria-label="Commitment note" />
        </label>
        <div>
          <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => void submit()}>
            {busy ? "Recording…" : "Record commitment"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CommitmentList({
  commitments,
  canVoid,
  onMsg,
  onDone,
}: {
  commitments: Commitment[];
  /** (c) => whether THIS viewer may end this commitment — the
   * server enforces the same rule; this only shapes the button. */
  canVoid: (c: Commitment) => boolean;
  onMsg: (m: string | null) => void;
  onDone: () => void;
}) {
  const [busyId, setBusyId] = useState<number | null>(null);
  if (commitments.length === 0) {
    return <p className="mt-2 text-sm text-[var(--dim)]">No commitments on record.</p>;
  }
  return (
    <ul className="mt-2 space-y-2">
      {commitments.map((c) => (
        <li key={c.id} className="rounded-lg bg-[var(--surface)] px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm">
              <strong>{c.description}</strong>
              <span className="ml-2 rounded-full bg-[var(--surface2)] px-2 py-0.5 text-[10px] font-bold text-[var(--dim)]">
                {c.setBy === "driver" ? "DRIVER-STATED" : "FLEET-STATED"}
              </span>
              {c.voided && (
                <span className="ml-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold text-red-300">ENDED</span>
              )}
            </span>
            {!c.voided && canVoid(c) && (
              <button
                type="button"
                className={BTN}
                disabled={busyId != null}
                onClick={() => {
                  setBusyId(c.id);
                  void api
                    .voidHomeTimeCommitment({ commitmentId: c.id })
                    .then((res) => {
                      onMsg(res.ok ? "Commitment ended — it stays on the record, marked ended, and stops producing deadlines." : (res.error ?? "That didn't go through."));
                      if (res.ok) onDone();
                    })
                    .catch(() => onMsg("That didn't go through — check your connection and try again."))
                    .finally(() => setBusyId(null));
                }}
              >
                {busyId === c.id ? "Ending…" : "End commitment"}
              </button>
            )}
          </div>
          <p className="mt-0.5 text-xs text-[var(--dim)]">
            Stated by @{c.createdBy}
            {c.note ? ` · ${c.note}` : ""}
            {c.voided ? " · ended" : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// The pulse check — the driver's own surface. Answers and the
// note live here and in the driver's own record only.
// ---------------------------------------------------------------------------

function PulseBlock({ data, onMsg, onDone }: { data: HomeTimeData; onMsg: (m: string | null) => void; onDone: () => void }) {
  const pulse = data.pulse;
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  if (!pulse) return null;

  if (pulse.status === "answered") {
    return (
      <div className="mt-3 rounded-lg bg-[var(--surface)] px-3 py-2.5">
        <p className="text-xs font-bold">📋 Pulse check — answered this round ✓</p>
        <ul className="mt-1 space-y-0.5">
          {QUESTIONS.map((q) => (
            <li key={q.key} className="text-xs text-[var(--dim)]">
              {q.label} — <strong className="text-[var(--text)]">{pulse.myAnswers?.[q.key] ?? "—"} of 5</strong>
            </li>
          ))}
        </ul>
        {pulse.myNote && <p className="mt-1 text-xs text-[var(--dim)]">Your note: “{pulse.myNote}” — only you see this.</p>}
        <p className="mt-1 text-xs text-[var(--dim)]">The next round opens {fmtWhen(pulse.nextAt)}. Your fleet sees averages only, and only when 3+ drivers answer.</p>
      </div>
    );
  }
  if (pulse.status === "dismissed") {
    return (
      <p className="mt-3 text-xs text-[var(--dim)]">📋 Pulse check skipped this round — the next one opens {fmtWhen(pulse.nextAt)}.</p>
    );
  }
  const complete = QUESTIONS.every((q) => picks[q.key] != null);
  return (
    <div className="mt-3 rounded-lg bg-[var(--surface)] px-3 py-2.5">
      <p className="text-xs font-bold">📋 Quick pulse check — three questions, ten seconds</p>
      <p className="mt-0.5 text-xs leading-relaxed text-[var(--dim)]">
        Your answers are your own record. Your fleet sees averages only, and only when 3+ drivers answer in the window —
        never your answers, never your note.
      </p>
      {QUESTIONS.map((q) => (
        <div key={q.key} className="mt-2">
          <p className="text-xs font-semibold">{q.label}</p>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="text-[10px] text-[var(--dim)]">{q.low}</span>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                aria-label={`${q.label} — ${n} of 5`}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-bold ${picks[q.key] === n ? "bg-[var(--accent)] text-white" : "bg-[var(--surface2)] border border-[var(--border)]"}`}
                onClick={() => setPicks((p) => ({ ...p, [q.key]: n }))}
              >
                {n}
              </button>
            ))}
            <span className="text-[10px] text-[var(--dim)]">{q.high}</span>
          </div>
        </div>
      ))}
      <input
        className={`${INPUT} mt-2`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        placeholder="Anything to add? (optional — only you ever see this)"
        aria-label="Pulse note, private to you"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className={BTN_PRIMARY}
          disabled={busy || !complete}
          onClick={() => {
            setBusy(true);
            void api
              .answerPulse({ answers: picks, note: note.trim() ? note.trim() : null })
              .then((res) => {
                onMsg(res.ok ? "Pulse recorded — thank you. It's your record; the fleet sees averages only at 3+ drivers." : (res.error ?? "That didn't save."));
                if (res.ok) onDone();
              })
              .catch(() => onMsg("That didn't save — check your connection and try again."))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Saving…" : "Send answers"}
        </button>
        <button
          type="button"
          className={BTN}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void api
              .dismissPulse({})
              .then(() => onDone())
              .catch(() => onMsg("That didn't go through — check your connection and try again."))
              .finally(() => setBusy(false));
          }}
        >
          Not now
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The driver's own card — Money tab, beside the qualification file.
// ---------------------------------------------------------------------------

export function MyHomeTimeCard() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["home-time", "me"], queryFn: () => api.getHomeTime({ driverUsername: null }) });
  if (q.isPending) return null;
  const data = q.data;
  if (!data?.ok) return null; // not in a company — no fleet record to show
  const refresh = () => void qc.invalidateQueries({ queryKey: ["home-time"] });

  return (
    <section className={SECTION} aria-label="My home time">
      <h3 className="font-condensed text-lg font-semibold">🏠 My home time</h3>
      <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
        Your home-time commitments — the terms you stated, or your fleet stated for you. A load that would break one
        stops before it binds and shows the math; binding it anyway takes an override with a reason, sealed on the
        record. A term you set yourself can only be overridden by you.
      </p>
      {msg && (
        <p className="mt-2 rounded-lg bg-[var(--surface)] px-2.5 py-2 text-xs" role="status">
          {msg}
        </p>
      )}
      {data.nextDeadlineAt ? (
        <p className="mt-2 text-sm">
          Next deadline: <strong>{data.nextDescription}</strong> — {fmtWhen(data.nextDeadlineAt)}
        </p>
      ) : (
        <p className="mt-2 text-sm text-[var(--dim)]">No deadline on the table right now.</p>
      )}
      <p className="mt-1 text-xs text-[var(--dim)]">
        {data.homeCity || data.homeState
          ? `Home on your profile: ${[data.homeCity, data.homeState].filter(Boolean).join(", ")} — home arrivals are proven from your sealed duty record at that place.`
          : "No home place on your profile yet — add it under Settings → My social profile, and home arrivals can be proven from your sealed duty record. Without it, deadlines read “no home record” rather than a guess."}
      </p>
      <CommitmentList commitments={data.commitments} canVoid={() => true} onMsg={setMsg} onDone={refresh} />
      <CommitmentForm driverUsername={data.driverUsername ?? ""} onMsg={setMsg} onDone={refresh} />
      <div className="mt-3">
        <p className="text-xs font-bold">How the last 90 days went</p>
        <HitRateLine hr={data.hitRate} />
        {data.outcomes.length > 0 && (
          <ul className="mt-1.5 space-y-1">
            {data.outcomes.slice(-6).reverse().map((o) => {
              const chip = outcomeChip(o.outcome);
              return (
                <li key={`${o.commitmentId}-${o.deadlineAt}`} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${chip.cls}`}>{chip.label}</span>
                  <span className="font-semibold">{fmtWhen(o.deadlineAt)}</span>
                  <span className="text-[var(--dim)]">{o.detail}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {data.signals.length > 0 && (
        <div className="mt-3 rounded-lg bg-[var(--surface)] px-3 py-2.5">
          <p className="text-xs font-bold">From your sealed records</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {data.signals.map((s) => (
              <li key={s.key} className="text-xs leading-relaxed text-[var(--dim)]">{s.detail}</li>
            ))}
          </ul>
        </div>
      )}
      <PulseBlock data={data} onMsg={setMsg} onDone={refresh} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// One driver's record, opened from the fleet panel.
// ---------------------------------------------------------------------------

function DriverHomeTimeView({ driverUsername, onMsg }: { driverUsername: string; onMsg: (m: string | null) => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["home-time", driverUsername],
    queryFn: () => api.getHomeTime({ driverUsername }),
  });
  if (q.isPending) return <p className="mt-2 text-xs text-[var(--dim)]">Loading @{driverUsername}'s record…</p>;
  const data = q.data;
  if (!data?.ok) return <p className="mt-2 text-xs text-red-300">{data?.error ?? "That record didn't load."}</p>;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["home-time"] });
    void qc.invalidateQueries({ queryKey: ["fleet-home-time"] });
  };
  return (
    <div className="mt-2">
      {data.nextDeadlineAt ? (
        <p className="text-xs">
          Next deadline: <strong>{data.nextDescription}</strong> — {fmtWhen(data.nextDeadlineAt)}
        </p>
      ) : (
        <p className="text-xs text-[var(--dim)]">No deadline on the table.</p>
      )}
      <HitRateLine hr={data.hitRate} />
      <CommitmentList
        commitments={data.commitments}
        canVoid={(c) => c.setBy === "fleet"}
        onMsg={onMsg}
        onDone={refresh}
      />
      <p className="mt-1 text-[11px] text-[var(--dim)]">
        The desk can end fleet-stated terms. A term the driver stated is theirs alone to end or override.
      </p>
      <CommitmentForm driverUsername={driverUsername} onMsg={onMsg} onDone={refresh} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// The fleet board — Owner / Dispatch desks.
// ---------------------------------------------------------------------------

export function FleetHomeTimePanel() {
  const q = useQuery({ queryKey: ["fleet-home-time"], queryFn: () => api.getFleetHomeTime({}) });
  const [openDriver, setOpenDriver] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const data: FleetData | undefined = q.data;
  if (q.isPending) return null;
  if (!data?.ok) return null; // drivers don't get the board — their own record lives in the Money tab

  return (
    <section className={SECTION} aria-label="Home time and retention">
      <h3 className="font-condensed text-lg font-semibold">🏠 Home time &amp; retention</h3>
      <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
        Every driver's home-time commitments and how the deadlines actually went, from sealed records. A load that
        would break a commitment stops at claim / assign / accept for an override with a reason — and a term the
        driver stated themselves can only be overridden by that driver. Signals below are objective facts worth a
        check-in, never a verdict on a person. Detention and miles facts refresh when the driver opens their own
        record; the date rides along.
      </p>
      {msg && (
        <p className="mt-2 rounded-lg bg-[var(--surface)] px-2.5 py-2 text-xs" role="status">
          {msg}
        </p>
      )}
      <ul className="mt-3 space-y-2">
        {data.drivers.map((d: FleetDriver) => {
          const open = openDriver === d.username;
          return (
            <li key={d.username} className="rounded-lg bg-[var(--surface)] px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">
                  <strong>@{d.username}</strong>
                  <span className="ml-2 text-xs text-[var(--dim)]">
                    {d.commitmentCount} active commitment{d.commitmentCount === 1 ? "" : "s"}
                    {d.nextDeadlineAt ? ` · next: ${d.nextDescription} — ${fmtWhen(d.nextDeadlineAt)}` : " · no deadline on the table"}
                  </span>
                </span>
                <button type="button" className={BTN} onClick={() => setOpenDriver(open ? null : d.username)}>
                  {open ? "Close record" : "Open record"}
                </button>
              </div>
              <HitRateLine hr={d.hitRate} />
              {d.signals.length > 0 && (
                <div className="mt-1.5 rounded-lg bg-amber-500/10 px-2.5 py-2">
                  <p className="text-[11px] font-bold text-amber-200">Worth a check-in — from sealed records:</p>
                  <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                    {d.signals.map((s) => (
                      <li key={s.key} className="text-xs leading-relaxed">{s.detail}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="mt-1 text-[11px] text-[var(--dim)]">
                {d.factsAsOf
                  ? `Detention / miles facts as of ${fmtWhen(d.factsAsOf)} (refreshed when the driver opens their record).`
                  : "Detention / miles facts land here after the driver first opens their home-time record."}
              </p>
              {open && <DriverHomeTimeView driverUsername={d.username} onMsg={setMsg} />}
            </li>
          );
        })}
      </ul>
      {data.drivers.length === 0 && <p className="mt-2 text-sm text-[var(--dim)]">No drivers on the roster yet.</p>}
      <div className="mt-3 rounded-lg bg-[var(--surface)] px-3 py-2.5">
        <p className="text-xs font-bold">📋 Pulse check — fleet aggregate (last 28 days)</p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
          {data.pulse.respondentCount} of {data.pulse.driverCount} driver{data.pulse.driverCount === 1 ? "" : "s"} answered.
          {data.pulse.averages == null &&
            ` Averages stay hidden until ${data.pulse.minRespondents}+ drivers answer — with fewer, an average would point at a person. Individual answers and notes are never shown here.`}
        </p>
        {data.pulse.averages != null && (
          <ul className="mt-1.5 space-y-0.5">
            {QUESTIONS.map((qq) => (
              <li key={qq.key} className="text-xs">
                {qq.label} — <strong>average {data.pulse.averages?.[qq.key] ?? "—"} of 5</strong>{" "}
                <span className="text-[var(--dim)]">({qq.low} → {qq.high})</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
