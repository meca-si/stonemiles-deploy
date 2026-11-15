// RecruitingPanel.tsx — driver recruiting, ATS-lite (Wave 2
// item 10, Part B), in the Owner and Dispatch desks.
//
// Two surfaces over the server rules (recruiting.ts):
//  - the door: the fleet's public application link (share it
//    anywhere — the page asks only name, contact, CDL class,
//    experience, and a note) plus the auto-response wording the
//    fleet controls. The default wording promises nothing beyond
//    "we review every application" — the panel says to keep it
//    that way.
//  - the inbox: applications with their pipeline stage, the
//    auto-response's delivery state, and desk notes. Notes are
//    fleet-internal — they render here and nowhere public.
//    "Hired" shows the pending invite code the owner sends
//    through the existing driver-code flow; hiring creates no
//    account by itself.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";

type DoorData = ApiResponse<typeof api, "getRecruitingDoor">;
type AppsData = ApiResponse<typeof api, "getRecruitingApplications">;
type Application = AppsData["applications"][number];

const BTN = "rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-bold disabled:opacity-50";
const BTN_GOLD = "btn-gold !px-3 !py-1.5 text-xs disabled:opacity-50";
const INPUT =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)]";

const LADDER = ["new", "contacted", "interview", "road_test", "hired"] as const;
const STAGE_LABELS: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  interview: "Interview",
  road_test: "Road test",
  hired: "Hired",
  declined: "Declined",
};

function forwardStages(stage: string): string[] {
  const idx = (LADDER as readonly string[]).indexOf(stage);
  if (idx < 0) return []; // hired / declined are terminal
  return [...LADDER.slice(idx + 1), "declined"];
}

function cdlLabel(cls: string): string {
  return cls === "none" ? "No CDL yet" : `Class ${cls}`;
}

function ApplicationCard({ a, refresh }: { a: Application; refresh: () => void }) {
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  async function act(label: string, fn: () => Promise<unknown>, okMsg: string) {
    setBusy(label);
    setMsg(null);
    try {
      await fn();
      refresh();
      setMsg(okMsg);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "That didn't go through — try again.");
    } finally {
      setBusy("");
    }
  }

  const terminal = a.stage === "hired" || a.stage === "declined";
  const responseLine =
    a.responseStatus === "sent"
      ? "Auto-response sent ✓"
      : a.responseStatus === "queued"
        ? "Auto-response queued (mail not configured yet)"
        : "Auto-response didn't send";

  return (
    <div className="rounded-xl bg-[var(--surface)] px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold">{a.name}</p>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase ${
            a.stage === "hired"
              ? "bg-emerald-500/15 text-emerald-300"
              : a.stage === "declined"
                ? "bg-red-500/15 text-red-300"
                : a.stage === "new"
                  ? "bg-sky-500/15 text-sky-300"
                  : "bg-amber-500/15 text-amber-300"
          }`}
        >
          {a.stageLabel}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-[var(--dim)]">
        {cdlLabel(a.cdlClass)} · {a.email}
        {a.phone ? ` · ${a.phone}` : ""} · applied {new Date(a.createdAt).toLocaleDateString()}
      </p>
      <p className="mt-1.5 text-sm">{a.experience}</p>
      {a.note && <p className="mt-1 text-sm text-[var(--dim)]">“{a.note}”</p>}
      <p className="mt-1.5 text-xs text-[var(--dim)]">{responseLine}</p>

      {a.stage === "hired" && a.inviteCode && (
        <p className="mt-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-2 text-xs">
          Pending invite: <span className="font-mono font-bold">{a.inviteCode}</span> — send this driver code to the
          applicant; they join with it like any driver invite. No account exists until they do.
        </p>
      )}

      {!terminal && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {forwardStages(a.stage).map((s) => (
            <button
              key={s}
              type="button"
              className={s === "declined" ? BTN : BTN_GOLD}
              disabled={busy !== ""}
              onClick={() =>
                void act(
                  s,
                  () => api.moveApplicationStage({ applicationId: a.id, toStage: s }),
                  s === "hired" ? "Hired — the invite code is ready above." : `Moved to ${STAGE_LABELS[s]}.`,
                )
              }
            >
              {busy === s ? "Moving…" : `→ ${STAGE_LABELS[s]}`}
            </button>
          ))}
        </div>
      )}

      {a.notes.length > 0 && (
        <div className="mt-2 space-y-1 border-t border-[var(--border)] pt-2">
          {a.notes.map((n) => (
            <p key={n.id} className="text-xs text-[var(--dim)]">
              <span className="font-semibold text-[var(--text)]">{n.author}</span> ·{" "}
              {new Date(n.createdAt).toLocaleDateString()} — {n.body}
            </p>
          ))}
        </div>
      )}
      <div className="mt-2 flex gap-2">
        <input
          className={INPUT}
          placeholder="Add a desk note (fleet only — the applicant never sees it)"
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          maxLength={2000}
        />
        <button
          type="button"
          className={BTN}
          disabled={busy !== "" || !noteDraft.trim()}
          onClick={() =>
            void act("note", async () => {
              await api.addApplicationNote({ applicationId: a.id, body: noteDraft.trim() });
              setNoteDraft("");
            }, "Note added.")
          }
        >
          Add
        </button>
      </div>
      {msg && <p className="mt-2 text-xs font-semibold text-emerald-300">{msg}</p>}
    </div>
  );
}

export function RecruitingPanel() {
  const queryClient = useQueryClient();
  const door = useQuery({ queryKey: ["recruiting-door"], queryFn: () => api.getRecruitingDoor({}) });
  const apps = useQuery({ queryKey: ["recruiting-applications"], queryFn: () => api.getRecruitingApplications({}) });
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const d: DoorData | undefined = door.data;
  const a: AppsData | undefined = apps.data;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["recruiting-door"] });
    void queryClient.invalidateQueries({ queryKey: ["recruiting-applications"] });
  };

  async function act(label: string, fn: () => Promise<unknown>, okMsg: string) {
    setBusy(label);
    setMsg(null);
    try {
      await fn();
      refresh();
      setMsg(okMsg);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "That didn't go through — try again.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section
      className="mt-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3"
      aria-label="Recruiting — driver applications"
    >
      <h3 className="font-condensed text-lg font-semibold">🧑‍✈️ Recruiting — driver applications</h3>
      {door.isLoading || apps.isLoading || !d || !a ? (
        <p className="mt-2 text-sm text-[var(--dim)]">Loading…</p>
      ) : d.error ? (
        <p className="mt-2 text-sm text-[var(--dim)]">{d.error}</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-[var(--dim)]">
            One public link takes applications — name, contact, CDL class, experience. Every applicant gets the
            response below by email the moment they apply, and applications land here and nowhere else.
          </p>

          {d.doorUrl ? (
            <div className="mt-2 rounded-xl bg-[var(--surface)] px-3 py-2.5">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--dim)]">
                Application door — {d.doorLive ? "open" : "closed"}
              </p>
              <p className="mt-1 break-all font-mono text-xs">{d.doorUrl}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={BTN}
                  disabled={busy !== ""}
                  onClick={() =>
                    void act("regen", () => api.createRecruitingDoor({}), "New door link minted — the old one is retired.")
                  }
                >
                  {busy === "regen" ? "Minting…" : "Regenerate link"}
                </button>
                {d.doorLive && (
                  <button
                    type="button"
                    className={BTN}
                    disabled={busy !== ""}
                    onClick={() => void act("revoke", () => api.revokeRecruitingDoor({}), "Door closed.")}
                  >
                    Close door
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-2">
              <button
                type="button"
                className={BTN_GOLD}
                disabled={busy !== ""}
                onClick={() => void act("create", () => api.createRecruitingDoor({}), "Application door is open.")}
              >
                {busy === "create" ? "Opening…" : "Open the application door"}
              </button>
            </div>
          )}

          <div className="mt-3 rounded-xl bg-[var(--surface)] px-3 py-2.5">
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--dim)]">
              Auto-response {d.templateIsDefault ? "(house default)" : "(your wording)"}
            </p>
            <p className="mt-1 text-xs text-[var(--dim)]">
              Sent by email the moment an application lands. {"{name}"} and {"{fleet}"} fill in on their own. Keep it
              honest: the wording thanks them and says every application gets reviewed — no promises about hiring, pay,
              or when they'll hear more.
            </p>
            <input
              className={`${INPUT} mt-2`}
              value={subject ?? d.templateSubject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
              aria-label="Auto-response subject"
            />
            <textarea
              className={`${INPUT} mt-2 min-h-28`}
              value={body ?? d.templateBody}
              onChange={(e) => setBody(e.target.value)}
              maxLength={4000}
              aria-label="Auto-response body"
            />
            <div className="mt-2">
              <button
                type="button"
                className={BTN}
                disabled={busy !== "" || (subject === null && body === null)}
                onClick={() =>
                  void act(
                    "template",
                    () =>
                      api.setRecruitingTemplate({
                        subject: subject ?? d.templateSubject,
                        body: body ?? d.templateBody,
                      }),
                    "Response wording saved. Blank a field to return to the default.",
                  )
                }
              >
                {busy === "template" ? "Saving…" : "Save wording"}
              </button>
            </div>
          </div>

          {msg && <p className="mt-2 text-xs font-semibold text-emerald-300">{msg}</p>}

          <p className="mt-3 text-xs font-bold uppercase tracking-wide text-[var(--dim)]">
            Applications — {d.counts.total}
            {d.counts.fresh > 0 ? ` · ${d.counts.fresh} new` : ""}
          </p>
          {a.error ? (
            <p className="mt-2 text-sm text-[var(--dim)]">{a.error}</p>
          ) : a.applications.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--dim)]">
              No applications yet — share the door link where drivers will see it.
            </p>
          ) : (
            <div className="mt-2 space-y-2">
              {a.applications.map((app) => (
                <ApplicationCard key={app.id} a={app} refresh={refresh} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
