// parkingFit.ts — the HOS-aware fit verdict for a parking pick
// (Research Wave 2 item 4), pure and shared by the stop planner
// and the parking panel. Mirrors server/src/parking.ts
// (parkingArrivalPlan) — the tight-margin constant is pinned
// equal across the two by server/src/parking.test.ts.
//
// The math: arrival at the same pace the route weather uses
// (paceMphFor — rolling speed, else the standing 50 mph) graded
// against the BINDING clock (the earlier of drive-time and window
// remaining). fits = clock to spare; tight = arrives with less
// than the margin left; wont_make_it = the clock runs out first —
// and a wont_make_it pick is never offered as reservable.
import { paceMphFor } from "./routeWeather24";

export const PARKING_TIGHT_MARGIN_MIN = 45;

export type ParkingFitVerdict = "fits" | "tight" | "wont_make_it" | "unknown";

export interface ParkingFitResult {
  verdict: ParkingFitVerdict;
  /** Minutes of binding clock left at arrival (negative = late). */
  marginMinutes: number;
  etaAt: Date;
}

/** The binding clock: the earlier of drive and window remaining. */
export function bindingRemainHours(driveRemainH: number | null, windowRemainH: number | null): number | null {
  const parts = [driveRemainH, windowRemainH].filter(
    (v): v is number => v != null && Number.isFinite(v),
  );
  if (parts.length === 0) return null;
  return Math.min(...parts);
}

export function parkingFitFor(args: {
  now: Date;
  alongMi: number;
  /** Rolling speed when known; null falls back to the standing pace. */
  speedMph: number | null;
  driveRemainH: number | null;
  windowRemainH: number | null;
}): ParkingFitResult {
  const pace = paceMphFor(args.speedMph);
  const etaAt = new Date(args.now.getTime() + (args.alongMi / pace) * 3_600_000);
  const binding = bindingRemainHours(args.driveRemainH, args.windowRemainH);
  if (binding == null) return { verdict: "unknown", marginMinutes: 0, etaAt };
  const marginMinutes = binding * 60 - (args.alongMi / pace) * 60;
  const verdict: ParkingFitVerdict =
    marginMinutes < 0 ? "wont_make_it" : marginMinutes < PARKING_TIGHT_MARGIN_MIN ? "tight" : "fits";
  return { verdict, marginMinutes, etaAt };
}

export const PARKING_FIT_LABEL: Record<ParkingFitVerdict, string> = {
  fits: "Fits your clock",
  tight: "Tight on your clock",
  wont_make_it: "Won't make it on your clock",
  unknown: "Clock unknown",
};
