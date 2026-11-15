// FuelPlanPanel.tsx — the route fuel plan (Wave 2 item 8).
//
// Sits inside the Diamond Net-Price Fuel Planner section in
// App.tsx: the planner ranks stops; this plans the whole route.
// The corridor (stops, matched price estimates, state pins) comes
// from App's fuel session — the same evidence the planner ranks —
// and the server runs the ex-tax math (fuelOptimizer.ts): gallons
// per stop, the trip's true cost with the IFTA settlement figured
// over the route's burn, and the naive pump-price plan beside it.
//
// Honesty rules, same as everywhere fuel shows: every price is an
// ESTIMATE from the driver's own log or labelled driver reports
// (source printed on every line), the savings figure is labelled
// an estimate, the tax table's as-of date is stamped, and a stop
// with no price on file is never ranked or costed — the plan says
// so instead of inventing a number.

import { useState } from "react";
import { api, type ApiResponse } from "./api";
import { money } from "./NextLevel";

export interface RouteFuelPlanStopInput {
  id: string;
  name: string;
  state: string | null;
  alongMi: number;
  price: number | null;
  priceSource: string | null;
}

type PlanData = ApiResponse<typeof api, "planFuelStops">;
type PlanResult = NonNullable<PlanData["result"]>;

const BTN = "btn-gold !px-3 !py-1.5 text-xs disabled:opacity-50";

export function RouteFuelPlanPanel({
  stops,
  totalMiles,
  mpg,
  tankCapacityGal,
}: {
  stops: RouteFuelPlanStopInput[];
  totalMiles: number;
  mpg: number;
  tankCapacityGal: number;
}) {
  const [startGallons, setStartGallons] = useState<number>(tankCapacityGal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PlanResult | null>(null);

  if (totalMiles <= 0 || stops.length === 0) {
    return (
      <p className="mt-3 text-sm text-[var(--dim)]">
        Set a route with fuel stops on it and this plans the whole run&apos;s fuel — how much to take at each stop on the
        ex-tax math, not just which stop is cheapest.
      </p>
    );
  }

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.planFuelStops({
        totalMiles,
        segments: [],
        stops: stops.map((s) => ({
          id: s.id,
          name: s.name,
          state: s.state,
          alongMi: s.alongMi,
          price: s.price,
          priceSource: s.priceSource,
        })),
        mpg,
        tankCapacityGal,
        startGallons: Math.min(Math.max(startGallons, 0), tankCapacityGal),
        reserveGallons: 15,
      });
      if (res.locked || !res.result) {
        setError("The route fuel plan is part of Diamond's full fuel assistance.");
        setResult(null);
      } else {
        setResult(res.result);
      }
    } catch {
      setError("The plan didn't run — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl bg-[var(--surface2)] px-3 py-3">
      <h3 className="font-condensed text-lg font-semibold">🛢️ Route fuel plan — buy on base price, not pump price</h3>
      <p className="mt-1 text-sm text-[var(--dim)]">
        IFTA tax is owed on the fuel you <strong className="text-[var(--text)]">burn</strong> in each state and credited for
        the fuel you <strong className="text-[var(--text)]">buy</strong> there — so the real price of a gallon is the pump
        price minus that state&apos;s tax. This plans the whole route on that math: how much to take at each stop, what the
        trip truly costs after the IFTA settlement, and what that saves against just chasing the cheapest pump price.
        Every price below is an estimate from your fuel log and driver reports — source shown, never a live feed.
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-xs font-semibold text-[var(--dim)]">
          Fuel on board now (gal)
          <input
            type="number"
            min={0}
            max={tankCapacityGal}
            step={1}
            value={startGallons}
            onChange={(e) => setStartGallons(parseFloat(e.target.value || "0") || 0)}
            className="mt-1 block w-28 rounded-lg bg-[var(--surface)] px-2 py-1.5 text-sm text-[var(--text)]"
            aria-label="Gallons of fuel on board at the start of the route"
          />
        </label>
        <button type="button" className={BTN} disabled={busy} onClick={() => void run()}>
          {busy ? "Planning…" : "Plan this route's fuel"}
        </button>
        <span className="text-xs text-[var(--dim)]">
          Tank ≈ {tankCapacityGal} gal · {mpg} mpg · 15 gal reserve kept, always
        </span>
      </div>
      {error && (
        <p className="mt-2 text-sm text-red-300" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className="mt-3">
          {result.purchases.length > 0 ? (
            <ul className="space-y-1.5">
              {result.purchases.map((p) => (
                <li key={p.stopId} className="rounded-xl bg-[var(--surface)] px-3 py-2 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold">{p.name}</span>
                    <span className="font-condensed text-lg font-bold text-[var(--ok)]">
                      Take {p.gallons} gal{p.cost != null ? ` · ${money(p.cost)}` : ""}
                    </span>
                  </div>
                  <div className="text-xs text-[var(--dim)]">
                    {p.price != null ? (
                      <>
                        Pump {money(p.price)}/gal
                        {p.basePrice != null && p.taxPerGal != null
                          ? ` − ${p.state ?? ""} tax $${p.taxPerGal.toFixed(3)} = base ${money(p.basePrice)}/gal`
                          : " · this state's tax isn't loaded, so no base price is figured"}
                        {p.priceSource ? ` · ${p.priceSource}` : ""}
                      </>
                    ) : (
                      "No price on file for this stop — gallons shown, cost never guessed"
                    )}
                  </div>
                  <div className="mt-0.5 text-xs">{p.why}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--dim)]">No stops to buy at in this plan — see the notes below.</p>
          )}

          <div className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            <div className="rounded-xl bg-[var(--surface)] px-2 py-2.5">
              <div className="font-condensed text-xl font-bold">{money(result.totals.pumpCost)}</div>
              <div className="text-[11px] text-[var(--dim)]">at the pump (priced stops)</div>
            </div>
            <div className="rounded-xl bg-[var(--surface)] px-2 py-2.5">
              <div className="font-condensed text-xl font-bold">
                {result.totals.iftaSettlement != null
                  ? `${result.totals.iftaSettlement >= 0 ? "+" : "−"}${money(Math.abs(result.totals.iftaSettlement))}`
                  : "—"}
              </div>
              <div className="text-[11px] text-[var(--dim)]">IFTA settlement after the trip</div>
            </div>
            <div className="rounded-xl bg-[var(--surface)] px-2 py-2.5">
              <div className="font-condensed text-xl font-bold">
                {result.totals.netTripCost != null ? money(result.totals.netTripCost) : "—"}
              </div>
              <div className="text-[11px] text-[var(--dim)]">true trip fuel cost (estimate)</div>
            </div>
            <div className="rounded-xl bg-[var(--surface)] px-2 py-2.5">
              <div className="font-condensed text-xl font-bold">
                {result.naive.totals.netTripCost != null ? money(result.naive.totals.netTripCost) : "—"}
              </div>
              <div className="text-[11px] text-[var(--dim)]">cheapest-pump-price plan (estimate)</div>
            </div>
          </div>
          {result.savingsEstimate != null && (
            <p className="mt-2 rounded-xl bg-[var(--surface)] px-3 py-2.5 text-sm">
              <strong>Estimated saving from the ex-tax plan: {money(result.savingsEstimate)}</strong>{" "}
              <span className="text-[var(--dim)]">
                — an estimate, figured from the same price estimates above; it moves when the prices do.
              </span>
            </p>
          )}
          {result.verdicts.filter((v) => v.buyGallons <= 0).length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-[var(--dim)]">
              {result.verdicts
                .filter((v) => v.buyGallons <= 0)
                .map((v) => {
                  const stop = stops.find((s) => s.id === v.stopId);
                  return (
                    <li key={v.stopId}>
                      {stop?.name ?? "Stop"}: {v.why}
                    </li>
                  );
                })}
            </ul>
          )}
          <ul className="mt-2 space-y-1 text-xs leading-relaxed text-[var(--dim)]">
            {result.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[var(--dim)]">
            Tax rates: {result.ratesLabel} ({result.ratesAsOf}).
          </p>
        </div>
      )}
    </div>
  );
}
