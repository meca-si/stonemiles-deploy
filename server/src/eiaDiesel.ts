/**
 * EIA WEEKLY DIESEL AVERAGES — auto-refresh (owner-approved 2026-10-30:
 * "wire the EIA averages to auto-refresh weekly").
 *
 * Source: the U.S. Energy Information Administration's public weekly
 * retail on-highway diesel pages (no API key — the EIA API v2 requires
 * a registered key this app does not hold; these official pages carry
 * the same published weekly values and were verified live at build
 * time: week of Oct 26, 2026 — national $6.352, Gulf Coast $5.951,
 * West Coast $7.329, matching EIA's Oct 27, 2026 release).
 *
 *   U.S.       https://www.eia.gov/dnav/pet/pet_pri_gnd_dcus_nus_w.htm
 *              series EMD_EPD2D_PTE_NUS_DPG
 *   Gulf Coast https://www.eia.gov/dnav/pet/pet_pri_gnd_dcus_r30_w.htm
 *              series EMD_EPD2D_PTE_R30_DPG  (PADD 3)
 *   West Coast https://www.eia.gov/dnav/pet/pet_pri_gnd_dcus_r50_w.htm
 *              series EMD_EPD2D_PTE_R50_DPG  (PADD 5)
 *
 * Each page's table header carries the week Mondays (MM/DD/YY) and
 * each series row carries its weekly values, the newest in the
 * Current2 cell immediately before the series-history link. Parsing
 * anchors on the series id so gasoline rows can never be mistaken
 * for diesel.
 *
 * HONESTY RULES (unchanged from the snapshot era, owner-locked):
 * - These are REGIONAL CONTEXT ONLY, NEVER A STATION PRICE. Every
 *   surface that shows them keeps that label.
 * - A refresh that fails, disagrees with itself (the three pages
 *   must report the SAME week), or returns implausible values stores
 *   NOTHING — the last good week keeps serving, labelled with its age.
 * - The seed below is the app's previous shipped data (the Oct 22,
 *   2026 research snapshot, week of Oct 19, 2026). It exists only as
 *   the initial last-good row before the first live refresh lands;
 *   it is labelled as a seed wherever its source is shown.
 *
 * Pure parsing/validation/staleness helpers live here and are unit-
 * tested (eiaDiesel.test.ts); actions.ts owns the DB + fetch timing.
 */

export const EIA_SOURCE_NAME =
  "U.S. Energy Information Administration (EIA) — Weekly Retail On-Highway Diesel Prices";
export const EIA_SOURCE_URL =
  "https://www.eia.gov/dnav/pet/pet_pri_gnd_dcus_nus_w.htm";

export const EIA_PAGES = [
  {
    region: "national" as const,
    url: "https://www.eia.gov/dnav/pet/pet_pri_gnd_dcus_nus_w.htm",
    series: "EMD_EPD2D_PTE_NUS_DPG",
  },
  {
    region: "gulfCoast" as const,
    url: "https://www.eia.gov/dnav/pet/pet_pri_gnd_dcus_r30_w.htm",
    series: "EMD_EPD2D_PTE_R30_DPG",
  },
  {
    region: "westCoast" as const,
    url: "https://www.eia.gov/dnav/pet/pet_pri_gnd_dcus_r50_w.htm",
    series: "EMD_EPD2D_PTE_R50_DPG",
  },
];

/** The previously shipped static snapshot — the initial last-good. */
export const EIA_SEED = {
  weekOf: "2026-10-19",
  national: 6.276,
  gulfCoast: 5.903,
  westCoast: 7.394,
  source:
    "EIA weekly on-highway diesel averages via the Oct 22, 2026 research snapshot (seed — awaiting the first live weekly refresh)",
  fetchedAt: new Date("2026-10-22T12:00:00Z"),
};

export type EiaPageParse = { weekOf: string; price: number };
export type EiaSnapshot = {
  weekOf: string; // ISO Monday, YYYY-MM-DD
  national: number;
  gulfCoast: number;
  westCoast: number;
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2026-10-26" → "week of Oct 26, 2026" (the app's long-standing label). */
export function eiaWeekLabel(weekOfIso: string): string {
  const [y = 1970, m = 1, d = 1] = weekOfIso.split("-").map(Number);
  return `week of ${MONTHS[(m - 1 + 12) % 12]} ${d}, ${y}`;
}

/**
 * Parse one EIA weekly page for one diesel series. Returns the newest
 * week's Monday (ISO) and price, or null when the page doesn't carry
 * the expected structure (redesign, error page, truncated body) —
 * callers treat null as a failed refresh and keep the last good week.
 */
export function parseEiaDieselPage(
  html: string,
  seriesId: string,
): EiaPageParse | null {
  if (!html || !seriesId) return null;
  // Week Mondays from the table header; the LAST one is the newest week.
  const dateHits = [
    ...html.matchAll(/class="Series5">(\d{2})\/(\d{2})\/(\d{2})<\/th>/g),
  ];
  const lastDate = dateHits[dateHits.length - 1];
  if (!lastDate) return null;
  const [, mm, dd, yy] = lastDate;
  const weekOf = `20${yy}-${mm}-${dd}`;

  // Anchor on the series-history link, then read the values of the row
  // that link closes: the newest value is the last DataB/Current2 cell
  // before the link.
  const seriesIdx = html.indexOf(`s=${seriesId}`);
  if (seriesIdx < 0) return null;
  const rowStart = html.lastIndexOf('<tr class="DataRow">', seriesIdx);
  if (rowStart < 0) return null;
  const rowHtml = html.slice(rowStart, seriesIdx);
  const values = [
    ...rowHtml.matchAll(/class="(?:DataB|Current2)">([\d.]+)<\/td>/g),
  ]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n));
  const price = values[values.length - 1];
  if (price == null || price < 0.5 || price > 15) return null;
  return { weekOf, price };
}

/**
 * Combine the three regional parses into one snapshot. All three
 * pages must agree on the week and every price must be plausible —
 * anything else throws, and the caller stores nothing.
 */
export function combineEiaPages(parts: {
  national: EiaPageParse | null;
  gulfCoast: EiaPageParse | null;
  westCoast: EiaPageParse | null;
}): EiaSnapshot {
  const { national, gulfCoast, westCoast } = parts;
  if (!national || !gulfCoast || !westCoast) {
    throw new Error("EIA refresh: one or more regional pages didn't parse.");
  }
  if (
    national.weekOf !== gulfCoast.weekOf ||
    national.weekOf !== westCoast.weekOf
  ) {
    throw new Error(
      `EIA refresh: regional pages disagree on the week (${national.weekOf} / ${gulfCoast.weekOf} / ${westCoast.weekOf}) — keeping the last good week.`,
    );
  }
  return {
    weekOf: national.weekOf,
    national: national.price,
    gulfCoast: gulfCoast.price,
    westCoast: westCoast.price,
  };
}

/** Whole days between the week's Monday and `now` (never negative). */
export function eiaWeekAgeDays(weekOfIso: string, now: Date): number {
  const monday = new Date(`${weekOfIso}T00:00:00Z`).getTime();
  if (!Number.isFinite(monday)) return 0;
  return Math.max(0, Math.floor((now.getTime() - monday) / 86_400_000));
}

/**
 * Stale = the week on file is older than a normal weekly cycle allows.
 * EIA publishes on Monday/Tuesday for that Monday, so a healthy
 * snapshot is 1–9 days old; past 10 days a newer week should exist.
 */
export function eiaIsStale(weekOfIso: string, now: Date): boolean {
  return eiaWeekAgeDays(weekOfIso, now) > 10;
}

/**
 * Refresh is due when the last SUCCESSFUL fetch is over 7 days old
 * (or never happened) — the weekly cadence, enforced on read as a
 * fallback behind the weekly scheduled refresh.
 */
export function eiaRefreshDue(
  lastFetchedAt: Date | null,
  now: Date,
): boolean {
  if (!lastFetchedAt) return true;
  return now.getTime() - lastFetchedAt.getTime() > 7 * 86_400_000;
}

const EIA_FETCH_TIMEOUT_MS = 9_000;

/**
 * Fetch + parse + validate the current EIA week from the three
 * official pages. Throws on any failure (network, HTTP, parse,
 * disagreement) — actions catch and keep serving the last good week.
 */
export async function fetchEiaDieselSnapshot(): Promise<EiaSnapshot> {
  const parsed = await Promise.all(
    EIA_PAGES.map(async (page) => {
      const res = await fetch(page.url, {
        signal: AbortSignal.timeout(EIA_FETCH_TIMEOUT_MS),
        headers: {
          "User-Agent": "STONEMILES EIA weekly diesel refresh",
          Accept: "text/html",
        },
      });
      if (!res.ok) {
        throw new Error(`EIA refresh: ${page.region} page HTTP ${res.status}.`);
      }
      const html = await res.text();
      return { region: page.region, parse: parseEiaDieselPage(html, page.series) };
    }),
  );
  const byRegion = {
    national: parsed.find((p) => p.region === "national")?.parse ?? null,
    gulfCoast: parsed.find((p) => p.region === "gulfCoast")?.parse ?? null,
    westCoast: parsed.find((p) => p.region === "westCoast")?.parse ?? null,
  };
  return combineEiaPages(byRegion);
}
