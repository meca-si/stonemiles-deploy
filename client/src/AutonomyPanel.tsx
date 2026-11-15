// STONEMILES Autonomy core UI (Research Wave 2 item 1) — compact
// surfaces for the automatic status system:
//
//   LoadAutonomyBlock — on a load (DeliveryCloseout): the
//     automatic status timeline that publishes itself from sealed
//     records, the full update list with a Withdraw (correction)
//     control on each live update, and this load's open exceptions
//     with their resolve controls.
//   ExceptionQueuePanel — in the Owner / Dispatch desks (beside
//     the fleet board) and the Broker Desk: the caller's ranked
//     exception queue across their roles. An exception is a spot
//     where the automatic status HELD BACK instead of guessing —
//     nothing on it ever went out to a tracking page.
//
// Resolving never invents a status: it supplies the one missing
// fact the kind accepts (an appointment time) or dismisses with a
// note. Both paths land on the sealed record server-side. Plain
// wording throughout; no percentages, no money numbers — and no
// rate exists in any of these payloads by design.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";

type QueueData = ApiResponse<typeof api, "getExceptionQueue">;
type LoadAutoData = ApiResponse<typeof api, "getLoadAutonomy">;

interface ExceptionLike {
  id: number;
  loadId: number;
  lane: string | null;
  kind: string;
  kindLabel: string;
  severity: number;
  detail: string;
  evidence: { kind: string; ref: string; at: string | null; note: string }[];
  audiences: string[];
  createdAt: string;
}

function whenLabel(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function severityLabel(severity: number): string {
  if (severity >= 3) return "Urgent";
  if (severity === 2) return "Needs a look";
  return "Minor";
}

const BTN = "rounded-lg bg-[var(--surface)] border border-[var(--border)] px-3 py-2 text-xs font-bold disabled:opacity-50";
const INPUT = "min-w-0 flex-1 rounded-lg bg-[var(--surface)] px-2 py-2 text-xs";

function ResolveControls({ item, onDone }: { item: ExceptionLike; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [appt, setAppt] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = (resolution: "supplied_fact" | "dismissed") => {
    setBusy(true);
    setMsg(null);
    void api
      .resolveException({
        exceptionId: item.id,
        resolution,
        note: note.trim() ? note.trim() : null,
        appointmentAt: resolution === "supplied_fact" && appt ? new Date(appt).toISOString() : null,
      })
      .then((r) => {
        if (r.ok) onDone();
        else setMsg(r.error ?? "Couldn't save that.");
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="mt-2 space-y-2">
      {item.kind === "missing_appointment" && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="datetime-local"
            className={INPUT}
            value={appt}
            onChange={(e) => setAppt(e.target.value)}
            aria-label="Appointment date and time"
          />
          <button type="button" className={BTN} disabled={busy || !appt} onClick={() => run("supplied_fact")}>
            Save appointment
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          className={INPUT}
          placeholder="Note for the sealed record (needed to dismiss)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
        />
        <button type="button" className={BTN} disabled={busy || !note.trim()} onClick={() => run("dismissed")}>
          Dismiss with note
        </button>
      </div>
      {msg && <div className="text-xs text-red-300">{msg}</div>}
    </div>
  );
}

function ExceptionCard({ item, onDone }: { item: ExceptionLike; onDone: () => void }) {
  return (
    <li className="rounded-lg bg-[var(--surface)] px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">
          Load #{item.loadId} — {item.kindLabel}
        </span>
        <span className="rounded-full bg-[var(--surface2)] px-2.5 py-0.5 text-xs font-bold text-[var(--accent)]">
          {severityLabel(item.severity)}
        </span>
      </div>
      {item.lane && <div className="mt-0.5 text-xs text-[var(--dim)]">{item.lane}</div>}
      <p className="mt-1 text-xs leading-relaxed">{item.detail}</p>
      {item.evidence.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs leading-relaxed text-[var(--dim)]">
          {item.evidence.map((e, i) => (
            <li key={i}>
              Evidence: {e.note}
              {e.at ? ` (${whenLabel(e.at)})` : ""}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-0.5 text-xs text-[var(--dim)]">Open since {whenLabel(item.createdAt)}</div>
      <ResolveControls item={item} onDone={onDone} />
    </li>
  );
}

export function ExceptionQueuePanel({ brokerOnly = false }: { brokerOnly?: boolean }) {
  const queryClient = useQueryClient();
  const queueQuery = useQuery({
    queryKey: ["exception-queue"],
    queryFn: () => api.getExceptionQueue({}),
    refetchInterval: 60000,
  });
  const data: QueueData | undefined = queueQuery.data;
  if (!data) return null;
  const items = brokerOnly ? data.items.filter((i) => i.audiences.includes("broker")) : data.items;
  if (items.length === 0) return null;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["exception-queue"] });
  };
  return (
    <section className="mt-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3" aria-label="Exception queue">
      <h3 className="font-condensed text-lg font-semibold">⚠️ Needs a look — held-back status updates ({items.length})</h3>
      <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
        These are spots where the automatic status held back instead of guessing — nothing here went out to a
        tracking page. Supply the missing fact or dismiss with a note; either way it lands on the sealed record.
      </p>
      <ul className="mt-2 space-y-2">
        {items.map((item) => (
          <ExceptionCard key={item.id} item={item} onDone={refresh} />
        ))}
      </ul>
    </section>
  );
}

export function LoadAutonomyBlock({ loadId }: { loadId: number }) {
  const queryClient = useQueryClient();
  const autoQuery = useQuery({
    queryKey: ["load-autonomy", loadId],
    queryFn: () => api.getLoadAutonomy({ loadId }),
  });
  const [voidingId, setVoidingId] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const data: LoadAutoData | undefined = autoQuery.data;
  if (!data?.ok) return null;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["load-autonomy", loadId] });
    void queryClient.invalidateQueries({ queryKey: ["exception-queue"] });
  };
  const liveUpdates = data.updates.filter((u) => !u.superseded && u.kind !== "correction");
  return (
    <div>
      <div className="text-xs font-bold text-[var(--dim)]">AUTOMATIC STATUS — published from sealed records only</div>
      <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
        These updates post themselves from sealed records — pickup and delivery seals, detention clocks. Nothing
        goes out without a sealed record behind it, a held-back update lands in the exception queue instead, and
        the rate never rides along. Wrong one? Withdraw it — a correction takes its place on the tracking page.
      </p>
      {data.timeline.length === 0 ? (
        <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">No automatic updates yet for this load.</p>
      ) : (
        <ol className="mt-2 space-y-1.5">
          {data.timeline.map((t) => (
            <li key={t.id} className="rounded-lg bg-[var(--surface)] px-3 py-2 text-xs leading-relaxed">
              <span className="font-semibold">{t.corrected ? "Correction — " : ""}{t.label}</span>{" "}
              <span className="text-[var(--dim)]">{whenLabel(t.at)}</span>
            </li>
          ))}
        </ol>
      )}
      {liveUpdates.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {liveUpdates.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="min-w-0 flex-1">
                {u.label} <span className="text-[var(--dim)]">· {whenLabel(u.at)}</span>
              </span>
              {voidingId === u.id ? (
                <>
                  <input
                    type="text"
                    className={INPUT}
                    placeholder="Why is this being withdrawn?"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={300}
                  />
                  <button
                    type="button"
                    className={BTN}
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      void api
                        .voidAutoStatus({ outboxId: u.id, reason: reason.trim() ? reason.trim() : null })
                        .then((r) => {
                          if (r.ok) {
                            setVoidingId(null);
                            setReason("");
                            refresh();
                          } else setMsg(r.error ?? "Couldn't withdraw that update.");
                        })
                        .finally(() => setBusy(false));
                    }}
                  >
                    Confirm withdraw
                  </button>
                  <button type="button" className={BTN} disabled={busy} onClick={() => setVoidingId(null)}>
                    Keep it
                  </button>
                </>
              ) : (
                <button type="button" className={BTN} onClick={() => setVoidingId(u.id)}>
                  Withdraw
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {msg && <div className="mt-1 text-xs text-red-300">{msg}</div>}
      {data.exceptions.length > 0 && (
        <>
          <div className="mt-3 text-xs font-bold text-[var(--dim)]">HELD BACK ON THIS LOAD — needs a fact or a note</div>
          <ul className="mt-2 space-y-2">
            {data.exceptions.map((item) => (
              <ExceptionCard key={item.id} item={item} onDone={refresh} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
