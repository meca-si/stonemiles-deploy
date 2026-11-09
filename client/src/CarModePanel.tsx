// Android Auto / Cab Mode — the settings panel, the cab display, and
// the head unit.
//
// The panel (Settings → Driving → Android Auto & Cab Mode) carries the
// driver's car switches and a live preview of the three Android Auto
// templates bound to the truck's real drive state — driver-facing
// function only; the launch roadmap lives in our files, not in the
// product UI (x's order, 2026-11-07). The CarDisplay is the
// single-screen glanceable surface (Guidance only). The HeadUnitDisplay
// is the full head unit: all three templates as working full-screen
// screens — Guidance, Stops ahead (the corridor's real truck stops),
// Road alerts (real hazards + the drive clock) — the layout the native
// Android Auto build projects, running in this app today.

import { useState } from "react";
import {
  CAR_TEMPLATES,
  type CarReadout,
  type CarTemplateBinding,
  type HeadUnitAlert,
  type HeadUnitStop,
  type ReceiverMemory,
} from "./carMode";

export interface CarSettings {
  carModeEnabled: boolean;
  carModeAutoLaunch: boolean;
  carVoicePrompts: boolean;
  carShowHos: boolean;
}

/** The tier note shown on full-version features for a Basic account.
 *  Cab Mode is tier inclusion, never a separate add-on — the note
 *  names the tiers, never a Cab Mode price. */
const TIER_LOCK_NOTE = "Part of the Gold, Diamond & Fleet plans";

function CarToggle({
  label,
  desc,
  checked,
  onToggle,
  locked,
}: {
  label: string;
  desc?: string;
  checked: boolean;
  onToggle: () => void;
  /** Full-version feature on a Basic account: shown, named, not a switch. */
  locked?: boolean;
}) {
  if (locked) {
    return (
      <div
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-3.5 py-3 text-left opacity-75"
        role="status"
        aria-label={`${label} — ${TIER_LOCK_NOTE}`}
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{label}</span>
          {desc && <span className="mt-0.5 block text-xs leading-relaxed text-[var(--dim)]">{desc}</span>}
          <span className="mt-1 block text-xs font-bold text-[var(--accent)]">🔒 {TIER_LOCK_NOTE}</span>
        </span>
        <span
          className="relative h-7 w-12 shrink-0 rounded-full bg-[var(--border)]"
          aria-hidden="true"
        >
          <span className="absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white/60 shadow" />
        </span>
      </div>
    );
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-3.5 py-3 text-left"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        {desc && <span className="mt-0.5 block text-xs leading-relaxed text-[var(--dim)]">{desc}</span>}
      </span>
      <span
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? "bg-[var(--ok)]" : "bg-[var(--border)]"}`}
        aria-hidden="true"
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`}
        />
      </span>
    </button>
  );
}

/** The locked face for a full-version screen on a Basic account. */
function TierLockFace({ what }: { what: string }) {
  return (
    <div className="py-2 text-center" role="status" aria-label={`${what} — ${TIER_LOCK_NOTE}`}>
      <div className="text-3xl" aria-hidden="true">🔒</div>
      <p className="mt-2 text-sm leading-relaxed text-[var(--dim)]">
        <strong className="text-[var(--text)]">{what}</strong> is part of the full cab version —{" "}
        {TIER_LOCK_NOTE}. Your Basic plan carries the cab display core: next turn, speed vs the limit, and
        ETA / time / miles left.
      </p>
    </div>
  );
}

/** The guidance face of the readout — shared by the panel preview and
 *  the full-screen display so both render the same template. */
function GuidanceFace({ readout, big }: { readout: CarReadout; big?: boolean }) {
  const turn = readout.turn;
  return (
    <div>
      {/* Hill grade alert — mirrored from the phone's grade engine.
          Big glanceable type on the Guidance screen for EVERY tier:
          a safety warning is part of the guidance core, never the
          full-version upsell. Strong downgrades (≥6%) read urgent. */}
      {readout.gradeAlert && (
        <div
          className={`mb-4 rounded-2xl border px-4 py-3 ${
            readout.gradeAlert.urgent ? "border-[var(--danger)] bg-red-950/60" : "border-[var(--glass-border)] bg-black/30"
          }`}
          role="alert"
          aria-label={`${readout.gradeAlert.headline}${readout.gradeAlert.detail ? `. ${readout.gradeAlert.detail}` : ""}`}
        >
          <div className={`font-condensed font-bold leading-none ${big ? "text-5xl" : "text-3xl"} ${readout.gradeAlert.urgent ? "text-[var(--danger)]" : ""}`}>
            ⛰️ {readout.gradeAlert.headline}
          </div>
          {readout.gradeAlert.detail && (
            <div className={`mt-1 font-semibold leading-snug ${big ? "text-2xl" : "text-base"}`}>{readout.gradeAlert.detail}</div>
          )}
        </div>
      )}
      {/* Construction ahead — mirrored from the phone's work-zone
          layer (driver reports + official DOT feeds). Big glanceable
          type on the Guidance screen for EVERY tier, like the grade
          banner above: it's a safety warning. The headline itself
          carries the source — "Construction reported ahead"
          (drivers) vs "DOT construction ahead" (the DOT's feed). */}
      {readout.constructionAlert && (
        <div
          className="mb-4 rounded-2xl border border-amber-400/60 bg-amber-950/50 px-4 py-3"
          role="alert"
          aria-label={`${readout.constructionAlert.headline}${readout.constructionAlert.detail ? `. ${readout.constructionAlert.detail}` : ""}`}
        >
          <div className={`font-condensed font-bold leading-none ${big ? "text-5xl" : "text-3xl"}`}>
            🚧 {readout.constructionAlert.headline}
          </div>
          {readout.constructionAlert.detail && (
            <div className={`mt-1 font-semibold leading-snug ${big ? "text-2xl" : "text-base"}`}>{readout.constructionAlert.detail}</div>
          )}
        </div>
      )}
      {/* The five alert systems (migration 0107) — the app ranked
          its ramp / curve / crossing / hazard / winter calls and
          mirrored the top one here. Big glanceable type on the
          Guidance screen for EVERY tier, like the grade banner:
          it's a safety warning. */}
      {readout.safetyAlert && (
        <div
          className={`mb-4 rounded-2xl border px-4 py-3 ${
            readout.safetyAlert.urgent ? "border-[var(--danger)] bg-red-950/60" : "border-[var(--glass-border)] bg-black/30"
          }`}
          role="alert"
          aria-label={`${readout.safetyAlert.headline}${readout.safetyAlert.detail ? `. ${readout.safetyAlert.detail}` : ""}`}
        >
          <div className={`font-condensed font-bold leading-none ${big ? "text-5xl" : "text-3xl"} ${readout.safetyAlert.urgent ? "text-[var(--danger)]" : ""}`}>
            {readout.safetyAlert.icon} {readout.safetyAlert.headline}
          </div>
          {readout.safetyAlert.detail && (
            <div className={`mt-1 font-semibold leading-snug ${big ? "text-2xl" : "text-base"}`}>{readout.safetyAlert.detail}</div>
          )}
        </div>
      )}
      {turn ? (
        <div
          className="flex items-center gap-4"
          role="status"
          aria-label={
            turn.arrived
              ? "You have arrived at your destination"
              : `Next turn in ${turn.distanceText}: ${turn.instruction}${turn.street ? ` onto ${turn.street}` : ""}`
          }
        >
          <div
            aria-hidden="true"
            className={`${big ? "text-7xl" : "text-5xl"} leading-none ${turn.imminent ? "alert-pulse" : ""}`}
          >
            {turn.arrived ? "🏁" : turn.arrow}
          </div>
          <div className="min-w-0">
            <div className={`font-condensed font-bold leading-none ${big ? "text-6xl" : "text-4xl"}`}>
              {turn.arrived ? "Arrived" : turn.distanceText}
            </div>
            <div className={`mt-1 font-semibold leading-snug ${big ? "text-2xl" : "text-base"}`}>
              {turn.arrived ? "You have arrived at your destination." : turn.instruction}
            </div>
            {turn.street && !turn.arrived && (
              <div className={`${big ? "text-xl" : "text-sm"} text-[var(--dim)]`}>{turn.street}</div>
            )}
          </div>
        </div>
      ) : (
        <p className={`${big ? "text-xl" : "text-sm"} leading-relaxed text-[var(--dim)]`}>
          No route running. Set a destination while you're parked and this becomes your dash — next turn,
          speed, ETA, and your drive clock, nothing else competing for your eyes.
        </p>
      )}
      <div className={`mt-4 grid gap-2 ${readout.tiles.length > 2 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2"}`}>
        {readout.tiles.map((t) => (
          <div
            key={t.id}
            className={`rounded-2xl border px-3 py-2.5 ${
              t.urgent
                ? "border-[var(--danger)] bg-red-950/60"
                : "border-[var(--glass-border)] bg-black/30"
            }`}
            role="status"
            aria-label={`${t.label}: ${t.value}${t.sub ? `, ${t.sub}` : ""}${t.urgent ? " — warning" : ""}`}
          >
            <div className="text-[11px] font-bold uppercase tracking-widest text-[var(--dim)]">{t.label}</div>
            <div
              className={`font-condensed font-bold leading-none tnum ${big ? "text-5xl" : "text-3xl"} ${
                t.urgent ? "text-[var(--danger)]" : ""
              }`}
            >
              {t.value}
            </div>
            {t.sub && <div className="mt-0.5 truncate text-xs text-[var(--dim)]">{t.sub}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** One stop row — shared by the panel preview and the head unit's
 *  Stops screen, so both render the same PlaceList row. */
function StopRow({
  stop,
  big,
  onTap,
}: {
  stop: HeadUnitStop;
  big?: boolean;
  onTap?: (stop: HeadUnitStop) => void;
}) {
  const inner = (
    <>
      <span className="min-w-0 flex-1">
        <span className={`block truncate font-semibold leading-snug ${big ? "text-2xl" : "text-base"}`}>
          {stop.name}
        </span>
        <span className={`block truncate ${big ? "text-lg" : "text-xs"} text-[var(--dim)]`}>
          {stop.brandLabel}
          {stop.facts.length > 0 ? ` · ${stop.facts.join(" · ")}` : ""}
        </span>
      </span>
      <span
        className={`shrink-0 font-condensed font-bold leading-none tnum ${big ? "text-4xl" : "text-2xl"}`}
        aria-label={`${stop.distanceText} ahead`}
      >
        {stop.distanceText}
      </span>
    </>
  );
  const cls = `flex w-full items-center gap-3 rounded-2xl border border-[var(--glass-border)] bg-black/30 text-left ${
    big ? "min-h-[76px] px-4 py-3" : "px-3 py-2.5"
  }`;
  if (onTap && stop.tappable) {
    return (
      <button
        type="button"
        className={`${cls} btn-press`}
        aria-label={`Open the stop card for ${stop.name}, ${stop.distanceText} ahead`}
        onClick={() => onTap(stop)}
      >
        {inner}
      </button>
    );
  }
  return (
    <div className={cls} role="status" aria-label={`${stop.name}, ${stop.distanceText} ahead`}>
      {inner}
    </div>
  );
}

/** One alert row — shared by the panel preview and the head unit's
 *  Alerts screen. */
function AlertRow({ alert, big }: { alert: HeadUnitAlert; big?: boolean }) {
  return (
    <div
      className={`flex w-full items-start gap-3 rounded-2xl border text-left ${
        alert.urgent ? "border-[var(--danger)] bg-red-950/60" : "border-[var(--glass-border)] bg-black/30"
      } ${big ? "min-h-[76px] px-4 py-3" : "px-3 py-2.5"}`}
      role="status"
      aria-label={`${alert.label}${alert.distanceText ? `, ${alert.distanceText} ahead` : ""}: ${alert.detail}${alert.urgent ? " — warning" : ""}`}
    >
      <span aria-hidden="true" className={big ? "text-4xl" : "text-2xl"}>
        {alert.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block font-semibold leading-snug ${big ? "text-2xl" : "text-base"}`}>
          {alert.label}
          {alert.distanceText && (
            <span className="tnum text-[var(--accent)]"> · {alert.distanceText}</span>
          )}
        </span>
        <span className={`block leading-snug ${big ? "text-lg" : "text-xs"} text-[var(--dim)]`}>
          {alert.detail}
        </span>
      </span>
    </div>
  );
}

function TemplateFace({
  template,
  readout,
  stops,
  alerts,
  fullAccess,
}: {
  template: CarTemplateBinding;
  readout: CarReadout;
  stops: HeadUnitStop[];
  alerts: HeadUnitAlert[];
  fullAccess: boolean;
}) {
  if (template.id === "navigation") return <GuidanceFace readout={readout} />;
  if (!fullAccess) return <TierLockFace what={template.title} />;
  if (template.id === "places") {
    return (
      <div>
        {stops.length > 0 ? (
          <div className="space-y-2">
            {stops.slice(0, 3).map((s) => (
              <StopRow key={s.id} stop={s} />
            ))}
          </div>
        ) : (
          <p className="text-sm leading-relaxed text-[var(--dim)]">
            No stops loaded yet. The corridor's truck stops land here from the map data the moment a route
            is running — nearest first, with the facts the data actually states.
          </p>
        )}
        <p className="mt-2 text-xs leading-relaxed text-[var(--dim)]">
          The head unit's {template.template} — open the head unit for the full screen.
        </p>
      </div>
    );
  }
  return (
    <div>
      {alerts.length > 0 ? (
        <div className="space-y-2">
          {alerts.map((a) => (
            <AlertRow key={a.id} alert={a} />
          ))}
        </div>
      ) : (
        <p className="text-sm leading-relaxed text-[var(--dim)]">
          Nothing flagged ahead right now. Weigh stations, low bridges, weight limits, and a dying drive
          clock land here the moment they matter.
        </p>
      )}
      <p className="mt-2 text-xs leading-relaxed text-[var(--dim)]">
        The head unit's {template.template} — open the head unit for the full screen.
      </p>
    </div>
  );
}

export function CarModePanel({
  settings,
  onPatch,
  readout,
  stops,
  alerts,
  guidanceActive,
  fullAccess,
  planName,
  onOpenDisplay,
  onOpenHeadUnit,
}: {
  settings: CarSettings;
  onPatch: (patch: Partial<CarSettings>) => void;
  readout: CarReadout;
  stops: HeadUnitStop[];
  alerts: HeadUnitAlert[];
  guidanceActive: boolean;
  /** Gold-and-up: the full cab version. Basic: the core display only. */
  fullAccess: boolean;
  planName: string;
  onOpenDisplay: () => void;
  onOpenHeadUnit: () => void;
}) {
  const [tab, setTab] = useState<CarTemplateBinding["id"]>("navigation");
  const active = CAR_TEMPLATES.find((t) => t.id === tab) ?? CAR_TEMPLATES[0]!;

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-condensed text-xl font-bold">🚗 Android Auto &amp; Cab Mode</h3>
          <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
            The full head unit, running inside this app — Guidance, Stops ahead, and Road alerts on Google's
            Android Auto templates, fed by your live route, the corridor's real truck stops, and the hazards
            ahead. Built for commercial work — hotshots, rigs, and fleet trucks.
          </p>
          <p className="mt-1 text-sm leading-relaxed text-[var(--dim)]">
            Your plan: <strong className="text-[var(--text)]">{planName}</strong> —{" "}
            {fullAccess
              ? "the full cab version is on your tier."
              : "the basic cab version: next turn, speed vs the limit, ETA / time / miles left."}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
            settings.carModeEnabled ? "bg-emerald-900/60 text-emerald-200" : "bg-[var(--surface2)] text-[var(--dim)]"
          }`}
          role="status"
        >
          {settings.carModeEnabled ? "CAB MODE ON" : "CAB MODE OFF"}
        </span>
      </div>

      <div className="mt-3 space-y-2">
        <CarToggle
          label="Cab Mode"
          desc="The master switch — turns on the cab display in this app and binds the Android Auto templates to your live route."
          checked={settings.carModeEnabled}
          onToggle={() => onPatch({ carModeEnabled: !settings.carModeEnabled })}
        />
        <CarToggle
          label="Open with guidance"
          desc="The cab display opens by itself the moment turn-by-turn guidance starts, and steps aside when the route ends. Closing it by hand keeps it closed for that route."
          checked={settings.carModeAutoLaunch}
          onToggle={() => onPatch({ carModeAutoLaunch: !settings.carModeAutoLaunch })}
          locked={!fullAccess}
        />
        <CarToggle
          label="Voice directions on the cab display"
          desc="Spoken turns keep playing while the cab display is up — the screen stays glanceable, the voice does the talking."
          checked={settings.carVoicePrompts}
          onToggle={() => onPatch({ carVoicePrompts: !settings.carVoicePrompts })}
          locked={!fullAccess}
        />
        <CarToggle
          label="Drive clock (HOS) on the cab display"
          desc="Shows your drive time left as a tile, and flags it when you drop under 30 minutes."
          checked={settings.carShowHos}
          onToggle={() => onPatch({ carShowHos: !settings.carShowHos })}
          locked={!fullAccess}
        />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          className="btn-neon btn-press min-h-[52px] rounded-xl px-4 font-condensed text-xl font-bold"
          aria-label="Open the head unit — guidance, stops ahead, and road alerts"
          onClick={onOpenHeadUnit}
        >
          🖥️ Open head unit
        </button>
        <button
          type="button"
          className="btn-press min-h-[52px] rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-4 font-condensed text-xl font-bold"
          aria-label="Open the cab display now"
          onClick={onOpenDisplay}
        >
          Open cab display{guidanceActive ? " — guidance live" : ""}
        </button>
      </div>

      {/* Template preview — the three Android Auto screens */}
      <div className="mt-4">
        <div className="text-xs font-bold uppercase tracking-widest text-[var(--dim)]">
          The head-unit screens
        </div>
        <div className="mt-2 flex gap-2" role="tablist" aria-label="Android Auto template preview">
          {CAR_TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              aria-label={`Preview the ${t.title} screen`}
              onClick={() => setTab(t.id)}
              className={`btn-press min-h-[44px] flex-1 rounded-xl px-2 font-condensed text-lg font-bold ${
                tab === t.id
                  ? "bg-[var(--accent)] text-black"
                  : "border border-[var(--border)] bg-[var(--surface2)]"
              }`}
            >
              {t.title}
            </button>
          ))}
        </div>
        <div className="glass-panel mt-2 p-4" role="tabpanel" aria-label={`${active.title} template preview`}>
          <TemplateFace template={active} readout={readout} stops={stops} alerts={alerts} fullAccess={fullAccess} />
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-[var(--dim)]">
          Every screen binds your live drive state — start a route and Guidance, Stops, and Alerts all fill
          in for real. The head unit runs these same screens full-screen.
        </p>
      </div>

      <p className="mt-4 border-t border-[var(--border)] pt-3 text-xs leading-relaxed text-[var(--dim)]">
        Head-unit projection arrives with the Play Store release.
      </p>
    </div>
  );
}

type HeadUnitScreen = "guidance" | "stops" | "alerts";

const HEAD_UNIT_SCREENS: { id: HeadUnitScreen; label: string; icon: string }[] = [
  { id: "guidance", label: "Guidance", icon: "🧭" },
  { id: "stops", label: "Stops ahead", icon: "⛽" },
  { id: "alerts", label: "Road alerts", icon: "⚠️" },
];

/** The head unit — the full three-screen surface, full-screen. This is
 *  the layout the native Android Auto build projects onto the truck's
 *  own screen; here it runs in the app, on the phone or tablet mounted
 *  in the cab. Three screens, thumb-size tabs, nothing else: while
 *  rolling the lists are already capped by the model (carMode.ts), so
 *  no screen ever asks a rolling driver to scroll. */
export function HeadUnitDisplay({
  readout,
  stops,
  alerts,
  enabled,
  fullAccess,
  voicePromptsOn,
  hasRoute,
  loadLine,
  routeProgress,
  receiverMemory,
  onEnable,
  onExit,
  onEndRoute,
  onStopTap,
  onReportConstruction,
  onReportHazard,
  canReportConstruction,
}: {
  readout: CarReadout;
  stops: HeadUnitStop[];
  alerts: HeadUnitAlert[];
  enabled: boolean;
  /** Gold-and-up: Stops ahead + Road alerts run. Basic: Guidance only. */
  fullAccess: boolean;
  voicePromptsOn: boolean;
  hasRoute: boolean;
  /** The sealed load on the truck right now ("Load to City, ST") —
   *  the drive clock and this line answer to the load, not a timer. */
  loadLine: string | null;
  /** Route progress for the signature night-green line. */
  routeProgress: { frac: number; label: string } | null;
  /** Receiver memory on approach — the driver's own sealed history
   *  at this dock, inside the final 50 miles. */
  receiverMemory: ReceiverMemory | null;
  onEnable: () => void;
  onExit: () => void;
  onEndRoute: () => void;
  onStopTap: (stop: HeadUnitStop) => void;
  /** One-tap "Report construction" from the Road alerts screen —
   *  the app owns the report (it stays the single source of truth);
   *  the head unit just carries the button. Optional: older callers
   *  without the wiring simply don't show the button. */
  onReportConstruction?: () => void;
  /** One-tap hazard reports from the Road alerts screen
   *  (migration 0107) — the app owns the report; the head unit
   *  carries the buttons. Kind: traffic_stopped | debris |
   *  vehicle_shoulder. */
  onReportHazard?: (kind: "traffic_stopped" | "debris" | "vehicle_shoulder") => void;
  /** Whether a report can be filed right now (a GPS fix exists). */
  canReportConstruction?: boolean;
}) {
  const [screen, setScreen] = useState<HeadUnitScreen>("guidance");
  const activeScreen = HEAD_UNIT_SCREENS.find((s) => s.id === screen) ?? HEAD_UNIT_SCREENS[0]!;

  return (
    <div
      className="fixed inset-0 z-[960] flex flex-col bg-[#050a1a] p-4 pt-safe pb-safe text-[var(--text)]"
      role="dialog"
      aria-label="Head unit"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-bold uppercase tracking-widest text-[var(--dim)]">
          🖥️ Head unit · {activeScreen.label}
          {voicePromptsOn ? " · voice on" : ""}
        </div>
        <button
          type="button"
          className="btn-press min-h-[52px] rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-5 font-condensed text-xl font-bold"
          aria-label="Exit the head unit"
          onClick={onExit}
        >
          ✕ Exit
        </button>
      </div>

      {!enabled ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="text-6xl" aria-hidden="true">🖥️</div>
          <p className="mt-3 max-w-md text-lg leading-relaxed">
            Cab Mode is off. Turn it on and this becomes your head unit — guidance, the stops ahead, and the
            road alerts, in type you can read at a glance. Built for commercial work: hotshots, rigs, and
            fleet trucks.
          </p>
          <button
            type="button"
            className="btn-neon btn-press mt-4 min-h-[56px] rounded-xl px-6 font-condensed text-2xl font-bold"
            aria-label="Turn Cab Mode on"
            onClick={onEnable}
          >
            Turn Cab Mode on
          </button>
        </div>
      ) : (
        <>
          <div className="flex min-h-0 flex-1 flex-col justify-center py-3">
            {screen === "guidance" && (
              <div>
                <GuidanceFace readout={readout} big />
                {routeProgress && (
                  <div className="mt-5" role="status" aria-label={`Route progress: ${routeProgress.label}`}>
                    {/* The signature night-green route line — the same
                        green the map draws the route with after dark,
                        carried onto the dash. */}
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(2, Math.min(100, routeProgress.frac * 100))}%`,
                          background: "var(--neon-b)",
                          boxShadow: "0 0 12px rgba(61, 220, 132, 0.6)",
                        }}
                      />
                    </div>
                    <div className="mt-2 text-xl font-semibold tnum">{routeProgress.label}</div>
                  </div>
                )}
                {loadLine && (
                  <div className="mt-3 text-2xl font-semibold" role="status" aria-label={loadLine}>
                    🚛 {loadLine}
                  </div>
                )}
                {receiverMemory && (
                  <div
                    className="mt-4 rounded-2xl border px-4 py-3"
                    style={{ borderColor: "rgba(61, 220, 132, 0.45)", background: "rgba(61, 220, 132, 0.08)" }}
                    role="status"
                    aria-label={`${receiverMemory.headline}. ${receiverMemory.line}${receiverMemory.note ? `. Your note: ${receiverMemory.note}` : ""}`}
                  >
                    <div className="text-2xl font-bold leading-snug">🏭 {receiverMemory.headline}</div>
                    <div className="mt-1 text-xl leading-snug">{receiverMemory.line}</div>
                    {receiverMemory.note && (
                      <div className="mt-1 text-xl italic leading-snug">Your note: “{receiverMemory.note}”</div>
                    )}
                  </div>
                )}
              </div>
            )}
            {screen !== "guidance" && !fullAccess && (
              <div className="mx-auto max-w-lg text-center" role="status" aria-label={`${activeScreen.label} — ${TIER_LOCK_NOTE}`}>
                <div className="text-6xl" aria-hidden="true">🔒</div>
                <p className="mt-3 text-xl leading-relaxed text-[var(--dim)]">
                  <strong className="text-[var(--text)]">{activeScreen.label}</strong> is part of the full
                  cab version — {TIER_LOCK_NOTE}. Your Basic plan carries the Guidance core: next turn,
                  speed vs the limit, and ETA / time / miles left.
                </p>
              </div>
            )}
            {screen === "stops" && fullAccess &&
              (stops.length > 0 ? (
                <div className="space-y-2">
                  <p className="pb-1 text-xl font-semibold">
                    Truck parking · fuel · scales · weigh stations — built for hauling.
                  </p>
                  {stops.map((s) => (
                    <StopRow key={s.id} stop={s} big onTap={onStopTap} />
                  ))}
                </div>
              ) : (
                <p className="max-w-lg text-xl leading-relaxed text-[var(--dim)]">
                  No stops loaded yet. The corridor's truck stops and weigh stations land here from the map
                  data the moment a route is running — nearest first, with the facts the data actually
                  states.
                </p>
              ))}
            {screen === "alerts" && fullAccess && (
              <div className="space-y-2">
                {alerts.length > 0 ? (
                  alerts.map((a) => <AlertRow key={a.id} alert={a} big />)
                ) : (
                  <p className="max-w-lg text-xl leading-relaxed text-[var(--dim)]">
                    Nothing flagged ahead right now. Weigh stations, low bridges, weight limits, construction,
                    and a dying drive clock land here the moment they matter.
                  </p>
                )}
                {onReportConstruction && (
                  <button
                    type="button"
                    className="btn-press min-h-[64px] w-full rounded-2xl border border-amber-400/60 bg-amber-950/50 font-condensed text-2xl font-bold disabled:opacity-40"
                    aria-label="Report construction at my position"
                    disabled={!canReportConstruction}
                    onClick={onReportConstruction}
                  >
                    🚧 Report construction{canReportConstruction ? "" : " — waiting for GPS"}
                  </button>
                )}
                {onReportHazard && (
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        ["traffic_stopped", "🛑 Traffic stopped"],
                        ["debris", "⚠️ Debris in road"],
                        ["vehicle_shoulder", "🚗 Vehicle on shoulder"],
                      ] as const
                    ).map(([kind, label]) => (
                      <button
                        key={kind}
                        type="button"
                        className="btn-press min-h-[64px] rounded-2xl border border-[var(--border)] bg-[var(--surface2)] px-2 font-condensed text-xl font-bold disabled:opacity-40"
                        aria-label={`Report ${label.replace(/^\S+ /, "")} at my position`}
                        disabled={!canReportConstruction}
                        onClick={() => onReportHazard(kind)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {screen === "guidance" && hasRoute && (
            <button
              type="button"
              className="btn-press mb-2 min-h-[60px] w-full rounded-2xl border border-red-300/60 bg-red-900/70 font-condensed text-2xl font-bold text-red-100"
              aria-label="End route — stop guidance"
              onClick={onEndRoute}
            >
              ■ End route
            </button>
          )}

          <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Head unit screens">
            {HEAD_UNIT_SCREENS.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={screen === s.id}
                aria-label={`Show the ${s.label} screen${s.id === "alerts" && alerts.length > 0 ? ` — ${alerts.length} alert${alerts.length === 1 ? "" : "s"}` : ""}`}
                onClick={() => setScreen(s.id)}
                className={`btn-press relative min-h-[76px] rounded-2xl px-2 font-condensed text-2xl font-bold ${
                  screen === s.id
                    ? "bg-[var(--accent)] text-black"
                    : "border border-[var(--border)] bg-[var(--surface2)]"
                }`}
              >
                <span aria-hidden="true">{s.icon} </span>
                {s.label}
                {!fullAccess && s.id !== "guidance" && <span aria-hidden="true"> 🔒</span>}
                {s.id === "alerts" && alerts.length > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute right-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-[var(--danger)] px-1 text-sm font-bold text-white"
                  >
                    {alerts.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** The full-screen cab display — what the driver actually drives with. */
export function CarDisplay({
  readout,
  enabled,
  voicePromptsOn,
  hasRoute,
  onEnable,
  onExit,
  onEndRoute,
}: {
  readout: CarReadout;
  enabled: boolean;
  voicePromptsOn: boolean;
  hasRoute: boolean;
  onEnable: () => void;
  onExit: () => void;
  onEndRoute: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[950] flex flex-col bg-[#050a1a] p-4 pt-safe pb-safe text-[var(--text)]"
      role="dialog"
      aria-label="Cab display"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-bold uppercase tracking-widest text-[var(--dim)]">
          🚗 Cab display{voicePromptsOn ? " · voice on" : ""}
        </div>
        <button
          type="button"
          className="btn-press min-h-[52px] rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-5 font-condensed text-xl font-bold"
          aria-label="Exit the cab display"
          onClick={onExit}
        >
          ✕ Exit
        </button>
      </div>

      {!enabled ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="text-6xl" aria-hidden="true">🚗</div>
          <p className="mt-3 max-w-md text-lg leading-relaxed">
            Cab Mode is off. Turn it on and this screen becomes your dash — next turn, speed, ETA, and your
            drive clock, in type you can read at a glance.
          </p>
          <button
            type="button"
            className="btn-neon btn-press mt-4 min-h-[56px] rounded-xl px-6 font-condensed text-2xl font-bold"
            aria-label="Turn Cab Mode on"
            onClick={onEnable}
          >
            Turn Cab Mode on
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-1 flex-col justify-center">
            <GuidanceFace readout={readout} big />
          </div>
          {hasRoute && (
            <button
              type="button"
              className="btn-press min-h-[64px] w-full rounded-2xl border border-red-300/60 bg-red-900/70 font-condensed text-2xl font-bold text-red-100"
              aria-label="End route — stop guidance"
              onClick={onEndRoute}
            >
              ■ End route
            </button>
          )}
        </>
      )}
    </div>
  );
}
