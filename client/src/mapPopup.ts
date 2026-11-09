// mapPopup.ts — the SMALL on-map place popup's appearance
// (driver order 2026-11-03, third road-test verdict repair,
// REPAIR B — the see-through branch).
//
// The driver's screenshot showed the small persistent place popup
// — "Weigh station OPEN — reported 9d ago — confirmed by your GPS
// — old report" (an intel-report marker's MapLibre tooltip) — as a
// SOLID black box sitting over the middle of the map, hiding the
// streets under it. His words: "The small prompt need to go or
// outline needs to be see through."
//
// Branch taken: SEE-THROUGH, not removal. The popup's background
// is fully transparent and its box shadow is gone; what remains is
// the text itself with at most a hairline (1px) outline, and the
// map is fully readable beneath. Removal was the fallback only if
// see-through could not stay legible in both map modes — it can:
// the text is white with a heavy dark halo (text-shadow), the
// cartographic label technique. On the LIGHT day basemap (Liberty:
// pale land, white/yellow roads) the dark halo supplies the
// contrast; on the DARK night basemap (CARTO dark matter) and on
// satellite imagery the white letterforms supply it and the halo
// separates them from bright photo detail. The same treatment is
// mode-independent, so no day/night fork is needed.
//
// The marker itself is untouched: it stays tappable, and tapping
// still opens the place's detail (with its "✕ Not here" action)
// exactly as before — only the popup's box changed.
//
// These constants are the single source for the popup look:
// mapEngine.ts builds the popup's inner text style from them and
// theme.css mirrors the container values for .sm-map-popup (the
// popup chrome is MapLibre's own element, styled by class). The
// unit tests pin both sides so they cannot drift apart.

/** The popup panel's background: fully see-through — the map
 *  reads straight through it. */
export const MAP_POPUP_BACKGROUND = "transparent";

/** At most a hairline outline — a single 1px border in the app's
 *  gold tint, no fill, no shadow box behind the text. */
export const MAP_POPUP_BORDER = "1px solid rgba(246, 196, 83, 0.38)";

/** No drop shadow: a shadow is a soft solid box by another name. */
export const MAP_POPUP_BOX_SHADOW = "none";

/** Popup text color: white reads on the dark night basemap and,
 *  with the halo below, on the light day basemap too. */
export const MAP_POPUP_TEXT_COLOR = "#ffffff";

/** The legibility halo: layered dark shadows tight around the
 *  letterforms, so white text stays readable over pale day-map
 *  land, bright satellite detail, and dark night streets alike —
 *  without any background panel. */
export const MAP_POPUP_TEXT_SHADOW =
  "0 1px 2px rgba(0, 0, 0, 0.95), 0 0 6px rgba(0, 0, 0, 0.9), 0 0 14px rgba(0, 0, 0, 0.75)";

/** The popup content's inline text style (mapEngine.ts). */
export function mapPopupTextStyle(): string {
  return (
    `font:600 12px/1.45 system-ui;` +
    `color:${MAP_POPUP_TEXT_COLOR};` +
    `text-shadow:${MAP_POPUP_TEXT_SHADOW};` +
    `max-width:230px`
  );
}
