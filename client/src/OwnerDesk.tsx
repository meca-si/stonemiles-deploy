// STONEMILES Owner Desk — the FLEET OWNER's home screen (round 5,
// x 2026-11-02: "Build Broker Desk + Owner Desk to match My Desk").
//
// The Owner Console keeps its deep work — this desk is the command
// screen on top of it, in the My Desk pattern: the whole COMPANY
// PIPELINE (every company load by state, company board + Open Board
// + the review queue), the REVIEW QUEUE front and center with a
// jump into the Owner Console queue, a ROSTER SNAPSHOT (drivers,
// seats used/available, dispatch seats), PLAN & BILLING state
// (locked tier copy, the billing basis where relevant), and COMPANY
// TOTALS (loads sealed, gross moved). Shortcuts lead INTO the
// Owner Console functions — nothing here duplicates them.
//
// ELIGIBILITY (server-decided, desks.ts): the owner of a kind=fleet
// company. Dispatch company owners keep their Dispatch Desk as
// their company roof — this desk is for FLEET owners. Ineligible
// accounts get the plain explainer + the doors (create a fleet
// company / the Fleet Owner plan). Fleet owners who also dispatch
// under their own fleet hold this desk AND My Desk (company mode)
// side by side — round 4's coexistence, undisturbed.
//
// WALLS: every read behind this sheet is scoped to the caller's
// own company on the server — another company's loads, roster, and
// totals never appear here; they answer as nonexistent. Records
// only: this desk moves NO money and handles NO freight pay.

import { useQuery } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";

type OwnerDeskData = ApiResponse<typeof api, "getOwnerDesk">;
type PipelineRow = OwnerDeskData["pipeline"][number];

const BTN =
  "rounded-lg bg-[var(--accent)] px-4 py-2.5 font-bold text-black disabled:opacity-50";
const BTN_GHOST =
  "rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-3 py-2 text-sm font-semibold disabled:opacity-50";

const STATE_ORDER = ["draft", "review", "live", "claimed", "delivered"] as const;

function money(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function OwnerDesk({
  onClose,
  onOpenBrokerPortal,
  onOpenFleetBoard,
  onOpenCompany,
  onOpenPlans,
  onOpenMyDesk,
}: {
  onClose: () => void;
  /** Jump into the Owner Console review queue (the Broker Portal desk face). */
  onOpenBrokerPortal: () => void;
  /** Jump to the company Fleet Board. */
  onOpenFleetBoard: () => void;
  /** Jump to Chat → My company (create a company / company setup). */
  onOpenCompany: () => void;
  /** Open the Plans sheet (the Fleet Owner plan door). */
  onOpenPlans: () => void;
  /** Fleet owners who also dispatch: My Desk (company mode) sits beside this desk. */
  onOpenMyDesk?: () => void;
}) {
  const deskQuery = useQuery({ queryKey: ["owner-desk"], queryFn: () => api.getOwnerDesk({}) });
  const desk = deskQuery.data;

  const counts = new Map<string, number>();
  for (const row of desk?.pipeline ?? []) counts.set(row.state, (counts.get(row.state) ?? 0) + 1);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-label="Owner Desk">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-[var(--surface)] p-4 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-condensed text-2xl font-bold">🏢 Owner Desk</h2>
            <p className="mt-0.5 text-sm text-[var(--dim)]">
              Your fleet's command screen — the company's pipeline, its review queue, roster, plan, and
              totals. Just your company: another fleet's work never shows here.
            </p>
            {desk?.companyName && desk.eligible && (
              <p className="mt-1 text-sm">
                <span className="rounded-full bg-[var(--surface2)] px-2.5 py-1 text-xs font-bold">
                  {desk.companyName}
                </span>
              </p>
            )}
          </div>
          <button type="button" className={BTN_GHOST} onClick={onClose} aria-label="Close Owner Desk">
            Close
          </button>
        </div>

        {deskQuery.isPending ? (
          <p className="mt-4 text-sm text-[var(--dim)]">Opening your desk…</p>
        ) : !desk?.eligible ? (
          <>
            {/* Not a fleet owner — what the desk is + the doors in. */}
            <section className="mt-4 rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3" aria-label="What the Owner Desk is">
              <h3 className="font-condensed text-lg font-semibold">What the Owner Desk is</h3>
              <p className="mt-1 text-sm leading-relaxed">
                The Owner Desk is a <strong>fleet owner's</strong> home screen: the whole company's
                pipeline in plain states (draft, in review, live, claimed, delivered — sealed), the
                review queue front and center, a roster and seat snapshot, the plan and billing state,
                and the company's totals. The Owner Console keeps the deep work — this desk is the
                command screen on top of it.
              </p>
              <p className="mt-2 text-sm leading-relaxed">
                This account doesn't own a fleet company, so there's no desk to open yet. Two doors in:
              </p>
              <ul className="mt-2 space-y-2 text-sm leading-relaxed">
                <li className="rounded-lg bg-[var(--surface)] px-3 py-2.5">
                  <strong>1 · Create a fleet company.</strong> Set up your company in Chat → My company —
                  a fleet (runs its own trucks), not “I dispatch for others.” The moment you own a fleet
                  company, this desk opens on it.
                  <div className="mt-1.5">
                    <button type="button" className={BTN_GHOST} onClick={onOpenCompany}>
                      Go to My company
                    </button>
                  </div>
                </li>
                <li className="rounded-lg bg-[var(--surface)] px-3 py-2.5">
                  <strong>2 · The Fleet Owner plan.</strong> A fleet company runs on the Fleet Owner plan
                  — the base covers 3 driver seats and the first dispatch seat; extra seats price per
                  seat. See the locked plan copy in Plans.
                  <div className="mt-1.5">
                    <button type="button" className={BTN_GHOST} onClick={onOpenPlans}>
                      See Plans
                    </button>
                  </div>
                </li>
              </ul>
              <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">
                Own a dispatch company instead? Your company roof is the Dispatch Desk — the Owner Desk
                is for fleets.
              </p>
            </section>
          </>
        ) : (
          <>
            {/* Review queue — front and center */}
            <section className="mt-4 rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3" aria-label="Review queue">
              <h3 className="font-condensed text-lg font-semibold">📥 Review queue</h3>
              {desk.reviewQueueCount > 0 ? (
                <p className="mt-1 text-sm leading-relaxed">
                  <strong>{desk.reviewQueueCount} load{desk.reviewQueueCount === 1 ? "" : "s"} waiting</strong>{" "}
                  in {desk.companyName}'s review queue — poster loads sent to your desk that nobody has
                  released, edited, or returned yet. Nothing is public until your desk releases it.
                </p>
              ) : (
                <p className="mt-1 text-sm leading-relaxed">
                  Nothing is waiting — no poster loads sit in {desk.companyName}'s review queue right
                  now. New sends land here first, before anything reaches a board.
                </p>
              )}
              <div className="mt-2">
                <button type="button" className={BTN} onClick={onOpenBrokerPortal}>
                  Open the review queue
                </button>
              </div>
            </section>

            {/* Company pipeline */}
            <section className="mt-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3" aria-label="Company pipeline">
              <h3 className="font-condensed text-lg font-semibold">📦 Company pipeline — all company loads</h3>
              <p className="mt-1 flex flex-wrap gap-1.5" aria-label="Pipeline counts">
                {STATE_ORDER.map((s) => (
                  <span key={s} className="rounded-full bg-[var(--surface)] px-2.5 py-1 text-xs font-bold">
                    {(desk.pipeline.find((r) => r.state === s)?.stateLabel ?? s)}: {counts.get(s) ?? 0}
                  </span>
                ))}
              </p>
              {desk.pipeline.length === 0 ? (
                <p className="mt-2 text-sm text-[var(--dim)]">
                  No company loads yet. Loads your company posts, loads pushed out to the Open Board, and
                  poster loads waiting in your review queue all land here in plain states.
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
                          row.scopeLabel,
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
                <button type="button" className={BTN} onClick={onOpenFleetBoard}>
                  Open the Fleet Board
                </button>
              </div>
            </section>

            {/* Roster snapshot */}
            <section className="mt-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3" aria-label="Roster snapshot">
              <h3 className="font-condensed text-lg font-semibold">👥 Roster snapshot</h3>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-[var(--surface)] px-2 py-2.5">
                  <div className="font-condensed text-2xl font-bold">{desk.roster.drivers}</div>
                  <div className="text-xs text-[var(--dim)]">Drivers</div>
                </div>
                <div className="rounded-lg bg-[var(--surface)] px-2 py-2.5">
                  <div className="font-condensed text-2xl font-bold">
                    {desk.roster.driverSeatsUsed}/{desk.roster.includedDriverSeats}
                  </div>
                  <div className="text-xs text-[var(--dim)]">
                    Driver seats used ({desk.roster.driverSeatsAvailable} open in plan)
                  </div>
                </div>
                <div className="rounded-lg bg-[var(--surface)] px-2 py-2.5">
                  <div className="font-condensed text-2xl font-bold">
                    {desk.roster.dispatchSeatsUsed}/{desk.roster.includedDispatchSeats}
                  </div>
                  <div className="text-xs text-[var(--dim)]">
                    Dispatch seats ({desk.roster.dispatchSeatsAvailable} open in plan)
                  </div>
                </div>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-[var(--dim)]">
                {desk.roster.members} on the roster in all (owner counts as a driver seat, the way the
                plan counts). Seats past the plan's allowance are the extra seats in the billing basis
                below. Manage seats and drivers in the Owner Console → Drivers, or from My company.
              </p>
            </section>

            {/* Plan & billing */}
            <section className="mt-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3" aria-label="Plan and billing">
              <h3 className="font-condensed text-lg font-semibold">💳 Plan &amp; billing</h3>
              <p className="mt-1 text-sm leading-relaxed">
                <strong>{desk.plan.planLabel}</strong> · billed {desk.plan.period === "yearly" ? "yearly" : "monthly"}
              </p>
              {desk.plan.billingLine && (
                <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">{desk.plan.billingLine}</p>
              )}
              <div className="mt-2">
                <button type="button" className={BTN_GHOST} onClick={onOpenPlans}>
                  See Plans
                </button>
              </div>
            </section>

            {/* Company totals */}
            <section className="mt-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3" aria-label="Company totals">
              <h3 className="font-condensed text-lg font-semibold">🧾 Company totals</h3>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-[var(--surface)] px-2 py-2.5">
                  <div className="font-condensed text-2xl font-bold">{desk.totals.posted}</div>
                  <div className="text-xs text-[var(--dim)]">Loads on the board &amp; in queue</div>
                </div>
                <div className="rounded-lg bg-[var(--surface)] px-2 py-2.5">
                  <div className="font-condensed text-2xl font-bold">{desk.totals.sealed}</div>
                  <div className="text-xs text-[var(--dim)]">Loads sealed</div>
                </div>
                <div className="rounded-lg bg-[var(--surface)] px-2 py-2.5">
                  <div className="font-condensed text-2xl font-bold">{money(desk.totals.grossMoved)}</div>
                  <div className="text-xs text-[var(--dim)]">Gross moved</div>
                </div>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-[var(--dim)]">
                Gross moved counts the freight on company loads that reached sealed delivery.
              </p>
            </section>

            {/* Shortcuts into the Owner Console functions */}
            <section className="mt-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3" aria-label="Shortcuts">
              <h3 className="font-condensed text-lg font-semibold">🔗 Shortcuts</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={BTN_GHOST} onClick={onOpenFleetBoard}>
                  🚚 Fleet Board
                </button>
                <button type="button" className={BTN_GHOST} onClick={onOpenBrokerPortal}>
                  📥 Review queue
                </button>
                <button type="button" className={BTN_GHOST} onClick={onOpenCompany}>
                  🏢 My company — {desk.companyName}
                </button>
                {onOpenMyDesk && (
                  <button type="button" className={BTN_GHOST} onClick={onOpenMyDesk}>
                    🧑‍💼 My Desk — my own dispatched loads
                  </button>
                )}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-[var(--dim)]">
                The Owner Console holds the deep work — drivers, hours, documents, settlements. This
                desk is the command screen on top of it.
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
