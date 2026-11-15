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

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";
import { geocodeCity } from "./useLaneEstimate";

type FleetBoardData = ApiResponse<typeof api, "getFleetBoard">;
type FleetCard = FleetBoardData["cards"][number];
type SuggestionsData = ApiResponse<typeof api, "getNextLoadSuggestions">;
type Suggestion = SuggestionsData["drivers"][number]["suggestions"][number];

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
    <section id="fleet-board" className="mt-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3 py-3" aria-label="Fleet board">
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
      <NextLoadSuggestions />
    </section>
  );
}

// Suggested next loads (Alvys-grab build): per driver, the fleet's
// open loads ranked by FIT — deadhead, calendar, home time, hours —
// with the reasons printed on the card. The button runs the same
// assign the board runs: dispatch mode, the qualification gate,
// and the home-time gate all still decide. A suggestion never
// binds anything by itself, and a leg the app couldn't check says
// "not checked" out loud instead of pretending.
function SuggestionCard({ username, s }: { username: string; s: Suggestion }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const legs = [s.legs.deadhead, s.legs.availability, s.legs.homeTime, s.legs.hos];
  return (
    <li className="rounded-lg bg-[var(--surface)] px-3 py-2.5 text-sm">
      <div className="font-semibold">{s.lane ?? "Load"}</div>
      <div className="mt-0.5 text-xs leading-relaxed text-[var(--dim)]">
        {[
          s.pickupAt ? `Pickup ${new Date(s.pickupAt).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : null,
          s.deliveryAt ? `Deliver ${new Date(s.deliveryAt).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </div>
      <div className={`mt-1 text-xs font-semibold leading-relaxed ${s.conflict ? "text-amber-300" : "text-[var(--accent)]"}`}>
        {s.reasons.join(" · ")}
      </div>
      <ul className="mt-1 space-y-0.5 text-xs leading-relaxed text-[var(--dim)]">
        {legs.map((leg, i) => (
          <li key={i}>
            {leg.status === "conflict" ? "⛔" : leg.status === "not_checked" ? "❔" : "✓"} {leg.detail}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          className="rounded-lg bg-[var(--ok)] px-3 py-1.5 text-xs font-bold text-black disabled:opacity-50"
          onClick={() => {
            setBusy(true);
            setNote(null);
            void api
              .assignBoardLoad({ id: s.boardLoadId, targetUsername: username })
              .then((r) => {
                if (r.ok) {
                  setNote(r.homeTimeWarning?.summary ?? "Sent through the assign funnel ✓ — the load moved exactly as a board assign does.");
                  void queryClient.invalidateQueries({ queryKey: ["next-load-suggestions"] });
                  void queryClient.invalidateQueries({ queryKey: ["load-board"] });
                  void queryClient.invalidateQueries({ queryKey: ["fleet-board"] });
                } else {
                  setNote(r.error ?? "The assign funnel refused that one.");
                }
              })
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Working…" : "Offer / assign"}
        </button>
        <span className="text-xs text-[var(--dim)]">Runs the same assign as the board — every gate still applies.</span>
      </div>
      {note && <p className="mt-1.5 text-xs leading-relaxed">{note}</p>}
    </li>
  );
}

function NextLoadSuggestions() {
  const boardQuery = useQuery({ queryKey: ["load-board"], queryFn: () => api.getLoadBoard({}) });
  const openRows = (boardQuery.data?.board ?? []).filter((r) => r.status === "open");
  const [points, setPoints] = useState<{ boardLoadId: number; lat: number; lon: number }[] | null>(null);
  const openKey = openRows.map((r) => r.id).join(",");
  useEffect(() => {
    let live = true;
    void (async () => {
      const out: { boardLoadId: number; lat: number; lon: number }[] = [];
      for (const r of openRows) {
        if (!r.pickupCity) continue;
        const p = await geocodeCity(r.pickupCity, r.pickupState ?? null).catch(() => null);
        if (p) out.push({ boardLoadId: r.id, lat: p.lat, lon: p.lon });
      }
      if (live) setPoints(out);
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey]);
  const sugQuery = useQuery({
    queryKey: ["next-load-suggestions", openKey, points?.length ?? -1],
    queryFn: () => api.getNextLoadSuggestions({ pickupPoints: points ?? [] }),
    enabled: points != null,
  });
  const data = sugQuery.data;
  if (!data?.ok) return null;
  const withSuggestions = data.drivers.filter((d) => d.suggestions.length > 0);
  return (
    <div className="mt-3 border-t border-[var(--glass-border)] pt-3">
      <h4 className="font-condensed text-base font-semibold">🧭 Suggested next loads</h4>
      <p className="mt-1 text-xs leading-relaxed text-[var(--dim)]">
        Your open loads, ranked per driver by fit — deadhead from where the truck is (or where its current load
        ends), the calendar, home time, and the sealed hours clock. Anything the app couldn&rsquo;t check says
        &ldquo;not checked&rdquo; — it never guesses a pass.
      </p>
      {withSuggestions.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--dim)]">No open loads on your fleet board to suggest right now.</p>
      ) : (
        withSuggestions.map((d) => (
          <div key={d.username} className="mt-2.5">
            <div className="text-sm font-semibold">
              {d.displayName ?? `@${d.username}`} <span className="text-xs text-[var(--dim)]">@{d.username}</span>
            </div>
            <ul className="mt-1.5 space-y-1.5">
              {d.suggestions.map((s) => (
                <SuggestionCard key={s.boardLoadId} username={d.username} s={s} />
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}
