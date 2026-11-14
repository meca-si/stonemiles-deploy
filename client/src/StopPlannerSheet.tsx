// StopPlanner.tsx — the Fuel + Stop Planner sheet (x's order, 2026-11-01).
//
// One screen for the whole stop plan: tank state (ELD live when a real
// ELD fuel reading exists — wired through props, never faked; otherwise
// the manual entry minus modelled burn, labelled "Estimate"), the
// cheapest-true-cost fuel picks with FILL / SPLASH / SKIP calls, the
// 30-minute break point, the stop-for-the-day, and the driver's own
// added stops (fuel / rest / sleeper) with the plan re-checked after
// every add. All math lives in stopPlanner.ts; this file only renders
// it and holds the driver's tank entry + added stops on-device.
//
// Load pay is OPTIONAL (x, 2026-11-01): when there is no pay to use
// (no load, deadheading, pay not entered) this sheet shows NO pay
// field and never asks for one — the header and the fuel-calls basis
// line state the no-pay basis plainly, and the only time-value input
// is the driver's detour-time-cost setting (default: minutes only),
// which is a time setting, not a pay field.
//
// The ELD slot is PROVIDER-AGNOSTIC (x, 2026-11-01): one interface
// (stopPlanner.ts's ELD connection layer), providers as adapters —
// Motive listed first as the example, then Samsara, Geotab, and any future
// provider the same way. This sheet renders the generic "ELD
// connection" state and the provider-named tank label; it contains
// NO connection, login, or credential UI and makes no provider API
// call — linking is the fleet owner's action in the ELD hub, gated
// on the fleet owner's permission.
//
// Advisory only: nothing here touches duty status, trips, or pay.

import { useMemo, useState } from "react";
import {
  buildStopPlan,
  ELD_ADAPTERS,
  rankFuelStops,
  resolveEldSlot,
  resolveTankReading,
  tankSourceLabel,
  type DriverStop,
  type EldFuelReading,
  type HosInput,
  type PlannerCandidate,
  type PlannerStopKind,
} from "./stopPlanner";
import { nightParkingPicks } from "./extras";
import { t as tt, type Lang } from "./i18n";
import type { AutoAddStop } from "./autoAddStops";

export type StopPlannerProps = {
  hos: HosInput;
  /** Route-corridor stops (fuel stops from the corridor scan), already
   *  price-matched against the app's own price layer where possible. */
  candidates: PlannerCandidate[];
  routeMiles: number | null;
  routeMinutes: number | null;
  /** Miles already driven on this route (GPS progress). */
  progressMi: number;
  baseMpg: number;
  /** Tank capacity in gallons, from the truck profile (range ÷ MPG). */
  tankCapacityGal: number;
  loadWeightLbs: number | null;
  /** Active load's all-in $/mi, or null when no load/rate is on file. */
  payPerMile: number | null;
  /** ELD connection layer inputs (provider-agnostic): the linked
   *  adapter's key from the ELD hub ("motive" first option; null when
   *  nothing is linked), whether a link exists, and the feed's fuel
   *  reading when a real feed has actually delivered one — null until
   *  it does. The sheet resolves these through resolveEldSlot; a fuel
   *  % can only reach the tank from that gate. */
  eldAdapterKey: string | null;
  eldLinked: boolean;
  eldFuelReading: EldFuelReading | null;
  onClose: () => void;
  onRoute: (label: string, lat: number, lon: number) => void;
  onShowStop?: (c: PlannerCandidate) => void;
  /** Place search — the app's shared geocode chain. */
  onSearch: (q: string) => Promise<{ label: string; lat: number; lon: number }[]>;
  /** Project a point onto the active route -> miles along it. */
  projectAlongMi: (lat: number, lon: number) => number;
  /** App language for the shared catalogue strings (night parking). */
  lang?: Lang;
  /** Open the full Parking planner (map-data rest areas + services
   *  around the truck) from the night-parking section. */
  onOpenParking?: () => void;
  /** Auto-add stops (2026-11-13): the stops the planner already
   *  added to this route as waypoints (App-owned state; selection in
   *  client/src/autoAddStops.ts). They render as on-route above the
   *  timeline, each with its Remove wired back to the app, which
   *  re-plans without it. Absent/empty = nothing was auto-added. */
  autoAddedStops?: AutoAddStop[];
  onRemoveAutoStop?: (key: string) => void;
  /** Plain note about auto-add for THIS route, when it did not run:
   *  "permit" (locked corridor — never touched) or "off" (the
   *  Settings → Driving switch is off — suggestions only). */
  autoAddNote?: "permit" | "off" | null;
};

type StoredTank = { pct: number; atProgressMi: number };
type StoredDriverStop = DriverStop;

const TANK_KEY = "tgps-planner-tank";
const STOPS_KEY = "tgps-planner-driver-stops";
/** Detour time-cost setting ($/hr) — the fallback time value for runs
 *  with no load pay. Absent key = minutes only (the default). */
const TIME_COST_KEY = "tgps-planner-detour-time-cost";

function loadTimeCostPerHour(): number | null {
  try {
    const v = Number(localStorage.getItem(TIME_COST_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function loadTank(): StoredTank | null {
  try {
    const raw = JSON.parse(localStorage.getItem(TANK_KEY) ?? "null") as StoredTank | null;
    return raw && typeof raw.pct === "number" ? raw : null;
  } catch {
    return null;
  }
}
function loadDriverStops(): StoredDriverStop[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STOPS_KEY) ?? "[]") as unknown;
    return Array.isArray(raw)
      ? raw.filter(
          (x): x is StoredDriverStop =>
            !!x &&
            typeof (x as StoredDriverStop).name === "string" &&
            typeof (x as StoredDriverStop).alongMi === "number" &&
            typeof (x as StoredDriverStop).lat === "number" &&
            typeof (x as StoredDriverStop).lon === "number",
        )
      : [];
  } catch {
    return [];
  }
}
function persist(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked/full — the value still holds for this session.
  }
}

const fmtMi = (n: number) => (n >= 100 ? Math.round(n).toLocaleString() : (Math.round(n * 10) / 10).toLocaleString());
const fmtMoney = (n: number) => `$${n.toFixed(2)}`;

export function StopPlannerSheet(props: StopPlannerProps) {
  const { hos, candidates, routeMiles, progressMi } = props;
  const [tank, setTank] = useState<StoredTank | null>(() => loadTank());
  const [tankInput, setTankInput] = useState("");
  const [driverStops, setDriverStops] = useState<StoredDriverStop[]>(() => loadDriverStops());
  const [addKind, setAddKind] = useState<PlannerStopKind>("fuel");
  const [searchQ, setSearchQ] = useState("");
  const [searchHits, setSearchHits] = useState<{ label: string; lat: number; lon: number }[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [pickFromRoute, setPickFromRoute] = useState(false);
  const [timeCostPerHour, setTimeCostPerHour] = useState<number | null>(() => loadTimeCostPerHour());
  const [timeCostMode, setTimeCostMode] = useState<"minutes" | "dollars">(() => (loadTimeCostPerHour() != null ? "dollars" : "minutes"));
  const [timeCostInput, setTimeCostInput] = useState(() => {
    const v = loadTimeCostPerHour();
    return v != null ? String(v) : "";
  });
  const [timeCostNote, setTimeCostNote] = useState<string | null>(null);

  // The ELD slot: one gate between any provider feed and the tank.
  // fuelPct is non-null only when a link exists AND a real reading
  // was handed in — every other state runs the manual estimate.
  const eldSlot = useMemo(
    () => resolveEldSlot({ adapterKey: props.eldAdapterKey, linked: props.eldLinked, reading: props.eldFuelReading }),
    [props.eldAdapterKey, props.eldLinked, props.eldFuelReading],
  );

  const reading = useMemo(
    () =>
      resolveTankReading({
        eldFuelPct: eldSlot.fuelPct,
        eldConnected: eldSlot.linkState !== "not_linked",
        eldProviderName: eldSlot.adapter?.name ?? null,
        manualPct: tank?.pct ?? 75,
        milesSinceManualEntry: tank ? Math.max(0, progressMi - tank.atProgressMi) : 0,
        capacityGal: props.tankCapacityGal,
        baseMpg: props.baseMpg,
        loadWeightLbs: props.loadWeightLbs,
      }),
    [eldSlot, props.tankCapacityGal, props.baseMpg, props.loadWeightLbs, tank, progressMi],
  );

  const paceMph = routeMiles != null && props.routeMinutes != null && props.routeMinutes > 0 ? routeMiles / (props.routeMinutes / 60) : 50;

  const plan = useMemo(() => {
    if (routeMiles == null) return null;
    // Candidates are route-absolute (alongMi from route start); the
    // planner works in miles-from-the-truck, so shift by GPS progress.
    const shifted = candidates
      .map((c) => ({ ...c, alongMi: Math.max(0, c.alongMi - progressMi) }))
      .filter((c) => c.alongMi <= routeMiles - progressMi + 0.5);
    const shiftedDriver = driverStops
      .map((d) => ({ ...d, alongMi: Math.max(0, d.alongMi - progressMi) }))
      .filter((d) => d.alongMi <= routeMiles - progressMi + 40);
    return buildStopPlan({
      routeMiles: Math.max(0, routeMiles - progressMi),
      paceMph,
      tankPct: reading.pct,
      capacityGal: props.tankCapacityGal,
      baseMpg: props.baseMpg,
      loadWeightLbs: props.loadWeightLbs,
      payPerMile: props.payPerMile,
      settingsTimeValuePerHour: timeCostPerHour,
      hos,
      candidates: shifted,
      driverStops: shiftedDriver,
    });
  }, [routeMiles, candidates, driverStops, progressMi, paceMph, reading.pct, props.tankCapacityGal, props.baseMpg, props.loadWeightLbs, props.payPerMile, timeCostPerHour, hos]);

  const ranked = useMemo(() => {
    if (!plan) return [];
    return rankFuelStops(
      candidates.map((c) => ({ ...c, alongMi: Math.max(0, c.alongMi - progressMi) })),
      { effMpg: plan.effMpg, paceMph, payPerMile: props.payPerMile, typicalBuyGal: 80, settingsTimeValuePerHour: timeCostPerHour },
    ).slice(0, 5);
  }, [plan, candidates, progressMi, paceMph, props.payPerMile, timeCostPerHour]);

  const chooseMinutesOnly = () => {
    setTimeCostMode("minutes");
    setTimeCostPerHour(null);
    try {
      localStorage.removeItem(TIME_COST_KEY);
    } catch {
      // Storage blocked — the choice still holds for this session.
    }
    setTimeCostNote("Saved — detour time now counts in minutes only. No dollar value is put on it.");
  };
  const saveTimeCostDollars = () => {
    const v = Number(timeCostInput.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(v) || v <= 0 || v > 1000) {
      setTimeCostNote("Enter a rate above $0 (up to $1,000/hr) — or switch back to minutes only.");
      return;
    }
    setTimeCostPerHour(v);
    persist(TIME_COST_KEY, v);
    setTimeCostNote(`Saved — on runs with no load pay, detour time is valued at $${v}/hr.`);
  };

  const saveTank = () => {
    const v = Number(tankInput.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(v) || v < 0 || v > 100) return;
    const next = { pct: v, atProgressMi: progressMi };
    setTank(next);
    persist(TANK_KEY, next);
    setTankInput("");
  };

  const addDriverStop = (name: string, lat: number, lon: number) => {
    const alongMi = props.projectAlongMi(lat, lon) + progressMi;
    const stop: StoredDriverStop = { id: `driver-${Date.now()}`, name, lat, lon, alongMi: Math.round(alongMi * 10) / 10, kind: addKind };
    const next = [...driverStops, stop].sort((a, b) => a.alongMi - b.alongMi);
    setDriverStops(next);
    persist(STOPS_KEY, next);
    setSearchHits([]);
    setSearchQ("");
    setSearchNote(`Added ${name} as your ${addKind} stop — the plan re-checked fuel range and your clocks with it in.`);
  };
  const removeDriverStop = (id: string) => {
    const next = driverStops.filter((d) => d.id !== id);
    setDriverStops(next);
    persist(STOPS_KEY, next);
  };

  const doSearch = () => {
    const q = searchQ.trim();
    if (q.length < 3) return;
    setSearching(true);
    setSearchNote(null);
    void props
      .onSearch(q)
      .then((hits) => {
        setSearchHits(hits);
        if (hits.length === 0) setSearchNote("No place found for that search — nothing was added. Try the town or the stop's name.");
      })
      .catch(() => setSearchNote("Search didn't answer — nothing was added. Try again."))
      .finally(() => setSearching(false));
  };

  const actionStyle = (a: string) =>
    a === "FILL"
      ? "bg-[var(--ok)] text-black"
      : a === "SPLASH"
        ? "bg-[var(--accent)] text-black"
        : "bg-[var(--surface)] text-[var(--dim)]";

  return (
    <div className="fixed inset-0 z-[900] flex items-end bg-black/70" role="dialog" aria-label="Fuel and stop planner">
      <div className="animate-sheet max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl bg-[var(--surface)] p-5 pb-safe">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-condensed text-2xl font-bold">🧭 Plan my stops</h2>
          <button type="button" className="btn-press rounded-full bg-[var(--surface2)] px-4 py-2 font-bold" aria-label="Close the stop planner" onClick={props.onClose}>
            ✕ Close
          </button>
        </div>
        <p className="mt-1 text-sm text-[var(--dim)]">
          {props.payPerMile != null
            ? "Fuel, your 30-minute break, and tonight's shutdown planned together on this route — priced against your load. Advisory only: the planner never changes your duty status. With Auto-add stops on (Settings → Driving), these picks are also put on your route as waypoints when the route is planned — each one announced, each removable."
            : "Fuel, your 30-minute break, and tonight's shutdown planned together on this route — ranked on station price, your tank, burn under load, miles left, and detour time. No load pay on this run, and none is needed. Advisory only: the planner never changes your duty status. With Auto-add stops on (Settings → Driving), these picks are also put on your route as waypoints when the route is planned — each one announced, each removable."}
        </p>

        {/* Tank state */}
        <section className="mt-3 rounded-2xl bg-[var(--surface2)] px-3.5 py-3" aria-label="Tank state">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-condensed text-lg font-bold">⛽ Tank</h3>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${reading.source === "eld" ? "bg-[var(--ok)] text-black" : "bg-[var(--surface)] text-[var(--accent)]"}`}>
              {tankSourceLabel(reading)}
            </span>
          </div>
          <div className="mt-1.5 flex items-end gap-3">
            <span className="font-condensed text-4xl font-bold tnum leading-none">{Math.round(reading.pct)}%</span>
            <span className="pb-0.5 text-sm text-[var(--dim)]">
              ≈ {Math.round((reading.pct / 100) * props.tankCapacityGal)} gal of {props.tankCapacityGal}
              {plan ? <> · ~{fmtMi(plan.rangeMi)} mi to the reserve floor at {plan.effMpg} mpg under this load</> : null}
            </span>
          </div>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-[var(--surface)]" role="img" aria-label={`Tank at ${Math.round(reading.pct)} percent`}>
            <div className="h-full rounded-full" style={{ width: `${Math.max(2, reading.pct)}%`, background: "linear-gradient(92deg, var(--neon-a), var(--neon-b))" }} />
          </div>
          {/* ELD connection — the generic slot state. Interface and
              states only: no connect/login UI lives here; linking a
              fleet account is the fleet owner's action, gated on
              their permission, in the ELD hub (Settings → Truck). */}
          <p className="mt-2 text-xs text-[var(--dim)]">
            🔌 <strong className="text-[var(--text)]">ELD connection — {eldSlot.label}</strong>
            {eldSlot.linkState === "not_linked" ? (
              <>
                {" "}
                One slot takes any ELD through the same interface — providers such as {ELD_ADAPTERS.map((a) => a.name).join(", ")}, and others the same way. Linking needs the fleet
                owner's permission on the fleet's ELD account; until then the tank runs on your entry plus the burn estimate. When a linked feed delivers the truck's fuel level %,
                it becomes the tank read automatically — HOS clocks and odometer read over the same link later.
              </>
            ) : eldSlot.linkState === "linked_no_feed" ? (
              <> The link is up, but no fuel reading has arrived on it yet — the tank stays on the estimate until a real one does. Nothing is filled in for it.</>
            ) : (
              <> Fuel level % is reading live from the truck over this link.</>
            )}
          </p>
          {props.loadWeightLbs != null && (
            <p className="mt-1.5 text-xs text-[var(--dim)]">
              Load weight {props.loadWeightLbs.toLocaleString()} lb is in the burn math — loaded, this truck burns about {Math.round((plan?.burnFactor ?? 1) * 100 - 100)}% more per mile than empty.
            </p>
          )}
          {reading.source === "estimate" && (
            <div className="mt-2.5">
              <label className="text-xs font-bold text-[var(--dim)]" htmlFor="planner-tank-pct">
                {tank ? "Update the tank reading (percent full right now)" : "Enter your tank (percent full right now)"}
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  id="planner-tank-pct"
                  className="w-24 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 font-bold"
                  inputMode="decimal"
                  placeholder="e.g. 62"
                  value={tankInput}
                  onChange={(e) => setTankInput(e.target.value)}
                  aria-label="Tank percent full right now"
                />
                <button type="button" className="btn-neon btn-press rounded-xl px-4 py-2.5 text-sm font-bold" aria-label="Save the tank reading" onClick={saveTank}>
                  Save tank
                </button>
              </div>
              <p className="mt-1 text-xs text-[var(--dim)]">
                {tank
                  ? "From your entry, the app burns the estimate down by GPS miles, your truck's MPG, and load weight. When an ELD fuel feed is live, its reading replaces this automatically."
                  : "No entry yet — the plan starts from 75% until you enter your real tank. STONEMILES is a planning aid, not an FMCSA ELD."}
              </p>
            </div>
          )}
        </section>

        {/* Detour time cost — the planner's time-value setting. NOT a
            pay field: it only values detour minutes on runs where no
            load pay applies. Default is minutes only. */}
        <section className="mt-3 rounded-2xl bg-[var(--surface2)] px-3.5 py-3" aria-label="Detour time cost setting">
          <h3 className="font-condensed text-lg font-bold">⏱️ Detour time cost</h3>
          <p className="mt-0.5 text-xs text-[var(--dim)]">
            When a load's pay is on file, detour time is valued from that pay automatically. With no load pay — no load, deadheading, pay not entered — the planner uses this
            instead. Default: minutes only, no dollar value put on your time.
            {props.payPerMile != null ? " Your current load's pay is setting the time value on this run; this takes over on runs with no load pay." : ""}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2" role="group" aria-label="Detour time cost mode">
            <button
              type="button"
              aria-pressed={timeCostMode === "minutes"}
              aria-label="Value detour time in minutes only"
              className={`btn-press rounded-xl px-3 py-2.5 text-sm font-bold ${timeCostMode === "minutes" ? "btn-neon" : "bg-[var(--surface)] border border-[var(--border)]"}`}
              onClick={chooseMinutesOnly}
            >
              Minutes only
            </button>
            <button
              type="button"
              aria-pressed={timeCostMode === "dollars"}
              aria-label="Value detour time at a dollar rate per hour"
              className={`btn-press rounded-xl px-3 py-2.5 text-sm font-bold ${timeCostMode === "dollars" ? "btn-neon" : "bg-[var(--surface)] border border-[var(--border)]"}`}
              onClick={() => {
                setTimeCostMode("dollars");
                setTimeCostNote(null);
              }}
            >
              $ per hour
            </button>
          </div>
          {timeCostMode === "dollars" && (
            <div className="mt-2">
              <label className="text-xs font-bold text-[var(--dim)]" htmlFor="planner-time-cost-rate">
                Your time cost, dollars per hour (used only when there's no load pay)
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  id="planner-time-cost-rate"
                  className="w-24 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 font-bold"
                  inputMode="decimal"
                  placeholder="e.g. 30"
                  value={timeCostInput}
                  onChange={(e) => setTimeCostInput(e.target.value)}
                  aria-label="Detour time cost in dollars per hour"
                />
                <button type="button" className="btn-neon btn-press rounded-xl px-4 py-2.5 text-sm font-bold" aria-label="Save the detour time cost rate" onClick={saveTimeCostDollars}>
                  Save rate
                </button>
              </div>
            </div>
          )}
          {timeCostNote && <p className="mt-1.5 text-xs font-semibold text-[var(--dim)]">{timeCostNote}</p>}
        </section>

        {routeMiles == null ? (
          <p className="mt-3 rounded-xl bg-[var(--surface2)] px-3 py-3 text-sm text-[var(--dim)]">
            Set a route first — the planner lays fuel, break, and shutdown points along it. Your tank entry above is saved either way.
          </p>
        ) : (
          <>
            {/* Feasibility flags */}
            {plan && plan.flags.length > 0 && (
              <div className="mt-3 space-y-2" role="alert">
                {plan.flags.map((f) => (
                  <p key={f} className="rounded-xl bg-amber-900/40 px-3 py-2.5 text-sm font-semibold text-amber-200">
                    ⚠️ {f}
                  </p>
                ))}
              </div>
            )}

            {/* Auto-added stops: already ON this route as waypoints
                (the planner's picks, applied by the app — see
                client/src/autoAddStops.ts). Each carries its Remove;
                the manual suggestion flow below is unchanged. */}
            {((props.autoAddedStops && props.autoAddedStops.length > 0) || props.autoAddNote) && (
              <section className="mt-4" aria-label="Stops added to your route">
                <h3 className="font-condensed text-lg font-bold">{tt(props.lang ?? "en", "extras.autoAddedTitle")}</h3>
                {props.autoAddNote === "permit" && (
                  <p className="mt-1 rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-sm text-[var(--dim)]">{tt(props.lang ?? "en", "extras.autoPermitNote")}</p>
                )}
                {props.autoAddNote === "off" && (
                  <p className="mt-1 rounded-xl bg-[var(--surface2)] px-3 py-2.5 text-sm text-[var(--dim)]">{tt(props.lang ?? "en", "extras.autoOffNote")}</p>
                )}
                {props.autoAddedStops && props.autoAddedStops.length > 0 && (
                  <ol className="mt-2 space-y-2">
                    {props.autoAddedStops.map((s) => {
                      const live = candidates.find((x) => x.id === s.key) ?? driverStops.find((x) => x.id === s.key);
                      const aheadMi = live ? Math.max(0, live.alongMi - progressMi) : s.alongMi;
                      const why: string[] = [];
                      if (s.kinds.includes("fuel")) {
                        let fuelLine = `⛽ ${tt(props.lang ?? "en", "extras.autoFuel")}`;
                        if (s.buyGal != null) fuelLine += ` · ~${Math.round(s.buyGal)} gal`;
                        if (s.pricePerGal != null) fuelLine += ` · $${s.pricePerGal.toFixed(2)}/gal${s.priceLabel ? ` (${s.priceLabel})` : ""}`;
                        if (s.estSaving != null) fuelLine += ` · ${tt(props.lang ?? "en", "extras.autoEstSaving")} $${s.estSaving.toFixed(2)}`;
                        why.push(fuelLine);
                      }
                      if (s.kinds.includes("break")) why.push(`☕ ${tt(props.lang ?? "en", "extras.autoBreak")}`);
                      if (s.kinds.includes("rest")) why.push(`🌙 ${tt(props.lang ?? "en", "extras.autoRest")}`);
                      return (
                        <li key={s.key} className="rounded-2xl border border-[var(--accent)] bg-[var(--surface2)] px-3.5 py-3">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-bold">{s.name}</span>
                            <span className="shrink-0 font-condensed text-lg font-bold tnum">{fmtMi(aheadMi)} mi</span>
                          </div>
                          <p className="mt-0.5 text-sm text-[var(--dim)]">{why.join(" · ")}</p>
                          {props.onRemoveAutoStop && (
                            <div className="mt-2">
                              <button type="button" className="btn-press rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-bold" aria-label={`Remove ${s.name} from the route`} onClick={() => props.onRemoveAutoStop!(s.key)}>
                                {tt(props.lang ?? "en", "extras.autoRemove")}
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>
            )}

            {/* Timeline */}
            <section className="mt-4" aria-label="Stop plan timeline">
              <h3 className="font-condensed text-lg font-bold">Your stop plan — {fmtMi(Math.max(0, routeMiles - progressMi))} mi to go</h3>
              {plan && plan.timeline.length > 0 ? (
                <ol className="mt-2 space-y-2">
                  {plan.timeline.map((t) => (
                    <li key={t.key} className="rounded-2xl border border-[var(--glass-border)] bg-[var(--surface2)] px-3.5 py-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-bold">
                          {t.kind === "fuel" ? "⛽ " : t.kind === "break" ? "☕ " : t.kind === "day" ? "🌙 " : t.kind === "sleeper" ? "🛏️ " : t.kind === "rest" ? "🧍 " : "📍 "}
                          {t.title}
                        </span>
                        <span className="shrink-0 font-condensed text-lg font-bold tnum">{fmtMi(t.alongMi)} mi</span>
                      </div>
                      <p className="mt-0.5 text-sm text-[var(--dim)]">{t.detail}</p>
                      <div className="mt-2 flex gap-2">
                        {(() => {
                          const c = candidates.find((x) => x.name === t.name) ?? driverStops.find((x) => x.name === t.name);
                          return c ? (
                            <button type="button" className="btn-neon btn-press rounded-lg px-3 py-2 text-xs font-bold" aria-label={`Route to ${t.name}`} onClick={() => props.onRoute(t.name, c.lat, c.lon)}>
                              Route here
                            </button>
                          ) : null;
                        })()}
                        {props.onShowStop &&
                          (() => {
                            const c = candidates.find((x) => x.name === t.name);
                            return c ? (
                              <button type="button" className="btn-press rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-bold" aria-label={`Open the stop card for ${t.name}`} onClick={() => props.onShowStop!(c)}>
                                Stop card
                              </button>
                            ) : null;
                          })()}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-2 rounded-xl bg-[var(--surface2)] px-3 py-3 text-sm text-[var(--dim)]">
                  Nothing needs planning on this stretch yet — the tank covers it and no clock forces a stop. Add your own stop below anytime.
                </p>
              )}
              {hos.hasData && plan ? (
                <p className="mt-2 text-xs text-[var(--dim)]">
                  Clocks: break due in ~{fmtMi(plan.breakDueMi ?? 0)} mi · driving day ends in ~{fmtMi(plan.dayDueMi ?? 0)} mi at your route pace (~{Math.round(paceMph)} mph).
                  {plan.breakPick?.combinedWithFuel ? " Break and fuel are combined at one stop." : ""}
                </p>
              ) : (
                <p className="mt-2 text-xs text-[var(--dim)]">No duty log yet — set a duty status and the break + shutdown points join the plan from your real HOS clocks.</p>
              )}
            </section>

            {/* Night parking (Final Extras): the route candidates the
                MAP DATA tags with truck parking, nearest to where the
                driving clock runs out. Space counts are lot sizes
                from map tags — never live availability. */}
            <section className="mt-4" aria-label="Night parking from map data">
              <h3 className="font-condensed text-lg font-bold">{tt(props.lang ?? "en", "extras.nightParking")}</h3>
              <p className="mt-0.5 text-xs text-[var(--dim)]">{tt(props.lang ?? "en", "extras.nightParkingNote")}</p>
              {(() => {
                const picks = nightParkingPicks(
                  candidates.map((c) => ({ ...c, alongMi: Math.max(0, c.alongMi - progressMi) })),
                  plan?.dayDueMi ?? null,
                );
                if (picks.length === 0) {
                  return <p className="mt-2 rounded-xl bg-[var(--surface2)] px-3 py-3 text-sm text-[var(--dim)]">No stop on this route is tagged with truck parking in the map data yet. The Parking planner below scans rest areas and truck services around you from the same map data.</p>;
                }
                return (
                  <div className="mt-2 space-y-1.5">
                    {picks.map((c) => (
                      <div key={c.id} className="flex items-center justify-between gap-2 rounded-xl bg-[var(--surface2)] px-3 py-2 text-sm">
                        <span>
                          <strong>{c.name}</strong>
                          <span className="block text-xs text-[var(--dim)]">
                            ~{fmtMi(c.alongMi)} mi ahead · {c.parkingSpaces != null ? `${c.parkingSpaces} spaces in map data` : "truck parking tagged · space count not in map data"}
                          </span>
                        </span>
                        <button type="button" className="btn-press shrink-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs font-bold" aria-label={`Route to night parking at ${c.name}`} onClick={() => props.onRoute(c.name, c.lat, c.lon)}>
                          Route
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })()}
              {props.onOpenParking && (
                <button type="button" className="btn-press mt-2 w-full rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-3 py-2.5 text-sm font-bold" aria-label="Open the full parking planner" onClick={props.onOpenParking}>
                  Open the full Parking planner — rest areas + truck services around you
                </button>
              )}
            </section>

            {/* Fuel decisions */}
            <section className="mt-4" aria-label="Fuel decisions on this route">
              <h3 className="font-condensed text-lg font-bold">Fuel calls</h3>
              {plan && (
                <p className="mt-0.5 text-xs text-[var(--dim)]">
                  {plan.timeValueSource === "load"
                    ? `Calls run on price, tank, burn, and miles — with detour time valued from your load's pay (${fmtMoney(props.payPerMile ?? 0)}/mi).`
                    : plan.timeValueSource === "settings"
                      ? `No load pay on this run — calls run on price, tank, burn, miles, and detour, with detour time valued at your own setting of ${fmtMoney(plan.timeValuePerHour ?? 0)}/hr.`
                      : "No load pay on this run — calls run on price, tank, burn, miles, and detour time in minutes only. No pay entry is needed."}
                </p>
              )}
              {plan && plan.fuelDecisions.length > 0 ? (
                <ul className="mt-2 space-y-2">
                  {plan.fuelDecisions.map((d) => (
                    <li key={d.stop.id} className="rounded-2xl bg-[var(--surface2)] px-3.5 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold">{d.stop.name}</span>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-extrabold ${actionStyle(d.action)}`}>{d.action}</span>
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--dim)]">
                        {fmtMi(Math.max(0, d.stop.alongMi))} mi ahead · arrive ~{d.arrivalPct}%{d.buyGal > 0 ? ` · buy ~${d.buyGal} gal` : ""} ·{" "}
                        {d.stop.pricePerGal != null ? `${fmtMoney(d.stop.pricePerGal)}/gal — ${d.stop.priceLabel ?? "estimate"}` : "price not in the data the app holds — no price claimed"}
                      </div>
                      <p className="mt-0.5 text-sm">{d.reason}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-[var(--dim)]">No fuel stops on the route data yet — the corridor scan fills this in when a route is set. Nothing is invented to fill the list.</p>
              )}
              {ranked.length > 0 && (
                <p className="mt-2 text-xs text-[var(--dim)]">
                  True-cost order (price + detour fuel + time
                  {plan?.timeValueSource === "load"
                    ? ` valued at your load's ${fmtMoney(props.payPerMile ?? 0)}/mi`
                    : plan?.timeValueSource === "settings"
                      ? ` valued at your setting of ${fmtMoney(plan.timeValuePerHour ?? 0)}/hr — no load pay on this run`
                      : " in minutes only — no load pay on this run, no dollar value on your time"}
                  ):{" "}
                  {ranked.map((r) => `${r.stop.name}${r.trueCostPerGal != null ? ` ${fmtMoney(r.trueCostPerGal)}/gal` : " unpriced"}`).join(" · ")}. Prices are estimates from the data the app already holds — never a live station feed.
                </p>
              )}
            </section>

            {/* Driver-added stops */}
            <section className="mt-4 rounded-2xl bg-[var(--surface2)] px-3.5 py-3" aria-label="Add your own stop">
              <h3 className="font-condensed text-lg font-bold">Add your own stop</h3>
              <div className="mt-2 grid grid-cols-3 gap-2" role="group" aria-label="Stop type">
                {(["fuel", "rest", "sleeper"] as PlannerStopKind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={addKind === k}
                    aria-label={`New stop type: ${k}`}
                    className={`btn-press rounded-xl px-3 py-2.5 text-sm font-bold ${addKind === k ? "btn-neon" : "bg-[var(--surface)] border border-[var(--border)]"}`}
                    onClick={() => setAddKind(k)}
                  >
                    {k === "fuel" ? "⛽ Fuel" : k === "rest" ? "🧍 Rest" : "🛏️ Sleeper"}
                  </button>
                ))}
              </div>
              <div className="mt-2.5 flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
                  placeholder="Search a place — town, stop name, address"
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  aria-label="Search for a place to add as a stop"
                />
                <button type="button" className="btn-press rounded-xl bg-[var(--surface)] border border-[var(--border)] px-4 py-2.5 text-sm font-bold" aria-label="Search for that place" onClick={doSearch} disabled={searching}>
                  {searching ? "…" : "Search"}
                </button>
              </div>
              {searchNote && <p className="mt-1.5 text-xs font-semibold text-[var(--dim)]">{searchNote}</p>}
              {searchHits.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {searchHits.map((h) => (
                    <li key={`${h.lat},${h.lon}`}>
                      <button type="button" className="btn-press w-full rounded-xl bg-[var(--surface)] px-3 py-2.5 text-left text-sm font-semibold" aria-label={`Add ${h.label} as a ${addKind} stop`} onClick={() => addDriverStop(h.label, h.lat, h.lon)}>
                        + {h.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" className="btn-press mt-2 text-sm font-bold underline" aria-expanded={pickFromRoute} aria-label="Pick a stop from this route's stop list" onClick={() => setPickFromRoute((v) => !v)}>
                …or pick from this route's stops
              </button>
              {pickFromRoute && (
                <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto">
                  {candidates.slice(0, 30).map((c) => (
                    <li key={c.id}>
                      <button type="button" className="btn-press w-full rounded-xl bg-[var(--surface)] px-3 py-2.5 text-left text-sm font-semibold" aria-label={`Add ${c.name} as a ${addKind} stop`} onClick={() => addDriverStop(c.name, c.lat, c.lon)}>
                        + {c.name} <span className="text-xs text-[var(--dim)]">· {fmtMi(Math.max(0, c.alongMi - progressMi))} mi ahead</span>
                      </button>
                    </li>
                  ))}
                  {candidates.length === 0 && <li className="text-sm text-[var(--dim)]">No stops on the route data yet.</li>}
                </ul>
              )}
              {driverStops.length > 0 && (
                <ul className="mt-3 space-y-1.5" aria-label="Your added stops">
                  {driverStops.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-2 rounded-xl bg-[var(--surface)] px-3 py-2">
                      <span className="text-sm font-semibold">
                        {d.kind === "fuel" ? "⛽" : d.kind === "rest" ? "🧍" : "🛏️"} {d.name}
                        <span className="ml-1 text-xs text-[var(--dim)]">{fmtMi(Math.max(0, d.alongMi - progressMi))} mi ahead</span>
                      </span>
                      <button type="button" className="btn-press shrink-0 rounded-lg bg-[var(--surface2)] px-2.5 py-1.5 text-xs font-bold" aria-label={`Remove your stop at ${d.name}`} onClick={() => removeDriverStop(d.id)}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
