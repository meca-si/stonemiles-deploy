// MarketPulseCard.tsx — the weekly spot-rate context card
// (x-approved 2026-11-04, freeze exception; EIA-diesel precedent).
//
// Placement (builder's choice per the brief): the Today command
// center and the top of the Loads tab — where load-judging happens.
// NEVER on the Drive/GPS screen.
//
// The card renders ONLY what buildMarketPulseCardModel shapes from
// the getMarketPulse view: broker-posted market direction by
// equipment (flatbed first) with each lane's published $/mi where
// the week's report carries one, the total spot average, the
// no-index lanes (oversize / heavy haul first — named with the
// reason no price is shown, never an invented number), the
// required "not a quote" label, the source line, and the stale
// note when the week on file is older than ~2 weeks.

import { buildMarketPulseCardModel, type MarketPulseView } from "./marketPulse";

export function MarketPulseCard({ pulse }: { pulse: MarketPulseView }) {
  const m = buildMarketPulseCardModel(pulse);
  return (
    <section className="glass-panel p-3.5" aria-label="Market Pulse — weekly spot-rate context">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-condensed text-xl font-semibold">📈 {m.heading}</h2>
        <span className="shrink-0 rounded-full bg-[var(--surface2)] px-2.5 py-1 text-xs font-bold">
          {m.weekLabel}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-condensed text-3xl font-bold tnum leading-none">
          {m.totalRateLabel}
        </span>
        <span className="text-sm font-semibold text-[var(--dim)]">
          total spot avg, incl. fuel
        </span>
        <span className="text-sm font-bold">{m.totalChangeLabel}</span>
        <span className="text-sm font-bold text-[var(--ok)]">{m.totalYoyLabel}</span>
        <span className="text-sm font-semibold">{m.totalLoadsLabel}</span>
      </div>
      {m.mdiNote && (
        <p className="mt-1 text-sm text-[var(--dim)]">{m.mdiNote}.</p>
      )}

      <ul className="mt-3 space-y-2">
        {m.rows.map((row) => (
          <li
            key={row.key}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-xl bg-[var(--surface2)] px-3 py-2.5"
          >
            <span className="min-w-[5.5rem] font-condensed text-lg font-bold leading-tight">
              {row.label}
            </span>
            {row.rateLabel && (
              <span className="font-condensed text-lg font-bold leading-tight tnum">
                {row.rateLabel}
              </span>
            )}
            <span className="text-sm font-bold">{row.changeLabel}</span>
            <span className="text-sm font-bold text-[var(--ok)]">{row.yoyLabel}</span>
            <span className="text-sm font-semibold text-[var(--dim)]">{row.loadsLabel}</span>
          </li>
        ))}
      </ul>

      {m.alsoPublishedRows.length > 0 && (
        <div className="mt-3">
          <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--dim)]">
            Also published by the source
          </h3>
          <ul className="mt-1.5 space-y-1.5">
            {m.alsoPublishedRows.map((seg) => (
              <li key={seg.key} className="rounded-xl bg-[var(--surface2)] px-3 py-2">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-condensed text-base font-bold leading-tight">
                    {seg.label}
                  </span>
                  <span className="font-condensed text-base font-bold leading-tight tnum">
                    {seg.rateLabel}
                  </span>
                  <span className="text-xs font-bold text-[var(--dim)]">
                    {seg.weekLabel}
                  </span>
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-[var(--dim)]">
                  {seg.moveNote}. {seg.note}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {m.noIndexRows.length > 0 && (
        <div className="mt-3">
          <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--dim)]">
            Every other lane — no weekly index
          </h3>
          <ul className="mt-1.5 space-y-1.5">
            {m.noIndexRows.map((lane) => (
              <li key={lane.key} className="rounded-xl bg-[var(--surface2)] px-3 py-2">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-condensed text-base font-bold leading-tight">
                    {lane.label}
                  </span>
                  <span className="text-xs font-bold text-[var(--dim)]">
                    No published rate
                  </span>
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-[var(--dim)]">
                  {lane.note}
                </p>
                {lane.contextLabel && (
                  <p className="mt-0.5 text-xs font-semibold">{lane.contextLabel}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-3 text-xs font-semibold leading-relaxed">{m.label}</p>
      <p className="mt-0.5 text-xs text-[var(--dim)]">{m.sourceLine}</p>
      {m.stale && m.staleNote && (
        <p className="mt-2 rounded-lg bg-amber-900/40 px-3 py-2 text-xs font-semibold leading-relaxed text-amber-200" role="status">
          ⚠ {m.staleNote}
        </p>
      )}
    </section>
  );
}
