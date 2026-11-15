// STONEMILES Fleet Board — the per-fleet LIVE board (TMS queue
// item 4, x 2026-11-14): a fleet's owner + dispatch seats see their
// own drivers' trucks — current load + status, the route with its
// stops in order, the truck's last location WITH its freshness,
// and where the route ends and when. Scoped per fleet on the
// server (getFleetBoard): another fleet's drivers never appear,
// a driver seat gets nothing, and platform staff get no fleet
// truck locations through this tool.
//
// The data rides the share-up pipe: each driver's app publishes a
// fleet-status snapshot of the load they're running; positions come
// from the standing location-privacy rule. NO money field exists
// anywhere in this payload — the board never shows a load's price.
//
// Mounted by the Owner Desk and the Dispatch Desk; the server gate
// decides who actually sees cards.

import { useQuery } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";

type FleetBoardData = ApiResponse<typeof api, "getFleetBoard">;
type FleetCard = FleetBoardData["cards"][number];

function etaLabel(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function TruckCard({ card }: { card: FleetCard }) {
  const eta = etaLabel(card.etaAt);
  return (
    <li className="rounded-lg bg-[var(--surface)] px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">
          {card.displayName ?? `@${card.username}`} <span className="text-xs text-[var(--dim)]">@{card.username}</span>
        </span>
        {card.loadStatusLabel && (
          <span className="rounded-full bg-[var(--surface2)] px-2.5 py-0.5 text-xs font-bold text-[var(--accent)]">
            {card.loadStatusLabel}
          </span>
        )}
      </div>
      <div className="mt-0.5 text-xs leading-relaxed text-[var(--dim)]">
        {[card.truckLine, card.isMe ? "That's you" : null].filter(Boolean).join(" · ")}
      </div>
      {card.hasActiveLoad ? (
        <>
          <div className="mt-1.5 font-semibold">{card.lane}</div>
          {card.stops.length > 0 && (
            <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-xs leading-relaxed text-[var(--dim)]">
              {card.stops.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          )}
          <div className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
            {[
              card.routeEndLabel ? `Route ends: ${card.routeEndLabel}` : null,
              eta ? `ETA ${eta}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </>
      ) : (
        <div className="mt-1.5 text-xs leading-relaxed text-[var(--dim)]">No active load published.</div>
      )}
      <div className="mt-1 text-xs leading-relaxed">
        {card.positionVisible ? (
          <span>
            📍 {card.positionLabel}
            {card.positionFreshness ? ` · ${card.positionFreshness}` : ""}
          </span>
        ) : (
          <span className="text-[var(--dim)]">📍 {card.positionLabel}</span>
        )}
      </div>
    </li>
  );
}

export function FleetBoardPanel() {
  const boardQuery = useQuery({
    queryKey: ["fleet-board"],
    queryFn: () => api.getFleetBoard({}),
    refetchInterval: 60000,
  });
  const board = boardQuery.data;
  if (boardQuery.isPending) {
    return (
      <section className="mt-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3" aria-label="Fleet board">
        <h3 className="font-condensed text-lg font-semibold">🚚 Fleet board — live trucks</h3>
        <p className="mt-1 text-sm text-[var(--dim)]">Reading your fleet…</p>
      </section>
    );
  }
  if (!board?.canView) return null;
  return (
    <section className="mt-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3" aria-label="Fleet board">
      <h3 className="font-condensed text-lg font-semibold">🚚 Fleet board — live trucks</h3>
      <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
        Only {board.companyName}&rsquo;s owner and dispatch seats see this — never another fleet, never the
        public board. Locations always print with their freshness: a stale dot never poses as live.
      </p>
      {board.cards.length === 0 ? (
        <p className="mt-2 text-sm leading-relaxed">
          No drivers on the roster yet. When your drivers run loads, their trucks land here — load, route,
          stops, and where they&rsquo;ll end up.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {board.cards.map((card) => (
            <TruckCard key={card.username} card={card} />
          ))}
        </ul>
      )}
    </section>
  );
}
