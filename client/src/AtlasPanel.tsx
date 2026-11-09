// STONEMILES Atlas — the sheet UI (x's green light, 2026-11-06).
//
// The digital truckers' road atlas inside the app: an Atlas home
// (the federal baseline card + all 50 states + a search box) and one
// page per state — weight limits, length/width basics, low-clearance
// highlights, weigh/inspection stations, and DOT / patrol contacts.
// All data is the bundled static reference in atlas.ts: the whole
// sheet works fully offline, on every plan tier (a core driver
// safety reference is never paywalled — same standing as manual load
// entry), and nothing here is presented as live or real-time.
//
// Two sections deliberately hold NO second copy of app data:
// - Weigh stations hand off to the app's one existing station list
//   (OpenStreetMap stations + driver-added stations, with the
//   driver-reported OPEN/CLOSED status on the Drive screen) through
//   onOpenWeighStations — the same landing Ask Meca's
//   weigh_station_status jump uses.
// - Low clearances name a bridge only where atlas.ts carries a
//   famous, sourced fact; every page also hands off to the real
//   OpenStreetMap clearance tags the Drive map reads around the
//   truck through onOpenMapClearances.
// The standing honesty label (ATLAS_REFERENCE_NOTE) prints on the
// home and on every state page.

import { useMemo, useState } from "react";
import { t, type Lang } from "./i18n";
import {
  ATLAS_REFERENCE_NOTE,
  ATLAS_STATES,
  FEDERAL_STANDARD_LABEL,
  FEDERAL_WEIGHTS,
  FEDERAL_WIDTH_IN,
  atlasStateByCode,
  type AtlasState,
} from "./atlas";

const SECTION_TITLE = "font-condensed text-xl font-bold leading-tight";
const NOTE_BOX =
  "rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-3.5 py-3 text-sm leading-snug";
const JUMP_BTN =
  "btn-press mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-3.5 py-2.5 text-sm font-bold text-black";

function ReferenceBanner({ lang }: { lang: Lang }) {
  return (
    <div className="rounded-xl border border-amber-300/50 bg-amber-900/40 px-3.5 py-2.5 text-sm font-bold text-amber-100" role="note">
      ⚖️ {ATLAS_REFERENCE_NOTE}
      {/* Multi-language honesty boundary: the English original above
          is the governing text and always prints. The translation
          rides beneath it, labelled as such — never instead of it. */}
      {lang !== "en" && (
        <span className="mt-1 block text-xs font-semibold opacity-90">
          {t(lang, "govern.atlasLine")} {t(lang, "govern.note")}
        </span>
      )}
    </div>
  );
}

function WeightRows() {
  return (
    <dl className="mt-2 space-y-1.5 text-base">
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-[var(--dim)]">Gross vehicle weight</dt>
        <dd className="font-bold tnum">{FEDERAL_WEIGHTS.gvwLbs.toLocaleString()} lb</dd>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-[var(--dim)]">Single axle</dt>
        <dd className="font-bold tnum">{FEDERAL_WEIGHTS.singleAxleLbs.toLocaleString()} lb</dd>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-[var(--dim)]">Tandem axle</dt>
        <dd className="font-bold tnum">{FEDERAL_WEIGHTS.tandemAxleLbs.toLocaleString()} lb</dd>
      </div>
    </dl>
  );
}

function StatePage({
  state,
  onBack,
  onOpenWeighStations,
  onOpenMapClearances,
  lang,
}: {
  state: AtlasState;
  onBack: () => void;
  onOpenWeighStations: () => void;
  onOpenMapClearances: () => void;
  lang: Lang;
}) {
  return (
    <div>
      <button
        type="button"
        className="btn-press mb-3 flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface2)] px-3.5 py-2 text-sm font-bold"
        aria-label="Back to all states"
        onClick={onBack}
      >
        ← All states
      </button>
      <h3 className="font-condensed text-3xl font-bold leading-none">
        {state.name} <span className="text-[var(--dim)]">· {state.code}</span>
      </h3>
      <div className="mt-3">
        <ReferenceBanner lang={lang} />
      </div>

      <section className="mt-5" aria-label={`Weight limits in ${state.name}`}>
        <h4 className={SECTION_TITLE}>⚖️ Weight limits</h4>
        <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-[var(--dim)]">
          Federal Interstate baseline
        </p>
        <WeightRows />
        {state.weightNote ? (
          <div className={`${NOTE_BOX} mt-3`}>
            <span className="font-bold">{state.name} note:</span> {state.weightNote}
          </div>
        ) : (
          <p className="mt-3 text-sm font-semibold text-[var(--dim)]">{FEDERAL_STANDARD_LABEL}</p>
        )}
        <p className="mt-2 text-sm leading-snug text-[var(--dim)]">
          The federal bridge formula also caps how much weight any axle group can carry for its
          spacing — closer axles, less weight. Overweight moves run on the state's permits.
        </p>
      </section>

      <section className="mt-6" aria-label={`Length and width basics in ${state.name}`}>
        <h4 className={SECTION_TITLE}>📏 Length &amp; width basics</h4>
        <dl className="mt-2 space-y-1.5 text-base">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-[var(--dim)]">Width (National Network)</dt>
            <dd className="font-bold tnum">{FEDERAL_WIDTH_IN} in</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-[var(--dim)]">Semitrailer</dt>
            <dd className="font-bold">53 ft standard</dd>
          </div>
        </dl>
        {state.sizeNote ? (
          <div className={`${NOTE_BOX} mt-3`}>
            <span className="font-bold">{state.name} note:</span> {state.sizeNote}
          </div>
        ) : (
          <p className="mt-3 text-sm font-semibold text-[var(--dim)]">{FEDERAL_STANDARD_LABEL}</p>
        )}
        <p className="mt-2 text-sm leading-snug text-[var(--dim)]">
          Federal law sets no overall-length cap for a tractor-semitrailer on the National
          Network and bars states from restricting semitrailers under 48 ft there. Off the
          network, some states and roads still post 96-inch width and shorter length limits —
          the posted sign wins.
        </p>
      </section>

      <section className="mt-6" aria-label={`Low clearances in ${state.name}`}>
        <h4 className={SECTION_TITLE}>🌉 Low-clearance highlights</h4>
        {state.clearanceNote ? (
          <div className={`${NOTE_BOX} mt-2`}>
            <span className="font-bold">{state.name} note:</span> {state.clearanceNote}
          </div>
        ) : (
          <p className="mt-2 text-sm leading-snug text-[var(--dim)]">
            No single famous trap on file for {state.name} — and no clearance is listed here
            rather than invented.
          </p>
        )}
        <p className="mt-2 text-sm leading-snug">
          The clearances this app actually works from are the real ones: OpenStreetMap
          maxheight tags read live around your truck. The Drive map flags every tagged bridge
          lower than your truck's height, and the sign board calls out the next tagged
          clearance ahead.
        </p>
        <button
          type="button"
          className={JUMP_BTN}
          aria-label="See tagged clearances on the Drive map"
          onClick={onOpenMapClearances}
        >
          🗺️ See tagged clearances on the map
        </button>
      </section>

      <section className="mt-6" aria-label={`Weigh and inspection stations in ${state.name}`}>
        <h4 className={SECTION_TITLE}>🚨 Weigh &amp; inspection stations</h4>
        <p className="mt-2 text-sm leading-snug">
          Stations aren't listed twice. The app's one station list — OpenStreetMap stations
          plus stations drivers added — lives on the Drive screen with driver-reported
          OPEN / CLOSED status: while a trip is live, the app asks drivers rolling up on a
          station to tap OPEN or CLOSED, and the answer updates the station for everyone. A
          status over 4 hours old reads as unknown again — never guessed.
        </p>
        <button
          type="button"
          className={JUMP_BTN}
          aria-label="Open weigh station status on the Drive screen"
          onClick={onOpenWeighStations}
        >
          ⚖️ Weigh stations &amp; live driver status
        </button>
      </section>

      <section className="mt-6" aria-label={`State contacts for ${state.name}`}>
        <h4 className={SECTION_TITLE}>📞 State contacts</h4>
        <dl className="mt-2 space-y-3 text-base">
          <div>
            <dt className="text-sm text-[var(--dim)]">{state.dotName}</dt>
            <dd className="mt-0.5 font-bold">
              {state.dotPhone ? (
                <a className="underline" href={`tel:${state.dotPhone.replace(/[^0-9+*#]/g, "")}`}>
                  {state.dotPhone}
                </a>
              ) : (
                <span className="text-sm font-semibold text-[var(--dim)]">Number not listed</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-[var(--dim)]">{state.patrolName} — non-emergency</dt>
            <dd className="mt-0.5 font-bold">
              {state.patrolPhone ? (
                <a className="underline" href={`tel:${state.patrolPhone.replace("#", "%23")}`}>
                  {state.patrolPhone === "*347"
                    ? "*FHP (*347) from a cell phone"
                    : state.patrolPhone === "*477"
                      ? "*GSP (*477) from a cell phone"
                      : state.patrolPhone === "*55"
                        ? "*55 from a cell phone"
                        : state.patrolPhone === "#677"
                          ? "#677 from a cell phone"
                          : state.patrolPhone}
                </a>
              ) : (
                <span className="text-sm font-semibold text-[var(--dim)]">Number not listed</span>
              )}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-sm leading-snug text-[var(--dim)]">
          A number prints here only where the agency's real published line is verified —
          everywhere else it's left off rather than guessed. In most states, dialing 511 from
          any phone reaches the state travel-information line (road conditions and closures).
          For an emergency, always 911.
        </p>
      </section>
    </div>
  );
}

export function AtlasPanel({
  onClose,
  initialStateCode,
  onOpenWeighStations,
  onOpenMapClearances,
  lang = "en",
}: {
  onClose: () => void;
  /** The driver's chosen language — the standing reference label
   *  keeps its English original (it governs) with the translation
   *  beneath it. Default English for any other caller. */
  lang?: Lang;
  /** State page to open on, when Ask Meca jumped to a named state
   *  ("open the Texas atlas page"). Null opens the Atlas home. */
  initialStateCode: string | null;
  /** Hand off to the app's one weigh-station list + live status
   *  (Drive → Alerts near you — the weigh_station_status landing). */
  onOpenWeighStations: () => void;
  /** Hand off to the Drive map, where the real OSM clearance tags
   *  around the truck are flagged. */
  onOpenMapClearances: () => void;
}) {
  const [selected, setSelected] = useState<AtlasState | null>(() => atlasStateByCode(initialStateCode));
  const [search, setSearch] = useState("");
  const states = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ATLAS_STATES;
    return ATLAS_STATES.filter(
      (s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase() === q,
    );
  }, [search]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" role="dialog" aria-label="Atlas — state road reference">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-[var(--surface)] p-4 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-condensed text-2xl font-bold">🗺️ Atlas</h2>
            <p className="mt-0.5 text-sm text-[var(--dim)]">
              The state-by-state road reference: weight limits, length &amp; width, low
              clearances, weigh stations, and state contacts for all 50 states — built into
              the app, so it works in dead zones with no signal.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Atlas"
            className="btn-press shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface2)] px-3 py-1.5 text-sm font-bold"
          >
            ✕
          </button>
        </div>

        <div className="mt-3">
          <ReferenceBanner lang={lang} />
        </div>

        {selected ? (
          <div className="mt-4">
            <StatePage
              lang={lang}
              state={selected}
              onBack={() => setSelected(null)}
              onOpenWeighStations={onOpenWeighStations}
              onOpenMapClearances={onOpenMapClearances}
            />
          </div>
        ) : (
          <div className="mt-4">
            <section aria-label="Federal baseline">
              <h3 className={SECTION_TITLE}>⚖️ The federal baseline</h3>
              <p className="mt-1 text-sm leading-snug text-[var(--dim)]">
                On the Interstate system and the National Network, federal law sets the floor
                every state page starts from. State pages add a note only where a state's own
                rule is a well-established public fact; everywhere else the baseline stands
                under its label.
              </p>
              <WeightRows />
              <p className="mt-2 text-base">
                Width: <span className="font-bold tnum">{FEDERAL_WIDTH_IN} in</span> · Semitrailer:{" "}
                <span className="font-bold">53 ft standard</span>
              </p>
            </section>

            <label className="mt-5 block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--dim)]">
                Find a state
              </span>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="State name or code — e.g. Texas, TX"
                aria-label="Search states"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-3 py-2.5 text-base text-[var(--text)] placeholder:text-[var(--dim)]"
              />
            </label>

            <div className="mt-3 space-y-2">
              {states.map((s) => (
                <button
                  key={s.code}
                  type="button"
                  className="btn-press flex min-h-[56px] w-full items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-left"
                  aria-label={`Open the ${s.name} atlas page`}
                  onClick={() => setSelected(s)}
                >
                  <span className="font-condensed text-xl font-bold leading-tight">
                    {s.name} <span className="text-sm text-[var(--dim)]">{s.code}</span>
                  </span>
                  <span className="ml-auto shrink-0 text-xs font-semibold text-[var(--dim)]">
                    {s.weightNote || s.sizeNote || s.clearanceNote
                      ? "State notes inside"
                      : "Federal standard"}
                  </span>
                  <span className="shrink-0 text-[var(--dim)]" aria-hidden>→</span>
                </button>
              ))}
              {states.length === 0 && (
                <p className="px-1 py-3 text-sm text-[var(--dim)]">
                  No state matches that search — all 50 are here; try the full name or the
                  two-letter code.
                </p>
              )}
            </div>

            <p className="mt-4 text-sm leading-snug text-[var(--dim)]">
              Atlas pages are a static planning reference, built from public federal and state
              facts in our own words — they never change while you drive. What changes live —
              weigh-station OPEN/CLOSED status, weather, clearances tagged around your truck —
              rides on the Drive map, where it belongs.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
