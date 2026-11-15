// parking.ts — reservable HOS-aware parking (Research Wave 2
// item 4). Pure logic + the partner seam; the actions in
// actions.ts wire these to the DB and the chain.
//
// THE INTEGRATION RULE (the whole item): STONEMILES builds NO
// parking supply of its own. Reservations ride a partner's
// inventory (Truck Parking Club-class; outreach sent Nov 11, no
// agreement in hand yet). The seam below is env-gated in the
// house style (brokerIdentityVerifierFromEnv /
// paperworkExtractorFromEnv): it returns null unless BOTH a
// partner API key AND a partner base URL are configured, and the
// actions pass no injected transport, so production reads
// "not configured" until a real partner agreement lands. With no
// partner:
//   - the planner's parking stops stay what they honestly are —
//     suggestions from public/driver-reported data;
//   - the reserve action refuses with the plain reason and
//     writes NOTHING (no row, no chain event, no fake hold).
//
// HOS-AWARE FIT: a pick is graded against the driver's remaining
// clocks with the same ETA pace the route weather uses (rolling
// speed, else the standing 50 mph): the arrival must land before
// the BINDING clock (the earlier of drive-time and window
// remaining) runs out. fits / tight / wont_make_it; a wont_make_it
// pick is never offered as reservable, partner or not — booking a
// driver into a spot their clock can't reach would be worse than
// no booking.

// The client mirror of this constant lives in
// client/src/parkingFit.ts (PARKING_TIGHT_MARGIN_MIN) — the two
// are pinned equal by parking.test.ts reading the client source.
export const PARKING_TIGHT_MARGIN_MIN = 45;

export type ParkingFit = "fits" | "tight" | "wont_make_it" | "unknown";

export interface ParkingArrivalPlan {
  /** When the truck gets there at the standing pace. */
  etaAt: Date;
  /** When the binding HOS clock runs out (eta must beat this). */
  latestArrivalAt: Date;
  /** Minutes of clock left when the truck arrives (negative = late). */
  marginMinutes: number;
  fit: ParkingFit;
}

/**
 * Grade a parking pick against the driver's remaining clocks.
 * `bindingRemainH` is the earlier of drive-time and window
 * remaining (the planner computes it); null when the clocks are
 * unknown — the fit is then honestly "unknown", never guessed.
 */
export function parkingArrivalPlan(args: {
  now: Date;
  alongMi: number;
  paceMph: number;
  bindingRemainH: number | null;
}): ParkingArrivalPlan {
  const pace = args.paceMph > 0 ? args.paceMph : 50;
  const driveMs = (args.alongMi / pace) * 3_600_000;
  const etaAt = new Date(args.now.getTime() + driveMs);
  if (args.bindingRemainH == null || !Number.isFinite(args.bindingRemainH)) {
    return { etaAt, latestArrivalAt: etaAt, marginMinutes: 0, fit: "unknown" };
  }
  const latestArrivalAt = new Date(args.now.getTime() + args.bindingRemainH * 3_600_000);
  const marginMinutes = (latestArrivalAt.getTime() - etaAt.getTime()) / 60_000;
  const fit: ParkingFit =
    marginMinutes < 0 ? "wont_make_it" : marginMinutes < PARKING_TIGHT_MARGIN_MIN ? "tight" : "fits";
  return { etaAt, latestArrivalAt, marginMinutes, fit };
}

// ---------------------------------------------------------------------
// Partner seam
// ---------------------------------------------------------------------

export interface ParkingReserveRequest {
  stopName: string;
  stopLat: number;
  stopLon: number;
  /** ISO timestamps for the arrival window the hold must cover. */
  etaAt: string;
  latestArrivalAt: string;
  driverRef: string;
}

export interface ParkingPartner {
  name: string;
  /** Place a hold. Resolves the partner's own reference for it. */
  reserve(req: ParkingReserveRequest): Promise<{ partnerRef: string; status: "held" | "confirmed" }>;
  /** Release a hold previously placed. */
  cancel(partnerRef: string): Promise<void>;
}

/** The slice of fetch the partner transport uses (injectable for tests). */
export type ParkingFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * The parking partner, when one is configured. Needs BOTH
 * PARKING_PARTNER_API_KEY and PARKING_PARTNER_BASE_URL — a key
 * alone names no partner to call. The transport defaults to the
 * global fetch; actions.ts passes none, so production is
 * unconfigured until a partner agreement + credentials exist.
 * Returns null when unconfigured — the caller then disables
 * reserving with the honest reason.
 */
export function parkingPartnerFromEnv(
  env: Record<string, string | undefined>,
  transport?: ParkingFetch,
): ParkingPartner | null {
  const apiKey = env.PARKING_PARTNER_API_KEY?.trim();
  const baseUrl = env.PARKING_PARTNER_BASE_URL?.trim();
  if (!apiKey || !baseUrl) return null;
  const name = env.PARKING_PARTNER_NAME?.trim() || "Parking partner";
  const fetchFn: ParkingFetch =
    transport ??
    (async (url, init) => {
      const r = await fetch(url, init);
      return { ok: r.ok, status: r.status, json: () => r.json() as Promise<unknown> };
    });
  const call = async (pathSuffix: string, method: string, body?: unknown): Promise<unknown> => {
    const r = await fetchFn(`${baseUrl.replace(/\/+$/, "")}${pathSuffix}`, {
      method,
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`parking partner answered ${r.status}`);
    return r.json();
  };
  return {
    name,
    async reserve(req) {
      const out = (await call("/reservations", "POST", req)) as {
        id?: unknown;
        reference?: unknown;
        status?: unknown;
      };
      const partnerRef =
        typeof out.id === "string" && out.id ? out.id : typeof out.reference === "string" ? out.reference : "";
      if (!partnerRef) throw new Error("parking partner accepted the call but returned no reservation reference");
      return { partnerRef, status: out.status === "confirmed" ? "confirmed" : "held" };
    },
    async cancel(partnerRef) {
      await call(`/reservations/${encodeURIComponent(partnerRef)}`, "DELETE");
    },
  };
}
