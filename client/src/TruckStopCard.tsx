// TruckStopCard.tsx — the tap-a-stop card (driver ask 2026-11-01,
// scope-corrected the same night to ALL truck stops and trucker
// rest areas, not just Love's / Pilot).
//
// One premium bottom sheet for every stop the app can name:
//  - Commercial stops (chains in their brand colors; independents
//    neutral): parking-space count, diesel price where a source
//    reports it, and the fuel/food/showers/scales amenity grid.
//  - Rest areas: their own treatment — parking count, restrooms,
//    vending, picnic / pet areas, overnight where the map data says.
// Every fact comes from OpenStreetMap tags parsed in truckStop.ts;
// anything untagged reads "Not in map data", never a guessed yes/no.
// Live parking status is driver-reported intel only, age-labelled.
// Reporting parking from the card is offered only when the driver is
// physically at the stop (canReport) — reports file at the stop's
// own coordinates through the standard intel system, unverified
// until a GPS pass confirms them, under the locked points rules.

import { amenityStatusLabel, type StopCardData } from "./truckStop";

export function TruckStopCardSheet({
  card,
  canReport,
  onClose,
  onRoute,
  onReportParking,
}: {
  card: StopCardData;
  /** Driver is within ~0.5 mi — parking reports are filed from here only. */
  canReport: boolean;
  onClose: () => void;
  onRoute: (label: string, lat: number, lon: number) => void;
  onReportParking: (status: "open" | "full") => void;
}) {
  const d = card.details;
  const hero = card.brandColor ?? (card.kind === "rest_area" ? "#0d7a43" : "#5b6b82");
  const rep = card.parkingReport;
  return (
    <div className="fixed inset-0 z-[960] flex items-end bg-black/70" role="dialog" aria-label={`Stop card: ${card.name}`}>
      <div className="animate-sheet max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl bg-[var(--surface)] pb-safe">
        {/* Brand hero band — chain colors where known, grounded
            green for rest areas, slate for independents. */}
        <div
          className="relative overflow-hidden px-5 pb-4 pt-5"
          style={{ background: `linear-gradient(135deg, ${hero}, ${hero}cc 55%, rgba(5,10,26,0.92))` }}
        >
          <button
            type="button"
            className="btn-press absolute right-4 top-4 rounded-full bg-black/45 px-3.5 py-2 text-sm font-bold text-white"
            aria-label={`Close the card for ${card.name}`}
            onClick={onClose}
          >
            ✕
          </button>
          <div className="flex items-center gap-3 pr-16">
            {card.brandMono ? (
              <span
                className="flex h-14 min-w-14 shrink-0 items-center justify-center rounded-2xl border-2 border-white/70 bg-black/30 px-2 font-condensed text-2xl font-bold text-white shadow-lg"
                aria-hidden
              >
                {card.brandMono}
              </span>
            ) : (
              <span
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-2 border-white/70 bg-black/30 text-3xl shadow-lg"
                aria-hidden
              >
                {card.kind === "rest_area" ? "🛌" : "🛻"}
              </span>
            )}
            <div className="min-w-0">
              <h2 className="font-condensed text-3xl font-bold leading-none text-white drop-shadow">{card.name}</h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs font-bold text-white/90">
                <span className="rounded-full bg-black/40 px-2 py-0.5">{card.kindLabel}</span>
                {card.brandLabel !== card.name && <span className="rounded-full bg-black/40 px-2 py-0.5">{card.brandLabel}</span>}
                {d.open24 && <span className="rounded-full bg-black/40 px-2 py-0.5">Open 24/7</span>}
                {card.distanceText && <span className="rounded-full bg-black/40 px-2 py-0.5">{card.distanceText}</span>}
              </div>
            </div>
          </div>
          {d.address && <p className="mt-2.5 text-sm font-semibold text-white/85">{d.address}</p>}
          {d.openingHours && !d.open24 && <p className="mt-0.5 text-xs font-semibold text-white/70">Hours (map data): {d.openingHours}</p>}
        </div>

        <div className="px-5 py-4">
          {/* Parking — the headline number, plus the network's word. */}
          <div className="flex items-stretch gap-2.5">
            <div className="flex-1 rounded-2xl bg-[var(--surface2)] px-4 py-3 text-center">
              <div className="font-condensed text-4xl font-bold leading-none tnum">
                {d.parkingSpaces != null ? d.parkingSpaces : "—"}
              </div>
              <div className="mt-1 text-[11px] font-bold uppercase tracking-wide text-[var(--dim)]">
                {d.parkingSpaces != null ? "Truck parking spaces" : "Parking count not in map data"}
              </div>
            </div>
            <div className="flex-1 rounded-2xl bg-[var(--surface2)] px-4 py-3 text-center">
              {rep ? (
                <>
                  <div className={`font-condensed text-2xl font-bold leading-tight ${rep.status === "open" ? "text-[var(--ok)]" : "text-[var(--danger)]"}`}>
                    {rep.status === "open" ? "🅿️ Spaces open" : "🚫 Reported FULL"}
                  </div>
                  <div className="mt-0.5 text-[11px] font-bold uppercase tracking-wide text-[var(--dim)]">
                    Driver report · {rep.ageLabel}
                    {rep.confirmed ? " · GPS-confirmed" : " · unconfirmed"}
                  </div>
                </>
              ) : (
                <>
                  <div className="font-condensed text-2xl font-bold leading-tight text-[var(--dim)]">No live report</div>
                  <div className="mt-0.5 text-[11px] font-bold uppercase tracking-wide text-[var(--dim)]">
                    Parking status lives on driver reports
                  </div>
                </>
              )}
            </div>
            {card.dieselPrice != null && (
              <div className="flex-1 rounded-2xl bg-[var(--surface2)] px-4 py-3 text-center">
                <div className="font-condensed text-4xl font-bold leading-none tnum">${card.dieselPrice.toFixed(2)}</div>
                <div className="mt-1 text-[11px] font-bold uppercase tracking-wide text-[var(--dim)]">Diesel / gal (map tag)</div>
              </div>
            )}
          </div>

          {/* Amenity grid — every tile states its own evidence. */}
          <h3 className="mt-4 font-condensed text-lg font-semibold">
            {card.kind === "rest_area" ? "At this rest area" : "Amenities"}
          </h3>
          <div className="mt-2 grid grid-cols-3 gap-2" role="list" aria-label={`${card.name} amenities`}>
            {d.amenities.map((a) => (
              <div
                key={a.key}
                role="listitem"
                className={`rounded-2xl px-2 py-2.5 text-center ${
                  a.value === true
                    ? "bg-[var(--surface2)] ring-1 ring-[var(--ok)]/50"
                    : a.value === false
                      ? "bg-[var(--surface2)] opacity-55"
                      : "bg-[var(--surface2)] opacity-80"
                }`}
              >
                <div className="text-2xl" aria-hidden>{a.icon}</div>
                <div className="mt-0.5 text-xs font-bold leading-tight">{a.label}</div>
                <div className={`text-[11px] font-semibold ${a.value === true ? "text-[var(--ok)]" : "text-[var(--dim)]"}`}>
                  {amenityStatusLabel(a)}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-[var(--dim)]">
            Facts come from OpenStreetMap's tags for this stop — “Not in map data” means the map doesn't say, not that it isn't there.
          </p>

          {/* Report parking — only standing at the stop. */}
          {canReport ? (
            <div className="mt-3 rounded-2xl bg-[var(--surface2)] px-3.5 py-3">
              <div className="text-sm font-bold">You're here — how's the parking?</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="btn-press rounded-xl bg-[var(--ok)]/20 px-3 py-3 font-bold text-[var(--ok)] ring-1 ring-[var(--ok)]/60"
                  aria-label={`Report parking available at ${card.name}`}
                  onClick={() => onReportParking("open")}
                >
                  🅿️ Spaces open
                </button>
                <button
                  type="button"
                  className="btn-press rounded-xl bg-[var(--danger)]/15 px-3 py-3 font-bold text-[var(--danger)] ring-1 ring-[var(--danger)]/50"
                  aria-label={`Report parking full at ${card.name}`}
                  onClick={() => onReportParking("full")}
                >
                  🚫 Lot is FULL
                </button>
              </div>
              <p className="mt-1.5 text-xs text-[var(--dim)]">
                One tap files it for every STONEMILES driver — unverified until a GPS pass confirms it, points under the standard intel rules.
              </p>
            </div>
          ) : (
            <p className="mt-3 rounded-2xl bg-[var(--surface2)] px-3.5 py-2.5 text-xs text-[var(--dim)]">
              Parking reports are filed from the stop itself — when you're parked here, this card offers one-tap “spaces open / lot full” for the next driver.
            </p>
          )}

          {/* Actions */}
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              className="btn-neon btn-press flex-1 rounded-2xl py-3.5 font-condensed text-xl font-bold"
              aria-label={`Route to ${card.name}`}
              onClick={() => onRoute(card.name, card.lat, card.lon)}
            >
              Route here →
            </button>
            {d.phone && (
              <a
                href={`tel:${d.phone.replace(/[^+0-9]/g, "")}`}
                className="btn-press flex items-center rounded-2xl bg-[var(--surface2)] px-4 py-3.5 font-bold"
                aria-label={`Call ${card.name} at ${d.phone}`}
              >
                📞 Call
              </a>
            )}
            {d.website && (
              <a
                href={d.website.startsWith("http") ? d.website : `https://${d.website}`}
                target="_blank"
                rel="noreferrer"
                className="btn-press flex items-center rounded-2xl bg-[var(--surface2)] px-4 py-3.5 font-bold"
                aria-label={`Open the website for ${card.name}`}
              >
                🌐 Site
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
