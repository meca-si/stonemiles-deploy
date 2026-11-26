// AfterFuelLine — the board card's decision-time line (x's order,
// 2026-11-25): what is left of MY cut after the fuel the run burns,
// figured from where I sit now (deadhead to the pickup), the loaded
// miles, my own profile MPG (weight-adjusted), and a labelled fuel
// price. The math is afterFuelEstimate in loadFlow.ts; this file is
// only the wiring and the words.
//
// Honesty, matching the house rules in loadRate.ts / loadFlow.ts:
// - The figure is ALWAYS an estimate and wears "≈" + "est." — the
//   miles may be a lane estimate, the deadhead is straight-line ×
//   the stated road factor, and the price is the driver's own last
//   purchase price or the EIA weekly average, labelled as which.
//   It is never dressed as a live pump price.
// - No position → the deadhead is simply not in the math and the
//   line says "deadhead not figured (no location)" — it never
//   pretends the run to the pickup is free.
// - Any missing real input (pay model unset, no miles, no MPG, no
//   price) → the line renders nothing, like the $/mi line.

import { useEffect, useState } from "react";
import { afterFuelEstimate, afterFuelVerdict, loadPayFigures } from "./loadFlow";
import { haversineMi, ROAD_CIRCUITY, type LatLon } from "./loadRate";
import { geocodeCity } from "./useLaneEstimate";

export type PayModel = {
  payBasis: "cpm" | "percent";
  driverPayPct: number | null;
  driverCpm: number | null;
  baseMpg: number | null;
};

/** A fuel price with its honest label: where the number came from. */
export type FuelPrice = {
  perGal: number;
  /** "your last price" | "EIA weekly avg" — printed on the line. */
  label: string;
};

function dollars(n: number): string {
  const v = Math.round(n);
  return v < 0 ? `-$${Math.abs(v).toLocaleString("en-US")}` : `$${v.toLocaleString("en-US")}`;
}

export function AfterFuelLine({
  totalWithExtras,
  rate,
  extraCharges,
  loadedMiles,
  estMiles,
  weightLbs,
  pickupCity,
  pickupState,
  payModel,
  price,
  myPos,
}: {
  totalWithExtras: number | null;
  rate: number | null;
  extraCharges: number;
  loadedMiles: number | null;
  estMiles: number | null;
  weightLbs: number | null;
  pickupCity: string | null;
  pickupState: string | null;
  payModel: PayModel;
  price: FuelPrice | null;
  myPos: LatLon | null;
}) {
  const [deadheadMi, setDeadheadMi] = useState<number | null>(null);

  // Deadhead: my position → the pickup city, straight-line stretched
  // by the same road factor the lane estimates state. Geocoding is
  // cached per city (useLaneEstimate), so a board of cards costs a
  // lookup per city, not per card.
  useEffect(() => {
    if (!myPos || !pickupCity) {
      setDeadheadMi(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const point = await geocodeCity(pickupCity, pickupState);
      if (cancelled || !point) return;
      setDeadheadMi(Math.max(0, Math.round(haversineMi(myPos, point) * ROAD_CIRCUITY)));
    })();
    return () => {
      cancelled = true;
    };
  }, [myPos, pickupCity, pickupState]);

  const miles = loadedMiles ?? estMiles;
  const gross = totalWithExtras ?? (rate != null ? rate + (extraCharges ?? 0) : null);
  const cut = loadPayFigures({
    payBasis: payModel.payBasis,
    driverCpm: payModel.driverCpm,
    driverPayPct: payModel.driverPayPct,
    gross,
    miles,
  }).cut;
  const est = afterFuelEstimate({
    cut,
    loadedMiles: miles,
    deadheadMi,
    baseMpg: payModel.baseMpg,
    weightLbs,
    pricePerGal: price?.perGal ?? null,
  });
  if (!est || !price) return null;

  const verdict = afterFuelVerdict(est);
  const verdictWord =
    verdict === "green" ? "🟢 Worth taking" : verdict === "yellow" ? "🟡 Thin — your call" : "🔴 Not worth it";
  const verdictScope =
    verdict === "green"
      ? "clears fuel with room to spare"
      : verdict === "yellow"
        ? "clears fuel, barely — deadhead and detention decide it"
        : "doesn't clear the fuel it burns";
  const milesNote =
    est.deadheadMi != null
      ? `${est.totalMi.toLocaleString()} mi (${est.deadheadMi.toLocaleString()} deadhead + ${est.loadedMi.toLocaleString()} loaded)`
      : `${est.loadedMi.toLocaleString()} loaded mi · deadhead not figured (no location)`;
  return (
    <p
      className="mt-1 text-sm"
      aria-label={`Verdict: ${verdictWord} — ${verdictScope}. After fuel, about ${dollars(est.afterFuel)} left of your ${dollars(est.cut)} cut, ${est.afterFuelPerMi.toFixed(2)} dollars per mile profit. Fuel about ${dollars(est.fuelCost)} for ${milesNote}, at $${price.perGal.toFixed(2)} per gallon, ${price.label}. Estimate. The full Worth-It Advisor scores against your whole break-even.`}
    >
      <span
        className={`font-bold ${verdict === "green" ? "text-emerald-300" : verdict === "yellow" ? "text-amber-300" : "text-[var(--danger)]"}`}
      >
        {verdictWord}
      </span>{" "}
      <span className={`font-bold ${est.afterFuel < 0 ? "text-[var(--danger)]" : "text-emerald-300"}`}>
        · ⛽ After fuel ≈ {dollars(est.afterFuel)} · ${est.afterFuelPerMi.toFixed(2)}/mi profit
      </span>{" "}
      <span className="font-semibold text-[var(--dim)]">
        · fuel ~{dollars(est.fuelCost)} · {milesNote} · at ${price.perGal.toFixed(2)}/gal ({price.label}) · est.
      </span>
    </p>
  );
}
