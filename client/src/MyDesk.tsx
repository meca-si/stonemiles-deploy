// STONEMILES My Desk — the DISPATCHER's own desk (round 3, x
// 2026-11-02: "Dispatcher should have their own desk.").
//
// The Dispatch Desk (DispatchDesk.tsx) belongs to the dispatch
// COMPANY — the owner's roof view of the whole company's work. My
// Desk is the PERSON's desk, layered over it: my pipeline (the
// loads I posted, in plain states with the approval state in view),
// my fee (my poster override over my company's default, showing
// which one is actually in effect on my loads), my platform fees
// (the 2% accruals on MY dispatched loads, with the running total),
// and shortcuts to my company chats and desk context.
//
// ELIGIBILITY (server-decided, myDesk.ts): a dispatch-seat holder
// in any company, a dispatch company's owner, or a SOLO dispatcher
// — any profile that opened this desk (the opt-in that makes them
// a dispatcher in the system). Everyone else sees the plain
// explanation and the three doors in. SOLO DISPATCHER POSTERS
// accrue the platform's 2% on their public-board loads exactly
// like a dispatch-only company does; shipper/broker direct posters
// who never open a dispatcher desk are not dispatchers and don't.
//
// WALLS: every read behind this sheet is scoped to the person on
// the server — another dispatcher's loads, fees, and accruals
// never appear here; they answer as nonexistent. Records only:
// this desk moves NO money and handles NO freight pay.
//
// ONE DESK OR THE OTHER (round 4, x 2026-11-02 — dispatcher
// exclusivity): a dispatcher runs a COMPANY desk (dispatch seat
// somewhere, or their own dispatch company) or a SOLO desk, never
// both — that's what prevents double booking and keeps a
// dispatcher from taking loads around a company owner. The solo
// door refuses under company standing; the company doors refuse
// while the solo desk is open; and closing the solo desk (the
// "Close my solo desk" section below, shown while the flag is
// open) refuses while LIVE loads sit on the board under the solo
// poster — freight never crosses the switch. Closing deletes
// nothing: history and recorded platform fees stand. If stored
// data ever says BOTH, company standing wins and the solo side
// reads as closed until the seat goes (the server resolves the
// standing; this sheet just shows the mode it reports).

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";

type MyDeskData = ApiResponse<typeof api, "getMyDesk">;
type PipelineRow = MyDeskData["pipeline"][number];

const INPUT =
  "w-full rounded-lg bg-[var(--surface2)] border border-[var(--border)] px-3 py-2.5 text-base text-[var(--text)] placeholder:text-[var(--dim)]";
const LABEL = "block text-xs font-semibold uppercase tracking-wide text-[var(--dim)] mb-1";
const BTN =
  "rounded-lg bg-[var(--accent)] px-4 py-2.5 font-bold text-black disabled:opacity-50";
const BTN_GHOST =
  "rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-3 py-2 text-sm font-semibold disabled:opacity-50";

const STATE_ORDER = ["draft", "review", "live", "claimed", "delivered"] as const;

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function MyDesk({
  onClose,
  onOpenBrokerPortal,
  onPostLoad,
  onOpenDispatchDesk,
  onOpenCompany,
  onOpenChatGroup,
}: {
  onClose: () => void;
  /** Jump to the Broker Portal — the review-queue door to the public board. */
  onOpenBrokerPortal: () => void;
  /** Jump to the Fleet Board, where Owner/Dispatch post inside the company. */
  onPostLoad: () => void;
  /** Open the company Dispatch Desk (the roof view) when this person has one. */
  onOpenDispatchDesk?: () => void;
  /** Jump to Chat → My company (join a company / start a dispatch company). */
  onOpenCompany: () => void;
  /** Open one of my company chats directly. */
  onOpenChatGroup: (groupId: number) => void;
}) {
  const queryClient = useQueryClient();
  const deskQuery = useQuery({ queryKey: ["my-desk"], queryFn: () => api.getMyDesk({}) });
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [posterFeeDraft, setPosterFeeDraft] = useState<string>("");
  const [companyFeeDraft, setCompanyFeeDraft] = useState<string>("");
  const [linkName, setLinkName] = useState("");
  const [linkEmail, setLinkEmail] = useState("");

  const desk = deskQuery.data;
  const posterFeePct = desk?.fee.posterFeePct ?? null;
  const companyFeePct = desk?.fee.companyFeePct ?? null;
  useEffect(() => {
    setPosterFeeDraft(posterFeePct != null ? String(posterFeePct) : "");
  }, [posterFeePct]);
  useEffect(() => {
    setCompanyFeeDraft(companyFeePct != null ? String(companyFeePct) : "");
  }, [companyFeePct]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["my-desk"] });
    void queryClient.invalidateQueries({ queryKey: ["dispatch-desk"] });
    void queryClient.invalidateQueries({ queryKey: ["broker-portal"] });
    void queryClient.invalidateQueries({ queryKey: ["load-board"] });
  };

  const run = async (fn: () => Promise<{ ok: boolean; error: string | null }>, okMsg: string) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r.ok) {
        setBanner(okMsg);
        refresh();
      } else {
        setBanner(r.error ?? "That didn't go through — try again.");
      }
    } catch {
      setBanner("That didn't go through — try again.");
    } finally {
      setBusy(false);
    }
  };

  const counts = new Map<string, number>();
  for (const row of desk?.pipeline ?? []) counts.set(row.state, (counts.get(row.state) ?? 0) + 1);

  const inCompanyWithBoardRights =
    desk?.companyName != null && (desk?.myRole === "owner" || desk?.myRole === "dispatch");

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-label="My Desk">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-[var(--surface)] p-4 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-condensed text-2xl font-bold">🧑‍💼 My Desk</h2>
            <p className="mt-0.5 text-sm text-[var(--dim)]">
              Your own desk as a dispatcher — the loads YOU posted, your fee, and your platform fees. Just
              yours: another dispatcher's work never shows here.
            </p>
            {desk?.contextLabel && (
              <p className="mt-1 text-sm">
                <span className="rounded-full bg-[var(--surface2)] px-2.5 py-1 text-xs font-bold">
                  {desk.contextLabel}
                </span>
              </p>
            )}
            {desk && desk.dispatcherMode !== "none" && (
              <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
                {desk.dispatcherMode === "company"
                  ? "Mode: COMPANY desk — one desk or the other, never both: the solo door stays closed while you dispatch under a company."
                  : "Mode: SOLO desk — one desk or the other, never both: the company doors stay closed while this desk is open."}
              </p>
            )}
          </div>
          <button type="button" className={BTN_GHOST} onClick={onClose} aria-label="Close My Desk">
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
        ) : !desk?.eligible ? (
          <>
            {/* Not a dispatcher yet — what the desk is + the three doors in. */}
            <section className="mt-4 rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3" aria-label="What My Desk is">
              <h3 className="font-condensed text-lg font-semibold">What My Desk is</h3>
              <p className="mt-1 text-sm leading-relaxed">
                My Desk is a dispatcher's own workspace: the loads you personally posted (draft, in platform
                review, live, claimed, delivered — with the approval state in plain view), your own dispatcher
                fee (capped at 20%), and the platform fees on your dispatched loads — the platform's 2% of
                gross, recorded when a load's delivery seals. It belongs to the person, not a company: a
                dispatcher is a plain profile, no subscription, no drivers needed.
              </p>
              <p className="mt-2 text-sm leading-relaxed">
                This account isn't working as a dispatcher yet. There are three doors in:
              </p>
              <ul className="mt-2 space-y-2 text-sm leading-relaxed">
                <li className="rounded-lg bg-[var(--surface)] px-3 py-2.5">
                  <strong>1 · Join a company as dispatch.</strong> When a company owner gives you a dispatch
                  seat, this desk opens on your slice of that company's work. One desk or the other: if your
                  solo desk is open, the seat refuses until you close it first.
                  <div className="mt-1.5">
                    <button type="button" className={BTN_GHOST} onClick={onOpenCompany}>
                      Go to My company
                    </button>
                  </div>
                </li>
                <li className="rounded-lg bg-[var(--surface)] px-3 py-2.5">
                  <strong>2 · Start a dispatch company.</strong> Create a company with “I dispatch for
                  others” — you own the desk, run client fleets, and post under your company's name. Same
                  rule: an open solo desk refuses this door until it's closed.
                  <div className="mt-1.5">
                    <button type="button" className={BTN_GHOST} onClick={onOpenCompany}>
                      Start a company
                    </button>
                  </div>
                </li>
                <li className="rounded-lg bg-[var(--surface)] px-3 py-2.5">
                  <strong>3 · Open the desk solo.</strong> No company at all: open My Desk on your own
                  profile and post under your own poster account. Opening it is what makes you a dispatcher
                  in the system — free profile, your fee capped at 20%, loads public only after platform
                  approval, and the platform's 2% recorded on your loads at sealed delivery. This door
                  refuses while you dispatch under a company — one desk or the other, never both.
                  <div className="mt-1.5">
                    <button
                      type="button"
                      className={BTN}
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => api.openMyDesk({}),
                          "Your desk is open — you're a solo dispatcher now. Link your poster account below to post your first load.",
                        )
                      }
                    >
                      Open my desk solo
                    </button>
                  </div>
                </li>
              </ul>
            </section>
          </>
        ) : (
          <>
            {/* My pipeline */}
            <section className="mt-4 rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3" aria-label="My pipeline">
              <h3 className="font-condensed text-lg font-semibold">📦 My pipeline — loads I posted</h3>
              <p className="mt-1 flex flex-wrap gap-1.5" aria-label="Pipeline counts">
                {STATE_ORDER.map((s) => (
                  <span key={s} className="rounded-full bg-[var(--surface)] px-2.5 py-1 text-xs font-bold">
                    {(desk.pipeline.find((r) => r.state === s)?.stateLabel ?? s)}: {counts.get(s) ?? 0}
                  </span>
                ))}
              </p>
              {desk.pipeline.length === 0 ? (
                <p className="mt-2 text-sm text-[var(--dim)]">
                  Nothing posted yet. Your first load lands here the moment you post it — draft, review, live,
                  claimed, and sealed, all in plain view.
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
                          row.posterName ? `posted as ${row.posterName}` : null,
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
                {desk.posterLinked && (
                  <button type="button" className={BTN} onClick={onOpenBrokerPortal}>
                    Post a load — public board
                  </button>
                )}
                {inCompanyWithBoardRights && (
                  <button type="button" className={desk.posterLinked ? BTN_GHOST : BTN} onClick={onPostLoad}>
                    Post on the company board
                  </button>
                )}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-[var(--dim)]">
                Public posts go through the platform review queue first — nothing is public until the
                platform desk releases it. Freight pay runs direct from poster to carrier; this desk tracks
                and seals records only.
              </p>
            </section>

            {/* My poster account (the solo door to posting under my own name) */}
            {!desk.posterLinked && (
              <section className="mt-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3" aria-label="My poster account">
                <h3 className="font-condensed text-lg font-semibold">🪪 My poster account</h3>
                <p className="mt-1 text-sm leading-relaxed">
                  Posting to the public board runs under a poster account with your name on it. Link yours —
                  it submits into the platform review queue, never your own, so your public posts are
                  released platform-side like every dispatcher's.
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div>
                    <label className={LABEL} htmlFor="md-link-name">Poster name</label>
                    <input
                      id="md-link-name"
                      className={INPUT}
                      placeholder="The name your loads post under"
                      value={linkName}
                      onChange={(e) => setLinkName(e.target.value)}
                      aria-label="Poster account name"
                    />
                  </div>
                  <div>
                    <label className={LABEL} htmlFor="md-link-email">Contact email</label>
                    <input
                      id="md-link-email"
                      className={INPUT}
                      inputMode="email"
                      placeholder="Contact of record"
                      value={linkEmail}
                      onChange={(e) => setLinkEmail(e.target.value)}
                      aria-label="Poster account contact email"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className={`${BTN} mt-2`}
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => api.linkMyPosterAccount({ name: linkName, email: linkEmail }),
                      "Poster account linked — you can post to the public board under your own name now.",
                    )
                  }
                >
                  Link my poster account
                </button>
              </section>
            )}

            {/* My fee */}
            <section className="mt-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3" aria-label="My dispatcher fee">
              <h3 className="font-condensed text-lg font-semibold">💲 My fee</h3>
              <p className="mt-1 text-sm leading-relaxed">
                <strong>In effect on your loads:{" "}
                {desk.fee.effectiveFeePct != null ? `${desk.fee.effectiveFeePct}%` : "no fee (0%)"}</strong>
                {desk.fee.source === "poster" && " — your own poster setting."}
                {desk.fee.source === "company" && " — your company's default; you haven't set your own."}
                {desk.fee.source === "none" && " — nothing set anywhere. Unset means no fee, never a surprise number."}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
                Your fee rides each load at release and shows to the claiming carrier — poster name and fee %
                in plain view — before they claim. The claiming carrier pays it once per load. Records only:
                the app moves no money for it.
              </p>
              {desk.fee.hasPosterAccount ? (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <div className="w-40">
                    <label className={LABEL} htmlFor="md-poster-fee">My fee % (0–20)</label>
                    <input
                      id="md-poster-fee"
                      className={INPUT}
                      inputMode="decimal"
                      placeholder="Blank = use default"
                      value={posterFeeDraft}
                      onChange={(e) => setPosterFeeDraft(e.target.value)}
                      aria-label="My dispatcher fee percent, 0 to 20"
                    />
                  </div>
                  <button
                    type="button"
                    className={BTN}
                    disabled={busy}
                    onClick={() => {
                      const trimmed = posterFeeDraft.trim();
                      void run(
                        () => api.setMyPosterFee({ feePct: trimmed === "" ? null : Number(trimmed) }),
                        trimmed === ""
                          ? "Your own fee cleared — your loads fall back to the company default (or no fee)."
                          : "Your fee saved — it rides the loads you release from now on.",
                      );
                    }}
                  >
                    Save my fee
                  </button>
                  <span className="text-xs text-[var(--dim)]">
                    On poster account {desk.fee.posterName ?? "yours"}.
                  </span>
                </div>
              ) : (
                <p className="mt-2 text-sm text-[var(--dim)]">
                  Link your poster account above to set your own fee — it takes precedence over any company
                  default on your loads.
                </p>
              )}
              {desk.fee.companyFeePct != null || desk.fee.canSetCompanyFee ? (
                <div className="mt-3 border-t border-[var(--border)] pt-3">
                  {desk.fee.canSetCompanyFee ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="w-40">
                        <label className={LABEL} htmlFor="md-company-fee">Company default % (0–20)</label>
                        <input
                          id="md-company-fee"
                          className={INPUT}
                          inputMode="decimal"
                          placeholder="Blank = no fee"
                          value={companyFeeDraft}
                          onChange={(e) => setCompanyFeeDraft(e.target.value)}
                          aria-label="Company default dispatcher fee percent, 0 to 20"
                        />
                      </div>
                      <button
                        type="button"
                        className={BTN_GHOST}
                        disabled={busy}
                        onClick={() => {
                          const trimmed = companyFeeDraft.trim();
                          void run(
                            () => api.setDispatcherFee({ feePct: trimmed === "" ? null : Number(trimmed) }),
                            trimmed === ""
                              ? "Company default cleared."
                              : "Company default saved — posters without their own fee carry it.",
                          );
                        }}
                      >
                        Save company default
                      </button>
                      <span className="text-xs text-[var(--dim)]">
                        {desk.companyName}'s default — every poster in the company without their own fee
                        carries it.
                      </span>
                    </div>
                  ) : (
                    <p className="text-sm text-[var(--dim)]">
                      Company default ({desk.companyName}):{" "}
                      {desk.fee.companyFeePct != null ? `${desk.fee.companyFeePct}%` : "not set (0%)"} — the
                      company owner sets it; your own fee above overrides it on your loads.
                    </p>
                  )}
                </div>
              ) : null}
            </section>

            {/* My platform fees */}
            <section className="mt-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3" aria-label="My platform fees">
              <h3 className="font-condensed text-lg font-semibold">🧾 My platform fees</h3>
              <p className="mt-1 text-sm leading-relaxed">
                The platform charges <strong>2% of a dispatched load's gross pay</strong>, recorded when the
                load's delivery seals — “Platform fee 2% — invoiced at sealed delivery.” These are the
                accruals on loads <strong>you</strong> posted
                {desk.companyName && desk.via !== "solo"
                  ? " — for company loads the fee sits on the company's books; this is your loads' slice of it."
                  : " — you post solo, so they accrue to you as a person."}{" "}
                Records only: no money moves in the app.
              </p>
              <p className="mt-1.5 text-sm">
                Accrued on my loads so far: <strong>{money(desk.platformFeeTotal)}</strong>
                {desk.platformFeeEntries.length > 0 && (
                  <span className="text-[var(--dim)]">
                    {" "}
                    across {desk.platformFeeEntries.length} sealed load{desk.platformFeeEntries.length === 1 ? "" : "s"}
                  </span>
                )}
              </p>
              {desk.platformFeeEntries.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {desk.platformFeeEntries.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-[var(--surface)] px-3 py-2 text-sm">
                      <span>
                        {e.label} · Load #{e.loadId} · ran by @{e.carrierUsername}
                        {e.companyName ? ` · ${e.companyName}` : " · solo"} ·{" "}
                        {new Date(e.deliveredAt).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                      <span className="font-semibold">
                        {money(e.feeAmount)} <span className="font-normal text-[var(--dim)]">of {money(e.grossAmount)} gross</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* One desk or the other — the solo desk's exit (round 4).
                Shown while the stored solo flag is open: in solo mode
                it's the switch to a company channel; in the stored-
                BOTH case (soloSuppressed) it just clears the flag —
                company standing already governs the desk. */}
            {desk.soloDeskOpen && (
              <section className="mt-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3" aria-label="Close my solo desk">
                <h3 className="font-condensed text-lg font-semibold">🚪 One desk or the other — close the solo desk</h3>
                {desk.soloSuppressed ? (
                  <p className="mt-1 text-sm leading-relaxed">
                    Your solo flag is still on file, but you're dispatching under{" "}
                    {desk.standingCompanyName ?? "a company"} — <strong>company standing wins</strong>, so the
                    solo desk already reads as closed, here and for the platform's 2% accrual, while that
                    standing stands. Clear the flag for good here whenever you like; your records don't
                    change either way.
                  </p>
                ) : (
                  <p className="mt-1 text-sm leading-relaxed">
                    Your solo desk is open, and while it is, the company doors — a dispatch seat, a dispatch
                    company of your own — refuse you: a dispatcher runs <strong>one desk or the other, never
                    both</strong>, so no load can ever be double-booked across the two. Closing is refused
                    while you have <strong>live loads</strong> on the board under your solo poster — let them
                    seal on delivery, or withdraw them, first; freight never crosses the switch. Closing
                    deletes nothing: your pipeline history and every recorded platform fee stand exactly as
                    recorded.
                  </p>
                )}
                <button
                  type="button"
                  className={`${BTN_GHOST} mt-2`}
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => api.closeMyDesk({}),
                      "Your solo desk is closed — the company doors can open now. Your history and recorded platform fees stand as they are.",
                    )
                  }
                >
                  Close my solo desk
                </button>
              </section>
            )}

            {/* Shortcuts — my chats + my desk context */}
            <section className="mt-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3" aria-label="Shortcuts">
              <h3 className="font-condensed text-lg font-semibold">🔗 My shortcuts</h3>
              {desk.chats.length > 0 ? (
                <>
                  <p className="mt-1 text-xs font-bold uppercase tracking-wide text-[var(--dim)]">My company chats</p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {desk.chats.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className={BTN_GHOST}
                        aria-label={`Open chat ${c.name}`}
                        onClick={() => onOpenChatGroup(c.id)}
                      >
                        💬 {c.name}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="mt-1 text-sm text-[var(--dim)]">
                  {desk.companyName
                    ? "No company chats on your list yet."
                    : "Solo desk — no company chats. Your DMs and groups live in Chat as always."}
                </p>
              )}
              <div className="mt-2.5 flex flex-wrap gap-2">
                {desk.companyKind === "dispatch" && onOpenDispatchDesk && (
                  <button type="button" className={BTN_GHOST} onClick={onOpenDispatchDesk}>
                    🗂️ Open the company Dispatch Desk
                  </button>
                )}
                {desk.companyName && (
                  <button type="button" className={BTN_GHOST} onClick={onOpenCompany}>
                    🏢 My company — {desk.companyName}
                  </button>
                )}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-[var(--dim)]">
                The company Dispatch Desk is the roof view — the owner sees the whole company's work there.
                This desk stays yours alone.
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
