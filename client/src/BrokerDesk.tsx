// STONEMILES Broker Desk — the POSTER's home screen (round 5, x
// 2026-11-02: "Build Broker Desk + Owner Desk to match My Desk").
//
// The Broker Portal keeps its posting flows — this desk is the
// front door on top of it, in the My Desk pattern: MY POSTED LOADS
// as a pipeline in the same plain states (Draft → In review → Live
// on the board → Claimed → Delivered/sealed) with the review/queue
// status spelled out (whose queue a load sits in and why), MY
// POSTER FEE (the existing Broker Portal fee surface, shown here
// with set/edit), and MY TOTALS (loads posted, loads sealed, gross
// moved through my posts).
//
// ELIGIBILITY (server-decided, desks.ts): accounts holding a
// linked poster account who are NOT operating as dispatchers.
// DISPATCHER POSTERS LIVE ON MY DESK (round 4 exclusivity): a solo
// dispatcher or a dispatch-company poster who lands here gets the
// explainer pointing at My Desk — never a second desk for the same
// poster work. Everyone else gets the plain explainer + how to
// become a poster.
//
// WALLS: every read behind this sheet is scoped to the caller's
// own poster account on the server — another poster's loads never
// appear here; they answer as nonexistent. Records only: this
// desk moves NO money and handles NO freight pay — freight pay
// runs direct from poster to carrier.

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";

type BrokerDeskData = ApiResponse<typeof api, "getBrokerDesk">;
type PipelineRow = BrokerDeskData["pipeline"][number];

const INPUT =
  "w-full rounded-lg bg-[var(--surface2)] border border-[var(--border)] px-3 py-2.5 text-base text-[var(--text)] placeholder:text-[var(--dim)]";
const LABEL = "block text-xs font-semibold uppercase tracking-wide text-[var(--dim)] mb-1";
const BTN =
  "rounded-lg bg-[var(--accent)] px-4 py-2.5 font-bold text-black disabled:opacity-50";
const BTN_GHOST =
  "rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-3 py-2 text-sm font-semibold disabled:opacity-50";

const STATE_ORDER = ["draft", "review", "live", "claimed", "delivered"] as const;

function money(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function BrokerDesk({
  onClose,
  onOpenBrokerPortal,
  onOpenMyDesk,
}: {
  onClose: () => void;
  /** Jump to the Broker Portal — the posting flows + the review queue live there. */
  onOpenBrokerPortal: () => void;
  /** Dispatcher posters live on My Desk — the exclusivity door. */
  onOpenMyDesk: () => void;
}) {
  const queryClient = useQueryClient();
  const deskQuery = useQuery({ queryKey: ["broker-desk"], queryFn: () => api.getBrokerDesk({}) });
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [posterFeeDraft, setPosterFeeDraft] = useState<string>("");

  const desk = deskQuery.data;
  const posterFeePct = desk?.fee.posterFeePct ?? null;
  useEffect(() => {
    setPosterFeeDraft(posterFeePct != null ? String(posterFeePct) : "");
  }, [posterFeePct]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["broker-desk"] });
    void queryClient.invalidateQueries({ queryKey: ["broker-portal"] });
    void queryClient.invalidateQueries({ queryKey: ["my-desk"] });
    void queryClient.invalidateQueries({ queryKey: ["load-board"] });
  };

  const counts = new Map<string, number>();
  for (const row of desk?.pipeline ?? []) counts.set(row.state, (counts.get(row.state) ?? 0) + 1);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-label="Broker Desk">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-[var(--surface)] p-4 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-condensed text-2xl font-bold">🏢 Broker Desk</h2>
            <p className="mt-0.5 text-sm text-[var(--dim)]">
              Your home as a poster — the loads YOU posted, your poster fee, and your totals. Just yours:
              another poster's work never shows here.
            </p>
            {desk?.posterName && desk.eligible && (
              <p className="mt-1 text-sm">
                <span className="rounded-full bg-[var(--surface2)] px-2.5 py-1 text-xs font-bold">
                  Posting as {desk.posterName}
                </span>
              </p>
            )}
          </div>
          <button type="button" className={BTN_GHOST} onClick={onClose} aria-label="Close Broker Desk">
            Close
          </button>
        </div>

        {banner && (
          <p className="mt-3 rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-sm" role="status">
            {banner}
          </p>
        )}

        {deskQuery.isPending ? (
          <p className="mt-4 text-sm text-[var(--dim)]">Opening your desk…</p>
        ) : !desk?.eligible && desk?.reason === "dispatcher" ? (
          <>
            {/* Exclusivity (round 4/5): dispatcher posters live on My Desk. */}
            <section className="mt-4 rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3" aria-label="Your poster work lives on My Desk">
              <h3 className="font-condensed text-lg font-semibold">Your poster work lives on My Desk</h3>
              <p className="mt-1 text-sm leading-relaxed">
                You're operating as a dispatcher
                {desk.dispatcherMode === "company" && desk.standingCompanyName
                  ? ` under ${desk.standingCompanyName}`
                  : desk.dispatcherMode === "solo"
                    ? " on your own solo desk"
                    : ""}
                {" "}— and dispatcher posters run their poster work on <strong>My Desk</strong>, not here: one
                desk for the same work, never two, so no load can be double-booked across desks. Your
                pipeline, your fee, and your platform fees are all on My Desk already.
              </p>
              <div className="mt-2">
                <button type="button" className={BTN} onClick={onOpenMyDesk}>
                  Open My Desk
                </button>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">
                The Broker Desk is for broker and shipper posters who aren't operating as dispatchers —
                accounts the desk invited to post under their own name.
              </p>
            </section>
          </>
        ) : !desk?.eligible ? (
          <>
            {/* Not a poster yet — what the desk is + how to become one. */}
            <section className="mt-4 rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3" aria-label="What the Broker Desk is">
              <h3 className="font-condensed text-lg font-semibold">What the Broker Desk is</h3>
              <p className="mt-1 text-sm leading-relaxed">
                The Broker Desk is a poster's home screen: every load you posted as a pipeline (draft, in
                review, live on the board, claimed, delivered — sealed), your own poster fee, and your
                totals — loads posted, loads sealed, and the gross that moved through your posts. The
                Broker Portal keeps the posting flows; this desk is the front door to them.
              </p>
              <p className="mt-2 text-sm leading-relaxed">
                This account doesn't hold a poster account yet. <strong>How to become a poster:</strong>{" "}
                poster accounts are invited by the RUGGS LOGISTICS desk — the desk creates the account
                under your brokerage or shipper name and links it to your STONEMILES sign-in. Ask for
                access through the Stonervision team —{" "}
                <a
                  className="font-semibold underline"
                  href="mailto:stonervisionteam@gmail.com"
                  aria-label="Email the Stonervision team — brokers, shippers and help — at stonervisionteam@gmail.com to request poster access"
                >
                  stonervisionteam@gmail.com
                </a>{" "}
                (labelled “Stonervision team — brokers, shippers &amp; help”). Once the desk links your
                account, this desk opens on your loads.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={BTN_GHOST} onClick={onOpenBrokerPortal}>
                  Open the Broker Portal
                </button>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">
                Dispatching instead? A dispatcher's poster work lives on My Desk — a dispatch seat, a
                dispatch company, or opening My Desk solo is the door there.
              </p>
            </section>
          </>
        ) : (
          <>
            {desk.posterStatus === "suspended" && (
              <p className="mt-3 rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-sm" role="status">
                This poster account is <strong>suspended</strong> — posting is paused. Your loads and
                totals below still stand. Contact RUGGS LOGISTICS dispatch to sort it out.
              </p>
            )}

            {/* My posted loads */}
            <section className="mt-4 rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3" aria-label="My posted loads">
              <h3 className="font-condensed text-lg font-semibold">📦 My posted loads</h3>
              <p className="mt-1 flex flex-wrap gap-1.5" aria-label="Pipeline counts">
                {STATE_ORDER.map((s) => (
                  <span key={s} className="rounded-full bg-[var(--surface)] px-2.5 py-1 text-xs font-bold">
                    {(desk.pipeline.find((r) => r.state === s)?.stateLabel ?? s)}: {counts.get(s) ?? 0}
                  </span>
                ))}
              </p>
              {desk.pipeline.length === 0 ? (
                <p className="mt-2 text-sm text-[var(--dim)]">
                  Nothing posted yet. Your first load lands here the moment you post it in the Broker
                  Portal — draft, review, live, claimed, and sealed, all in plain view.
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {desk.pipeline.map((row: PipelineRow) => (
                    <li key={row.key} className="rounded-lg bg-[var(--surface)] px-3 py-2.5 text-sm">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-semibold">{row.lane}</span>
                        <span className="flex shrink-0 items-center gap-2">
                          {row.rate != null && <span className="font-semibold">${row.rate.toLocaleString()}</span>}
                          <span className="rounded-full bg-[var(--surface2)] px-2.5 py-0.5 text-xs font-bold text-[var(--accent)]">
                            {row.stateLabel}
                          </span>
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs leading-relaxed text-[var(--dim)]">
                        {[
                          row.detail,
                          new Date(row.createdAt).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                      {row.approvalNote && (
                        <p className="mt-1 text-xs leading-relaxed">{row.approvalNote}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={BTN} onClick={onOpenBrokerPortal}>
                  Post a load — Broker Portal
                </button>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-[var(--dim)]">
                Sent loads wait in the review queue named on each load — nothing is public until that desk
                releases it. Freight pay runs direct from you to the claiming carrier; this desk tracks
                and seals records only.
              </p>
            </section>

            {/* My poster fee */}
            <section className="mt-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3" aria-label="My poster fee">
              <h3 className="font-condensed text-lg font-semibold">💲 My poster fee</h3>
              <p className="mt-1 text-sm leading-relaxed">
                <strong>In effect on your loads:{" "}
                {desk.fee.effectiveFeePct != null ? `${desk.fee.effectiveFeePct}%` : "no fee (0%)"}</strong>
                {desk.fee.source === "poster" && " — your own poster setting."}
                {desk.fee.source === "company" && " — your dispatch company's default; you haven't set your own."}
                {desk.fee.source === "none" && " — nothing set. Unset means no fee, never a surprise number."}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
                Your fee rides each load at release and shows to the claiming carrier — poster name and
                fee % in plain view — before they claim. The claiming carrier pays it once per load.
                Records only: the app moves no money for it. Loads already released keep the fee they
                were released with.
              </p>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <div className="w-40">
                  <label className={LABEL} htmlFor="bd-poster-fee">My fee % (0–20)</label>
                  <input
                    id="bd-poster-fee"
                    className={INPUT}
                    inputMode="decimal"
                    placeholder="Blank = no fee"
                    value={posterFeeDraft}
                    onChange={(e) => setPosterFeeDraft(e.target.value)}
                    aria-label="My poster fee percent, 0 to 20"
                  />
                </div>
                <button
                  type="button"
                  className={BTN}
                  disabled={busy}
                  onClick={() => {
                    const trimmed = posterFeeDraft.trim();
                    setBusy(true);
                    void api
                      .setMyPosterFee({ feePct: trimmed === "" ? null : Number(trimmed) })
                      .then((r) => {
                        setBanner(
                          r.ok
                            ? trimmed === ""
                              ? "Your fee cleared — your loads carry no fee from here (unless a company default applies)."
                              : "Your fee saved — it rides the loads released from now on."
                            : (r.error ?? "That didn't go through — try again."),
                        );
                        if (r.ok) refresh();
                      })
                      .catch(() => setBanner("That didn't go through — try again."))
                      .finally(() => setBusy(false));
                  }}
                >
                  Save my fee
                </button>
                <span className="text-xs text-[var(--dim)]">
                  On poster account {desk.fee.posterName ?? "yours"} — the same setting the Broker Portal
                  carries.
                </span>
              </div>
            </section>

            {/* My totals */}
            <section className="mt-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3" aria-label="My totals">
              <h3 className="font-condensed text-lg font-semibold">🧾 My totals</h3>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-[var(--surface)] px-2 py-2.5">
                  <div className="font-condensed text-2xl font-bold">{desk.totals.posted}</div>
                  <div className="text-xs text-[var(--dim)]">Loads posted</div>
                </div>
                <div className="rounded-lg bg-[var(--surface)] px-2 py-2.5">
                  <div className="font-condensed text-2xl font-bold">{desk.totals.sealed}</div>
                  <div className="text-xs text-[var(--dim)]">Loads sealed</div>
                </div>
                <div className="rounded-lg bg-[var(--surface)] px-2 py-2.5">
                  <div className="font-condensed text-2xl font-bold">{money(desk.totals.grossMoved)}</div>
                  <div className="text-xs text-[var(--dim)]">Gross moved through my posts</div>
                </div>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-[var(--dim)]">
                Gross moved counts the freight on loads that reached sealed delivery — the loads that
                actually ran under your name.
              </p>
            </section>

            {/* Shortcuts */}
            <section className="mt-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3" aria-label="Shortcuts">
              <h3 className="font-condensed text-lg font-semibold">🔗 Shortcuts</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={BTN_GHOST} onClick={onOpenBrokerPortal}>
                  🏢 Open the Broker Portal
                </button>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-[var(--dim)]">
                The Broker Portal holds the posting forms, your rate confirmations, and the tracking
                links — this desk is the home screen on top of it.
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
