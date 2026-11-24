// FuelCostCalculator.tsx — the Fuel Cost Calculator (2026-11-24,
// x's ask: "a tab like this" — the classic distance × MPG × price
// calculator, but starting from the driver's OWN numbers instead of
// blanks).
//
// Mounted in the Fuel workspace (IftaPanel, under the fuel log and
// fuel-card checks). Prefills, each labelled with its source:
//   - MPG from the truck profile (Settings → Truck),
//   - price from the average of the driver's logged fuel purchases,
//     else their Settings diesel price,
//   - miles from a picked load (loaded + deadhead, the burn counts
//     both — and when the load has pay on file, the answer adds the
//     fuel share of the pay and the net after fuel).
// Every field stays editable; the answer recomputes as you type.
// It's an estimate from the numbers entered — the fuel log stays
// the record, and this panel never writes anything anywhere.

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { avgLoggedFuelPrice } from "./moneyMath";
import { fuelCostFor } from "./fuelCalculator";

const inputCls = "w-full min-w-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[var(--text)]";
const labelCls = "block text-xs font-bold uppercase tracking-wide text-[var(--dim)] mb-1";

function laneOf(l: { pickupCity: string | null; pickupState: string | null; deliveryCity: string | null; deliveryState: string | null }): string {
  const from = [l.pickupCity, l.pickupState].filter(Boolean).join(", ");
  const to = [l.deliveryCity, l.deliveryState].filter(Boolean).join(", ");
  return from && to ? `${from} → ${to}` : from || to || "lane not recorded";
}

const money = (n: number): string => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function FuelCostCalculator() {
  const profileQ = useQuery({ queryKey: ["profile"], queryFn: () => api.getProfile({}) });
  const loadsQ = useQuery({ queryKey: ["loads"], queryFn: () => api.listLoads({ limit: 50 }) });
  const fuelQ = useQuery({ queryKey: ["fuel-purchases"], queryFn: () => api.listFuelPurchases({ limit: 200 }) });

  const [loadId, setLoadId] = useState("");
  const [distance, setDistance] = useState("");
  const [deadhead, setDeadhead] = useState("");
  const [mpg, setMpg] = useState("");
  const [price, setPrice] = useState("");
  const [priceSource, setPriceSource] = useState<string | null>(null);
  const [mpgDone, setMpgDone] = useState(false);
  const [priceDone, setPriceDone] = useState(false);

  // One-time prefills from the driver's own numbers — each runs when
  // its source lands and never overwrites a field already touched.
  useEffect(() => {
    if (mpgDone || !profileQ.data) return;
    const p = profileQ.data.profile;
    if (p?.mpg) setMpg(String(p.mpg));
    setMpgDone(true);
  }, [mpgDone, profileQ.data]);

  useEffect(() => {
    if (priceDone || !profileQ.data || fuelQ.isLoading) return;
    const avg = avgLoggedFuelPrice(fuelQ.data?.purchases ?? []);
    if (avg != null) {
      setPrice(avg.toFixed(2));
      setPriceSource("average of your logged fuel prices");
    } else if (profileQ.data.profile?.dieselPrice) {
      setPrice(String(profileQ.data.profile.dieselPrice));
      setPriceSource("your Settings diesel price");
    }
    setPriceDone(true);
  }, [priceDone, profileQ.data, fuelQ.data, fuelQ.isLoading]);

  const loads = useMemo(
    () => (loadsQ.data?.loads ?? []).filter((l) => l.loadedMiles != null),
    [loadsQ.data],
  );
  const selectedLoad = loads.find((l) => String(l.id) === loadId) ?? null;
  const loadPay =
    selectedLoad?.rate != null
      ? Math.round((selectedLoad.rate + selectedLoad.extraCharges + selectedLoad.claimsTotal) * 100) / 100
      : null;

  const pickLoad = (id: string) => {
    setLoadId(id);
    const l = loads.find((x) => String(x.id) === id);
    if (l) {
      setDistance(String(l.loadedMiles ?? ""));
      setDeadhead(String(l.deadheadMiles ?? 0));
    }
  };

  const result = useMemo(
    () =>
      fuelCostFor({
        distanceMi: parseFloat(distance) || 0,
        deadheadMi: parseFloat(deadhead) || 0,
        mpg: parseFloat(mpg) || 0,
        pricePerGal: parseFloat(price) || 0,
        loadPay,
      }),
    [distance, deadhead, mpg, price, loadPay],
  );

  return (
    <div className="mt-4 rounded-xl bg-[var(--surface2)] px-3 py-3">
      <h3 className="font-condensed text-lg font-semibold">🧮 Fuel cost calculator</h3>
      <p className="mt-1 text-sm text-[var(--dim)]">
        How much fuel a trip or load takes, and what it costs — figured from your numbers as you type. Pick a load
        and its miles (and pay, when it&apos;s on file) fill in; or just type any distance. An estimate for
        planning — your fuel log stays the record.
      </p>

      {loads.length > 0 && (
        <div className="mt-3">
          <label className={labelCls} htmlFor="fcc-load">Figure it for a load (optional)</label>
          <select id="fcc-load" className={inputCls} value={loadId} aria-label="Pick a load to prefill the calculator" onChange={(e) => pickLoad(e.target.value)}>
            <option value="">Type the miles myself</option>
            {loads.map((l) => (
              <option key={l.id} value={String(l.id)}>
                Load #{l.id} · {laneOf(l)} · {l.loadedMiles} mi{l.deadheadMiles ? ` + ${l.deadheadMiles} deadhead` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls} htmlFor="fcc-distance">Trip distance (mi)</label>
          <input id="fcc-distance" type="number" inputMode="decimal" min="0" className={inputCls} value={distance} aria-label="Trip distance in miles" onChange={(e) => setDistance(e.target.value)} />
        </div>
        <div>
          <label className={labelCls} htmlFor="fcc-deadhead">Deadhead (mi)</label>
          <input id="fcc-deadhead" type="number" inputMode="decimal" min="0" className={inputCls} value={deadhead} aria-label="Deadhead miles" onChange={(e) => setDeadhead(e.target.value)} />
        </div>
        <div>
          <label className={labelCls} htmlFor="fcc-mpg">Fuel efficiency (MPG)</label>
          <input id="fcc-mpg" type="number" inputMode="decimal" min="0" step="0.1" className={inputCls} value={mpg} aria-label="Fuel efficiency in miles per gallon" onChange={(e) => setMpg(e.target.value)} />
        </div>
        <div>
          <label className={labelCls} htmlFor="fcc-price">Fuel price ($/gal)</label>
          <input id="fcc-price" type="number" inputMode="decimal" min="0" step="0.01" className={inputCls} value={price} aria-label="Fuel price per gallon" onChange={(e) => { setPrice(e.target.value); setPriceSource(null); }} />
          {priceSource && <p className="mt-1 text-[11px] text-[var(--dim)]">Prefilled: {priceSource} — edit it to run your own number.</p>}
        </div>
      </div>

      {result ? (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-[var(--surface)] px-2 py-2.5">
              <div className="font-condensed text-xl font-bold">{result.gallons.toFixed(1)}</div>
              <div className="text-[11px] text-[var(--dim)]">gallons needed</div>
            </div>
            <div className="rounded-xl bg-[var(--surface)] px-2 py-2.5">
              <div className="font-condensed text-xl font-bold">{money(result.totalCost)}</div>
              <div className="text-[11px] text-[var(--dim)]">fuel cost</div>
            </div>
            <div className="rounded-xl bg-[var(--surface)] px-2 py-2.5">
              <div className="font-condensed text-xl font-bold">${result.costPerMile.toFixed(2)}</div>
              <div className="text-[11px] text-[var(--dim)]">per mile</div>
            </div>
          </div>
          <p className="mt-2 text-xs text-[var(--dim)]">
            {result.totalMiles.toLocaleString()} total miles ({distance || 0} + {deadhead || 0} deadhead) at {mpg} MPG
            and ${price}/gal.
          </p>
          {result.fuelSharePct != null && result.netAfterFuel != null && loadPay != null && (
            <p className="mt-1.5 text-sm">
              On this load&apos;s {money(loadPay)} pay: fuel takes <strong>{result.fuelSharePct}%</strong> —{" "}
              <strong>{money(result.netAfterFuel)}</strong> left after fuel.
            </p>
          )}
        </>
      ) : (
        <p className="mt-3 text-sm text-[var(--dim)]">Enter a distance, your MPG, and a fuel price — the gallons and the cost figure themselves right here.</p>
      )}
    </div>
  );
}
