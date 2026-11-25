// LoadFlowPanel.tsx — the load-flow info screen (2026-11-24, x's
// order). Saving a load lands HERE, not back in the long Loads
// workspace: the load's parties and appointments, what it pays the
// driver under the driver's OWN pay model, fuel suggestions from
// the tank's current level, and the route-with-fuel chain — each
// step one tap, no scrolling a workspace to find the next thing.
//
// The chain it drives (all existing machinery, chained not rebuilt):
// Route it → routeLoad (geocode + Valhalla + the auto fuel-stop
// machinery) → the selected route's fuel decisions from
// buildStopPlan → Start guidance (startGuidanceNow).
//
// Honesty rules: pay comes from loadFlow.loadPayFigures — percent
// of the load's gross when that's the driver's model, the driver's
// own CPM when it isn't, and NO $0.55 stand-in ever: an unset model
// is asked for right here in the flow. Fuel advice comes from
// loadFlow.fuelAdviceForLoad over the tank level the app actually
// knows (an ELD reading when one exists, else the driver's last
// entry, shared with the Stop Planner); when the app doesn't know
// the level, it asks — and remembers the answer.

import { useEffect, useState } from "react";
import { api, type ApiResponse } from "./api";
import { money } from "./NextLevel";
import { fuelAdviceForLoad, type LoadPayFigures } from "./loadFlow";

export type FlowLoad = ApiResponse<typeof api, "listLoads">["loads"][number];

export interface FlowRouteStop {
  name: string;
  alongMi: number;
  action: string;
  buyGal: number;
}

export interface FlowRouteInfo {
  miles: number;
  minutes: number;
  stops: FlowRouteStop[];
}

interface Props {
  load: FlowLoad;
  label: string;
  pay: LoadPayFigures;
  /** Miles the fuel + derived figures run on (printed / estimated /
   *  routed), with where they came from. Null = not known yet. */
  miles: number | null;
  milesNote: string | null;
  capacityGal: number;
  baseMpg: number;
  /** The tank level the app knows, with its source label. Null =
   *  unknown — the panel asks. */
  tank: { pct: number; label: string } | null;
  /** The selected route for THIS load once routed, with its fuel
   *  decisions. Null = not routed yet. */
  route: FlowRouteInfo | null;
  onClose: () => void;
  onEdit: () => void;
  onRouteLoad: () => void;
  onStartGuidance: () => void;
  onSavePayModel: (patch: { payBasis: "cpm" | "percent"; driverPayPct: number | null; driverCpm: number | null }) => void;
  onSaveTankPct: (pct: number) => void;
}

const fmtMi = (n: number) => `${Math.round(n).toLocaleString()} mi`;
const fmtDur = (min: number) => {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const inputCls = "w-full rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-3 py-2.5 text-base font-semibold text-[var(--text)]";
const primaryBtn = "btn-press min-h-[52px] w-full rounded-2xl bg-[var(--accent)] px-4 font-condensed text-lg font-bold text-black";
const ghostBtn = "btn-press min-h-[44px] rounded-xl bg-[var(--surface2)] border border-[var(--border)] px-3.5 text-sm font-bold";

export function LoadFlowPanel(props: Props) {
  const { load: l, pay } = props;
  const [payBasisDraft, setPayBasisDraft] = useState<"cpm" | "percent">(pay.basis);
  const [payValueDraft, setPayValueDraft] = useState("");
  const [tankPctDraft, setTankPctDraft] = useState("");
  const [tankGalDraft, setTankGalDraft] = useState("");
  const [editTank, setEditTank] = useState(false);

  useEffect(() => {
    setPayBasisDraft(pay.basis);
  }, [pay.basis]);

  const advice =
    props.tank != null && props.miles != null
      ? fuelAdviceForLoad({
          tankPct: props.tank.pct,
          capacityGal: props.capacityGal,
          baseMpg: props.baseMpg,
          loadWeightLbs: l.weightLbs ?? null,
          miles: props.miles,
        })
      : null;

  const savePay = () => {
    const v = parseFloat(payValueDraft.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(v) || v <= 0) return;
    if (payBasisDraft === "percent") {
      if (v > 100) return;
      props.onSavePayModel({ payBasis: "percent", driverPayPct: v, driverCpm: null });
    } else {
      props.onSavePayModel({ payBasis: "cpm", driverPayPct: null, driverCpm: v });
    }
    setPayValueDraft("");
  };

  const saveTank = () => {
    const pct = parseFloat(tankPctDraft);
    if (Number.isFinite(pct) && pct >= 0 && pct <= 100) {
      props.onSaveTankPct(pct);
      setEditTank(false);
      return;
    }
    const gal = parseFloat(tankGalDraft);
    if (Number.isFinite(gal) && gal >= 0 && props.capacityGal > 0) {
      props.onSaveTankPct(Math.min(100, (gal / props.capacityGal) * 100));
      setEditTank(false);
    }
  };

  const party = (label: string, name: string | null, lines: (string | null | undefined)[]) => {
    const shown = lines.filter(Boolean) as string[];
    if (!name && shown.length === 0) return null;
    return (
      <div className="rounded-xl bg-[var(--surface2)] px-3 py-2.5">
        <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--dim)]">{label}</div>
        {name && <div className="font-condensed text-lg font-bold leading-tight">{name}</div>}
        {shown.map((s) => (
          <div key={s} className="text-sm text-[var(--dim)]">{s}</div>
        ))}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[920] flex items-end bg-black/70" role="dialog" aria-label={`${props.label} — load info, pay, fuel, and routing`}>
      <div className="animate-sheet max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-[var(--surface)] p-5 pb-safe">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-condensed text-2xl font-bold leading-tight">{props.label}</h2>
            <p className="mt-0.5 text-sm text-[var(--dim)]">
              {l.pickupCity ?? "?"}{l.pickupState ? `, ${l.pickupState}` : ""} → {l.deliveryCity ?? "?"}{l.deliveryState ? `, ${l.deliveryState}` : ""}
              {l.status ? <> · <span className="font-semibold text-[var(--text)]">{l.status.replace(/_/g, " ")}</span></> : null}
            </p>
          </div>
          <button type="button" className="btn-press shrink-0 rounded-full bg-[var(--surface2)] px-4 py-2 font-bold" aria-label="Close load info" onClick={props.onClose}>
            ✕ Close
          </button>
        </div>

        {/* Parties + appointments */}
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {party("Shipper — pickup", l.shipper, [l.pickupAddress, [l.pickupCity, l.pickupState].filter(Boolean).join(", ") || null, l.pickupText ? `Pickup: ${l.pickupText}` : null])}
          {party("Consignee — delivery", l.consignee, [l.deliveryAddress, [l.deliveryCity, l.deliveryState].filter(Boolean).join(", ") || null, l.deliveryText ? `Delivery: ${l.deliveryText}` : null])}
          {party("Broker", l.brokerCompany, [l.brokerName, l.brokerMc ? `MC ${l.brokerMc}` : null])}
          {party("Carrier", l.carrier, [])}
        </div>
        {l.notes && (
          <p className="mt-2 rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-sm leading-relaxed">
            <span className="font-bold">Notes: </span>{l.notes}
          </p>
        )}

        {/* Pay — the driver's own model, figured plainly */}
        <section aria-label="Your pay on this load" className="mt-4 rounded-2xl border border-[var(--border)] p-3.5">
          <h3 className="font-condensed text-lg font-bold">💰 Your pay</h3>
          {pay.gross != null ? (
            <p className="mt-1 text-sm text-[var(--dim)]">Load gross: <span className="font-bold text-[var(--text)]">{money(pay.gross)}</span>{l.extraCharges > 0 ? <> (rate {money(l.rate ?? 0)} + charges {money(l.extraCharges)})</> : null}</p>
          ) : (
            <p className="mt-1 text-sm text-[var(--dim)]">No rate on this load yet — add it in Edit load and your cut figures itself.</p>
          )}
          {pay.cut != null && (
            <p className="mt-1.5 font-condensed text-2xl font-bold text-[var(--ok)]">
              Your cut: {money(pay.cut)}
              <span className="ml-2 align-middle text-sm font-semibold text-[var(--dim)]">
                {pay.basis === "percent" ? `${pay.pct}% of the gross` : `at $${pay.cpm?.toFixed(2)}/mi`}
              </span>
            </p>
          )}
          {pay.cut != null && pay.cutPerMile != null && props.miles != null && (
            <p className="text-xs text-[var(--dim)]">That works out to {money(pay.cutPerMile)}/mi over {fmtMi(props.miles)} — figured from your cut, never the other way around.</p>
          )}
          {pay.cut == null && pay.gross != null && !pay.needsSetup && pay.basis === "cpm" && (
            <p className="mt-1 text-sm text-[var(--dim)]">Route the load (below) or add its miles and your cut figures itself at your ${pay.cpm?.toFixed(2)}/mi.</p>
          )}
          {pay.needsSetup && (
            <div className="mt-2">
              <p className="text-sm leading-relaxed">
                Your pay isn't set up yet, so nothing here is figured at a made-up rate. How does your carrier pay you?
              </p>
              <div className="mt-2 flex gap-2" role="group" aria-label="How your carrier pays you">
                <button type="button" aria-pressed={payBasisDraft === "percent"} onClick={() => setPayBasisDraft("percent")} className={`btn-press min-h-[44px] flex-1 rounded-xl px-3 text-sm font-bold ${payBasisDraft === "percent" ? "bg-[var(--accent)] text-black" : "bg-[var(--surface2)] border border-[var(--border)]"}`}>
                  % of the load gross
                </button>
                <button type="button" aria-pressed={payBasisDraft === "cpm"} onClick={() => setPayBasisDraft("cpm")} className={`btn-press min-h-[44px] flex-1 rounded-xl px-3 text-sm font-bold ${payBasisDraft === "cpm" ? "bg-[var(--accent)] text-black" : "bg-[var(--surface2)] border border-[var(--border)]"}`}>
                  $ per mile
                </button>
              </div>
              <div className="mt-2 flex gap-2">
                <input
                  className={inputCls}
                  inputMode="decimal"
                  value={payValueDraft}
                  onChange={(e) => setPayValueDraft(e.target.value)}
                  placeholder={payBasisDraft === "percent" ? "e.g. 80 — your % of the gross" : "e.g. 0.72 — your $ per mile"}
                  aria-label={payBasisDraft === "percent" ? "Your percent of the load gross" : "Your pay per mile in dollars"}
                />
                <button type="button" className="btn-press min-h-[44px] shrink-0 rounded-xl bg-[var(--accent)] px-4 font-bold text-black" onClick={savePay}>
                  Save my pay
                </button>
              </div>
              <p className="mt-1.5 text-xs text-[var(--dim)]">Saved to your pay setting (Settings → My pay) — every load, route, and settlement figures from it.</p>
            </div>
          )}
        </section>

        {/* Fuel — suggestions from the tank's current level */}
        <section aria-label="Fuel for this load" className="mt-3 rounded-2xl border border-[var(--border)] p-3.5">
          <h3 className="font-condensed text-lg font-bold">⛽ Fuel for this load</h3>
          {props.tank == null ? (
            <div className="mt-1.5">
              <p className="text-sm leading-relaxed">The app doesn't know your tank level right now. Tell it once — it remembers for next time.</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input className={inputCls} inputMode="decimal" value={tankPctDraft} onChange={(e) => setTankPctDraft(e.target.value)} placeholder="Tank % — e.g. 38" aria-label="Current fuel tank percent" />
                <input className={inputCls} inputMode="decimal" value={tankGalDraft} onChange={(e) => setTankGalDraft(e.target.value)} placeholder={`…or gallons (of ${props.capacityGal})`} aria-label="Current fuel in gallons" />
              </div>
              <button type="button" className={`${primaryBtn} mt-2`} onClick={saveTank}>Save my fuel level</button>
            </div>
          ) : (
            <>
              <p className="mt-1 text-sm text-[var(--dim)]">
                Tank: <span className="font-bold text-[var(--text)]">{props.tank.pct}%</span> of {props.capacityGal} gal
                {advice ? <> · <span className="font-bold text-[var(--text)]">{advice.gallonsOnBoard} gal</span> on board</> : null}
                <span className="block text-xs">{props.tank.label}</span>
              </p>
              {advice && props.miles != null ? (
                <div className="mt-1.5 text-sm leading-relaxed">
                  <p>
                    This run is <span className="font-bold">{fmtMi(props.miles)}</span>
                    {props.milesNote ? <span className="text-[var(--dim)]"> ({props.milesNote})</span> : null} and burns about{" "}
                    <span className="font-bold">{advice.gallonsNeeded} gal</span> at {advice.effMpg} mpg loaded.
                  </p>
                  {advice.canMakeIt ? (
                    <p className="mt-1 font-semibold text-[var(--ok)]">✓ You can make it on what you have — you'd roll in at about {Math.round(advice.arrivalPct)}%.</p>
                  ) : (
                    <p className="mt-1 font-semibold text-amber-300">
                      ⚠ Short — buy at least {Math.ceil(advice.buyGalToFinish)} gal on the way to finish with the reserve in the tank. On this fuel you reach about {fmtMi(advice.rangeMi)} before the reserve.
                    </p>
                  )}
                  {props.route && props.route.stops.length > 0 && (
                    <p className="mt-1 text-[var(--dim)]">Where to stop is on the route below — the fuel stops are already placed on it.</p>
                  )}
                </div>
              ) : (
                <p className="mt-1 text-sm text-[var(--dim)]">Route the load (below) and the fuel math runs on the route's real miles.</p>
              )}
              {editTank ? (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <input className={inputCls} inputMode="decimal" value={tankPctDraft} onChange={(e) => setTankPctDraft(e.target.value)} placeholder="Tank % — e.g. 38" aria-label="Update fuel tank percent" />
                  <input className={inputCls} inputMode="decimal" value={tankGalDraft} onChange={(e) => setTankGalDraft(e.target.value)} placeholder={`…or gallons (of ${props.capacityGal})`} aria-label="Update fuel in gallons" />
                  <button type="button" className="btn-press col-span-2 min-h-[44px] rounded-xl bg-[var(--accent)] px-4 font-bold text-black" onClick={saveTank}>Save my fuel level</button>
                </div>
              ) : (
                <button type="button" className={`${ghostBtn} mt-2`} onClick={() => setEditTank(true)}>Update fuel level</button>
              )}
            </>
          )}
        </section>

        {/* Route — with the fuel stops on it */}
        <section aria-label="Route this load" className="mt-3 rounded-2xl border border-[var(--border)] p-3.5">
          <h3 className="font-condensed text-lg font-bold">🛣 Route</h3>
          {props.route == null ? (
            <>
              <p className="mt-1 text-sm text-[var(--dim)]">One tap builds the route with the fuel stops placed on it — cheapest stops figured from your tank, your MPG, and this load.</p>
              <button type="button" className={`${primaryBtn} mt-2`} onClick={props.onRouteLoad}>Route load with fuel in route</button>
            </>
          ) : (
            <>
              <p className="mt-1 text-sm">
                <span className="font-bold">{fmtMi(props.route.miles)}</span> · about {fmtDur(props.route.minutes)} — the line is on the map under Routes.
              </p>
              {props.route.stops.length > 0 ? (
                <ul className="mt-2 space-y-1.5">
                  {props.route.stops.map((s) => (
                    <li key={`${s.name}-${s.alongMi}`} className="flex items-baseline justify-between gap-2 rounded-xl bg-[var(--surface2)] px-3 py-2 text-sm">
                      <span><span className="font-bold">{s.name}</span> <span className="text-[var(--dim)]">· {fmtMi(s.alongMi)} in</span></span>
                      <span className="shrink-0 font-bold">{s.action === "FILL" ? `Fill — ${Math.round(s.buyGal)} gal` : s.action === "SPLASH" ? `Splash — ${Math.round(s.buyGal)} gal` : s.action}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-[var(--dim)]">No fuel stop needed on this route at your current level — or no priced stop is on file along it yet.</p>
              )}
              <button type="button" className={`${primaryBtn} mt-2`} onClick={props.onStartGuidance}>▶ Drive this route</button>
              <div className="mt-2 flex gap-2">
                <button type="button" className={`${ghostBtn} flex-1`} onClick={props.onRouteLoad}>Re-route</button>
                <button type="button" className={`${ghostBtn} flex-1`} onClick={props.onEdit}>Edit load</button>
              </div>
            </>
          )}
          {props.route == null && (
            <button type="button" className={`${ghostBtn} mt-2 w-full`} onClick={props.onEdit}>Edit load</button>
          )}
        </section>
      </div>
    </div>
  );
}
