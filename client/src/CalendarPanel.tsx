// CalendarPanel.tsx — the Driver Calendar (Wave 2 item 10.5).
//
// Its OWN top-level tab — not a card on another page. One calendar
// per driver: bound loads (whatever door they came through),
// off-duty blocks, home-time deadlines, credential expiries with
// their 60/30/7 renewal warnings, and paydays from the fleet's
// stated cycle. Week = working view, month = planning view; the
// top answers "What's my next move?"
//
// Desk roles (owner / dispatch) get a Fleet toggle: the fleet
// grid (drivers as rows over the week), the approval queues
// (time-off, release requests), reassignments with the owner's
// refusal override, and — owner only — the calendar settings
// (dispatch mode, safety window, pay cycle).
//
// Every button here is a real action call. All the rules — the
// safety window, consent, override authority, the item-9 gate —
// live server-side; this panel renders records and sends answers.
// No rate or money figure ever appears: the server doesn't send
// any on these payloads.

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";

type CalData = ApiResponse<typeof api, "getCalendar">;
type CalEvent = CalData["events"][number];
type FleetData = ApiResponse<typeof api, "getFleetCalendar">;
type FleetDriver = FleetData["drivers"][number];

const BTN = "btn-press rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-sm font-bold disabled:opacity-50";
const BTN_PRIMARY = "btn-neon btn-press rounded-xl px-4 py-2.5 text-sm font-bold disabled:opacity-50";
const BTN_DANGER = "btn-press rounded-xl bg-[var(--danger)] px-3.5 py-2.5 text-sm font-bold text-white disabled:opacity-50";
const INPUT = "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm";
const SECTION = "glass-panel p-4";

const DAY_MS = 86_400_000;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}
function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function chipCls(e: { kind: string; state: string | null }): string {
  switch (e.kind) {
    case "load":
      if (e.state === "offered") return "border border-dashed border-amber-400/70 bg-amber-500/15 text-amber-200";
      if (e.state === "locked") return "bg-red-500/20 text-red-200";
      return "bg-[var(--accent)]/20 text-[var(--text)]";
    case "off_duty":
      return "bg-emerald-500/20 text-emerald-200";
    case "off_duty_pending":
      return "border border-dashed border-emerald-400/60 bg-emerald-500/10 text-emerald-200";
    case "commitment":
      return "bg-violet-500/20 text-violet-200";
    case "credential_expiry":
      return "bg-red-500/25 text-red-100 font-bold";
    case "credential_warning":
      return "bg-amber-500/20 text-amber-200";
    case "payday":
      return e.state === "paid" ? "bg-emerald-500/20 text-emerald-200" : "border border-[var(--border)] bg-[var(--surface)] text-[var(--dim)]";
    default:
      return "bg-[var(--surface)] text-[var(--text)]";
  }
}

function chipLabel(e: CalEvent): string {
  switch (e.kind) {
    case "load":
      return `🚛 ${e.title}`;
    case "off_duty":
      return `🏠 ${e.title}`;
    case "off_duty_pending":
      return `🏠 ${e.title} (pending)`;
    case "commitment":
      return `⏰ ${e.title}`;
    case "credential_expiry":
      return `🪪 ${e.title}`;
    case "credential_warning":
      return `⚠️ ${e.title}`;
    case "payday":
      return e.state === "paid" ? "💵 Payday — paid" : "💵 Payday — expected";
    default:
      return e.title;
  }
}

/** Bucket events onto local days; multi-day events (off-duty
 * blocks, loads with pickup→delivery spans) chip every day they
 * touch inside the visible window. */
function bucketEvents(events: CalEvent[], days: Date[]): Map<string, CalEvent[]> {
  const map = new Map<string, CalEvent[]>();
  const first = days[0]!.getTime();
  const last = days[days.length - 1]!.getTime() + DAY_MS - 1;
  for (const e of events) {
    const start = Math.max(new Date(e.at).getTime(), first);
    const end = Math.min(e.endAt ? new Date(e.endAt).getTime() : new Date(e.at).getTime(), last);
    if (end < first || start > last) continue;
    let t = startOfDay(new Date(start)).getTime();
    const endDay = startOfDay(new Date(end)).getTime();
    while (t <= endDay) {
      const k = dayKey(new Date(t));
      const arr = map.get(k) ?? [];
      arr.push(e);
      map.set(k, arr);
      t += DAY_MS;
    }
  }
  return map;
}

type HtPrompt = {
  summary: string;
  retry: (reason: string) => void;
};

export function CalendarPanel({ onOpenCredential }: { onOpenCredential: () => void }) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<"week" | "month">("week");
  const [anchor, setAnchor] = useState<Date>(() => startOfWeek(new Date()));
  const [fleetMode, setFleetMode] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string>(() => dayKey(new Date()));
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [htPrompt, setHtPrompt] = useState<HtPrompt | null>(null);
  const [htReason, setHtReason] = useState("");

  const windowStart = view === "week" ? startOfWeek(anchor) : startOfMonth(anchor);
  const windowEnd = view === "week" ? addDays(windowStart, 7) : new Date(windowStart.getFullYear(), windowStart.getMonth() + 1, 1);
  const fromIso = windowStart.toISOString();
  const toIso = windowEnd.toISOString();
  const days = useMemo(() => {
    const out: Date[] = [];
    for (let t = windowStart.getTime(); t < windowEnd.getTime(); t += DAY_MS) out.push(new Date(t));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromIso, toIso]);

  const calQuery = useQuery({
    queryKey: ["calendar", fromIso, toIso],
    // The device offset rides along so hand-typed load appointment
    // text ("Nov 24, 2026 9:00 PM") lands at that LOCAL time, not
    // five hours early as UTC (2026-11-24 fix).
    queryFn: () => api.getCalendar({ fromIso, toIso, utcOffsetMinutes: new Date().getTimezoneOffset() }),
  });
  const cal = calQuery.data;
  const isDesk = cal?.myRole === "owner" || cal?.myRole === "dispatch";

  const fleetWeekStart = startOfWeek(new Date());
  const fleetQuery = useQuery({
    queryKey: ["fleet-calendar", fleetWeekStart.toISOString()],
    queryFn: () => api.getFleetCalendar({ fromIso: fleetWeekStart.toISOString(), toIso: addDays(fleetWeekStart, 7).toISOString() }),
    enabled: fleetMode && isDesk,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["calendar"] });
    void queryClient.invalidateQueries({ queryKey: ["fleet-calendar"] });
    void queryClient.invalidateQueries({ queryKey: ["load-board"] });
    void queryClient.invalidateQueries({ queryKey: ["loads"] });
  };

  const act = async (key: string, fn: () => Promise<{ ok: boolean; error: string | null }>, success: string) => {
    setBusy(key);
    try {
      const res = await fn();
      if (!res.ok) {
        setBanner(res.error ?? "That didn't go through.");
        return false;
      }
      setBanner(success);
      refresh();
      return true;
    } catch {
      setBanner("That didn't go through — check your connection and try again.");
      return false;
    } finally {
      setBusy(null);
    }
  };

  // Same home-time override flow as the load board: the first
  // call goes without an override; if the server stops it over a
  // home-time commitment, the driver/desk confirms with a reason
  // and the call retries sealed with that reason.
  const actHt = async (
    key: string,
    call: (override: { reason: string } | null) => Promise<{ ok: boolean; error: string | null; homeTimeWarning?: { summary: string } | null }>,
    success: string,
    override: { reason: string } | null = null,
  ) => {
    setBusy(key);
    try {
      const res = await call(override);
      if (!res.ok) {
        if (res.homeTimeWarning) {
          setHtPrompt({
            summary: res.homeTimeWarning.summary,
            retry: (reason: string) => void actHt(key, call, success, { reason }),
          });
          setBanner(res.error ?? res.homeTimeWarning.summary);
        } else {
          setBanner(res.error ?? "That didn't go through.");
        }
        return;
      }
      setHtPrompt(null);
      setBanner(success);
      refresh();
    } catch {
      setBanner("That didn't go through — check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  const stepWindow = (dir: 1 | -1) => {
    setAnchor((a) => (view === "week" ? addDays(a, 7 * dir) : new Date(a.getFullYear(), a.getMonth() + dir, 1)));
  };

  const buckets = useMemo(() => bucketEvents(cal?.events ?? [], days), [cal, days]);
  const selectedEvents = (cal?.events ?? []).filter((e) => {
    const start = dayKey(new Date(e.at));
    const end = e.endAt ? dayKey(new Date(e.endAt)) : start;
    return selectedDay >= start && selectedDay <= end;
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-condensed text-2xl font-bold">📅 Calendar</h2>
          {/* SCHEDULE WORKSPACE (Five Workspaces naming pass,
              2026-11-15): the Calendar tab is the Schedule
              workspace's home — calendar + home time. */}
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--dim)]">Schedule workspace — calendar + home time</p>
        </div>
        {isDesk && (
          <div className="flex rounded-full border border-[var(--border)] bg-[var(--surface)] p-0.5" role="tablist" aria-label="Calendar view owner">
            <button type="button" className={`rounded-full px-3 py-1.5 text-xs font-bold ${!fleetMode ? "bg-[var(--accent)] text-white" : "text-[var(--dim)]"}`} onClick={() => setFleetMode(false)}>
              Mine
            </button>
            <button type="button" className={`rounded-full px-3 py-1.5 text-xs font-bold ${fleetMode ? "bg-[var(--accent)] text-white" : "text-[var(--dim)]"}`} onClick={() => setFleetMode(true)}>
              Fleet
            </button>
          </div>
        )}
      </div>

      {banner && (
        <p className="rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-2.5 text-sm leading-relaxed" role="status">
          {banner}
        </p>
      )}

      {htPrompt && (
        <section className={`${SECTION} border-amber-400/50`} aria-label="Home-time override">
          <div className="text-xs font-bold uppercase tracking-widest text-amber-300">Home-time conflict</div>
          <p className="mt-1 text-sm leading-relaxed">{htPrompt.summary}</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
            Binding it anyway takes a reason — it's sealed on the record and the other side is notified.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input className="min-w-[200px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm" value={htReason} onChange={(e) => setHtReason(e.target.value)} placeholder="Reason for the override" aria-label="Override reason" maxLength={300} />
            <button
              type="button"
              disabled={!htReason.trim() || busy != null}
              className={BTN_PRIMARY}
              onClick={() => {
                const r = htReason.trim();
                setHtReason("");
                htPrompt.retry(r);
              }}
            >
              Bind it anyway
            </button>
            <button type="button" className={BTN} onClick={() => setHtPrompt(null)}>
              Leave it
            </button>
          </div>
        </section>
      )}

      {!fleetMode && (
        <>
          {/* Next move */}
          <section className={SECTION} aria-label="Your next move">
            <div className="text-xs font-bold uppercase tracking-widest text-[var(--dim)]">What's my next move?</div>
            {calQuery.isLoading ? (
              <p className="mt-2 text-sm text-[var(--dim)]">Reading your calendar…</p>
            ) : cal?.nextMove ? (
              <p className="mt-1 text-base leading-relaxed">
                🚛 <strong>{cal.nextMove.lane}</strong> — {fmtWhen(cal.nextMove.at)}
                <span className="text-[var(--dim)]"> · committed work</span>
              </p>
            ) : (
              <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">Nothing bound right now. Offers, time-off and deadlines will show here as they land.</p>
            )}
            {cal?.companyName && (
              <p className="mt-1 text-xs text-[var(--dim)]">
                {cal.companyName}
                {cal.settings ? ` · dispatch mode: ${cal.settings.dispatchMode === "assigned" ? "Assigned (loads land committed)" : "Offered (you answer each load)"} · decline cutoff ${cal.settings.safetyWindowHours}h before pickup` : ""}
              </p>
            )}
          </section>

          {/* Waiting on the driver */}
          <DriverQueues
            cal={cal}
            busy={busy}
            act={act}
            actHt={actHt}
          />

          {/* The grid */}
          <section className={SECTION} aria-label="Calendar grid">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex rounded-full border border-[var(--border)] bg-[var(--surface)] p-0.5" role="tablist" aria-label="Week or month">
                <button
                  type="button"
                  className={`rounded-full px-3 py-1.5 text-xs font-bold ${view === "week" ? "bg-[var(--accent)] text-white" : "text-[var(--dim)]"}`}
                  onClick={() => {
                    setView("week");
                    setAnchor(startOfWeek(new Date()));
                  }}
                >
                  Week
                </button>
                <button
                  type="button"
                  className={`rounded-full px-3 py-1.5 text-xs font-bold ${view === "month" ? "bg-[var(--accent)] text-white" : "text-[var(--dim)]"}`}
                  onClick={() => {
                    setView("month");
                    setAnchor(startOfMonth(new Date()));
                  }}
                >
                  Month
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <button type="button" className={BTN} aria-label="Previous" onClick={() => stepWindow(-1)}>
                  ‹
                </button>
                <span className="min-w-[130px] text-center font-condensed text-base font-bold">
                  {view === "week" ? `Week of ${windowStart.toLocaleDateString([], { month: "short", day: "numeric" })}` : windowStart.toLocaleDateString([], { month: "long", year: "numeric" })}
                </span>
                <button type="button" className={BTN} aria-label="Next" onClick={() => stepWindow(1)}>
                  ›
                </button>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase tracking-wide text-[var(--dim)]">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {days.map((d) => {
                const k = dayKey(d);
                const evts = buckets.get(k) ?? [];
                const isToday = k === dayKey(new Date());
                const isSelected = k === selectedDay;
                const inMonth = view === "week" || d.getMonth() === windowStart.getMonth();
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setSelectedDay(k)}
                    aria-label={`${d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })} — ${evts.length} item${evts.length === 1 ? "" : "s"}`}
                    className={`min-h-[64px] rounded-lg border p-1 text-left align-top ${isSelected ? "border-[var(--accent)]" : "border-[var(--glass-border)]"} ${inMonth ? "bg-[var(--surface)]" : "bg-transparent opacity-45"}`}
                  >
                    <div className={`text-[11px] font-bold ${isToday ? "neon-text" : "text-[var(--dim)]"}`}>{d.getDate()}</div>
                    <div className="mt-0.5 space-y-0.5">
                      {evts.slice(0, view === "week" ? 4 : 3).map((e, i) => (
                        <div key={`${e.kind}-${e.boardLoadId ?? e.requestId ?? e.title}-${i}`} className={`truncate rounded px-1 py-px text-[9px] leading-tight ${chipCls(e)}`}>
                          {chipLabel(e)}
                        </div>
                      ))}
                      {evts.length > (view === "week" ? 4 : 3) && <div className="px-1 text-[9px] font-bold text-[var(--dim)]">+{evts.length - (view === "week" ? 4 : 3)} more</div>}
                    </div>
                  </button>
                );
              })}
            </div>

            <p className="mt-2 text-[11px] leading-relaxed text-[var(--dim)]">
              🚛 load · 🏠 time off (dashed = waiting on the desk) · ⏰ home-time deadline · 🪪 document expiry (red) with ⚠️ renewal warnings at 60/30/7 days · 💵 payday — expected until the payment is recorded.
            </p>

            {/* Selected day detail */}
            <div className="mt-3 rounded-xl bg-[var(--surface)] px-3 py-3">
              <div className="text-xs font-bold uppercase tracking-widest text-[var(--dim)]">{fmtDay(new Date(`${selectedDay}T12:00:00`).toISOString())}</div>
              {selectedEvents.length === 0 ? (
                <p className="mt-1 text-sm text-[var(--dim)]">Nothing on this day.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {selectedEvents.map((e, i) => (
                    <li key={`${e.kind}-${e.boardLoadId ?? e.requestId ?? e.title}-${i}`} className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] ${chipCls(e)}`}>{chipLabel(e)}</span>
                        <span className="ml-2 text-xs text-[var(--dim)]">
                          {fmtWhen(e.at)}
                          {e.endAt ? ` → ${fmtWhen(e.endAt)}` : ""}
                        </span>
                        {e.detail && <div className="mt-0.5 text-xs leading-relaxed text-[var(--dim)]">{e.detail}</div>}
                      </div>
                      {(e.kind === "credential_expiry" || e.kind === "credential_warning") && (
                        <button type="button" className={BTN} onClick={onOpenCredential}>
                          Open credential record
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* Time off */}
          <OffDutySection cal={cal} busy={busy} act={act} />
        </>
      )}

      {fleetMode && isDesk && <FleetSection data={fleetQuery.data} loading={fleetQuery.isLoading} busy={busy} act={act} actHt={actHt} weekStart={fleetWeekStart} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Driver queues — offers, reassignment consent, bound-load exits.
// ---------------------------------------------------------------------------

function DriverQueues({
  cal,
  busy,
  act,
  actHt,
}: {
  cal: CalData | undefined;
  busy: string | null;
  act: (key: string, fn: () => Promise<{ ok: boolean; error: string | null }>, success: string) => Promise<boolean>;
  actHt: (
    key: string,
    call: (override: { reason: string } | null) => Promise<{ ok: boolean; error: string | null; homeTimeWarning?: { summary: string } | null }>,
    success: string,
  ) => Promise<void>;
}) {
  const [reasonFor, setReasonFor] = useState<number | null>(null);
  const [reasonText, setReasonText] = useState("");
  if (!cal) return null;
  const hasWork = cal.pendingOffers.length > 0 || cal.pendingReassignments.length > 0 || cal.boundLoads.length > 0;
  if (!hasWork) return null;

  const reasonBox = (id: number, placeholder: string) =>
    reasonFor === id ? (
      <span className="flex w-full flex-wrap items-center gap-2">
        <input className="min-w-[200px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm" value={reasonText} onChange={(e) => setReasonText(e.target.value)} placeholder={placeholder} aria-label="Reason" maxLength={300} />
      </span>
    ) : null;

  return (
    <>
      {cal.pendingOffers.length > 0 && (
        <section className={SECTION} aria-label="Loads offered to you">
          <div className="text-xs font-bold uppercase tracking-widest text-amber-300">Offered to you — waiting on your answer</div>
          <ul className="mt-2 space-y-3">
            {cal.pendingOffers.map((o) => (
              <li key={o.boardLoadId} className="rounded-xl bg-[var(--surface)] px-3 py-3">
                <div className="font-semibold">🚛 {o.lane}</div>
                <div className="mt-0.5 text-xs text-[var(--dim)]">
                  {o.pickupAt ? `Pickup ${fmtWhen(o.pickupAt)}` : "Pickup time not set"}
                  {o.deliveryAt ? ` · Deliver ${fmtWhen(o.deliveryAt)}` : ""}
                </div>
                {o.locked ? (
                  <>
                    <p className="mt-1 text-xs leading-relaxed text-red-300">🔒 Inside the safety window — this offer is locked. If you can't run it, ask the desk for a release.</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {reasonBox(o.boardLoadId, "Why do you need a release? The desk decides.")}
                      {reasonFor === o.boardLoadId ? (
                        <>
                          <button
                            type="button"
                            disabled={busy != null || !reasonText.trim()}
                            className={BTN_DANGER}
                            onClick={() => {
                              void act(`release-${o.boardLoadId}`, () => api.requestLoadRelease({ id: o.boardLoadId, reason: reasonText.trim() }), "Release requested — the desk decides, and you're notified either way.");
                              setReasonFor(null);
                              setReasonText("");
                            }}
                          >
                            Send release request
                          </button>
                          <button type="button" className={BTN} onClick={() => setReasonFor(null)}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button type="button" className={BTN} onClick={() => { setReasonFor(o.boardLoadId); setReasonText(""); }}>
                          Ask for a release
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy != null}
                      className={BTN_PRIMARY}
                      onClick={() => void actHt(`accept-${o.boardLoadId}`, (ov) => api.acceptAssignedLoad({ id: o.boardLoadId, homeTimeOverride: ov }), `Accepted — ${o.lane} is committed on your calendar.`)}
                    >
                      ✅ Accept
                    </button>
                    {reasonBox(o.boardLoadId, "Why not? The desk sees this reason.")}
                    {reasonFor === o.boardLoadId ? (
                      <>
                        <button
                          type="button"
                          disabled={busy != null || !reasonText.trim()}
                          className={BTN_DANGER}
                          onClick={() => {
                            void act(`decline-${o.boardLoadId}`, () => api.declineAssignedLoad({ id: o.boardLoadId, reason: reasonText.trim() }), "Declined — the load went back to the board with your reason.");
                            setReasonFor(null);
                            setReasonText("");
                          }}
                        >
                          Send decline
                        </button>
                        <button type="button" className={BTN} onClick={() => setReasonFor(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button type="button" className={BTN} onClick={() => { setReasonFor(o.boardLoadId); setReasonText(""); }}>
                        Decline
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {cal.pendingReassignments.length > 0 && (
        <section className={SECTION} aria-label="Reassignment requests waiting on your consent">
          <div className="text-xs font-bold uppercase tracking-widest text-violet-300">Dispatch wants to move a load off your calendar</div>
          <ul className="mt-2 space-y-3">
            {cal.pendingReassignments.map((p) => (
              <li key={p.id} className="rounded-xl bg-[var(--surface)] px-3 py-3">
                <div className="font-semibold">🚛 {p.lane} → @{p.toDriver}</div>
                <div className="mt-0.5 text-xs text-[var(--dim)]">Proposed by @{p.proposedBy}</div>
                {p.reason && <p className="mt-1 text-sm leading-relaxed">“{p.reason}”</p>}
                <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">The move only happens if you agree. Saying no leaves the load on your calendar and tells the desk.</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" disabled={busy != null} className={BTN_PRIMARY} onClick={() => void act(`consent-${p.id}`, () => api.respondReassignment({ id: p.id, consent: true }), `Agreed — ${p.lane} moved to @${p.toDriver}.`)}>
                    Agree to the move
                  </button>
                  <button type="button" disabled={busy != null} className={BTN} onClick={() => void act(`refuse-${p.id}`, () => api.respondReassignment({ id: p.id, consent: false }), "You kept the load — the desk was notified.")}>
                    Say no — keep it
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {cal.boundLoads.length > 0 && (
        <section className={SECTION} aria-label="Your committed loads">
          <div className="text-xs font-bold uppercase tracking-widest text-[var(--dim)]">Committed loads</div>
          <ul className="mt-2 space-y-3">
            {cal.boundLoads.map((b) => (
              <li key={b.boardLoadId} className="rounded-xl bg-[var(--surface)] px-3 py-3">
                <div className="font-semibold">🚛 {b.lane}</div>
                <div className="mt-0.5 text-xs text-[var(--dim)]">
                  {b.pickupAt ? `Pickup ${fmtWhen(b.pickupAt)}` : "Pickup time not set"}
                  {b.deliveryAt ? ` · Deliver ${fmtWhen(b.deliveryAt)}` : ""}
                </div>
                {b.locked ? (
                  <p className="mt-1 text-xs leading-relaxed text-red-300">🔒 Inside the safety window — locked in. Emergencies go through the desk with a release request.</p>
                ) : b.cutoffAt ? (
                  <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">Free to decline until {fmtWhen(b.cutoffAt)} — after that it locks.</p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  {reasonBox(b.boardLoadId, b.locked ? "Why do you need a release? The desk decides." : "Why are you handing this back? The desk sees it.")}
                  {b.releasePending ? (
                    <span className="rounded-lg bg-[var(--surface2)] px-3 py-2.5 text-xs font-bold text-amber-200">Release requested — waiting on the desk</span>
                  ) : reasonFor === b.boardLoadId ? (
                    <>
                      <button
                        type="button"
                        disabled={busy != null || !reasonText.trim()}
                        className={BTN_DANGER}
                        onClick={() => {
                          if (b.locked) {
                            void act(`release-${b.boardLoadId}`, () => api.requestLoadRelease({ id: b.boardLoadId, reason: reasonText.trim() }), "Release requested — the desk decides, and you're notified either way.");
                          } else {
                            void act(`unbind-${b.boardLoadId}`, () => api.declineBoundLoad({ id: b.boardLoadId, reason: reasonText.trim() }), "Handed back — the load is on the board again with your reason recorded.");
                          }
                          setReasonFor(null);
                          setReasonText("");
                        }}
                      >
                        {b.locked ? "Send release request" : "Send hand-back"}
                      </button>
                      <button type="button" className={BTN} onClick={() => setReasonFor(null)}>
                        Cancel
                      </button>
                    </>
                  ) : b.locked ? (
                    <button type="button" className={BTN} onClick={() => { setReasonFor(b.boardLoadId); setReasonText(""); }}>
                      Ask for a release
                    </button>
                  ) : b.canDecline ? (
                    <button type="button" className={BTN} onClick={() => { setReasonFor(b.boardLoadId); setReasonText(""); }}>
                      Hand this load back
                    </button>
                  ) : (
                    <span className="text-xs text-[var(--dim)]">This load is underway — it can't be handed back from here.</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {cal.myReleaseRequests.length > 0 && (
            <p className="mt-2 text-xs leading-relaxed text-[var(--dim)]">
              Your release requests:{" "}
              {cal.myReleaseRequests.slice(0, 5).map((r) => `#${r.id} ${r.status}`).join(" · ")}
            </p>
          )}
        </section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Off-duty requests — the form + my record.
// ---------------------------------------------------------------------------

const OFF_DUTY_TYPES = [
  { value: "home_time", label: "Home time" },
  { value: "medical", label: "Medical / doctor visit (incl. DOT physical)" },
  { value: "family", label: "Family" },
  { value: "personal", label: "Personal" },
  { value: "reset", label: "34-hour reset" },
] as const;

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function OffDutySection({
  cal,
  busy,
  act,
}: {
  cal: CalData | undefined;
  busy: string | null;
  act: (key: string, fn: () => Promise<{ ok: boolean; error: string | null }>, success: string) => Promise<boolean>;
}) {
  const [type, setType] = useState<string>("home_time");
  const [start, setStart] = useState(() => toLocalInput(addDays(new Date(), 7)));
  const [end, setEnd] = useState(() => toLocalInput(addDays(new Date(), 9)));
  const [note, setNote] = useState("");
  if (!cal) return null;
  const needsApproval = cal.settings?.dispatchMode === "assigned" && cal.myRole === "driver";

  return (
    <section className={SECTION} aria-label="Time off">
      <div className="text-xs font-bold uppercase tracking-widest text-[var(--dim)]">Time off</div>
      <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
        {needsApproval
          ? "Your fleet runs Assigned — requests wait for the desk to approve before they count as commitments."
          : "Requests take effect as stated and become commitments the planning checks honor."}{" "}
        A 34-hour reset block must run at least 34 hours.
      </p>
      <div className="mt-3 grid gap-2">
        <label className="text-xs font-bold text-[var(--dim)]" htmlFor="cal-off-type">
          What kind of time off?
        </label>
        <select id="cal-off-type" className={INPUT} value={type} onChange={(e) => setType(e.target.value)}>
          {OFF_DUTY_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-bold text-[var(--dim)]" htmlFor="cal-off-start">
              Starts
            </label>
            <input id="cal-off-start" type="datetime-local" className={INPUT} value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-bold text-[var(--dim)]" htmlFor="cal-off-end">
              Ends
            </label>
            <input id="cal-off-end" type="datetime-local" className={INPUT} value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <input className={INPUT} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional) — e.g. DOT physical at the clinic" aria-label="Time-off note" maxLength={300} />
        <button
          type="button"
          disabled={busy != null || !start || !end}
          className={BTN_PRIMARY}
          onClick={() =>
            void act(
              "offduty",
              () =>
                api.requestOffDuty({
                  type: type as "home_time" | "medical" | "family" | "personal" | "reset",
                  startsAtIso: new Date(start).toISOString(),
                  endsAtIso: new Date(end).toISOString(),
                  note: note.trim() ? note.trim() : null,
                }),
              needsApproval ? "Requested — it's on your calendar as pending until the desk approves." : "On your calendar — and it counts as a commitment from the start you gave.",
            ).then((ok) => {
              if (ok) setNote("");
            })
          }
        >
          Request this time off
        </button>
      </div>

      {cal.myRequests.length > 0 && (
        <ul className="mt-3 space-y-2">
          {cal.myRequests.slice(0, 12).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--surface)] px-3 py-2.5">
              <div className="min-w-0 text-sm">
                <strong>{r.typeLabel}</strong>{" "}
                <span className="text-xs text-[var(--dim)]">
                  {fmtDay(r.startsAt)} → {fmtDay(r.endsAt)}
                </span>
                <span
                  className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                    r.status === "approved" ? "bg-emerald-500/15 text-emerald-300" : r.status === "pending" ? "bg-amber-500/15 text-amber-200" : r.status === "denied" ? "bg-red-500/15 text-red-300" : "bg-[var(--surface2)] text-[var(--dim)]"
                  }`}
                >
                  {r.status}
                </span>
                {r.note && <div className="text-xs text-[var(--dim)]">{r.note}</div>}
                {r.status === "denied" && r.decisionNote && <div className="text-xs text-red-300">Desk: “{r.decisionNote}”</div>}
              </div>
              {(r.status === "pending" || r.status === "approved") && (
                <button type="button" disabled={busy != null} className={BTN} onClick={() => void act(`cancel-req-${r.id}`, () => api.cancelOffDutyRequest({ id: r.id }), "Cancelled — the block is off your calendar and no longer counts as a commitment.")}>
                  Cancel
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Fleet section — the desk's grid + queues + settings.
// ---------------------------------------------------------------------------

type FleetEvent = FleetDriver["events"][number];

function fleetChipLabel(e: FleetEvent): string {
  switch (e.kind) {
    case "load":
      return `🚛 ${e.title}${e.state === "offered" ? " (offered)" : e.state === "locked" ? " (locked)" : ""}`;
    case "off_duty":
      return `🏠 ${e.title}`;
    case "off_duty_pending":
      return `🏠 ${e.title} (pending)`;
    case "commitment":
      return `⏰ ${e.title}`;
    case "payday":
      return e.state === "paid" ? "💵 Payday — paid" : "💵 Payday — expected";
    default:
      return e.title;
  }
}

function FleetSection({
  data,
  loading,
  busy,
  act,
  actHt,
  weekStart,
}: {
  data: FleetData | undefined;
  loading: boolean;
  busy: string | null;
  act: (key: string, fn: () => Promise<{ ok: boolean; error: string | null }>, success: string) => Promise<boolean>;
  actHt: (
    key: string,
    call: (override: { reason: string } | null) => Promise<{ ok: boolean; error: string | null; homeTimeWarning?: { summary: string } | null }>,
    success: string,
  ) => Promise<void>;
  weekStart: Date;
}) {
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [overrideFor, setOverrideFor] = useState<number | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [proposeLoad, setProposeLoad] = useState<string>("");
  const [proposeTarget, setProposeTarget] = useState<string>("");
  const [proposeReason, setProposeReason] = useState("");

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  if (loading || !data) {
    return (
      <section className={SECTION} aria-label="Fleet calendar">
        <p className="text-sm text-[var(--dim)]">Reading the fleet calendar…</p>
      </section>
    );
  }
  if (!data.ok) {
    return (
      <section className={SECTION} aria-label="Fleet calendar">
        <p className="text-sm leading-relaxed text-[var(--dim)]">{data.error ?? "The fleet calendar isn't available on this seat."}</p>
      </section>
    );
  }

  const fleetBuckets = new Map<string, Map<string, FleetEvent[]>>();
  for (const d of data.drivers) {
    fleetBuckets.set(d.username, bucketEvents(d.events as unknown as CalEvent[], weekDays) as unknown as Map<string, FleetEvent[]>);
  }
  const takenLoads = data.drivers.flatMap((d) =>
    d.events
      .filter((e) => e.kind === "load" && e.boardLoadId != null && e.state !== "offered")
      .map((e) => ({ boardLoadId: e.boardLoadId!, lane: e.title, from: d.username })),
  );
  const takenById = new Map(takenLoads.map((t) => [t.boardLoadId, t]));

  return (
    <div className="space-y-3">
      <section className={SECTION} aria-label="Fleet week grid">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-xs font-bold uppercase tracking-widest text-[var(--dim)]">
            {data.companyName} — week of {weekStart.toLocaleDateString([], { month: "short", day: "numeric" })}
          </div>
          <span className="text-xs text-[var(--dim)]">{data.isOwner ? "Owner view" : "Dispatch view"}</span>
        </div>
        <div className="mt-3 overflow-x-auto">
          <div className="min-w-[560px]">
            <div className="grid grid-cols-[92px_repeat(7,1fr)] gap-1 text-center text-[10px] font-bold uppercase tracking-wide text-[var(--dim)]">
              <div />
              {weekDays.map((d) => (
                <div key={dayKey(d)} className={dayKey(d) === dayKey(new Date()) ? "neon-text" : undefined}>
                  {d.toLocaleDateString([], { weekday: "short" })} {d.getDate()}
                </div>
              ))}
            </div>
            {data.drivers.map((d) => (
              <div key={d.username} className="mt-1 grid grid-cols-[92px_repeat(7,1fr)] gap-1">
                <div className="truncate rounded-lg bg-[var(--surface)] px-2 py-1.5 text-xs font-bold">
                  @{d.username}
                  <div className="text-[10px] font-semibold text-[var(--dim)]">{d.role}</div>
                </div>
                {weekDays.map((day) => {
                  const evts = fleetBuckets.get(d.username)?.get(dayKey(day)) ?? [];
                  return (
                    <div key={dayKey(day)} className="min-h-[44px] rounded-lg border border-[var(--glass-border)] bg-[var(--surface)] p-1">
                      <div className="space-y-0.5">
                        {evts.slice(0, 3).map((e, i) => (
                          <div key={`${e.kind}-${e.boardLoadId ?? e.title}-${i}`} className={`truncate rounded px-1 py-px text-[9px] leading-tight ${chipCls(e)}`} title={e.detail ?? e.title}>
                            {fleetChipLabel(e)}
                          </div>
                        ))}
                        {evts.length > 3 && <div className="px-1 text-[9px] font-bold text-[var(--dim)]">+{evts.length - 3} more</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
            {data.drivers.length === 0 && <p className="mt-2 text-sm text-[var(--dim)]">No drivers on this fleet yet.</p>}
          </div>
        </div>
      </section>

      {data.pendingOffDuty.length > 0 && (
        <section className={SECTION} aria-label="Time-off approvals">
          <div className="text-xs font-bold uppercase tracking-widest text-amber-300">Time-off waiting on the desk</div>
          <ul className="mt-2 space-y-3">
            {data.pendingOffDuty.map((r) => (
              <li key={r.id} className="rounded-xl bg-[var(--surface)] px-3 py-3">
                <div className="text-sm">
                  <strong>@{r.driverUsername}</strong> — {r.typeLabel}
                </div>
                <div className="mt-0.5 text-xs text-[var(--dim)]">
                  {fmtWhen(r.startsAt)} → {fmtWhen(r.endsAt)}
                </div>
                {r.note && <p className="mt-1 text-sm leading-relaxed">“{r.note}”</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" disabled={busy != null} className={BTN_PRIMARY} onClick={() => void act(`approve-off-${r.id}`, () => api.decideOffDutyRequest({ id: r.id, approve: true, note: null }), `Approved — @${r.driverUsername}'s ${r.typeLabel.toLowerCase()} is a commitment now.`)}>
                    Approve
                  </button>
                  {noteFor === `off-${r.id}` ? (
                    <>
                      <input className="min-w-[180px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm" value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Why not? The driver sees this." aria-label="Denial note" maxLength={300} />
                      <button
                        type="button"
                        disabled={busy != null}
                        className={BTN_DANGER}
                        onClick={() => {
                          void act(`deny-off-${r.id}`, () => api.decideOffDutyRequest({ id: r.id, approve: false, note: noteText.trim() ? noteText.trim() : null }), "Denied — the record stays on file and the driver was told.");
                          setNoteFor(null);
                          setNoteText("");
                        }}
                      >
                        Send denial
                      </button>
                      <button type="button" className={BTN} onClick={() => setNoteFor(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button type="button" className={BTN} onClick={() => { setNoteFor(`off-${r.id}`); setNoteText(""); }}>
                      Deny
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.pendingReleases.length > 0 && (
        <section className={SECTION} aria-label="Release requests">
          <div className="text-xs font-bold uppercase tracking-widest text-red-300">Release requests — locked loads</div>
          <ul className="mt-2 space-y-3">
            {data.pendingReleases.map((r) => (
              <li key={r.id} className="rounded-xl bg-[var(--surface)] px-3 py-3">
                <div className="text-sm">
                  <strong>@{r.driverUsername}</strong> — 🚛 {r.lane}
                </div>
                {r.reason && <p className="mt-1 text-sm leading-relaxed">“{r.reason}”</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" disabled={busy != null} className={BTN_PRIMARY} onClick={() => void act(`approve-rel-${r.id}`, () => api.decideLoadRelease({ id: r.id, approve: true, note: null }), "Released — the load is back on the board and the driver's copy comes off their calendar.")}>
                    Release the load
                  </button>
                  {noteFor === `rel-${r.id}` ? (
                    <>
                      <input className="min-w-[180px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm" value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Why must they keep it? The driver sees this." aria-label="Denial note" maxLength={300} />
                      <button
                        type="button"
                        disabled={busy != null}
                        className={BTN_DANGER}
                        onClick={() => {
                          void act(`deny-rel-${r.id}`, () => api.decideLoadRelease({ id: r.id, approve: false, note: noteText.trim() ? noteText.trim() : null }), "Kept — the driver stays on the load and was told why.");
                          setNoteFor(null);
                          setNoteText("");
                        }}
                      >
                        Send denial
                      </button>
                      <button type="button" className={BTN} onClick={() => setNoteFor(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button type="button" className={BTN} onClick={() => { setNoteFor(`rel-${r.id}`); setNoteText(""); }}>
                      Keep them on it
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={SECTION} aria-label="Reassignments">
        <div className="text-xs font-bold uppercase tracking-widest text-[var(--dim)]">Move a load — with the driver's consent</div>
        <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
          A move fires only when the driver carrying the load agrees in the app. A refusal stands unless the fleet owner overrides it with a reason — sealed, and shown to the driver.
        </p>
        {takenLoads.length > 0 && data.drivers.length > 1 && (
          <div className="mt-3 grid gap-2">
            <select className={INPUT} value={proposeLoad} onChange={(e) => setProposeLoad(e.target.value)} aria-label="Load to move">
              <option value="">Pick a committed load…</option>
              {[...takenById.values()].map((t) => (
                <option key={t.boardLoadId} value={String(t.boardLoadId)}>
                  {t.lane} — @{t.from}
                </option>
              ))}
            </select>
            <select className={INPUT} value={proposeTarget} onChange={(e) => setProposeTarget(e.target.value)} aria-label="Driver to move it to">
              <option value="">Move it to…</option>
              {data.drivers
                .filter((d) => d.username !== takenById.get(Number(proposeLoad))?.from)
                .map((d) => (
                  <option key={d.username} value={d.username}>
                    @{d.username}
                  </option>
                ))}
            </select>
            <input className={INPUT} value={proposeReason} onChange={(e) => setProposeReason(e.target.value)} placeholder="Reason — the driver sees this in the consent prompt" aria-label="Reassignment reason" maxLength={300} />
            <button
              type="button"
              disabled={busy != null || !proposeLoad || !proposeTarget || !proposeReason.trim()}
              className={BTN_PRIMARY}
              onClick={() =>
                void actHt(
                  `propose-${proposeLoad}`,
                  (ov) => api.proposeReassignment({ id: Number(proposeLoad), targetUsername: proposeTarget, reason: proposeReason.trim(), homeTimeOverride: ov }),
                  "Proposed — the move waits on the driver's consent.",
                ).then(() => {
                  setProposeLoad("");
                  setProposeTarget("");
                  setProposeReason("");
                })
              }
            >
              Propose the move
            </button>
          </div>
        )}

        {data.reassignments.length > 0 && (
          <ul className="mt-3 space-y-2">
            {data.reassignments.map((p) => (
              <li key={p.id} className="rounded-xl bg-[var(--surface)] px-3 py-3">
                <div className="text-sm">
                  🚛 {p.lane} — @{p.fromDriver} → @{p.toDriver}{" "}
                  <span className={`ml-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${p.status === "refused" ? "bg-red-500/15 text-red-300" : "bg-amber-500/15 text-amber-200"}`}>{p.status === "refused" ? "refused" : "waiting on consent"}</span>
                </div>
                {p.reason && <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">Reason given: “{p.reason}”</p>}
                {p.status === "refused" &&
                  (data.isOwner ? (
                    overrideFor === p.id ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <input className="min-w-[200px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Owner override reason — sealed, and shown to the driver" aria-label="Override reason" maxLength={300} />
                        <button
                          type="button"
                          disabled={busy != null || !overrideReason.trim()}
                          className={BTN_DANGER}
                          onClick={() => {
                            void act(`override-${p.id}`, () => api.overrideReassignmentRefusal({ id: p.id, reason: overrideReason.trim() }), "Override sealed — the load moved, and both drivers were told with your reason.");
                            setOverrideFor(null);
                            setOverrideReason("");
                          }}
                        >
                          Override the refusal
                        </button>
                        <button type="button" className={BTN} onClick={() => setOverrideFor(null)}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button type="button" className={`${BTN} mt-2`} onClick={() => { setOverrideFor(p.id); setOverrideReason(""); }}>
                        Override this refusal (owner)
                      </button>
                    )
                  ) : (
                    <p className="mt-1 text-xs text-[var(--dim)]">Only the fleet owner can override a refusal.</p>
                  ))}
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.isOwner && data.settings && <CalendarSettingsForm key={JSON.stringify(data.settings)} settings={data.settings} busy={busy} act={act} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Owner settings — dispatch mode, safety window, pay cycle.
// ---------------------------------------------------------------------------

function CalendarSettingsForm({
  settings,
  busy,
  act,
}: {
  settings: NonNullable<FleetData["settings"]>;
  busy: string | null;
  act: (key: string, fn: () => Promise<{ ok: boolean; error: string | null }>, success: string) => Promise<boolean>;
}) {
  const [mode, setMode] = useState(settings.dispatchMode);
  const [hours, setHours] = useState(String(settings.safetyWindowHours));
  const [cycle, setCycle] = useState(settings.payCycleKind);
  const [weekday, setWeekday] = useState(settings.payWeekday != null ? String(settings.payWeekday) : "5");
  const [anchorOn, setAnchorOn] = useState(settings.payAnchorOn ?? "");

  return (
    <section className={SECTION} aria-label="Calendar settings">
      <div className="text-xs font-bold uppercase tracking-widest text-[var(--dim)]">Calendar settings — owner only</div>
      <div className="mt-3 grid gap-2">
        <label className="text-xs font-bold text-[var(--dim)]" htmlFor="cal-set-mode">
          Dispatch mode
        </label>
        <select id="cal-set-mode" className={INPUT} value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="offered">Offered — drivers answer each load (accept / decline)</option>
          <option value="assigned">Assigned — loads land committed, no decline</option>
        </select>
        <label className="text-xs font-bold text-[var(--dim)]" htmlFor="cal-set-hours">
          Safety window — declines lock this many hours before pickup
        </label>
        <input id="cal-set-hours" type="number" min={1} max={168} className={INPUT} value={hours} onChange={(e) => setHours(e.target.value)} />
        <label className="text-xs font-bold text-[var(--dim)]" htmlFor="cal-set-cycle">
          Pay cycle — projects the paydays on every calendar
        </label>
        <select id="cal-set-cycle" className={INPUT} value={cycle} onChange={(e) => setCycle(e.target.value)}>
          <option value="none">No set cycle</option>
          <option value="weekly">Weekly</option>
          <option value="biweekly">Every two weeks</option>
        </select>
        {cycle === "weekly" && (
          <select className={INPUT} value={weekday} onChange={(e) => setWeekday(e.target.value)} aria-label="Payday weekday">
            {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((d, i) => (
              <option key={d} value={String(i)}>
                Payday: {d}
              </option>
            ))}
          </select>
        )}
        {cycle === "biweekly" && (
          <input type="date" className={INPUT} value={anchorOn} onChange={(e) => setAnchorOn(e.target.value)} aria-label="A known payday (anchor date)" />
        )}
        <button
          type="button"
          disabled={busy != null}
          className={BTN_PRIMARY}
          onClick={() =>
            void act(
              "settings",
              () =>
                api.setFleetCalendarSettings({
                  dispatchMode: mode as "assigned" | "offered",
                  safetyWindowHours: Math.min(168, Math.max(1, Math.floor(Number(hours) || 24))),
                  payCycleKind: cycle as "none" | "weekly" | "biweekly",
                  payWeekday: cycle === "weekly" ? Number(weekday) : null,
                  payAnchorOn: cycle === "biweekly" && anchorOn ? anchorOn : null,
                }),
              "Settings saved — sealed on the record, and every calendar in the fleet reads them now.",
            )
          }
        >
          Save calendar settings
        </button>
      </div>
    </section>
  );
}
