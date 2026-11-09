// Weigh-station approach prompt — pure logic (no DOM, no React),
// like routeGeometry.ts / signCheck.ts, so the exact production
// behavior is unit-testable (see weighStation.test.ts).
//
// X's order (2026-11-02): "on the gps can we add when approaching
// weight stations a prompt of open n close pop up to update status".
// While a trip is live and the truck rolls toward a weigh station
// (OpenStreetMap POIs from the hazard layer, stable id
// "weigh-<osm node id>"), the Drive screen asks the driver — once
// per station per trip, and only when the station's crowd-sourced
// status is unknown or older than 60 minutes — to tap OPEN or
// CLOSED. The honesty rules mirror the duty prompt and the server
// (server/src/weighStation.ts):
//
// - 0.7 mi ahead on the active route (remaining along-route
//   distance), or, with no route, inside a ±60° bearing cone ahead
//   within 0.7 mi straight-line. (Was ~2 mi until x's 2026-11-02
//   follow-up order: "Can you do .7 miles".) The prompt distance is
//   deliberately NOT the points-verification radius — the server
//   keeps its wider GPS-verification zone for awarding road-intel
//   points (server/src/weighStation.ts), so a report answered a
//   little after the prompt still verifies.
// - No answer within 5 s = NO record. Expiry and dismissal never
//   produce a report — the app never guesses a station's status.
//   (The window was 20 s until the driver's 2026-11-03 order: every
//   big on-map prompt, this one included, shows for 5 seconds then
//   disappears — see bigPrompt.ts, whose timeout this one matches.)
// - Statuses older than 4 h read as unknown again.
// - Points are the server's call: only a GPS-verified answer earns
//   road-intel points (see the report action). This module never
//   awards anything.

export type LatLon = { lat: number; lon: number };

export type WeighStationPoint = LatLon & {
  /** Stable station id: "weigh-<osm node id>" from the map data, or
   *  "driver-<uuid>" for a station a driver added with Station here. */
  id: string;
  name: string;
  /** True when a driver created this station (not on the map data). */
  driverReported?: boolean;
  /** Miles remaining along the active route until the station, when
   *  the station sits on the route; null when off-route / no route. */
  routeRemainingMi: number | null;
};

export type WeighStatusInfo = {
  status: "open" | "closed" | "unknown";
  /** Epoch ms of the last driver report; null when never reported. */
  updatedAtMs: number | null;
  reportCount: number;
  reporter: string | null;
  /** True when the station itself was added by a driver through
   *  Station here (it is not in the OpenStreetMap data). */
  driverReported?: boolean;
  /** Username of the driver who added the station, when
   *  driver-reported. */
  addedBy?: string | null;
  /** Epoch ms when a driver added the station, when driver-reported. */
  addedAtMs?: number | null;
};

/** The approach trigger distance (miles ahead) — 0.7 mi per x's
 *  2026-11-02 follow-up order. */
export const WEIGH_TRIGGER_MI = 0.7;
/** Station-here dedupe radius: a tap within this many miles of a
 *  station already on the map (OSM or driver-added) updates THAT
 *  station instead of creating a duplicate. */
export const WEIGH_DEDUPE_MI = 0.3;
/** How long the prompt waits for an answer before it goes away
 *  recording nothing (x's prompt rule — same family as the duty
 *  prompt's "no answer = no data"). 5 seconds since x's
 *  2026-11-03 order put every big on-map prompt — interstate
 *  signs, exits, switches, sign prompts, and this OPEN/CLOSED
 *  prompt — on the same 5-second auto-dismiss (bigPrompt.ts;
 *  a test pins the two constants equal so the family can't drift). */
export const WEIGH_PROMPT_TIMEOUT_MS = 5_000;
/** A known status younger than this suppresses the prompt. */
export const WEIGH_FRESH_MS = 60 * 60_000;
/** A known status older than this reads as unknown again. */
export const WEIGH_STALE_MS = 4 * 60 * 60_000;
/** No-route fallback: the station must sit within this many degrees
 *  of the truck's heading to count as "ahead". */
export const WEIGH_AHEAD_CONE_DEG = 60;
/** How long the "Thanks — status updated" state lingers. */
export const WEIGH_THANKS_MS = 3_000;

export function haversineMi(a: LatLon, b: LatLon): number {
  const R = 3958.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Compass bearing (deg, 0 = north, clockwise) from a to b. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Smallest absolute angle between two bearings, 0–180. */
export function bearingDeltaDeg(from: number, to: number): number {
  const d = Math.abs(((to - from) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/** The status in force right now: a report older than 4 h is unknown
 *  again (mirrors the server rule). */
export function effectiveWeighStatus(info: WeighStatusInfo | null | undefined, nowMs: number): "open" | "closed" | "unknown" {
  if (!info || info.status === "unknown" || info.updatedAtMs == null) return "unknown";
  if (nowMs - info.updatedAtMs > WEIGH_STALE_MS) return "unknown";
  return info.status;
}

/** True when this station should NOT be prompted about: a driver
 *  reported its status less than 60 minutes ago. */
export function weighStatusSuppressesPrompt(info: WeighStatusInfo | null | undefined, nowMs: number): boolean {
  if (!info || info.updatedAtMs == null) return false;
  if (effectiveWeighStatus(info, nowMs) === "unknown") return false;
  return nowMs - info.updatedAtMs < WEIGH_FRESH_MS;
}

/** The nearest station within `radiusMi` of a position, or null —
 *  the Station-here dedupe rule (client mirror of the server rule in
 *  server/src/weighStation.ts; the server re-checks on save, so this
 *  only shapes what the driver is told before the answer returns). */
export function nearestStationWithin<T extends LatLon>(
  stations: readonly T[],
  pos: LatLon,
  radiusMi: number,
): { station: T; distanceMi: number } | null {
  let best: { station: T; distanceMi: number } | null = null;
  for (const st of stations) {
    const d = haversineMi(pos, st);
    if (d <= radiusMi && (!best || d < best.distanceMi)) best = { station: st, distanceMi: d };
  }
  return best;
}

/** The "added by a driver" line driver-reported stations carry in
 *  the status displays: "Driver-reported — added by @name · 2 h ago".
 *  Null for map-data stations. */
export function weighAddedByLine(info: WeighStatusInfo | null | undefined, nowMs: number): string | null {
  if (!info?.driverReported) return null;
  const who = info.addedBy ? `@${info.addedBy}` : "a driver";
  if (info.addedAtMs == null) return `Driver-reported — added by ${who}`;
  const mins = Math.max(0, Math.floor((nowMs - info.addedAtMs) / 60000));
  const age = mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.floor(mins / 60)} h ago` : `${Math.floor(mins / 1440)} d ago`;
  return `Driver-reported — added by ${who} · ${age}`;
}

/** The status line stations show in the alerts / POI displays:
 *  "Open — updated 12 min ago", or the honest unknown. */
export function weighStatusLine(info: WeighStatusInfo | null | undefined, nowMs: number): string {
  const eff = effectiveWeighStatus(info, nowMs);
  if (eff === "unknown" || !info || info.updatedAtMs == null) {
    if (info && info.updatedAtMs != null && nowMs - info.updatedAtMs > WEIGH_STALE_MS) {
      return "Status unknown — last report is over 4 hours old";
    }
    return "Status unknown — no driver report yet";
  }
  const mins = Math.max(0, Math.floor((nowMs - info.updatedAtMs) / 60000));
  const age = mins < 1 ? "just now" : mins < 60 ? `${mins} min ago` : `${Math.floor(mins / 60)} h ${mins % 60} min ago`;
  return `${eff === "open" ? "Open" : "Closed"} — updated ${age}`;
}

export type WeighPromptCandidate = {
  station: WeighStationPoint;
  /** Distance the prompt quotes: along-route remaining when the
   *  station is on the route, else straight-line miles. */
  distanceMi: number;
};

// ---------- "Not here" place corrections (migration 0094) ------------------
// X's order (2026-11-03), from a bogus weigh-station spot in a
// residential neighborhood near Government Blvd, Mobile: a driver
// marks a road-intel place "✕ Not here" and it hides for them at
// once and forever; its creator marking it deletes it for everyone;
// two independent drivers marking it retires it for everyone (kept
// in history, never rendered, never prompted). The pure outcome
// rules mirror the server (server/src/weighStation.ts) exactly;
// this module owns the client-side suppression checks the prompt
// and the map rendering read.

/** Independent drivers' marks needed to retire a spot for everyone. */
export const NOT_HERE_RETIRE_THRESHOLD = 2;

export type NotHereOutcome = "hidden" | "deleted" | "retired";

export type NotHerePlan = {
  outcome: NotHereOutcome;
  distinctReporters: number;
  alreadyMarked: boolean;
};

export function planNotHereCorrection(input: {
  reporter: string;
  creator: string | null;
  existingReporters: readonly string[];
}): NotHerePlan {
  const existing = new Set(input.existingReporters);
  if (existing.has(input.reporter)) {
    return { outcome: "hidden", distinctReporters: existing.size, alreadyMarked: true };
  }
  const distinctReporters = existing.size + 1;
  if (input.creator != null && input.creator === input.reporter) {
    return { outcome: "deleted", distinctReporters, alreadyMarked: false };
  }
  if (distinctReporters >= NOT_HERE_RETIRE_THRESHOLD) {
    return { outcome: "retired", distinctReporters, alreadyMarked: false };
  }
  return { outcome: "hidden", distinctReporters, alreadyMarked: false };
}

/** True when a place must not render or prompt for this driver:
 *  they hid it themselves ("Not here"), or it is retired for
 *  everyone. */
export function isPlaceSuppressedForDriver(
  placeId: string,
  hiddenPlaceIds: ReadonlySet<string>,
  retiredPlaceIds: ReadonlySet<string>,
): boolean {
  return hiddenPlaceIds.has(placeId) || retiredPlaceIds.has(placeId);
}

export type WeighPromptEvaluateInput = {
  /** The driver's prompts setting (Settings → Driving). Off = the
   *  prompt never fires, whatever else is true. */
  promptsEnabled: boolean;
  /** Place ids this driver marked "Not here" (migration 0094) — a
   *  station in here NEVER prompts for this driver. Optional so
   *  older callers/tests keep their shape; the Drive screen always
   *  passes the persisted server state. */
  hiddenPlaceIds?: ReadonlySet<string>;
  /** Place ids retired for everyone (two independent Not-here
   *  marks, or a creator delete) — NEVER prompts, for anyone. */
  retiredPlaceIds?: ReadonlySet<string>;
  /** Prompts only ride a live trip / GPS drive. */
  tripActive: boolean;
  pos: LatLon;
  /** GPS course over ground (deg); null when the fix carries none —
   *  the bearing-ahead fallback then cannot fire (route stations
   *  still can: the route itself proves "ahead"). */
  headingDeg: number | null;
  stations: WeighStationPoint[];
  statuses: ReadonlyMap<string, WeighStatusInfo>;
  /** Station ids already prompted on this trip (cooldown set). */
  promptedIds: ReadonlySet<string>;
  nowMs: number;
};

/**
 * Pick the next station to prompt about, or null. Rules, in order:
 * prompts on, trip live, station not already prompted this trip,
 * station's status unknown or ≥ 60 min old, and the station 0.7 mi
 * ahead — along the active route when it sits on the route, else
 * bearing-ahead within 0.7 mi. The nearest qualifying station wins.
 * Driver-reported stations ("driver-" ids) ride exactly the same
 * rules as map stations — same universe, same freshness/cooldown.
 */
export function evaluateWeighPrompt(input: WeighPromptEvaluateInput): WeighPromptCandidate | null {
  if (!input.promptsEnabled) return null;
  if (!input.tripActive) return null;
  let best: WeighPromptCandidate | null = null;
  for (const st of input.stations) {
    if (input.promptedIds.has(st.id)) continue;
    // "Not here" suppression (migration 0094): a station this driver
    // hid, or one retired for everyone, never prompts — no matter
    // how fresh, stale, or close it is.
    if (input.hiddenPlaceIds?.has(st.id)) continue;
    if (input.retiredPlaceIds?.has(st.id)) continue;
    if (weighStatusSuppressesPrompt(input.statuses.get(st.id), input.nowMs)) continue;
    let distanceMi: number | null = null;
    if (st.routeRemainingMi != null) {
      // On the active route: remaining distance is the truth. A
      // station already passed (remaining ≤ 0) never prompts.
      if (st.routeRemainingMi > 0 && st.routeRemainingMi <= WEIGH_TRIGGER_MI) {
        distanceMi = st.routeRemainingMi;
      }
    } else {
      const d = haversineMi(input.pos, st);
      if (d <= WEIGH_TRIGGER_MI && input.headingDeg != null) {
        if (bearingDeltaDeg(input.headingDeg, bearingDeg(input.pos, st)) <= WEIGH_AHEAD_CONE_DEG) {
          distanceMi = d;
        }
      }
    }
    if (distanceMi == null) continue;
    if (!best || distanceMi < best.distanceMi) best = { station: st, distanceMi };
  }
  return best;
}

/**
 * The prompt's per-trip lifecycle. One instance per trip: `reset`
 * when a new trip starts. Holds the per-station cooldown set, the
 * currently-shown prompt, and the brief thanks state.
 *
 * The no-answer rule is structural here: `expire` and `dismiss`
 * return NOTHING and clear the prompt — only `answer` produces a
 * report for the caller to send. There is no path from a timeout to
 * a recorded status.
 */
export class WeighPromptTracker {
  private prompted = new Set<string>();
  private current: (WeighPromptCandidate & { shownAtMs: number }) | null = null;
  private thanks: { stationId: string; untilMs: number } | null = null;

  /** Start a fresh trip: cooldowns and any open prompt clear. */
  reset(): void {
    this.prompted.clear();
    this.current = null;
    this.thanks = null;
  }

  get promptedIds(): ReadonlySet<string> {
    return this.prompted;
  }

  get showing(): (WeighPromptCandidate & { shownAtMs: number }) | null {
    return this.current;
  }

  get thanksStationId(): string | null {
    return this.thanks?.stationId ?? null;
  }

  /** Evaluate and, when a station qualifies, open the prompt for it
   *  (marking it prompted for the rest of the trip either way the
   *  driver responds — answered, dismissed, or ignored). Returns the
   *  prompt to show, or null. While a prompt is open or the thanks
   *  state is up, no new prompt opens. */
  consider(input: Omit<WeighPromptEvaluateInput, "promptedIds">, nowMs: number): WeighPromptCandidate | null {
    if (this.current) return null;
    if (this.thanks && nowMs < this.thanks.untilMs) return null;
    this.thanks = null;
    const cand = evaluateWeighPrompt({ ...input, promptedIds: this.prompted });
    if (!cand) return null;
    this.prompted.add(cand.station.id);
    this.current = { ...cand, shownAtMs: nowMs };
    return cand;
  }

  /** The driver tapped OPEN or CLOSED: returns the report to send,
   *  and moves to the thanks state. Null when no prompt is open
   *  (already answered / expired / dismissed) — a late tap records
   *  nothing. */
  answer(status: "open" | "closed", nowMs: number): { station: WeighStationPoint; status: "open" | "closed" } | null {
    if (!this.current) return null;
    const { station } = this.current;
    this.current = null;
    this.thanks = { stationId: station.id, untilMs: nowMs + WEIGH_THANKS_MS };
    return { station, status };
  }

  /** The driver tapped the dismiss X: prompt gone, NO report. The
   *  station stays in the trip's cooldown set. */
  dismiss(): void {
    this.current = null;
  }

  /** The 5-second no-answer timeout: returns true when an open
   *  prompt expired. Expiry records NOTHING — no report exists to
   *  send — and the station stays in the trip's cooldown set. */
  expire(nowMs: number): boolean {
    if (!this.current) return false;
    if (nowMs - this.current.shownAtMs < WEIGH_PROMPT_TIMEOUT_MS) return false;
    this.current = null;
    return true;
  }

  /** Whether the thanks state should still be on screen. */
  thanksVisible(nowMs: number): boolean {
    return this.thanks != null && nowMs < this.thanks.untilMs;
  }
}
