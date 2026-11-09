// STONEMILES Open Board — vetted owner operators only.
//
// Where loads leave a single fleet: broker loads the RUGGS LOGISTICS
// desk released from the Broker Portal, and fleet loads a fleet owner
// pushed out (overflow) when the fleet is full or short on drivers.
// The server enforces the vetted gate — non-vetted callers receive NO
// load rows at all, so this panel renders the vetting explainer for
// them and the board only for the vetted.
//
// Money rules, stated on the board itself: freight pay runs DIRECT
// from the origin (the fleet owner or the broker, named on every
// card) to the claiming carrier — RUGGS LLC never holds freight money.
// The standard RUGGS LLC dispatch fee applies to an Open Board claim
// exactly as to a fleet-board claim: invoiced once at sealed delivery
// (10% of the final freight amount), under the same settle-to-claim
// ladder — and a load is never charged twice across lanes.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PdfViewer } from "@hatch/space-sdk/pdf";
import { api, type ApiResponse } from "./api";
import { MyDispatchFeesPanel } from "./LoadBoard";
import { laneEstimateFor, rankBoardLoads, type BoardSortKey } from "./loadRate";
import { laneKey, useLaneEstimates } from "./useLaneEstimate";
import { BoardSortControl, PerMileLine } from "./RatePerMile";

type OpenData = ApiResponse<typeof api, "getOpenBoard">;
type OpenRow = OpenData["board"][number];

function money(n: number | null): string {
  return n == null ? "Pay not set" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function laneOf(r: { pickupCity: string | null; pickupState: string | null; deliveryCity: string | null; deliveryState: string | null }): string {
  const a = [r.pickupCity, r.pickupState].filter(Boolean).join(", ") || "Pickup TBD";
  const b = [r.deliveryCity, r.deliveryState].filter(Boolean).join(", ") || "Delivery TBD";
  return `${a} → ${b}`;
}

function originBadge(r: OpenRow): string {
  if (r.originKind === "fleet_overflow") {
    return `🌐 Overflow · from ${r.originLabel ?? "a fleet"}${r.overflowReason ? ` · ${r.overflowReason === "fleet_full" ? "fleet full" : "short on drivers"}` : ""}`;
  }
  if (r.originKind === "broker_poster") {
    return `🌐 Broker load · posted by ${r.originLabel ?? "a broker"}`;
  }
  return "🌐 Open Board";
}

export function OpenBoardPanel({
  setBanner,
  onOpenMyLoad,
}: {
  setBanner: (s: string | null) => void;
  onOpenMyLoad: (loadId: number) => void;
}) {
  const queryClient = useQueryClient();
  const boardQuery = useQuery({ queryKey: ["open-board"], queryFn: () => api.getOpenBoard({}) });
  const data = boardQuery.data;
  const [busy, setBusy] = useState<string | null>(null);
  const [armKey, setArmKey] = useState<string | null>(null);
  // Automatic $/mi + ranking (2026-10-31): Best $/mi by default,
  // total pay printed on every card alongside the $/mi.
  const [sortKey, setSortKey] = useState<BoardSortKey>("perMile");
  const laneEstimates = useLaneEstimates(data?.board ?? []);
  const estFor = (r: OpenRow) => laneEstimateFor(r, laneEstimates.get(laneKey(r)) ?? null);
  const [viewDocId, setViewDocId] = useState<number | null>(null);
  const docQuery = useQuery({
    queryKey: ["open-board-doc", viewDocId],
    queryFn: () => api.getOpenBoardLoadDoc({ id: viewDocId ?? 0 }),
    enabled: viewDocId != null,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["open-board"] });
    void queryClient.invalidateQueries({ queryKey: ["load-board"] });
    void queryClient.invalidateQueries({ queryKey: ["loads"] });
    void queryClient.invalidateQueries({ queryKey: ["trip-queue"] });
    void queryClient.invalidateQueries({ queryKey: ["my-dispatch-fees"] });
  };

  if (boardQuery.isPending) {
    return (
      <section className="glass-panel p-3.5" aria-label="Open Board">
        <p className="text-sm text-[var(--dim)]">Loading the Open Board…</p>
      </section>
    );
  }
  if (!data) return null;

  if (!data.vetted) {
    return (
      <section className="glass-panel p-4" aria-label="Open Board — vetted owner operators only">
        <h2 className="font-condensed text-2xl font-bold">🌐 Open Board — vetted owner operators</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--dim)]">
          The Open Board is where fleets and brokers put loads out beyond one fleet — a fleet that's full or short on
          drivers pushes a load here, and brokers post here through the Broker Portal. Only{" "}
          <strong className="text-[var(--text)]">vetted owner operators</strong> can see and claim these loads: the
          same credential standard that gates broker uploads — Diamond-tier access, running your own operation (a solo
          owner-operator, or a fleet owner claiming for themselves). Employee drivers and dispatch seats in someone
          else's fleet aren't vetted owner operators; their board is their fleet's board.
        </p>
        {data.vettedReasons.map((r) => (
          <p key={r} className="mt-2 rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-sm font-semibold leading-relaxed" role="note">
            {r}
          </p>
        ))}
        <p className="mt-2 text-xs leading-relaxed text-[var(--dim)]">
          Signed in as @{data.myUsername}
          {data.myRole ? ` · ${data.myRole}` : " · owner-operator (no fleet)"}. When a load here is claimed, freight
          pay runs direct from the fleet owner or broker to the carrier — RUGGS LLC never holds freight money — and the
          standard RUGGS LLC dispatch fee applies to the claim, invoiced once at sealed delivery.
        </p>
      </section>
    );
  }

  const open = data.board.filter((b) => b.status === "open");
  const mineTaken = data.board.filter((b) => b.status === "taken" && b.claimedBy === data.myUsername);
  const rankedOpen = rankBoardLoads(open, sortKey, estFor);
  const rankById = new Map<number, number>();
  if (sortKey === "perMile") {
    let n = 0;
    for (const r of rankedOpen) {
      if (estFor(r) != null || r.totalPerMile != null) rankById.set(r.id, ++n);
    }
  }

  const renderCard = (r: OpenRow) => {
    const isMine = r.claimedBy === data.myUsername;
    return (
      <article key={r.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface2)] p-3.5" aria-label={`Open Board load ${laneOf(r)} from ${r.originLabel ?? "an origin"}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-condensed text-lg font-bold leading-tight">{laneOf(r)}</div>
            <div className="mt-0.5 text-xs text-[var(--dim)]">
              Posted {new Date(r.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · vetted owner operators only
            </div>
          </div>
          {r.status === "open" && rankById.has(r.id) && (
            <span className="shrink-0 rounded-full bg-[var(--accent)] px-2.5 py-1 text-[11px] font-bold text-black" aria-label={`Ranked number ${rankById.get(r.id)} by rate per mile`}>
              #{rankById.get(r.id)} $/mi
            </span>
          )}
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
              r.status === "open" ? "bg-emerald-900/60 text-emerald-300" : "bg-[var(--surface)] text-[var(--accent)]"
            }`}
          >
            {r.status === "open" ? "OPEN" : isMine ? "YOURS — CLAIMED" : `CLAIMED · @${r.claimedBy ?? ""}`}
          </span>
        </div>
        <p className="mt-2 inline-block rounded-full bg-[var(--surface)] px-2.5 py-1 text-xs font-bold text-[var(--accent)]">
          {originBadge(r)}
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-[var(--dim)]">
          Freight pay runs <strong className="text-[var(--text)]">direct from {r.originLabel ?? "the origin"} to you</strong> —
          RUGGS LLC never holds freight money. The standard RUGGS LLC dispatch fee applies to this claim (invoiced once, at
          sealed delivery, under the settle-to-claim rules).
        </p>
        {r.dispatcherFeePct != null && (
          <p className="mt-1.5 text-xs leading-relaxed text-[var(--dim)]">
            <strong className="text-[var(--text)]">Dispatcher fee: {r.originLabel ?? "the poster"} charges {r.dispatcherFeePct}%</strong> —
            the claiming carrier (you) pays the poster's own dispatcher fee once for this load, on top of the RUGGS LLC
            fee above. It's shown here, before you claim, so the load's full terms are on the card.
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="neon-text font-condensed text-2xl font-bold">{money(r.totalWithExtras)}</span>
          <PerMileLine load={r} estMiles={laneEstimates.get(laneKey(r)) ?? null} />
          {r.rate != null && r.extraCharges > 0 && (
            <span className="text-xs text-[var(--dim)]">
              {money(r.rate)} + {money(r.extraCharges)} extras{r.extraChargesNote ? ` (${r.extraChargesNote})` : ""}
            </span>
          )}
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          {r.shipper && (
            <div><dt className="inline text-[var(--dim)]">Shipper: </dt><dd className="inline font-semibold">{r.shipper}</dd></div>
          )}
          {(r.brokerCompany || r.brokerName) && (
            <div><dt className="inline text-[var(--dim)]">Broker: </dt><dd className="inline font-semibold">{[r.brokerCompany ?? r.brokerName, r.brokerMc].filter(Boolean).join(" · ")}</dd></div>
          )}
          {r.commodity && (
            <div><dt className="inline text-[var(--dim)]">Freight: </dt><dd className="inline font-semibold">{r.commodity}{r.hazmat ? " · HAZMAT" : ""}</dd></div>
          )}
          {r.weightLbs != null && (
            <div><dt className="inline text-[var(--dim)]">Weight: </dt><dd className="inline font-semibold">{r.weightLbs.toLocaleString()} lbs</dd></div>
          )}
          {r.equipmentLabel && (
            <div><dt className="inline text-[var(--dim)]">Equipment: </dt><dd className="inline font-semibold">{r.equipmentLabel}</dd></div>
          )}
          <div><dt className="inline text-[var(--dim)]">Pickup: </dt><dd className="inline font-semibold">{r.pickupText ?? "Window not set"}</dd></div>
          <div><dt className="inline text-[var(--dim)]">Deliver: </dt><dd className="inline font-semibold">{r.deliveryText ?? "Window not set"}</dd></div>
        </dl>
        {r.notes && <p className="mt-1.5 text-sm text-[var(--dim)]">{r.notes}</p>}
        {r.hasDoc && (
          <button
            type="button"
            className="btn-press mt-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-bold"
            aria-label={`View the rate confirmation or BOL for ${laneOf(r)}`}
            onClick={() => setViewDocId(r.id)}
          >
            📄 Rate con / BOL on file{r.docSha256 ? ` · fingerprint ${r.docSha256.slice(0, 10)}…` : ""}
          </button>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {r.status === "open" && (
            <button
              type="button"
              disabled={busy != null}
              aria-label={`Claim load ${laneOf(r)} from ${r.originLabel ?? "the origin"}`}
              onClick={() => {
                if (armKey === `claim-${r.id}`) {
                  setArmKey(null);
                  setBusy(`claim-${r.id}`);
                  void api
                    .claimOpenBoardLoad({ id: r.id })
                    .then((res) => {
                      if (!res.ok) {
                        setBanner(res.error ?? "That claim didn't go through.");
                        return;
                      }
                      setBanner(
                        `Claimed — ${laneOf(r)} from ${r.originLabel ?? "the origin"} is in your Loads now, Load Tracker at Booked. Freight pay comes direct from ${r.originLabel ?? "the origin"}; the RUGGS LLC dispatch fee invoices once when the delivery seals.`,
                      );
                      refresh();
                    })
                    .catch(() => setBanner("That claim didn't go through — check your connection and try again."))
                    .finally(() => setBusy(null));
                } else setArmKey(`claim-${r.id}`);
              }}
              className={`btn-press rounded-xl px-4 py-2.5 text-sm font-bold disabled:opacity-50 ${armKey === `claim-${r.id}` ? "bg-[var(--danger)] text-white" : "btn-neon"}`}
            >
              {busy === `claim-${r.id}` ? "Claiming…" : armKey === `claim-${r.id}` ? `Tap again — claim from ${r.originLabel ?? "origin"}` : "🙋 Claim this load"}
            </button>
          )}
          {r.status === "taken" && isMine && r.loadId != null && (
            <button
              type="button"
              className="btn-neon btn-press rounded-xl px-4 py-2.5 text-sm font-bold"
              aria-label={`Open ${laneOf(r)} in the Load Tracker`}
              onClick={() => onOpenMyLoad(r.loadId!)}
            >
              Open in Load Tracker →
            </button>
          )}
        </div>
        {r.status === "taken" && (
          <p className="mt-2 text-xs text-[var(--dim)]">
            Load Tracker: {r.linkedPodSealed ? "Delivered — POD sealed" : r.linkedLoadStatus ? r.linkedLoadStatus.replace(/_/g, " ") : "booked"}
            {r.claimedAt ? ` · taken ${new Date(r.claimedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}
          </p>
        )}
      </article>
    );
  };

  return (
    <div className="space-y-3">
      <section className="glass-panel p-3.5" aria-label="Open Board header">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-condensed text-2xl font-bold">🌐 Open Board</h2>
          <span className="rounded-full bg-[var(--surface2)] px-2.5 py-1 text-xs font-bold">
            ✓ Vetted owner operator · @{data.myUsername}
            {data.kycStatus === "verified" ? " · ID verified" : ""}
          </span>
        </div>
        <p className="mt-1 text-sm text-[var(--dim)]">
          Loads beyond one fleet — broker loads released by the RUGGS LOGISTICS desk and fleet overflow, each labelled
          with its origin. <strong className="text-[var(--text)]">{open.length} open</strong> · {mineTaken.length} yours.
          Freight pay runs direct from the origin to you; RUGGS LLC never holds it. Claiming starts the load in your Load
          Tracker at Booked; first claim wins.
        </p>
        {data.feeStanding.blocked && (
          <div className={`mt-2.5 rounded-xl px-3.5 py-2.5 text-sm font-semibold leading-relaxed ${data.feeStanding.revoked ? "bg-[var(--danger)] text-white" : "bg-amber-900/60 text-amber-200"}`} role="alert">
            {data.feeStanding.revoked ? "⛔ " : "💰 "}
            {data.feeStanding.message ?? "Dispatch fee outstanding — pay to keep picking loads."}
            <span className="mt-1 block text-xs font-semibold opacity-90">
              The settle-to-claim gate reads your standing across every board lane — pay the fee in full (ACH, debit,
              or crypto) from your dispatch-fee invoice below and the Open Board reopens.
            </span>
          </div>
        )}
      </section>

      <BoardSortControl id="open-board-sort" value={sortKey} onChange={setSortKey} />

      <div className="space-y-3">
        {open.length === 0 && mineTaken.length === 0 && (
          <p className="rounded-2xl border border-[var(--border)] bg-[var(--surface2)] px-3.5 py-3 text-sm text-[var(--dim)]">
            Nothing on the Open Board right now. When a broker's load clears the RUGGS LOGISTICS review queue, or a
            fleet owner pushes a load out because the fleet is full or short on drivers, it lands here — for vetted
            owner operators only.
          </p>
        )}
        {rankedOpen.map(renderCard)}
        {mineTaken.map(renderCard)}
      </div>

      <MyDispatchFeesPanel setBanner={setBanner} />

      {viewDocId != null && (
        <div className="fixed inset-0 z-[960] flex items-center justify-center bg-black/80 p-4" role="dialog" aria-label="Open Board load document">
          <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-[var(--surface)] p-4">
            <div className="flex items-center justify-between">
              <div className="font-condensed text-xl font-bold">Rate con / BOL</div>
              <button
                type="button"
                onClick={() => setViewDocId(null)}
                className="rounded-full bg-[var(--surface2)] px-3.5 py-2 font-bold"
                aria-label="Close document viewer"
              >
                ✕
              </button>
            </div>
            <div className="mt-3">
              {docQuery.isPending && <p className="text-sm text-[var(--dim)]">Loading document…</p>}
              {docQuery.data?.url && docQuery.data.mime === "application/pdf" && (
                <PdfViewer
                  src={docQuery.data.url}
                  ariaLabel="Open Board load document PDF"
                  labels={{
                    loading: "Loading PDF…",
                    loadError: "This PDF couldn't be displayed.",
                    previousPage: "Previous page",
                    nextPage: "Next page",
                  }}
                />
              )}
              {docQuery.data?.url && docQuery.data.mime?.startsWith("image/") && (
                <img src={docQuery.data.url} alt="Uploaded rate confirmation or bill of lading" className="w-full rounded-lg" />
              )}
              {docQuery.data && !docQuery.data.url && (
                <p className="text-sm text-[var(--dim)]">No document is stored for this load.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
