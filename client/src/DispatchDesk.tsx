// STONEMILES Dispatch Desk — the dispatch company's home surface
// (migration 0087, x 2026-11-02; round 2 same day).
//
// A dispatch company owns no trucks: it runs the desk for client
// fleets and their drivers. This sheet is that desk: the client book
// (lightweight records — name, contact, MC/DOT when they have them),
// the company's drivers and the client each one is stamped to, the
// driver-code issuer (a code can name the client it stamps its
// driver to), and the two posting doors — post/assign inside the
// company's own walls on its PRIVATE board (a Fleet Owner surface:
// converted companies only), and public posting through the
// PLATFORM review queue (Broker Portal rails) under the company's
// own name, released platform-side — never self-released.
//
// ROUND 2 STATE, rendered honestly here: the company starts as a
// PLAIN PROFILE (no Fleet Owner plan, no owner badge); the
// conversion card below is the one door to Fleet Owner — full
// locked Fleet price, same activation the first-driver gate demands.
// The fees card carries the owner's dispatcher fee (0–20%) and the
// platform fee accrued while dispatch-only (2% of gross at sealed
// delivery, records only).
//
// HARD RULES rendered honestly here: the server scopes every read
// and write to the caller's own company — this sheet only ever sees
// its own clients and drivers. The desk moves NO money and handles
// NO freight pay; freight pay runs direct from poster to carrier.
// Drivers join ONLY by single-use code — there is no other door in.

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";

type DeskData = ApiResponse<typeof api, "getDispatchDesk">;
type DeskClient = DeskData["clients"][number];

const INPUT =
  "w-full rounded-lg bg-[var(--surface2)] border border-[var(--border)] px-3 py-2.5 text-base text-[var(--text)] placeholder:text-[var(--dim)]";
const LABEL = "block text-xs font-semibold uppercase tracking-wide text-[var(--dim)] mb-1";
const BTN =
  "rounded-lg bg-[var(--accent)] px-4 py-2.5 font-bold text-black disabled:opacity-50";
const BTN_GHOST =
  "rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-3 py-2 text-sm font-semibold disabled:opacity-50";

type ClientDraft = {
  name: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  mcNumber: string;
  usdotNumber: string;
};

const EMPTY_DRAFT: ClientDraft = {
  name: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  mcNumber: "",
  usdotNumber: "",
};

export function DispatchDesk({
  onClose,
  onPostLoad,
  onOpenBrokerPortal,
}: {
  onClose: () => void;
  /** Jump to the Fleet Board, where Owner/Dispatch post and assign. */
  onPostLoad: () => void;
  /** Jump to the Broker Portal — the review-queue door to the public board. */
  onOpenBrokerPortal: () => void;
}) {
  const queryClient = useQueryClient();
  const deskQuery = useQuery({ queryKey: ["dispatch-desk"], queryFn: () => api.getDispatchDesk({}) });
  const companyQuery = useQuery({ queryKey: ["company"], queryFn: () => api.getCompany({}) });
  const [banner, setBanner] = useState<string | null>(null);
  const [draft, setDraft] = useState<ClientDraft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [codeClientId, setCodeClientId] = useState<string>("");
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feeDraft, setFeeDraft] = useState<string>("");
  const [activateArmed, setActivateArmed] = useState(false);

  const desk = deskQuery.data;
  const companyFeePct = desk?.dispatcherFeePct ?? null;
  useEffect(() => {
    setFeeDraft(companyFeePct != null ? String(companyFeePct) : "");
  }, [companyFeePct]);
  const members = companyQuery.data?.members ?? [];
  const dispatchSeats = members.filter((m) => m.role === "dispatch");

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["dispatch-desk"] });
    void queryClient.invalidateQueries({ queryKey: ["company"] });
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

  const saveClient = () => {
    const payload = {
      name: draft.name,
      contactName: draft.contactName.trim() ? draft.contactName : null,
      contactEmail: draft.contactEmail.trim() ? draft.contactEmail : null,
      contactPhone: draft.contactPhone.trim() ? draft.contactPhone : null,
      mcNumber: draft.mcNumber.trim() ? draft.mcNumber : null,
      usdotNumber: draft.usdotNumber.trim() ? draft.usdotNumber : null,
    };
    void run(
      () =>
        editingId != null
          ? api.updateClientFleet({ id: editingId, ...payload })
          : api.createClientFleet(payload).then((r) => ({ ok: r.ok, error: r.error })),
      editingId != null ? "Client saved." : "Client added to your book.",
    ).then(() => {
      setDraft(EMPTY_DRAFT);
      setEditingId(null);
    });
  };

  const startEdit = (c: DeskClient) => {
    setEditingId(c.id);
    setDraft({
      name: c.name,
      contactName: c.contactName ?? "",
      contactEmail: c.contactEmail ?? "",
      contactPhone: c.contactPhone ?? "",
      mcNumber: c.mcNumber ?? "",
      usdotNumber: c.usdotNumber ?? "",
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-label="Dispatch Desk">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-[var(--surface)] p-4 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-condensed text-2xl font-bold">🗂️ Dispatch Desk</h2>
            <p className="mt-0.5 text-sm text-[var(--dim)]">
              {desk?.companyName ?? "Your company"} · Dispatch company — you run the desk for client fleets and
              their drivers. Everything here is inside your company's walls: your clients, your drivers, nobody
              else's.
            </p>
            {desk?.isDispatchCompany && (
              <p className="mt-1 text-sm">
                <span className="rounded-full bg-[var(--surface2)] px-2.5 py-1 text-xs font-bold">
                  {desk.activated ? "Fleet Owner plan · ACTIVE" : "Plain profile — no plan, no owner badge"}
                </span>
              </p>
            )}
          </div>
          <button type="button" className={BTN_GHOST} onClick={onClose} aria-label="Close Dispatch Desk">
            Close
          </button>
        </div>

        {banner && (
          <p className="mt-3 rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-sm" role="status">
            {banner}
          </p>
        )}

        {deskQuery.isPending ? (
          <p className="mt-4 text-sm text-[var(--dim)]">Opening the desk…</p>
        ) : !desk?.isDispatchCompany ? (
          <p className="mt-4 rounded-xl bg-[var(--surface2)] px-3 py-3 text-sm leading-relaxed">
            The Dispatch Desk belongs to dispatch companies — accounts created with “I dispatch for others.”
            Fleet companies run their own trucks from the Fleet Board and My company instead.
          </p>
        ) : (
          <>
            {/* Plan state / Fleet Owner conversion (round 2) */}
            <section className="mt-4 rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3" aria-label="Fleet Owner conversion">
              <h3 className="font-condensed text-lg font-semibold">👑 Fleet Owner plan</h3>
              {desk.activated ? (
                <p className="mt-1 text-sm leading-relaxed">
                  <strong>Active ✓</strong> — this company runs on the Fleet Owner plan: the owner badge is on,
                  your own drivers join by code, and your private company board is open. Loads on your private
                  board carry no platform fee and no dispatcher-fee mechanics.
                </p>
              ) : (
                <>
                  <p className="mt-1 text-sm leading-relaxed">
                    Your dispatch company is a <strong>plain profile</strong> — no Fleet Owner subscription, no
                    owner badge. The client book, this desk, and public posting all work as-is.{" "}
                    <strong>Converting to Fleet Owner</strong> is what unlocks drivers of your own and your
                    private company board, at the full Fleet price — $49.99/mo or $499/yr, up to 3 trucks with
                    the first dispatch seat included; extra seats +$9.99/mo or $99/yr. Nothing is charged today;
                    billing starts at the app-store release.
                  </p>
                  {desk.activationBillingLine && (
                    <p className="mt-1.5 rounded-lg bg-[var(--surface)] px-2.5 py-2 text-sm font-semibold">
                      {desk.activationBillingLine}
                    </p>
                  )}
                  {desk.canOwnClients ? (
                    <button
                      type="button"
                      className={activateArmed ? "mt-2 rounded-lg bg-[var(--danger)] px-4 py-2.5 font-bold text-white disabled:opacity-50" : `${BTN} mt-2`}
                      disabled={busy}
                      aria-label={activateArmed ? "Tap again to convert to Fleet Owner" : "Convert to Fleet Owner"}
                      onClick={() => {
                        if (!activateArmed) {
                          setActivateArmed(true);
                          return;
                        }
                        setActivateArmed(false);
                        void run(
                          () => api.activateDispatchFleetPlan({}),
                          "Fleet Owner plan is ACTIVE — the owner badge is on, driver codes are unlocked below, and your private company board is open.",
                        );
                      }}
                    >
                      {activateArmed ? "Tap again — convert to Fleet Owner" : "Convert to Fleet Owner"}
                    </button>
                  ) : (
                    <p className="mt-2 text-sm text-[var(--dim)]">
                      The company owner converts the company — dispatch seats work the desk either way, on
                      their own plain profile accounts.
                    </p>
                  )}
                </>
              )}
            </section>

            {/* Fees (round 2): the dispatcher's own fee + platform fee accruals */}
            <section className="mt-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3" aria-label="Dispatcher fee and platform fees">
              <h3 className="font-condensed text-lg font-semibold">💲 Fees — dispatcher fee &amp; platform fee</h3>
              <p className="mt-1 text-sm leading-relaxed">
                <strong>Your dispatcher fee</strong> is the fee YOUR company charges on loads it posts: it rides
                each load released from now on and shows to the claiming carrier on the load — poster name and
                fee % in plain view — <em>before</em> they claim. The claiming carrier pays it once per load.
                Records only: the app moves no money for it.
              </p>
              {desk.canOwnClients ? (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <div className="w-36">
                    <label className={LABEL} htmlFor="dd-fee-pct">Dispatcher fee % (0–20)</label>
                    <input
                      id="dd-fee-pct"
                      className={INPUT}
                      inputMode="decimal"
                      placeholder="Blank = no fee"
                      value={feeDraft}
                      onChange={(e) => setFeeDraft(e.target.value)}
                      aria-label="Dispatcher fee percent, 0 to 20"
                    />
                  </div>
                  <button
                    type="button"
                    className={BTN}
                    disabled={busy}
                    onClick={() => {
                      const trimmed = feeDraft.trim();
                      void run(
                        () => api.setDispatcherFee({ feePct: trimmed === "" ? null : Number(trimmed) }),
                        trimmed === ""
                          ? "Dispatcher fee cleared — your loads carry no dispatcher fee."
                          : "Dispatcher fee saved — it rides the loads you release from now on.",
                      );
                    }}
                  >
                    Save fee
                  </button>
                  <span className="text-xs text-[var(--dim)]">
                    {desk.dispatcherFeePct != null
                      ? `Now set: ${desk.dispatcherFeePct}%`
                      : "Not set — no dispatcher fee (0%)."}
                    {desk.posterLinked &&
                      (desk.posterFeePct != null
                        ? ` Your poster account's own fee is ${desk.posterFeePct}% — that's the one your loads carry.`
                        : ` Your poster carries this company fee${desk.posterEffectiveFeePct != null ? ` (${desk.posterEffectiveFeePct}%)` : ""}.`)}
                  </span>
                </div>
              ) : (
                <p className="mt-2 text-sm text-[var(--dim)]">
                  Company fee: {desk.dispatcherFeePct != null ? `${desk.dispatcherFeePct}%` : "not set (0%)"} — the
                  company owner sets it; seats follow the company's setting.
                </p>
              )}
              <div className="mt-3 border-t border-[var(--border)] pt-3">
                <p className="text-sm leading-relaxed">
                  <strong>Platform fee:</strong> while this company stays dispatch-only, each of its dispatched
                  loads that reaches sealed delivery records a platform fee of 2% of the load's gross pay —
                  “Platform fee 2% — invoiced at sealed delivery.” Converting to Fleet Owner ends it; private-board
                  loads never carry it.
                </p>
                <p className="mt-1.5 text-sm">
                  Accrued so far:{" "}
                  <strong>${desk.platformFeeTotal.toFixed(2)}</strong>
                  {desk.platformFeeEntries.length > 0 && (
                    <span className="text-[var(--dim)]"> across {desk.platformFeeEntries.length} sealed load{desk.platformFeeEntries.length === 1 ? "" : "s"}</span>
                  )}
                </p>
                {desk.platformFeeEntries.length > 0 && (
                  <ul className="mt-2 space-y-1.5">
                    {desk.platformFeeEntries.map((e) => (
                      <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-[var(--surface)] px-3 py-2 text-sm">
                        <span>
                          {e.label} · Load #{e.loadId} · ran by @{e.carrierUsername} ·{" "}
                          {new Date(e.deliveredAt).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
                        </span>
                        <span className="font-semibold">
                          ${e.feeAmount.toFixed(2)} <span className="font-normal text-[var(--dim)]">of ${e.grossAmount.toFixed(2)} gross</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            {/* Post & assign */}
            <section className="mt-4 rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3" aria-label="Post and assign loads">
              <h3 className="font-condensed text-lg font-semibold">📦 Loads — post &amp; assign</h3>
              {desk.activated ? (
                <>
                  <p className="mt-1 text-sm leading-relaxed">
                    Post a load from the rate con (photo or PDF — it fills the form, the driver confirms before
                    anything saves, and the filing seals) and assign it straight to one of your drivers on your
                    company's private board — visible only inside your company. Filed load documents copy to the
                    driver, to dispatch, and to the owner of record by default; pay-stub copies stay off unless
                    the driver opts in.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className={BTN} onClick={onPostLoad}>
                      Open the board — post / assign
                    </button>
                  </div>
                </>
              ) : (
                <p className="mt-1 text-sm leading-relaxed">
                  Your <strong>private company board</strong> is a Fleet Owner surface — dispatch-only accounts
                  don't have one. Convert above and this opens: post from the rate con and assign straight to
                  your own drivers, visible only inside your company. Until then, loads for outside carriers go
                  out through the public-board section below.
                </p>
              )}
              <p className="mt-2 text-xs leading-relaxed text-[var(--dim)]">
                This desk never holds freight money — pay runs direct from the poster to the carrier. The app
                tracks and seals the records only.
              </p>
            </section>

            {/* Public posting — the review queue door */}
            <section className="mt-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3" aria-label="Post to the public board">
              <h3 className="font-condensed text-lg font-semibold">🌐 Public board — through the platform review queue</h3>
              <p className="mt-1 text-sm leading-relaxed">
                Loads for outside carriers go public only through the <strong>platform</strong> review queue,
                under your company's own name — free to post. Your poster account submits into the platform
                desk's queue (RUGGS LOGISTICS / Owner Console), and the load reaches the Open Board only when
                the platform desk releases it — your company never releases its own public posts.
              </p>
              {desk.posterLinked ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-[var(--surface)] px-2.5 py-1 text-xs font-bold">
                    Poster account: {desk.posterName ?? desk.companyName} ✓
                  </span>
                  <button type="button" className={BTN} onClick={onOpenBrokerPortal}>
                    Open the Broker Portal
                  </button>
                </div>
              ) : desk.canOwnClients ? (
                <div className="mt-2">
                  <button
                    type="button"
                    className={BTN}
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => api.linkDispatchPosterAccount({}),
                        "Poster account linked — your company can now post to the public board through the review queue.",
                      )
                    }
                  >
                    Link my poster account
                  </button>
                  <p className="mt-1.5 text-xs text-[var(--dim)]">
                    One link, under your company's name. It carries your setup contact email as the contact of
                    record.
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-sm text-[var(--dim)]">
                  The company owner links the poster account; dispatch seats then post through the portal.
                </p>
              )}
            </section>

            {/* Client book */}
            <section className="mt-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3" aria-label="Client fleets">
              <h3 className="font-condensed text-lg font-semibold">🏢 Client fleets</h3>
              {desk.clients.length === 0 ? (
                <p className="mt-1 text-sm text-[var(--dim)]">
                  No clients yet. Add the fleets and shippers you dispatch for — a name is enough to start;
                  contact and MC/DOT can ride along when you have them.
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {desk.clients.map((c) => (
                    <li key={c.id} className="rounded-lg bg-[var(--surface)] px-3 py-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold">{c.name}</span>
                        <span className="shrink-0 text-xs font-bold text-[var(--dim)]">
                          {c.driverCount} driver{c.driverCount === 1 ? "" : "s"}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs leading-relaxed text-[var(--dim)]">
                        {[c.contactName, c.contactEmail, c.contactPhone].filter(Boolean).join(" · ") || "No contact on file"}
                        {[c.mcNumber ? `MC ${c.mcNumber}` : null, c.usdotNumber ? `DOT ${c.usdotNumber}` : null]
                          .filter(Boolean)
                          .join(" · ")
                          ? ` · ${[c.mcNumber ? `MC ${c.mcNumber}` : null, c.usdotNumber ? `DOT ${c.usdotNumber}` : null].filter(Boolean).join(" · ")}`
                          : ""}
                      </div>
                      {desk.canOwnClients && (
                        <div className="mt-1.5 flex gap-2">
                          <button type="button" className={BTN_GHOST} disabled={busy} onClick={() => startEdit(c)}>
                            Edit
                          </button>
                          <button
                            type="button"
                            className={BTN_GHOST}
                            disabled={busy}
                            onClick={() =>
                              void run(
                                () => api.deleteClientFleet({ id: c.id }),
                                `${c.name} removed — its drivers keep their seats as company-direct.`,
                              )
                            }
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {desk.canOwnClients && (
                <div className="mt-3 border-t border-[var(--border)] pt-3">
                  <div className="text-sm font-semibold">{editingId != null ? "Edit client" : "Add a client fleet"}</div>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div>
                      <label className={LABEL} htmlFor="dd-client-name">Client name *</label>
                      <input id="dd-client-name" className={INPUT} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Peacock Pavers" />
                    </div>
                    <div>
                      <label className={LABEL} htmlFor="dd-client-contact">Contact name</label>
                      <input id="dd-client-contact" className={INPUT} value={draft.contactName} onChange={(e) => setDraft({ ...draft, contactName: e.target.value })} />
                    </div>
                    <div>
                      <label className={LABEL} htmlFor="dd-client-email">Contact email</label>
                      <input id="dd-client-email" className={INPUT} value={draft.contactEmail} onChange={(e) => setDraft({ ...draft, contactEmail: e.target.value })} />
                    </div>
                    <div>
                      <label className={LABEL} htmlFor="dd-client-phone">Contact phone</label>
                      <input id="dd-client-phone" className={INPUT} value={draft.contactPhone} onChange={(e) => setDraft({ ...draft, contactPhone: e.target.value })} />
                    </div>
                    <div>
                      <label className={LABEL} htmlFor="dd-client-mc">MC number (optional)</label>
                      <input id="dd-client-mc" className={INPUT} value={draft.mcNumber} onChange={(e) => setDraft({ ...draft, mcNumber: e.target.value })} />
                    </div>
                    <div>
                      <label className={LABEL} htmlFor="dd-client-dot">USDOT (optional)</label>
                      <input id="dd-client-dot" className={INPUT} value={draft.usdotNumber} onChange={(e) => setDraft({ ...draft, usdotNumber: e.target.value })} />
                    </div>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button type="button" className={BTN} disabled={busy || !draft.name.trim()} onClick={saveClient}>
                      {editingId != null ? "Save client" : "Add client"}
                    </button>
                    {editingId != null && (
                      <button
                        type="button"
                        className={BTN_GHOST}
                        onClick={() => {
                          setEditingId(null);
                          setDraft(EMPTY_DRAFT);
                        }}
                      >
                        Cancel edit
                      </button>
                    )}
                  </div>
                </div>
              )}
            </section>

            {/* Drivers + codes */}
            <section className="mt-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3" aria-label="Drivers and join codes">
              <h3 className="font-condensed text-lg font-semibold">🚚 Drivers</h3>
              <p className="mt-1 text-sm text-[var(--dim)]">
                Drivers join only with a single-use code — no open enrollment. A code can name the client it
                stamps the driver to; the stamp is on the record and ends when the driver leaves.
                {dispatchSeats.length > 0 &&
                  ` Dispatch seats: ${dispatchSeats.map((s) => `@${s.username}`).join(", ")}.`}
              </p>
              {desk.drivers.length === 0 ? (
                <p className="mt-2 text-sm text-[var(--dim)]">
                  {desk.activated
                    ? "No drivers yet — issue a code below and hand it to the driver."
                    : "No drivers yet — your roster opens when the company converts to Fleet Owner (see the gate note below)."}
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {desk.drivers.map((d) => (
                    <li key={d.username} className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--surface)] px-3 py-2.5">
                      <span className="font-semibold">@{d.username}</span>
                      <span className="text-xs text-[var(--dim)]">
                        joined {new Date(d.joinedAt).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                      <span className="flex-1" />
                      <label className="sr-only" htmlFor={`dd-driver-client-${d.username}`}>Client for @{d.username}</label>
                      <select
                        id={`dd-driver-client-${d.username}`}
                        className="rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-2 py-1.5 text-sm"
                        value={d.clientFleetId ?? ""}
                        disabled={busy}
                        onChange={(e) => {
                          const v = e.target.value;
                          void run(
                            () =>
                              api.setDriverClientFleet({
                                username: d.username,
                                clientFleetId: v ? Number(v) : null,
                              }),
                            v ? `@${d.username} stamped to the client.` : `@${d.username} is company-direct now.`,
                          );
                        }}
                      >
                        <option value="">Company-direct</option>
                        {desk.clients.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
              )}

              {desk.canOwnClients && !desk.activated && (
                <div className="mt-3 rounded-xl bg-[var(--surface)] px-3 py-3 text-sm leading-relaxed">
                  <strong>Driver codes are gated on Fleet Owner.</strong> Adding drivers of your own is the one
                  thing a plain profile doesn't do — convert to Fleet Owner in the plan card at the top of this
                  desk and codes unlock here. Client fleets stay free either way; this gate is only about your
                  own roster.
                </div>
              )}
              {desk.canOwnClients && desk.activated && (
                <div className="mt-3 border-t border-[var(--border)] pt-3">
                  <div className="text-sm font-semibold">Issue a driver code</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className="sr-only" htmlFor="dd-code-client">Client this code stamps to</label>
                    <select
                      id="dd-code-client"
                      className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-2 text-sm"
                      value={codeClientId}
                      onChange={(e) => setCodeClientId(e.target.value)}
                    >
                      <option value="">Company-direct (no client)</option>
                      {desk.clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          Stamps to: {c.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className={BTN}
                      disabled={busy}
                      onClick={() => {
                        setBusy(true);
                        void api
                          .generateDriverCode({
                            singleUse: true,
                            clientFleetId: codeClientId ? Number(codeClientId) : null,
                          })
                          .then((r) => {
                            if (r.ok && r.code) {
                              setIssuedCode(r.code);
                              setBanner("Code issued — single-use, it stamps the driver who redeems it.");
                              refresh();
                            } else {
                              setBanner(r.error ?? "Couldn't issue a code.");
                            }
                          })
                          .catch(() => setBanner("Couldn't issue a code — try again."))
                          .finally(() => setBusy(false));
                      }}
                    >
                      Issue code
                    </button>
                  </div>
                  {issuedCode && (
                    <p className="mt-2 rounded-lg bg-[var(--surface)] px-3 py-2 text-sm">
                      Driver code: <strong className="font-condensed text-lg tracking-wider">{issuedCode}</strong> —
                      hand it to the driver; joining drops them into the company chats with the stamp on their
                      record.
                    </p>
                  )}
                  <p className="mt-1.5 text-xs text-[var(--dim)]">
                    Codes unlock once company setup is complete (My company → setup wizard).
                  </p>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
